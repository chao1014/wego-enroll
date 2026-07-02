const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
admin.initializeApp();

exports.setAdminClaims = functions.https.onCall(async (data, context) => {
    const superAdminEmail = 'chao82465@gmail.com';
    
    // ✨ 防呆機制：防止 Firebase 把包裹多包一層，並改用 adminToken 避開關鍵字過濾
    const payload = data.data || data || {};
    const adminToken = payload.adminToken;
    const targetEmail = payload.targetEmail;
    const role = payload.role;
    const scopeValue = payload.scopeValue;

    // 1. 檢查有沒有收到手動打包的 Token
    if (!adminToken) {
        throw new functions.https.HttpsError('unauthenticated', `未提供安全憑證！(後端收到的包裹內容：${JSON.stringify(payload)})`);
    }

    try {
        // 2. 手動驗證這張身分證的真偽！
        const decodedToken = await admin.auth().verifyIdToken(adminToken);
        const currentEmail = decodedToken.email;

        // 3. 檢查是不是超級管理員
        if (!currentEmail || currentEmail.toLowerCase() !== superAdminEmail) {
            throw new functions.https.HttpsError('permission-denied', `權限不足！這張身分證的信箱是：${currentEmail}`);
        }

        // 4. 身份確認無誤，開始執行權限變更
        const userRecord = await admin.auth().getUserByEmail(targetEmail);
        
        let claims = {};
        if (role === 'admin') claims = { admin: true };
        else if (role === 'scopedAdmin') claims = { scopedAdmin: scopeValue }; 
        else if (role === 'blocked') claims = { blocked: true };
        else if (role === 'remove') claims = {}; 

        await admin.auth().setCustomUserClaims(userRecord.uid, claims);
        return { success: true, message: `已成功更新 ${targetEmail} 的權限設定。` };

    } catch (error) {
        console.error('執行失敗:', error);
        
        // ✨ 針對找不到使用者的錯誤進行精準攔截與友善提示
        if (error.code === 'auth/user-not-found') {
            if (role === 'remove') {
                return { success: true, message: `該帳號已不在驗證系統中，將直接為您清理資料庫的殘留紀錄。` };
            } else {
                throw new functions.https.HttpsError(
                    'not-found', 
                    '無法授權！該 Email 尚未登入過本系統。請先請對方使用 Google 帳號「登入系統一次」產生驗證資料後，再進行授權。'
                );
            }
        }

        if (error.code === 'auth/id-token-expired' || error.code === 'auth/argument-error') {
            throw new functions.https.HttpsError('unauthenticated', '安全憑證無效或已過期，請重新登入！');
        }
        
        throw new functions.https.HttpsError('internal', error.message || '設定失敗，請稍後再試。');
    }
});

