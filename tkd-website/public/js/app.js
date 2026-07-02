import flatpickr from 'flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import { MandarinTraditional } from "flatpickr/dist/l10n/zh-tw.js";
import Sortable from 'sortablejs';

// 保留表單與 UI 必須的基礎套件
window.flatpickr = flatpickr;
flatpickr.localize(MandarinTraditional);
window.Sortable = Sortable;

import { onSnapshot, query, where } from "firebase/firestore";
import { getSettingsDoc, getDbPath, analytics } from "./firebase.js"; 
import { 
    appData, setAppData, 
    currentUser, currentUserRole, setCurrentUserRole, 
    selectedTournament, setSelectedTournament, currentEditTourId, 
    setRegistrationsData, registrationsUnsubscribe, setRegistrationsUnsubscribe,
    emit // ✨ 引入事件發布器
} from "./store.js";
import { evaluateRole, initLoginUI, initAuthStateObserver } from "./auth.js";

import "./ui.js";
import { initFrontend } from "./frontend.js";
import { initAdmin } from "./admin.js";
import "./admin-settings.js";
import "./admin-users.js";
import "./admin-data.js";
import { currentLang, translations } from "./i18n.js";
import { logEvent } from "firebase/analytics";

// ==========================================
// 🌟 全域載入狀態同步控制 (Loader Coordination)
// ==========================================
window.isDataReady = false;
window.isAuthReady = false;

window.checkAndHideLoader = () => {
    if (window.isAuthReady && window.isDataReady) {
        const loader = document.getElementById('global-loader');
        if (loader && !loader.classList.contains('hidden-loader')) {
            loader.classList.add('hidden-loader');
            loader.style.opacity = '0';
            setTimeout(() => loader.classList.add('hidden'), 500);
        }
    }
};

// ==========================================
// 0. 全域翻譯執行函式
// ==========================================
const applyI18n = () => {
    const lang = currentLang();
    const dict = translations[lang];
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict && dict[key]) {
            if (el.tagName === 'INPUT') {
                el.placeholder = dict[key];
            } else {
                el.innerHTML = dict[key]; 
            }
        }
    });

    const phoneInput = document.getElementById('phone');
    if (phoneInput) {
        const isRequired = (lang === 'zh-TW');
        phoneInput.required = isRequired;
        const phoneLabel = phoneInput.previousElementSibling;
        const asterisk = phoneLabel?.querySelector('.text-red-500');
        if (asterisk) {
            asterisk.style.display = isRequired ? 'inline' : 'none';
        }
    }

    const btnZh = document.getElementById('lang-zh');
    const btnEn = document.getElementById('lang-en');
    if (btnZh && btnEn) {
        btnZh.classList.toggle('text-tkdRed', lang === 'zh-TW');
        btnEn.classList.toggle('text-tkdRed', lang === 'en');
    }
};

// ==========================================
// 1. 報名資料即時監聽 (Registrations Listener)
// ==========================================
window.myOwnRegs = [];

const setupRegistrationsListener = (user) => {
    if (registrationsUnsubscribe) {
        registrationsUnsubscribe();
    }
    if (window.teamProfilesUnsub) {
        window.teamProfilesUnsub();
    }

    const regQuery = query(getDbPath('registrations'), where("userId", "==", user.uid));

    const unsub = onSnapshot(regQuery, (snap) => {
        window.myOwnRegs = [];
        snap.forEach(d => window.myOwnRegs.push({ id: d.id, ...d.data() }));

        const adminRegs = window.adminCurrentTourRegs || [];
        const combined = [...window.myOwnRegs, ...adminRegs];
        
        const uniqueMap = new Map();
        combined.forEach(r => uniqueMap.set(r.id, r));
        
        // ✨ 自動發送 'registrationsUpdated' 事件
        setRegistrationsData(Array.from(uniqueMap.values()));

    }, (error) => { 
        console.error("報名資料監聽錯誤:", error); 
    });

    setRegistrationsUnsubscribe(unsub);

    // 常用名單監聽
    const profileQuery = query(getDbPath('team_profiles'), where("userId", "==", user.uid));
    window.teamProfilesUnsub = onSnapshot(profileQuery, (snap) => {
        const profiles = [];
        snap.forEach(d => profiles.push({ id: d.id, ...d.data() }));
        profiles.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        
        // 更新資料
        setAppData({ teamProfiles: profiles });
        // 發送獨立事件供前端更新 UI
        emit('teamProfilesUpdated', profiles);
    }, (error) => {
        console.error("常用名單監聽錯誤:", error);
    });
};

