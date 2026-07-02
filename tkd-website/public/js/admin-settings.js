import { doc, setDoc, deleteDoc, getDocs, query, where, arrayUnion } from "firebase/firestore";
import { db, getSettingsDoc, getDbPath, appIdStr } from "./firebase.js";
import { appData, setAppData, currentEditTourId, setCurrentEditTourId } from "./store.js";

// ==========================================
// 1. 賽事列表 UI 互動小工具
// ==========================================
window.expandedTournaments = window.expandedTournaments || new Set();

window.toggleTournamentRow = (headerElement) => {
    const row = headerElement.closest('.tournament-row');
    const body = row.querySelector('.tournament-body');
    const icon = row.querySelector('.toggle-icon');
    const tourId = row.dataset.id; // ✨ 取得賽事 ID 作為唯一識別碼
    
    body.classList.toggle('hidden');
    if (body.classList.contains('hidden')) {
        icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
        if (tourId) window.expandedTournaments.delete(tourId); // ✨ 收合時刪除記憶
    } else {
        icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
        if (tourId) window.expandedTournaments.add(tourId); // ✨ 展開時加入記憶
    }
};

window.updateTournamentHeader = (inputElement) => {
    const row = inputElement.closest('.tournament-row');
    const headerTitle = row.querySelector('.tournament-header-title');
    headerTitle.innerText = inputElement.value.trim() || '新增賽事 (未命名)';
};

// ==========================================
// 2. 賽事架構設定 (UI 產生與編輯)
// ==========================================

export function populateAdminSettings() {
    const tc = document.getElementById('tournaments-editor'); 
    if (!tc) return; 

    // 建立兩大容器
    tc.innerHTML = `
        <div id="active-tournaments-container" class="space-y-4"></div>
        <div id="ended-tournaments-divider" class="mt-10 mb-4 flex items-center cursor-pointer select-none hover:opacity-80 transition-opacity" onclick="document.getElementById('ended-tournaments-container').classList.toggle('hidden'); const i = this.querySelector('.toggle-icon'); i.classList.toggle('fa-chevron-down'); i.classList.toggle('fa-chevron-up');">
            <div class="h-px bg-gray-200 flex-grow"></div>
            <span class="px-4 text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center">
                <i class="fas fa-archive mr-2"></i>已結束的歷史賽事 <span id="ended-count" class="ml-1"></span>
                <i class="fas fa-chevron-down ml-2 toggle-icon transition-transform"></i>
            </span>
            <div class="h-px bg-gray-200 flex-grow"></div>
        </div>
        <div id="ended-tournaments-container" class="space-y-4 opacity-80 hover:opacity-100 transition-opacity hidden"></div>
    `;

    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const activeTours = [];
    const endedTours = [];

    (appData.tournaments || []).forEach(t => {
        let eventEndDateMs = 0;
        if (t.eventDate) {
            const targetDateStr = t.eventDate.includes('~') 
                ? t.eventDate.split('~')[1].trim() 
                : t.eventDate.trim();
            const parsedDate = new Date(targetDateStr);
            if (!isNaN(parsedDate.getTime())) {
                parsedDate.setHours(23, 59, 59, 999);
                eventEndDateMs = parsedDate.getTime();
            }
        }

        // ✨ 判斷是否為歷史賽事，並執行「自動隱藏」
        if (eventEndDateMs > 0 && now > (eventEndDateMs + SEVEN_DAYS_MS)) {
            t.isVisible = false; // 自動將前台顯示狀態改為隱藏
            endedTours.push(t);
        } else {
            activeTours.push(t);
        }
    });

    // 排序：進行中依截止時間「近到遠」，歷史賽事依結束時間「新到舊」
    activeTours.sort((a, b) => new Date(a.end || '').getTime() - new Date(b.end || '').getTime());
    endedTours.sort((a, b) => {
        const getEnd = (tour) => tour.eventDate?.includes('~') ? tour.eventDate.split('~')[1].trim() : tour.eventDate;
        return new Date(getEnd(b)).getTime() - new Date(getEnd(a)).getTime();
    });

    const endedCountEl = document.getElementById('ended-count');
    if (endedCountEl) endedCountEl.innerText = `(${endedTours.length})`;
    
    if (endedTours.length === 0) {
        document.getElementById('ended-tournaments-divider')?.classList.add('hidden');
    }

    // 將賽事分配到正確的容器
    activeTours.forEach(t => window.addTournamentUI(t, 'active-tournaments-container')); 
    endedTours.forEach(t => window.addTournamentUI(t, 'ended-tournaments-container')); 
}
window.populateAdminSettings = populateAdminSettings;

