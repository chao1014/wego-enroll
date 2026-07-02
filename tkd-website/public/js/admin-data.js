import { doc, setDoc, deleteDoc, getDocs, query, where, arrayUnion, writeBatch } from "firebase/firestore";
import { db, getSettingsDoc, getDbPath, appIdStr, SUPER_ADMIN } from "./firebase.js";
import { appData, currentUser } from "./store.js";

// ==========================================
// 1. 匯出 Excel 報表
// ==========================================

window.exportToExcel = async () => {
    // ✨ 動態載入：點擊時才下載 XLSX 套件
    if (!window.XLSX) {
        try {
            const xlsxModule = await import('xlsx');
            window.XLSX = xlsxModule;
        } catch (e) {
            return alert("匯出套件載入失敗，請確認網路狀態後重試！");
        }
    }

    const filterId = document.getElementById('admin-tour-filter').value;
    let dataToExport = appData.registrations;
    let titleStr = "韻動賽事報名明細";
    let tour = null;

    if (filterId) {
        dataToExport = appData.registrations.filter(r => r.tournamentId === filterId);
        tour = appData.tournaments.find(t => t.id === filterId) || (appData.deletedTournaments && appData.deletedTournaments.find(t => t.id === filterId));
        if (tour) titleStr = tour.name + "_報名明細";
    }

    if (dataToExport.length === 0) {
        alert("目前無資料可匯出！");
        return;
    }

    const wb = window.XLSX.utils.book_new();

    const groupedData = {};
    dataToExport.forEach(r => {
        const itemName = r.item || "未分類項目";
        if (!groupedData[itemName]) groupedData[itemName] = [];
        groupedData[itemName].push(r);
    });

    let itemOrder = [];
    if (tour && tour.itemOrder && tour.itemOrder.length > 0) {
        const definedItems = tour.itemOrder.filter(item => groupedData[item]);
        const undefinedItems = Object.keys(groupedData).filter(item => !tour.itemOrder.includes(item)).sort();
        itemOrder = [...definedItems, ...undefinedItems];
    } else {
        itemOrder = Object.keys(groupedData).sort();
    }

    itemOrder.forEach(itemName => {
        const itemData = groupedData[itemName];
        
        // ✨ 同步排序邏輯：組別 -> 級別 -> 單位(英文優先+筆畫) -> 生日
        itemData.sort((a, b) => {
            let groupOrderList = (tour && tour.groupOrder && tour.groupOrder[itemName]) ? tour.groupOrder[itemName] : [];
            const groupA = a.group || '';
            const groupB = b.group || '';
            const groupIndexA = groupOrderList.indexOf(groupA);
            const groupIndexB = groupOrderList.indexOf(groupB);
            
            if (groupIndexA !== -1 && groupIndexB !== -1 && groupIndexA !== groupIndexB) return groupIndexA - groupIndexB;
            if (groupIndexA !== -1 && groupIndexB === -1) return -1;
            if (groupIndexA === -1 && groupIndexB !== -1) return 1;
            if (groupA !== groupB) return groupA.localeCompare(groupB, 'zh-TW');

            let levelOrderList = (tour && tour.linkage && tour.linkage[itemName] && tour.linkage[itemName][groupA]) ? tour.linkage[itemName][groupA] : [];
            const levelA = a.level || '';
            const levelB = b.level || '';
            const levelIndexA = levelOrderList.indexOf(levelA);
            const levelIndexB = levelOrderList.indexOf(levelB);

            if (levelIndexA !== -1 && levelIndexB !== -1 && levelIndexA !== levelIndexB) return levelIndexA - levelIndexB;
            if (levelIndexA !== -1 && levelIndexB === -1) return -1;
            if (levelIndexA === -1 && levelIndexB !== -1) return 1;
            if (levelA !== levelB) return levelA.localeCompare(levelB, 'zh-TW');
            
            // ✨ 單位排序 tie-breaker
            const uA = (a.unit || '') + (a.subTeam || '');
            const uB = (b.unit || '') + (b.subTeam || '');
            if (uA !== uB) {
                const isAscii = (str) => str.length > 0 && str.charCodeAt(0) < 128;
                if (isAscii(uA) && !isAscii(uB)) return -1;
                if (!isAscii(uA) && isAscii(uB)) return 1;
                const uRes = uA.localeCompare(uB, 'zh-TW', { collation: 'stroke' });
                if (uRes !== 0) return uRes;
            }

            const birthA = (a.birthday || '').split(' / ')[0];
            const birthB = (b.birthday || '').split(' / ')[0];
            const timeA = new Date(birthA).getTime();
            const timeB = new Date(birthB).getTime();
            if (!isNaN(timeA) && !isNaN(timeB)) return timeA - timeB; 
            return birthA.localeCompare(birthB, 'zh-TW');
        });
        
        let maxPlayersInThisItem = 1;
        itemData.forEach(r => {
            const pCount = r.playerName ? r.playerName.split(" / ").length : 1;
            if (pCount > maxPlayersInThisItem) maxPlayersInThisItem = pCount;
        });
        
        const excelData = [];
        
        const headers = ["編號", "參賽單位", "連絡電話", "領隊", "管理", "教練1", "教練2", "教練3"];
        for (let i = 1; i <= maxPlayersInThisItem; i++) {
            headers.push(`選手姓名${i}`, `出生年月日${i}`, `身分證/護照${i}`);
        }
        headers.push("項目", "組別", "級別", "報名費", "登錄時間", "帳號信箱");
        excelData.push(headers);

        itemData.forEach((r, idx) => {
            const names = (r.playerName || "").split(" / ");
            const births = (r.birthday || "").split(" / ");
            const ids = (r.idNumber || "").split(" / ");

            const row = [
                idx + 1,
                (r.unit || "") + (r.subTeam || ""),
                r.phone || "未提供",
                r.leader || "", r.manager || "",
                r.coach1 || "", r.coach2 || "", r.coach3 || ""
            ];

            for (let i = 0; i < maxPlayersInThisItem; i++) {
                row.push(names[i] || "", births[i] || "", ids[i] || "");
            }

            row.push(r.item, r.group, r.level, r.fee || 0, r.time, r.email);
            excelData.push(row);
        });

        const ws = window.XLSX.utils.aoa_to_sheet(excelData);
        let safeSheetName = itemName.replace(/[\\\/\?\*\[\]\:]/g, '_').substring(0, 31);
        let finalSheetName = safeSheetName;
        let counter = 1;
        while (wb.SheetNames.includes(finalSheetName)) {
            const suffix = `_${counter}`;
            finalSheetName = safeSheetName.substring(0, 31 - suffix.length) + suffix;
            counter++;
        }
        window.XLSX.utils.book_append_sheet(wb, ws, finalSheetName);
    });

    window.XLSX.writeFile(wb, `${titleStr}.xlsx`);
};