// ==========================================
// 2. 系統架構即時監聽 (Global Settings Listener)
// ==========================================
window.adminSettingsUnsubscribe = null;

onSnapshot(getSettingsDoc(), async (snap) => {
    if (snap.exists()) {
        const d = snap.data();        
        
        const oldTourStr = JSON.stringify(appData.tournaments || []);
        const oldDelStr = JSON.stringify(appData.deletedTournaments || []);
        const oldCityStr = JSON.stringify(appData.cities || []);
        
        const newTourStr = JSON.stringify(d.tournaments || []);
        const newDelStr = JSON.stringify(d.deletedTournaments || []);
        const newCityStr = JSON.stringify(d.cities || []);

        const isSettingsChanged = (oldTourStr !== newTourStr) || (oldDelStr !== newDelStr) || (oldCityStr !== newCityStr);

        setAppData({
            tournaments: d.tournaments || [],
            cities: d.cities || [],
            deletedTournaments: d.deletedTournaments || [],
            historicalUserUnits: d.historicalUserUnits || {}
        });

        if (window.renderSponsorCarousel) {
            window.renderSponsorCarousel(d.sponsorImages || []);
        }

        const urlParams = new URLSearchParams(window.location.search);
        const tourNameParam = urlParams.get('tour'); 
        const pageParam = urlParams.get('page');

        // 如果網址有帶賽事名稱，且目前還沒選定，就自動選取並解鎖畫面
        if (tourNameParam && !selectedTournament) {
            const tourFromUrl = (d.tournaments || []).find(t => t.name === tourNameParam);
            if (tourFromUrl) {
                setSelectedTournament(tourFromUrl);
                
                if (pageParam === 'info') {
                    document.getElementById('info-not-selected')?.classList.add('hidden');
                    document.getElementById('info-content')?.classList.remove('hidden');
                    if (window.renderInfoPage) window.renderInfoPage();
                } else if (pageParam === 'register') {
                    document.getElementById('reg-not-selected')?.classList.add('hidden');
                    document.getElementById('reg-form-container')?.classList.remove('hidden');
                    // ✨ 修正：這裡補上之前漏掉的渲染表單函式
                    if (window.renderFormOptions) window.renderFormOptions();
                    if (window.checkTournamentStatus) window.checkTournamentStatus();
                    if (window.renderUserTables) window.renderUserTables();
                }
            }
        }

        if (currentUser) {
            window.setupAdminDataListener();
        }

        const citiesInput = document.getElementById('global-cities-input');
        if (citiesInput && document.activeElement !== citiesInput) {
            citiesInput.value = (appData.cities || []).join(',');
        }

        const homeCityFilter = document.getElementById('home-city-filter');
        if (homeCityFilter) {
            const currentVal = homeCityFilter.value;
            homeCityFilter.innerHTML = '<option value="">全部</option>';
            (appData.cities || []).forEach(c => homeCityFilter.add(new Option(c, c)));
            if (currentVal) homeCityFilter.value = currentVal;
        }

        if (currentUser) {
            const newRole = await evaluateRole(currentUser);

            if (newRole === 'blocked') {
                alert("⚠️ 您的帳號已被管理員停權封鎖，系統將自動登出。");
                if (window.logout) window.logout();
                return;
            }

            if (newRole !== currentUserRole) {
                setCurrentUserRole(newRole);
                const hasAdminAccess = ['admin', 'super_admin', 'scoped_admin'].includes(newRole);
                
                document.getElementById('nav-admin')?.classList.toggle('hidden', !hasAdminAccess);
                document.getElementById('nav-admin-mobile')?.classList.toggle('hidden', !hasAdminAccess);
                
                setupRegistrationsListener(currentUser);
            }
            if (currentUserRole === 'super_admin' && window.renderAdminPerms) window.renderAdminPerms();
        }

        const savedTourId = sessionStorage.getItem('redirectTournamentId');

        if (savedTourId) {
            // 情況 1：剛從 Google 登入轉跳回來，必須恢復剛剛選定的賽事
            const freshTourData = appData.tournaments.find(t => t.id === savedTourId);
            if (freshTourData) {
                setSelectedTournament(freshTourData);
                sessionStorage.removeItem('redirectTournamentId');
                
                // ✨ 修正：確保資料還原後，強制將報名頁面的 UI 解鎖並渲染
                const activePage = document.querySelector('.page-section.active');
                if (activePage && activePage.id === 'page-register') {
                    document.getElementById('reg-not-selected')?.classList.add('hidden');
                    document.getElementById('reg-form-container')?.classList.remove('hidden');
                    if (window.renderFormOptions) window.renderFormOptions();
                    if (window.checkTournamentStatus) window.checkTournamentStatus();
                    if (window.renderUserTables) window.renderUserTables();
                }
            }
        } else if (selectedTournament && isSettingsChanged) {
            // 情況 2：背景收到更新，且賽事的整體設定真的有發生變動 
            const freshTourData = appData.tournaments.find(t => t.id === selectedTournament.id);
            const oldStr = JSON.stringify(selectedTournament);
            const newStr = JSON.stringify(freshTourData);

            if (freshTourData && oldStr !== newStr) {
                let shouldUpdateTour = true; 

                if (document.getElementById('page-register')?.classList.contains('active')) {
                    const hasPlayerInput = Array.from(document.querySelectorAll('.dynamic-player-name, .dynamic-birthday, .dynamic-id'))
                        .some(input => input.value.trim() !== '');
                    
                    if (hasPlayerInput) {
                        shouldUpdateTour = false;
                        console.log("🚀 偵測到選手資料輸入中，已攔截背景重置以保護進度。");
                    }
                }

                if (shouldUpdateTour) {
                    setSelectedTournament(freshTourData);
                }
            }
        }

        // 後台 UI 手動更新
        if (window.updateAdminTourDropdown) window.updateAdminTourDropdown();
        if (!currentEditTourId && isSettingsChanged) {
            
            // 🔍 新增安全保護：檢查管理員是否正處於編輯狀態或建立了未儲存的全新賽事
            let shouldRefreshSettings = true;
            
            if (document.getElementById('page-admin')?.classList.contains('active')) {
                // 1. 檢查是否有尚未儲存到資料庫的全新賽事列
                const hasUnsavedRow = Array.from(document.querySelectorAll('.tournament-row')).some(row => {
                    const id = row.dataset.id;
                    return !appData.tournaments.some(t => t.id === id);
                });
                
                // 2. 檢查目前游標是否正聚焦在後台的任何輸入框中
                const isTyping = document.activeElement && 
                    (document.activeElement.classList.contains('tour-name') || 
                     document.activeElement.classList.contains('tour-name-en') ||
                     document.activeElement.classList.contains('tour-event-date') ||
                     document.activeElement.classList.contains('tour-location') ||
                     document.activeElement.classList.contains('tour-remittance'));

                if (hasUnsavedRow || isTyping) {
                    shouldRefreshSettings = false;
                    console.log("🚀 偵測到管理員正在設定或新增賽事中，已自動攔截背景重製以保護輸入進度。");
                }
            }

            if (shouldRefreshSettings) {
                if (window.populateAdminSettings) window.populateAdminSettings();
                if (window.renderRecycleBin) window.renderRecycleBin();
            }
        }
        
        if (window.updateRegisterNavVisibility) window.updateRegisterNavVisibility();
        applyI18n();
    }

    window.isDataReady = true;
    if (window.checkAndHideLoader) window.checkAndHideLoader();
});

