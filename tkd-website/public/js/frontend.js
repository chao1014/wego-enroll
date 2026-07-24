import { addDoc, doc, updateDoc, deleteDoc, setDoc, getDocs, query, where, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "firebase/storage";
import { db, getDbPath, appIdStr, analytics, functions, storage } from "./firebase.js";
import { appData, currentUser, currentUserRole, selectedTournament, setSelectedTournament, recordToDelete, setRecordToDelete, subscribe, emit } from "./store.js";
import { verifyAuthBeforeAction } from "./auth.js";
import { logEvent } from "firebase/analytics";
import { getLang, currentLang, t } from "./i18n.js";

// ==========================================
// 1. 通用輔助函式
// ==========================================

// XSS 消毒過濾器 (純文字專用)
export function sanitizeHTML(str) {
    if (!str) return '';
    return str.toString().replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// ==========================================
// 報名 Function 預熱
// ==========================================
let registrationWarmupPromise = null;
let lastRegistrationWarmupAt = 0;
const REGISTRATION_WARMUP_COOLDOWN = 4 * 60 * 1000;

window.warmUpRegistrationService = () => {
    if (!currentUser || !selectedTournament) return Promise.resolve(false);

    const now = Date.now();
    if (registrationWarmupPromise) return registrationWarmupPromise;
    if (now - lastRegistrationWarmupAt < REGISTRATION_WARMUP_COOLDOWN) {
        return Promise.resolve(true);
    }

    const saveRegistration = httpsCallable(functions, 'saveRegistration');
    registrationWarmupPromise = saveRegistration({
        action: 'warmup',
        appId: appIdStr
    })
        .then(() => {
            lastRegistrationWarmupAt = Date.now();
            return true;
        })
        .catch((error) => {
            // 暖機失敗不阻擋使用者填表或正式送出，提交時仍會照正常流程重試。
            console.warn('報名服務背景暖機未完成：', error?.code || error?.message || error);
            return false;
        })
        .finally(() => {
            registrationWarmupPromise = null;
        });

    return registrationWarmupPromise;
};

// ✨ 新增：URL 安全過濾器 (防禦 javascript: 偽協議注入)
export function sanitizeURL(url) {
    if (!url) return '#';
    const strUrl = String(url).trim();
    // 僅允許 http://, https://, mailto:, tel: 開頭的網址
    const safePattern = /^(https?|mailto|tel):/i;
    if (safePattern.test(strUrl)) {
        return strUrl;
    }
    // 若不符合安全協議，強制回傳 #
    return '#';
}

// 確保其他未直接 import 此模組的檔案也能安全呼叫
window.sanitizeHTML = sanitizeHTML;
window.sanitizeURL = sanitizeURL;

// ==========================================
// 🌟 全局 Toast 提示工具 (自動消失)
// ==========================================
window.showToast = (message, type = 'success') => {
    const toast = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-600' : 'bg-red-600';
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';

    // ✨ 加入了 w-max 與 whitespace-nowrap 強制撐開且不換行
    toast.className = `fixed top-20 left-1/2 transform -translate-x-1/2 ${bgColor} text-white px-6 py-3 rounded-2xl shadow-2xl font-black text-sm z-[200] flex items-center gap-3 transition-all duration-300 -translate-y-4 opacity-0 pointer-events-none w-max whitespace-nowrap`;
    toast.innerHTML = `<i class="fas ${icon} text-lg"></i><span>${message}</span>`;

    document.body.appendChild(toast);

    // 觸發進入動畫
    requestAnimationFrame(() => {
        toast.classList.remove('-translate-y-4', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    // 3 秒後觸發離開動畫並移除節點
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('-translate-y-4', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// ==========================================
// 🌟 報名總表：手風琴收合控制邏輯
// ==========================================
window.expandedUnits = window.expandedUnits || new Set();

window.toggleUnitCard = (safeUnitId, encodedUnit) => {
    const content = document.getElementById(`content-${safeUnitId}`);
    const icon = document.getElementById(`icon-${safeUnitId}`);
    const unitName = decodeURIComponent(encodedUnit); // 解碼還原單位名稱

    if (!content || !icon) return;

    if (content.classList.contains('hidden')) {
        // 展開
        content.classList.remove('hidden');
        icon.classList.add('rotate-180');
        window.expandedUnits.add(unitName);
    } else {
        // 收合
        content.classList.add('hidden');
        icon.classList.remove('rotate-180');
        window.expandedUnits.delete(unitName);
    }
};

// ==========================================
// 🌟 全局 Custom Confirm 提示工具 (Promise based)
// ==========================================
window.showCustomConfirm = (title, htmlMessage, confirmText = '確定', cancelText = '取消') => {
    return new Promise((resolve) => {
        const modal = document.getElementById('customConfirmModal');
        if (!modal) {
            console.error('找不到 customConfirmModal 元素');
            resolve(false);
            return;
        }

        document.getElementById('customConfirmTitle').innerText = title;
        document.getElementById('customConfirmMessage').innerHTML = htmlMessage;

        const btnOk = document.getElementById('btnCustomConfirmOk');
        const btnCancel = document.getElementById('btnCustomConfirmCancel');

        btnOk.innerText = confirmText;
        btnCancel.innerText = cancelText;

        // 顯示 Modal
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            modal.firstElementChild.classList.remove('scale-95');
            modal.firstElementChild.classList.add('scale-100');
        }, 10);

        // 關閉 Modal 並回傳結果
        const closeModal = (result) => {
            modal.firstElementChild.classList.remove('scale-100');
            modal.firstElementChild.classList.add('scale-95');
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                // 清除事件監聽器，避免下一次呼叫時重複觸發
                btnOk.onclick = null;
                btnCancel.onclick = null;
                resolve(result);
            }, 300);
        };

        btnOk.onclick = () => closeModal(true);
        btnCancel.onclick = () => closeModal(false);
    });
};

// 選擇賽事並跳轉至規程頁
window.selectTournament = (id) => {
    const tour = appData.tournaments.find(t => t.id === id);
    if (!tour) return; // 🛡️ 安全檢查：找不到賽事不執行

    setSelectedTournament(tour);

    // ✨ 修正 4：從首頁點進來，強制清除任何代加/修改的殘留狀態
    const form = document.getElementById('registrationForm');
    if (form) form.reset();
    document.getElementById('editRecordId').value = '';
    const overrideUidEl = document.getElementById('overrideUid');
    const overrideEmailEl = document.getElementById('overrideEmail');
    if (overrideUidEl) overrideUidEl.value = '';
    if (overrideEmailEl) overrideEmailEl.value = '';
    const playerContainer = document.getElementById('dynamic-players-container');
    if (playerContainer) playerContainer.innerHTML = '';

    document.getElementById('btn-cancel-edit')?.classList.add('hidden');
    document.getElementById('edit-badge')?.classList.add('hidden');

    if (analytics) {
        logEvent(analytics, 'begin_registration', {
            tournament_id: tour.id,
            tournament_name: tour.name
        });
        logEvent(analytics, 'page_view', { page_title: `賽事規程: ${tour.name}` });
    }

    // 顯示導覽列按鈕
    document.getElementById('nav-info')?.classList.remove('hidden');
    document.getElementById('nav-info-mobile')?.classList.remove('hidden');

    // 重設隱私權勾選狀態
    const privacyCheckbox = document.getElementById('privacy-consent');
    if (privacyCheckbox) {
        privacyCheckbox.checked = false;
        if (window.toggleRegisterBtn) window.toggleRegisterBtn();
    }

    if (window.updateRegisterNavVisibility) window.updateRegisterNavVisibility();

    // 轉跳至規程頁
    if (window.navigate) window.navigate('info', true, true);
};

// ==========================================
// 🌟 一鍵帶入歷史隊職員資料邏輯
// ==========================================
window.openHistoryAutofillModal = async () => { // ✨ 改為 async
    const modal = document.getElementById('historyAutofillModal');
    const listContainer = document.getElementById('historyAutofillList');
    const titleEl = modal.querySelector('h3'); // 抓取標題元素以便動態修改

    // 1. 先開啟視窗並顯示載入中動畫 (因為如果去雲端抓資料會有一點延遲)
    listContainer.innerHTML = '<div class="text-center py-10"><i class="fas fa-spinner fa-spin text-tkdBlue text-3xl mb-3"></i><div class="text-gray-500 font-bold text-sm">正在尋找歷史名單...</div></div>';
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.firstElementChild.classList.remove('scale-95');
        modal.firstElementChild.classList.add('scale-100');
    }, 10);

    let profiles = [];

    // 2. 判斷目前是否處於「管理員代為操作」模式
    const overrideUidEl = document.getElementById('overrideUid');
    const overrideEmailEl = document.getElementById('overrideEmail');
    const targetUid = (overrideUidEl && overrideUidEl.value) ? overrideUidEl.value : currentUser?.uid;
    const targetEmail = (overrideEmailEl && overrideEmailEl.value) ? overrideEmailEl.value : '';

    if (targetUid !== currentUser?.uid) {
        // ✨ 代加/修改模式：去資料庫抓取「目標對象」的專屬名單
        titleEl.innerHTML = `<i class="fas fa-history text-tkdBlue mr-2"></i> 選擇 <span class="text-tkdRed ml-1 mr-1">${targetEmail.split('@')[0]}</span> 的歷史資料`;

        try {
            const q = query(getDbPath('team_profiles'), where("userId", "==", targetUid));
            const snap = await getDocs(q);
            snap.forEach(d => profiles.push({ id: d.id, ...d.data() }));

            // 依據最後更新時間降冪排序
            profiles.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        } catch (e) {
            console.error("讀取代加名單失敗:", e);
            window.showToast("無法取得該對象的歷史名單！", "error");
            window.closeHistoryAutofillModal();
            return;
        }
    } else {
        // ✨ 一般模式：直接使用前端快取的自己的名單
        titleEl.innerHTML = `<i class="fas fa-history text-tkdBlue mr-2"></i> 選擇歷史隊職員資料`;
        profiles = appData.teamProfiles || [];
    }

    // 3. 渲染名單畫面
    listContainer.innerHTML = '';

    if (profiles.length === 0) {
        listContainer.innerHTML = '<div class="text-center py-10 text-gray-400 font-bold"><i class="fas fa-folder-open text-4xl mb-3 text-gray-200 block"></i>該帳號目前沒有任何常用名單紀錄喔！</div>';
        return;
    }

    profiles.forEach(p => {
        const card = document.createElement('div');
        card.className = "bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-tkdBlue p-4 rounded-2xl cursor-pointer transition-all duration-200 group active:scale-95 shadow-sm";
        card.onclick = () => window.applyHistoryProfile(p);

        const allCoaches = [p.coach1, p.coach2, p.coach3].filter(c => c).join('、') || '無';
        const displayUnit = p.subTeam ? `${p.unit}${p.subTeam}` : p.unit;
        const leaderInfo = p.leader || '無';
        const managerInfo = p.manager || '無';

        card.innerHTML = `
            <div class="font-black text-gray-800 text-base mb-2 group-hover:text-tkdBlue transition-colors">
                <i class="fas fa-shield-alt text-gray-400 group-hover:text-tkdBlue mr-1"></i> ${sanitizeHTML(displayUnit)}
            </div>
            <div class="text-xs text-gray-500 font-bold space-y-1.5 ml-1">
                <div><i class="fas fa-phone mr-1.5 w-3 text-center"></i>${sanitizeHTML(p.phone) || '未提供'}</div>
                <div class="line-clamp-1"><i class="fas fa-user-shield mr-1.5 w-3 text-center"></i>領隊/管理: ${sanitizeHTML(leaderInfo)} / ${sanitizeHTML(managerInfo)}</div>
                <div class="line-clamp-1"><i class="fas fa-user-tie mr-1.5 w-3 text-center"></i>教練: ${sanitizeHTML(allCoaches)}</div>
            </div>
        `;
        listContainer.appendChild(card);
    });
};

window.closeHistoryAutofillModal = () => {
    const modal = document.getElementById('historyAutofillModal');
    modal.firstElementChild.classList.remove('scale-100');
    modal.firstElementChild.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

// ✨ 新增：前往管理名單的轉跳邏輯與防呆
window.navigateToManageProfiles = () => {
    // 防呆：檢查是否已經填寫了單位或選手，提醒會遺失進度
    const unitInput = document.getElementById('unit');
    const playerNameInput = document.querySelector('.dynamic-player-name');

    if ((unitInput && unitInput.value.trim()) || (playerNameInput && playerNameInput.value.trim())) {
        if (!confirm('前往管理中心將會遺失您目前填寫的報名表進度，確定要離開嗎？')) {
            return;
        }
    }

    window.closeHistoryAutofillModal();
    if (window.navigate) window.navigate('my-records');

    // 延遲執行，確保切換頁面後，自動展開「常用隊職員名單」區塊並平滑滾動過去
    setTimeout(() => {
        const profilesBody = document.getElementById('teamProfilesBody');
        const profilesIcon = document.getElementById('teamProfilesIcon');

        // 1. 自動展開名單區塊
        if (profilesBody && profilesBody.classList.contains('hidden')) {
            profilesBody.classList.remove('hidden');
            if (profilesIcon) profilesIcon.classList.add('rotate-180');
        }

        // 2. ✨ 修正：直接滾動到頁面最頂部，避免被導覽列(Navbar)蓋住按鈕
        window.scrollTo({ top: 0, behavior: 'smooth' });

    }, 300);
};

window.goToMyRecordsForUpload = () => {
    if (!currentUser) {
        window.showToast("👉 請先登入系統後，即可至「我的報名」列印總表與上傳單據！", "info");
        if (typeof window.switchAuthModalTab === 'function') window.switchAuthModalTab('login');
        const authModal = document.getElementById('authModal');
        if (authModal) authModal.classList.remove('hidden');
        return;
    }
    if (typeof window.navigate === 'function') {
        window.navigate('my-records');
    }
};

window.applyHistoryProfile = (p) => {
    document.getElementById('unit').value = p.unit;
    document.getElementById('subTeam').value = p.subTeam || '';
    const phoneInput = document.getElementById('phone');
    phoneInput.value = p.phone;
    phoneInput.dispatchEvent(new Event('input'));
    document.getElementById('leader').value = p.leader;
    document.getElementById('manager').value = p.manager;
    document.getElementById('coach1').value = p.coach1;

    const limit = selectedTournament ? (selectedTournament.coachLimit || 3) : 3;
    const coach2Input = document.getElementById('coach2');
    const coach3Input = document.getElementById('coach3');

    // 依據名額限制決定是否帶入資料，如果不允許則強制給空值，避免幽靈資料
    if (coach2Input) coach2Input.value = limit >= 2 ? (p.coach2 || '') : '';
    if (coach3Input) coach3Input.value = limit >= 3 ? (p.coach3 || '') : '';

    if (window.validateUnit) window.validateUnit();

    window.closeHistoryAutofillModal();
    window.showToast('✅ 隊職員資料已成功帶入！');
};

// ✨ 渲染常用名單管理介面
window.renderTeamProfiles = () => {
    const container = document.getElementById('teamProfilesContainer');
    const emptyMsg = document.getElementById('teamProfilesEmpty');
    if (!container) return;

    const profiles = appData.teamProfiles || [];
    container.innerHTML = '';

    if (profiles.length === 0) {
        emptyMsg.classList.remove('hidden');
        return;
    }
    emptyMsg.classList.add('hidden');

    profiles.forEach(p => {
        const displayUnit = p.subTeam ? `${p.unit}${p.subTeam}` : p.unit;
        const allCoaches = [p.coach1, p.coach2, p.coach3].filter(c => c).join('、') || '無';

        container.innerHTML += `
            <div class="bg-white border border-gray-200 p-4 rounded-2xl shadow-sm flex flex-col justify-between">
                <div>
                    <h4 class="font-black text-tkdBlue text-base mb-2 border-b border-gray-50 pb-2 truncate"><i class="fas fa-shield-alt mr-2 text-gray-400"></i>${sanitizeHTML(displayUnit)}</h4>
                    <div class="text-xs text-gray-600 font-bold space-y-1.5 mb-4">
                        <div class="truncate"><span class="text-gray-400 w-10 inline-block">電話</span> ${sanitizeHTML(p.phone)}</div>
                        <div class="truncate"><span class="text-gray-400 w-10 inline-block">領隊</span> ${sanitizeHTML(p.leader) || '-'}</div>
                        <div class="truncate"><span class="text-gray-400 w-10 inline-block">管理</span> ${sanitizeHTML(p.manager) || '-'}</div>
                        <div class="truncate line-clamp-1"><span class="text-gray-400 w-10 inline-block">教練</span> ${sanitizeHTML(allCoaches)}</div>
                    </div>
                </div>
                <div class="flex gap-2 border-t border-gray-50 pt-3">
                    <button onclick="window.openTeamProfileModal('${p.id}')" class="flex-1 bg-blue-50 text-tkdBlue px-3 py-1.5 rounded-lg text-[11px] font-bold hover:bg-blue-100 transition-colors shadow-sm"><i class="fas fa-edit mr-1"></i> 編輯</button>
                    <button onclick="window.promptDeleteTeamProfile('${p.id}')" class="flex-1 bg-red-50 text-red-500 px-3 py-1.5 rounded-lg text-[11px] font-bold hover:bg-red-100 transition-colors shadow-sm"><i class="fas fa-trash-alt mr-1"></i> 刪除</button>
                </div>
            </div>
        `;
    });
};

// ✨ 常用名單的收合開關
window.toggleTeamProfiles = () => {
    const body = document.getElementById('teamProfilesBody');
    const icon = document.getElementById('teamProfilesIcon');
    if (!body || !icon) return;

    body.classList.toggle('hidden');
    if (body.classList.contains('hidden')) {
        icon.classList.add('rotate-180');
    } else {
        icon.classList.remove('rotate-180');
    }
};

window.openTeamProfileModal = (id = null) => {
    const modal = document.getElementById('teamProfileModal');
    const title = document.getElementById('teamProfileModalTitle');
    const form = document.getElementById('teamProfileForm');
    form.reset();

    // ✨ 強化判斷：確保傳入的 id 是一串文字，而不是滑鼠點擊事件的物件
    if (typeof id === 'string' && id.trim() !== '') {
        const p = appData.teamProfiles.find(x => x.id === id);
        if (p) {
            title.innerHTML = '<i class="fas fa-edit text-tkdBlue mr-2"></i> 編輯常用名單';
            document.getElementById('tp-id').value = p.id;
            document.getElementById('tp-unit').value = p.unit;
            document.getElementById('tp-subTeam').value = p.subTeam || '';
            const tpPhone = document.getElementById('tp-phone');
            tpPhone.value = p.phone || '';
            tpPhone.dispatchEvent(new Event('input'));
            document.getElementById('tp-leader').value = p.leader || '';
            document.getElementById('tp-manager').value = p.manager || '';
            document.getElementById('tp-coach1').value = p.coach1 || '';
            document.getElementById('tp-coach2').value = p.coach2 || '';
            document.getElementById('tp-coach3').value = p.coach3 || '';
        }
    } else {
        // 沒有正確的 id，代表是全新的名單
        title.innerHTML = '<i class="fas fa-address-book text-tkdBlue mr-2"></i> 新增常用名單';
        document.getElementById('tp-id').value = '';
    }

    modal.classList.remove('hidden');
    setTimeout(() => { modal.firstElementChild.classList.replace('scale-95', 'scale-100'); }, 10);
};

window.closeTeamProfileModal = () => {
    const modal = document.getElementById('teamProfileModal');
    modal.firstElementChild.classList.replace('scale-100', 'scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

window.saveTeamProfile = async () => {
    const unit = document.getElementById('tp-unit').value.trim();
    const phone = document.getElementById('tp-phone').value.trim();
    const coach1 = document.getElementById('tp-coach1').value.trim();
    if (!unit || !phone || !coach1) return window.showToast('單位、電話與教練 1 為必填欄位！', 'error');

    // ✨ 新增防呆：檢查常用名單中的教練填寫順序
    const tpCoach2El = document.getElementById('tp-coach2');
    const tpCoach3El = document.getElementById('tp-coach3');
    const coach2 = tpCoach2El ? tpCoach2El.value.trim() : '';
    const coach3 = tpCoach3El ? tpCoach3El.value.trim() : '';

    if (coach3 && !coach2) {
        window.showToast('填寫教練欄位時不能跳著填寫！請先填寫教練 2，再填寫教練 3。', 'error');
        if (tpCoach2El) tpCoach2El.focus();
        return;
    }

    const id = document.getElementById('tp-id').value;
    const profileData = {
        userId: currentUser.uid,
        unit: unit,
        subTeam: document.getElementById('tp-subTeam').value.trim(),
        phone: phone,
        leader: document.getElementById('tp-leader').value.trim(),
        manager: document.getElementById('tp-manager').value.trim(),
        coach1: coach1,
        coach2: coach2,
        coach3: coach3,
        updatedAt: Date.now()
    };

    try {
        if (id) {
            await setDoc(doc(db, 'artifacts', appIdStr, 'public', 'data', 'team_profiles', id), profileData, { merge: true });
            window.showToast('名單已更新！');
        } else {
            await addDoc(getDbPath('team_profiles'), profileData);
            window.showToast('名單建立成功！');
        }
        window.closeTeamProfileModal();
    } catch (e) {
        window.showToast('儲存失敗：' + e.message, 'error');
    }
};

window.promptDeleteTeamProfile = async (id) => {
    if (confirm('確定要刪除這筆常用名單嗎？')) {
        try {
            await deleteDoc(doc(db, 'artifacts', appIdStr, 'public', 'data', 'team_profiles', id));
            window.showToast('名單已刪除！');
        } catch (e) {
            window.showToast('刪除失敗：' + e.message, 'error');
        }
    }
};

// 點擊管理名單後的轉跳邏輯 (直接前往報名表的紀錄區)
window.manageTournamentRegistrations = (id) => {
    const tour = appData.tournaments.find(t => t.id === id);
    if (!tour) return;

    // 1. 設定選定的賽事
    setSelectedTournament(tour);

    // ✨ 修正 3：既然是管理「自己」的報名，強制清除任何代加/修改的殘留狀態
    const form = document.getElementById('registrationForm');
    if (form) form.reset();
    document.getElementById('editRecordId').value = '';
    const overrideUidEl = document.getElementById('overrideUid');
    const overrideEmailEl = document.getElementById('overrideEmail');
    if (overrideUidEl) overrideUidEl.value = '';
    if (overrideEmailEl) overrideEmailEl.value = '';
    const playerContainer = document.getElementById('dynamic-players-container');
    if (playerContainer) playerContainer.innerHTML = '';

    // 隱藏編輯按鈕
    document.getElementById('btn-cancel-edit')?.classList.add('hidden');
    document.getElementById('edit-badge')?.classList.add('hidden');

    // 2. 轉跳到報名頁面 (該頁面下方即是「您的報名紀錄與總表」)
    if (window.navigate) window.navigate('register');

    // 3. 強制觸發一次表格渲染，確保資料出現
    setTimeout(() => {
        if (window.renderUserTables) window.renderUserTables();
    }, 100);
};

// 渲染「我的報名」中控台頁面
window.renderMyRecordsPage = () => {
    const container = document.getElementById('myRecordsTournamentsList');
    if (!container) return;

    const myData = appData.registrations.filter(r =>
        r.userId === currentUser?.uid
    );

    const groupedByTour = {};

    myData.forEach(r => {
        const tourObj = appData.tournaments.find(t => t.id === r.tournamentId);
        // ✨ 如果賽事在後台已被設定為隱藏 (isVisible === false) 或被刪除，同步隱藏不顯示於「我的報名」
        if (!tourObj || tourObj.isVisible === false) return;

        if (!groupedByTour[r.tournamentId]) {
            groupedByTour[r.tournamentId] = { name: getLang(tourObj, 'name'), regs: [] };
        }
        groupedByTour[r.tournamentId].regs.push(r);
    });

    container.innerHTML = '';
    const tourIds = Object.keys(groupedByTour);

    if (tourIds.length === 0) {
        container.innerHTML = `<div class="text-center py-20 text-gray-400"><i class="fas fa-folder-open text-5xl mb-4"></i><p class="font-bold">${t('records.empty')}</p></div>`;
        return;
    }

    // ✨ 統計全域各單位的報名完成度進度與審核指標
    let totalUnits = 0;
    let incompleteCount = 0;
    let rejectedCount = 0;
    let pendingCount = 0;
    let verifiedCount = 0;
    let totalProgressScore = 0;

    tourIds.forEach(tId => {
        const data = groupedByTour[tId];
        const unitKeysSet = new Set();
        data.regs.forEach(r => {
            const st = r.subTeam || '';
            unitKeysSet.add(st ? `${r.unit}@@${st}` : r.unit);
        });

        unitKeysSet.forEach(key => {
            totalUnits++;
            const parts = key.split('@@');
            const u = parts[0];
            const st = parts[1] || '';
            const sub = (appData.myUnitSubmissions || []).find(s =>
                s.tournamentId === tId && s.unit === u && s.subTeam === st
            );
            const hasSummary = !!(sub && sub.summaryFormUrl);
            const hasRemittance = !!(sub && sub.remittanceUrl);
            const score = 1 + (hasSummary ? 1 : 0) + (hasRemittance ? 1 : 0) + (sub?.status === 'verified' ? 1 : 0);
            totalProgressScore += score;

            if (sub && sub.status === 'rejected') {
                rejectedCount++;
            } else if (!hasSummary || !hasRemittance) {
                incompleteCount++;
            } else if (sub && sub.status === 'verified') {
                verifiedCount++;
            } else {
                pendingCount++;
            }
        });
    });

    const overallPct = totalUnits > 0 ? Math.round((totalProgressScore / (totalUnits * 4)) * 100) : 0;

    // ✨ 建立頂部位置 A：整體報名完成度進度儀表板 (Dashboard Banner)
    const dashboardBanner = document.createElement('div');
    dashboardBanner.className = "bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 rounded-3xl shadow-xl p-6 sm:p-7 mb-8 text-white border border-gray-700/60";
    dashboardBanner.innerHTML = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5 border-b border-gray-700/60 pb-5">
            <div>
                <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-tkdBlue/20 text-blue-400 border border-blue-500/30 text-xs font-black mb-2">
                    <i class="fas fa-chart-line"></i> 報名送件進度中控台
                </div>
                <h2 class="text-xl sm:text-2xl font-black tracking-wide">整體報名完成度儀表板</h2>
                <p class="text-xs text-gray-300 mt-1 font-black">即時掌握您管理的 ${totalUnits} 支參賽隊伍單據與主辦單位審核進度</p>
            </div>
            <div class="flex items-center gap-3 bg-gray-800/80 px-4 py-3 rounded-2xl border border-gray-700/80">
                <div class="text-right">
                    <div class="text-[10px] text-gray-300 font-black uppercase">總體送件進度</div>
                    <div class="text-2xl font-black text-blue-400">${overallPct}%</div>
                </div>
                <div class="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 text-xl shrink-0">
                    <i class="fas fa-tasks"></i>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div class="bg-gray-800/70 border border-gray-700/60 rounded-2xl p-3.5 flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center text-lg shrink-0">
                    <i class="fas fa-file-upload"></i>
                </div>
                <div>
                    <div class="text-[11px] text-gray-300 font-black">缺件待傳</div>
                    <div class="text-lg font-black text-amber-300">${incompleteCount} 隊</div>
                </div>
            </div>
            <div class="bg-gray-800/70 border border-gray-700/60 rounded-2xl p-3.5 flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center text-lg shrink-0">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <div>
                    <div class="text-[11px] text-gray-300 font-black">遭退件待修正</div>
                    <div class="text-lg font-black text-red-400">${rejectedCount} 隊</div>
                </div>
            </div>
            <div class="bg-gray-800/70 border border-gray-700/60 rounded-2xl p-3.5 flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center text-lg shrink-0">
                    <i class="fas fa-hourglass-half"></i>
                </div>
                <div>
                    <div class="text-[11px] text-gray-300 font-black">官方審核中</div>
                    <div class="text-lg font-black text-blue-300">${pendingCount} 隊</div>
                </div>
            </div>
            <div class="bg-gray-800/70 border border-gray-700/60 rounded-2xl p-3.5 flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-green-500/15 text-green-400 flex items-center justify-center text-lg shrink-0">
                    <i class="fas fa-check-circle"></i>
                </div>
                <div>
                    <div class="text-[11px] text-gray-300 font-black">審核確認生效</div>
                    <div class="text-lg font-black text-green-400">${verifiedCount} 隊</div>
                </div>
            </div>
        </div>
    `;
    container.appendChild(dashboardBanner);

    tourIds.forEach(tId => {
        const data = groupedByTour[tId];
        const card = document.createElement('div');
        card.className = "bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-6";

        const countInfo = t('records.registered-count').replace('{n}', data.regs.length);
        const manageBtnText = t('records.manage-btn');
        const printSectionTitle = t('records.print-section-title');

        card.innerHTML = `
            <div class="bg-gray-800 p-6 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h3 class="text-lg font-black tracking-wide">${sanitizeHTML(data.name)}</h3>
                    <p class="text-xs text-gray-400 mt-1 font-bold">${countInfo}</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="window.manageTournamentRegistrations('${tId}')" class="bg-tkdBlue hover:bg-blue-600 px-6 py-2.5 rounded-xl text-sm font-bold transition-colors shadow-lg">
                        <i class="fas fa-tasks mr-2"></i> ${manageBtnText}
                    </button>
                </div>
            </div>
            
            <div class="p-5 bg-gray-50/50 border-t border-gray-100">
                <p class="text-[11px] text-gray-500 font-bold uppercase tracking-widest mb-3 flex items-center">
                    <i class="fas fa-print mr-2 text-gray-400"></i> ${printSectionTitle}
                </p>
                <div id="units-list-${tId}" class="grid grid-cols-1 sm:grid-cols-2 gap-3"></div>
            </div>
        `;
        container.appendChild(card);

        const unitsList = card.querySelector(`#units-list-${tId}`);
        const unitGroups = {};
        data.regs.forEach(r => {
            const st = r.subTeam || '';
            const key = st ? `${r.unit}@@${st}` : r.unit;
            if (!unitGroups[key]) unitGroups[key] = { unit: r.unit, subTeam: st, count: 0 };
            unitGroups[key].count++;
        });

        Object.values(unitGroups).sort((a, b) => a.unit.localeCompare(b.unit, 'zh-TW')).forEach(g => {
            const unitCountInfo = t('records.unit-regs-count').replace('{n}', g.count);
            const printBtnText = t('records.print-btn');
            const displayUnit = g.subTeam ? `${g.unit} (${g.subTeam})` : g.unit;

            const sub = (appData.myUnitSubmissions || []).find(s =>
                s.tournamentId === tId && s.unit === g.unit && s.subTeam === g.subTeam
            );

            let statusBadge = `<span class="inline-flex items-center justify-center h-5 px-2 bg-gray-200 text-gray-700 border border-gray-300 rounded-md text-[10px] font-black shrink-0 leading-none">未上傳</span>`;
            if (sub) {
                if (sub.status === 'pending') {
                    statusBadge = `<span class="inline-flex items-center justify-center h-5 px-2 bg-orange-50 text-orange-600 border border-orange-100 rounded-md text-[10px] font-bold shrink-0 leading-none">待審核</span>`;
                } else if (sub.status === 'verified') {
                    statusBadge = `<span class="inline-flex items-center justify-center h-5 px-2 bg-green-50 text-green-600 border border-green-100 rounded-md text-[10px] font-bold shrink-0 leading-none">已確認</span>`;
                } else if (sub.status === 'rejected') {
                    statusBadge = `<span class="inline-flex items-center justify-center h-5 px-2 bg-red-50 text-red-600 border border-red-100 rounded-md text-[10px] font-bold shrink-0 leading-none">資料錯誤</span>`;
                }
            }

            let rejectedReasonHtml = '';
            if (sub && sub.status === 'rejected' && sub.adminNotes) {
                rejectedReasonHtml = `
                    <div class="bg-red-50 text-red-600 text-[11px] font-bold p-2.5 rounded-xl flex items-start gap-1.5 mt-2 border border-red-100/50 leading-snug">
                        <i class="fas fa-exclamation-circle mt-0.5 shrink-0 text-red-500"></i>
                        <div>
                            <span class="font-black">錯誤原因：</span>
                            <span class="font-medium">${sanitizeHTML(sub.adminNotes)}</span>
                        </div>
                    </div>
                `;
            }

            const isSummaryUploaded = !!(sub && sub.summaryFormUrl);
            const isRemittanceUploaded = !!(sub && sub.remittanceUrl);

            const summaryBtnClass = isSummaryUploaded
                ? "bg-blue-50 hover:bg-blue-100 border-blue-200 text-tkdBlue font-bold w-full py-2 rounded-xl text-xs transition-all shadow-sm border flex items-center justify-center gap-1.5"
                : "bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600 hover:text-gray-800 font-bold w-full py-2 rounded-xl text-xs transition-all border flex items-center justify-center gap-1.5";

            const remittanceBtnClass = isRemittanceUploaded
                ? "bg-green-50 hover:bg-green-100 border-green-200 text-green-600 font-bold w-full py-2 rounded-xl text-xs transition-all shadow-sm border flex items-center justify-center gap-1.5"
                : "bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600 hover:text-gray-800 font-bold w-full py-2 rounded-xl text-xs transition-all border flex items-center justify-center gap-1.5";

            const summaryBtnText = isSummaryUploaded ? "總表 ✓" : "上傳總表";
            const remittanceBtnText = isRemittanceUploaded ? "匯款 ✓" : "上傳匯款";

            // ✨ 計算該單位的 4 階段流程完成百分比
            const stepScore = 1 + (isSummaryUploaded ? 1 : 0) + (isRemittanceUploaded ? 1 : 0) + (sub?.status === 'verified' ? 1 : 0);
            const stepPct = stepScore * 25;

            // ✨ 智慧下一步行動指引 (Smart CTA)
            let smartCtaHtml = '';
            if (sub && sub.status === 'rejected') {
                smartCtaHtml = `
                    <button onclick="window.openUploadSummaryModal('${tId}', '${sanitizeHTML(g.unit)}', '${sanitizeHTML(g.subTeam)}')" class="w-full mt-2.5 py-2.5 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-95">
                        <i class="fas fa-exclamation-triangle"></i><span>查看退回原因並重新傳送單據</span>
                    </button>
                `;
            } else if (!isSummaryUploaded) {
                smartCtaHtml = `
                    <button onclick="window.openUploadSummaryModal('${tId}', '${sanitizeHTML(g.unit)}', '${sanitizeHTML(g.subTeam)}')" class="w-full mt-2.5 py-2.5 px-3 rounded-xl bg-tkdBlue hover:bg-blue-700 text-white font-black text-xs shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-95">
                        <i class="fas fa-file-upload"></i><span>前往上傳簽名後的報名總表完成送件</span>
                    </button>
                `;
            } else if (!isRemittanceUploaded) {
                smartCtaHtml = `
                    <button onclick="window.openUploadRemittanceModal('${tId}', '${sanitizeHTML(g.unit)}', '${sanitizeHTML(g.subTeam)}')" class="w-full mt-2.5 py-2.5 px-3 rounded-xl bg-tkdBlue hover:bg-blue-700 text-white font-black text-xs shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-95">
                        <i class="fas fa-receipt"></i><span>前往上傳匯款證明完成送件</span>
                    </button>
                `;
            } else if (sub && sub.status === 'verified') {
                smartCtaHtml = `
                    <div class="w-full mt-2.5 py-2 px-3 rounded-xl bg-green-50 text-green-700 border border-green-200/60 font-black text-xs flex items-center justify-center gap-1.5">
                        <i class="fas fa-check-circle"></i><span>單據齊全，主辦單位審核通過生效</span>
                    </div>
                `;
            } else {
                smartCtaHtml = `
                    <div class="w-full mt-2.5 py-2 px-3 rounded-xl bg-blue-50 text-tkdBlue border border-blue-200/60 font-black text-xs flex items-center justify-center gap-1.5">
                        <i class="fas fa-hourglass-half"></i><span>單據已齊全送交，主辦單位複核中</span>
                    </div>
                `;
            }

            const unitItem = document.createElement('div');
            unitItem.className = "flex flex-col bg-white border border-gray-200 p-4 sm:p-5 rounded-2xl shadow-sm hover:border-tkdBlue transition-all group gap-2.5";

            unitItem.innerHTML = `
                <!-- 第一行：單位名稱、狀態標章與報名項數 -->
                <div class="flex items-start flex-grow min-w-0">
                    <div class="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center shrink-0 mr-2.5 border border-gray-100 group-hover:bg-blue-50 transition-colors mt-0">
                        <i class="fas fa-shield-alt text-gray-600 group-hover:text-tkdBlue transition-colors text-sm"></i>
                    </div>
                    <div class="flex-grow min-w-0">
                        <div class="flex justify-between items-start gap-2">
                            <div class="font-black text-gray-800 text-sm break-words whitespace-normal leading-5 flex-grow" title="${sanitizeHTML(displayUnit)}">${sanitizeHTML(displayUnit)}</div>
                            <div class="shrink-0 flex items-start">
                                ${statusBadge}
                            </div>
                        </div>
                        <div class="text-[11px] text-gray-600 font-black mt-1">${unitCountInfo}</div>
                    </div>
                </div>

                <!-- ✨ 分段式流程進度條 (4 Steps Progress) -->
                <div class="mt-1 pt-2.5 border-t border-gray-100">
                    <div class="flex justify-between items-center text-[11px] font-black mb-1.5">
                        <span class="text-gray-700">單位報名完成度</span>
                        <span class="font-black ${stepPct === 100 ? 'text-green-600' : 'text-tkdBlue'}">${stepPct}%</span>
                    </div>
                    <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden flex">
                        <div class="h-full ${stepPct === 100 ? 'bg-green-500' : 'bg-tkdBlue'} transition-all duration-500" style="width: ${stepPct}%"></div>
                    </div>
                    <div class="grid grid-cols-4 gap-1 text-[10px] font-bold text-gray-600 text-center mt-1.5">
                        <span class="text-tkdBlue font-black">①建立名單✓</span>
                        <span class="${isSummaryUploaded ? 'text-tkdBlue font-black' : 'text-gray-600'}">②簽名總表${isSummaryUploaded ? '✓' : ''}</span>
                        <span class="${isRemittanceUploaded ? 'text-tkdBlue font-black' : 'text-gray-600'}">③匯款證明${isRemittanceUploaded ? '✓' : ''}</span>
                        <span class="${sub?.status === 'verified' ? 'text-green-600 font-black' : 'text-gray-600'}">④主辦審核${sub?.status === 'verified' ? '✓' : ''}</span>
                    </div>
                </div>

                <!-- ✨ 智慧 CTA 按鈕 -->
                ${smartCtaHtml}
                
                <!-- 額外行：若有退回原因，顯示獨立美觀的提示區塊 -->
                ${rejectedReasonHtml}

                <!-- 並排的列印、上傳總表與上傳匯款按鈕 -->
                <div class="grid grid-cols-3 gap-2 mt-1 pt-2.5 border-t border-gray-100">
                    <button onclick="window.printTeamSummary('${tId}', '${sanitizeHTML(g.unit)}', '${sanitizeHTML(g.subTeam)}', 'FRONTEND')" class="bg-gray-100 hover:bg-gray-800 hover:text-white text-gray-600 border border-gray-200 hover:border-gray-800 font-bold w-full py-2 rounded-xl text-xs transition-all shadow-sm flex items-center justify-center gap-1.5 shrink-0 active:scale-95">
                        <i class="fas fa-print"></i><span>列印總表</span>
                    </button>
                    <button onclick="window.openUploadSummaryModal('${tId}', '${sanitizeHTML(g.unit)}', '${sanitizeHTML(g.subTeam)}')" class="${summaryBtnClass}">
                        <i class="${isSummaryUploaded ? 'fas fa-check-circle' : 'fas fa-file-signature'}"></i><span>${summaryBtnText}</span>
                    </button>
                    <button onclick="window.openUploadRemittanceModal('${tId}', '${sanitizeHTML(g.unit)}', '${sanitizeHTML(g.subTeam)}')" class="${remittanceBtnClass}">
                        <i class="${isRemittanceUploaded ? 'fas fa-check-circle' : 'fas fa-receipt'}"></i><span>${remittanceBtnText}</span>
                    </button>
                </div>
            `;
            unitsList.appendChild(unitItem);
        });
    });
};

// ==========================================
// 2. 畫面渲染 (首頁與規程頁)
// ==========================================

// ==========================================
// 🎨 全新設計的賽事卡片渲染邏輯
// ==========================================

window.renderHomePage = () => {
    const grid = document.getElementById('home-tournaments-grid');
    const emptyMsg = document.getElementById('home-empty-msg');
    const searchInput = document.getElementById('home-search');
    const cityFilter = document.getElementById('home-city-filter');
    const statusFilter = document.getElementById('home-status-filter');

    if (!grid) return;

    if (!window.hasAppliedUrlFilters) {
        const urlParams = new URLSearchParams(window.location.search);

        if (urlParams.has('search') && searchInput) {
            searchInput.value = urlParams.get('search');
        }

        if (urlParams.has('city') && cityFilter) {
            const urlCity = urlParams.get('city');
            if (!Array.from(cityFilter.options).some(opt => opt.value === urlCity)) {
                cityFilter.add(new Option(urlCity, urlCity));
            }
            cityFilter.value = urlCity;
        }

        if (urlParams.has('status') && statusFilter) {
            statusFilter.value = urlParams.get('status');
        }

        window.hasAppliedUrlFilters = true;
    }

    // ✨ 紀錄所有可見的賽事總數，用來區分「真的沒賽事」還是「被篩選掉」
    const allVisibleTours = (appData.tournaments || []).filter(t => t.isVisible !== false);
    let visibleTours = [...allVisibleTours];
    const now = new Date();
    const nowTime = now.getTime();

    // 1. 關鍵字篩選
    const keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (keyword) {
        visibleTours = visibleTours.filter(t =>
            (t.name && t.name.toLowerCase().includes(keyword)) ||
            (t.nameEn && t.nameEn.toLowerCase().includes(keyword)) ||
            (t.location && t.location.toLowerCase().includes(keyword))
        );
    }

    // 2. 城市篩選
    const city = cityFilter ? cityFilter.value : '';
    if (city) {
        visibleTours = visibleTours.filter(t => t.city === city);
    }

    // 3. 狀態篩選
    const status = statusFilter ? statusFilter.value : '';
    if (status) {
        visibleTours = visibleTours.filter(t => {
            const startTime = new Date(t.start || '').getTime();
            const endTime = new Date(t.end || '').getTime();

            if (status === 'open') return nowTime >= startTime && nowTime <= endTime;
            if (status === 'upcoming') return nowTime < startTime;
            if (status === 'closed') return nowTime > endTime;
            return true;
        });
    }

    grid.innerHTML = '';

    if (visibleTours.length === 0) {
        grid.classList.add('hidden');
        if (emptyMsg) {
            // ✨ 動態切換空狀態的提示文字
            const emptyTextEl = emptyMsg.querySelector('p');
            if (emptyTextEl) {
                if (allVisibleTours.length === 0) {
                    emptyTextEl.innerText = "目前尚無任何開放中的賽事";
                } else {
                    emptyTextEl.innerText = "目前暫無符合條件的賽事";
                }
            }
            emptyMsg.classList.remove('hidden');
        }
        return;
    }

    grid.classList.remove('hidden');
    if (emptyMsg) emptyMsg.classList.add('hidden');

    // 排序邏輯
    visibleTours.sort((a, b) => {
        const endA = new Date(a.end || '').getTime();
        const endB = new Date(b.end || '').getTime();
        const isEndedA = nowTime > endA;
        const isEndedB = nowTime > endB;

        if (isEndedA !== isEndedB) {
            return isEndedA ? 1 : -1;
        }

        if (!isEndedA) {
            return endA - endB;
        } else {
            const eventDateA = new Date(a.eventDate || '').getTime();
            const eventDateB = new Date(b.eventDate || '').getTime();
            if (isNaN(eventDateA) || isNaN(eventDateB)) return 0;
            return eventDateA - eventDateB;
        }
    });

    visibleTours.forEach(t => {
        const displayName = getLang(t, 'name');

        let statusBadge = '';
        let statusClass = '';
        const startDate = new Date(t.start || '');
        const endDate = new Date(t.end || '');

        if (nowTime < startDate.getTime()) {
            statusBadge = '<i class="fas fa-clock mr-1"></i>即將開放';
            statusClass = 'bg-yellow-100 text-yellow-700 border-yellow-200';
        } else if (nowTime > endDate.getTime()) {
            statusBadge = '<i class="fas fa-times-circle mr-1"></i>報名截止';
            statusClass = 'bg-gray-100 text-gray-500 border-gray-200';
        } else {
            statusBadge = '<i class="fas fa-fire mr-1 text-red-500"></i>熱烈報名中';
            statusClass = 'bg-green-50 text-green-700 border-green-200 shadow-[0_0_10px_rgba(34,197,94,0.3)] animate-pulse';
        }

        const cityBadge = t.city
            ? `<span class="bg-gray-50 text-gray-700 px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest border border-gray-200 shadow-sm"><i class="fas fa-flag mr-1.5 text-gray-400"></i>主辦：${sanitizeHTML(t.city)}</span>`
            : '';

        const scopeBadge = t.scope === 'local'
            ? `<span class="bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest border border-indigo-100 shadow-sm"><i class="fas fa-lock mr-1.5"></i>限本縣市報名</span>`
            : `<span class="bg-blue-50 text-blue-600 px-2.5 py-1 rounded-lg text-[10px] font-black tracking-widest border border-blue-100 shadow-sm"><i class="fas fa-globe mr-1.5"></i>全國開放報名</span>`;

        const grad = 'from-tkdBlue to-blue-800';

        const card = document.createElement('div');
        card.className = "group bg-white rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.05)] hover:shadow-[0_10px_30px_rgb(0,0,0,0.1)] border border-gray-100 overflow-hidden flex flex-col transition-all duration-300 hover:-translate-y-1.5 cursor-pointer relative";
        card.onclick = () => window.selectTournament(t.id);

        card.innerHTML = `
            <div class="h-12 sm:h-14 bg-gradient-to-br ${grad} relative p-3 sm:p-4 flex items-center overflow-hidden">
                <div class="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors duration-500"></div>
                <div class="relative z-10 flex justify-between items-center w-full">
                    <span class="${statusClass} px-3 py-1.5 rounded-xl text-[11px] font-black tracking-widest border backdrop-blur-md bg-white/95 shadow-sm leading-none">${statusBadge}</span>
                    
                    <button class="bg-white/90 backdrop-blur-sm text-tkdBlue px-3 py-1.5 rounded-xl shadow-sm flex items-center justify-center group-hover:bg-tkdBlue group-hover:text-white transition-all duration-300 z-20 text-xs font-black border border-white/50">
                        查看規程 <i class="fas fa-arrow-right ml-1.5 group-hover:translate-x-1 transition-transform duration-300"></i>
                    </button>
                </div>
            </div>
            <div class="p-5 sm:p-6 flex-grow flex flex-col relative bg-white">
                <div class="flex flex-wrap gap-2 mb-3">
                    ${cityBadge}
                    ${scopeBadge}
                </div>
                <h3 class="text-lg sm:text-xl font-black text-gray-800 mb-4 leading-snug group-hover:text-tkdBlue transition-colors">${sanitizeHTML(displayName)}</h3>
                <div class="space-y-3 mt-auto">
                    <div class="flex items-center text-sm font-bold">
                        <span class="text-gray-400 font-black mr-3 shrink-0 tracking-widest">比賽日期</span>
                        <span class="flex-1 text-gray-800 truncate">${sanitizeHTML(t.eventDate) || '未定'}</span>
                    </div>
                    <div class="flex items-center text-sm font-bold">
                        <span class="text-gray-400 font-black mr-3 shrink-0 tracking-widest">比賽地點</span>
                        <span class="flex-1 text-gray-800 truncate">${sanitizeHTML(t.location) || '未定'}</span>
                    </div>
                    <div class="border-t border-dashed border-gray-200 pt-3 mt-4">
                        <div class="home-timer-container flex flex-wrap items-center justify-between gap-y-2 gap-x-4 text-[13px] font-bold transition-colors">
                            <div class="flex items-center text-gray-500 timer-icon">
                                <i class="fas fa-stopwatch mr-1.5 text-base text-red-500"></i>
                                <span class="tracking-wide">${sanitizeHTML((t.end || '').replace('T', ' '))}截止</span>
                            </div>
                            <div class="home-countdown text-red-600 font-black tracking-wider tabular-nums whitespace-nowrap text-right flex-grow sm:flex-grow-0" data-start="${startDate.getTime()}" data-end="${endDate.getTime()}">
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    if (window.homeCountdownInterval) clearInterval(window.homeCountdownInterval);
    const updateHomeCountdowns = () => {
        const currentNow = new Date().getTime();
        document.querySelectorAll('.home-countdown').forEach(el => {
            const start = parseInt(el.dataset.start);
            const end = parseInt(el.dataset.end);
            if (isNaN(start) || isNaN(end)) return;
            const container = el.closest('.home-timer-container');
            const icon = container.querySelector('.timer-icon i');
            if (currentNow < start) {
                el.innerHTML = `<span class="text-yellow-600">尚未開放</span>`;
                icon.className = "fas fa-clock mr-1.5 text-sm text-yellow-500";
            } else if (currentNow > end) {
                el.innerHTML = `<span class="text-gray-400">已結束</span>`;
                icon.className = "fas fa-ban mr-1.5 text-sm text-gray-400";
            } else {
                icon.className = "fas fa-stopwatch mr-1.5 text-sm text-red-500 animate-pulse";
                const diff = end - currentNow;
                const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)).toString().padStart(2, '0');
                const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
                const s = Math.floor((diff % (1000 * 60)) / 1000).toString().padStart(2, '0');
                el.innerHTML = d > 0 ? `<span class="text-sm mx-0.5">${d}</span>天 ${h}:${m}:${s}` : `<span class="animate-pulse text-sm mx-0.5">${h}:${m}:${s}</span>`;
            }
        });
    };
    updateHomeCountdowns();
    window.homeCountdownInterval = setInterval(updateHomeCountdowns, 1000);
};

window.renderInfoPage = () => {
    if (!selectedTournament) return;
    const tit = document.getElementById('info-title');
    const rul = document.getElementById('info-rules');

    const isEn = currentLang() === 'en';
    const scopeLocal = isEn ? '[Local Only] ' : '限本縣市 ';
    const scopeAll = isEn ? '[National] ' : '全國開放 ';
    const scopePrefix = selectedTournament.scope === 'local' ? scopeLocal : scopeAll;

    const displayTitle = getLang(selectedTournament, 'title') || getLang(selectedTournament, 'name');
    const displayRules = getLang(selectedTournament, 'rules');

    // 1. 綁定原有的標題與點擊複製
    if (tit) {
        tit.onclick = window.copyTourLink;
        tit.innerHTML = `
            ${scopePrefix + window.sanitizeHTML(displayTitle)}<i class="fas fa-link text-tkdBlue ml-2 text-lg sm:text-xl align-baseline" title="點擊複製賽事連結"></i>
        `;
    }

    // 2. 更緊湊的賽事快照資訊列
    const metaContainerId = 'info-meta-container';
    let metaContainer = document.getElementById(metaContainerId);

    if (!metaContainer && tit) {
        metaContainer = document.createElement('div');
        metaContainer.id = metaContainerId;
        // 把間距縮減 (gap-2, mb-4)
        metaContainer.className = 'grid grid-cols-1 md:grid-cols-2 gap-2 mb-4 pl-2';
        tit.parentNode.insertBefore(metaContainer, tit.nextSibling);
    }

    if (metaContainer) {
        const deadline = new Date(selectedTournament.end || '').getTime();
        const displayDeadline = (selectedTournament.end || '').replace('T', ' ');

        // 移除圖示，更新標籤文字，並設定倒數計時容器 ID
        metaContainer.innerHTML = `
            <div class="flex items-center gap-2 bg-gray-50 py-2 px-3 rounded-lg border border-gray-100">
                <div class="text-[13px] font-bold text-gray-700 truncate">
                    <span class="text-gray-500">${isEn ? 'Location: ' : '比賽地點：'}</span>${window.sanitizeHTML(selectedTournament.location || (isEn ? 'TBA' : '尚未公佈'))}
                </div>
            </div>
            <div class="flex items-center gap-2 bg-gray-50 py-2 px-3 rounded-lg border border-gray-100">
                <div class="text-[13px] font-bold text-gray-700 truncate">
                    <span class="text-gray-500">${isEn ? 'Event Date: ' : '比賽日期：'}</span>${window.sanitizeHTML(selectedTournament.eventDate || '---')}
                </div>
            </div>
            <div class="flex items-center gap-2 bg-gray-50 py-2 px-3 rounded-lg border border-gray-100">
                <div class="text-[13px] font-bold text-gray-700 truncate">
                    <span class="text-gray-500">${isEn ? 'Deadline: ' : '報名截止：'}</span>${displayDeadline || '---'}
                </div>
            </div>
            <div class="flex items-center gap-2 bg-red-50 py-2 px-3 rounded-lg border border-red-100">
                <div class="text-[13px] font-bold truncate">
                    <span class="text-red-400">${isEn ? 'Countdown: ' : '報名倒數：'}</span><span id="info-countdown-text"></span>
                </div>
            </div>
        `;

        // 加入動態即時跳動的分秒倒數邏輯
        if (window.infoCountdownInterval) clearInterval(window.infoCountdownInterval);

        const updateInfoCountdown = () => {
            const el = document.getElementById('info-countdown-text');
            if (!el) {
                if (window.infoCountdownInterval) clearInterval(window.infoCountdownInterval);
                return;
            }

            if (isNaN(deadline)) {
                el.innerHTML = `<span class="text-gray-400 font-black">尚未設定時間</span>`;
                if (window.infoCountdownInterval) clearInterval(window.infoCountdownInterval);
                return;
            }

            const now = new Date().getTime();
            const diff = deadline - now;

            if (diff > 0) {
                const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const s = Math.floor((diff % (1000 * 60)) / 1000);
                el.innerHTML = `<span class="text-tkdRed font-black">剩餘 ${d} 天 ${h} 小時 ${m} 分 ${s} 秒</span>`;
            } else {
                el.innerHTML = `<span class="text-gray-400 font-black">報名已截止</span>`;
                if (window.infoCountdownInterval) clearInterval(window.infoCountdownInterval);
            }
        };

        // 初始化執行第一次，接著每秒觸發
        updateInfoCountdown();
        window.infoCountdownInterval = setInterval(updateInfoCountdown, 1000);
    }

    // 3. 渲染規程本文
    if (rul) {
        rul.innerText = displayRules || (isEn ? "No detailed rules available for this tournament." : "此賽事暫無詳細規程內容。");
    }

    // 4. 渲染附件連結 (更緊湊的版本)
    const con = document.getElementById('info-links-container');
    if (!con) return;
    con.innerHTML = '';

    if (!selectedTournament.links || selectedTournament.links.length === 0) {
        const noAttachmentMsg = isEn ? 'No attachments available.' : '目前無附件提供下載。';
        con.innerHTML = `<p class="text-xs text-gray-400 font-bold">${noAttachmentMsg}</p>`;
    } else {
        selectedTournament.links.forEach(l => {
            const it = document.createElement('a');
            it.href = window.sanitizeURL(l.url);
            it.target = "_blank";
            it.className = "block bg-gray-50 p-3 rounded-xl border border-gray-100 flex items-center gap-3 hover:bg-white hover:border-blue-200 hover:shadow-sm transition-all group cursor-pointer";

            const clickHint = isEn ? 'Click to download' : '點擊下載';

            it.innerHTML = `
                <div class="text-red-500 group-hover:text-red-600 transition-colors shrink-0"><i class="fas fa-file-pdf text-xl"></i></div>
                <div class="flex-grow overflow-hidden">
                    <div class="font-bold text-gray-800 text-sm truncate">${window.sanitizeHTML(l.name)}</div>
                    <div class="text-[10px] text-gray-400 uppercase tracking-widest">${clickHint}</div>
                </div>
                <i class="fas fa-download text-gray-300 group-hover:text-tkdBlue shrink-0"></i>`;
            con.appendChild(it);
        });
    }

    // 5. 狀態重置：每次切換賽事，取消勾選隱私權
    const privacyCheckbox = document.getElementById('privacy-consent');
    if (privacyCheckbox) {
        privacyCheckbox.checked = false;
        if (window.toggleRegisterBtn) window.toggleRegisterBtn();
    }
};

// ==========================================
// 3. 報名表單動態邏輯
// ==========================================

window.renderFormOptions = () => {
    const is = document.getElementById('item');
    if (!is || !selectedTournament) return;

    is.innerHTML = '';

    // ✨ 加入預設提示文字的雙語判斷
    const defaultPrompt = currentLang() === 'en' ? 'Please select an event...' : '請選擇參賽項目...';
    is.add(new Option(defaultPrompt, ''));

    const linkage = selectedTournament.linkage || {};
    const order = selectedTournament.itemOrder || Object.keys(linkage);

    order.forEach(k => {
        if (linkage[k]) {
            // 使用 getLang 解析 "中,英" 字串
            const displayName = getLang(k);
            is.add(new Option(displayName, k));
        }
    });

    window.onItemChange();
};

window.onItemChange = () => {
    const is = document.getElementById('item');
    const gs = document.getElementById('group');
    if (!is || !gs || !selectedTournament) return;

    const selectedItemName = is.value;
    const d = (selectedTournament.linkage || {})[selectedItemName];

    gs.innerHTML = '';
    // ✨ 簡易雙語提示
    const defaultPrompt = currentLang() === 'en' ? 'Please select a category...' : '請先選擇上方項目...';
    gs.add(new Option(defaultPrompt, ''));

    if (d) {
        const gOrder = (selectedTournament.groupOrder && selectedTournament.groupOrder[selectedItemName]) || Object.keys(d);
        gOrder.forEach(gn => {
            if (d[gn]) {
                // ✨ 使用 getLang 解析 "中文,英文"，但維持 value 為原始字串
                gs.add(new Option(getLang(gn), gn));
            }
        });
    }

    window.onGroupChange();
};

// ==========================================
// 🚨 單位名稱衝突偵測器
// ==========================================
window.validateUnit = () => {
    const unitInput = document.getElementById('unit');
    if (!unitInput || !selectedTournament) return true;

    let errEl = document.getElementById('unit-error');
    if (!errEl) {
        errEl = document.createElement('div');
        errEl.id = 'unit-error';
        errEl.className = 'absolute left-0 top-[calc(100%+6px)] z-20 w-[105%] bg-white text-red-600 text-[11px] leading-relaxed font-black px-3.5 py-2.5 rounded-xl border border-red-200 shadow-[0_8px_16px_rgba(239,68,68,0.15)] hidden animate-fade-in';
        unitInput.parentElement.classList.add('relative');
        unitInput.parentElement.appendChild(errEl);
    }

    const showError = (msg) => {
        errEl.innerHTML = `<div class="flex items-start"><i class="fas fa-user-shield mt-0.5 mr-1.5 shrink-0 text-red-500"></i><span>${msg}</span></div>`;
        errEl.classList.remove('hidden'); errEl.classList.add('block');
        unitInput.classList.add('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
        return false;
    };

    const clearError = () => {
        errEl.classList.add('hidden'); errEl.classList.remove('block');
        unitInput.classList.remove('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
        return true;
    };

    const unitVal = unitInput.value.trim();
    if (!unitVal) return clearError();

    // 判斷當前操作的目標 UID
    let targetUid = currentUser.uid;
    const overrideUidEl = document.getElementById('overrideUid');
    const editRecordIdEl = document.getElementById('editRecordId');

    // 如果是「管理員代為新增」模式，抓取隱藏的教練 UID
    if (overrideUidEl && overrideUidEl.value) {
        targetUid = overrideUidEl.value;
    }
    // 如果是「管理員修改既有紀錄」模式，抓取該筆紀錄原本主人的 UID
    else if (editRecordIdEl && editRecordIdEl.value) {
        const existingRecord = (appData.registrations || []).find(r => r.id === editRecordIdEl.value);
        if (existingRecord) {
            targetUid = existingRecord.userId;
        }
    }

    // 去全局資料中比對，是否有「同賽事、同單位名稱、但不同帳號 (UID)」的報名紀錄
    const conflictReg = (appData.registrations || []).find(r =>
        r.tournamentId === selectedTournament.id &&
        r.unit === unitVal &&
        r.userId !== targetUid
    );

    if (conflictReg) {
        const conflictEmail = conflictReg.email || '???';
        return showError(`${t('val.unit-conflict')} (<span class="text-tkdBlue font-black">${conflictEmail}</span>)<br><span class="text-[10px] text-red-400 tracking-wider">${t('val.unit-conflict-sub')}</span>`);
    }
    return clearError();
};

// ==========================================
// 🚨 終極版：自動轉換 ＆ 智慧防呆驗證器
// ==========================================
// 加上 isTyping 參數，用來判斷使用者是否「還在打字」
window.validateSingleBirthday = (bInput, isTyping = false, itemSet = {}) => {
    if (!bInput) return true;

    let errEl = bInput.parentElement.querySelector('.err-msg');
    if (!errEl) {
        errEl = document.createElement('div');
        errEl.className = 'err-msg absolute left-0 top-[calc(100%+6px)] z-20 w-[105%] bg-white text-red-600 text-[11px] leading-relaxed font-black px-3.5 py-2.5 rounded-xl border border-red-200 shadow-[0_8px_16px_rgba(239,68,68,0.15)] hidden animate-fade-in';
        bInput.parentElement.classList.add('relative');
        bInput.parentElement.appendChild(errEl);
    }

    const showError = (msg) => {
        errEl.innerHTML = `<div class="flex items-start"><i class="fas fa-exclamation-circle mt-0.5 mr-1.5 shrink-0 text-red-500"></i><span>${msg}</span></div>`;
        errEl.classList.remove('hidden'); errEl.classList.add('block');
        bInput.classList.add('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
        return false;
    };

    const clearError = () => {
        errEl.classList.add('hidden'); errEl.classList.remove('block');
        bInput.classList.remove('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
        return true;
    };

    let dateVal = bInput.value.trim();
    if (!dateVal && bInput.dataset.rawInput) { dateVal = bInput.dataset.rawInput.trim(); bInput.value = dateVal; }
    if (!dateVal) { bInput.dataset.rawInput = ""; return clearError(); }

    let parts = dateVal.split(/[\/\-]/);
    if (parts.length > 1) {
        let y = parseInt(parts[0], 10);
        if (y > 0 && y < 200) {
            parts[0] = (y + 1911).toString();
            dateVal = parts.join('/');
            bInput.value = dateVal;
            bInput.dataset.rawInput = dateVal;
        }
    }

    const dateRegex = /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/;
    if (!dateRegex.test(dateVal)) {
        if (isTyping) return clearError();
        return showError(t('val.birth-incomplete'));
    }

    const bDate = new Date(dateVal.replace(/-/g, '/'));
    if (isNaN(bDate.getTime())) {
        if (isTyping) return clearError();
        return showError(t('val.birth-invalid'));
    }

    // 補回變數的宣告與處理
    let minStr = itemSet.birthMin ? itemSet.birthMin.replace(/-/g, '/') : '';
    let maxStr = itemSet.birthMax ? itemSet.birthMax.replace(/-/g, '/') : '';

    if (minStr || maxStr) {
        const minDate = minStr ? new Date(minStr) : new Date('1900/01/01');
        const maxDate = maxStr ? new Date(maxStr) : new Date('2100/01/01');

        if (bDate < minDate || bDate > maxDate) {
            let rangeText = `${minStr || 'No Limit'} ~ ${maxStr || 'No Limit'}`;
            return showError(`${t('val.age-error')}<br><span class="text-xs tracking-wider">${rangeText}</span>`);
        }
    }
    return clearError();
};

window.validateSingleId = (idInput, isRequired) => {
    if (!idInput) return true;

    let errEl = idInput.parentElement.querySelector('.err-msg');
    if (!errEl) {
        errEl = document.createElement('div');
        errEl.className = 'err-msg absolute left-0 top-[calc(100%+6px)] z-20 w-[105%] bg-white text-red-600 text-[11px] leading-relaxed font-black px-3.5 py-2.5 rounded-xl border border-red-200 shadow-[0_8px_16px_rgba(239,68,68,0.15)] hidden animate-fade-in';
        idInput.parentElement.classList.add('relative');
        idInput.parentElement.appendChild(errEl);
    }

    const showError = (msg) => {
        errEl.innerHTML = `<div class="flex items-start"><i class="fas fa-exclamation-circle mt-0.5 mr-1.5 shrink-0 text-red-500"></i><span>${msg}</span></div>`;
        errEl.classList.remove('hidden'); errEl.classList.add('block');
        idInput.classList.add('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
        return false;
    };
    const clearError = () => {
        errEl.classList.add('hidden'); errEl.classList.remove('block');
        idInput.classList.remove('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
        return true;
    };

    let val = idInput.value.trim();
    if (!val) {
        if (isRequired) return showError(t('val.id-required') || '身分證或護照號碼為必填');
        return clearError();
    }

    // ✨ 修改：雙軌驗證機制
    const twIdRegex = /^[A-Z][1289A-D]\d{8}$/; // 台灣國民身分證與新舊版居留證
    const passportRegex = /^[A-Z0-9]{6,20}$/;  // 國際護照：放寬為 6~20 碼的英數字混合

    // 如果「不是台灣證件」也「不是護照格式」，才報錯
    if (!twIdRegex.test(val) && !passportRegex.test(val)) {
        return showError(t('val.id-format') || '格式錯誤！請輸入有效的身分證、居留證或護照號碼（僅限 6~20 碼英數字）。');
    }

    return clearError();
};

window.validateSingleCoachName = (input) => {
    if (!input) return true;
    let val = input.value.trim();
    if (!val) return true; // 若為空值直接放行 (必填的檢查交給 HTML required)

    let errEl = input.parentElement.querySelector('.err-msg');
    if (!errEl) {
        errEl = document.createElement('div');
        errEl.className = 'err-msg absolute left-0 top-[calc(100%+6px)] z-20 w-[105%] bg-white text-red-600 text-[11px] leading-relaxed font-black px-3.5 py-2.5 rounded-xl border border-red-200 shadow-[0_8px_16px_rgba(239,68,68,0.15)] hidden animate-fade-in';
        input.parentElement.classList.add('relative');
        input.parentElement.appendChild(errEl);
    }

    const showError = (msg) => {
        errEl.innerHTML = `<div class="flex items-start"><i class="fas fa-exclamation-circle mt-0.5 mr-1.5 shrink-0 text-red-500"></i><span>${msg}</span></div>`;
        errEl.classList.remove('hidden'); errEl.classList.add('block');
        input.classList.add('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
        return false;
    };
    const clearError = () => {
        errEl.classList.add('hidden'); errEl.classList.remove('block');
        input.classList.remove('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
        return true;
    };

    // ✨ 動態獲取該賽事的教練名額限制 (若無設定則預設為 3)
    const coachLimit = (selectedTournament && selectedTournament.coachLimit) ? selectedTournament.coachLimit : 3;

    // 判斷是否包含中文
    const hasChinese = /[\u4e00-\u9fa5]/.test(val);

    if (hasChinese) {
        // 規則 1：中文名字絕對不允許有空格
        if (/\s/.test(val)) {
            const msg = coachLimit > 1
                ? '中文姓名請勿包含空格！若是多位教練請分開填寫至其他教練欄位。'
                : '中文姓名請勿包含空格！本賽事僅開放登錄一位教練。';
            return showError(msg);
        }

        // 規則 2：白名單過濾！不允許任何特殊符號，除了原住民姓名的間隔號 (‧, ·, •, ･)
        // [^\u4e00-\u9fa5a-zA-Z‧·•･] 代表：只要含有「非 (中文、英文字母、原住民間隔號)」的字元就違規
        const hasInvalidSymbol = /[^\u4e00-\u9fa5a-zA-Z‧·•･]/.test(val);
        if (hasInvalidSymbol) {
            const msg = coachLimit > 1
                ? '單一欄位只能填寫一位教練！請勿使用符號 (如 - 或 /) 串接，多位教練請分開填寫。'
                : '本賽事僅開放登錄一位教練，請勿使用符號串接多位姓名！(原住民姓名之間隔號除外)';
            return showError(msg);
        }
    } else {
        // 規則 3：如果完全沒有中文 (例如純英文姓名 John Doe)，允許有空格，但擋下常見的串接符號
        if (/[\/、,，\-]/.test(val)) {
            const msg = coachLimit > 1
                ? '單一欄位只能填寫一位教練！多位教練請分別填入其他教練欄位。'
                : '本賽事僅開放登錄一位教練，請勿填寫多位！';
            return showError(msg);
        }
    }

    return clearError();
};

window.onGroupChange = () => {
    const is = document.getElementById('item');
    const gs = document.getElementById('group');
    const ls = document.getElementById('level');
    if (!is || !gs || !ls || !selectedTournament) return;

    ls.innerHTML = '';
    const defaultPrompt = currentLang() === 'en' ? 'Please select a level/weight...' : '請選擇級別...';
    ls.add(new Option(defaultPrompt, ''));

    const itemName = is.value;
    const groupName = gs.value;

    // ✨ 修改：只要有選擇項目，就不阻擋，讓選手框可以先長出來
    if (!itemName) {
        const container = document.getElementById('dynamic-players-container');
        if (container) container.innerHTML = '';
        return;
    }

    const d = (selectedTournament.linkage || {})[itemName];
    // ✨ 修改：只有當 groupName 確實有選定時，才長出級別選項
    if (groupName && d && d[groupName]) {
        d[groupName].forEach(lv => {
            ls.add(new Option(getLang(lv), lv));
        });
    }

    let teamSize = 1;
    if (selectedTournament.teamSizes && selectedTournament.teamSizes[itemName] !== undefined) {
        if (typeof selectedTournament.teamSizes[itemName] === 'object') {
            teamSize = selectedTournament.teamSizes[itemName][groupName] || 1;
        } else {
            teamSize = selectedTournament.teamSizes[itemName];
        }
    }

    let gSet = {};
    // ✨ 修改：確保有選擇 groupName 時才讀取特定設定，否則傳遞空物件
    if (groupName && selectedTournament.groupSettings && selectedTournament.groupSettings[itemName] && selectedTournament.groupSettings[itemName][groupName]) {
        gSet = selectedTournament.groupSettings[itemName][groupName];
    } else if (selectedTournament.itemSettings && selectedTournament.itemSettings[itemName]) {
        gSet = selectedTournament.itemSettings[itemName];
    }

    window.renderDynamicPlayers(teamSize, itemName, gSet);
};

window.renderDynamicPlayers = (size, itemName, gSet = {}) => {
    const container = document.getElementById('dynamic-players-container');
    if (!container) return;

    // ✨ 1. 記憶機制：在清空容器之前，先備份畫面上已經輸入的資料！
    const backupData = [];
    const existingNames = container.querySelectorAll('.dynamic-player-name');
    const existingBirths = container.querySelectorAll('.dynamic-birthday');
    const existingIds = container.querySelectorAll('.dynamic-id');

    for (let i = 0; i < existingNames.length; i++) {
        backupData.push({
            name: existingNames[i] ? existingNames[i].value : '',
            birth: existingBirths[i] ? (existingBirths[i].dataset.rawInput || existingBirths[i].value) : '',
            id: existingIds[i] ? existingIds[i].value : ''
        });
    }

    // 備份完成，現在可以安心清空了
    container.innerHTML = '';

    // 核心判斷：直接從組別的設定 (gSet) 決定是否顯示身分證欄位
    let requireId = gSet.requireId === 'true' || gSet.requireId === true;

    if (window.birthdayPickers) window.birthdayPickers.forEach(p => p.destroy());
    window.birthdayPickers = [];

    for (let i = 0; i < size; i++) {
        const pNum = i + 1;

        // 讀取雙語字典
        const labelName = t('reg.player-name');
        const labelBirth = t('reg.player-birth');
        const labelId = t('reg.player-id');
        const holderName = t('reg.placeholder-name');
        const holderBirth = t('reg.placeholder-birth');
        const holderId = t('reg.placeholder-id');

        const html = `
        <div class="p-5 sm:p-6 bg-white rounded-2xl border border-gray-200 shadow-sm relative pt-8 mb-4">
            <div class="absolute -top-3 left-4 bg-tkdRed text-white text-[11px] tracking-widest font-black px-4 py-1.5 rounded-full shadow-md">
                ${t('reg.player-title').replace('{n}', pNum)}
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                    <label class="block text-xs font-bold text-gray-600 mb-2">${labelName} <span class="text-red-500">*</span></label>
                    <input type="text" id="playerName_${i}" name="playerName_${i}" required class="dynamic-player-name w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-tkdRed focus:ring-2 focus:ring-tkdRed/20 outline-none transition-all font-bold text-gray-900 bg-yellow-50/50" placeholder="${holderName}">
                </div>

                <div>
                    <label class="block text-xs font-bold text-gray-600 mb-2">${labelBirth} <span class="text-red-500">*</span></label>
                    <input type="text" id="birthday_${i}" name="birthday_${i}" required class="dynamic-birthday w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-tkdRed focus:ring-2 focus:ring-tkdRed/20 outline-none transition-all font-bold text-gray-900 bg-gray-50 cursor-pointer" placeholder="${holderBirth}">
                </div>

                <div class="${requireId ? '' : 'hidden'}">
                    <label class="block text-xs font-bold text-gray-600 mb-2">${labelId} <span class="text-red-500">*</span></label>
                    <input type="text" id="idNumber_${i}" name="idNumber_${i}" class="dynamic-id w-full px-4 py-3 border border-gray-200 rounded-xl focus:border-tkdRed focus:ring-2 focus:ring-tkdRed/20 outline-none uppercase transition-all font-bold text-gray-900 bg-gray-50" placeholder="${holderId}">
                </div>
            </div>
        </div>
        `;
        container.insertAdjacentHTML('beforeend', html);

        // 綁定生日選擇器與驗證
        const bInput = document.getElementById(`birthday_${i}`);
        let fpConfig = {
            dateFormat: "Y/m/d", locale: "zh_tw", disableMobile: "true", allowInput: true, errorHandler: () => { },
            onChange: () => {
                if (bInput.value) bInput.dataset.rawInput = bInput.value;
                window.validateSingleBirthday(bInput, false, gSet);
            }
        };
        if (gSet.birthMin) fpConfig.minDate = gSet.birthMin;
        if (gSet.birthMax) fpConfig.maxDate = gSet.birthMax;

        window.birthdayPickers.push(window.flatpickr(bInput, fpConfig));

        bInput.addEventListener('keyup', (e) => { e.target.dataset.rawInput = e.target.value; window.validateSingleBirthday(e.target, true, gSet); });
        bInput.addEventListener('blur', (e) => { setTimeout(() => window.validateSingleBirthday(e.target, false, gSet), 100); });

        // 綁定身分證驗證
        const idInput = document.getElementById(`idNumber_${i}`);
        if (idInput) {
            idInput.addEventListener('input', () => { idInput.value = idInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
            idInput.addEventListener('blur', () => window.validateSingleId(idInput, requireId));
        }

        // ✨ 2. 回填機制：如果剛才有備份到資料，就把資料塞回全新的輸入框裡！
        if (backupData[i]) {
            const nInput = document.getElementById(`playerName_${i}`);
            const iInput = document.getElementById(`idNumber_${i}`);

            if (nInput) nInput.value = backupData[i].name;
            if (bInput && backupData[i].birth) {
                bInput.value = backupData[i].birth;
                bInput.dataset.rawInput = backupData[i].birth;
                // 同步更新 Flatpickr 日期選擇器的內部狀態與畫面顯示
                if (window.birthdayPickers[i]) {
                    window.birthdayPickers[i].setDate(backupData[i].birth, false);
                }

                window.validateSingleBirthday(bInput, false, gSet);
            }
            if (iInput) iInput.value = backupData[i].id;
        }
    }
};

window.checkTournamentStatus = () => {
    if (window.countdownInterval) {
        clearInterval(window.countdownInterval);
    }

    if (!selectedTournament) return;

    const tourTitleEl = document.getElementById('reg-current-tour');
    if (tourTitleEl) {
        tourTitleEl.innerText = getLang(selectedTournament, 'name');
    }

    const msgEl = document.getElementById('tournament-status-msg');
    const btn = document.getElementById('btn-submit-reg');
    if (!msgEl || !btn) return;

    const startTime = new Date(selectedTournament.start || '').getTime();
    const endTime = new Date(selectedTournament.end || '').getTime();

    const isEditMode = !!document.getElementById('editRecordId')?.value;
    // ✨ 修改：使用翻譯鍵值
    const mainActionText = isEditMode ? t('reg.save-edit') : t('reg.save');
    const mainIcon = isEditMode ? 'fa-check-circle' : 'fa-save';

    const isAdmin = ['admin', 'super_admin', 'scoped_admin'].includes(currentUserRole);

    const updateTimer = () => {
        if (!selectedTournament) {
            if (window.countdownInterval) clearInterval(window.countdownInterval);
            return;
        }

        // 送出期間維持按鈕鎖定，避免倒數計時器每秒重設按鈕狀態。
        if (btn.dataset.submitting === 'true') {
            btn.disabled = true;
            return;
        }

        const now = new Date().getTime();
        const tourStartStr = selectedTournament.start.replace('T', ' ');
        const tourEndStr = selectedTournament.end.replace('T', ' ');

        if (now < startTime) {
            msgEl.innerHTML = `<div class="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 leading-snug"><div class="text-sm whitespace-nowrap"><i class="fas fa-clock mr-1"></i>${t('reg.status-pending')}</div><div class="text-xs font-normal whitespace-nowrap">(${t('reg.time-expect')}: ${tourStartStr})</div></div>`;
            msgEl.className = "font-black text-orange-600 bg-orange-50 px-5 py-3 rounded-xl block w-full text-center border border-orange-100 shadow-sm";

            if (isAdmin) {
                btn.disabled = false;
                btn.innerHTML = `<div class="flex items-center justify-center leading-snug"><div class="text-base"><i class="fas ${mainIcon} mr-2"></i>${mainActionText} <span class="text-xs bg-white text-orange-600 px-2 py-0.5 rounded ml-2">${t('reg.admin-badge')}</span></div></div>`;
            } else {
                btn.disabled = true;
                btn.innerHTML = `<div class="flex items-center justify-center leading-snug"><div class="text-base"><i class="fas fa-clock mr-2"></i>${t('reg.status-pending')}</div></div>`;
            }

        } else if (now > endTime) {
            msgEl.innerHTML = `<div class="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 leading-snug"><div class="text-sm whitespace-nowrap"><i class="fas fa-ban mr-1"></i>${t('reg.status-closed')}</div><div class="text-xs font-normal whitespace-nowrap">(${t('reg.time-deadline')}: ${tourEndStr})</div></div>`;
            msgEl.className = "font-black text-red-600 bg-red-50 px-5 py-3 rounded-xl block w-full text-center border border-red-100 shadow-sm";

            if (isAdmin) {
                btn.disabled = false;
                btn.innerHTML = `<div class="flex items-center justify-center leading-snug"><div class="text-base"><i class="fas ${mainIcon} mr-2"></i>${mainActionText} <span class="text-xs bg-white text-red-600 px-2 py-0.5 rounded ml-2">${t('reg.admin-badge')}</span></div></div>`;
            } else {
                btn.disabled = true;
                btn.innerHTML = `<div class="flex items-center justify-center leading-snug"><div class="text-base"><i class="fas fa-ban mr-2"></i>${t('reg.status-closed')}</div></div>`;
                if (window.countdownInterval) clearInterval(window.countdownInterval);
            }

        } else {
            const diff = endTime - now;
            const d = Math.floor(diff / (1000 * 60 * 60 * 24));
            const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)).toString().padStart(2, '0');
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
            const s = Math.floor((diff % (1000 * 60)) / 1000).toString().padStart(2, '0');

            // ✨ 修改：將截止時間移入送出按鈕內，並將原狀態標籤改為提示文案
            msgEl.innerHTML = `
                <div class="flex items-start gap-3 text-left">
                    <div class="w-8 h-8 rounded-full bg-tkdBlue/10 text-tkdBlue flex items-center justify-center shrink-0 mt-0.5">
                        <i class="fas fa-flag-checkered"></i>
                    </div>
                    <div>
                        <div class="text-sm font-black text-gray-800 mb-1">所有參賽選手皆已新增完畢了嗎？</div>
                        <div class="text-xs font-bold text-gray-600 leading-relaxed">選手名單建置完成後，下一步務必前往頂部選單「我的報名」下載總表簽名蓋章並完成單據上傳，才算完成正式送件！</div>
                    </div>
                </div>
            `;
            msgEl.className = "bg-blue-50/50 px-4 py-3.5 rounded-xl block w-full border border-blue-100/60 shadow-sm mt-3";
            btn.disabled = false;

            btn.innerHTML = `
                <div class="flex flex-col items-center justify-center gap-1 leading-snug">
                    <div class="text-base whitespace-nowrap font-bold"><i class="fas ${mainIcon} mr-2"></i>${mainActionText}</div>
                    <div class="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 text-[11px] sm:text-xs font-normal tracking-wider whitespace-nowrap opacity-90 mt-1">
                        <span>(${t('reg.time-remaining')} ${d} ${t('reg.day')} ${h}:${m}:${s})</span>
                        <span class="hidden sm:inline-block border-l border-white/30 h-3"></span>
                        <span>(${t('reg.time-deadline')}: ${tourEndStr})</span>
                    </div>
                </div>
            `;
        }
    };

    const coachLimit = selectedTournament.coachLimit || 3;
    const coach2Input = document.getElementById('coach2');
    const coach3Input = document.getElementById('coach3');

    // 找到包含 label 的父層容器 (通常是 grid 中的一個 div)
    const coach2Wrapper = coach2Input?.closest('div');
    const coach3Wrapper = coach3Input?.closest('div');

    if (coachLimit === 1) {
        if (coach2Wrapper) coach2Wrapper.classList.add('hidden');
        if (coach3Wrapper) coach3Wrapper.classList.add('hidden');
        if (coach2Input) coach2Input.value = ''; // 隱藏時清空內容，避免誤存舊資料
        if (coach3Input) coach3Input.value = '';
    } else if (coachLimit === 2) {
        if (coach2Wrapper) coach2Wrapper.classList.remove('hidden');
        if (coach3Wrapper) coach3Wrapper.classList.add('hidden');
        if (coach3Input) coach3Input.value = '';
    } else {
        if (coach2Wrapper) coach2Wrapper.classList.remove('hidden');
        if (coach3Wrapper) coach3Wrapper.classList.remove('hidden');
    }

    updateTimer();
    window.countdownInterval = setInterval(updateTimer, 1000);
};

// ==========================================
// 4. 使用者個人報名總表 (前台儀表板)
// ==========================================

window.renderUserTables = () => {
    // 新增時間解析輔助函式，避免各家瀏覽器遇到「上午/下午」時拋出 Invalid Date 導致排序大亂
    const parseTimeMs = (rTimeRaw) => {
        if (!rTimeRaw) return 0;
        const cleanTime = rTimeRaw.replace('上午', 'AM ').replace('下午', 'PM ');
        let ms = Date.parse(cleanTime);
        if (isNaN(ms)) {
            const nums = rTimeRaw.match(/\d+/g);
            if (nums && nums.length >= 3) {
                let [y, m, d, h = 0, min = 0, s = 0] = nums.map(Number);
                if (rTimeRaw.includes('下午') && h < 12) h += 12;
                if (rTimeRaw.includes('上午') && h === 12) h = 0;
                ms = new Date(y, m - 1, d, h, min, s).getTime();
            }
        }
        return isNaN(ms) ? 0 : ms;
    };

    // 替換原本單純的 new Date() 排序
    const sorted = [...appData.registrations].sort((a, b) => parseTimeMs(b.time) - parseTimeMs(a.time));

    const userBody = document.getElementById('userTableBody');
    const userNoData = document.getElementById('userNoDataMessage');
    const userCount = document.getElementById('user-reg-count');

    if (!userBody) return;

    // ✨ 嚴格阻擋：如果沒有選定賽事，直接清空並結束
    if (!selectedTournament) {
        userBody.innerHTML = '';
        if (userCount) userCount.innerText = '0 筆';
        if (userNoData) userNoData.classList.remove('hidden');
        return;
    }

    const overrideUidEl = document.getElementById('overrideUid');
    const targetUid = (overrideUidEl && overrideUidEl.value && overrideUidEl.value.trim() !== '')
        ? overrideUidEl.value
        : currentUser?.uid;

    // ✨ 過濾條件：加入賽事 ID 判斷
    const myData = sorted.filter(r => {
        if (r.tournamentId !== selectedTournament.id) {
            return false;
        }
        if (overrideUidEl && overrideUidEl.value) {
            return r.userId === targetUid;
        }
        return r.userId === currentUser?.uid;
    });

    if (userCount) userCount.innerText = t('reg.records-count').replace('{n}', myData.length);

    if (myData.length === 0) {
        userBody.innerHTML = ''; // 只有資料為空時才全域清空
        if (userNoData) userNoData.classList.remove('hidden');
        return;
    }
    if (userNoData) userNoData.classList.add('hidden');

    const grouped = {};
    myData.forEach(r => {
        const st = r.subTeam || '';
        const key = st ? `${r.unit}@@${st}` : r.unit;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(r);
    });

    window.expandedUnits = window.expandedUnits || new Set();

    // ✨ 建立本次所有應該存在的卡片 ID 清單
    const currentCardIds = new Set();

    Object.keys(grouped).sort((a, b) => {
        const isAscii = (str) => str.length > 0 && str.charCodeAt(0) < 128;
        const aAsc = isAscii(a);
        const bAsc = isAscii(b);
        if (aAsc && !bAsc) return -1;
        if (!aAsc && bAsc) return 1;
        return a.localeCompare(b, 'zh-TW', { collation: 'stroke' });
    }).forEach((unitKey) => {
        const regs = grouped[unitKey];
        const actualUnit = regs[0].unit;
        const actualSubTeam = regs[0].subTeam || '';
        const displayUnitName = actualSubTeam ? `${actualUnit}${actualSubTeam}` : actualUnit;

        const tour = appData.tournaments.find(t => t.id === regs[0].tournamentId) || {};
        const requireId = !!(tour.groupSettings && Object.values(tour.groupSettings).some(item =>
            Object.values(item).some(g => g.requireId === 'true' || g.requireId === true)
        ));

        // 四層級嚴格排序邏輯 (項目 -> 組別 -> 量級/級別 -> 生日)
        regs.sort((a, b) => {
            const itemA = a.item || '';
            const itemB = b.item || '';
            const itemOrderList = tour.itemOrder || [];
            const itemIndexA = itemOrderList.indexOf(itemA);
            const itemIndexB = itemOrderList.indexOf(itemB);

            if (itemIndexA !== -1 && itemIndexB !== -1 && itemIndexA !== itemIndexB) return itemIndexA - itemIndexB;
            if (itemIndexA !== -1 && itemIndexB === -1) return -1;
            if (itemIndexA === -1 && itemIndexB !== -1) return 1;
            if (itemA !== itemB) return itemA.localeCompare(itemB, 'zh-TW');

            const groupOrderList = (tour.groupOrder && tour.groupOrder[itemA]) ? tour.groupOrder[itemA] : [];
            const groupA = a.group || '';
            const groupB = b.group || '';
            const groupIndexA = groupOrderList.indexOf(groupA);
            const groupIndexB = groupOrderList.indexOf(groupB);

            if (groupIndexA !== -1 && groupIndexB !== -1 && groupIndexA !== groupIndexB) return groupIndexA - groupIndexB;
            if (groupIndexA !== -1 && groupIndexB === -1) return -1;
            if (groupIndexA === -1 && groupIndexB !== -1) return 1;
            if (groupA !== groupB) return groupA.localeCompare(groupB, 'zh-TW');

            const levelOrderList = (tour.linkage && tour.linkage[itemA] && tour.linkage[itemA][groupA]) ? tour.linkage[itemA][groupA] : [];
            const levelA = a.level || '';
            const levelB = b.level || '';
            const levelIndexA = levelOrderList.indexOf(levelA);
            const levelIndexB = levelOrderList.indexOf(levelB);

            if (levelIndexA !== -1 && levelIndexB !== -1 && levelIndexA !== levelIndexB) return levelIndexA - levelIndexB;
            if (levelIndexA !== -1 && levelIndexB === -1) return -1;
            if (levelIndexA === -1 && levelIndexB !== -1) return 1;
            if (levelA !== levelB) return levelA.localeCompare(levelB, 'zh-TW');

            const birthA = (a.birthday || '').split(' / ')[0];
            const birthB = (b.birthday || '').split(' / ')[0];
            const timeA = new Date(birthA).getTime();
            const timeB = new Date(birthB).getTime();

            if (!isNaN(timeA) && !isNaN(timeB)) return timeA - timeB;
            return birthA.localeCompare(birthB, 'zh-TW');
        });

        const now = new Date().getTime();
        const endTime = new Date(tour.end || '').getTime();
        const isPastDeadline = now > endTime;
        const isAdmin = ['admin', 'super_admin', 'scoped_admin'].includes(currentUserRole);
        const canEditOrDelete = !isPastDeadline || isAdmin;

        let totalFee = 0;
        const idHeaderHtml = requireId ? `<th class="px-5 py-3 font-bold">${t('table.id')}</th>` : '';
        const colspanNum = requireId ? 6 : 5;

        const firstReg = regs[0];
        const allCoaches = [firstReg.coach1, firstReg.coach2, firstReg.coach3].filter(c => c).join('、') || '無';
        const leaderInfo = firstReg.leader || '無';
        const managerInfo = firstReg.manager || '無';
        const phoneInfo = firstReg.phone || '無';

        // ✨ 產生穩定 ID 供局部更新比對使用
        const safeKeyBase = btoa(encodeURIComponent(unitKey)).replace(/[^a-zA-Z0-9]/g, '');
        const safeUnitId = `unit-group-${safeKeyBase}`;
        const cardId = `user-card-${safeKeyBase}`;
        currentCardIds.add(cardId); // 記錄這張卡片應該存在

        const encodedUnit = encodeURIComponent(unitKey);
        const jsSafeUnitName = actualUnit.replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const jsSafeSubTeam = actualSubTeam.replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const isExpanded = window.expandedUnits.has(unitKey);
        const contentHiddenClass = isExpanded ? '' : 'hidden';
        const chevronRotateClass = isExpanded ? 'rotate-180' : '';

        let html = `
            <div class="bg-gray-100 border-b border-gray-200 px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-gray-200 transition-colors" 
                 onclick="window.toggleUnitCard('${safeUnitId}', '${encodedUnit}')">
                
                <div class="flex items-center gap-2.5 min-w-0">
                    <div class="w-6 h-6 flex items-center justify-center rounded-full bg-white shadow-sm border border-gray-200 shrink-0">
                        <i id="icon-${safeUnitId}" class="fas fa-chevron-down text-gray-400 text-[10px] transition-transform duration-300 transform ${chevronRotateClass}"></i>
                    </div>
                    <h4 class="text-base font-black text-tkdBlue flex items-center tracking-wide truncate">
                        <i class="fas fa-shield-alt mr-2 text-gray-400 shrink-0"></i><span class="truncate">${sanitizeHTML(displayUnitName)}</span>
                    </h4>
                </div>

                <div class="flex items-center gap-2.5 shrink-0">
                    <span class="text-[10px] font-bold text-gray-500 bg-white border border-gray-200 px-2.5 py-1 rounded-full shadow-sm">
                        ${regs.length} 筆紀錄
                    </span>
                    <button onclick="event.stopPropagation(); window.goToMyRecordsForUpload()" 
                    class="hidden sm:inline-flex text-xs bg-tkdBlue text-white px-4 py-2 rounded-xl font-black hover:bg-blue-700 transition-colors shadow-sm items-center gap-1.5 shrink-0 active:scale-95">
                        <i class="fas fa-folder-open"></i>列印總表與上傳單據
                    </button>
                </div>
            </div>

            <div id="content-${safeUnitId}" class="${contentHiddenClass}">
                <div class="bg-gray-50/80 border-b border-gray-200 px-4 sm:px-5 py-3 text-xs text-gray-600 space-y-1.5 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-3">
                    <div class="truncate"><span class="font-black text-gray-400 mr-1.5">${t('table.phone-label')}</span> ${sanitizeHTML(phoneInfo)}</div>
                    <div class="truncate"><span class="font-black text-gray-400 mr-1.5">${t('table.leader-manager-label')}</span> ${sanitizeHTML(leaderInfo)} / ${sanitizeHTML(managerInfo)}</div>
                    <div class="truncate"><span class="font-black text-gray-400 mr-1.5">${t('table.coach-list-label')}</span> ${sanitizeHTML(allCoaches)}</div>
                </div>

                <div class="sm:hidden bg-blue-50/70 border-b border-blue-100 px-4 py-3 flex flex-col gap-2.5">
                    <div class="text-xs font-bold text-blue-900 flex items-center">
                        <i class="fas fa-info-circle text-tkdBlue mr-1.5 shrink-0"></i>
                        <span>確認資料無誤後，請列印報名總表並完成單據上傳。</span>
                    </div>
                    <button onclick="window.goToMyRecordsForUpload()" 
                    class="w-full text-xs bg-tkdBlue text-white py-2.5 rounded-xl font-black hover:bg-blue-700 transition-colors shadow-sm flex items-center justify-center gap-1.5 active:scale-95">
                        <i class="fas fa-folder-open"></i>列印總表與上傳單據
                    </button>
                </div>

                <div class="hidden md:block overflow-x-auto">
                    <table class="w-full text-left whitespace-nowrap">
                        <thead class="bg-white text-[10px] text-gray-400 uppercase tracking-widest border-b border-gray-100">
                            <tr>
                                <th class="px-5 py-3 font-bold">${t('table.name')}</th>
                                <th class="px-5 py-3 font-bold">${t('table.birthday')}</th>
                                ${idHeaderHtml}
                                <th class="px-5 py-3 font-bold">${t('table.item')}</th>
                                <th class="px-5 py-3 font-bold">${t('table.group')}</th>
                                <th class="px-5 py-3 font-bold">${t('table.level')}</th>
                                <th class="px-5 py-3 font-bold text-right">${t('table.fee')}</th>
                                <th class="px-5 py-3 font-bold text-center">${t('table.action')}</th>
                            </tr>
                        </thead>
                        <tbody class="text-xs font-medium text-gray-700">
        `;

        let mobileCardsHtml = '<div class="md:hidden space-y-3 p-3 bg-gray-50/50">';

        regs.forEach(r => {
            // ✨ 安全防護：前端渲染總表時，同樣強制從大腦 (selectedTournament) 核對費用，完全杜絕任何顯示錯誤金額的可能
            const displayFee = (selectedTournament.fees && selectedTournament.fees[r.item] && selectedTournament.fees[r.item][r.group] !== undefined)
                ? (Number(selectedTournament.fees[r.item][r.group]) || 0)
                : (Number(r.fee) || 0);

            totalFee += displayFee;

            const namesArr = (r.playerName || '').split(' / ');
            const idsArr = (r.idNumber || '').split(' / ');
            const birthsArr = (r.birthday || '').split(' / ');
            const proxyBadge = r.proxyBy ? `<span class="mr-1.5 text-[10px] bg-purple-50 text-purple-600 border border-purple-200 px-1.5 py-0.5 rounded font-black inline-block align-middle relative -top-[1px]"><i class="fas fa-user-shield mr-1"></i>代加</span>` : '';
            const nameHtml = namesArr.map((n, idx) => `
                <div class="mb-1">
                    ${idx === 0 ? proxyBadge : ''}${sanitizeHTML(n)}
                </div>
            `).join('');

            const nameStr = namesArr.map((n, idx) => `${idx === 0 ? proxyBadge : ''}${sanitizeHTML(n)}`).join(' / ');
            const birthStr = birthsArr.map(b => sanitizeHTML(b) || '-').join(' / ');
            const idStr = idsArr.map(id => sanitizeHTML(id) || '-').join(' / ');

            const birthHtml = birthsArr.map(b => `<div class="mb-1 text-gray-500">${sanitizeHTML(b) || '-'}</div>`).join('');
            const idHtml = idsArr.map(id => `<div class="mb-1 text-gray-500">${sanitizeHTML(id) || '-'}</div>`).join('');
            const idDataHtml = requireId ? `<td class="px-5 py-3 font-bold align-top leading-relaxed tracking-wider">${idHtml}</td>` : '';

            let actionHtml = '';
            let actionCardHtml = '';
            if (canEditOrDelete) {
                actionHtml = `
                    <div class="flex flex-row justify-center gap-2 items-center">
                        <button onclick="editRecord('${r.id}')" class="text-tkdBlue bg-blue-50 hover:bg-tkdBlue hover:text-white border border-blue-100 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap shadow-sm"><i class="fas fa-edit mr-1"></i>${t('table.action-edit') || '修改'}</button>
                        <button onclick="promptDelete('${r.id}')" class="text-red-500 bg-red-50 hover:bg-red-500 hover:text-white border border-red-100 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap shadow-sm"><i class="fas fa-trash-alt mr-1"></i>${t('table.action-delete') || '刪除'}</button>
                    </div>
                `;
                actionCardHtml = `
                    <div class="grid grid-cols-2 gap-2.5 pt-3 mt-3 border-t border-gray-100">
                        <button onclick="editRecord('${r.id}')" class="w-full text-tkdBlue bg-blue-50 hover:bg-tkdBlue hover:text-white border border-blue-200 py-2.5 rounded-xl text-xs font-black transition-colors flex items-center justify-center shadow-sm"><i class="fas fa-edit mr-1.5"></i>${t('table.action-edit') || '修改資料'}</button>
                        <button onclick="promptDelete('${r.id}')" class="w-full text-red-600 bg-red-50 hover:bg-red-500 hover:text-white border border-red-200 py-2.5 rounded-xl text-xs font-black transition-colors flex items-center justify-center shadow-sm"><i class="fas fa-trash-alt mr-1.5"></i>${t('table.action-delete') || '刪除'}</button>
                    </div>
                `;
            } else {
                actionHtml = `<span class="text-[11px] font-bold text-red-500 bg-red-50 px-2 py-1 rounded border border-red-100 cursor-not-allowed select-none">${t('reg.status-closed') || '已截止'}</span>`;
                actionCardHtml = `
                    <div class="pt-3 mt-3 border-t border-gray-100 text-center">
                        <span class="text-xs font-bold text-red-500 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100 inline-block">${t('reg.status-closed') || '已截止報名修改'}</span>
                    </div>
                `;
            }

            const idCardRowHtml = requireId ? `
                <div class="flex justify-between items-center text-xs py-0.5">
                    <span class="text-gray-500 font-bold">${t('table.id') || '身分證字號'}</span>
                    <span class="font-bold text-gray-700">${idStr}</span>
                </div>
            ` : '';

            html += `
                <tr class="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                    <td class="px-5 py-3 font-black text-gray-900 text-sm align-top leading-relaxed">${nameHtml}</td>
                    <td class="px-5 py-3 font-bold align-top leading-relaxed tracking-wider">${birthHtml}</td>
                    ${idDataHtml}
                    <td class="px-5 py-3 font-bold text-tkdBlue align-top pt-4">${sanitizeHTML(getLang(r.item))}</td>
                    <td class="px-5 py-3 text-gray-600 align-top pt-4">${sanitizeHTML(getLang(r.group))}</td>
                    <td class="px-5 py-3 font-black text-red-600 align-top pt-4">${sanitizeHTML(getLang(r.level))}</td>
                    <td class="px-5 py-3 text-right font-black text-gray-800 align-top pt-4">$ ${displayFee}</td>
                    <td class="px-5 py-3 text-center align-top pt-3">
                        ${actionHtml}
                    </td>
                </tr>
            `;

            mobileCardsHtml += `
                <article class="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm hover:border-blue-300 transition-colors">
                    <div class="flex items-center justify-between gap-3 pb-3 border-b border-gray-100">
                        <h4 class="text-base font-black text-gray-900 leading-snug truncate">${nameStr}</h4>
                        <span class="shrink-0 text-sm font-black text-tkdRed bg-red-50 border border-red-100 px-3 py-1 rounded-xl">
                            $ ${displayFee}
                        </span>
                    </div>

                    <div class="py-3 space-y-2 border-b border-gray-100">
                        <div class="flex justify-between items-center text-xs py-0.5">
                            <span class="text-gray-500 font-bold">${t('table.item') || '參賽項目'}</span>
                            <span class="font-black text-tkdBlue">${sanitizeHTML(getLang(r.item))}</span>
                        </div>
                        <div class="flex justify-between items-center text-xs py-0.5">
                            <span class="text-gray-500 font-bold">${t('table.group') || '組別'}</span>
                            <span class="font-bold text-gray-800">${sanitizeHTML(getLang(r.group))}</span>
                        </div>
                        <div class="flex justify-between items-center text-xs py-0.5">
                            <span class="text-gray-500 font-bold">${t('table.level') || '量級/級別'}</span>
                            <span class="font-black text-red-600">${sanitizeHTML(getLang(r.level))}</span>
                        </div>
                        <div class="flex justify-between items-center text-xs py-0.5">
                            <span class="text-gray-500 font-bold">${t('table.birthday') || '出生年月日'}</span>
                            <span class="font-bold text-gray-700">${birthStr}</span>
                        </div>
                        ${idCardRowHtml}
                    </div>

                    ${actionCardHtml}
                </article>
            `;
        });

        mobileCardsHtml += `
            <div class="bg-red-50/80 border border-red-200 rounded-2xl p-4 flex justify-between items-center mt-2">
                <span class="font-bold text-gray-700 text-sm">${t('table.total-label') || '此單位總計報名費用：'}</span>
                <span class="font-black text-tkdRed text-lg">NT$ ${totalFee}</span>
            </div>
        </div>`;

        html += `
                        </tbody>
                        <tfoot class="bg-red-50/50 border-t border-gray-200">
                            <tr>
                                <td colspan="${colspanNum}" class="px-5 py-4 text-right font-bold text-gray-600 text-sm">${t('table.total-label') || '此單位總計報名費用：'}</td>
                                <td colspan="2" class="px-5 py-4 text-left font-black text-tkdRed text-lg tracking-wide">NT$ ${totalFee}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                ${mobileCardsHtml}
            </div> `;

        // ✨ DOM Diffing 邏輯：有差異才更新
        let unitCard = document.getElementById(cardId);
        if (!unitCard) {
            unitCard = document.createElement('div');
            unitCard.id = cardId;
            unitCard.className = "bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-6 fade-in";
            unitCard.innerHTML = html;
            unitCard._rawHTML = html;
            userBody.appendChild(unitCard);
        } else {
            if (unitCard._rawHTML !== html) {
                unitCard.innerHTML = html;
                unitCard._rawHTML = html;
            }
            // 利用 appendChild 將已存在的卡片移到最新的排序位置
            userBody.appendChild(unitCard);
        }
    });

    // ✨ 移除已經不存在的幽靈卡片
    Array.from(userBody.children).forEach(child => {
        if (!currentCardIds.has(child.id)) {
            child.remove();
        }
    });
};

// ==========================================
// 5. 列印 PDF 功能
// ==========================================

window.lastPageBeforePrint = 'home';
window.currentPdfFilename = '報名總表.pdf';

window.backFromSummary = () => {
    const summaryContainer = document.getElementById('summary-content');
    if (summaryContainer) {
        summaryContainer.innerHTML = '';
    }

    document.title = '韻動國際 賽事報名系統';

    if (window.navigate) window.navigate(window.lastPageBeforePrint || 'home');
};

window.downloadPDF = async () => { // ✨ 加入 async
    const btn = document.getElementById('btn-download-pdf');
    const content = document.getElementById('summary-content');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> 正在下載字型與產生 PDF...';

    // 1. ✨ 等待所有字型下載並準備就緒，防止中文字體缺漏或跑版
    try {
        if (document.fonts) {
            await document.fonts.ready;
        }
    } catch (e) {
        console.warn("字型載入等待失敗，將直接進行產生：", e);
    }

    // 2. ✨ 動態載入：點擊時才下載 html2pdf 套件
    if (!window.html2pdf) {
        try {
            const html2pdfModule = await import('html2pdf.js');
            // 注意 html2pdf 的 default 導出問題
            window.html2pdf = html2pdfModule.default || html2pdfModule;
        } catch (e) {
            alert("PDF 匯出套件載入失敗，請確認網路狀態後重試！");
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            return;
        }
    }

    // 3. ✨ 強制設定 PDF 容器中文字型，並稍微延遲以利渲染器完全排版完畢
    content.style.fontFamily = "'Noto Sans TC', 'Microsoft JhengHei', sans-serif";

    // 解決一些在部分手機/瀏覽器中可能發生的渲染延遲跑版問題
    await new Promise(resolve => setTimeout(resolve, 250));

    const opt = {
        margin: 5,
        filename: window.currentPdfFilename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
            scale: 2,
            useCORS: true,
            windowWidth: 800,
            logging: false,
            letterRendering: true // 優化文字排版鋸齒
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    window.html2pdf().set(opt).from(content).save().then(() => {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }).catch(err => {
        console.error("PDF 產生失敗：", err);
        alert("PDF 匯出失敗，請稍後再試！");
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    });
};

window.printTeamSummary = (tourId, unit, subTeam = '', printMode = null) => {
    const tour = appData.tournaments.find(t => t.id === tourId);
    let regs = [];

    // 修改：將 subTeam 納入嚴格過濾條件
    if (printMode === 'FRONTEND') {
        regs = appData.registrations.filter(r => r.userId === currentUser?.uid && r.tournamentId === tourId && r.unit === unit && (r.subTeam || '') === subTeam);
    } else if (printMode) {
        regs = appData.registrations.filter(r => r.tournamentId === tourId && r.unit === unit && (r.subTeam || '') === subTeam && (r.email || '未知帳號') === printMode);
    } else {
        regs = appData.registrations.filter(r => r.userId === currentUser?.uid && r.tournamentId === tourId && r.unit === unit && (r.subTeam || '') === subTeam);
    }

    if (!tour || regs.length === 0) return;

    const displayUnit = subTeam ? `${unit}${subTeam}` : unit;
    window.currentPdfFilename = `${tour.name}-${displayUnit}-報名總表.pdf`;

    // 四層級嚴格排序邏輯
    regs.sort((a, b) => {
        const itemA = a.item || '';
        const itemB = b.item || '';
        const itemOrderList = tour.itemOrder || [];
        const itemIndexA = itemOrderList.indexOf(itemA);
        const itemIndexB = itemOrderList.indexOf(itemB);
        if (itemIndexA !== -1 && itemIndexB !== -1 && itemIndexA !== itemIndexB) return itemIndexA - itemIndexB;
        if (itemIndexA !== -1 && itemIndexB === -1) return -1;
        if (itemIndexA === -1 && itemIndexB !== -1) return 1;
        if (itemA !== itemB) return itemA.localeCompare(itemB, 'zh-TW');

        const groupOrderList = (tour.groupOrder && tour.groupOrder[itemA]) ? tour.groupOrder[itemA] : [];
        const groupA = a.group || '';
        const groupB = b.group || '';
        const groupIndexA = groupOrderList.indexOf(groupA);
        const groupIndexB = groupOrderList.indexOf(groupB);
        if (groupIndexA !== -1 && groupIndexB !== -1 && groupIndexA !== groupIndexB) return groupIndexA - groupIndexB;
        if (groupIndexA !== -1 && groupIndexB === -1) return -1;
        if (groupIndexA === -1 && groupIndexB !== -1) return 1;
        if (groupA !== groupB) return groupA.localeCompare(groupB, 'zh-TW');

        const levelOrderList = (tour.linkage && tour.linkage[itemA] && tour.linkage[itemA][groupA]) ? tour.linkage[itemA][groupA] : [];
        const levelA = a.level || '';
        const levelB = b.level || '';
        const levelIndexA = levelOrderList.indexOf(levelA);
        const levelIndexB = levelOrderList.indexOf(levelB);
        if (levelIndexA !== -1 && levelIndexB !== -1 && levelIndexA !== levelIndexB) return levelIndexA - levelIndexB;
        if (levelIndexA !== -1 && levelIndexB === -1) return -1;
        if (levelIndexA === -1 && levelIndexB !== -1) return 1;
        if (levelA !== levelB) return levelA.localeCompare(levelB, 'zh-TW');

        const birthA = (a.birthday || '').split(' / ')[0];
        const birthB = (b.birthday || '').split(' / ')[0];
        const timeA = new Date(birthA).getTime();
        const timeB = new Date(birthB).getTime();
        if (!isNaN(timeA) && !isNaN(timeB)) return timeA - timeB;
        return birthA.localeCompare(birthB, 'zh-TW');
    });

    const requireId = !!(tour.groupSettings && Object.values(tour.groupSettings).some(item =>
        Object.values(item).some(g => g.requireId === 'true' || g.requireId === true)
    ));
    const getZh = (str) => typeof str === 'string' ? str.split(',')[0].trim() : str;

    let totalFee = 0;
    const tbodyHTML = regs.map((r, idx) => {
        // ✨ 安全防護：列印時強制重新從賽事設定中撈取真實定價，徹底免疫本地快取污染攻擊
        const correctFee = (tour.fees && tour.fees[r.item] && tour.fees[r.item][r.group] !== undefined)
            ? (Number(tour.fees[r.item][r.group]) || 0)
            : (Number(r.fee) || 0);

        totalFee += correctFee;

        const namesArr = (r.playerName || '').split(' / ');
        const idsArr = (r.idNumber || '').split(' / ');
        const birthsArr = (r.birthday || '').split(' / ');
        const nameDivs = namesArr.map(n => `<div style="margin-bottom:4px; word-break: break-all;">${n}</div>`).join('');
        const birthDivs = birthsArr.map(b => `<div style="margin-bottom:4px; color:#555;">${b || '-'}</div>`).join('');
        const idDivs = idsArr.map(id => `<div style="margin-bottom:4px; color:#555; word-break: break-all;">${id || '-'}</div>`).join('');
        const idDataHtml = requireId ? `<td style="border:1px solid #ccc; padding: 8px; text-align:center; vertical-align:top;">${idDivs}</td>` : '';

        return `
            <tr>
                <td style="border:1px solid #ccc; padding: 8px; font-weight:bold; vertical-align:top;">${nameDivs}</td>
                <td style="border:1px solid #ccc; padding: 8px; text-align:center; vertical-align:top;">${birthDivs}</td>
                ${idDataHtml}
                <td style="border:1px solid #ccc; padding: 8px; vertical-align:top;">${getZh(r.item)}</td>
                <td style="border:1px solid #ccc; padding: 8px; vertical-align:top;">${getZh(r.group)}</td>
                <td style="border:1px solid #ccc; padding: 8px; vertical-align:top; color:#D32F2F; font-weight:900;">${getZh(r.level)}</td>
                <td style="border:1px solid #ccc; padding: 8px; text-align:right; vertical-align:top; font-weight:bold;">${correctFee}</td>
            </tr>
        `;
    }).join('');

    const leader = regs[0].leader || '';
    const coach = [regs[0].coach1, regs[0].coach2, regs[0].coach3].filter(c => c).join('、') || '';
    const manager = regs[0].manager || '';
    const phone = regs[0].phone || '未提供';

    // ✨定義寬度百分比
    const w_name = "17%";    // 選手姓名
    const w_birth = "11%";   // 出生日期
    const w_id = "13%";      // 身分證 (如果有)
    const w_item = "11%";    // 項目
    const w_group = "16%";   // 組別
    const w_level = "20%";   // 級別 (通常字較多，給寬一點)
    const w_fee = "12%";      // 費用

    // 如果不收集身分證，將其比例分配給姓名與級別
    const idHeaderHtml = requireId
        ? `<th style="border:1px solid #ccc; padding: 10px; width: ${w_id};">身分證/護照</th>`
        : '';

    const finalW_name = requireId ? w_name : "22%";
    const finalW_level = requireId ? w_level : "25%";
    const colspanNum = requireId ? 6 : 5;

    // ✨ 新增：解析匯款資訊並產生 HTML (含換行處理)
    const remittanceHTML = tour.remittance ? `
        <div style="margin-top: 15px; padding: 12px; border: 2px dashed #1976D2; background-color: #F0F8FF; border-radius: 8px; font-size: 14px; line-height: 1.6;">
            <strong style="color: #1976D2; font-size: 15px;">匯款資訊：</strong><br>
            ${sanitizeHTML(tour.remittance).replace(/\n/g, '<br>')}
        </div>
    ` : '';

    const printHTML = `
        <style>
            @media print {
                @page { margin: 1cm; }
                body { background: white !important; }
                main { padding: 0 !important; margin: 0 !important; }
                #page-summary > div { padding: 0 !important; border: none !important; box-shadow: none !important; }
                .no-print { display: none !important; }
            }
        </style>
        <div class="print-wrapper" style="font-family: 'Noto Sans TC', sans-serif; max-width: 800px; margin: 0 auto; color: black; background: white;">
            <h1 style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px; font-size: 20px; font-weight: 900;">${tour.name}<br>單位報名總表</h1>
            <div style="font-size: 14px; margin-bottom: 20px;">
                <p style="margin: 4px 0;"><strong>參賽單位：</strong> <span style="font-size:18px; color: #1976D2; font-weight: 900;">${displayUnit}</span></p>
                <p style="margin: 4px 0;"><strong>教練：</strong> ${coach} &nbsp;&nbsp;&nbsp; <strong>領隊：</strong> ${leader} &nbsp;&nbsp;&nbsp; <strong>管理：</strong> ${manager}</p>
                <p style="margin: 4px 0;"><strong>電話：</strong> ${phone}</p>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed;">
                <thead style="background-color: #f3f4f6;">
                    <tr>
                        <th style="border:1px solid #ccc; padding: 10px; text-align:left; width: ${finalW_name};">選手姓名</th>
                        <th style="border:1px solid #ccc; padding: 10px; text-align:center; width: ${w_birth};">出生年月日</th>
                        ${idHeaderHtml}
                        <th style="border:1px solid #ccc; padding: 10px; text-align:left; width: ${w_item};">參賽項目</th>
                        <th style="border:1px solid #ccc; padding: 10px; text-align:left; width: ${w_group};">組別</th>
                        <th style="border:1px solid #ccc; padding: 10px; text-align:left; width: ${finalW_level};">級別/量級</th>
                        <th style="border:1px solid #ccc; padding: 10px; text-align:right; width: ${w_fee};">費用</th>
                    </tr>
                </thead>
                <tbody>${tbodyHTML}</tbody>
                <tfoot>
                    <tr>
                        <td colspan="${colspanNum}" style="border:1px solid #ccc; padding: 12px 10px; text-align:right; font-weight:bold; font-size: 16px;">總計應繳金額：</td>
                        <td style="border:1px solid #ccc; padding: 12px 10px; text-align:right; font-weight:900; font-size: 18px; color: #D32F2F;">$ ${totalFee}</td>
                    </tr>
                </tfoot>
            </table>

            ${remittanceHTML}

            <div style="margin-top: 40px; display: flex; justify-content: flex-end; page-break-inside: avoid;">
        <div style="border-top: 1px solid #000; width: 200px; text-align: center; padding-top: 10px; font-size: 14px;">
            領隊 / 教練簽名
        </div>
    </div>
`;

    const summaryContainer = document.getElementById('summary-content');
    if (summaryContainer) summaryContainer.innerHTML = printHTML;

    const activePage = document.querySelector('.page-section.active');
    if (activePage) window.lastPageBeforePrint = activePage.id.replace('page-', '');

    if (window.navigate) window.navigate('summary');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.adminAddRecord = async (prefillEmail = null, prefillUnit = null, prefillSubTeam = null) => {
    const filterEl = document.getElementById('admin-tour-filter');
    const tourId = filterEl ? filterEl.value : null;

    if (!tourId) return alert('請先選擇一場賽事！');

    const tour = appData.tournaments.find(t => t.id === tourId) ||
        (appData.deletedTournaments && appData.deletedTournaments.find(t => t.id === tourId));
    if (!tour) return;

    let targetUid = currentUser.uid;
    let finalEmail = currentUser.email;

    if (!prefillEmail) {
        const inputEmail = prompt("請輸入這筆資料要歸屬的教練帳號 (Email)：\n(這會將報名資料掛在該教練帳號下，讓他可以自行管理。)\n\n若留空，則會記錄在您的管理員帳號下。");
        if (inputEmail === null) return;
        if (inputEmail.trim() !== '') {
            prefillEmail = inputEmail.trim().toLowerCase();
        }
    }

    if (prefillEmail && prefillEmail !== currentUser.email) {
        const existingReg = appData.registrations.find(r => r.email === prefillEmail);
        if (existingReg) {
            targetUid = existingReg.userId;
            finalEmail = existingReg.email;
        } else {
            try {
                // ✨ 修正：局部管理員無法在本地快取找到跨區教練，改呼叫後端 API 安全取得 UID
                const getUidFn = httpsCallable(functions, 'getUserUidByEmail');
                const result = await getUidFn({ email: prefillEmail });
                if (result.data && result.data.uid) {
                    targetUid = result.data.uid;
                    finalEmail = prefillEmail;
                } else {
                    alert(`系統中找不到「${prefillEmail}」的註冊資料，請確認該教練曾使用 Google 登入過系統。`);
                    return;
                }
            } catch (error) {
                console.error(error);
                alert(`查詢帳號失敗：${error.message}`);
                return;
            }
        }
    }

    let overrideUidEl = document.getElementById('overrideUid');
    if (!overrideUidEl) {
        overrideUidEl = document.createElement('input');
        overrideUidEl.type = 'hidden'; overrideUidEl.id = 'overrideUid';
        document.getElementById('registrationForm').appendChild(overrideUidEl);
    }
    let overrideEmailEl = document.getElementById('overrideEmail');
    if (!overrideEmailEl) {
        overrideEmailEl = document.createElement('input');
        overrideEmailEl.type = 'hidden'; overrideEmailEl.id = 'overrideEmail';
        document.getElementById('registrationForm').appendChild(overrideEmailEl);
    }

    overrideUidEl.value = targetUid;
    overrideEmailEl.value = finalEmail;

    setSelectedTournament(tour);
    const activePage = document.querySelector('.page-section.active');
    window.sourcePageForEdit = activePage ? activePage.id.replace('page-', '') : 'admin';

    if (window.navigate) window.navigate('register');

    document.getElementById('editRecordId').value = '';
    document.getElementById('registrationForm').reset();
    const playerContainer = document.getElementById('dynamic-players-container');
    if (playerContainer) playerContainer.innerHTML = '';

    if (prefillUnit) {
        document.getElementById('unit').value = prefillUnit;
        if (prefillSubTeam) document.getElementById('subTeam').value = prefillSubTeam;

        const pastReg = appData.registrations.find(r => r.unit === prefillUnit && (r.subTeam || '') === (prefillSubTeam || '') && r.email === finalEmail);
        if (pastReg) {
            document.getElementById('phone').value = pastReg.phone || '';
            document.getElementById('leader').value = pastReg.leader || '';
            document.getElementById('manager').value = pastReg.manager || '';
            document.getElementById('coach1').value = pastReg.coach1 || '';
            document.getElementById('coach2').value = pastReg.coach2 || '';
            document.getElementById('coach3').value = pastReg.coach3 || '';
        }
    }

    if (window.renderFormOptions) window.renderFormOptions();
    if (window.renderUserTables) window.renderUserTables();

    const cancelBtn = document.getElementById('btn-cancel-edit');
    if (cancelBtn) {
        cancelBtn.innerHTML = '<i class="fas fa-arrow-left mr-2"></i>取消並返回後台';
        cancelBtn.className = "py-4 px-8 bg-gray-800 text-white font-black rounded-xl hover:bg-black transition-colors";
        cancelBtn.classList.remove('hidden');
    }

    document.getElementById('edit-badge')?.classList.add('hidden');
    window.checkTournamentStatus();

    setTimeout(() => {
        document.getElementById('reg-form-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
};

window.adminAddRecord = (prefillEmail = null, prefillUnit = null, prefillSubTeam = null) => { // 增加預填參數
    const filterEl = document.getElementById('admin-tour-filter');
    const tourId = filterEl ? filterEl.value : null;

    if (!tourId) return alert('請先選擇一場賽事！');

    const tour = appData.tournaments.find(t => t.id === tourId) ||
        (appData.deletedTournaments && appData.deletedTournaments.find(t => t.id === tourId));
    if (!tour) return;

    let targetUid = currentUser.uid;
    let finalEmail = currentUser.email;

    if (!prefillEmail) {
        const inputEmail = prompt("請輸入這筆資料要歸屬的教練帳號 (Email)：\n(這會將報名資料掛在該教練帳號下，讓他可以自行管理。)\n\n若留空，則會記錄在您的管理員帳號下。");
        if (inputEmail === null) return;
        if (inputEmail.trim() !== '') {
            prefillEmail = inputEmail.trim().toLowerCase();
        }
    }

    if (prefillEmail && prefillEmail !== currentUser.email) {
        const existingReg = appData.registrations.find(r => r.email === prefillEmail);
        if (existingReg) {
            targetUid = existingReg.userId;
            finalEmail = existingReg.email;
        } else {
            alert(`系統中找不到「${prefillEmail}」的歷史報名紀錄，無法取得該帳號的驗證識別碼。\n為確保資料權限正確，請該教練先自行登入系統一次。`);
            return;
        }
    }

    let overrideUidEl = document.getElementById('overrideUid');
    if (!overrideUidEl) {
        overrideUidEl = document.createElement('input');
        overrideUidEl.type = 'hidden'; overrideUidEl.id = 'overrideUid';
        document.getElementById('registrationForm').appendChild(overrideUidEl);
    }
    let overrideEmailEl = document.getElementById('overrideEmail');
    if (!overrideEmailEl) {
        overrideEmailEl = document.createElement('input');
        overrideEmailEl.type = 'hidden'; overrideEmailEl.id = 'overrideEmail';
        document.getElementById('registrationForm').appendChild(overrideEmailEl);
    }

    overrideUidEl.value = targetUid;
    overrideEmailEl.value = finalEmail;

    setSelectedTournament(tour);
    const activePage = document.querySelector('.page-section.active');
    window.sourcePageForEdit = activePage ? activePage.id.replace('page-', '') : 'admin';

    if (window.navigate) window.navigate('register');

    document.getElementById('editRecordId').value = '';
    document.getElementById('registrationForm').reset();
    const playerContainer = document.getElementById('dynamic-players-container');
    if (playerContainer) playerContainer.innerHTML = '';

    if (prefillUnit) {
        document.getElementById('unit').value = prefillUnit;
        if (prefillSubTeam) document.getElementById('subTeam').value = prefillSubTeam; // 填入分隊

        // 修正：連同分隊一起過濾歷史教練資料
        const pastReg = appData.registrations.find(r => r.unit === prefillUnit && (r.subTeam || '') === (prefillSubTeam || '') && r.email === finalEmail);
        if (pastReg) {
            document.getElementById('phone').value = pastReg.phone || '';
            document.getElementById('leader').value = pastReg.leader || '';
            document.getElementById('manager').value = pastReg.manager || '';
            document.getElementById('coach1').value = pastReg.coach1 || '';
            document.getElementById('coach2').value = pastReg.coach2 || '';
            document.getElementById('coach3').value = pastReg.coach3 || '';
        }
    }

    if (window.renderFormOptions) window.renderFormOptions();
    if (window.renderUserTables) window.renderUserTables();

    const cancelBtn = document.getElementById('btn-cancel-edit');
    if (cancelBtn) {
        cancelBtn.innerHTML = '<i class="fas fa-arrow-left mr-2"></i>取消並返回後台';
        cancelBtn.className = "py-4 px-8 bg-gray-800 text-white font-black rounded-xl hover:bg-black transition-colors";
        cancelBtn.classList.remove('hidden');
    }

    document.getElementById('edit-badge')?.classList.add('hidden');
    window.checkTournamentStatus();

    setTimeout(() => {
        document.getElementById('reg-form-container')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
};

// ==========================================
// 6. 報名表單修改與刪除
// ==========================================

window.editRecord = (id) => {
    // 管理員與一般使用者的監聽更新時間不同，從所有可用快取尋找紀錄。
    const allAvailableRegs = [
        ...(appData.registrations || []),
        ...(window.adminCurrentTourRegs || []),
        ...(window.myOwnRegs || [])
    ];
    const r = allAvailableRegs.find(record => record.id === id);
    if (!r) {
        console.error("找不到該筆紀錄 ID:", id);
        return alert("系統找不到該筆資料，請重新整理頁面再試。");
    }

    // 相容較舊的紀錄：早期資料可能只有賽事名稱，沒有 tournamentId。
    const tour = (appData.tournaments || []).find(t => t.id === r.tournamentId)
        || (appData.tournaments || []).find(t => t.name === r.tournamentName)
        || (selectedTournament?.id === r.tournamentId ? selectedTournament : null);
    if (!tour) {
        console.error("找不到紀錄所屬賽事:", r.tournamentId, r.tournamentName);
        return alert("找不到這筆紀錄所屬的賽事設定，請重新整理頁面後再試。");
    }

    setSelectedTournament(tour);

    window.sourcePageForEdit = document.querySelector('.page-section.active')?.id.replace('page-', '') || 'register';

    if (window.navigate) window.navigate('register');

    // 等路由完成項目選單與動態欄位初始化後再回填，避免資料被 renderFormOptions 清掉。
    requestAnimationFrame(() => {
        const form = document.getElementById('registrationForm');
        if (!form) return;
        form.reset();

        const ensureHiddenField = (fieldId) => {
            let field = document.getElementById(fieldId);
            if (!field) {
                field = document.createElement('input');
                field.type = 'hidden';
                field.id = fieldId;
                form.appendChild(field);
            }
            return field;
        };

        const editRecordIdEl = document.getElementById('editRecordId');
        const overrideUidEl = ensureHiddenField('overrideUid');
        const overrideEmailEl = ensureHiddenField('overrideEmail');
        if (editRecordIdEl) editRecordIdEl.value = id;
        overrideUidEl.value = r.userId || '';
        overrideEmailEl.value = r.email || '';

        const setInputValue = (fieldId, value) => {
            const field = document.getElementById(fieldId);
            if (field) field.value = value ?? '';
        };
        const selectStoredValue = (selectEl, storedValue) => {
            if (!selectEl) return false;
            const value = String(storedValue ?? '').trim();
            if (!value) return false;

            // 修改時使用資料庫內的原始值，不以翻譯文字或目前設定替換。
            const matchingOption = Array.from(selectEl.options).find(option => option.value === value);
            if (matchingOption) {
                selectEl.value = value;
                return true;
            }

            // 設定若曾調整，仍將原始值原樣加入選單，避免舊資料被改寫或遺失。
            selectEl.add(new Option(getLang(value), value));
            selectEl.value = value;
            return true;
        };
        const splitStoredPlayers = (value) => {
            if (Array.isArray(value)) return value.map(part => String(part ?? '').trim());
            if (value === null || value === undefined || value === '') return [];
            // 多人資料固定以「空白 / 空白」分隔，不能拆到生日中的 YYYY/MM/DD。
            return String(value).split(/\s+\/\s+/).map(part => part.trim());
        };

        // 先建立乾淨的連動選單，再依「項目 → 組別 → 級別」順序還原。
        if (window.renderFormOptions) window.renderFormOptions();
        setInputValue('unit', r.unit);
        setInputValue('phone', r.phone);
        setInputValue('leader', r.leader);
        setInputValue('manager', r.manager);
        setInputValue('coach1', r.coach1);
        setInputValue('coach2', r.coach2);
        setInputValue('coach3', r.coach3);
        setInputValue('subTeam', r.subTeam);

        const itemEl = document.getElementById('item');
        const groupEl = document.getElementById('group');
        const levelEl = document.getElementById('level');
        selectStoredValue(itemEl, r.item);
        window.onItemChange();
        selectStoredValue(groupEl, r.group);
        window.onGroupChange();
        selectStoredValue(levelEl, r.level);

        const names = splitStoredPlayers(r.playerName);
        const births = splitStoredPlayers(r.birthday);
        const ids = splitStoredPlayers(r.idNumber);
        const storedPlayerCount = Math.max(names.length, births.length, ids.length, 1);
        let groupSetting = {};
        if (tour.groupSettings?.[r.item]?.[r.group]) {
            groupSetting = { ...tour.groupSettings[r.item][r.group] };
        } else if (tour.itemSettings?.[r.item]) {
            groupSetting = { ...tour.itemSettings[r.item] };
        }
        if (groupSetting.requireId === true) groupSetting.requireId = 'true';
        if (ids.some(Boolean)) groupSetting.requireId = 'true';

        // 編輯時一律依原始紀錄的人數重建欄位，再完整填入每位選手資料。
        window.renderDynamicPlayers(storedPlayerCount, r.item, groupSetting);

        for (let i = 0; i < storedPlayerCount; i++) {
            const nameInput = document.getElementById(`playerName_${i}`);
            const birthdayInput = document.getElementById(`birthday_${i}`);
            const idInput = document.getElementById(`idNumber_${i}`);

            if (nameInput) nameInput.value = names[i] || '';
            if (birthdayInput) {
                const birthday = births[i] || '';
                birthdayInput.value = birthday;
                birthdayInput.dataset.rawInput = birthday;
                birthdayInput._flatpickr?.setDate(birthday, false);
            }
            if (idInput) idInput.value = ids[i] || '';
        }

        // 強制重新渲染下方表格，使其顯示該紀錄原始擁有者的資料。
        if (window.renderUserTables) window.renderUserTables();

        const cancelBtn = document.getElementById('btn-cancel-edit');
        if (cancelBtn) {
            if (window.sourcePageForEdit === 'admin') {
                cancelBtn.innerHTML = '<i class="fas fa-arrow-left mr-2"></i>取消並返回後台';
                cancelBtn.classList.replace('bg-gray-200', 'bg-gray-800');
                cancelBtn.classList.replace('text-gray-700', 'text-white');
                cancelBtn.classList.replace('hover:bg-gray-300', 'hover:bg-black');
            } else {
                cancelBtn.innerHTML = '<i class="fas fa-times mr-2"></i>取消編輯';
                cancelBtn.classList.replace('bg-gray-800', 'bg-gray-200');
                cancelBtn.classList.replace('text-white', 'text-gray-700');
                cancelBtn.classList.replace('hover:bg-black', 'hover:bg-gray-300');
            }
            cancelBtn.classList.remove('hidden');
        }

        document.getElementById('edit-badge')?.classList.remove('hidden');
        window.checkTournamentStatus();

        const playerContainer = document.getElementById('dynamic-players-container');
        if (playerContainer && playerContainer.parentElement) {
            playerContainer.parentElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
};

window.cancelEdit = () => {
    document.getElementById('editRecordId').value = '';

    // ✨ 修正 1：完整重置整個表單（包含單位、教練、電話等所有欄位）
    const form = document.getElementById('registrationForm');
    if (form) form.reset();

    // 清除代為報名的身分暫存
    const overrideUidEl = document.getElementById('overrideUid');
    const overrideEmailEl = document.getElementById('overrideEmail');
    if (overrideUidEl) overrideUidEl.value = '';
    if (overrideEmailEl) overrideEmailEl.value = '';

    // 動態產生的選手欄位也清空
    const playerContainer = document.getElementById('dynamic-players-container');
    if (playerContainer) playerContainer.innerHTML = '';

    const cancelBtn = document.getElementById('btn-cancel-edit');
    if (cancelBtn) cancelBtn.classList.add('hidden');
    document.getElementById('edit-badge')?.classList.add('hidden');

    window.checkTournamentStatus();

    // 執行返回邏輯，並確保表格重新渲染
    if (window.sourcePageForEdit && window.sourcePageForEdit === 'admin') {
        if (window.navigate) window.navigate('admin');
        setTimeout(() => {
            if (window.executeAdminRegistrationsRender) window.executeAdminRegistrationsRender();
        }, 100);
    } else {
        // ✨ 修正 2：如果本來就在前台，取消後強制重繪表格，確保顯示回「自己」的資料
        if (window.renderUserTables) window.renderUserTables();

        const tableBody = document.getElementById('userTableBody');
        if (tableBody) {
            tableBody.closest('.bg-white').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // 清除記憶
    window.sourcePageForEdit = null;
};

window.promptDelete = (id) => {
    setRecordToDelete(id);
    const modal = document.getElementById('deleteModal');
    modal.classList.remove('hidden');
    setTimeout(() => { modal.firstElementChild.classList.remove('scale-95'); modal.firstElementChild.classList.add('scale-100'); }, 10);
};

window.closeDeleteModal = () => {
    setRecordToDelete(null);
    const modal = document.getElementById('deleteModal');
    modal.firstElementChild.classList.remove('scale-100'); modal.firstElementChild.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

// ==========================================
// 📌 單位報名總表與匯款紀錄上傳邏輯
// ==========================================
window.currentSubTourId = null;
window.currentSubUnit = null;
window.currentSubSubTeam = null;

window.tempSubSummaryUrl = null;
window.tempSubSummaryName = null;
window.tempSubRemittanceUrl = null;
window.tempSubRemittanceName = null;

window.openUploadSummaryModal = (tId, unit, subTeam) => {
    window.currentSubTourId = tId;
    window.currentSubUnit = unit;
    window.currentSubSubTeam = subTeam;

    const displayUnit = subTeam ? `${unit} (${subTeam})` : unit;
    document.getElementById('upload-summary-unit-display').innerText = displayUnit;

    // 尋找已有的上傳紀錄 (一般使用者端使用 myUnitSubmissions)
    const sub = (appData.myUnitSubmissions || []).find(s =>
        s.tournamentId === tId && s.unit === unit && s.subTeam === subTeam
    );

    // 重設狀態與暫存變數
    window.tempSubSummaryUrl = sub ? sub.summaryFormUrl : null;
    window.tempSubSummaryName = sub ? sub.summaryFormFileName : null;

    // 重設檔案輸入框
    document.getElementById('upload-summary-file').value = '';

    // 更新簽名總表 UI
    const summaryPreview = document.getElementById('upload-summary-preview-container');
    if (window.tempSubSummaryUrl) {
        summaryPreview.classList.remove('hidden');
        document.getElementById('upload-summary-filename').innerText = window.tempSubSummaryName || '查看已上傳檔案';
        document.getElementById('upload-summary-preview-link').href = window.tempSubSummaryUrl;
    } else {
        summaryPreview.classList.add('hidden');
    }

    // 更新審核回饋 UI
    const feedbackContainer = document.getElementById('upload-summary-feedback-container');
    if (sub && sub.status && sub.status !== 'none') {
        feedbackContainer.classList.remove('hidden');
        const statusEl = document.getElementById('upload-summary-feedback-status');
        const notesEl = document.getElementById('upload-summary-feedback-notes');

        if (sub.status === 'pending') {
            statusEl.className = "inline-flex items-center px-2.5 py-0.5 text-xs font-bold rounded-lg border border-orange-100 bg-orange-50 text-orange-600 shrink-0";
            statusEl.innerText = "⏳ 待確認";
            notesEl.innerText = "您的上傳資料已送出，管理員正在審核中，請稍候。";
        } else if (sub.status === 'verified') {
            statusEl.className = "inline-flex items-center px-2.5 py-0.5 text-xs font-bold rounded-lg border border-green-100 bg-green-50 text-green-600 shrink-0";
            statusEl.innerText = "✅ 已確認";
            notesEl.innerText = sub.adminNotes ? `備註：${sub.adminNotes}` : "管理員已確認收款與檔案無誤，報名已正式生效！";
        } else if (sub.status === 'rejected') {
            statusEl.className = "inline-flex items-center px-2.5 py-0.5 text-xs font-bold rounded-lg border border-red-100 bg-red-50 text-red-600 shrink-0";
            statusEl.innerText = "❌ 資料錯誤";
            notesEl.innerText = sub.adminNotes ? `錯誤原因：${sub.adminNotes}` : "資料錯誤，請重新檢查並上傳正確檔案。";
        }
    } else {
        feedbackContainer.classList.add('hidden');
    }

    // 🔒 安全鎖定邏輯：僅在「已確認(verified)」時才禁止修改；上傳後待審核仍開放使用者修改或刪除
    const isLocked = sub && sub.status === 'verified';
    const btnSubmit = document.getElementById('btnSubmitUploadSummary');

    if (isLocked) {
        if (btnSubmit) btnSubmit.classList.add('hidden');
        document.querySelectorAll('#uploadSummaryModal button[onclick*="click()"]').forEach(b => b.classList.add('hidden'));
        document.querySelectorAll('#uploadSummaryModal button[onclick*="removeUploadSubFile"]').forEach(b => b.classList.add('hidden'));
    } else {
        if (btnSubmit) btnSubmit.classList.remove('hidden');
        document.querySelectorAll('#uploadSummaryModal button[onclick*="click()"]').forEach(b => b.classList.remove('hidden'));
        document.querySelectorAll('#uploadSummaryModal button[onclick*="removeUploadSubFile"]').forEach(b => b.classList.remove('hidden'));
    }

    // 隱藏進度條
    document.getElementById('upload-summary-progress').classList.add('hidden');

    const modal = document.getElementById('uploadSummaryModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => { modal.firstElementChild.classList.remove('scale-95'); modal.firstElementChild.classList.add('scale-100'); }, 10);
};

window.closeUploadSummaryModal = () => {
    const modal = document.getElementById('uploadSummaryModal');
    modal.firstElementChild.classList.remove('scale-100'); modal.firstElementChild.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
};

window.openUploadRemittanceModal = (tId, unit, subTeam) => {
    window.currentSubTourId = tId;
    window.currentSubUnit = unit;
    window.currentSubSubTeam = subTeam;

    const displayUnit = subTeam ? `${unit} (${subTeam})` : unit;
    document.getElementById('upload-remittance-unit-display').innerText = displayUnit;

    // 尋找已有的上傳紀錄 (一般使用者端使用 myUnitSubmissions)
    const sub = (appData.myUnitSubmissions || []).find(s =>
        s.tournamentId === tId && s.unit === unit && s.subTeam === subTeam
    );

    // 重設狀態與暫存變數
    window.tempSubRemittanceUrl = sub ? sub.remittanceUrl : null;
    window.tempSubRemittanceName = sub ? sub.remittanceFileName : null;

    // 重設檔案輸入框
    document.getElementById('upload-remittance-file').value = '';

    // 更新匯款紀錄 UI
    const remittancePreview = document.getElementById('upload-remittance-preview-container');
    if (window.tempSubRemittanceUrl) {
        remittancePreview.classList.remove('hidden');
        document.getElementById('upload-remittance-filename').innerText = window.tempSubRemittanceName || '查看已上傳檔案';
        document.getElementById('upload-remittance-preview-link').href = window.tempSubRemittanceUrl;
    } else {
        remittancePreview.classList.add('hidden');
    }

    // 更新審核回饋 UI
    const feedbackContainer = document.getElementById('upload-remittance-feedback-container');
    if (sub && sub.status && sub.status !== 'none') {
        feedbackContainer.classList.remove('hidden');
        const statusEl = document.getElementById('upload-remittance-feedback-status');
        const notesEl = document.getElementById('upload-remittance-feedback-notes');

        if (sub.status === 'pending') {
            statusEl.className = "inline-flex items-center px-2.5 py-0.5 text-xs font-bold rounded-lg border border-orange-100 bg-orange-50 text-orange-600 shrink-0";
            statusEl.innerText = "⏳ 待確認";
            notesEl.innerText = "您的上傳資料已送出，管理員正在審核中，請稍候。";
        } else if (sub.status === 'verified') {
            statusEl.className = "inline-flex items-center px-2.5 py-0.5 text-xs font-bold rounded-lg border border-green-100 bg-green-50 text-green-600 shrink-0";
            statusEl.innerText = "✅ 已確認";
            notesEl.innerText = sub.adminNotes ? `備註：${sub.adminNotes}` : "管理員已確認收款與檔案無誤，報名已正式生效！";
        } else if (sub.status === 'rejected') {
            statusEl.className = "inline-flex items-center px-2.5 py-0.5 text-xs font-bold rounded-lg border border-red-100 bg-red-50 text-red-600 shrink-0";
            statusEl.innerText = "❌ 資料錯誤";
            notesEl.innerText = sub.adminNotes ? `錯誤原因：${sub.adminNotes}` : "資料錯誤，請重新檢查並上傳正確檔案。";
        }
    } else {
        feedbackContainer.classList.add('hidden');
    }

    // 🔒 安全鎖定邏輯：僅在「已確認(verified)」時才禁止修改；上傳後待審核仍開放使用者修改或刪除
    const isLocked = sub && sub.status === 'verified';
    const btnSubmit = document.getElementById('btnSubmitUploadRemittance');

    if (isLocked) {
        if (btnSubmit) btnSubmit.classList.add('hidden');
        document.querySelectorAll('#uploadRemittanceModal button[onclick*="click()"]').forEach(b => b.classList.add('hidden'));
        document.querySelectorAll('#uploadRemittanceModal button[onclick*="removeUploadSubFile"]').forEach(b => b.classList.add('hidden'));
    } else {
        if (btnSubmit) btnSubmit.classList.remove('hidden');
        document.querySelectorAll('#uploadRemittanceModal button[onclick*="click()"]').forEach(b => b.classList.remove('hidden'));
        document.querySelectorAll('#uploadRemittanceModal button[onclick*="removeUploadSubFile"]').forEach(b => b.classList.remove('hidden'));
    }

    // 隱藏進度條
    document.getElementById('upload-remittance-progress').classList.add('hidden');

    const modal = document.getElementById('uploadRemittanceModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => { modal.firstElementChild.classList.remove('scale-95'); modal.firstElementChild.classList.add('scale-100'); }, 10);
};

window.closeUploadRemittanceModal = () => {
    const modal = document.getElementById('uploadRemittanceModal');
    modal.firstElementChild.classList.remove('scale-100'); modal.firstElementChild.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
};

// 🌟 圖片壓縮工具 (Client-side Image Compression with Error Reject)
window.compressImage = (file, maxWidth = 1200, quality = 0.75) => {
    return new Promise((resolve, reject) => {
        // 如果不是圖片，直接回傳原檔案（如 PDF）
        if (!file.type.startsWith('image/')) {
            resolve(file);
            return;
        }

        const reader = new FileReader();
        reader.onerror = () => reject(new Error("檔案讀取錯誤"));
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = () => reject(new Error("圖片載入錯誤"));
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // 等比例縮小
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error("Canvas 2D Context 取得失敗"));
                        return;
                    }
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        if (!blob) {
                            reject(new Error("圖片轉檔 Blob 失敗"));
                            return;
                        }
                        // 將檔名後綴強制修正為 .jpg
                        const compressedName = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
                        const compressedFile = new File([blob], compressedName, {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        });
                        resolve(compressedFile);
                    }, 'image/jpeg', quality);
                } catch (e) {
                    reject(e);
                }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
};

window.handleUploadSubFile = async (inputEl, fileType) => {
    const originalFile = inputEl.files[0];
    if (!originalFile) return;

    const progressDiv = document.getElementById(`upload-${fileType}-progress`);
    const percentSpan = document.getElementById(`upload-${fileType}-percent`);
    const previewDiv = document.getElementById(`upload-${fileType}-preview-container`);

    // 限制原始檔案大小 (未壓縮前最高 20MB)
    if (originalFile.size > 20 * 1024 * 1024) {
        window.showToast("⚠️ 檔案太大，不可超過 20MB！", "error");
        inputEl.value = '';
        return;
    }

    progressDiv.classList.remove('hidden');
    previewDiv.classList.add('hidden');

    let file;
    try {
        // 進行圖片壓縮
        file = await window.compressImage(originalFile);
    } catch (err) {
        console.error("圖片壓縮失敗:", err);
        window.showToast("❌ 圖片處理失敗，請嘗試換張圖片或使用 PDF 上傳。", "error");
        progressDiv.classList.add('hidden');
        inputEl.value = '';
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        window.showToast("⚠️ 壓縮後檔案大小仍超過 10MB，請更換檔案！", "error");
        progressDiv.classList.add('hidden');
        inputEl.value = '';
        return;
    }

    // 記錄準備被替換的舊檔案 URL
    const oldUrl = fileType === 'summary' ? window.tempSubSummaryUrl : window.tempSubRemittanceUrl;

    // 清理與過濾檔名與路徑字元，防禦 XSS 與路徑穿越
    const cleanFileName = file.name.replace(/[^\w.\-]/g, '_').replace(/_+/g, '_');
    const safeTourId = String(window.currentSubTourId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanUnitKey = `${window.currentSubUnit}_${window.currentSubSubTeam || ''}`.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');

    const path = `artifacts/${appIdStr}/users/${currentUser.uid}/${safeTourId}/${cleanUnitKey}/${fileType}_${Date.now()}_${cleanFileName}`;

    const storageRef = ref(storage, path);
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on('state_changed',
        (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            percentSpan.innerText = progress + '%';
        },
        (error) => {
            console.error("上傳失敗:", error);
            window.showToast("❌ 上傳失敗：" + error.message, "error");
            progressDiv.classList.add('hidden');
        },
        async () => {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            progressDiv.classList.add('hidden');

            // 上傳成功後，且新檔案可用時，才刪除原本 Storage 中的舊檔案，避免爆滿與斷圖
            if (oldUrl) {
                try {
                    await deleteObject(ref(storage, oldUrl));
                    console.log(`🗑️ 舊的 ${fileType} 檔案已成功從 Storage 刪除！`);
                } catch (e) {
                    console.warn("Storage 舊檔刪除失敗(可能檔案本就不存在):", e);
                }
            }

            if (fileType === 'summary') {
                window.tempSubSummaryUrl = downloadURL;
                window.tempSubSummaryName = file.name;
            } else {
                window.tempSubRemittanceUrl = downloadURL;
                window.tempSubRemittanceName = file.name;
            }

            previewDiv.classList.remove('hidden');
            document.getElementById(`upload-${fileType}-filename`).innerText = file.name;
            document.getElementById(`upload-${fileType}-preview-link`).href = downloadURL;

            window.showToast("✅ 檔案上傳成功！");
        }
    );
};

window.removeUploadSubFile = async (fileType) => {
    // 再次確認是否已經鎖定：僅「已確認 (verified)」才禁止刪除
    const sub = (appData.myUnitSubmissions || []).find(s =>
        s.tournamentId === window.currentSubTourId && s.unit === window.currentSubUnit && s.subTeam === window.currentSubSubTeam
    );
    if (sub && sub.status === 'verified') {
        window.showToast("⚠️ 管理員已確認收款，禁止刪除或修改檔案！", "error");
        return;
    }

    const fileLabel = fileType === 'summary' ? '報名總表' : '匯款證明';
    const isConfirmed = await window.showCustomConfirm(
        '確認刪除上傳檔案',
        `確定要刪除已上傳的「<span class="text-red-600 font-black">${fileLabel}</span>」檔案嗎？<br><span class="text-xs text-gray-500 font-bold mt-2 block">此動作將同時清除雲端檔案與資料庫紀錄，無法復原。</span>`,
        '確定刪除',
        '保留檔案'
    );
    if (!isConfirmed) return;

    const deleteBtn = document.querySelector(`#upload-${fileType}-preview-container button`);
    const originalBtnHtml = deleteBtn ? deleteBtn.innerHTML : '';
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>刪除中...';
    }

    const progressDiv = document.getElementById(`upload-${fileType}-progress`);
    if (progressDiv) {
        progressDiv.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i>正在同步刪除雲端檔案與資料庫紀錄，請稍候...';
        progressDiv.className = 'mt-2 text-xs font-black text-red-500 flex items-center animate-pulse';
        progressDiv.classList.remove('hidden');
    }

    try {
        const urlToDelete = fileType === 'summary' ? window.tempSubSummaryUrl : window.tempSubRemittanceUrl;

        if (urlToDelete) {
            try {
                await deleteObject(ref(storage, urlToDelete));
                console.log(`🗑️ 已成功從 Storage 中刪除已上傳的 ${fileType} 檔案。`);
            } catch (e) {
                console.warn("Storage 檔案刪除失敗或檔案已不存在:", e);
            }
        }

        if (fileType === 'summary') {
            window.tempSubSummaryUrl = null;
            window.tempSubSummaryName = null;
        } else {
            window.tempSubRemittanceUrl = null;
            window.tempSubRemittanceName = null;
        }

        document.getElementById(`upload-${fileType}-preview-container`).classList.add('hidden');
        document.getElementById(`upload-${fileType}-file`).value = '';

        // ✨ 同步刪除 Firestore 上的檔案連結，讓卡片狀態及後台即時更新
        if (sub && sub.id && currentUser) {
            const subRef = doc(db, 'artifacts', appIdStr, 'public', 'data', 'unit_submissions', sub.id);
            const updateData = {
                updatedAt: new Date().toISOString()
            };
            if (fileType === 'summary') {
                updateData.summaryFormUrl = null;
                updateData.summaryFormFileName = null;
                sub.summaryFormUrl = null;
                sub.summaryFormFileName = null;
            } else {
                updateData.remittanceUrl = null;
                updateData.remittanceFileName = null;
                sub.remittanceUrl = null;
                sub.remittanceFileName = null;
            }

            if (!sub.summaryFormUrl || !sub.remittanceUrl) {
                updateData.status = 'not_uploaded';
                sub.status = 'not_uploaded';
            }
            await setDoc(subRef, updateData, { merge: true });
            if (typeof window.renderMyRegistrations === 'function') window.renderMyRegistrations();
        }

        window.showToast("🗑️ 已成功刪除上傳資料！");
    } finally {
        if (progressDiv) {
            progressDiv.classList.add('hidden');
            progressDiv.className = `hidden mt-2 text-xs font-bold ${fileType === 'summary' ? 'text-tkdBlue' : 'text-green-600'}`;
            progressDiv.innerHTML = `<i class="fas fa-spinner fa-spin mr-1"></i> 上傳中... <span id="upload-${fileType}-percent">0%</span>`;
        }
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = originalBtnHtml;
        }
    }
};

window.submitUploadSubmission = async (fileType) => {
    if (fileType === 'summary' && !window.tempSubSummaryUrl) {
        window.showToast("⚠️ 請先選擇並上傳簽名總表！", "error");
        return;
    }
    if (fileType === 'remittance' && !window.tempSubRemittanceUrl) {
        window.showToast("⚠️ 請先選擇並上傳匯款證明！", "error");
        return;
    }

    const btnId = fileType === 'summary' ? 'btnSubmitUploadSummary' : 'btnSubmitUploadRemittance';
    const btn = document.getElementById(btnId);
    const originalHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> 送出中...';
    }

    try {
        const rawId = `${window.currentSubTourId}_${window.currentSubUnit}_${window.currentSubSubTeam || ''}`;
        const submissionId = btoa(unescape(encodeURIComponent(rawId)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');

        const docRef = doc(db, 'artifacts', appIdStr, 'public', 'data', 'unit_submissions', submissionId);

        const existingSub = (appData.myUnitSubmissions || []).find(s => s.id === submissionId);
        const wasRejected = existingSub && existingSub.status === 'rejected';
        const isResubmitted = wasRejected || (existingSub && existingSub.isResubmitted === true) || !!existingSub;

        const updateData = {
            tournamentId: window.currentSubTourId,
            tournamentName: selectedTournament?.name || '',
            city: selectedTournament?.city || '',
            unit: window.currentSubUnit,
            subTeam: window.currentSubSubTeam || '',
            userId: currentUser.uid,
            email: currentUser.email || '',
            status: 'pending', // 送出時或補件重傳時，轉為待審查
            isResubmitted: isResubmitted,
            uploadedAt: serverTimestamp()
        };
        if (wasRejected || existingSub) {
            updateData.resubmittedAt = serverTimestamp();
            updateData.resubmissionCount = (existingSub?.resubmissionCount || 0) + 1;
        }

        if (fileType === 'summary') {
            updateData.summaryFormUrl = window.tempSubSummaryUrl || null;
            updateData.summaryFormFileName = window.tempSubSummaryName || null;
        } else {
            updateData.remittanceUrl = window.tempSubRemittanceUrl || null;
            updateData.remittanceFileName = window.tempSubRemittanceName || null;
        }

        await setDoc(docRef, updateData, { merge: true });

        window.showToast("🎉 資料已成功送出審核！");
        if (fileType === 'summary') {
            window.closeUploadSummaryModal();
        } else {
            window.closeUploadRemittanceModal();
        }

        if (window.renderMyRecordsPage) window.renderMyRecordsPage();

    } catch (err) {
        console.error("提交審核失敗:", err);
        window.showToast("❌ 提交失敗：" + err.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
};

// ==========================================
// 7. 初始化事件綁定 (Export)
// ==========================================

export function initFrontend() {

    // ✨ 核心重構：集中管理狀態訂閱 (Data Binding)

    // 1. 當「報名資料」更新時，自動重繪相關表格
    subscribe('registrationsUpdated', (regs) => {
        if (document.getElementById('page-register')?.classList.contains('active')) {
            if (window.renderUserTables) window.renderUserTables();
        }
        if (document.getElementById('page-my-records')?.classList.contains('active')) {
            if (window.renderMyRecordsPage) window.renderMyRecordsPage();
        }
        if (document.getElementById('page-admin')?.classList.contains('active')) {
            if (window.executeAdminRegistrationsRender) window.executeAdminRegistrationsRender();
        }
    });

    // 當「上傳總表與匯款紀錄」更新時，自動重繪「我的報名」頁面與後台
    subscribe('unitSubmissionsUpdated', () => {
        if (window.updateMyRecordsErrorBadge) window.updateMyRecordsErrorBadge();
        if (document.getElementById('page-my-records')?.classList.contains('active')) {
            if (window.renderMyRecordsPage) window.renderMyRecordsPage();
        }
        if (document.getElementById('page-admin')?.classList.contains('active')) {
            if (window.executeAdminRegistrationsRender) window.executeAdminRegistrationsRender();
        }
    });

    // 2. 當「常用名單」更新時，自動重繪名單介面
    subscribe('teamProfilesUpdated', () => {
        if (window.renderTeamProfiles) window.renderTeamProfiles();
    });

    // 3. 當「選定賽事」變更時，自動更新相關 UI
    subscribe('tournamentSelected', (tour) => {
        if (!tour) return;
        if (window.renderInfoPage) window.renderInfoPage();
        if (window.renderFormOptions) window.renderFormOptions();
        if (window.checkTournamentStatus) window.checkTournamentStatus();
    });

    // 4. 當「全域資料 (賽事列表等)」更新時
    subscribe('appDataUpdated', (data) => {
        if (document.getElementById('page-home')?.classList.contains('active')) {
            if (window.renderHomePage) window.renderHomePage();
        }
    });

    // ✨ 單位輸入框的衝突偵測綁定 ✨
    const unitInput = document.getElementById('unit');
    if (unitInput) {
        // 離開輸入框時立刻檢查
        unitInput.addEventListener('blur', window.validateUnit);
        // 打字時先清除紅框，避免干擾視覺
        unitInput.addEventListener('input', () => {
            const errEl = document.getElementById('unit-error');
            if (errEl && !errEl.classList.contains('hidden')) {
                errEl.classList.add('hidden'); errEl.classList.remove('block');
                unitInput.classList.remove('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
            }
        });
    }

    // 防止表單填寫到一半誤觸上一頁
    window.addEventListener('beforeunload', (e) => {
        const playerName = document.querySelector('.dynamic-player-name')?.value;
        const inputUnit = document.getElementById('unit')?.value;
        if (playerName || inputUnit) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // 連絡電話 (Phone) 自動格式化與防呆
    ['phone', 'tp-phone'].forEach(id => {
        const phoneInput = document.getElementById(id);
        if (phoneInput) {
            phoneInput.addEventListener('input', (e) => {
                let val = e.target.value.replace(/\D/g, '');

                if (val.startsWith('09')) {
                    val = val.substring(0, 10);
                    if (val.length > 7) {
                        e.target.value = `${val.substring(0, 4)}-${val.substring(4, 7)}-${val.substring(7, 10)}`;
                    } else if (val.length > 4) {
                        e.target.value = `${val.substring(0, 4)}-${val.substring(4)}`;
                    } else {
                        e.target.value = val;
                    }
                } else if (val.startsWith('0')) {
                    val = val.substring(0, 10);
                    let areaLen = 2;
                    if (['037', '049', '082', '089'].some(p => val.startsWith(p))) areaLen = 3;
                    if (val.startsWith('0836')) areaLen = 4;

                    let area = val.substring(0, areaLen);
                    let local = val.substring(areaLen);

                    if (local.length > 4) {
                        let prefix = local.substring(0, local.length - 4);
                        let suffix = local.substring(local.length - 4);
                        e.target.value = `${area}-${prefix}-${suffix}`;
                    } else if (local.length > 0) {
                        e.target.value = `${area}-${local}`;
                    } else {
                        e.target.value = area;
                    }
                } else if (val.length > 0) {
                    e.target.value = val;
                } else {
                    e.target.value = '';
                }
            });

            phoneInput.addEventListener('blur', (e) => {
                let val = e.target.value.replace(/\D/g, '');
                let errEl = document.getElementById(`${id}-error`);
                if (!errEl) {
                    errEl = document.createElement('div');
                    errEl.id = `${id}-error`;
                    errEl.className = 'absolute left-0 top-[calc(100%+6px)] z-20 w-[105%] bg-white text-red-600 text-[11px] leading-relaxed font-black px-3.5 py-2.5 rounded-xl border border-red-200 shadow-[0_8px_16px_rgba(239,68,68,0.15)] hidden animate-fade-in';
                    phoneInput.parentElement.classList.add('relative');
                    phoneInput.parentElement.appendChild(errEl);
                }

                const showError = (msg) => {
                    errEl.innerHTML = `<div class="flex items-start"><i class="fas fa-exclamation-circle mt-0.5 mr-1.5 shrink-0 text-red-500"></i><span>${msg}</span></div>`;
                    errEl.classList.remove('hidden'); errEl.classList.add('block');
                    phoneInput.classList.add('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
                };
                const clearError = () => {
                    errEl.classList.add('hidden'); errEl.classList.remove('block');
                    phoneInput.classList.remove('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
                };

                if (!val) return clearError();

                if (val.startsWith('09')) {
                    if (val.length !== 10) return showError('手機號碼長度錯誤！請輸入完整的 10 碼數字 (例: 0912-345-678)');
                } else {
                    if (!val.startsWith('0')) return showError('市話請加上區碼！<br><span class="text-[10px] text-red-400 tracking-wider">(例: 台北請加 02，如 02-2969-6025)</span>');
                    if (val.length < 9 || val.length > 10) return showError('市話號碼長度異常！請確認是否漏打或多打。');
                }
                return clearError();
            });
        }
    });

    // ✨ 教練名稱防呆與即時驗證
    ['coach1', 'coach2', 'coach3'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            // 離開輸入框時檢查
            el.addEventListener('blur', () => window.validateSingleCoachName(el));
            // 打字時先消除紅框避免干擾視覺
            el.addEventListener('input', () => {
                const errEl = el.parentElement.querySelector('.err-msg');
                if (errEl && !errEl.classList.contains('hidden')) {
                    errEl.classList.add('hidden'); errEl.classList.remove('block');
                    el.classList.remove('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
                }
            });
        }
    });

    const registrationForm = document.getElementById('registrationForm');
    if (registrationForm) {
        registrationForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!window.validateUnit()) {
                document.getElementById('unit')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }

            const phoneInput = document.getElementById('phone');
            if (phoneInput) {
                let phoneVal = phoneInput.value.replace(/\D/g, '');
                if (phoneVal) {
                    if ((phoneVal.startsWith('09') && phoneVal.length !== 10) ||
                        (!phoneVal.startsWith('09') && (!phoneVal.startsWith('0') || phoneVal.length < 9 || phoneVal.length > 10))) {
                        phoneInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        phoneInput.dispatchEvent(new Event('blur'));
                        return;
                    }
                }
            }

            let hasError = false;
            let firstErrorEl = null;
            const names = [], births = [], ids = [];

            const selectedItemName = document.getElementById('item').value;
            const selectedGroupName = document.getElementById('group').value;

            let gSet = {};
            if (selectedTournament.groupSettings && selectedTournament.groupSettings[selectedItemName] && selectedTournament.groupSettings[selectedItemName][selectedGroupName]) {
                gSet = selectedTournament.groupSettings[selectedItemName][selectedGroupName];
            } else if (selectedTournament.itemSettings && selectedTournament.itemSettings[selectedItemName]) {
                gSet = selectedTournament.itemSettings[selectedItemName];
            }

            let requireId = gSet.requireId === 'true' || gSet.requireId === true;

            document.querySelectorAll('.dynamic-player-name').forEach(input => {
                let safeName = input.value.replace(/\//g, ' ').trim();
                input.value = safeName;

                if (!safeName) { hasError = true; firstErrorEl = firstErrorEl || input; }
                names.push(sanitizeHTML(safeName));
            });

            document.querySelectorAll('.dynamic-birthday').forEach(input => {
                if (!window.validateSingleBirthday(input, false, gSet)) { hasError = true; firstErrorEl = firstErrorEl || input; }
                births.push(sanitizeHTML(input.value));
            });

            document.querySelectorAll('.dynamic-id').forEach(input => {
                if (!window.validateSingleId(input, requireId)) { hasError = true; firstErrorEl = firstErrorEl || input; }
                ids.push(sanitizeHTML(input.value).toUpperCase());
            });

            // ✨ 送出前：驗證教練填寫順序防呆
            const coach2El = document.getElementById('coach2');
            const coach3El = document.getElementById('coach3');
            const c2Val = coach2El ? coach2El.value.trim() : '';
            const c3Val = coach3El ? coach3El.value.trim() : '';

            // 當教練 3 有填寫，但教練 2 為空，且教練 2 欄位目前處於非隱藏狀態時觸發防呆
            if (c3Val && !c2Val && coach2El && !coach2El.closest('div').classList.contains('hidden')) {
                hasError = true;
                firstErrorEl = firstErrorEl || coach2El;

                let errEl = coach2El.parentElement.querySelector('.err-msg');
                if (!errEl) {
                    errEl = document.createElement('div');
                    errEl.className = 'err-msg absolute left-0 top-[calc(100%+6px)] z-20 w-[105%] bg-white text-red-600 text-[11px] leading-relaxed font-black px-3.5 py-2.5 rounded-xl border border-red-200 shadow-[0_8px_16px_rgba(239,68,68,0.15)] hidden animate-fade-in';
                    coach2El.parentElement.classList.add('relative');
                    coach2El.parentElement.appendChild(errEl);
                }
                errEl.innerHTML = `<div class="flex items-start"><i class="fas fa-exclamation-circle mt-0.5 mr-1.5 shrink-0 text-red-500"></i><span>不能跳著填寫！請先填寫教練 2，再填寫教練 3。</span></div>`;
                errEl.classList.remove('hidden'); errEl.classList.add('block');
                coach2El.add('border-red-500', 'ring-2', 'ring-red-500/20', 'bg-red-50', 'text-red-700');
            }

            // 驗證教練欄位格式
            ['coach1', 'coach2', 'coach3'].forEach(id => {
                const el = document.getElementById(id);
                if (el && !el.closest('div').classList.contains('hidden')) {
                    if (window.validateSingleCoachName && !window.validateSingleCoachName(el)) {
                        hasError = true;
                        firstErrorEl = firstErrorEl || el;
                    }
                }
            });

            if (hasError) {
                if (firstErrorEl) {
                    firstErrorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    firstErrorEl.focus();
                }
                return;
            }

            const isAuthValid = await verifyAuthBeforeAction();
            if (!isAuthValid) return;

            const overrideUidEl = document.getElementById('overrideUid');
            const overrideEmailEl = document.getElementById('overrideEmail');
            const overrideUid = overrideUidEl ? overrideUidEl.value : '';
            const overrideEmail = overrideEmailEl ? overrideEmailEl.value : '';
            const targetUid = overrideUid || currentUser.uid;

            // ✨ 重複報名檢查邏輯
            const selectedLevelName = document.getElementById('level').value;
            const editId = document.getElementById('editRecordId').value;

            // 找出同賽事中，除了目前正在編輯的這筆以外的所有紀錄
            const tournamentRegs = (appData.registrations || []).filter(r =>
                r.tournamentId === selectedTournament.id && r.id !== editId
            );

            if (tournamentRegs.length > 0) {
                let duplicatePlayerName = null;
                let duplicateFound = false;
                let duplicateDetailInfo = '';

                // 🌟 神奇過濾器：將所有字串轉小寫、去除所有空白
                const normalize = (str) => (str || '').toString().replace(/\s+/g, '').toLowerCase();

                // 🌟 日期標準化：將 2026/5/3 強制轉為 2026/05/03 確保比對精準
                const formatBirth = (dStr) => {
                    if (!dStr) return '';
                    let clean = normalize(dStr).replace(/-/g, '/');
                    let parts = clean.split('/');
                    if (parts.length === 3) return `${parts[0]}/${parts[1].padStart(2, '0')}/${parts[2].padStart(2, '0')}`;
                    return clean;
                };

                for (let i = 0; i < names.length; i++) {
                    const currentName = normalize(names[i]);
                    const currentBirth = formatBirth(births[i]);
                    const currentId = normalize(ids[i]);

                    const isDuplicate = tournamentRegs.some(r => {
                        const histNames = (r.playerName || '').split(' / ').map(normalize);
                        const histBirths = (r.birthday || '').split(' / ').map(formatBirth);
                        const histIds = (r.idNumber || '').split(' / ').map(normalize);

                        let personMatchIndex = -1;
                        for (let j = 0; j < histNames.length; j++) {
                            const nameMatch = histNames[j] === currentName;
                            const birthMatch = histBirths[j] === currentBirth;
                            const idMatch = requireId ? (histIds[j] === currentId) : true;

                            // 只要姓名 + 生日 (+ 證號) 都吻合，就是同一個人
                            if (nameMatch && birthMatch && idMatch) {
                                personMatchIndex = j;
                                break;
                            }
                        }

                        // 如果發現是同一個人，且報名了同一個項目
                        if (personMatchIndex !== -1 && r.item === selectedItemName) {
                            duplicateDetailInfo = `${getLang(r.item)} - ${getLang(r.group)} - ${getLang(r.level)}`;
                            return true;
                        }
                        return false;
                    });

                    if (isDuplicate) {
                        duplicatePlayerName = names[i];
                        duplicateFound = true;
                        break;
                    }
                }

                if (duplicateFound) {
                    const confirmMsg = `
                        <div class="text-left bg-red-50 p-4 rounded-xl border border-red-100 mb-2">
                            <i class="fas fa-exclamation-triangle mr-2 text-red-500"></i>
                            ${t('dup.msg-part1')} <span class="text-red-600 font-black text-base">${duplicatePlayerName}</span> ${t('dup.msg-part2')}
                            「<span class="text-tkdBlue font-black">${duplicateDetailInfo}</span>」中了！<br>
                            <p class="mt-3 text-[11px] text-gray-500 leading-relaxed font-bold border-t border-red-100 pt-2">
                                ※ 同一個人只能在一個參賽項目中，參加一樣組別與級別，不可重複報名。<br>
                                ※ 若欲參加其他競賽，請選擇其他「參賽項目」進行報名。
                            </p>
                        </div>
                        <div class="text-red-700 font-black mt-4">請問您確定要「強制重複提交」這筆資料嗎？</div>
                    `;

                    const isConfirmed = await window.showCustomConfirm(t('dup.title'), confirmMsg, t('dup.btn-ok'), t('dup.btn-cancel'));
                    if (!isConfirmed) return;
                }
            }

            const loading = document.getElementById('form-loading');
            const submitBtn = document.getElementById('btn-submit-reg');
            const loadingTitle = document.getElementById('form-loading-title');
            const form = document.getElementById('registrationForm');

            if (loadingTitle) {
                loadingTitle.textContent = editId ? t('reg.loading-edit-title') : t('reg.loading-create-title');
            }
            loading?.classList.remove('hidden');
            loading?.setAttribute('aria-hidden', 'false');
            form?.setAttribute('aria-busy', 'true');
            if (submitBtn) {
                submitBtn.dataset.submitting = 'true';
                submitBtn.disabled = true;
                submitBtn.innerHTML = `<i class="fas fa-circle-notch fa-spin mr-2"></i><span>${t('reg.loading-button')}</span>`;
            }

            const itemFee = (selectedTournament.fees && selectedTournament.fees[selectedItemName] && selectedTournament.fees[selectedItemName][selectedGroupName])
                ? selectedTournament.fees[selectedItemName][selectedGroupName]
                : 0;

            const isProxyAction = overrideUid && overrideUid !== currentUser.uid;

            const rec = {
                tournamentId: selectedTournament.id,
                tournamentName: selectedTournament.name,
                city: selectedTournament.city || '',
                unit: sanitizeHTML(document.getElementById('unit').value),
                phone: sanitizeHTML(document.getElementById('phone').value),
                leader: sanitizeHTML(document.getElementById('leader').value),
                manager: sanitizeHTML(document.getElementById('manager').value),
                coach1: sanitizeHTML(document.getElementById('coach1').value),
                coach2: sanitizeHTML(document.getElementById('coach2').value),
                coach3: sanitizeHTML(document.getElementById('coach3').value),
                subTeam: sanitizeHTML(document.getElementById('subTeam').value),
                playerName: names.join(' / '),
                birthday: births.join(' / '),
                idNumber: ids.join(' / '),
                item: selectedItemName,
                group: selectedGroupName,
                level: document.getElementById('level').value,
                fee: itemFee,
                time: new Date().toLocaleString(),
                userId: targetUid,
                email: overrideEmail || currentUser.email || '未知帳號',
                proxyBy: isProxyAction ? currentUser.email : null
            };

            console.log("準備送出的資料：", rec);

            window.expandedUnits = window.expandedUnits || new Set();
            window.expandedUnits.add(rec.unit);

            const minLoadingTime = new Promise(resolve => setTimeout(resolve, 600));

            try {
                let currentDocId = editId;

                // 準備 Callable Function 的封包
                const callPayload = {
                    appId: appIdStr,
                    ...rec
                };
                if (editId) {
                    callPayload.id = editId;
                }

                // 呼叫後端進行安全計費與寫入
                const saveRegistration = httpsCallable(functions, 'saveRegistration');
                const callResult = await Promise.all([
                    saveRegistration(callPayload),
                    minLoadingTime
                ]);

                const { id, fee } = callResult[0].data;
                currentDocId = id;
                rec.fee = fee; // 套用後端計算的權威費用

                if (editId) {
                    const updatedReg = { id: editId, ...rec };
                    const idx = appData.registrations.findIndex(r => r.id === editId);
                    if (idx !== -1) appData.registrations[idx] = updatedReg;
                    else appData.registrations.push(updatedReg);

                    if (window.adminCurrentTourRegs) {
                        const aIdx = window.adminCurrentTourRegs.findIndex(r => r.id === editId);
                        if (aIdx !== -1) window.adminCurrentTourRegs[aIdx] = updatedReg;
                        else window.adminCurrentTourRegs.push(updatedReg);
                    }
                    if (window.myOwnRegs) {
                        const mIdx = window.myOwnRegs.findIndex(r => r.id === editId);
                        if (mIdx !== -1) window.myOwnRegs[mIdx] = updatedReg;
                    }

                    window.showToast('🎉 報名資料修改成功！');
                    window.cancelEdit();

                } else {
                    const newReg = { id: currentDocId, ...rec };

                    const idx = appData.registrations.findIndex(r => r.id === currentDocId);
                    if (idx !== -1) {
                        appData.registrations[idx] = newReg;
                    } else {
                        appData.registrations.push(newReg);
                    }

                    if (window.adminCurrentTourRegs) {
                        const aIdx = window.adminCurrentTourRegs.findIndex(r => r.id === currentDocId);
                        if (aIdx !== -1) window.adminCurrentTourRegs[aIdx] = newReg;
                        else window.adminCurrentTourRegs.push(newReg);
                    }

                    if (window.myOwnRegs && rec.userId === currentUser.uid) {
                        const mIdx = window.myOwnRegs.findIndex(r => r.id === currentDocId);
                        if (mIdx !== -1) window.myOwnRegs[mIdx] = newReg;
                        else window.myOwnRegs.push(newReg);
                    }

                    if (analytics) {
                        logEvent(analytics, 'registration_complete', {
                            tournament_name: rec.tournamentName,
                            unit: rec.unit,
                            item: rec.item,
                            group: rec.group
                        });
                    }

                    window.showToast('🎉 報名成功！');

                    document.querySelectorAll('.dynamic-player-name, .dynamic-id, .dynamic-birthday').forEach(el => el.value = '');
                    setTimeout(() => {
                        document.getElementById('dynamic-players-container').scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                }

                // ==========================================
                // ✨ 核心升級：自動同步同單位的隊職員資料 (Auto-Sync)
                // ==========================================
                const syncPromises = [];
                appData.registrations.forEach(r => {
                    if (r.id !== currentDocId &&
                        r.tournamentId === rec.tournamentId &&
                        r.userId === targetUid &&
                        r.unit === rec.unit &&
                        (r.subTeam || '') === (rec.subTeam || '')) {

                        if (r.phone !== rec.phone || r.leader !== rec.leader ||
                            r.manager !== rec.manager || r.coach1 !== rec.coach1 ||
                            r.coach2 !== rec.coach2 || r.coach3 !== rec.coach3) {

                            r.phone = rec.phone;
                            r.leader = rec.leader;
                            r.manager = rec.manager;
                            r.coach1 = rec.coach1;
                            r.coach2 = rec.coach2;
                            r.coach3 = rec.coach3;

                            syncPromises.push(setDoc(doc(db, 'artifacts', appIdStr, 'public', 'data', 'registrations', r.id), {
                                phone: rec.phone,
                                leader: rec.leader,
                                manager: rec.manager,
                                coach1: rec.coach1,
                                coach2: rec.coach2,
                                coach3: rec.coach3
                            }, { merge: true }));
                        }
                    }
                });

                if (syncPromises.length > 0) {
                    await Promise.all(syncPromises);
                    window.showToast('🔄 已自動同步該單位的最新隊職員資料！');
                }
                // ==========================================

                const profileData = {
                    userId: targetUid,
                    unit: rec.unit,
                    subTeam: rec.subTeam,
                    phone: rec.phone,
                    leader: rec.leader,
                    manager: rec.manager,
                    coach1: rec.coach1,
                    coach2: rec.coach2,
                    coach3: rec.coach3,
                    updatedAt: Date.now()
                };
                const existingProfile = (appData.teamProfiles || []).find(p => p.unit === rec.unit && (p.subTeam || '') === rec.subTeam && p.userId === targetUid);

                if (existingProfile) {
                    setDoc(doc(db, 'artifacts', appIdStr, 'public', 'data', 'team_profiles', existingProfile.id), profileData, { merge: true }).catch(e => console.error('名單更新失敗', e));
                } else {
                    addDoc(getDbPath('team_profiles'), profileData).catch(e => console.error('名單收錄失敗', e));
                }

                emit('registrationsUpdated', appData.registrations);

            } catch (err) {
                console.error("🔥 報名寫入被 Firebase 拒絕：", err);

                if (analytics) {
                    logEvent(analytics, 'registration_error', {
                        error_message: err.message,
                        tournament_name: rec?.tournamentName || '未知賽事'
                    });
                }

                window.showToast(`儲存失敗！${err.message}`, 'error');
            }

            loading?.classList.add('hidden');
            loading?.setAttribute('aria-hidden', 'true');
            form?.removeAttribute('aria-busy');
            if (submitBtn) delete submitBtn.dataset.submitting;
            window.checkTournamentStatus();
        });
    }

    const btnConfirmDelete = document.getElementById('btnConfirmDelete');
    if (btnConfirmDelete) {
        const newBtn = btnConfirmDelete.cloneNode(true);
        btnConfirmDelete.parentNode.replaceChild(newBtn, btnConfirmDelete);

        newBtn.addEventListener('click', async () => {
            if (recordToDelete) {
                const isAuthValid = await verifyAuthBeforeAction();
                if (!isAuthValid) {
                    window.closeDeleteModal();
                    return;
                }

                const originalHtml = newBtn.innerHTML;
                newBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> 刪除中...';
                newBtn.disabled = true;

                try {
                    await deleteDoc(doc(db, 'artifacts', appIdStr, 'public', 'data', 'registrations', recordToDelete));

                    appData.registrations = appData.registrations.filter(r => r.id !== recordToDelete);
                    if (window.adminCurrentTourRegs) {
                        window.adminCurrentTourRegs = window.adminCurrentTourRegs.filter(r => r.id !== recordToDelete);
                    }
                    if (window.myOwnRegs) {
                        window.myOwnRegs = window.myOwnRegs.filter(r => r.id !== recordToDelete);
                    }

                    // ✨ 觸發重繪機制
                    emit('registrationsUpdated', appData.registrations);

                    window.showToast('✅ 已成功刪除該筆報名資料！');
                    window.closeDeleteModal();

                } catch (error) {
                    console.error("刪除失敗", error);
                    window.showToast('❌ 刪除失敗：' + error.message, 'error');
                    window.closeDeleteModal();
                } finally {
                    newBtn.innerHTML = originalHtml;
                    newBtn.disabled = false;
                    setRecordToDelete(null);
                }
            }
        });
    }
}

// ==========================================
// 🌟 Vite 自動掃描贊助商廣告圖片
// ==========================================
const productFiles = import.meta.glob('/products/*.{png,jpg,jpeg,webp}', { eager: true, import: 'default' });

const autoSponsorImages = Object.values(productFiles).sort((a, b) => {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
});

// ==========================================
// 🌟 智慧型動態廣告輪播控制中心 (支援手動雙向無縫切換)
// ==========================================
window.carouselTimer = null;

// 核心滑動執行器 (防連點節流鎖)
window.moveCarousel = (direction) => {
    const track = document.getElementById('carousel-track');
    if (!track || track.children.length === 0) return;

    // 如果正在執行過場動畫，則直接封鎖本次點擊
    if (track.dataset.isAnimating === 'true') return;
    track.dataset.isAnimating = 'true';

    const items = track.children;
    const itemWidth = items[0].offsetWidth + 16; // 計算寬度 + Tailwind gap-4 (16px)

    if (direction === 'next') {
        // 向左滑動一格
        track.style.transition = 'transform 500ms ease-in-out';
        track.style.transform = `translateX(-${itemWidth}px)`;

        setTimeout(() => {
            track.style.transition = 'none';
            track.appendChild(track.firstElementChild); // 首節點移至尾端
            track.style.transform = 'translateX(0px)';
            track.offsetHeight; // 強制重繪
            track.dataset.isAnimating = 'false';
        }, 500);
    } else if (direction === 'prev') {
        // 向右滑動一格（無縫逆向核心）
        track.style.transition = 'none';
        track.insertBefore(track.lastElementChild, track.firstElementChild); // 尾節點移至首端
        track.style.transform = `translateX(-${itemWidth}px)`;
        track.offsetHeight; // 強制重繪

        // 啟動轉場拉回原點
        track.style.transition = 'transform 500ms ease-in-out';
        track.style.transform = 'translateX(0px)';

        setTimeout(() => {
            track.dataset.isAnimating = 'false';
        }, 500);
    }

    // 只要觸發手動點擊，就重新計算 3.5 秒自動輪播時間，避免時間軸衝突
    if (window.startSponsorAutoPlay) window.startSponsorAutoPlay();
};

// 自動輪播計時管理器
window.startSponsorAutoPlay = () => {
    if (window.carouselTimer) clearInterval(window.carouselTimer);
    const track = document.getElementById('carousel-track');
    if (!track) return;

    const getVisibleCount = () => {
        if (window.innerWidth >= 1536) return 6; // 2xl 顯示 6 張
        if (window.innerWidth >= 1280) return 5; // xl 顯示 5 張
        if (window.innerWidth >= 1024) return 4; // lg 顯示 4 張
        if (window.innerWidth >= 640) return 3;  // sm 顯示 3 張
        return 2;                                // 手機顯示 2 張
    };

    if (track.children.length > getVisibleCount()) {
        window.carouselTimer = setInterval(() => {
            window.moveCarousel('next');
        }, 3500);
    }
};

// 主渲染渲染入口
window.renderSponsorCarousel = (imageArray) => {
    const track = document.getElementById('carousel-track');
    if (!track) return;

    // 優先順序：1. Firebase 雲端設定 (若有傳入) -> 2. Vite 自動掃描出來的圖片陣列
    const images = (imageArray && imageArray.length > 0)
        ? imageArray
        : autoSponsorImages;

    track.innerHTML = '';
    track.style.transition = 'none';
    track.style.transform = 'translateX(0px)';
    track.dataset.isAnimating = 'false';

    const safeLogoSrc = document.querySelector('nav img[alt="WEGO SPORTING Logo"]')?.src || '/logo.png';

    images.forEach((imgSrcRaw) => {
        const imgSrc = imgSrcRaw.includes('/') ? imgSrcRaw : `/products/${imgSrcRaw}`;

        const card = document.createElement('div');
        card.className = "group relative w-[calc(50%-8px)] sm:w-[calc(33.333%-10.6px)] lg:w-[calc(25%-12px)] xl:w-[calc(20%-12.8px)] 2xl:w-[calc(16.666%-13.3px)] aspect-[4/3] bg-white/5 rounded-xl border border-white/10 hover:border-tkdBlue hover:bg-white/10 transition-all flex items-center justify-center overflow-hidden p-2 shadow-sm shrink-0";
        card.innerHTML = `
            <div class="w-full h-full flex items-center justify-center bg-white rounded-lg p-2 shadow-inner overflow-hidden">
                <img src="${imgSrc}" alt="商品照" class="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-300" onerror="this.onerror=null; this.src='${safeLogoSrc}';">
            </div>
        `;
        track.appendChild(card);
    });

    // 啟動智慧輪播監聽
    window.startSponsorAutoPlay();
};