window.addTournamentUI = (t = null, containerId = 'active-tournaments-container') => {
    let container = document.getElementById(containerId);
    if (!container) container = document.getElementById('tournaments-editor');
    if (!container) return;
    
    const id = t ? t.id : 'tour-' + Date.now();
    const row = document.createElement('div');
    
    row.className = "bg-white rounded-2xl border border-gray-200 flex flex-col tournament-row shadow-sm relative overflow-hidden transition-all duration-300";
    row.dataset.id = id;

    const cityOptions = (appData.cities || []).map(c => `<option value="${c}" ${t && t.city === c ? 'selected' : ''}>${c}</option>`).join('');

    window.expandedTournaments = window.expandedTournaments || new Set();
    const isExpanded = t === null || window.expandedTournaments.has(id);
    const bodyClass = isExpanded ? '' : 'hidden';
    const iconClass = isExpanded ? 'fa-chevron-up' : 'fa-chevron-down';

    row.innerHTML = `
        <div class="flex justify-between items-center p-4 sm:p-5 bg-gray-50/80 hover:bg-gray-100 cursor-pointer border-b border-transparent transition-colors" onclick="toggleTournamentRow(this)">
            <div class="flex items-center gap-3 overflow-hidden">
                <i class="fas fa-trophy text-tkdBlue"></i>
                <h4 class="font-black text-gray-800 truncate tournament-header-title text-base">${t ? t.name : '新增賽事 (未命名)'}</h4>
                ${t && t.isVisible === false ? '<span class="text-[10px] bg-gray-200 text-gray-500 px-2 py-0.5 rounded font-bold whitespace-nowrap">已隱藏</span>' : ''}
            </div>
            <div class="flex items-center gap-3 shrink-0 ml-2">
                <button type="button" onclick="event.stopPropagation(); moveToRecycleBin(this)" class="text-gray-400 hover:text-red-500 w-8 h-8 rounded-full hover:bg-red-50 flex items-center justify-center transition-colors">
                    <i class="fas fa-trash-alt"></i>
                </button>
                <div class="w-6 flex justify-center"><i class="fas ${iconClass} text-gray-400 toggle-icon transition-transform duration-300"></i></div>
            </div>
        </div>

        <div class="tournament-body flex flex-col gap-4 p-4 sm:p-6 border-t border-gray-100 ${bodyClass}">
            <div class="flex flex-col sm:flex-row gap-3 w-full">
                <div class="flex-[2]">
                    <label class="text-[10px] text-tkdBlue font-black block mb-1 uppercase tracking-widest">賽事名稱 (中文)</label>
                    <input type="text" value="${t ? t.name : ''}" oninput="updateTournamentHeader(this)" class="tour-name w-full border-2 border-gray-200 outline-none text-base font-bold px-4 py-3 rounded-xl bg-gray-50 focus:bg-white focus:border-tkdRed transition-colors">
                </div>
                <div class="flex-[2]">
                    <label class="text-[10px] text-gray-400 font-black block mb-1 uppercase tracking-widest">賽事名稱 (英文 - 選填)</label>
                    <input type="text" value="${t ? t.nameEn || '' : ''}" class="tour-name-en w-full border-2 border-gray-200 outline-none text-base font-bold px-4 py-3 rounded-xl bg-gray-50 focus:bg-white focus:border-tkdRed transition-colors" placeholder="Tournament Name (EN)">
                </div>
            </div>
            
            <div class="flex flex-col sm:flex-row gap-3 w-full">
                <div class="flex-1">
                    <label class="text-[10px] text-gray-400 block mb-1 font-bold uppercase">主辦縣市或單位</label>
                    <select class="tour-city w-full border-2 border-gray-200 bg-gray-50 rounded-xl px-4 py-3 text-sm focus:border-tkdBlue outline-none font-bold">
                        <option value="">無 / 不指定</option>
                        ${cityOptions}
                    </select>
                </div>
                <div class="flex-1">
                    <label class="text-[10px] text-gray-400 block mb-1 font-bold uppercase">實際比賽日期</label>
                    <input type="text" value="${t ? t.eventDate || '' : ''}" class="tour-event-date w-full border-2 border-gray-200 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold outline-none">
                </div>
                <div class="flex-1">
                    <label class="text-[10px] text-gray-400 block mb-1 font-bold uppercase">比賽場地/地點</label>
                    <input type="text" value="${t ? t.location || '' : ''}" class="tour-location w-full border-2 border-gray-200 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold outline-none">
                </div>
            </div>

            <div class="flex flex-col sm:flex-row gap-3 w-full">
                <div class="flex-1">
                    <label class="text-[10px] text-gray-400 block mb-1 font-bold uppercase">外隊參賽限制</label>
                    <select class="tour-scope w-full border-2 border-gray-200 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold">
                        <option value="all" ${!t || t.scope !== 'local' ? 'selected' : ''}>✅ 全國開放</option>
                        <option value="local" ${t && t.scope === 'local' ? 'selected' : ''}>🚫 限本縣市</option>
                    </select>
                </div>
                <div class="flex-1">
                    <label class="text-[10px] text-tkdBlue block mb-1 font-bold uppercase">教練名額 (1~3 名)</label>
                    <select class="tour-coach-limit w-full border-2 border-gray-200 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-tkdBlue transition-colors">
                        <option value="1" ${t && t.coachLimit === 1 ? 'selected' : ''}>開放 1 名</option>
                        <option value="2" ${t && t.coachLimit === 2 ? 'selected' : ''}>開放 2 名</option>
                        <option value="3" ${!t || !t.coachLimit || t.coachLimit === 3 ? 'selected' : ''}>開放 3 名 (預設)</option>
                    </select>
                </div>
                <div class="flex-1">
                    <label class="text-[10px] text-gray-400 block mb-1 font-bold uppercase">前台顯示狀態</label>
                    <select class="tour-visible w-full border-2 border-gray-200 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold">
                        <option value="true" ${!t || t.isVisible !== false ? 'selected' : ''}>👁️ 顯示於首頁</option>
                        <option value="false" ${t && t.isVisible === false ? 'selected' : ''}>🙈 暫時隱藏</option>
                    </select>
                </div>
            </div>

            <div class="flex flex-col sm:flex-row gap-3 w-full">
                <div class="flex-1">
                    <label class="text-[10px] text-gray-400 block mb-1 font-bold uppercase">開始報名時間</label>
                    <input type="text" value="${t ? t.start : ''}" class="tour-start w-full border-2 border-gray-200 bg-gray-50 rounded-xl px-4 py-3 text-sm text-center font-bold">
                </div>
                <div class="flex-1">
                    <label class="text-[10px] text-gray-400 block mb-1 font-bold uppercase">截止報名時間</label>
                    <input type="text" value="${t ? t.end : ''}" class="tour-end w-full border-2 border-gray-200 bg-gray-50 rounded-xl px-4 py-3 text-sm text-center font-bold">
                </div>
            </div>                        
            
            <div class="flex w-full mt-2">
                <div class="flex-1">
                    <label class="text-[10px] text-gray-400 block mb-1 font-bold uppercase">匯款資訊 (列印對帳單用，支援換行)</label>
                    <textarea class="tour-remittance w-full border-2 border-gray-200 bg-gray-50 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-tkdBlue focus:bg-white transition-colors h-20 placeholder-gray-300" placeholder="例如：\n銀行代碼：808 (玉山銀行)\n帳號：1234-567-890123\n戶名：王小明">${t && t.remittance ? t.remittance : ''}</textarea>
                </div>
            </div>

            <div class="flex gap-2 w-full mt-2">
                <button type="button" onclick="window.openDetailSettings('${id}')" class="w-full bg-gray-800 text-white px-4 py-3.5 rounded-xl text-sm font-bold hover:bg-black transition-colors flex justify-center items-center">
                    <i class="fas fa-cog mr-2"></i>進入進階設定 (項目/規程)
                </button>
            </div>
        </div>
    `;
    container.appendChild(row);

    if(window.flatpickr) {
        window.flatpickr(row.querySelectorAll('.tour-start, .tour-end'), {
            enableTime: true, time_24hr: true, locale: "zh_tw",
            dateFormat: "Y-m-d\\TH:i", altInput: true, altFormat: "Y-m-d H:i", disableMobile: "true"
        });        
    }
};