window.setupAdminDataListener = async () => {
    const isAdmin = ['admin', 'super_admin', 'scoped_admin'].includes(currentUserRole);
    const adminPage = document.getElementById('page-admin');
    const isAtAdminPage = adminPage && adminPage.classList.contains('active');

    if (window.adminSettingsUnsubscribe || !isAdmin || !isAtAdminPage) return;

    console.log("🚀 啟動管理員專屬數據監聽...");
    window.adminSettingsUnsubscribe = onSnapshot(getSettingsDoc(), (snap) => {
        const d = snap.data();
        setAppData({
            admins: d.admins || [],
            scopedAdmins: d.scopedAdmins || {},
            adminNames: d.adminNames || {},
            blockedUsers: d.blockedUsers || [],
            activeAdmins: d.activeAdmins || {}
        });

        if (document.getElementById('page-admin')?.classList.contains('active')) {
            if (window.renderAdminRegistrations) window.renderAdminRegistrations();
            if (window.renderAdminUsersList) window.renderAdminUsersList(); 
            if (window.renderAdminPresence) window.renderAdminPresence();
            if (currentUserRole === 'super_admin' && window.renderAdminPerms) window.renderAdminPerms();
        }
    });
};

// ==========================================
// 3. 系統啟動初始化
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    applyI18n();
    initLoginUI();
    initAuthStateObserver(setupRegistrationsListener);
    initFrontend();
    initAdmin();
    
    if (analytics) {
        logEvent(analytics, 'app_initialized', { app_name: 'wego-enroll' });
    }
});