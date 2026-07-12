import { getDoc, setDoc, onSnapshot, query, where, getDocs } from "firebase/firestore";
import { getSettingsDoc, getDbPath } from "./firebase.js";
import { appData, currentUser, currentUserRole, currentEditTourId, setRegistrationsData } from "./store.js";
import { getLang } from "./i18n.js";
import { verifyAuthBeforeAction } from "./auth.js";

// ✨ 引入我們拆分出去的三個強大模組
import "./admin-settings.js";
import "./admin-users.js";
import "./admin-data.js";

// ==========================================
// 🛡️ 安全防護：XSS 字串過濾工具
// ==========================================
const escapeHTML = (str) => {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag]));
};

// ==========================================
// 1. 後台分頁與 UI 切換 (Router)
// ==========================================

window.switchAdminTab = (t) => {
    // 隱藏所有 view
    document.querySelectorAll('.admin-view').forEach(el => { el.classList.add('hidden'); el.classList.remove('block'); });
    const target = document.getElementById(`admin-view-${t}`);
    if (target) { target.classList.remove('hidden'); target.classList.add('block'); }

    // 更新 tab 按鈕的樣式
    document.querySelectorAll('.admin-tab').forEach(el => {
        el.classList.remove('text-tkdBlue', 'border-tkdBlue', 'text-purple-600', 'border-purple-600');
        el.classList.add('text-gray-400', 'border-transparent');
    });
    const activeTab = document.getElementById(`tab-btn-${t}`);
    if (activeTab) {
        activeTab.classList.remove('text-gray-400', 'border-transparent');
        activeTab.classList.add(t === 'perms' ? 'text-purple-600' : 'text-tkdBlue', t === 'perms' ? 'border-purple-600' : 'border-tkdBlue');
    }

    // 控制「儲存設定」按鈕的顯示與隱藏
    const saveContainer = document.getElementById('admin-save-container');
    if (saveContainer) {
        if (t === 'settings') {
            saveContainer.classList.remove('hidden');
            saveContainer.classList.add('flex');
        } else {
            saveContainer.classList.add('hidden');
            saveContainer.classList.remove('flex');
        }
    }

    // ✨ 觸發各分頁的畫面渲染 (呼叫拆分出去的模組函式)
    if (t === 'list') {
        if (window.updateAdminTourDropdown) window.updateAdminTourDropdown();
        if (window.renderAdminRegistrations) window.renderAdminRegistrations();
    }
    if (t === 'users') {
        if (window.fetchAndRenderAdminUsers) window.fetchAndRenderAdminUsers(); // 替換為拉取並渲染
    }
    if (t === 'settings') {
        if (window.populateAdminSettings) window.populateAdminSettings();
        if (window.renderRecycleBin) window.renderRecycleBin();
    }
    if (t === 'perms') {
        if (window.renderAdminPerms) window.renderAdminPerms();
    }
};

window.expandedAdminUnits = window.expandedAdminUnits || new Set();

window.toggleAdminUnitRow = (headerElement) => {
    const card = headerElement.closest('.bg-white');
    const body = card.querySelector('.unit-table-body');
    const icon = headerElement.querySelector('.toggle-icon');

    const uniqueKey = headerElement.dataset.unitKey;

    body.classList.toggle('hidden');
    if (body.classList.contains('hidden')) {
        icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
        if (uniqueKey) window.expandedAdminUnits.delete(uniqueKey);
    } else {
        icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
        if (uniqueKey) window.expandedAdminUnits.add(uniqueKey);
    }
};

// ==========================================
// 2. 賽事報名總表 (Admin 主儀表板)
// ==========================================

export function updateAdminTourDropdown() {
    const selectEl = document.getElementById('admin-tour-filter');
    if (!selectEl) return;
    const currentVal = selectEl.value;
    selectEl.innerHTML = '<option value="">請選擇要查看的賽事...</option>';

    let allowedTournaments = appData.tournaments;
    let allowedDeleted = appData.deletedTournaments || [];

    // ✨ 根據 Token 中的權限範圍過濾賽事清單
    if (currentUserRole === 'scoped_admin' && currentUser && appData.myScope) {
        const scope = appData.myScope;
        if (scope.type === 'city') {
            allowedTournaments = allowedTournaments.filter(t => t.city === scope.value);
            allowedDeleted = allowedDeleted.filter(t => t.city === scope.value);
        } else if (scope.type === 'tournament') {
            allowedTournaments = allowedTournaments.filter(t => t.id === scope.value);
            allowedDeleted = allowedDeleted.filter(t => t.id === scope.value);
        }
    }

    allowedTournaments.forEach(t => { selectEl.add(new Option(t.name, t.id)); });

    if (allowedDeleted.length > 0) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = "🗑️ 回收桶內的賽事";
        allowedDeleted.forEach(t => { optgroup.appendChild(new Option(`[已刪除] ${t.name}`, t.id)); });
        selectEl.appendChild(optgroup);
    }

    const existsInNormal = allowedTournaments.find(t => t.id === currentVal);
    const existsInDeleted = allowedDeleted.find(t => t.id === currentVal);

    // 計算該管理員總共能看到幾場賽事
    const totalAllowed = allowedTournaments.length + allowedDeleted.length;

    if (currentVal && (existsInNormal || existsInDeleted)) {
        // 情況 A：已經有選好的值，且該值合法，就維持原樣
        selectEl.value = currentVal;
    } else if (currentUserRole === 'scoped_admin' && totalAllowed === 1) {
        // 情況 B：是局部管理員 (特定單位或特定賽事)，且名單中總共只有 1 場賽事，自動選擇！
        selectEl.value = allowedTournaments.length === 1 ? allowedTournaments[0].id : allowedDeleted[0].id;
    } else {
        // 情況 C：全站管理員，或是有 2 場以上賽事的單位管理員，顯示「請選擇...」
        selectEl.value = "";
    }

    // 強制觸發一次畫面同步
    if (window.renderAdminRegistrations) window.renderAdminRegistrations();
}
window.updateAdminTourDropdown = updateAdminTourDropdown;

window.adminCurrentTourUnsubscribe = null;
window.adminCurrentTourRegs = [];
window.lastAdminFilterId = null;
window.debounceTimer = null;

window.debouncedRenderAdminRegistrations = () => {
    clearTimeout(window.debounceTimer);
    window.debounceTimer = setTimeout(() => {
        window.executeAdminRegistrationsRender();
    }, 300);
};