window.openDetailSettings = (id) => {
    const rows = document.querySelectorAll('.tournament-row');
    let tourName = "新賽事項目";
    rows.forEach(r => { if (r.dataset.id === id) tourName = r.querySelector('.tour-name').value || "未命名項目"; });
    
    setCurrentEditTourId(id);

    document.getElementById('settings-main-view').classList.add('hidden');
    const box = document.getElementById('detailed-settings-box');
    box.classList.remove('hidden');

    document.getElementById('current-edit-tour-name').innerText = tourName;
    const data = appData.tournaments.find(t => t.id === id) || {};
    document.getElementById('set-tour-title').value = data.title || "";
    document.getElementById('set-tour-rules').value = data.rules || "";

    if(document.getElementById('set-tour-title-en')) {
        document.getElementById('set-tour-title-en').value = data.titleEn || "";
    }
    if(document.getElementById('set-tour-rules-en')) {
        document.getElementById('set-tour-rules-en').value = data.rulesEn || "";
    }

    const attC = document.getElementById('attachments-editor');
    if (attC) { attC.innerHTML = ''; (data.links || []).forEach(l => window.addAttachmentUI(l.name, l.url)); }

    const linkC = document.getElementById('linkage-editor');
    if (linkC) {
        // 已移除此處動態生成 linkage-control-bar 的多餘邏輯
        linkC.innerHTML = '';
        const linkage = data.linkage || {};
        const fees = data.fees || {};
        const teamSizes = data.teamSizes || {};
        const itemOrder = data.itemOrder || Object.keys(linkage);

        // 相容性設計：讀取新的 groupSettings，若無則降級讀取舊的 itemSettings
        const groupSettings = data.groupSettings || {};
        const oldItemSettings = data.itemSettings || {};

        itemOrder.forEach(k => {
            if (linkage[k]) {
                const gOrder = (data.groupOrder && data.groupOrder[k]) ? data.groupOrder[k] : Object.keys(linkage[k]);
                const orderedGroupsData = {};
                const orderedGroupFees = {};
                const orderedGroupSettings = {}; 

                // 相容舊資料邏輯：如果舊資料是 Object，取第一個組別的人數；若是數字則直接使用
                let itemTeamSize = 1;
                if (typeof teamSizes[k] === 'object') {
                    const firstGroup = Object.keys(teamSizes[k])[0];
                    itemTeamSize = firstGroup ? teamSizes[k][firstGroup] : 1;
                } else if (teamSizes[k] !== undefined) {
                    itemTeamSize = teamSizes[k];
                }
                
                gOrder.forEach(gn => {
                    if (linkage[k][gn]) {
                        orderedGroupsData[gn] = linkage[k][gn];
                        orderedGroupFees[gn] = fees[k] ? fees[k][gn] : 0;
                        
                        if (groupSettings[k] && groupSettings[k][gn]) {
                            orderedGroupSettings[gn] = groupSettings[k][gn];
                        } else if (oldItemSettings[k]) {
                            orderedGroupSettings[gn] = oldItemSettings[k];
                        } else {
                            orderedGroupSettings[gn] = {};
                        }
                    }
                });
                
                // 傳入項目層級的 itemTeamSize
                window.addItemUI(k, orderedGroupsData, orderedGroupFees, orderedGroupSettings, itemTeamSize);
            }
        });

        // 替換這裡的 Sortable 設定：加入透明度與強制變色
        if (window.Sortable) {
            new window.Sortable(linkC, { 
                animation: 150, 
                handle: '.item-drag-handle', 
                ghostClass: 'opacity-40',     // 留在原地的佔位符變半透明，提示位置
                chosenClass: '!bg-blue-50',  // 抓起時強制卡片變淺藍底色
                dragClass: 'shadow-2xl',     // 拖曳時加深陰影使其浮起
                forceFallback: true 
            });
        }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.closeDetailSettings = () => {
    if (currentEditTourId) {
        const linkage = {};
        const fees = {};
        const groupSettings = {}; 
        const teamSizes = {}; 
        const itemOrder = []; 
        const groupOrder = {}; 

        document.querySelectorAll('.item-card').forEach(card => {
            const iName = card.querySelector('.item-name-input').value.trim();
            if (iName) {
                itemOrder.push(iName); 
                groupOrder[iName] = []; 
                linkage[iName] = {};
                fees[iName] = {};                
                teamSizes[iName] = {}; 
                groupSettings[iName] = {}; 

                // ✨ 儲存項目層級的參賽人數
                teamSizes[iName] = Math.max(1, parseInt(card.querySelector('.item-team-size-input').value) || 1);

                card.querySelectorAll('.group-row').forEach(grow => {
                    const gName = grow.querySelector('.group-name-input').value.trim();
                    const gFee = Math.max(0, parseInt(grow.querySelector('.group-fee-input').value) || 0);
                    const levels = grow.querySelector('.group-levels-input').value.split('\n').map(s => s.trim()).filter(s => s !== '');
                    
                    const bMin = grow.querySelector('.group-birth-min').value;
                    const bMax = grow.querySelector('.group-birth-max').value;
                    const reqId = grow.querySelector('.group-req-id')?.value || 'false';

                    if (gName) {
                        groupOrder[iName].push(gName); 
                        linkage[iName][gName] = levels;
                        fees[iName][gName] = gFee;
                        groupSettings[iName][gName] = { birthMin: bMin, birthMax: bMax, requireId: reqId }; 
                    }
                });
            }
        });

        const links = Array.from(document.querySelectorAll('.attachment-row')).map(r => ({ name: r.querySelector('.att-name').value, url: r.querySelector('.att-url').value })).filter(a => a.name && a.url);

        let ex = appData.tournaments.find(t => t.id === currentEditTourId);
        if (!ex) { ex = { id: currentEditTourId }; appData.tournaments.push(ex); }
        
        ex.title = document.getElementById('set-tour-title').value;
        ex.rules = document.getElementById('set-tour-rules').value;
        if(document.getElementById('set-tour-title-en')) {
            ex.titleEn = document.getElementById('set-tour-title-en').value;
        }
        if(document.getElementById('set-tour-rules-en')) {
            ex.rulesEn = document.getElementById('set-tour-rules-en').value;
        }
        ex.linkage = linkage;
        ex.fees = fees;
        ex.groupSettings = groupSettings; 
        ex.teamSizes = teamSizes;
        ex.links = links;
        ex.itemOrder = itemOrder; 
        ex.groupOrder = groupOrder; 
    }

    setCurrentEditTourId(null);
    document.getElementById('detailed-settings-box').classList.add('hidden');
    document.getElementById('settings-main-view').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.moveItemUp = (btn) => {
    const card = btn.closest('.item-card');
    const prev = card.previousElementSibling;
    if (prev && prev.classList.contains('item-card')) {
        card.parentNode.insertBefore(card, prev);
    }
};

window.moveItemDown = (btn) => {
    const card = btn.closest('.item-card');
    const next = card.nextElementSibling;
    if (next && next.classList.contains('item-card')) {
        card.parentNode.insertBefore(next, card);
    }
};

window.moveGroupUp = (btn) => {
    const row = btn.closest('.group-row');
    const prev = row.previousElementSibling;
    if (prev && prev.classList.contains('group-row')) {
        row.parentNode.insertBefore(row, prev);
    }
};

window.moveGroupDown = (btn) => {
    const row = btn.closest('.group-row');
    const next = row.nextElementSibling;
    if (next && next.classList.contains('group-row')) {
        row.parentNode.insertBefore(next, row);
    }
};

window.addItemUI = (itemName = "", groupsData = {}, groupFees = {}, groupSettingsMap = {}, itemTeamSize = 1) => {
    const container = document.getElementById('linkage-editor');
    if (!container) return;
    const card = document.createElement('div');
    
    card.className = "item-card bg-white border-2 border-gray-200 rounded-2xl flex flex-col relative shadow-sm transition-all duration-300 mb-6";
    
    const safeItemName = itemName ? itemName.replace(/"/g, '&quot;') : '';

    card.innerHTML = `
        <div class="item-header flex flex-col lg:flex-row justify-between items-start lg:items-center bg-gray-50 border-b border-gray-200 p-4 rounded-t-[15px] gap-4 transition-all">
            
            <div class="flex items-center w-full lg:w-auto flex-grow gap-2 sm:gap-3">
                <i class="fas fa-grip-vertical text-gray-400 cursor-move hover:text-tkdBlue text-lg item-drag-handle hidden sm:block px-2" title="拖曳排序"></i>
                <div class="flex-grow flex flex-col sm:flex-row sm:items-center gap-2 w-full">
                    <label class="block text-[10px] sm:text-xs text-gray-500 font-bold uppercase tracking-widest whitespace-nowrap shrink-0 ml-1 mb-0.5 sm:mb-0">參賽項目名稱</label>
                    <input type="text" class="item-name-input w-full text-base sm:text-lg font-black border border-gray-300 bg-white px-4 py-2 sm:py-2.5 rounded-xl outline-none text-tkdBlue focus:border-tkdBlue focus:ring-2 focus:ring-blue-100 transition-colors placeholder-gray-300 shadow-inner" placeholder="如: 國小對打,Elementary Sparring" value="${safeItemName}">
                </div>
            </div>
            
            <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between lg:justify-end w-full lg:w-auto gap-3 shrink-0">
                
                <div class="flex items-center justify-between sm:justify-start bg-white px-4 py-2 sm:px-3 rounded-xl border border-gray-300 shadow-sm w-full sm:w-auto">
                    <label class="text-xs text-gray-600 font-bold tracking-widest mr-2 whitespace-nowrap"><i class="fas fa-user-friends mr-1.5 text-tkdBlue"></i>參賽人數</label>
                    <input type="number" value="${itemTeamSize}" min="1" max="10" class="item-team-size-input w-16 text-center text-sm font-black text-tkdBlue outline-none bg-blue-50 border border-blue-100 rounded-lg py-1.5">
                </div>
                
                <div class="flex items-center justify-between sm:justify-start gap-1 bg-white p-1.5 rounded-xl border border-gray-300 shadow-sm w-full sm:w-auto">
                    <button type="button" onclick="window.moveItemUp(this)" class="text-gray-500 hover:text-tkdBlue transition-colors flex-1 sm:flex-initial sm:w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-50" title="向上移動"><i class="fas fa-arrow-up"></i></button>
                    <button type="button" onclick="window.moveItemDown(this)" class="text-gray-500 hover:text-tkdBlue transition-colors flex-1 sm:flex-initial sm:w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-50" title="向下移動"><i class="fas fa-arrow-down"></i></button>
                    <div class="w-px h-5 bg-gray-200 mx-0.5 shrink-0"></div>                    
                    <button type="button" onclick="window.toggleAllGroupsInItem(this)" class="text-tkdBlue hover:text-blue-700 transition-colors flex-1 sm:flex-initial sm:w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-100" title="收合/展開底下所有組別"><i class="fas fa-layer-group"></i></button>                    
                    <button type="button" onclick="window.toggleItemCollapse(this)" class="text-gray-500 hover:text-tkdBlue transition-colors flex-1 sm:flex-initial sm:w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-50" title="收合/展開此項目"><i class="fas fa-chevron-up toggle-icon transition-transform"></i></button>
                    <button type="button" onclick="this.closest('.item-card').remove()" class="text-red-400 hover:text-red-600 transition-colors flex-1 sm:flex-initial sm:w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50" title="刪除項目"><i class="fas fa-trash-alt"></i></button>
                </div>
            </div>
        </div>
        
        <div class="item-collapsible-content p-4 sm:p-6 transition-all duration-300 bg-white rounded-b-2xl">
            <div class="groups-container space-y-4 min-h-[10px]"></div>
            
            <button type="button" onclick="window.addGroupRowUI(this)" class="add-final-btn w-full mt-4 bg-gray-50/50 hover:bg-blue-50 text-tkdBlue text-sm font-black py-4 rounded-xl border-2 border-dashed border-gray-300 hover:border-tkdBlue transition-all shadow-sm flex justify-center items-center group">
                <i class="fas fa-plus mr-2 group-hover:scale-125 transition-transform"></i>新增一個組別 (屬於此項目)
            </button>
        </div>
    `;
    container.appendChild(card);

    const groupsContainer = card.querySelector('.groups-container');
    const btn = card.querySelector('.add-final-btn');
    
    Object.keys(groupsData).forEach(gn => window.addGroupRowUI(btn, gn, groupsData[gn], groupFees[gn] || 0, groupSettingsMap[gn] || {}));

    if (window.Sortable) {
        new window.Sortable(groupsContainer, { 
            animation: 150, handle: '.group-drag-handle', ghostClass: 'opacity-40', chosenClass: '!bg-yellow-50', dragClass: 'shadow-lg', forceFallback: true 
        });
    }
};

window.addGroupRowUI = (btn, groupName = "", levelsArr = [], fee = 0, gSet = {}) => {
    const container = btn.closest('.item-card').querySelector('.groups-container');
    if (!container) return;
    const row = document.createElement('div');
    
    row.className = "group-row bg-white rounded-xl border border-gray-200 flex flex-col relative shadow-sm transition-all hover:border-blue-200 group-card overflow-hidden";
    
    const safeGroupName = groupName ? groupName.replace(/"/g, '&quot;') : '';

    row.innerHTML = `
        <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-tkdBlue opacity-60"></div>
        
        <div class="group-header flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50/50 p-3 sm:px-5 sm:py-3 border-b border-gray-100 gap-3 transition-all pl-4 sm:pl-6">
            
            <div class="flex items-center w-full sm:w-auto flex-grow gap-2 sm:gap-3">
                <i class="fas fa-grip-vertical text-gray-300 cursor-move hover:text-tkdBlue text-sm group-drag-handle hidden sm:block px-1" title="拖曳排序"></i>
                
                <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 flex-grow w-full">
                    <div class="flex-grow">
                        <input type="text" class="group-name-input w-full border border-gray-200 bg-white px-3 py-2.5 rounded-lg outline-none text-sm font-bold text-gray-800 focus:border-tkdBlue focus:ring-2 focus:ring-blue-100 transition-colors placeholder-gray-300 shadow-inner" placeholder="輸入組別 (如: 國小男子組)" value="${safeGroupName}">
                    </div>
                    
                    <div class="shrink-0 sm:w-36 flex items-center bg-white border border-gray-200 rounded-lg px-2 shadow-inner focus-within:border-tkdRed focus-within:ring-2 focus-within:ring-red-50 transition-all">
                        <span class="text-gray-400 text-xs font-bold mr-1 pl-1">NT$</span>
                        <input type="number" value="${fee}" min="0" class="group-fee-input w-full text-sm font-black text-red-600 outline-none bg-transparent py-2.5" placeholder="0">
                    </div>
                </div>
            </div>
            
            <div class="flex items-center justify-end w-full sm:w-auto gap-1 bg-white p-1 rounded-lg border border-gray-200 shadow-sm shrink-0">
                <button type="button" onclick="window.moveGroupUp(this)" class="text-gray-400 hover:text-tkdBlue transition-colors w-7 h-7 flex items-center justify-center rounded-md hover:bg-blue-50" title="向上移動"><i class="fas fa-arrow-up"></i></button>
                <button type="button" onclick="window.moveGroupDown(this)" class="text-gray-400 hover:text-tkdBlue transition-colors w-7 h-7 flex items-center justify-center rounded-md hover:bg-blue-50" title="向下移動"><i class="fas fa-arrow-down"></i></button>
                <div class="w-px h-4 bg-gray-200 mx-0.5"></div>
                <button type="button" onclick="window.toggleGroupCollapse(this)" class="text-gray-400 hover:text-tkdBlue transition-colors w-7 h-7 flex items-center justify-center rounded-md hover:bg-blue-50" title="收合/展開"><i class="fas fa-chevron-up group-toggle-icon transition-transform"></i></button>
                <button type="button" onclick="this.closest('.group-row').remove()" class="text-red-400 hover:text-red-500 transition-colors w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-50" title="刪除組別"><i class="fas fa-trash-alt"></i></button>
            </div>
        </div>
        
        <div class="group-collapsible-content p-4 sm:p-5 pl-5 sm:pl-7 transition-all duration-300 bg-white">
            <div class="flex flex-col lg:flex-row gap-5">
                
                <div class="flex-1 flex flex-col gap-4">
                    <div class="bg-gray-50 p-4 sm:p-5 rounded-xl border border-gray-200 shadow-sm h-full flex flex-col justify-center">
                        <div class="mb-5">
                            <label class="block text-[10px] text-gray-500 font-bold mb-2 uppercase tracking-widest"><i class="fas fa-calendar-alt mr-1"></i> 生日限制區間 (選填)</label>
                            <div class="flex items-center gap-2">
                                <input type="text" value="${gSet.birthMin || ''}" class="group-birth-min w-full px-3 py-2.5 text-xs border border-gray-300 rounded-lg bg-white focus:border-tkdBlue outline-none font-bold transition-colors text-center shadow-inner" placeholder="最早 (起)">
                                <span class="text-gray-400 text-xs">~</span>
                                <input type="text" value="${gSet.birthMax || ''}" class="group-birth-max w-full px-3 py-2.5 text-xs border border-gray-300 rounded-lg bg-white focus:border-tkdBlue outline-none font-bold transition-colors text-center shadow-inner" placeholder="最晚 (迄)">
                            </div>
                        </div>
                        
                        <div>
                            <label class="block text-[10px] text-tkdBlue font-bold mb-2 uppercase tracking-widest"><i class="fas fa-id-card mr-1"></i> 身分證/護照收集</label>
                            <select class="group-req-id w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg bg-white focus:border-tkdBlue outline-none font-bold transition-colors cursor-pointer shadow-inner">
                                <option value="true" ${gSet.requireId === 'true' || gSet.requireId === undefined ? 'selected' : ''}>強制收集 (必填)</option>
                                <option value="false" ${gSet.requireId === 'false' ? 'selected' : ''}>不收集 (隱藏欄位)</option>
                            </select>
                        </div>
                    </div>
                </div>
                
                <div class="flex-1 flex flex-col">
                    <label class="block text-[10px] text-gray-500 font-bold mb-1.5 uppercase tracking-widest"><i class="fas fa-list-ol mr-1"></i>量級 / 級別設定 (每行輸入一個)</label>
                    <textarea class="group-levels-input w-full flex-grow border border-gray-200 bg-white rounded-xl px-4 py-3 outline-none text-sm leading-relaxed min-h-[140px] resize-none focus:border-tkdBlue focus:ring-2 focus:ring-blue-50 transition-all font-medium shadow-inner" placeholder="例如:\n-25kg\n-29kg\n或\n黑帶組\n色帶組">${levelsArr.join('\n')}</textarea>
                </div>
                
            </div>
        </div>
    `;
    container.appendChild(row);

    const nameInput = row.querySelector('.group-name-input');
    setTimeout(() => { nameInput.style.height = nameInput.scrollHeight + 'px'; }, 10);

    if(window.flatpickr) {
        window.flatpickr(row.querySelectorAll('.group-birth-min, .group-birth-max'), {
            dateFormat: "Y-m-d", locale: "zh_tw", disableMobile: "true"
        });
    }
};

window.addAttachmentUI = (name = "", url = "") => {
    const container = document.getElementById('attachments-editor');
    if (!container) return;
    const row = document.createElement('div');
    row.className = "flex flex-col sm:flex-row gap-3 sm:gap-4 bg-gray-50 p-4 sm:p-3 rounded-xl border border-gray-200 attachment-row items-start sm:items-center relative shadow-sm";
    row.innerHTML = `
        <div class="flex-1 w-full">
            <label class="block text-[10px] text-gray-500 font-bold mb-1 sm:hidden">附件名稱</label>
            <input type="text" value="${name}" placeholder="檔案名稱 (如: 競賽規程PDF)" class="att-name w-full border border-gray-200 sm:border-b sm:border-t-0 sm:border-l-0 sm:border-r-0 sm:border-gray-300 outline-none text-sm bg-white sm:bg-transparent font-bold px-3 py-2 sm:p-1 rounded-lg sm:rounded-none focus:border-tkdBlue transition-colors">
        </div>
        <div class="flex-[2] w-full">
            <label class="block text-[10px] text-gray-500 font-bold mb-1 sm:hidden">雲端連結網址</label>
            <input type="text" value="${url}" placeholder="輸入 Google Drive 等雲端連結" class="att-url w-full border border-gray-200 sm:border-b sm:border-t-0 sm:border-l-0 sm:border-r-0 sm:border-gray-300 outline-none text-sm text-blue-600 bg-white sm:bg-transparent px-3 py-2 sm:p-1 rounded-lg sm:rounded-none focus:border-tkdBlue transition-colors">
        </div>
        <button type="button" onclick="this.parentElement.remove()" class="absolute top-3 right-3 sm:static text-gray-400 hover:text-red-500 bg-white sm:bg-transparent px-2 py-1 rounded sm:p-1 shadow-sm sm:shadow-none border border-gray-200 sm:border-none transition-colors">
            <i class="fas fa-trash-alt"></i>
        </button>
    `;
    container.appendChild(row);
};

// ==========================================
// 3. 賽事回收桶管理
// ==========================================

export function renderRecycleBin() {
    const container = document.getElementById('recycle-bin-container');
    if (!container) return;
    const deleted = appData.deletedTournaments || [];

    if (deleted.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-400 font-bold text-center py-6 border-2 border-dashed border-gray-200 rounded-xl">回收桶目前是空的</p>';
        return;
    }

    container.innerHTML = '';
    deleted.forEach(t => {
        const deletedDate = t.deletedAt ? new Date(t.deletedAt).toLocaleDateString() : '未知時間';
        const row = document.createElement('div');
        row.className = "flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm gap-3";
        row.innerHTML = `
            <div>
                <div class="font-black text-gray-600 text-sm line-through decoration-gray-400 decoration-2">${t.name}</div>
                <div class="text-[10px] text-gray-400 font-bold mt-1">原定日期: ${t.start} ~ ${t.end} <span class="mx-2">|</span> 移入回收桶日期: ${deletedDate}</div>
            </div>
            <div class="flex gap-2 w-full sm:w-auto">
                <button type="button" onclick="restoreTournament('${t.id}')" class="flex-1 sm:flex-none bg-green-50 text-green-600 border border-green-200 px-4 py-2 rounded-xl text-xs font-bold hover:bg-green-100 transition-colors shadow-sm"><i class="fas fa-undo mr-1"></i> 復原賽事</button>
                <button type="button" onclick="forceDeleteTournament('${t.id}')" class="flex-1 sm:flex-none bg-gray-50 text-gray-400 border border-gray-200 px-4 py-2 rounded-xl text-xs font-bold hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"><i class="fas fa-times mr-1"></i> 徹底刪除</button>
            </div>
        `;
        container.appendChild(row);
    });
}
window.renderRecycleBin = renderRecycleBin;

window.restoreTournament = async (id) => {
    const t = appData.deletedTournaments.find(x => x.id === id);
    if (!t) return;
    if (!confirm(`確定要復原「${t.name}」嗎？\n復原後它將重新回到賽事列表中。`)) return;

    const restoredT = { ...t };
    delete restoredT.deletedAt;

    const newTournaments = [...appData.tournaments, restoredT];
    const newDeleted = appData.deletedTournaments.filter(x => x.id !== id);

    try {
        await setDoc(getSettingsDoc(), { tournaments: newTournaments, deletedTournaments: newDeleted }, { merge: true });
        alert("已成功復原賽事！");
    } catch (e) {
        alert("復原失敗，請檢查網路連線。");
    }
};

window.forceDeleteTournament = async (id) => {
    if (!confirm("⚠️ 警告：這將徹底刪除該賽事，且無法復原！\n(系統將會在刪除前，自動為所有報名帳號結算並保留歷史足跡)\n\n確定要刪除嗎？")) return;
    
    try {
        const q = query(getDbPath('registrations'), where("tournamentId", "==", id));
        const querySnapshot = await getDocs(q);

        // --- 階段 1：結算並歸檔歷史資料 (Data Archiving) ---
        const userArchiveMap = {};
        let tourName = '';
        
        querySnapshot.forEach((docSnap) => {
            const r = docSnap.data();
            if (!tourName) tourName = r.tournamentName || '未知賽事';
            const email = r.email;
            if (!email) return;

            if (!userArchiveMap[email]) {
                userArchiveMap[email] = { count: 0, units: new Set(), coaches: new Set() };
            }
            userArchiveMap[email].count++;
            if (r.unit) userArchiveMap[email].units.add(r.unit);
            if (r.coach1) userArchiveMap[email].coaches.add(r.coach1.trim());
        });

        // 轉換 Base64 確保與後端編碼一致
        const emailToBase64 = (str) => {
            try { return btoa(unescape(encodeURIComponent(str))); }
            catch(e) { return btoa(str); }
        };

        const archivePromises = [];
        for (const [email, data] of Object.entries(userArchiveMap)) {
            const safeEmailId = emailToBase64(email);
            // 注意：這裡是直接寫入 user_stats
            const statsRef = doc(db, 'artifacts', appIdStr, 'public', 'data', 'user_stats', safeEmailId);
            
            const updateData = {
                [`archivedTournaments.${tourName}`]: { 
                    count: data.count, 
                    units: Array.from(data.units) 
                }
            };
            
            if (data.units.size > 0) updateData.archivedUnits = arrayUnion(...Array.from(data.units));
            if (data.coaches.size > 0) updateData.archivedCoaches = arrayUnion(...Array.from(data.coaches));

            archivePromises.push(setDoc(statsRef, updateData, { merge: true }));
        }
        
        if (archivePromises.length > 0) {
            await Promise.all(archivePromises);
            console.log("✅ 歷史資料結算歸檔完成！");
        }

        // --- 階段 2：徹底刪除原始報名資料 ---
        const deletePromises = [];
        querySnapshot.forEach((docSnap) => {
            deletePromises.push(deleteDoc(docSnap.ref));
        });
        await Promise.all(deletePromises);

        // --- 階段 3：更新回收桶狀態並解除全域地雷 ---
        const newDeleted = appData.deletedTournaments.filter(x => x.id !== id);
        await setDoc(getSettingsDoc(), { deletedTournaments: newDeleted }, { merge: true });
        
        alert(`刪除與結算成功！已徹底清除該賽事，並為相關帳號永久保留歷史足跡。`);
    } catch (e) {
        console.error(e);
        alert("刪除失敗：" + e.message);
    }
};

window.clearRecycleBin = async () => {
    if (!confirm("確定要清空回收桶嗎？\n這將徹底刪除所有已標記為刪除的賽事，且無法復原！\n(系統會在刪除前執行歷史結算與歸檔)")) return;

    try {
        let totalDeletedRegs = 0;
        const emailToBase64 = (str) => { try { return btoa(unescape(encodeURIComponent(str))); } catch(e) { return btoa(str); } };

        for (const t of appData.deletedTournaments) {
            const q = query(getDbPath('registrations'), where("tournamentId", "==", t.id));
            const querySnapshot = await getDocs(q);
            
            // --- 階段 1：結算歷史歸檔 ---
            const userArchiveMap = {};
            let tourName = '';
            querySnapshot.forEach((docSnap) => {
                const r = docSnap.data();
                if (!tourName) tourName = r.tournamentName || t.title || '未知賽事';
                const email = r.email;
                if (!email) return;

                if (!userArchiveMap[email]) {
                    userArchiveMap[email] = { count: 0, units: new Set(), coaches: new Set() };
                }
                userArchiveMap[email].count++;
                if (r.unit) userArchiveMap[email].units.add(r.unit);
                if (r.coach1) userArchiveMap[email].coaches.add(r.coach1.trim());
            });

            const archivePromises = [];
            for (const [email, data] of Object.entries(userArchiveMap)) {
                const safeEmailId = emailToBase64(email);
                const statsRef = doc(db, 'artifacts', appIdStr, 'public', 'data', 'user_stats', safeEmailId);
                
                const updateData = { [`archivedTournaments.${tourName}`]: { count: data.count, units: Array.from(data.units) } };
                if (data.units.size > 0) updateData.archivedUnits = arrayUnion(...Array.from(data.units));
                if (data.coaches.size > 0) updateData.archivedCoaches = arrayUnion(...Array.from(data.coaches));
                
                archivePromises.push(setDoc(statsRef, updateData, { merge: true }));
            }
            if (archivePromises.length > 0) await Promise.all(archivePromises);

            // --- 階段 2：徹底刪除 ---
            const deletePromises = [];
            querySnapshot.forEach((docSnap) => {
                deletePromises.push(deleteDoc(docSnap.ref));
                totalDeletedRegs++;
            });
            await Promise.all(deletePromises);
        }

        // --- 階段 3：清空狀態 ---
        await setDoc(getSettingsDoc(), { deletedTournaments: [] }, { merge: true });
        alert(`已徹底清空回收桶！共歸檔並清理了 ${totalDeletedRegs} 筆報名資料。`);
    } catch (e) {
        console.error(e);
        alert("清空失敗：" + e.message);
    }
};

window.moveToRecycleBin = (btn) => {
    if (confirm('⚠️ 確定要將這場賽事移至回收桶嗎？\n\n(為了確保資料同步，系統會為您自動執行一次「儲存設定」，儲存後賽事就會出現在下方的回收桶中)')) {
        btn.closest('.tournament-row').remove();
        window.closeDetailSettings();
        const saveBtn = document.getElementById('btn-save-settings');
        if (saveBtn) saveBtn.click();
    }
};

window.toggleItemCollapse = (btn) => {
    const card = btn.closest('.item-card');
    const content = card.querySelector('.item-collapsible-content');
    const header = card.querySelector('.item-header');
    const icon = btn.querySelector('.toggle-icon');

    content.classList.toggle('hidden');

    if (content.classList.contains('hidden')) {
        icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
        header.classList.remove('border-transparent', 'pb-0');
        header.classList.add('border-gray-200', 'pb-3');
    } else {
        icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
        header.classList.add('border-transparent', 'pb-0');
        header.classList.remove('border-gray-200', 'pb-3');
    }
};

// 單一組別卡片收合
window.toggleGroupCollapse = (btn) => {
    const row = btn.closest('.group-row');
    const content = row.querySelector('.group-collapsible-content');
    const header = row.querySelector('.group-header');
    const icon = btn.querySelector('.group-toggle-icon');

    content.classList.toggle('hidden');

    if (content.classList.contains('hidden')) {
        icon.classList.replace('fa-chevron-up', 'fa-chevron-down');
        header.classList.remove('pb-0');
        header.classList.add('pb-2');
    } else {
        icon.classList.replace('fa-chevron-down', 'fa-chevron-up');
        header.classList.add('pb-0');
        header.classList.remove('pb-2');
    }
};

// 一鍵控制全部
window.toggleAllItems = (collapse) => {
    document.querySelectorAll('.item-card').forEach(card => {
        const itemContent = card.querySelector('.item-collapsible-content');
        const itemBtn = card.querySelector('.toggle-icon').closest('button');
        
        // 控制項目層級
        if (collapse && !itemContent.classList.contains('hidden')) {
            window.toggleItemCollapse(itemBtn);
        } else if (!collapse && itemContent.classList.contains('hidden')) {
            window.toggleItemCollapse(itemBtn);
        }

        // 同步控制裡面的組別層級
        card.querySelectorAll('.group-row').forEach(row => {
            const groupContent = row.querySelector('.group-collapsible-content');
            const groupBtn = row.querySelector('.group-toggle-icon').closest('button');
            if (collapse && !groupContent.classList.contains('hidden')) {
                window.toggleGroupCollapse(groupBtn);
            } else if (!collapse && groupContent.classList.contains('hidden')) {
                window.toggleGroupCollapse(groupBtn);
            }
        });
    });
};

// ✨ 專門用於收合/展開特定項目底下「所有組別」的函式
window.toggleAllGroupsInItem = (btn) => {
    const itemCard = btn.closest('.item-card');
    const groupRows = itemCard.querySelectorAll('.group-row');
    if (groupRows.length === 0) return;
    
    // 檢查第一個組別目前的狀態，決定接下來是「全部展開」還是「全部收合」
    const firstContent = groupRows[0].querySelector('.group-collapsible-content');
    const isCurrentlyCollapsed = firstContent.classList.contains('hidden');
    
    groupRows.forEach(row => {
        const content = row.querySelector('.group-collapsible-content');
        const icon = row.querySelector('.group-toggle-icon');
        
        if (isCurrentlyCollapsed) {
            // 展開
            content.classList.remove('hidden');
            if(icon) icon.classList.remove('rotate-180');
        } else {
            // 收合
            content.classList.add('hidden');
            if(icon) icon.classList.add('rotate-180');
        }
    });
};