// ==========================================
// ✨ 自動資料聚合器：當報名資料異動時，自動更新帳號統計
// ==========================================
exports.aggregateUserStats = functions.firestore
    .document('artifacts/{appId}/public/data/registrations/{regId}')
    .onWrite(async (change, context) => {
        const db = admin.firestore();
        const appId = context.params.appId;
        
        const data = change.after.exists ? change.after.data() : change.before.data();
        const email = data.email || 'unknown';
        if (email === 'unknown') return null;

        const safeEmailId = Buffer.from(email).toString('base64');
        const statsRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('user_stats').doc(safeEmailId);

        // 1. 抓取目前「還活著」的報名表
        const regsSnapshot = await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('registrations')
            .where('email', '==', email)
            .get();

        // 2. 抓取目前的統計檔，提取歷史歸檔資料 (Archived Data)
        const existingDoc = await statsRef.get();
        const existingData = existingDoc.exists ? existingDoc.data() : {};
        
        const archivedUnits = existingData.archivedUnits || [];
        const archivedCoaches = existingData.archivedCoaches || [];
        const archivedTournaments = existingData.archivedTournaments || {};

        // ✨ 核心防護：如果活躍報名表清空了，且「沒有」歷史歸檔，才徹底刪除這個帳號的統計檔
        if (regsSnapshot.empty && Object.keys(archivedTournaments).length === 0) {
            return statsRef.delete();
        }

        const liveUnits = new Set();
        const liveCoaches = new Set();
        const liveTournaments = {};
        let latestTimeMs = existingData.lastTimeMs || 0;
        let latestTimeStr = existingData.lastTimeStr || '無紀錄';

        // 3. 計算活躍資料
        regsSnapshot.forEach(doc => {
            const r = doc.data();
            const unit = r.unit || '未填寫單位';
            const tourName = r.tournamentName || '未知賽事';
            const coach = r.coach1 ? r.coach1.trim() : '';
            
            liveUnits.add(unit);
            if (coach) liveCoaches.add(coach);

            if (!liveTournaments[tourName]) liveTournaments[tourName] = { count: 0, units: new Set() };
            liveTournaments[tourName].count++;
            liveTournaments[tourName].units.add(unit);

            const rTimeRaw = r.time || '';
            let rTimeMs = 1;
            if (rTimeRaw) {
                const cleanTime = rTimeRaw.replace('上午', 'AM ').replace('下午', 'PM ');
                rTimeMs = Date.parse(cleanTime);
                if (isNaN(rTimeMs)) {
                    const nums = rTimeRaw.match(/\d+/g);
                    if (nums && nums.length >= 3) {
                        let [y, m, d, h = 0, min = 0, s = 0] = nums.map(Number);
                        if (rTimeRaw.includes('下午') && h < 12) h += 12;
                        if (rTimeRaw.includes('上午') && h === 12) h = 0;
                        rTimeMs = new Date(y, m - 1, d, h, min, s).getTime();
                    }
                }
            }
            if (isNaN(rTimeMs)) rTimeMs = 1;

            if (rTimeMs >= latestTimeMs) {
                latestTimeMs = rTimeMs;
                latestTimeStr = rTimeRaw || '無時間紀錄';
            }
        });

        // 4. ✨ 終極聯集：Live 資料 + Archived 資料
        const mergedUnits = new Set([...archivedUnits, ...Array.from(liveUnits)]);
        const mergedCoaches = new Set([...archivedCoaches, ...Array.from(liveCoaches)]);
        const mergedTournaments = JSON.parse(JSON.stringify(archivedTournaments)); 

        // 活躍賽事覆蓋歷史 (因為使用者在活躍期的修改最準確)
        Object.keys(liveTournaments).forEach(tName => {
            mergedTournaments[tName] = {
                count: liveTournaments[tName].count,
                units: Array.from(liveTournaments[tName].units)
            };
        });

        // 5. 寫入最終帳本
        const statsData = {
            email: email,
            units: Array.from(mergedUnits),
            coaches: Array.from(mergedCoaches),
            tournaments: mergedTournaments,
            archivedUnits: archivedUnits,         // 原樣保留，作為永久基底
            archivedCoaches: archivedCoaches,     // 原樣保留
            archivedTournaments: archivedTournaments, // 原樣保留
            lastTimeMs: latestTimeMs,
            lastTimeStr: latestTimeStr,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        return statsRef.set(statsData);
    });

// ==========================================
// ✨ 初始化 API：讓您一鍵將舊資料同步到新架構
// ==========================================
exports.syncAllUserStats = functions.https.onCall(async (data, context) => {
    // 只有超級管理員可以呼叫
    if (!context.auth || context.auth.token.email !== 'chao82465@gmail.com') {
        throw new functions.https.HttpsError('permission-denied', '權限不足');
    }

    const db = admin.firestore();
    const appId = data.appId || 'wego-enroll-app';
    
    const regsSnap = await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('registrations').get();
    
    // 找出所有獨立的 Email
    const uniqueEmails = new Set();
    regsSnap.forEach(doc => {
        if (doc.data().email) uniqueEmails.add(doc.data().email);
    });

    let syncCount = 0;
    // 模擬觸發每一位使用者的寫入事件
    for (const email of uniqueEmails) {
        const dummyRegSnap = await db.collection('artifacts').doc(appId).collection('public').doc('data').collection('registrations')
            .where('email', '==', email).limit(1).get();
            
        if (!dummyRegSnap.empty) {
            const docRef = dummyRegSnap.docs[0].ref;
            await docRef.set({ _forceSync: Date.now() }, { merge: true });
            syncCount++;
        }
    }
    return { success: true, message: `成功觸發 ${syncCount} 個帳號的背景同步作業！` };
});

// ==========================================
// ✨ 安全輔助 API：讓局部管理員可以透過 Email 查詢 UID 進行代加
// ==========================================
exports.getUserUidByEmail = functions.https.onCall(async (data, context) => {
    // 驗證是否已登入且具備管理員身分 (全站或局部皆可)
    if (!context.auth || (!context.auth.token.admin && !context.auth.token.scopedAdmin)) {
        throw new functions.https.HttpsError('permission-denied', '權限不足，無法執行查詢。');
    }
    
    const email = data.email;
    if (!email) {
        throw new functions.https.HttpsError('invalid-argument', '未提供 Email 參數。');
    }
    
    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        return { uid: userRecord.uid };
    } catch (error) {
        // 精準攔截找不到使用者的錯誤，回傳 null 交由前端處理
        if (error.code === 'auth/user-not-found') {
            return { uid: null };
        }
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// ==========================================
// ✨ 報名費安全校正防護：防止前端惡意竄改報名費
// ==========================================
// ==========================================
// ✨ 費用防護快取版：以最小開銷實作持久化快取與即時更新機制
// ==========================================
let cachedSettings = null;      // 記憶體中的整份賽事設定快取
let cachedVersion = 0;          // 記憶體中快取的版本時間戳

exports.verifyAndCorrectFee = functions.firestore
    .document('artifacts/{appId}/public/data/registrations/{regId}')
    .onWrite(async (change, context) => {
        // 1. 如果是刪除操作，就不需要檢查費用，直接結束
        if (!change.after.exists) return null;

        const data = change.after.data();
        const appId = context.params.appId;
        const db = admin.firestore();

        // 2. 確保這筆報名有足夠的資訊讓我們去查表
        if (!data.tournamentId || !data.item || !data.group) return null;

        try {
            // 3. 讀取極輕量的版本文件 (通常只有幾十個 Bytes，讀取開銷極低)
            const versionRef = db.collection('artifacts').doc(appId)
                .collection('public').doc('data').collection('settings').doc('cache_version');
            
            const versionSnap = await versionRef.get();
            let currentVersion = 0;

            if (versionSnap.exists) {
                currentVersion = versionSnap.data().version || 0;
            }

            // 4. 核心比對：如果版本不一致，或是記憶體快取根本為空，才去讀取整份 settings/global
            if (!cachedSettings || cachedVersion !== currentVersion) {
                console.log(`[費用防護] 偵測到設定檔版本更新 (舊: ${cachedVersion} -> 新: ${currentVersion})，重新載入主設定檔...`);
                
                const settingsSnap = await db.collection('artifacts').doc(appId)
                    .collection('public').doc('data').collection('settings').doc('global').get();
                
                if (settingsSnap.exists) {
                    cachedSettings = settingsSnap.data();
                    cachedVersion = currentVersion; // 同步版本號
                }
            }

            // 防呆：如果還是沒拿到設定檔，退回使用資料庫原有的 fee 避免出錯
            if (!cachedSettings) return null;

            // 5. 根據賽事設定，查出這筆報名「真正該繳的費用」
            const tour = (cachedSettings.tournaments || []).find(t => t.id === data.tournamentId);
            if (!tour) return null;

            let expectedFee = 0;
            if (tour.fees && tour.fees[data.item] && tour.fees[data.item][data.group] !== undefined) {
                expectedFee = Number(tour.fees[data.item][data.group]) || 0;
            }

            // 6. 比對資料庫中目前的費用與正確費用
            const currentFee = Number(data.fee) || 0;
            
            if (currentFee !== expectedFee) {
                console.log(`[費用防護] 攔截異常！報名者 ${data.email || '未知'} 的報名費為 ${currentFee}，正確應為 ${expectedFee}。系統正在強制覆寫...`);
                
                // ✨ 執行覆寫：強制把金額拉回正確的數字
                return change.after.ref.update({ fee: expectedFee });
            }
            
            // 如果金額正確，什麼都不做 (同時避免觸發無限迴圈)
            return null;

        } catch (error) {
            console.error('費用防護執行失敗:', error);
            return null;
        }
    });