window.executeAdminRegistrationsRender = () => {
    const filterEl = document.getElementById('admin-tour-filter');
    const searchEl = document.getElementById('admin-search-input');
    const container = document.getElementById('admin-registrations-container');
    const noData = document.getElementById('adminNoDataMessage');
    const dashboard = document.getElementById('admin-stats-dashboard');

    const unitStat = document.getElementById('admin-stat-units');
    const playerStat = document.getElementById('admin-stat-players');
    const feeStat = document.getElementById('admin-stat-fee');
    const breakdownContainer = document.getElementById('admin-item-breakdown');

    if (!container || !filterEl) return;

    let filterId = filterEl.value;

    if (!filterId) {
        container.innerHTML = '';
        if (noData) noData.classList.remove('hidden');
        if (dashboard) dashboard.classList.add('hidden');
        return;
    }

    const currentTour = appData.tournaments.find(t => t.id === filterId) || (appData.deletedTournaments && appData.deletedTournaments.find(t => t.id === filterId)) || {};

    // ✨ 核心優化：判斷是否需要收集身分證 (全域設定優先，若無則看各組別設定)
    const requireId = !!(currentTour.requireIdNumber === true ||
        (currentTour.groupSettings && Object.values(currentTour.groupSettings).some(item =>
            Object.values(item).some(g => g.requireId === 'true')
        )));

    // 結合自己的資料與管理員動態拉取的資料
    const myRegs = window.myOwnRegs || [];
    const combinedRegs = [...myRegs, ...window.adminCurrentTourRegs];
    const uniqueRegs = Array.from(new Map(combinedRegs.map(r => [r.id, r])).values());

    let filteredRegs = uniqueRegs.filter(r => r.tournamentId === filterId);

    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : '';
    if (keyword) {
        filteredRegs = filteredRegs.filter(r =>
            (r.unit && r.unit.toLowerCase().includes(keyword)) ||
            (r.playerName && r.playerName.toLowerCase().includes(keyword))
        );
    }

    if (filteredRegs.length === 0) {
        container.innerHTML = '';
        if (noData) noData.classList.remove('hidden');
        if (dashboard) dashboard.classList.add('hidden');
        return;
    }

    if (noData) noData.classList.add('hidden');
    if (dashboard) dashboard.classList.remove('hidden');

    const groupedByUnit = {};
    let totalFee = 0;
    let totalActualPlayers = 0;
    const itemStats = {};

    filteredRegs.forEach(r => {
        const st = r.subTeam || '';
        const unitKey = st ? `${r.unit}@@${st}` : r.unit;

        if (!groupedByUnit[unitKey]) groupedByUnit[unitKey] = {};
        const email = r.email || '未知帳號';
        if (!groupedByUnit[unitKey][email]) groupedByUnit[unitKey][email] = [];
        groupedByUnit[unitKey][email].push(r);

        const fee = parseInt(r.fee) || 0;
        totalFee += fee;

        const pCount = r.playerName ? r.playerName.split(' / ').length : 1;
        totalActualPlayers += pCount;

        const itemName = r.item || '未分類項目';
        if (!itemStats[itemName]) itemStats[itemName] = { entryCount: 0, playerCount: 0, fee: 0 };
        itemStats[itemName].entryCount += 1;
        itemStats[itemName].playerCount += pCount;
        itemStats[itemName].fee += fee;
    });

    if (unitStat) unitStat.innerText = Object.keys(groupedByUnit).length;
    if (playerStat) playerStat.innerText = totalActualPlayers;
    if (feeStat) feeStat.innerText = totalFee.toLocaleString();

    if (breakdownContainer) {
        const parent = breakdownContainer.parentElement;
        parent.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 border-b border-gray-100 pb-3 gap-3">
                <h4 class="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center">
                    <i class="fas fa-chart-pie mr-2"></i>各項目人數與財務分析
                </h4>
                <div class="flex flex-wrap gap-2">
                    <button onclick="window.checkTournamentDuplicates()" class="text-[10px] bg-red-50 text-red-600 px-3 py-1.5 rounded-lg font-black hover:bg-red-600 hover:text-white transition-all border border-red-100 shadow-sm">
                        <i class="fas fa-search-plus mr-1"></i>檢查重複報名
                    </button>
                    
                    <button onclick="window.exportToExcel()" class="text-[10px] bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg font-black hover:bg-blue-600 hover:text-white transition-all border border-blue-100 shadow-sm">
                        <i class="fas fa-file-excel mr-1"></i>匯出報名明細
                    </button>

                    <button onclick="window.exportSummaryToExcel()" class="text-[10px] bg-purple-50 text-purple-600 px-3 py-1.5 rounded-lg font-black hover:bg-purple-600 hover:text-white transition-all border border-purple-100 shadow-sm">
                        <i class="fas fa-table mr-1"></i>匯出單位總表
                    </button>

                    <button onclick="window.exportItemBreakdownToExcel()" class="text-[10px] bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-lg font-black hover:bg-emerald-600 hover:text-white transition-all border border-emerald-100 shadow-sm">
                        <i class="fas fa-chart-line mr-1"></i>匯出統計表
                    </button>
                </div>
            </div>
            <div id="admin-item-breakdown" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"></div>
        `;

        const newBreakdownContainer = document.getElementById('admin-item-breakdown');

        Object.keys(itemStats).sort().forEach(itemName => {
            const stat = itemStats[itemName];
            const safeItemName = itemName.replace(/'/g, "\\'");

            // ✨ 判斷是否為單人項目：如果組數等於實際人數，代表是單人賽；如果不等，代表是雙人/三人以上的團體賽
            const isSinglePlayerItem = stat.entryCount === stat.playerCount;

            // ✨ 根據判斷結果，產出不同的 HTML 顯示文字
            const countDisplayHtml = isSinglePlayerItem
                ? `${stat.playerCount} <span class="text-[10px] text-blue-400 font-bold ml-0.5">人</span>`
                : `${stat.entryCount} <span class="text-[10px] text-blue-400 font-bold ml-0.5">組</span> <span class="text-xs text-gray-500 ml-1 font-bold">(${stat.playerCount}人)</span>`;

            newBreakdownContainer.innerHTML += `
                <div class="bg-white hover:bg-gray-50 transition-colors p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between h-full">
                    <div class="flex justify-between items-start mb-4">
                        <div class="text-sm font-black text-gray-700 truncate border-l-4 border-tkdBlue pl-2">${escapeHTML(itemName)}</div>
                        <button onclick="window.showItemBreakdownModal('${safeItemName}')" class="text-tkdBlue hover:bg-blue-100 transition-all text-[11px] font-black bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-100 shrink-0">
                            <i class="fas fa-chart-pie mr-1"></i>查看數據
                        </button>
                    </div>
                    <div class="flex justify-between items-end">
                        <div class="text-sm font-black text-tkdBlue bg-blue-50 px-2 py-1 rounded border border-blue-100">
                            ${countDisplayHtml}
                        </div>
                        <div class="text-base font-black text-green-600 bg-green-50 px-2 py-1 rounded border border-green-100">$${stat.fee.toLocaleString()}</div>
                    </div>
                </div>
            `;
        });
    }

    const idHeaderHtml = requireId ? `<th class="px-6 py-4">身分證/護照</th>` : '';

    // ✨ 核心優化：建立目前應該顯示在畫面上的卡片 ID 集合
    const currentAdminCardIds = new Set();

    Object.keys(groupedByUnit).sort((a, b) => {
        const isAscii = (str) => str.length > 0 && str.charCodeAt(0) < 128;
        const aAsc = isAscii(a);
        const bAsc = isAscii(b);
        if (aAsc && !bAsc) return -1;
        if (!aAsc && bAsc) return 1;
        return a.localeCompare(b, 'zh-TW', { collation: 'stroke' });
    }).forEach(unitKey => {
        const emails = Object.keys(groupedByUnit[unitKey]);
        const hasConflict = emails.length > 1;

        const parts = unitKey.split('@@');
        const actualUnit = parts[0];
        const actualSubTeam = parts[1] || '';
        const displayUnitName = actualSubTeam ? `${actualUnit}${actualSubTeam}` : actualUnit;

        emails.forEach(email => {
            const regs = groupedByUnit[unitKey][email];

            regs.sort((a, b) => {
                const itemA = a.item || '';
                const itemB = b.item || '';
                const itemOrderList = currentTour.itemOrder || [];
                const itemIndexA = itemOrderList.indexOf(itemA);
                const itemIndexB = itemOrderList.indexOf(itemB);

                if (itemIndexA !== -1 && itemIndexB !== -1 && itemIndexA !== itemIndexB) return itemIndexA - itemIndexB;
                if (itemIndexA !== -1 && itemIndexB === -1) return -1;
                if (itemIndexA === -1 && itemIndexB !== -1) return 1;
                if (itemA !== itemB) return itemA.localeCompare(itemB, 'zh-TW');

                const groupOrderList = (currentTour.groupOrder && currentTour.groupOrder[itemA]) ? currentTour.groupOrder[itemA] : [];
                const groupA = a.group || '';
                const groupB = b.group || '';
                const groupIndexA = groupOrderList.indexOf(groupA);
                const groupIndexB = groupOrderList.indexOf(groupB);

                if (groupIndexA !== -1 && groupIndexB !== -1 && groupIndexA !== groupIndexB) return groupIndexA - groupIndexB;
                if (groupIndexA !== -1 && groupIndexB === -1) return -1;
                if (groupIndexA === -1 && groupIndexB !== -1) return 1;
                if (groupA !== groupB) return groupA.localeCompare(groupB, 'zh-TW');

                const levelOrderList = (currentTour.linkage && currentTour.linkage[itemA] && currentTour.linkage[itemA][groupA]) ? currentTour.linkage[itemA][groupA] : [];
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

            const unitTotalFee = regs.reduce((sum, r) => sum + (parseInt(r.fee) || 0), 0);
            const isBlocked = appData.blockedUsers && appData.blockedUsers.includes(email);

            let cardBorder = isBlocked ? 'border-2 border-red-500 shadow-md' : (hasConflict ? 'border-2 border-orange-400' : 'border-gray-200');

            // ✨ 核心優化：產生穩定 ID 供 DOM Diffing 使用
            const rawKey = unitKey + '_' + email;
            const cardId = 'admin-card-' + btoa(encodeURIComponent(rawKey)).replace(/[^a-zA-Z0-9]/g, '');
            currentAdminCardIds.add(cardId);

            window.expandedAdminUnits = window.expandedAdminUnits || new Set();

            const isExpanded = keyword !== '' || window.expandedAdminUnits.has(rawKey);
            const bodyClass = isExpanded ? '' : 'hidden';
            const iconClass = isExpanded ? 'fa-chevron-up' : 'fa-chevron-down';

            const safeDisplayUnitName = escapeHTML(displayUnitName);
            const safeEmail = escapeHTML(email);
            const coachSet = new Set();
            regs.forEach(r => {
                if (r.coach1) coachSet.add(r.coach1.trim());
                if (r.coach2) coachSet.add(r.coach2.trim());
                if (r.coach3) coachSet.add(r.coach3.trim());
            });
            const coachListStr = Array.from(coachSet).join('、');

            const leaderInfo = regs[0].leader ? `領隊: <span class="text-gray-300 ml-1">${escapeHTML(regs[0].leader)}</span>` : '';
            const coachInfo = coachListStr ? `教練: <span class="text-gray-300 ml-1">${escapeHTML(coachListStr)}</span>` : '';

            let warningBanner = '';
            if (isBlocked) warningBanner = `<div class="bg-red-100 text-red-800 px-5 py-2.5 text-xs font-black flex items-center border-b border-red-200"><i class="fas fa-ban mr-2 text-red-600 text-base"></i> 警告：此帳號已被封鎖！此為黑名單帳號留下的報名資料。</div>`;
            else if (hasConflict) warningBanner = `<div class="bg-orange-100 text-orange-800 px-5 py-2.5 text-xs font-black flex items-center border-b border-orange-200"><i class="fas fa-exclamation-triangle mr-2 text-orange-600 text-base"></i> 系統提醒：【${safeDisplayUnitName}】有來自不同帳號的報名，請確認是否重複！</div>`;

            let html = `
                ${warningBanner}
                <div class="bg-gray-800 px-3 sm:px-6 py-4 flex flex-col sm:flex-row sm:justify-between sm:items-center text-white gap-4 cursor-pointer hover:bg-gray-700 transition-colors" data-unit-key="${escapeHTML(rawKey)}" onclick="toggleAdminUnitRow(this)">
                    
                    <div class="flex-grow w-full overflow-hidden">
                        
                        <div class="flex justify-between items-start w-full gap-2">
                            <h4 class="text-base sm:text-lg font-black tracking-wider flex items-start break-words sm:break-words">
                                <i class="fas fa-users text-tkdRed mr-2 sm:mr-3 shrink-0 mt-1"></i> 
                                <span>${safeDisplayUnitName}</span>
                            </h4>
                            
                            <button onclick="event.stopPropagation(); window.printTeamSummary('${filterId}', '${escapeHTML(actualUnit)}', '${escapeHTML(actualSubTeam)}', '${safeEmail}')" class="sm:hidden flex items-center justify-center bg-gray-600 hover:bg-gray-500 border border-gray-600 hover:border-gray-500 text-white px-3 h-8 rounded-lg text-sm transition-all shadow-sm active:scale-95 shrink-0" title="列印對帳單">
                                <i class="fas fa-print"></i>
                            </button>
                        </div>

                        <div class="text-sm ${isBlocked ? 'text-red-400' : 'text-yellow-400'} mt-2 font-bold tracking-wide flex items-start break-words">
                            <i class="fas fa-envelope mr-2 mt-1 shrink-0"></i><span>報名帳號：${safeEmail}</span>
                        </div>
                        <div class="text-xs text-gray-400 mt-2 flex flex-wrap gap-x-4 gap-y-1 font-bold tracking-wide">
                            ${leaderInfo ? `<span>${leaderInfo}</span>` : ''}
                            ${coachInfo ? `<span>${coachInfo}</span>` : ''}
                        </div>
                    </div>

                    <div class="flex items-center justify-between w-full sm:w-auto mt-1 sm:mt-0 shrink-0">
                        
                        <div class="flex items-center gap-1.5 sm:gap-2.5 overflow-hidden">
                            <div class="flex items-center justify-center bg-gray-700/60 border border-gray-600 px-2 sm:px-3 h-7 sm:h-8 rounded-md sm:rounded-lg text-[10px] sm:text-xs font-bold text-green-400 shadow-sm cursor-default whitespace-nowrap">
                                $${unitTotalFee.toLocaleString()}
                            </div>
                            
                            <div class="flex items-center justify-center bg-gray-700/60 border border-gray-600 px-2 sm:px-3 h-7 sm:h-8 rounded-md sm:rounded-lg text-[10px] sm:text-xs font-bold text-gray-200 shadow-sm cursor-default whitespace-nowrap">
                                共 <span class="text-red-400 text-[11px] sm:text-sm mx-1 font-black">${regs.length}</span> 項次
                            </div>
                            
                            <button onclick="event.stopPropagation(); window.adminAddRecord('${safeEmail}', '${escapeHTML(actualUnit)}', '${escapeHTML(actualSubTeam)}')" class="flex items-center justify-center bg-tkdBlue hover:bg-blue-500 border border-tkdBlue hover:border-blue-500 text-white px-2 sm:px-3 h-7 sm:h-8 rounded-md sm:rounded-lg text-[10px] sm:text-xs font-bold transition-all shadow-sm active:scale-95 whitespace-nowrap shrink-0" title="以此單位與教練身分新增報名">
                                <i class="fas fa-user-plus mr-1 sm:mr-1.5"></i>代加選手
                            </button>
                            
                            <button onclick="event.stopPropagation(); window.printTeamSummary('${filterId}', '${escapeHTML(actualUnit)}', '${escapeHTML(actualSubTeam)}', '${safeEmail}')" class="hidden sm:flex items-center justify-center bg-gray-600 hover:bg-gray-500 border border-gray-600 hover:border-gray-500 text-white px-3 h-8 rounded-lg text-sm transition-all shadow-sm active:scale-95 shrink-0" title="列印對帳單">
                                <i class="fas fa-print"></i>
                            </button>
                        </div>
                        
                        <div class="flex justify-end sm:justify-center shrink-0 ml-2">
                            <i class="fas ${iconClass} text-gray-400 toggle-icon transition-transform duration-300 text-base sm:text-lg"></i>
                        </div>

                    </div>
                </div>
                <div class="unit-table-body ${bodyClass} overflow-hidden sm:overflow-x-auto bg-gray-50/50 sm:bg-transparent p-2 sm:p-0 rounded-b-2xl border-t border-gray-700">
                    <table class="w-full text-sm text-left text-gray-700 whitespace-nowrap block sm:table">
                        <thead class="hidden sm:table-header-group text-xs text-gray-400 bg-gray-50 uppercase font-black border-b border-gray-200 tracking-wider">
                            <tr>
                                <th class="px-6 py-4">選手姓名</th>
                                <th class="px-6 py-4">出生年月日</th>
                                ${idHeaderHtml}
                                <th class="px-6 py-4">參賽項目</th>
                                <th class="px-6 py-4">組別</th>
                                <th class="px-6 py-4">級別/量級</th>
                                <th class="px-6 py-4 text-right">費用</th>
                                <th class="px-6 py-4 text-center">操作</th>
                            </tr>
                        </thead>
                        <tbody class="font-medium block sm:table-row-group">
            `;

            regs.forEach(r => {
                const namesArr = (r.playerName || '').split(' / ');
                const idsArr = (r.idNumber || '').split(' / ');
                const birthsArr = (r.birthday || '').split(' / ');
                const nameHtml = namesArr.map(n => `<div class="mb-1">${escapeHTML(n)}</div>`).join('');
                const birthHtml = birthsArr.map(b => `<div class="mb-1 text-gray-500">${escapeHTML(b) || '-'}</div>`).join('');
                const idHtml = idsArr.map(id => `<div class="mb-1 text-gray-500">${escapeHTML(id) || '-'}</div>`).join('');
                const safeItem = escapeHTML(r.item);
                const safeGroup = escapeHTML(r.group);
                const safeLevel = escapeHTML(r.level);
                const idDataHtml = requireId ? `<td class="block sm:table-cell px-2 py-1.5 sm:px-6 sm:py-4 font-bold align-top leading-relaxed tracking-wider"><span class="inline-block sm:hidden text-gray-400 font-bold text-[10px] w-16">證號</span>${idHtml}</td>` : '';

                html += `
                    <tr class="block sm:table-row border border-gray-200 sm:border-0 sm:border-b sm:border-gray-100 ${isBlocked ? 'bg-red-50' : 'bg-white sm:bg-transparent'} rounded-xl sm:rounded-none mb-3 sm:mb-0 p-4 sm:p-0 shadow-sm sm:shadow-none hover:bg-yellow-50/40 transition-colors">
                        <td class="block sm:table-cell px-2 py-1.5 sm:px-6 sm:py-4 font-black text-gray-900 text-base align-top leading-relaxed">
                            <div class="flex sm:hidden text-gray-400 font-bold text-[10px] mb-1 w-16">選手姓名</div>
                            ${nameHtml}
                        </td>
                        <td class="block sm:table-cell px-2 py-1.5 sm:px-6 sm:py-4 font-bold align-top leading-relaxed tracking-wider">
                            <span class="inline-block sm:hidden text-gray-400 font-bold text-[10px] w-16">生日</span>${birthHtml}
                        </td>
                        ${idDataHtml}
                        <td class="block sm:table-cell px-2 py-1.5 sm:px-6 sm:py-4 font-bold text-tkdBlue align-top pt-4 sm:pt-4"><span class="inline-block sm:hidden text-gray-400 font-bold text-[10px] w-16">項目</span>${safeItem}</td>
                        <td class="block sm:table-cell px-2 py-1.5 sm:px-6 sm:py-4 text-gray-600 align-top pt-4 sm:pt-4"><span class="inline-block sm:hidden text-gray-400 font-bold text-[10px] w-16">組別</span>${safeGroup}</td>
                        <td class="block sm:table-cell px-2 py-1.5 sm:px-6 sm:py-4 font-black text-red-600 align-top pt-4 sm:pt-4"><span class="inline-block sm:hidden text-gray-400 font-bold text-[10px] w-16">級別</span>${safeLevel}</td>
                        <td class="block sm:table-cell px-2 py-1.5 sm:px-6 sm:py-4 font-black text-green-600 sm:text-right align-top pt-4 sm:pt-4"><span class="inline-block sm:hidden text-gray-400 font-bold text-[10px] w-16">費用</span>$${(r.fee || 0).toLocaleString()}</td>
                        <td class="block sm:table-cell px-2 py-3 sm:px-6 sm:py-4 mt-3 sm:mt-0 border-t border-gray-100 sm:border-0 align-top pt-3 sm:pt-3">
                            <div class="flex items-center justify-end sm:justify-center gap-2">
                                <button onclick="window.editRecord('${r.id}')" class="flex-1 sm:flex-none justify-center text-tkdBlue bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-xl sm:rounded-lg text-sm sm:text-xs font-bold transition-colors shadow-sm flex items-center"><i class="fas fa-edit sm:mr-1"></i><span class="inline sm:hidden">修改</span></button>
                                <button onclick="window.promptDelete('${r.id}')" class="flex-1 sm:flex-none justify-center text-tkdRed bg-red-50 border border-red-200 hover:bg-red-100 px-3 py-1.5 rounded-xl sm:rounded-lg text-sm sm:text-xs font-bold transition-colors shadow-sm flex items-center"><i class="fas fa-trash-alt sm:mr-1"></i><span class="inline sm:hidden">刪除</span></button>
                            </div>
                        </td>
                    </tr>
                `;
            });
            html += `</tbody></table></div>`;

            // ✨ 核心優化：DOM Diffing 局部更新，不再粗暴重繪
            let card = document.getElementById(cardId);
            if (!card) {
                card = document.createElement('div');
                card.id = cardId;
                card.className = `bg-white rounded-2xl shadow-sm overflow-hidden border ${cardBorder} mb-6 fade-in`;
                card.innerHTML = html;
                card._rawHTML = html;
                container.appendChild(card);
            } else {
                card.className = `bg-white rounded-2xl shadow-sm overflow-hidden border ${cardBorder} mb-6`;
                if (card._rawHTML !== html) {
                    card.innerHTML = html;
                    card._rawHTML = html;
                }
                container.appendChild(card); // 觸發重新排列
            }
        });
    });

    // ✨ 核心優化：清理已經被刪除或過濾掉的幽靈卡片
    Array.from(container.children).forEach(child => {
        if (!currentAdminCardIds.has(child.id)) {
            child.remove();
        }
    });
};

window.renderAdminRegistrations = async () => {
    const filterEl = document.getElementById('admin-tour-filter');
    if (!filterEl) return;
    let filterId = filterEl.value;

    if (!filterId) {
        window.executeAdminRegistrationsRender();
        return;
    }

    if (window.lastAdminFilterId !== filterId) {
        window.lastAdminFilterId = filterId;

        // ✨ 修正：動態建立查詢條件陣列，針對 City Admin 補上 city 過濾條件
        let queryArgs = [getDbPath('registrations'), where("tournamentId", "==", filterId)];

        if (currentUserRole === 'scoped_admin' && appData.myScope && appData.myScope.type === 'city') {
            queryArgs.push(where("city", "==", appData.myScope.value));
        }

        const q = query(...queryArgs);
        const snap = await getDocs(q);

        window.adminCurrentTourRegs = [];
        snap.forEach(d => window.adminCurrentTourRegs.push({ id: d.id, ...d.data() }));

        const myRegs = window.myOwnRegs || [];
        const combined = [...myRegs, ...window.adminCurrentTourRegs];
        const uniqueMap = new Map();
        combined.forEach(r => uniqueMap.set(r.id, r));
        setRegistrationsData(Array.from(uniqueMap.values()));

        window.executeAdminRegistrationsRender();
    } else {
        window.executeAdminRegistrationsRender();
    }
};

window.generateTeamStaffList = () => {
    const filterId = document.getElementById('admin-tour-filter').value;
    if (!filterId) return alert('請先選擇一場賽事！');

    const tour = appData.tournaments.find(t => t.id === filterId) || (appData.deletedTournaments && appData.deletedTournaments.find(t => t.id === filterId));
    const regs = appData.registrations.filter(r => r.tournamentId === filterId);

    if (regs.length === 0) return alert('此賽事目前無報名資料，無法產生報表！');

    const itemMap = {};
    regs.forEach(r => {
        const item = r.item || '未分類項目';
        const st = r.subTeam || '';
        const unit = st ? `${r.unit}${st}` : (r.unit || '未填寫單位');

        if (!itemMap[item]) itemMap[item] = {};
        if (!itemMap[item][unit]) {
            itemMap[item][unit] = {
                leaders: new Set(), coaches: new Set(), managers: new Set(), players: new Set()
            };
        }
        if (r.leader) itemMap[item][unit].leaders.add(r.leader.trim());
        if (r.coach1) itemMap[item][unit].coaches.add(r.coach1.trim());
        if (r.coach2) itemMap[item][unit].coaches.add(r.coach2.trim());
        if (r.coach3) itemMap[item][unit].coaches.add(r.coach3.trim());
        if (r.manager) itemMap[item][unit].managers.add(r.manager.trim());

        if (r.playerName) {
            r.playerName.split(' / ').forEach(pName => {
                if (pName.trim()) itemMap[item][unit].players.add(pName.trim());
            });
        }
    });

    // ✨ 核心排序小工具：英文在前 (ASCII)，中文在後 (依筆畫)
    const unitSortHelper = (a, b) => {
        const isAscii = (str) => str.length > 0 && str.charCodeAt(0) < 128;
        const aAsc = isAscii(a);
        const bAsc = isAscii(b);

        // 1. 英文優先
        if (aAsc && !bAsc) return -1;
        if (!aAsc && bAsc) return 1;

        // 2. 中文依照筆畫排序 (逐字比較)
        // 使用 collation: 'stroke' 強制筆畫排序，遇到同筆畫或同字會自動比下一個字
        const result = a.localeCompare(b, 'zh-TW', { collation: 'stroke' });

        // 3. 如果字串完全相同，回傳 0 讓系統保持穩定排序
        return result;
    };

    let html = `
    <style>
        @media print {
            @page { margin: 1cm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
            main { padding-top: 0 !important; padding-bottom: 0 !important; margin-top: 0 !important; height: auto !important; overflow: visible !important; }
            #page-summary { height: auto !important; overflow: visible !important; }
            #page-summary > div { padding: 0 !important; border: none !important; box-shadow: none !important; overflow: visible !important; height: auto !important; }
            .print-wrapper { overflow: visible !important; max-width: 100% !important; height: auto !important; }
            .no-print { display: none !important; }
        }
    </style>
    <div class="print-wrapper" style="font-family: 'Noto Sans TC', sans-serif; color: #000; width: 100%; margin: 0 auto; line-height: 1.4;">`;

    const itemOrder = tour.itemOrder || Object.keys(itemMap).sort(unitSortHelper);
    let printedItemCount = 0;

    itemOrder.forEach(itemName => {
        if (!itemMap[itemName]) return;

        const pageBreak = printedItemCount > 0 ? 'page-break-before: always;' : '';
        printedItemCount++;

        html += `
            <div style="${pageBreak}">
                <h1 style="text-align: center; font-size: 26px; font-weight: 900; margin: 0 0 8px 0;">${tour.name}</h1>
                <h2 style="text-align: center; font-size: 24px; font-weight: 900; margin: 0 0 24px 0; color: #000;">${itemName}</h2>
                <div style="display: block; width: 100%;">
        `;

        const unitsMap = itemMap[itemName];
        let unitCounter = 1;

        // ✨ 應用新的單位排序規則
        Object.keys(unitsMap).sort(unitSortHelper).forEach(unitName => {
            const d = unitsMap[unitName];

            // ✨ 新增：打包名字的輔助函式，強制該名字不可斷行
            const wrapName = (name) => `<span style="display: inline-block; white-space: nowrap;">${name}</span>`;

            // 將所有隊職員的名字都套用打包函式，再用「、」連接
            const leaders = Array.from(d.leaders).map(wrapName).join('、');
            const coaches = Array.from(d.coaches).map(wrapName).join('、');
            const managers = Array.from(d.managers).map(wrapName).join('、');
            const players = Array.from(d.players).map(wrapName).join('、');

            const leaderRow = leaders ? `<div style="display: flex; margin-bottom: 2px;"><strong style="width: 55px; flex-shrink: 0;">領隊:</strong><span style="flex-grow: 1; line-height: 1.6;">${leaders}</span></div>` : '';
            const managerRow = managers ? `<div style="display: flex; margin-bottom: 2px;"><strong style="width: 55px; flex-shrink: 0;">管理:</strong><span style="flex-grow: 1; line-height: 1.6;">${managers}</span></div>` : '';

            html += `
                <div style="width: 100%; margin-bottom: 28px; box-sizing: border-box; break-inside: avoid; page-break-inside: avoid;">
                    <div style="font-size: 18px; font-weight: 900; margin-bottom: 6px; border-bottom: 2px solid #000; padding-bottom: 4px; color: #000;">
                        ${unitCounter}. ${unitName}
                    </div>
                    <div style="font-size: 16px; padding-left: 0px; color: #000; margin-top: 6px;">
                        <div style="display: flex; margin-bottom: 2px;"><strong style="width: 55px; flex-shrink: 0;">教練:</strong><span style="flex-grow: 1; line-height: 1.6;">${coaches || '無'}</span></div>
                        ${leaderRow}
                        ${managerRow}
                        <div style="display: flex; margin-top: 4px;"><strong style="width: 55px; flex-shrink: 0;">隊員:</strong><span style="flex-grow: 1; font-weight: bold; line-height: 1.6;">${players || ''}</span></div>
                    </div>
                </div>
            `;
            unitCounter++;
        });
        html += `</div></div>`;
    });
    html += `</div>`;

    const summaryContainer = document.getElementById('summary-content');
    if (summaryContainer) summaryContainer.innerHTML = html;

    // ✨ 1. 設定系統內建下載 PDF 按鈕的檔名
    window.currentPdfFilename = `${tour.name} 隊職員表.pdf`;

    // ✨ 2. 強制修改網頁標題，讓瀏覽器原生 Ctrl+P (列印存成PDF) 時能自動抓到這個檔名
    document.title = `${tour.name} 隊職員表`;

    const activePage = document.querySelector('.page-section.active');
    if (activePage) window.lastPageBeforePrint = activePage.id.replace('page-', '');
    if (window.navigate) window.navigate('summary');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};


// ==========================================
// 3. 全站設定儲存處理中心 (Controller)
// ==========================================

export function initAdmin() {
    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // ✨ 核心防護：儲存前驗證 Token 並確認他依然是管理員
            const isAuthValid = await verifyAuthBeforeAction();
            if (!isAuthValid || !['admin', 'super_admin'].includes(currentUserRole)) {
                alert('權限不足或已過期，無法儲存設定！畫面將重新載入。');
                window.location.reload();
                return;
            }

            const btn = document.getElementById('btn-save-settings');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> 同步並儲存中...';
            btn.disabled = true;

            try {
                // 1. 從雲端抓取「當下最即時」的資料
                const docSnap = await getDoc(getSettingsDoc());
                const cloudData = docSnap.exists() ? docSnap.data() : {};
                const cloudTournaments = cloudData.tournaments || [];
                const cloudDeleted = cloudData.deletedTournaments || [];

                // 2. 收集縣市設定
                const globalCitiesInput = document.getElementById('global-cities-input');
                const globalCities = globalCitiesInput ? globalCitiesInput.value.split(',').map(s => s.trim()).filter(s => s !== '') : [];

                // 3. 遍歷 UI，建立「本次有變動」的賽事 Map
                const localUpdatesMap = new Map();
                const uiTourIds = [];

                document.querySelectorAll('.tournament-row').forEach(row => {
                    const id = row.dataset.id;
                    uiTourIds.push(id);

                    const name = row.querySelector('.tour-name').value.trim();
                    const nameEn = row.querySelector('.tour-name-en')?.value.trim() || "";
                    const start = row.querySelector('.tour-start').value;
                    const end = row.querySelector('.tour-end').value;

                    if (!name) return;
                    if (!start || !end) throw new Error(`賽事「${name}」的時間尚未設定完整！`);

                    const scope = row.querySelector('.tour-scope').value;
                    const city = row.querySelector('.tour-city')?.value || "";
                    const eventDate = row.querySelector('.tour-event-date')?.value.trim() || "";
                    const location = row.querySelector('.tour-location')?.value.trim() || "";
                    const isVisible = row.querySelector('.tour-visible')?.value === 'true';
                    const remittance = row.querySelector('.tour-remittance')?.value.trim() || "";

                    // ✨ 正確的宣告位置：放在這裡，讓整個 row 的範圍都能讀取到
                    const coachLimit = parseInt(row.querySelector('.tour-coach-limit')?.value) || 3;

                    let tourDetails = {};

                    if (id === currentEditTourId) {
                        // ✨ A. 如果是「正在進階編輯」的這場，直接從畫面上的 DOM 抓取最新內容
                        const linkage = {}; const fees = {}; const groupSettings = {}; const teamSizes = {}; const itemOrder = []; const groupOrder = {};
                        document.querySelectorAll('.item-card').forEach(card => {
                            const iName = card.querySelector('.item-name-input').value.trim();
                            if (iName) {
                                itemOrder.push(iName); groupOrder[iName] = []; linkage[iName] = {}; fees[iName] = {}; groupSettings[iName] = {};

                                // ✨ 修正：將 teamSizes 改為從項目層級 (item-card) 直接抓取
                                teamSizes[iName] = Math.max(1, parseInt(card.querySelector('.item-team-size-input').value) || 1);

                                card.querySelectorAll('.group-row').forEach(grow => {
                                    const gName = grow.querySelector('.group-name-input').value.trim();
                                    if (gName) {
                                        groupOrder[iName].push(gName);
                                        linkage[iName][gName] = grow.querySelector('.group-levels-input').value.split('\n').map(s => s.trim()).filter(s => s !== '');
                                        fees[iName][gName] = Math.max(0, parseInt(grow.querySelector('.group-fee-input').value) || 0);

                                        const reqId = grow.querySelector('.group-req-id')?.value || 'false';
                                        groupSettings[iName][gName] = {
                                            birthMin: grow.querySelector('.group-birth-min').value,
                                            birthMax: grow.querySelector('.group-birth-max').value,
                                            requireId: reqId
                                        };
                                    }
                                });
                            }
                        });
                        tourDetails = {
                            title: document.getElementById('set-tour-title').value,
                            titleEn: document.getElementById('set-tour-title-en')?.value || "",
                            rules: document.getElementById('set-tour-rules').value,
                            rulesEn: document.getElementById('set-tour-rules-en')?.value || "",
                            links: Array.from(document.querySelectorAll('.attachment-row')).map(r => ({ name: r.querySelector('.att-name').value, url: r.querySelector('.att-url').value })).filter(a => a.name && a.url),
                            linkage, fees, groupSettings, teamSizes, itemOrder, groupOrder
                        };
                    } else {
                        // ✨ B. 如果已經「關閉進階設定視窗」，必須從 appData (本地暫存) 中抓回剛剛打好的內容！
                        const localMatch = appData.tournaments.find(t => t.id === id) || {};
                        const cloudMatch = cloudTournaments.find(ct => ct.id === id) || {};

                        tourDetails = {
                            title: localMatch.title !== undefined ? localMatch.title : (cloudMatch.title || ""),
                            titleEn: localMatch.titleEn !== undefined ? localMatch.titleEn : (cloudMatch.titleEn || ""),
                            rules: localMatch.rules !== undefined ? localMatch.rules : (cloudMatch.rules || ""),
                            rulesEn: localMatch.rulesEn !== undefined ? localMatch.rulesEn : (cloudMatch.rulesEn || ""),
                            links: localMatch.links !== undefined ? localMatch.links : (cloudMatch.links || []),
                            linkage: localMatch.linkage !== undefined ? localMatch.linkage : (cloudMatch.linkage || {}),
                            fees: localMatch.fees !== undefined ? localMatch.fees : (cloudMatch.fees || {}),
                            groupSettings: localMatch.groupSettings !== undefined ? localMatch.groupSettings : (cloudMatch.groupSettings || {}),
                            teamSizes: localMatch.teamSizes !== undefined ? localMatch.teamSizes : (cloudMatch.teamSizes || {}),
                            itemOrder: localMatch.itemOrder !== undefined ? localMatch.itemOrder : (cloudMatch.itemOrder || []),
                            groupOrder: localMatch.groupOrder !== undefined ? localMatch.groupOrder : (cloudMatch.groupOrder || [])
                        };
                    }

                    // ✨ 將所有資訊 (包含 coachLimit) 彙整寫入 Map
                    localUpdatesMap.set(id, { id, name, nameEn, city, eventDate, location, start, end, scope, isVisible, remittance, coachLimit, ...tourDetails });
                });

                // 4. 核心合併邏輯：保留雲端其他人的修改，只覆蓋 UI 存在的項目
                const finalTournaments = [];

                cloudTournaments.forEach(ct => {
                    if (localUpdatesMap.has(ct.id)) {
                        finalTournaments.push(localUpdatesMap.get(ct.id));
                        localUpdatesMap.delete(ct.id);
                    } else {
                        if (uiTourIds.includes(ct.id)) {
                            finalTournaments.push(ct);
                        }
                    }
                });

                localUpdatesMap.forEach(newTour => finalTournaments.push(newTour));

                // 5. 處理刪除邏輯
                const newlyDeleted = cloudTournaments.filter(ct => !uiTourIds.includes(ct.id));
                const now = Date.now();
                newlyDeleted.forEach(t => t.deletedAt = now);
                const finalDeleted = [...cloudDeleted, ...newlyDeleted];

                // 6. 寫回雲端
                await setDoc(getSettingsDoc(), {
                    tournaments: finalTournaments,
                    cities: globalCities,
                    deletedTournaments: finalDeleted
                }, { merge: true });

                const msg = document.getElementById('save-msg');
                if (msg) {
                    msg.classList.remove('hidden');
                    setTimeout(() => msg.classList.add('hidden'), 3000);
                }
            } catch (e) {
                console.error(e);
                alert("儲存失敗：" + (e.message || "請檢查連線。"));
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }
}

// ==========================================
// 4. 多人同時編輯防護：在線狀態偵測 (Presence)
// ==========================================

window.renderAdminPresence = () => {
    const banner = document.getElementById('admin-presence-banner');

    // ✨ 修正：如果沒有登入，或「不是」全站/超級管理員，就直接隱藏警告並結束執行
    if (!banner || !currentUser || !['admin', 'super_admin'].includes(currentUserRole)) {
        if (banner) {
            banner.classList.add('hidden');
            banner.classList.remove('flex');
        }
        return;
    }

    const now = Date.now();
    const others = [];
    const admins = appData.activeAdmins || {};

    Object.keys(admins).forEach(uid => {
        if (uid !== currentUser.uid) {
            const data = admins[uid];
            if (now - data.time < 180000) {
                others.push(data.email);
            }
        }
    });

    if (others.length > 0) {
        banner.innerHTML = `
            <i class="fas fa-exclamation-triangle mr-3 text-2xl"></i> 
            <div>
                <b class="text-base">危險警告：系統偵測到 ${others.join(', ')} 目前也在後台活動！</b><br>
                <span class="text-xs font-bold opacity-80 mt-1 block">請避免同時點擊「儲存設定」導致資料互相覆蓋消失。</span>
            </div>`;
        banner.classList.remove('hidden');
        banner.classList.add('flex');
    } else {
        banner.classList.add('hidden');
        banner.classList.remove('flex');
    }
};

setInterval(() => {
    const adminPage = document.getElementById('page-admin');
    if (currentUser && adminPage && adminPage.classList.contains('active')) {
        if (['admin', 'super_admin'].includes(currentUserRole)) {
            setDoc(getSettingsDoc(), {
                activeAdmins: { [currentUser.uid]: { email: currentUser.email, time: Date.now() } }
            }, { merge: true }).catch(e => console.error("狀態更新失敗", e));
        }
    }
}, 60000);

window.addEventListener('beforeunload', () => {
    const adminPage = document.getElementById('page-admin');
    if (currentUser && adminPage && adminPage.classList.contains('active')) {
        if (['admin', 'super_admin'].includes(currentUserRole)) {
            setDoc(getSettingsDoc(), {
                activeAdmins: { [currentUser.uid]: { email: currentUser.email, time: 0 } }
            }, { merge: true }).catch(() => { });
        }
    }
});

// --- 項目細分統計視窗控制 ---
window.currentBreakdownItem = '';

window.showItemBreakdownModal = (itemName) => {
    window.currentBreakdownItem = itemName;
    const filterId = document.getElementById('admin-tour-filter').value;
    const modal = document.getElementById('itemDetailModal');
    const title = document.getElementById('modal-item-title');
    const body = document.getElementById('modal-item-body');

    if (!modal || !body) return;

    // 每次開啟新項目時，徹底清除高度限制與滾動位置
    body.style.minHeight = '';
    body.scrollTop = 0;

    // ✨ 1. 取得當前賽事的設定檔，以便抓取排序規則
    const tour = appData.tournaments.find(t => t.id === filterId) || (appData.deletedTournaments && appData.deletedTournaments.find(t => t.id === filterId)) || {};

    const regs = appData.registrations.filter(r => r.tournamentId === filterId && r.item === itemName);

    // 統計級別人數
    const detailedStats = {};
    regs.forEach(r => {
        const g = r.group || '未分類組別';
        const l = r.level || '未分類級別';
        if (!detailedStats[g]) detailedStats[g] = {};
        if (!detailedStats[g][l]) detailedStats[g][l] = 0;
        detailedStats[g][l]++;
    });

    // 初始標題 (圓餅圖)
    if (title) {
        title.innerHTML = `<i class="fas fa-chart-pie text-tkdBlue mr-3"></i> <span class="truncate text-gray-800">${escapeHTML(itemName)}</span>`;
    }

    let mainHtml = '<div id="modal-main-view" class="fade-in space-y-5">';
    let detailHtml = '<div id="modal-detail-view" class="hidden fade-in"></div>';

    // ✨ 2. 取出賽事設定中的「組別」排序清單
    const groupOrderList = (tour.groupOrder && tour.groupOrder[itemName]) ? tour.groupOrder[itemName] : [];

    // ✨ 3. 對組別進行正確排序
    const sortedGroups = Object.keys(detailedStats).sort((a, b) => {
        const indexA = groupOrderList.indexOf(a);
        const indexB = groupOrderList.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b, 'zh-TW');
    });

    sortedGroups.forEach(group => {
        let levelsHtml = '';

        // ✨ 4. 取出該組別對應的「級別/量級」排序清單
        const levelOrderList = (tour.linkage && tour.linkage[itemName] && tour.linkage[itemName][group]) ? tour.linkage[itemName][group] : [];

        // ✨ 5. 對級別進行正確排序
        const sortedLevels = Object.keys(detailedStats[group]).sort((a, b) => {
            const indexA = levelOrderList.indexOf(a);
            const indexB = levelOrderList.indexOf(b);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return a.localeCompare(b, 'zh-TW');
        });

        sortedLevels.forEach(level => {
            const count = detailedStats[group][level];
            let standardClass = 'border-gray-100 text-gray-600 bg-white hover:border-tkdBlue hover:bg-blue-50 cursor-pointer shadow-sm transition-all';
            let countBadge = `<span class="bg-gray-100 px-2.5 py-1 rounded-lg text-gray-500 text-xs">${count} 人</span>`;

            if (count === 1) {
                standardClass = 'border-red-200 text-red-700 bg-red-50 hover:bg-red-100 cursor-pointer shadow-sm transition-all';
                countBadge = `<span class="bg-red-500 text-white px-2.5 py-1 rounded-lg text-xs font-black flex items-center shadow-sm"><i class="fas fa-exclamation-triangle mr-1.5"></i>1 人</span>`;
            }

            // 安全處理 JS 字串中的單引號，防止點擊失效
            const jsGroup = group.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const jsLevel = level.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

            levelsHtml += `
                <div onclick="window.showLevelPlayers('${jsGroup}', '${jsLevel}')" class="flex justify-between items-center px-4 py-3 border rounded-xl text-sm font-bold group ${standardClass}">
                    <span class="group-hover:text-tkdBlue transition-colors">${getLang(level)}</span>
                    <div class="flex items-center gap-2">
                        ${countBadge}
                        <i class="fas fa-chevron-right text-gray-300 group-hover:text-tkdBlue transition-colors text-[10px] ml-1"></i>
                    </div>
                </div>
            `;
        });

        mainHtml += `
            <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div class="bg-gray-100 px-4 py-3 border-b border-gray-200">
                    <div class="text-sm font-black text-gray-800 flex items-center">
                        <i class="fas fa-users mr-2 text-gray-500"></i>${getLang(group)}
                    </div>
                </div>
                <div class="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    ${levelsHtml}
                </div>
            </div>
        `;
    });

    mainHtml += '</div>';
    body.innerHTML = (Object.keys(detailedStats).length > 0 ? mainHtml + detailHtml : '<div class="text-center py-10 text-gray-400 font-bold">暫無細分資料</div>');

    modal.classList.remove('hidden');
    setTimeout(() => modal.firstElementChild.classList.replace('scale-95', 'scale-100'), 10);
};

window.showLevelPlayers = (groupName, levelName) => {
    const filterId = document.getElementById('admin-tour-filter').value;
    const itemName = window.currentBreakdownItem;
    const mainView = document.getElementById('modal-main-view');
    const detailView = document.getElementById('modal-detail-view');
    const body = document.getElementById('modal-item-body');
    const title = document.getElementById('modal-item-title');

    // 1. 鎖定當前高度，防止切換時視窗縮短跳動
    if (mainView && body) {
        body.style.minHeight = `${mainView.offsetHeight}px`;
    }

    // 2. 切換標題按鈕
    if (title) {
        title.innerHTML = `
            <button onclick="window.backToModalMain()" class="mr-3 text-tkdBlue hover:text-blue-700 transition-all active:scale-90 bg-blue-50 w-9 h-9 rounded-full flex items-center justify-center border border-blue-100 shadow-sm shrink-0">
                <i class="fas fa-chevron-left"></i>
            </button>
            <div class="truncate text-gray-800">${escapeHTML(itemName)}</div>
        `;
    }

    const regs = appData.registrations.filter(r =>
        r.tournamentId === filterId &&
        r.item === itemName &&
        r.group === groupName &&
        r.level === levelName
    );

    // 依單位名稱排序 (英文優先、中文筆畫)
    regs.sort((a, b) => {
        const uA = (a.unit || '') + (a.subTeam || '');
        const uB = (b.unit || '') + (b.subTeam || '');
        const isAscii = (str) => str.length > 0 && str.charCodeAt(0) < 128;
        if (isAscii(uA) && !isAscii(uB)) return -1;
        if (!isAscii(uA) && isAscii(uB)) return 1;
        return uA.localeCompare(uB, 'zh-TW', { collation: 'stroke' });
    });

    let tbody = '';
    regs.forEach(r => {
        const displayUnit = `${escapeHTML(r.unit || '')}${escapeHTML(r.subTeam || '')}`;
        const names = escapeHTML(r.playerName || '').split(' / ').join('、');
        tbody += `
            <tr class="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td class="px-4 py-3 font-bold">${displayUnit}</td>
                <td class="px-4 py-3 font-bold text-gray-800">${names}</td>
            </tr>
        `;
    });

    const detailHtml = `
        <div class="mb-4 flex items-center border-b border-gray-200 pb-3">
            <div class="text-sm font-black text-gray-800 flex items-center">
                <i class="fas fa-users mr-2 text-gray-400"></i>
                ${escapeHTML(groupName)} <i class="fas fa-angle-right text-gray-400 mx-2 text-[10px]"></i> <span class="text-tkdRed">${escapeHTML(levelName)}</span>
            </div>
        </div>
        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm overflow-x-auto">
            <table class="w-full text-left text-sm text-gray-600 whitespace-nowrap">
                <thead class="bg-gray-50 text-[10px] text-gray-400 uppercase tracking-widest border-b border-gray-200">
                    <tr><th class="px-4 py-3 font-bold">參賽單位</th><th class="px-4 py-3 font-bold">選手姓名</th></tr>
                </thead>
                <tbody>${tbody}</tbody>
            </table>
        </div>
    `;

    if (mainView) mainView.classList.add('hidden');
    detailView.innerHTML = detailHtml;
    detailView.classList.remove('hidden');

    // 3. 切換到名單後，自動捲動到最上方
    body.scrollTop = 0;
};

window.backToModalMain = () => {
    const title = document.getElementById('modal-item-title');
    const body = document.getElementById('modal-item-body');
    const itemName = window.currentBreakdownItem;

    // 1. 還原標題圖示
    if (title) {
        title.innerHTML = `<i class="fas fa-chart-pie text-tkdBlue mr-3"></i> <span class="truncate text-gray-800">${escapeHTML(itemName)}</span>`;
    }

    // 2. ✨ 核心修正：返回總覽時，徹底清除高度鎖定 (minHeight)
    // 這樣瀏覽器才會重新根據「總覽內容」的實際長度來計算捲軸
    if (body) {
        body.style.minHeight = '';
    }

    // 3. 切換顯示狀態
    const detailView = document.getElementById('modal-detail-view');
    const mainView = document.getElementById('modal-main-view');

    if (detailView) detailView.classList.add('hidden');
    if (mainView) {
        mainView.classList.remove('hidden');
        // 額外確保：將視窗捲動回最上方，避免殘留上次名單的捲動位置
        const scrollContainer = body.closest('.overflow-y-auto') || body;
        scrollContainer.scrollTo({ top: 0 });
    }
};

window.closeItemDetailModal = () => {
    const modal = document.getElementById('itemDetailModal');
    if (!modal) return;
    modal.firstElementChild.classList.replace('scale-100', 'scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        const body = document.getElementById('modal-item-body');
        if (body) {
            body.style.minHeight = ''; // 徹底關閉時清除鎖定的高度
            body.scrollTop = 0;
        }
    }, 300);
};

// ==========================================
// ✨ 新增：快速帶入常見退件原因
// ==========================================
window.insertPresetRejectReason = (reasonText) => {
    const textarea = document.getElementById('review-notes-textarea');
    const select = document.getElementById('review-status-select');
    if (textarea) {
        // 若原本已有文字，則換行附加；若無則直接帶入
        textarea.value = textarea.value ? textarea.value + '\\n' + reasonText : reasonText;
    }
    if (select) {
        select.value = 'rejected';
    }
};