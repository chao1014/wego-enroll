// tkd-website/public/js/i18n.js

export const translations = {
    'zh-TW': {
        // --- 1. 導覽列與首頁 ---
        'nav.list': '賽事列表',
        'nav.info': '競賽規程',
        'nav.my-records': '我的報名',
        'nav.login': '系統登入',
        'nav.logout': '登出帳號',
        'nav.admin': '管理後台',
        'home.title': '韻動國際報名系統',
        'home.subtitle': '挑戰自我，成就卓越。請於下方選擇您欲參加的賽事。',
        'home.search': '輸入賽事關鍵字...',
        'home.city': '全部',
        'info.consent-prefix': '我已詳細閱讀並同意 ',
        'info.consent-link': '隱私權保護政策',
        'info.consent-agree': '我已詳細閱讀並同意上述條款',
        'info.btn-register': '前往填寫報名表',
        'info.attachments': '附件下載',

        // --- 2. 賽事報名表 ---
        'reg.form-title': '賽事報名表',
        'reg.section1': '1. 單位與職員資料',
        'reg.section2': '2. 選手參賽資料',
        'reg.multi-unit-title': '多單位報名提醒',
        'reg.multi-unit-content': '同一個帳號可以為「多個不同單位」進行報名，無須切換帳號。請直接更改下方「參賽單位」名稱即可送出新單位的資料。',
        'reg.selected-tour': '選定賽事：',
        'reg.user-records-title': '您的報名紀錄與總表',
        'reg.records-count': '{n} 筆',
        'reg.unit': '參賽單位',
        'reg.phone': '連絡電話',
        'reg.placeholder-phone': '手機號碼或市話',
        'reg.auto-fill': '帶入歷史資料',
        'reg.leader': '領隊',
        'reg.manager': '管理',
        'reg.coach1': '教練 1',
        'reg.coach2': '教練 2 (選填)',
        'reg.coach3': '教練 3 (選填)',
        'reg.sub-team': '分隊 (選填)',
        'reg.player-title': '選手 {n}',
        'reg.player-name': '選手姓名',
        'reg.player-birth': '出生年月日',
        'reg.player-id': '身分證字號 / 護照',
        'reg.placeholder-name': '真實姓名',
        'reg.placeholder-birth': '例：1997/06/01',
        'reg.placeholder-id': '例：A123456789',
        'reg.item': '參賽項目',
        'reg.group': '組別',
        'reg.level': '量級/級別',
        'reg.save': '儲存並提交本筆資料',
        'reg.save-edit': '儲存修改內容',
        'reg.admin-badge': '管理員特權',
        'reg.loading-create-title': '正在安全送出報名',
        'reg.loading-edit-title': '正在安全儲存修改',
        'reg.loading-description': '系統正在儲存並確認資料，請先不要重複送出或關閉頁面。',
        'reg.loading-checked': '資料檢查完成',
        'reg.loading-saving': '正在儲存報名資料',
        'reg.loading-wait': '通常只需要幾秒鐘，感謝您的耐心等候',
        'reg.loading-button': '正在送出，請稍候',

        // --- 3. 賽事狀態與時間 ---
        'reg.status-pending': '尚未開放報名',
        'reg.status-open': '系統受理報名中',
        'reg.status-closed': '報名已截止',
        'reg.time-expect': '預計開放',
        'reg.time-deadline': '截止時間',
        'reg.time-remaining': '剩餘',
        'reg.day': '天',

        // --- 4. 表格與列印總表 ---
        'table.name': '選手姓名',
        'table.birthday': '出生年月日',
        'table.id': '身分證字號',
        'table.item': '參賽項目',
        'table.group': '組別',
        'table.level': '量級 / 級別',
        'table.fee': '報名費 (NT$)',
        'table.action': '操作',
        'table.action-edit': '修改',
        'table.action-delete': '刪除',
        'table.total-label': '此單位總計報名費用：',
        'table.receipt-title': '單位報名總表',
        'table.unit': '參賽單位',
        'table.leader': '領隊',
        'table.manager': '管理',
        'table.coach': '教練',
        'table.phone': '電話',
        'table.phone-label': '連絡電話:',
        'table.leader-manager-label': '領隊/管理:',
        'table.coach-list-label': '教練名單:',
        'table.print-summary-btn': '列印報名總表',
        'table.print-date': '列印日期',
        'table.total-players': '總報名人數',
        'table.total-amount': '總計應繳金額：',
        'table.signature': '領隊 / 教練簽名',
        'summary.back': '返回上一頁',
        'summary.print': '列印此表 (或存成 PDF)',

        // --- 5. 系統訊息、驗證提示與視窗 ---
        'msg.save-success': '🎉 報名成功！',
        'msg.edit-success': '🎉 報名資料修改成功！',
        'msg.confirm-delete': '確定要刪除這筆報名資料嗎？',
        'msg.alert-title': '系統提示',
        'msg.privacy-alert': '⚠️ 系統提示：<br>請先勾選同意「隱私權保護政策」才能繼續進行報名手續喔！',
        'msg.privacy-btn': '我知道了',
        
        'modal.delete-title': '確認刪除',
        'modal.delete-desc': '此動作無法復原，您確定要刪除這筆報名資料嗎？',
        'modal.btn-cancel': '取消',
        'modal.btn-confirm-delete': '確定刪除',

        'val.unit-conflict': '此單位已被其他帳號報名！',
        'val.unit-conflict-sub': '為避免混亂，同一單位必須由同一帳號統一報名。',
        'val.id-required': '身分證字號為必填欄位！',
        'val.id-format': '身分證格式錯誤！',
        'val.birth-incomplete': '格式不完整！請輸入 西元年/月/日',
        'val.birth-invalid': '無效的日期！',
        'val.age-error': '年齡不符！此項目年齡範圍',

        // --- 6. 重複報名警告彈窗 ---
        'dup.title': '⚠️ 發現重複報名',
        'dup.msg-part1': '選手',
        'dup.msg-part2': '已經在',
        'dup.msg-part3': '中有報名紀錄了。',
        'dup.hist-label': '📌 系統發現該選手已報名：',
        'dup.curr-label': '📌 您目前正試圖報名：',
        'dup.confirm': '請問您確定要繼續「重複提交」這筆報名資料嗎？',
        'dup.btn-ok': '強制重複提交',
        'dup.btn-cancel': '取消並修改',

        // --- 7. 報名管理中心 ---
        'records.empty': '您目前沒有任何報名紀錄',
        'records.registered-count': '目前已報名 {n} 筆資料',
        'records.manage-btn': '管理名單',
        'records.print-section-title': '列印各單位報名總表 (對帳單)',
        'records.unit-regs-count': '共 {n} 筆資料',
        'records.print-btn': '列印',

        // --- 8. 登入頁面 ---        
        'login.title': '登入系統',
        'login.subtitle': '請使用您的 Google 帳號登入<br>以進行報名作業或管理賽事。',
        'login.webview-warning': '<i class="fas fa-exclamation-triangle mr-1 text-red-500 text-lg mb-2 block text-center"></i>Google 安全政策不允許在 LINE 或 FB 內直接登入。<br><br>👉 請點擊畫面右上角（或右下角）的 <span class="bg-red-100 px-2 py-0.5 rounded text-red-900 border border-red-200">⋮</span> 或 <span class="bg-red-100 px-2 py-0.5 rounded text-red-900 border border-red-200">⋯</span><br>👉 選擇 <span class="text-tkdBlue font-black">「以預設瀏覽器開啟」</span><br>(Safari 或 Chrome) 即可正常登入！',
        'login.btn-google': '使用 Google 帳號登入',
        'login.btn-browse': '先去逛逛賽事列表',
        'login.modal-title': '需要登入帳號',
        'login.modal-desc': '為了保護您的報名資料，請先登入系統後再繼續操作。',
        'login.modal-btn-browse': '先逛逛',
        'login.modal-btn-login': '前往登入',
        'login.btn-external-browser': '切換至外部瀏覽器',
        'login.error': '登入失敗：',
        'login.redirecting': '畫面轉跳中...',
        'login.idle-timeout': '⚠️ 系統閒置過久，基於安全考量已自動為您登出。'
    },

    'en': {
        // --- 1. 導覽列與首頁 ---
        'nav.list': 'Tournaments',
        'nav.info': 'Rules',
        'nav.my-records': 'My Records',
        'nav.login': 'Login',
        'nav.logout': 'Logout',
        'nav.admin': 'Admin',
        'home.title': 'WEGO Tournament System',
        'home.subtitle': 'Challenge yourself. Please select a tournament below to register.',
        'home.search': 'Search tournaments...',
        'home.city': 'All Cities',
        'info.consent-prefix': 'I have read and agree to the ',
        'info.consent-link': 'Privacy Policy',
        'info.consent-agree': 'I have read and agree to the above terms',
        'info.btn-register': 'Go to Register',
        'info.attachments': 'Attachments',

        // --- 2. 賽事報名表 ---
        'reg.form-title': 'Registration Form',
        'reg.section1': '1. Unit & Staff Info',
        'reg.section2': '2. Player Registration Data',
        'reg.multi-unit-title': 'Multiple Unit Registration Reminder',
        'reg.multi-unit-content': 'One account can register for "multiple different units" without switching accounts. Simply change the "Organization" name below to submit data for a new unit.',
        'reg.selected-tour': 'Selected Tournament: ',
        'reg.user-records-title': 'Your Registration Records & Summary',
        'reg.records-count': '{n} Records',
        'reg.unit': 'Organization',
        'reg.phone': 'Phone Number',
        'reg.placeholder-phone': 'Mobile or Landline',
        'reg.auto-fill': 'Auto-fill',
        'reg.leader': 'Team Leader',
        'reg.manager': 'Manager',
        'reg.coach1': 'Coach 1',
        'reg.coach2': 'Coach 2 (Optional)',
        'reg.coach3': 'Coach 3 (Optional)',
        'reg.sub-team': 'Sub-team (Optional)',
        'reg.player-title': 'Player {n}',
        'reg.player-name': 'Player Name',
        'reg.player-birth': 'Date of Birth',
        'reg.player-id': 'ID / Passport',
        'reg.placeholder-name': 'Full Name',
        'reg.placeholder-birth': 'e.g., 1997/06/01',
        'reg.placeholder-id': 'e.g., A123456789',
        'reg.item': 'Event',
        'reg.group': 'Category',
        'reg.level': 'Weight/Level',
        'reg.save': 'Save and Submit',
        'reg.save-edit': 'Save Changes',
        'reg.admin-badge': 'Admin Privileges',
        'reg.loading-create-title': 'Submitting securely',
        'reg.loading-edit-title': 'Saving changes securely',
        'reg.loading-description': 'Your information is being saved and verified. Please do not submit again or close this page.',
        'reg.loading-checked': 'Information checked',
        'reg.loading-saving': 'Saving registration',
        'reg.loading-wait': 'This usually takes just a few seconds',
        'reg.loading-button': 'Submitting, please wait',

        // --- 3. 賽事狀態與時間 ---
        'reg.status-pending': 'Registration Pending',
        'reg.status-open': 'Registration Open',
        'reg.status-closed': 'Registration Closed',
        'reg.time-expect': 'Expect Open',
        'reg.time-deadline': 'Deadline',
        'reg.time-remaining': 'Remaining',
        'reg.day': 'Days',

        // --- 4. 表格與列印總表 ---
        'table.name': 'Player Name',
        'table.birthday': 'Date of Birth',
        'table.id': 'ID Number',
        'table.item': 'Event',
        'table.group': 'Category',
        'table.level': 'Weight / Level',
        'table.fee': 'Fee (NT$)',
        'table.action': 'Action',
        'table.action-edit': 'Edit',
        'table.action-delete': 'Delete',
        'table.total-label': 'Total Fee for this Unit:',
        'table.receipt-title': 'Registration Summary / Receipt',
        'table.unit': 'Organization',
        'table.leader': 'Leader',
        'table.manager': 'Manager',
        'table.coach': 'Coach',
        'table.phone': 'Phone',
        'table.phone-label': 'Phone:',
        'table.leader-manager-label': 'Leader/Manager:',
        'table.coach-list-label': 'Coach List:',
        'table.print-summary-btn': 'Print Summary',
        'table.print-date': 'Print Date',
        'table.total-players': 'Total Players',
        'table.total-amount': 'Total Amount Due:',
        'table.signature': 'Leader / Coach Signature',
        'summary.back': 'Back',
        'summary.print': 'Print this form (or save as PDF)',

        // --- 5. 系統訊息、驗證提示與視窗 ---
        'msg.save-success': '🎉 Registration Successful!',
        'msg.edit-success': '🎉 Modification Successful!',
        'msg.confirm-delete': 'Are you sure you want to delete this record?',
        'msg.privacy-alert': '⚠️ System Alert:<br>Please check the box to agree to the "Privacy Policy" before proceeding with the registration!',
        'msg.privacy-btn': 'I Understand',
        
        'modal.delete-title': 'Confirm Deletion',
        'modal.delete-desc': 'This action cannot be undone. Are you sure you want to delete this record?',
        'modal.btn-cancel': 'Cancel',
        'modal.btn-confirm-delete': 'Delete',

        'val.unit-conflict': 'This organization has already been registered by another account!',
        'val.unit-conflict-sub': 'To avoid confusion, an organization must be registered by the same account.',
        'val.id-required': 'ID number is required!',
        'val.id-format': 'Invalid ID format!',
        'val.birth-incomplete': 'Incomplete format! Please use YYYY/MM/DD',
        'val.birth-invalid': 'Invalid Date!',
        'val.age-error': 'Age restriction! Valid range',

        // --- 6. 重複報名警告彈窗 ---
        'dup.title': '⚠️ Duplicate Registration Found',
        'dup.msg-part1': 'Player',
        'dup.msg-part2': 'already has a record in',
        'dup.msg-part3': '.',
        'dup.hist-label': '📌 System found existing registration:',
        'dup.curr-label': '📌 You are currently trying to register:',
        'dup.confirm': 'Are you sure you want to "force submit" this duplicate entry?',
        'dup.btn-ok': 'Force Submit',
        'dup.btn-cancel': 'Cancel and Modify',

        // --- 7. 報名管理中心 ---
        'records.empty': 'You currently have no registration records.',
        'records.registered-count': 'Currently registered {n} records',
        'records.manage-btn': 'Manage List',
        'records.print-section-title': 'Print Unit Registration Summary (Receipt)',
        'records.unit-regs-count': 'Total {n} records',
        'records.print-btn': 'Print',

        // --- 8. 登入頁面 ---
        'login.title': 'System Login',
        'login.subtitle': 'Please sign in with your Google account<br>to register or manage tournaments.',
        'login.webview-warning': '<i class="fas fa-exclamation-triangle mr-1 text-red-500 text-lg mb-2 block text-center"></i>Google security policy does not allow direct login within LINE or Facebook.<br><br>👉 Please click the <span class="bg-red-100 px-2 py-0.5 rounded text-red-900 border border-red-200">⋮</span> or <span class="bg-red-100 px-2 py-0.5 rounded text-red-900 border border-red-200">⋯</span> at the top/bottom right of the screen.<br>👉 Choose <span class="text-tkdBlue font-black">"Open in Default Browser"</span><br>(Safari or Chrome) to log in normally!',
        'login.btn-google': 'Sign in with Google',
        'login.btn-browse': 'Browse Tournaments First',
        'login.modal-title': 'Login Required',
        'login.modal-desc': 'To protect your registration data, please log in to the system to continue.',
        'login.modal-btn-browse': 'Browse First',
        'login.modal-btn-login': 'Go to Login',
        'login.btn-external-browser': 'Switch to External Browser',
        'login.error': 'Login failed: ',
        'login.redirecting': 'Redirecting...',
        'login.idle-timeout': '⚠️ You have been logged out automatically due to inactivity for security reasons.'
    }
};

export const currentLang = () => localStorage.getItem('appLang') || 'zh-TW';

export const t = (key) => {
    const lang = currentLang();
    return translations[lang][key] || key;
};

export const getLang = (data, field = null) => {
    const lang = currentLang();
    
    if (field && data !== null && typeof data === 'object') {
        if (lang === 'en' && data[field + 'En']) return data[field + 'En'];
        return data[field] || '';
    }

    if (typeof data === 'string') {
        const parts = data.split(',');
        if (parts.length > 1) {
            return lang === 'en' ? parts[1].trim() : parts[0].trim();
        }
        return data;
    }

    return data;
};

window.switchLanguage = (lang) => {
    localStorage.setItem('appLang', lang);
    location.reload();
};