window.exportSummaryToExcel = async () => {
    const filterId = document.getElementById('admin-tour-filter').value;
    if (!filterId) return alert('請先選擇一場賽事！');

    // ✨ 動態載入：點擊時才下載 XLSX 套件
    if (!window.XLSX) {
        try {
            const xlsxModule = await import('xlsx');
            window.XLSX = xlsxModule;
        } catch (e) {
            return alert("匯出套件載入失敗，請確認網路狀態後重試！");
        }
    }

    const tour = appData.tournaments.find(t => t.id === filterId) || (appData.deletedTournaments && appData.deletedTournaments.find(t => t.id === filterId));
    const regs = appData.registrations.filter(r => r.tournamentId === filterId);

    if (regs.length === 0) return alert('此賽事目前無報名資料，無法匯出！');

    // 1. 抓出所有動態「參賽項目」作為 X 軸欄位
    const allItems = [...new Set(regs.map(r => r.item || '未分類項目'))].sort();

    // 2. 統計各單位數據
    const unitStats = {};
    let grandTotalFee = 0;
    let grandTotalCount = 0;
    const itemTotals = {};
    allItems.forEach(item => itemTotals[item] = 0); 

    regs.forEach(r => {
        // 將主單位與分隊結合，作為獨立的統計對象
        const st = r.subTeam || '';
        const unit = st ? `${r.unit}${st}` : (r.unit || '未填寫單位');
        
        if (!unitStats[unit]) {
            unitStats[unit] = {
                coach: r.coach1 || '', 
                items: {},
                fee: 0,
                count: 0
            };
            allItems.forEach(item => unitStats[unit].items[item] = 0);
        }
        
        // 若該筆有填教練且原本為空，則補上
        if (!unitStats[unit].coach && r.coach1) {
            unitStats[unit].coach = r.coach1.trim();
        }

        const itemName = r.item || '未分類項目';
        const fee = parseInt(r.fee) || 0;

        unitStats[unit].items[itemName]++;
        unitStats[unit].fee += fee;
        unitStats[unit].count++;

        itemTotals[itemName]++;
        grandTotalFee += fee;
        grandTotalCount++;
    });

    // 3. 建立 Excel 用的二維陣列
    const excelData = [];
    
    const headers = ['單位', '教練', ...allItems, '報名費用', '報名人次', '備註'];
    excelData.push(headers);

    Object.keys(unitStats).sort().forEach(unit => {
        const row = [ unit, unitStats[unit].coach ];
        
        allItems.forEach(item => {
            row.push(unitStats[unit].items[item]);
        });
        
        row.push(unitStats[unit].fee);
        row.push(unitStats[unit].count);
        row.push(''); 
        excelData.push(row);
    });

    const totalRow = ['統計', ''];
    allItems.forEach(item => totalRow.push(itemTotals[item]));
    totalRow.push(grandTotalFee);
    totalRow.push(grandTotalCount);
    totalRow.push('');
    excelData.push(totalRow);

    // 4. 觸發 Excel 匯出
    const ws = window.XLSX.utils.aoa_to_sheet(excelData);
    
    const wscols = [
        {wch: 22}, // 單位
        {wch: 12}, // 教練欄寬
    ];
    allItems.forEach(() => wscols.push({wch: 12})); 
    wscols.push({wch: 14}); // 報名費用
    wscols.push({wch: 12}); // 報名人次
    wscols.push({wch: 20}); // 備註
    ws['!cols'] = wscols;

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "各單位總表");
    window.XLSX.writeFile(wb, `${tour.name}_單位報名與費用總表.xlsx`);
};

