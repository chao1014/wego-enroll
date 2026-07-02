import { doc, setDoc, deleteDoc, getDocs, query, where, deleteField, addDoc } from "firebase/firestore"; 
import { httpsCallable } from "firebase/functions";
import { getSettingsDoc, SUPER_ADMIN, functions, auth, getDbPath } from "./firebase.js"; 
import { appData } from "./store.js";

const setAdminClaims = httpsCallable(functions, 'setAdminClaims');
const syncAllUserStats = httpsCallable(functions, 'syncAllUserStats'); 

const escapeHTML = (str) => {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
};

window.migrateAllHistoricalProfiles = async () => {
    if(!confirm("這將會掃描全站所有歷史報名資料，自動萃取成每一位使用者的「常用名單」並寫入資料庫。\n這是一個背景轉移作業，使用者完全不會察覺。\n確定要執行嗎？")) return;
    
    const btn = document.getElementById('btn-migrate-profiles');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>轉移中，請勿關閉網頁...';
    
    try {
        // 1. 抓取全站所有報名資料
        const regsSnap = await getDocs(query(getDbPath('registrations')));
        const allRegs = [];
        regsSnap.forEach(d => allRegs.push(d.data()));

        // 2. 抓取目前已經在 team_profiles 的資料 (防呆，避免重複寫入)
        const profilesSnap = await getDocs(query(getDbPath('team_profiles')));
        const existingKeys = new Set();
        profilesSnap.forEach(d => {
            const p = d.data();
            existingKeys.add(`${p.userId}_${p.unit}_${p.subTeam || ''}_${p.coach1}`);
        });

        // 3. 萃取全站資料，以「使用者ID + 單位 + 分隊 + 教練」作為唯一鍵值
        const uniqueProfiles = {};
        allRegs.forEach(r => {
            if (!r.userId) return; // 略過無效資料
            const st = r.subTeam || '';
            const key = `${r.userId}_${r.unit}_${st}_${r.coach1}`;
            
            if (!existingKeys.has(key)) {
                if (!uniqueProfiles[key] || new Date(r.time) > new Date(uniqueProfiles[key].time)) {
                    uniqueProfiles[key] = {
                        userId: r.userId,
                        unit: r.unit || '',
                        subTeam: st,
                        phone: r.phone || '',
                        leader: r.leader || '',
                        manager: r.manager || '',
                        coach1: r.coach1 || '',
                        coach2: r.coach2 || '',
                        coach3: r.coach3 || '',
                        updatedAt: Date.now() // 標記為最新時間
                    };
                }
            }
        });

        const profilesToAdd = Object.values(uniqueProfiles);
        if (profilesToAdd.length === 0) {
            alert("目前沒有需要轉移的新名單！所有人的名單都已經是最新的。");
            if (btn) btn.innerHTML = '<i class="fas fa-magic mr-1.5"></i>無痛轉移歷史名單';
            return;
        }

        // 4. 分批寫入 (每批 100 筆)
        const batchSize = 100;
        let addedCount = 0;
        for (let i = 0; i < profilesToAdd.length; i += batchSize) {
            const chunk = profilesToAdd.slice(i, i + batchSize);
            const promises = chunk.map(p => addDoc(getDbPath('team_profiles'), p));
            await Promise.all(promises);
            addedCount += chunk.length;
            console.log(`已轉移 ${addedCount} / ${profilesToAdd.length} 筆...`);
        }

        alert(`✅ 轉移大成功！\n系統已在背景為全站使用者建立了 ${profilesToAdd.length} 筆常用名單。`);
    } catch(e) {
        console.error("轉移失敗", e);
        alert("轉移失敗：" + e.message);
    } finally {
        if (btn) btn.innerHTML = '<i class="fas fa-magic mr-1.5"></i>無痛轉移歷史名單';
    }
};

window.allAdminUsersDataCache = null;

// ✨ 直接去拿後端算好的結果 (user_stats)，不再讀取 registrations
window.fetchAndRenderAdminUsers = async () => {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;

    // 每次都顯示載入中，並去後端抓取最新資料
    tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400 font-bold"><i class="fas fa-spinner fa-spin mr-2"></i>正在從雲端載入最新聚合統計資料...</td></tr>';
    
    try {
        const snap = await getDocs(query(getDbPath('user_stats')));
        const stats = [];
        snap.forEach(d => stats.push(d.data()));
        
        // 更新快取供搜尋功能使用
        window.allAdminUsersDataCache = stats;
        
        // 渲染畫面
        window.renderAdminUsersList(); 
    } catch (error) {
        console.error("載入統計資料失敗:", error);
        tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-8 text-center text-red-500 font-bold">載入失敗，請確認 Firebase 權限或網路狀態。</td></tr>';
    }
};

