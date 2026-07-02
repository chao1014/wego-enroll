// ==========================================
// 🌟 1. 輕量級狀態訂閱機制 (Pub-Sub Event Bus)
// ==========================================
const listeners = {};

// 訂閱事件
export const subscribe = (event, callback) => {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
    
    // 回傳解除訂閱的函式，方便元件銷毀時清理記憶體
    return () => {
        listeners[event] = listeners[event].filter(cb => cb !== callback);
    };
};

// 發布事件
export const emit = (event, data) => {
    if (listeners[event]) {
        listeners[event].forEach(callback => callback(data));
    }
};

// ==========================================
// 2. 應用程式核心資料 (來自 Firestore)
// ==========================================
export let appData = { 
    tournaments: [], 
    registrations: [], 
    teamProfiles: [],
    admins: [], 
    scopedAdmins: {}, 
    adminNames: {},
    blockedUsers: [], 
    cities: [], 
    deletedTournaments: [], 
    historicalUserUnits: {},
    activeAdmins: {}
};

// 更新 appData 的屬性，並觸發全域設定更新事件
export const setAppData = (newData) => {
    appData = { ...appData, ...newData };
    emit('appDataUpdated', appData);
};

// 專門更新報名資料，並觸發專屬更新事件
export const setRegistrationsData = (regs) => {
    appData.registrations = regs;
    emit('registrationsUpdated', regs);
};

// ==========================================
// 3. 當前使用者狀態 (Auth)
// ==========================================
export let currentUser = null;
export let currentUserRole = 'guest';

export const setCurrentUser = (user) => {
    currentUser = user;
    emit('userChanged', user);
};

export const setCurrentUserRole = (role) => {
    currentUserRole = role;
    emit('userRoleChanged', role);
};

// ==========================================
// 4. UI 互動與選擇狀態
// ==========================================
export let selectedTournament = null;
export let currentEditTourId = null;
export let recordToDelete = null;

export const setSelectedTournament = (tour) => {
    selectedTournament = tour;
    emit('tournamentSelected', tour);
};

export const setCurrentEditTourId = (id) => {
    currentEditTourId = id;
};

export const setRecordToDelete = (id) => {
    recordToDelete = id;
};

// ==========================================
// 5. 資料庫監聽器管理與 PDF 狀態
// ==========================================
export let registrationsUnsubscribe = null;
export const setRegistrationsUnsubscribe = (unsubFunc) => { registrationsUnsubscribe = unsubFunc; };

export let lastPageBeforePrint = 'home';
export let currentPdfFilename = '報名總表.pdf';
export const setPrintState = (page, filename) => {
    if (page) lastPageBeforePrint = page;
    if (filename) currentPdfFilename = filename;
};