// ==========================================
// 2. 全站資料備份與還原 (Super Admin 專屬)
// ==========================================

window.exportFullBackup = () => {
    if (!currentUser || currentUser.email !== SUPER_ADMIN) {
        return alert("⛔ 權限不足：只有「超級管理員」才能執行全站資料備份！");
    }
    const btn = document.getElementById('btn-full-backup');
    const originalHtml = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> 資料打包中...';

    try {
        const backupData = {
            exportTime: new Date().toLocaleString(),
            systemSettings: {
                tournaments: appData.tournaments || [],
                cities: appData.cities || [],
                admins: appData.admins || [],
                scopedAdmins: appData.scopedAdmins || {},
                adminNames: appData.adminNames || {},
                blockedUsers: appData.blockedUsers || [],
                deletedTournaments: appData.deletedTournaments || [],
                historicalUserUnits: appData.historicalUserUnits || {}
            },
            registrationsDatabase: appData.registrations || []
        };

        const dataStr = JSON.stringify(backupData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const dateStr = new Date().toISOString().split('T')[0];
        a.download = `韻動系統全站備份_${dateStr}.json`;

        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }, 500);

    } catch (err) {
        console.error("備份打包失敗", err);
        alert("備份失敗！請檢查資料或重試。");
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
};

window.restoreFullBackup = async () => {
    if (!currentUser || currentUser.email !== SUPER_ADMIN) {
        return alert("⛔ 權限不足：只有「超級管理員」才能執行系統還原作業！");
    }
    const fileInput = document.getElementById('backup-file-input');
    const btn = document.getElementById('btn-full-restore');
    const originalHtml = btn.innerHTML;

    if (!fileInput.files || fileInput.files.length === 0) {
        return alert("請先點擊左側選擇一個 JSON 備份檔案！");
    }

    const file = fileInput.files[0];

    if (!confirm(`⚠️ 【極度危險警告】\n\n您確定要從「${file.name}」還原系統嗎？\n這將會【徹底覆蓋】雲端目前的賽事設定，並刪除所有新報名的資料，回到備份當時的狀態！\n\n強烈建議在還原前，先點擊「下載備份」保留目前的版本。\n\n您確定要繼續執行嗎？`)) {
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> 系統還原中...';

    try {
        const fileText = await file.text();
        const backupData = JSON.parse(fileText);

        if (!backupData.systemSettings || !backupData.registrationsDatabase) {
            throw new Error("這不是有效的韻動系統備份檔，或檔案已損毀。");
        }

        // 1. 還原設定檔
        await setDoc(getSettingsDoc(), backupData.systemSettings, { merge: false });

        // 2. ✨ 安全分批刪除現有報名資料 (採用 writeBatch 每 450 筆一組)
        const currentRegsQuery = query(getDbPath('registrations'));
        const currentRegsSnap = await getDocs(currentRegsQuery);
        
        let batch = writeBatch(db);
        let count = 0;

        for (const docSnap of currentRegsSnap.docs) {
            batch.delete(docSnap.ref);
            count++;
            if (count === 450) {
                await batch.commit();
                batch = writeBatch(db);
                count = 0;
            }
        }
        if (count > 0) {
            await batch.commit();
        }

        // 3. ✨ 安全分批寫入備份檔的報名資料 (採用 writeBatch 每 450 筆一組)
        batch = writeBatch(db);
        count = 0;

        for (const reg of backupData.registrationsDatabase) {
            const docId = reg.id;
            const regData = { ...reg };
            delete regData.id;

            const docRef = doc(db, 'artifacts', appIdStr, 'public', 'data', 'registrations', docId);
            batch.set(docRef, regData);
            count++;

            if (count === 450) {
                await batch.commit();
                batch = writeBatch(db);
                count = 0;
            }
        }
        if (count > 0) {
            await batch.commit();
        }

        alert(`🎉 系統還原大成功！\n共還原了 ${backupData.registrationsDatabase.length} 筆報名資料。\n畫面即將重新載入以套用最新狀態。`);
        window.location.reload();

    } catch (err) {
        console.error("還原失敗:", err);
        alert(`還原失敗：${err.message}\n請檢查網路連線或確認備份檔是否正確。`);
        btn.disabled = false;
        btn.innerHTML = originalHtml;
        fileInput.value = '';
    }
};

// ==========================================
// 3. 產生核對名單 (Entry List)
// ==========================================

window.generateEntryList = () => {
    const filterId = document.getElementById('admin-tour-filter').value;
    if (!filterId) return alert('請先選擇一場賽事！');

    const tour = appData.tournaments.find(t => t.id === filterId) || (appData.deletedTournaments && appData.deletedTournaments.find(t => t.id === filterId));
    const regs = appData.registrations.filter(r => r.tournamentId === filterId);

    if (regs.length === 0) return alert('此賽事目前無報名資料，無法產生報表！');

    // 1. 在此自定義各欄位的寬度比例 (確保加總為 100%)
    const colWidths = {
        item: "20%",    // 項目
        group: "20%",   // 組別
        level: "25%",   // 級別/量級
        name: "20%",    // 選手姓名
        birth: "15%"    // 出生年月日
    };

    // 核心排序小工具 (英文優先，中文嚴格依照筆畫逐字比較)
    const unitSortHelper = (aKey, bKey) => {
        const isAscii = (str) => str.length > 0 && str.charCodeAt(0) < 128;
        const aAsc = isAscii(aKey);
        const bAsc = isAscii(bKey);
        if (aAsc && !bAsc) return -1;
        if (!aAsc && bAsc) return 1;
        return aKey.localeCompare(bKey, 'zh-TW', { collation: 'stroke' });
    };

    // 以「單位+分隊」進行群組化
    const groupedByUnit = {};
    regs.forEach(r => {
        const st = r.subTeam || '';
        // ✨ 修正：將 email 加入 Key，確保不同帳號就算同單位名稱，也不會混在一起
        const unitKey = `${r.email || '未知帳號'}_${r.unit}_${st}`;
        
        if (!groupedByUnit[unitKey]) {
            groupedByUnit[unitKey] = [];
        }
        groupedByUnit[unitKey].push(r);
    });

    const sortedUnitKeys = Object.keys(groupedByUnit).sort((aKey, bKey) => {
        const emailA = (groupedByUnit[aKey][0].email || '').toLowerCase();
        const emailB = (groupedByUnit[bKey][0].email || '').toLowerCase();

        if (emailA !== emailB) {
            return emailA.localeCompare(emailB);
        }
        // ✨ 修正排序邏輯：同帳號時，比對真實的單位名稱而不是複合 Key
        return unitSortHelper(groupedByUnit[aKey][0].unit, groupedByUnit[bKey][0].unit);
    });

    let html = `
    <style>
        @media print {
            @page { margin: 1cm; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
            main { padding-top: 0 !important; padding-bottom: 0 !important; margin-top: 0 !important; }
            #page-summary > div { padding: 0 !important; border: none !important; box-shadow: none !important; overflow: visible !important; }
            .print-wrapper { overflow: visible !important; max-width: 100% !important; }
            .no-print { display: none !important; }
            
            table { page-break-inside: auto; margin-bottom: 32px; width: 100%; border-collapse: collapse; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            thead { display: table-header-group; }
            tfoot { display: table-row-group; }
            .unit-header { 
                page-break-inside: avoid !important; 
                break-inside: avoid !important; 
                page-break-after: avoid !important; 
            } 
        }
    </style>
    <div class="print-wrapper" style="font-family: 'Noto Sans TC', sans-serif; max-width: 1000px; margin: 0 auto; color: black; padding: 0; background: white; overflow-x: auto;">
    
    <!-- ✨ 3. 將總標題修改為您的需求 -->
    <h1 style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px; font-size: 24px; font-weight: 900; line-height: 1.4;">
        ${tour.name} 分組參賽名單（核對名單）
    </h1>`;

    sortedUnitKeys.forEach((unitKey) => {
        const unitRegs = groupedByUnit[unitKey];
        
        unitRegs.sort((a, b) => {
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

        const firstReg = unitRegs[0];
        const leader = firstReg.leader || '無';
        const manager = firstReg.manager || '無';
        const coaches = [firstReg.coach1, firstReg.coach2, firstReg.coach3].filter(c => c).join('、') || '無';
        const email = firstReg.email || '未知帳號';
        const displayUnitName = firstReg.subTeam ? `${firstReg.unit}${firstReg.subTeam}` : firstReg.unit;

        html += `
        <div class="unit-header" style="background-color: #f8f9fa; padding: 12px 16px; border-left: 5px solid #D32F2F; margin-bottom: 0; break-inside: avoid; page-break-inside: avoid; page-break-after: avoid;">
            <div style="font-size: 18px; font-weight: 900; color: #111827; margin-bottom: 6px;">
                ${displayUnitName} 分組參賽名單
            </div>
            <div style="font-size: 13px; color: #4B5563; font-weight: bold; line-height: 1.5;">
                領隊：${leader} / 管理：${manager} / 教練：${coaches} <span style="margin: 0 10px; color: #ccc;">|</span> <span style="white-space: nowrap;">報名帳號：${email}</span>
            </div>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px; table-layout: fixed;">
            <thead style="background-color: #f3f4f6;">
                <tr>
                    <th style="border:1px solid #ccc; padding: 10px; text-align:left; width: ${colWidths.item};">項目</th>
                    <th style="border:1px solid #ccc; padding: 10px; text-align:left; width: ${colWidths.group};">組別</th>
                    <th style="border:1px solid #ccc; padding: 10px; text-align:left; width: ${colWidths.level};">級別 / 量級</th>
                    <th style="border:1px solid #ccc; padding: 10px; text-align:left; width: ${colWidths.name};">選手姓名</th>
                    <th style="border:1px solid #ccc; padding: 10px; text-align:center; width: ${colWidths.birth};">出生年月日</th>
                </tr>
            </thead>
            <tbody>
        `;

        unitRegs.forEach(r => {
            const namesArr = (r.playerName || '').split(' / ');
            const birthsArr = (r.birthday || '').split(' / ');

            const nameDivs = namesArr.map(n => `<div style="margin-bottom:4px;">${n}</div>`).join('');
            const birthDivs = birthsArr.map(b => `<div style="margin-bottom:4px; color:#555;">${b || '-'}</div>`).join('');
            
            html += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="border:1px solid #ccc; padding: 10px; vertical-align:top; font-weight:bold; word-wrap: break-word;">${r.item}</td>
                    <td style="border:1px solid #ccc; padding: 10px; vertical-align:top; color:#555; word-wrap: break-word;">${r.group}</td>
                    <td style="border:1px solid #ccc; padding: 10px; vertical-align:top; color:#D32F2F; font-weight:900; word-wrap: break-word;">${r.level}</td>
                    <td style="border:1px solid #ccc; padding: 10px; vertical-align:top; font-weight:bold; word-wrap: break-word;">${nameDivs}</td>
                    <td style="border:1px solid #ccc; padding: 10px; text-align:center; vertical-align:top; white-space: nowrap;">${birthDivs}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;
    });

    html += `</div>`;

    const summaryContainer = document.getElementById('summary-content');
    if (summaryContainer) summaryContainer.innerHTML = html;

    // ✨ 4. 確保 PDF 檔案名稱與網頁標題也一起更新
    window.currentPdfFilename = `${tour.name} （核對名單）.pdf`;
    document.title = `${tour.name} （核對名單）`;

    const activePage = document.querySelector('.page-section.active');
    if (activePage) window.lastPageBeforePrint = activePage.id.replace('page-', '');
    if (window.navigate) window.navigate('summary');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ✨ 匯出項目級別細分統計 Excel
window.exportItemBreakdownToExcel = async () => { // ✨ 必須加上 async
    const filterId = document.getElementById('admin-tour-filter').value;
    if (!filterId) return alert('請先選擇一場賽事！');

    // ✨ 補上動態載入：點擊時才下載 XLSX 套件
    if (!window.XLSX) {
        try {
            const xlsxModule = await import('xlsx');
            window.XLSX = xlsxModule;
        } catch (e) {
            return alert("匯出套件載入失敗，請確認網路狀態後重試！");
        }
    }

    const tour = appData.tournaments.find(t => t.id === filterId) || (appData.deletedTournaments && appData.deletedTournaments.find(t => t.id === filterId));
    const regs = appData.registrations.filter(r => r.tournamentId === filterId);

    if (regs.length === 0) return alert('此賽事目前無報名資料，無法匯出！');

    // 1. 準備統計資料容器
    const levelStats = {};     // 用於第一分頁：級別細分
    const itemIncomeStats = {}; // 用於第二分頁：收入統計

    regs.forEach(r => {
        const item = r.item || '未分類項目';
        const group = r.group || '未分類組別';
        const level = r.level || '未分類級別';
        const fee = parseInt(r.fee) || 0;
        const pCount = r.playerName ? r.playerName.split(' / ').length : 1;

        // 統計級別人數
        if (!levelStats[item]) levelStats[item] = {};
        if (!levelStats[item][group]) levelStats[item][group] = {};
        if (!levelStats[item][group][level]) levelStats[item][group][level] = 0;
        levelStats[item][group][level]++;

        // 統計項目收入
        if (!itemIncomeStats[item]) {
            itemIncomeStats[item] = { entryCount: 0, playerCount: 0, totalFee: 0 };
        }
        itemIncomeStats[item].entryCount++;
        itemIncomeStats[item].playerCount += pCount;
        itemIncomeStats[item].totalFee += fee;
    });

    const wb = window.XLSX.utils.book_new();
    const itemOrder = tour.itemOrder || Object.keys(levelStats).sort();

    // --- 分頁 1: 級別人數統計 ---
    const excelData1 = [['參賽項目', '組別', '級別 / 量級', '報名人數']];
    
    itemOrder.forEach(itemName => {
        if (!levelStats[itemName]) return;
        const groupOrder = (tour.groupOrder && tour.groupOrder[itemName]) || Object.keys(levelStats[itemName]).sort();
        
        groupOrder.forEach(groupName => {
            if (!levelStats[itemName][groupName]) return;
            const levelOrder = (tour.linkage && tour.linkage[itemName] && tour.linkage[itemName][groupName]) || Object.keys(levelStats[itemName][groupName]).sort();
            
            levelOrder.forEach(levelName => {
                const count = levelStats[itemName][groupName][levelName];
                if (count !== undefined) {
                    excelData1.push([itemName, groupName, levelName, count]);
                }
            });
        });
    });

    const ws1 = window.XLSX.utils.aoa_to_sheet(excelData1);
    ws1['!cols'] = [{wch: 25}, {wch: 20}, {wch: 20}, {wch: 12}];
    window.XLSX.utils.book_append_sheet(wb, ws1, "級別人數統計");

    // --- 分頁 2: 項目收入統計 ---
    const excelData2 = [['參賽項目', '總報名組數', '總報名人數', '總報名費收入']];
    let grandTotalFee = 0;

    itemOrder.forEach(itemName => {
        const s = itemIncomeStats[itemName];
        if (s) {
            excelData2.push([itemName, s.entryCount, s.playerCount, s.totalFee]);
            grandTotalFee += s.totalFee;
        }
    });

    // 加入最後一列總計
    excelData2.push(['總計', '', '', grandTotalFee]);

    const ws2 = window.XLSX.utils.aoa_to_sheet(excelData2);
    ws2['!cols'] = [{wch: 25}, {wch: 15}, {wch: 15}, {wch: 15}];
    window.XLSX.utils.book_append_sheet(wb, ws2, "項目收入統計");

    // 3. 匯出 Excel
    if (window.XLSX) {
        window.XLSX.writeFile(wb, `${tour.name}_賽事項目數據分析.xlsx`);
    } else {
        alert("匯出套件載入失敗！");
    }
};

// ==========================================
// 🌟 歷史隊職員資料一鍵校正工具
// ==========================================
window.fixHistoricalStaffData = async () => {
    if (!confirm("即將掃描並校正全站舊有的隊職員資料！\n\n系統會自動找出每個單位「最後一次填寫」的教練名單，並覆寫該單位先前的報名紀錄以保持一致。\n確定要執行嗎？")) return;

    const btn = document.getElementById('btn-fix-staff');
    if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> 校正中...';

    try {
        // 1. 時間解析輔助函式
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

        // ✨ 修正核心：強制向雲端抓取「全站所有報名紀錄」，而不是使用前端的不完整快取
        const snap = await getDocs(query(getDbPath('registrations')));
        const allRegs = [];
        snap.forEach(d => allRegs.push({ id: d.id, ...d.data() }));

        // 2. 將全站資料按「賽事+帳號+單位+分隊」分組
        const groups = {};
        allRegs.forEach(r => {
            const key = `${r.tournamentId}_${r.userId}_${r.unit}_${r.subTeam || ''}`;
            if (!groups[key]) groups[key] = [];
            groups[key].push(r);
        });

        const updates = [];

        // 3. 找出最新資料並進行交叉比對
        for (const key in groups) {
            const regs = groups[key];
            if (regs.length <= 1) continue; // 該單位只有一位選手，無需同步

            // 依時間降冪排序 (最新的在 index 0)
            regs.sort((a, b) => parseTimeMs(b.time) - parseTimeMs(a.time));
            const latest = regs[0]; // 拿最後一位選手當作最新基準

            // 檢查較舊的資料是否與最新基準不同
            for (let i = 1; i < regs.length; i++) {
                const older = regs[i];
                if (older.phone !== latest.phone || older.leader !== latest.leader ||
                    older.manager !== latest.manager || older.coach1 !== latest.coach1 ||
                    older.coach2 !== latest.coach2 || older.coach3 !== latest.coach3) {
                    
                    updates.push({
                        id: older.id,
                        data: {
                            phone: latest.phone || '',
                            leader: latest.leader || '',
                            manager: latest.manager || '',
                            coach1: latest.coach1 || '',
                            coach2: latest.coach2 || '',
                            coach3: latest.coach3 || ''
                        }
                    });
                }
            }
        }

        if (updates.length === 0) {
            alert("檢查完畢！目前全站所有單位的隊職員資料都已經是一致的，不需校正。");
            if (btn) btn.innerHTML = '<i class="fas fa-tools mr-2"></i> 校正歷史隊職員';
            return;
        }

        // 4. 批次寫入 Firestore
        let batch = writeBatch(db);
        let count = 0;
        let totalProcessed = 0;

        for (const update of updates) {
            const ref = doc(db, 'artifacts', appIdStr, 'public', 'data', 'registrations', update.id);
            batch.update(ref, update.data);
            count++;
            totalProcessed++;

            if (count === 450) { 
                await batch.commit();
                batch = writeBatch(db);
                count = 0;
            }
        }
        if (count > 0) {
            await batch.commit(); 
        }

        alert(`🎉 校正大成功！\n系統已自動抓取並同步了 ${totalProcessed} 筆舊選手資料的隊職員名單。\n畫面將重新載入以顯示最新狀態。`);
        window.location.reload();

    } catch (e) {
        console.error(e);
        alert("校正過程發生錯誤：" + e.message);
    } finally {
        if (btn) btn.innerHTML = '<i class="fas fa-tools mr-2"></i> 校正歷史隊職員';
    }
};

// 全賽事重複報名批次檢查功能
window.checkTournamentDuplicates = async () => {
    const filterId = document.getElementById('admin-tour-filter').value;
    if (!filterId) return alert('請先選擇一場賽事！');

    const tour = appData.tournaments.find(t => t.id === filterId);
    // 強制從當前顯示的資料中抓取 (包含全域所有單位的資料)
    const regs = window.adminCurrentTourRegs || [];

    if (regs.length === 0) return alert('此賽事目前無報名資料可檢查。');

    const duplicates = [];
    const seen = new Map();
    
    // 🌟 神奇過濾器與日期補零機制
    const normalize = (str) => (str || '').toString().replace(/\s+/g, '').toLowerCase();
    const formatBirth = (dStr) => {
        if (!dStr) return '';
        let clean = normalize(dStr).replace(/-/g, '/');
        let parts = clean.split('/');
        if (parts.length === 3) return `${parts[0]}/${parts[1].padStart(2, '0')}/${parts[2].padStart(2, '0')}`;
        return clean;
    };

    regs.forEach(r => {
        // 先依照原本的 ' / ' 切割出陣列，絕對不能先 normalize
        const names = (r.playerName || '').split(' / ');
        const births = (r.birthday || '').split(' / ');
        const ids = (r.idNumber || '').split(' / ');

        names.forEach((name, i) => {
            const nName = normalize(name);
            const nBirth = formatBirth(births[i]);
            const nId = normalize(ids[i]);

            // 建立選手唯一識別碼：姓名 + 生日 (+ 證號)
            const personId = `${nName}_${nBirth}_${nId}`;
            
            // 建立防撞槽位：同一個人只要報名了同一個「項目 (item)」，就算佔用名額
            const slotId = `${personId}_${r.item}`;

            if (seen.has(slotId)) {
                duplicates.push({
                    player: name.trim(), // 顯示給管理員看的正常名字
                    item: r.item,
                    group1: seen.get(slotId).group, level1: seen.get(slotId).level,
                    group2: r.group, level2: r.level,
                    unit1: seen.get(slotId).unit, email1: seen.get(slotId).email,
                    unit2: r.unit, email2: r.email
                });
            } else {
                seen.set(slotId, { 
                    unit: r.unit, email: r.email, group: r.group, level: r.level 
                });
            }
        });
    });

    if (duplicates.length === 0) {
        window.showToast('✅ 檢查完畢：目前無發現任何重複報名資料。');
    } else {
        let listHtml = `<div class="space-y-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar text-left">`;
        duplicates.forEach((d, idx) => {
            listHtml += `
                <div class="bg-red-50 p-3 rounded-xl border border-red-100 text-xs shadow-sm">
                    <div class="font-black text-red-600 mb-1 text-sm"><i class="fas fa-user-times mr-1.5"></i>選手：${d.player}</div>
                    <div class="text-gray-700 font-bold mb-2">重複參加了：<span class="text-tkdRed">${d.item}</span></div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-gray-600 border-t border-red-100 pt-2">
                        <div class="bg-white p-2 rounded border border-gray-100"><span class="text-tkdBlue font-black block mb-1">📌 紀錄 A</span>${d.unit1}<br><span class="text-[10px] text-gray-400 break-all">${d.email1}</span><br><span class="font-bold text-gray-800">${d.group1} - ${d.level1}</span></div>
                        <div class="bg-white p-2 rounded border border-gray-100"><span class="text-tkdRed font-black block mb-1">📌 紀錄 B</span>${d.unit2}<br><span class="text-[10px] text-gray-400 break-all">${d.email2}</span><br><span class="font-bold text-gray-800">${d.group2} - ${d.level2}</span></div>
                    </div>
                </div>`;
        });
        listHtml += `</div>`;
        
        await window.showCustomConfirm(
            `⚠️ 系統發現 ${duplicates.length} 筆重複報名紀錄`, 
            listHtml, 
            '我知道了', 
            '關閉視窗'
        );
    }
};