// ✨ 一鍵強制同步舊資料
window.forceSyncUserStats = async () => {
    if(!confirm("這將觸發後端重新計算所有舊的報名資料，需要一點時間，確定要執行嗎？")) return;
    const btn = document.getElementById('btn-sync-stats');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 同步中...';
    try {
        const res = await syncAllUserStats({});
        alert(res.data.message);
        window.allAdminUsersDataCache = null; // 清空快取強制重拉
        window.fetchAndRenderAdminUsers();
    } catch(e) {
        alert("同步失敗：" + e.message);
    }
    if (btn) btn.innerHTML = '<i class="fas fa-sync-alt"></i> 同步舊資料';
};

window.renderAdminUsersList = () => {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;

    const user = auth.currentUser; 
    const userEmail = user ? user.email : '';

    const searchContainer = document.getElementById('admin-user-search')?.parentElement?.parentElement;
    
    if (searchContainer && userEmail === SUPER_ADMIN && !document.getElementById('btn-sync-stats')) {
        const syncBtn = document.createElement('button');
        syncBtn.id = 'btn-sync-stats';
        syncBtn.type = 'button';
        syncBtn.onclick = window.forceSyncUserStats;
        syncBtn.className = "bg-gray-100 text-gray-500 px-4 py-2.5 rounded-xl font-bold hover:bg-blue-100 hover:text-blue-600 transition-all text-xs whitespace-nowrap shrink-0 flex items-center ml-0 sm:ml-3 border border-gray-200";
        syncBtn.innerHTML = '<i class="fas fa-sync-alt mr-1.5"></i>強制校正舊資料';
        searchContainer.appendChild(syncBtn);

        // ✨ 新增的無痛轉移歷史名單按鈕
        const migrateBtn = document.createElement('button');
        migrateBtn.id = 'btn-migrate-profiles';
        migrateBtn.type = 'button';
        migrateBtn.onclick = window.migrateAllHistoricalProfiles;
        migrateBtn.className = "bg-purple-50 text-purple-600 px-4 py-2.5 rounded-xl font-bold hover:bg-purple-100 hover:text-purple-700 transition-all text-xs whitespace-nowrap shrink-0 flex items-center ml-3 border border-purple-200 shadow-sm";
        migrateBtn.innerHTML = '<i class="fas fa-magic mr-1.5"></i>無痛轉移歷史名單';
        searchContainer.appendChild(migrateBtn);
    }

    const userStatsList = window.allAdminUsersDataCache || [];
    const blockedUsers = appData.blockedUsers || []; 
    tbody.innerHTML = '';
    
    // 如果真的沒資料，顯示單純的提示
    if (userStatsList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400 font-bold">目前資料庫中尚無帳號統計資料。</td></tr>`;
        return;
    }

    const searchEl = document.getElementById('admin-user-search');
    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : '';

    let filteredList = userStatsList;
    if (keyword) {
        filteredList = filteredList.filter(stat => {
            const email = stat.email || '';
            const unitsStr = (stat.units || []).join('、').toLowerCase();
            const coachesStr = (stat.coaches || []).join('、').toLowerCase();
            return email.toLowerCase().includes(keyword) || unitsStr.includes(keyword) || coachesStr.includes(keyword);
        });
    }

    if (filteredList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="px-6 py-8 text-center text-gray-400 font-bold">找不到符合「${escapeHTML(keyword)}」的帳號</td></tr>`;
        return;
    }

    // 依最後報名時間降冪排序
    filteredList.sort((a, b) => (b.lastTimeMs || 0) - (a.lastTimeMs || 0)).forEach(stat => {
        const email = stat.email;
        const unitsStr = (stat.units || []).join('、');
        const coachesStr = (stat.coaches || []).join('、') || '無紀錄'; 
        
        let tourDetailsHtml = `<div class="flex flex-col gap-2 my-1">`;
        Object.keys(stat.tournaments || {}).forEach(tName => {
            const tData = stat.tournaments[tName];
            const tUnitsStr = (tData.units || []).join('、');
            
            tourDetailsHtml += `
                <div class="flex flex-col bg-gray-50 px-3 py-2.5 rounded-xl border border-gray-100 shadow-sm">
                    <div class="flex justify-between items-start gap-3 mb-1.5">
                        <span class="text-tkdBlue font-bold text-xs leading-relaxed break-words">${escapeHTML(tName)}</span>
                        <span class="text-gray-600 font-black text-xs shrink-0 bg-white px-2 py-0.5 rounded shadow-sm border border-gray-100">${tData.count} 人</span>
                    </div>
                    <div class="text-[11px] text-gray-500 font-bold border-t border-gray-100 pt-1.5">
                        <i class="fas fa-shield-alt mr-1 text-gray-400"></i>報名單位：<span class="text-gray-700">${escapeHTML(tUnitsStr)}</span>
                    </div>
                </div>`;
        });
        tourDetailsHtml += `</div>`;

        const isBlocked = blockedUsers.includes(email);
        
        let actionHtml = '';
        if (isBlocked) {
            actionHtml = `<button onclick="window.toggleBlockUser('${escapeHTML(email)}')" class="w-full sm:w-auto bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200 px-4 py-2.5 sm:py-2 rounded-xl text-xs font-black transition-colors shadow-sm flex justify-center items-center"><i class="fas fa-unlock mr-1.5"></i>解除封鎖</button>`;
        } else {
            actionHtml = `<button onclick="window.toggleBlockUser('${escapeHTML(email)}')" class="w-full sm:w-auto bg-red-50 text-red-500 hover:bg-red-100 border border-red-100 px-4 py-2.5 sm:py-2 rounded-xl text-xs font-black transition-colors shadow-sm flex justify-center items-center"><i class="fas fa-ban mr-1.5"></i>停權帳號</button>`;
        }

        const tr = document.createElement('tr');
        tr.className = "border border-gray-200 sm:border-0 sm:border-b sm:border-gray-100 hover:bg-blue-50/20 transition-colors block sm:table-row mb-4 sm:mb-0 p-4 sm:p-0 bg-white rounded-2xl sm:rounded-none shadow-sm sm:shadow-none";
        
        tr.innerHTML = `
            <td class="px-2 py-3 sm:px-6 sm:py-4 font-black text-gray-800 block sm:table-cell border-b border-dashed border-gray-200 sm:border-0">
                <span class="sm:hidden text-[10px] text-gray-400 block mb-1 uppercase tracking-widest">註冊帳號</span>
                <div class="break-all">${escapeHTML(email)}</div>
            </td>
            
            <td class="px-2 py-3 sm:px-6 sm:py-4 text-gray-600 block sm:table-cell whitespace-normal leading-relaxed text-sm font-bold border-b border-dashed border-gray-200 sm:border-0">
                <span class="sm:hidden text-[10px] text-gray-400 block mb-1 uppercase tracking-widest">曾報名之單位</span>
                <div class="text-gray-800"><i class="fas fa-shield-alt text-gray-400 mr-1.5"></i>${escapeHTML(unitsStr)}</div>
                <div class="text-xs text-tkdBlue mt-1.5"><i class="fas fa-user-tie mr-1"></i>教練：${escapeHTML(coachesStr)}</div>
            </td>
            
            <td class="px-2 py-3 sm:px-6 sm:py-4 block sm:table-cell align-top min-w-0 sm:min-w-[250px] border-b border-dashed border-gray-200 sm:border-0">
                <span class="sm:hidden text-[10px] text-gray-400 block mb-1 uppercase tracking-widest">賽事報名明細</span>
                <div class="whitespace-normal break-words break-all">
                    ${tourDetailsHtml}
                </div>
            </td>
            
            <td class="px-2 py-3 sm:px-6 sm:py-4 sm:text-center text-xs font-bold text-gray-400 block sm:table-cell border-b border-dashed border-gray-200 sm:border-0">
                <span class="sm:hidden text-[10px] text-gray-400 block mb-1 uppercase tracking-widest">最後報名時間</span>
                ${escapeHTML(stat.lastTimeStr)}
            </td>
            
            <td class="px-2 py-4 sm:px-6 sm:py-4 sm:text-center block sm:table-cell mt-1 sm:mt-0">
                ${actionHtml}
            </td>
        `;
        tbody.appendChild(tr);
    });
};

window.toggleBlockUser = async (email) => {
    if (email === SUPER_ADMIN) return alert('不能封鎖超級管理員！');
    if (appData.admins.includes(email)) return alert('請先解除該帳號的管理員權限，才能進行封鎖！');

    const isBlocked = appData.blockedUsers && appData.blockedUsers.includes(email);
    const actionText = isBlocked ? '解除封鎖' : '封鎖';
    const confirmMsg = isBlocked 
        ? `確定要「解除封鎖」帳號 ${email} 嗎？\n解除後該帳號將可恢復登入與報名功能。`
        : `確定要「封鎖」帳號 ${email} 嗎？\n封鎖後該帳號將會被強制踢下線，且無法再登入報名。`;

    if (!confirm(confirmMsg)) return;

    try {
        const idToken = await auth.currentUser.getIdToken(true);

        await setAdminClaims({
            targetEmail: email,
            role: isBlocked ? 'remove' : 'blocked',
            adminToken: idToken
        });

        // 更新資料庫，讓 UI 可以顯示封鎖名單
        let newBlocked = [...(appData.blockedUsers || [])];
        if (isBlocked) {
            newBlocked = newBlocked.filter(e => e !== email); 
        } else {
            newBlocked.push(email); 
        }

        await setDoc(getSettingsDoc(), { blockedUsers: newBlocked }, { merge: true });
        
        alert(`已成功${actionText} ${email}`);
        
        // ✨ 新增：更新快取中的畫面 (因為 app.js 已經不監聽全表，需要手動刷新畫面)
        window.renderAdminUsersList();

    } catch (e) {
        console.error(e);
        alert(`操作失敗：${e.message || "請檢查網路連線或權限。"}`);
    }
};

window.manualBlock = () => {
    const input = document.getElementById('admin-user-search');
    if (!input) return;
    const email = input.value.trim().toLowerCase();

    if (!email || !email.includes('@')) return alert('請在搜尋框中輸入完整的 Google Email 格式，才能進行封鎖！');
    
    if (appData.blockedUsers && appData.blockedUsers.includes(email)) {
        return alert('此帳號已經在封鎖名單中！若要解除封鎖，請在下方列表中找到該帳號，並點擊「解除封鎖」按鈕。');
    }

    window.toggleBlockUser(email);
    input.value = ''; 
};


// ==========================================
// 2. 權限管理與名稱設定 (Super Admin)
// ==========================================

window.toggleAdminScopeUI = () => {
    const type = document.getElementById('new-admin-scope-type').value;
    const valSelect = document.getElementById('new-admin-scope-value');
    valSelect.innerHTML = '';
    
    if (type === 'global') {
        valSelect.classList.add('hidden');
    } else if (type === 'city') {
        valSelect.classList.remove('hidden');
        (appData.cities || []).forEach(c => valSelect.add(new Option(c, c)));
    } else if (type === 'tournament') {
        valSelect.classList.remove('hidden');
        (appData.tournaments || []).forEach(t => valSelect.add(new Option(t.name, t.id)));
    }
};

window.renderAdminPerms = () => {
    const container = document.getElementById('admin-list-container');
    if(!container) return;
    
    const names = appData.adminNames || {}; 

    container.innerHTML = `
        <li class="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-purple-50 border border-purple-100 px-5 py-4 rounded-xl shadow-sm mb-3 gap-3">
            <div class="font-black text-purple-700 flex flex-wrap items-center gap-2 w-full">
                <i class="fas fa-crown text-lg shrink-0"></i>
                <span class="break-all">${SUPER_ADMIN} <span class="text-sm text-purple-600 ml-1">(系統創始人)</span> <span class="ml-2 text-[10px] bg-purple-200 text-purple-800 px-2 py-0.5 rounded">超級管理員</span></span> 
            </div>
        </li>`;
        
    appData.admins.forEach(email => {
        const nameLabel = names[email] ? `<span class="text-base text-gray-800 font-black ml-1 mr-1">${escapeHTML(names[email])}</span>` : '';
        
        container.innerHTML += `
        <li class="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white border border-gray-100 px-5 py-4 sm:py-3 rounded-xl shadow-sm mb-3 sm:mb-2 hover:border-blue-100 transition-colors group gap-3 sm:gap-4">
            <div class="font-bold text-gray-400 flex items-center break-all flex-grow">
                <i class="fas fa-globe text-tkdBlue mr-2 shrink-0"></i>
                ${nameLabel} <span class="text-xs">(${email})</span>
                <span class="ml-2 text-[10px] bg-blue-50 text-tkdBlue border border-blue-100 px-2 py-0.5 rounded font-black tracking-wider">全站管理員</span>
            </div>
            <div class="flex gap-2 w-full sm:w-auto shrink-0">
                <button onclick="loadAdminForEdit('${email}', 'global', '')" class="flex-1 sm:flex-none text-tkdBlue bg-blue-50 hover:bg-blue-100 px-3 py-2.5 sm:py-1.5 rounded-lg text-sm sm:text-xs font-bold transition-colors border border-blue-100 text-center flex justify-center items-center whitespace-nowrap">
                    <i class="fas fa-edit mr-1"></i>修改
                </button>
                <button onclick="removeAdmin('${email}', 'global')" class="flex-1 sm:flex-none text-red-500 bg-red-50 hover:bg-red-100 px-3 py-2.5 sm:py-1.5 rounded-lg text-sm sm:text-xs font-bold transition-colors border border-red-100 text-center flex justify-center items-center whitespace-nowrap">
                    <i class="fas fa-trash-alt mr-1"></i>移除
                </button>
            </div>
        </li>`;
    });

    if (appData.scopedAdmins) {
        Object.keys(appData.scopedAdmins).forEach(email => {
            const scope = appData.scopedAdmins[email];
            const icon = scope.type === 'city' ? 'fa-city text-teal-600' : 'fa-trophy text-orange-500';
            const badgeBg = scope.type === 'city' ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-orange-50 text-orange-600 border-orange-200';
            const scopeLabel = scope.type === 'city' ? `單位授權: ${scope.value}` : `賽事授權: ${appData.tournaments.find(t=>t.id===scope.value)?.name || scope.value}`;
            
            const nameLabel = names[email] ? `<span class="text-base text-gray-800 font-black ml-1 mr-1">${escapeHTML(names[email])}</span>` : '';

            container.innerHTML += `
            <li class="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white border border-gray-100 px-5 py-4 sm:py-3 rounded-xl shadow-sm mb-3 sm:mb-2 hover:border-blue-100 transition-colors group gap-3 sm:gap-4">
                <div class="font-bold text-gray-400 flex items-center break-all flex-grow flex-wrap gap-2">
                    <i class="fas ${icon} mr-1 shrink-0"></i>
                    ${nameLabel} <span class="text-xs">(${email})</span>
                    <span class="text-[10px] ${badgeBg} border px-2 py-0.5 rounded font-black tracking-wider">${scopeLabel}</span>
                </div>
                <div class="flex gap-2 w-full sm:w-auto shrink-0">
                    <button onclick="loadAdminForEdit('${email}', '${scope.type}', '${scope.value}')" class="flex-1 sm:flex-none text-tkdBlue bg-blue-50 hover:bg-blue-100 px-3 py-2.5 sm:py-1.5 rounded-lg text-sm sm:text-xs font-bold transition-colors border border-blue-100 text-center flex justify-center items-center whitespace-nowrap">
                        <i class="fas fa-edit mr-1"></i>修改
                    </button>
                    <button onclick="removeAdmin('${email}', 'scoped')" class="flex-1 sm:flex-none text-red-500 bg-red-50 hover:bg-red-100 px-3 py-2.5 sm:py-1.5 rounded-lg text-sm sm:text-xs font-bold transition-colors border border-red-100 text-center flex justify-center items-center whitespace-nowrap">
                        <i class="fas fa-trash-alt mr-1"></i>移除
                    </button>
                </div>
            </li>`;
        });
    }
};

window.addAdmin = async () => {
    if (!auth.currentUser) {
        alert("前端錯誤：系統判定你目前未登入！請重新登入。");
        return;
    }

    const nameInput = document.getElementById('new-admin-name'); 
    const input = document.getElementById('new-admin-email');
    const adminName = nameInput ? nameInput.value.trim() : '';
    const email = input.value.trim().toLowerCase();
    const type = document.getElementById('new-admin-scope-type').value;
    const scopeValue = document.getElementById('new-admin-scope-value').value;

    if(!email || !email.includes('@')) return alert('請輸入有效的 Google Email 格式！');
    if(email === SUPER_ADMIN) return alert('此帳號為系統內建超級管理員，無法修改權限！');
    
    const btn = document.getElementById('btn-submit-admin');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> 處理中...';
    btn.disabled = true;

    try {
        const idToken = await auth.currentUser.getIdToken(true);
        const roleStr = type === 'global' ? 'admin' : 'scopedAdmin';
        
        // 1. 呼叫後端 API
        // ✨ 修改此處：確保 scopeValue 傳遞的是包含 type 和 value 的物件，以符合 Firebase 規則
        await setAdminClaims({
            targetEmail: email,
            role: roleStr,
            scopeValue: type === 'global' ? null : { type: type, value: scopeValue },
            adminToken: idToken 
        });

        // 2. 更新資料庫，讓 UI 可以顯示
        let newAdmins = [...appData.admins];
        let newScopedAdmins = { ...(appData.scopedAdmins || {}) };
        let newAdminNames = { ...(appData.adminNames || {}) }; 

        if (type === 'global') {
            if (!newAdmins.includes(email)) newAdmins.push(email);
            delete newScopedAdmins[email]; 
        } else {
            if (!scopeValue) {
                btn.innerHTML = originalText; btn.disabled = false;
                return alert('請選擇要指定的縣市或賽事！');
            }
            if (newAdmins.includes(email)) {
                if(!confirm(`「${email}」目前為「全站管理員」，確定要修改為「局部管理員」嗎？`)) {
                    btn.innerHTML = originalText; btn.disabled = false; return;
                }
                newAdmins = newAdmins.filter(e => e !== email);
            }
            newScopedAdmins[email] = { type: type, value: scopeValue };
        }

        if (adminName) {
            newAdminNames[email] = adminName;
        } else if (nameInput && nameInput.value === '') {
            delete newAdminNames[email];
        }

        await setDoc(getSettingsDoc(), { 
            admins: newAdmins, 
            scopedAdmins: newScopedAdmins,
            adminNames: newAdminNames 
        }, { merge: true });
        
        input.value = '';
        if (nameInput) nameInput.value = ''; 
        document.getElementById('new-admin-scope-type').value = 'global';
        window.toggleAdminScopeUI(); 
        
        alert(`成功儲存 ${email} 的權限設定！`);
    } catch(e) {
        console.error(e);
        alert(`儲存失敗：${e.message || "請檢查網路連線或權限。"}`);
    } finally {
        btn.innerHTML = '<i class="fas fa-plus mr-1"></i> 新增權限';
        btn.disabled = false;
    }
};

window.loadAdminForEdit = (email, type, value) => {
    const nameInput = document.getElementById('new-admin-name'); 
    const emailInput = document.getElementById('new-admin-email');
    const typeSelect = document.getElementById('new-admin-scope-type');
    
    if (nameInput) {
        nameInput.value = (appData.adminNames && appData.adminNames[email]) ? appData.adminNames[email] : '';
    }

    emailInput.value = email;
    typeSelect.value = type;
    window.toggleAdminScopeUI();
    
    if (type !== 'global') {
        const valueSelect = document.getElementById('new-admin-scope-value');
        valueSelect.value = value;
    }
    
    emailInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    emailInput.classList.add('ring-4', 'ring-purple-200');
    if (nameInput) nameInput.classList.add('ring-4', 'ring-purple-200');
    
    setTimeout(() => {
        emailInput.classList.remove('ring-4', 'ring-purple-200');
        if (nameInput) nameInput.classList.remove('ring-4', 'ring-purple-200');
    }, 1000);
    
    document.getElementById('btn-submit-admin').innerHTML = '<i class="fas fa-save mr-1"></i> 修改權限';
};

window.removeAdmin = async (email, roleType) => {
    if(!confirm(`您確定要徹底撤銷 ${email} 的管理員權限嗎？`)) return;
    try {
        const idToken = await auth.currentUser.getIdToken(true);

        await setAdminClaims({
            targetEmail: email,
            role: 'remove',
            adminToken: idToken
        });

        let newAdmins = [...appData.admins].filter(e => e !== email);
        
        let newScopedAdmins = { ...(appData.scopedAdmins || {}) };
        if (newScopedAdmins[email]) {
            newScopedAdmins[email] = deleteField();
        }
        
        let newAdminNames = { ...(appData.adminNames || {}) }; 
        if (newAdminNames[email]) {
            newAdminNames[email] = deleteField();
        }

        await setDoc(getSettingsDoc(), { 
            admins: newAdmins, 
            scopedAdmins: newScopedAdmins,
            adminNames: newAdminNames 
        }, { merge: true });
        
        alert(`已成功徹底撤銷 ${email} 的權限。`);
    } catch(e) {
        console.error(e);
        alert(`移除失敗：${e.message || "請確認網路狀態。"}`);
    }
};