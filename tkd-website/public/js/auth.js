import { signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, signInAnonymously, setPersistence, browserSessionPersistence } from "firebase/auth";
import { doc, setDoc, onSnapshot } from "firebase/firestore"; 
import { auth, googleProvider, isPreviewEnv, SUPER_ADMIN, db, appIdStr } from "./firebase.js"; 
import { appData, setAppData, currentUser, currentUserRole, setCurrentUser, setCurrentUserRole, selectedTournament, setSelectedTournament, registrationsUnsubscribe, setRegistrationsUnsubscribe, setRegistrationsData } from "./store.js";
import { t } from "./i18n.js";

// ✨ 優化版：從 sessionStorage 讀取或產生，避免重整時狂刷資料庫
let localSessionId = sessionStorage.getItem('wego_session_id');
if (!localSessionId) {
    localSessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem('wego_session_id', localSessionId);
}

// ==========================================
// 1. 權限判斷邏輯
// ==========================================
export async function evaluateRole(user, forceRefresh = false) {
    if (!user) return 'guest';
    
    if (user.email === SUPER_ADMIN) return 'super_admin';

    try {
        const idTokenResult = await user.getIdTokenResult(forceRefresh);
        const claims = idTokenResult.claims;

        if (claims.blocked) return 'blocked';
        if (claims.admin) return 'admin';
        if (claims.scopedAdmin) {
            setAppData({ myScope: claims.scopedAdmin }); 
            return 'scoped_admin';
        }
        
        return 'user';
    } catch (error) {
        console.error("無法解析使用者權限:", error);
        return 'user';
    }
}

export async function verifyAuthBeforeAction() {
    if (!auth.currentUser) {
        // 如果連 currentUser 都沒有，代表根本沒登入
        if (window.showToast) window.showToast(t('login.modal-desc') || '請先登入系統後再操作！', 'error');
        return false;
    }
    
    try {
        // 強制更新 Token，確保 Custom Claims (如 blocked 或 admin) 是最新狀態
        const role = await evaluateRole(auth.currentUser, true);
        
        if (role === 'blocked') {
            if (window.showToast) window.showToast('您的帳號已被停權，無法執行此操作！', 'error');
            setTimeout(() => { if (window.logout) window.logout(); }, 1500);
            return false;
        }
        
        // 如果權限有變更 (例如剛被拔除管理員)，同步更新全域狀態
        if (role !== currentUserRole) {
            setCurrentUserRole(role);
        }
        
        return true;
    } catch (err) {
        console.error("Token 更新失敗:", err);
        if (window.showToast) window.showToast('驗證憑證發生異常或已過期，請重新登入。', 'error');
        return false;
    }
}

// ==========================================
// 2. 登入與登出操作 (綁定到 window 供 HTML 呼叫)
// ==========================================
let pendingTargetPage = null;

export const setPendingTargetPage = (page) => {
    pendingTargetPage = page;
};

window.closeLoginModal = () => {
    const modal = document.getElementById('loginModal');
    if (!modal) return;
    modal.firstElementChild.classList.remove('scale-100'); 
    modal.firstElementChild.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
    pendingTargetPage = null;
};

window.proceedToLogin = () => {
    if (pendingTargetPage) {
        sessionStorage.setItem('redirectAfterLogin', pendingTargetPage);
        if (selectedTournament) sessionStorage.setItem('redirectTournamentId', selectedTournament.id);
    }
    window.closeLoginModal();
    if (window.navigate) window.navigate('login');
};

window.logout = async () => {
    const menu = document.getElementById('mobile-menu');
    const icon = document.getElementById('menu-icon');
    if (menu && menu.classList.contains('open')) {
        menu.classList.remove('open');
        if (icon) icon.classList.replace('fa-times', 'fa-bars');
    }

    setSelectedTournament(null);
    
    // ✨ 核心升級：呼叫全域清除所有監聽器，防止任何背景連線與記憶體洩漏
    if (window.clearAllListeners) {
        window.clearAllListeners();
    } else {
        if (registrationsUnsubscribe) {
            try { registrationsUnsubscribe(); } catch (e) {}
            setRegistrationsUnsubscribe(null);
        }
        if (typeof window.adminSettingsUnsubscribe === 'function') {
            try { window.adminSettingsUnsubscribe(); } catch (e) {}
            window.adminSettingsUnsubscribe = null;
        }
        if (window.sessionUnsubscribe) {
            try { window.sessionUnsubscribe(); } catch (e) {}
            window.sessionUnsubscribe = null;
        }
    }

    try {
        await signOut(auth);
    } catch (e) {
        console.error("登出時發生錯誤：", e);
    } finally {
        window.location.href = window.location.pathname + '?page=home';
    }
};

// ==========================================
// 3. 初始化登入介面與 Google 轉跳驗證
// ==========================================
export function initLoginUI() {
    googleProvider.setCustomParameters({
        prompt: 'select_account'
    });

    setPersistence(auth, browserSessionPersistence).then(() => {
        return getRedirectResult(auth);
    }).then((result) => {
        if (result) {
            console.log("轉跳驗證成功，憑證已存為 Session 級別");
        }
    }).catch((error) => {
        if (error.code !== 'auth/redirect-cancelled-by-user') {
            console.error("轉跳登入發生錯誤：", error);
            const errEl = document.getElementById('login-error');
            if (errEl) {
                errEl.innerHTML = t('login.error') + error.message;
                errEl.classList.remove('hidden');
            }
        }
    });

    // ==========================================
    // 新增：環境偵測與自動跳轉邏輯
    // ==========================================
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    const isWebView = /Line|MicroMessenger|Instagram|FBAN|FBAV/i.test(ua);
    const isAndroid = /android/i.test(ua);
    const isLine = /Line/i.test(ua);
    
    if (isWebView) {
        const currentUrl = window.location.href;
        
        // 策略 1：LINE 專屬參數自動跳轉
        if (isLine && !currentUrl.includes('openExternalBrowser=1')) {
            const separator = currentUrl.includes('?') ? '&' : '?';
            window.location.href = currentUrl + separator + 'openExternalBrowser=1';
            return; // 終止後續執行，等待網頁重新導向
        }

        // 策略 2：Android Intent 強制開啟 Chrome
        if (isAndroid) {
            // 移除 https:// 並轉換為 intent 格式
            const cleanUrl = currentUrl.replace(/^https?:\/\//, '');
            const intentUrl = `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;end`;
            window.location.href = intentUrl;
            // 注意：不加 return，因為若手機未安裝 Chrome，跳轉會失效，需繼續顯示下方備案 UI
        }

        // 備案策略：如果自動跳轉失敗（例如 iOS 上的 FB/IG App），顯示手動引導介面
        document.getElementById('webview-warning')?.classList.remove('hidden');
        const loginBtn = document.getElementById('btn-google-login');
        if (loginBtn) {
            loginBtn.classList.remove('hover:bg-gray-50', 'text-gray-700', 'bg-white', 'border-gray-100');
            loginBtn.classList.add('bg-tkdBlue', 'text-white', 'border-tkdBlue', 'hover:bg-blue-700', 'shadow-md');
            document.getElementById('btn-google-text').innerHTML = t('login.btn-external-browser') || '請使用系統瀏覽器開啟';
            
            const icon = loginBtn.querySelector('.google-icon');
            if (icon) {
                const faIcon = document.createElement('i');
                faIcon.className = 'fas fa-external-link-alt mr-3 text-lg';
                icon.parentNode.replaceChild(faIcon, icon);
            }

            // 將按鈕的點擊事件改為手動觸發 Android Intent 或顯示提示
            loginBtn.onclick = () => {
                if (isAndroid) {
                    const cleanUrl = currentUrl.replace(/^https?:\/\//, '');
                    window.location.href = `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;end`;
                } else {
                    alert('請點擊畫面右上角或右下角的選單 (⋮ 或 ⋯)，選擇「以預設瀏覽器開啟」以繼續登入。');
                }
            };
        }
    }

    // ==========================================
    // 正常環境的登入事件綁定
    // ==========================================
    const btnGoogleLogin = document.getElementById('btn-google-login');
    // 確保只有在非 WebView 環境，才綁定 Firebase Auth 登入事件
    if (btnGoogleLogin && !isWebView) {
        btnGoogleLogin.addEventListener('click', async () => {
            
            btnGoogleLogin.disabled = true;
            btnGoogleLogin.innerHTML = '<i class="fas fa-spinner fa-spin mr-3"></i> ' + (t('login.redirecting') || '轉跳中...');
            document.getElementById('login-error')?.classList.add('hidden');

            try {
                await setPersistence(auth, browserSessionPersistence);
                await signInWithRedirect(auth, googleProvider);
            } catch (error) {
                console.error("登入轉跳失敗：", error);
                
                const errEl = document.getElementById('login-error');
                if (errEl) {
                    errEl.innerHTML = (t('login.error') || '登入失敗：') + error.message;
                    errEl.classList.remove('hidden');
                }

                btnGoogleLogin.disabled = false;
                btnGoogleLogin.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" class="w-6 h-6 mr-3 google-icon"><span id="btn-google-text">' + (t('login.btn-google') || '使用 Google 帳號登入') + '</span>';
            }
        });
    }
}

// ==========================================
// 4. 監聽登入狀態變化 (Observer)
// ==========================================
let isInitialLoad = true;

/**
 * 啟動 Auth 狀態監聽器
 * @param {Function} setupRegistrationsListener - 從外部傳入的資料載入函數
 */
export function initAuthStateObserver(setupRegistrationsListener) {
    onAuthStateChanged(auth, async (user) => {
        setCurrentUser(user);

        const navReg = document.getElementById('nav-register');
        const navRegMob = document.getElementById('nav-register-mobile');
        const navAdmin = document.getElementById('nav-admin');
        const navAdminMob = document.getElementById('nav-admin-mobile');
        const navLogin = document.getElementById('nav-login');
        const navLoginMob = document.getElementById('nav-login-mobile');
        const navLogout = document.getElementById('nav-logout');
        const navLogoutMob = document.getElementById('nav-logout-mobile');
        const greet = document.getElementById('user-greeting');
        const greetMob = document.getElementById('user-greeting-mobile');

        if (user) {
            // ✨ 單一設備登入防護：寫入並監聽 Session ID
            const sessionRef = doc(db, 'artifacts', appIdStr, 'public', 'data', 'user_sessions', user.uid);
            
            try {
                console.log(`[防護機制] 嘗試寫入本機 Session ID: ${localSessionId}`);
                await setDoc(sessionRef, { sessionId: localSessionId, updatedAt: Date.now() }, { merge: true });
            } catch (e) {
                console.error("[防護機制] Session 寫入失敗，請確認 Firestore 規則是否已部署！詳細錯誤:", e);
            }

            if (window.sessionUnsubscribe) window.sessionUnsubscribe();
            window.sessionUnsubscribe = onSnapshot(sessionRef, (snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    console.log(`[防護機制] 雲端 Session 狀態更新 -> 雲端: ${data.sessionId} | 本機: ${localSessionId}`);
                    
                    if (data.sessionId && data.sessionId !== localSessionId) {
                        // ✨ 發現不一致，改為呼叫專屬彈窗
                        setTimeout(() => {
                            const conflictModal = document.getElementById('sessionConflictModal');
                            if (conflictModal) {
                                conflictModal.classList.remove('hidden');
                                conflictModal.classList.add('flex');
                                setTimeout(() => {
                                    if (conflictModal.firstElementChild) {
                                        conflictModal.firstElementChild.classList.replace('scale-95', 'scale-100');
                                    }
                                }, 10);
                            } else {
                                // 避免 HTML 沒貼上時的防呆備案
                                alert('⚠️ 您的帳號已在其他設備或視窗登入，基於安全考量，目前設備將被強制登出。');
                                if (window.logout) window.logout();
                            }
                        }, 500);
                    }
                }
            }, (error) => {
                console.error("[防護機制] Session 監聽失敗，請確認 Firestore 規則是否已部署！詳細錯誤:", error);
            });

            const newRole = await evaluateRole(user);
            setCurrentUserRole(newRole);
            
            const isGlobalAdmin = (newRole === 'admin' || newRole === 'super_admin');
            const isScopedAdmin = (newRole === 'scoped_admin');
            const hasAdminAccess = isGlobalAdmin || isScopedAdmin;
            
            if(navAdmin) navAdmin.classList.toggle('hidden', !hasAdminAccess);
            if(navAdminMob) navAdminMob.classList.toggle('hidden', !hasAdminAccess);
            
            document.getElementById('tab-btn-users')?.classList.toggle('hidden', !isGlobalAdmin);
            document.getElementById('tab-btn-settings')?.classList.toggle('hidden', !isGlobalAdmin);
            const permsTab = document.getElementById('tab-btn-perms');
            if (permsTab) permsTab.classList.toggle('hidden', newRole !== 'super_admin');

            const backupArea = document.getElementById('super-admin-backup-area');
            if (backupArea) {
                if (user.email === SUPER_ADMIN) {
                    backupArea.classList.remove('hidden');
                    backupArea.classList.add('flex');
                } else {
                    backupArea.classList.add('hidden');
                    backupArea.classList.remove('flex');
                }
            }

            if (window.updateRegisterNavVisibility) window.updateRegisterNavVisibility();
            if (navRegMob) navRegMob.classList.remove('hidden');
            if (navLogin) navLogin.classList.add('hidden');
            if (navLoginMob) navLoginMob.classList.add('hidden');
            if (navLogout) navLogout.classList.remove('hidden');
            if (navLogoutMob) navLogoutMob.classList.remove('hidden');

            const welcomeText = `Hi, ${user.email ? user.email.split('@')[0] : '測試者'}`;
            if (greet) greet.innerText = welcomeText;
            if (greetMob) greetMob.innerText = `登入帳號：${user.email}`;

            const redirectPage = sessionStorage.getItem('redirectAfterLogin');
            if (redirectPage) {
                sessionStorage.removeItem('redirectAfterLogin');
                if (window.navigate) window.navigate(redirectPage, false);
            } else if (isInitialLoad && new URLSearchParams(window.location.search).get('page') === 'login') {
                if (window.navigate) window.navigate('home', false);
            }

            // 呼叫外部傳入的監聽函數，載入使用者的報名資料
            if (setupRegistrationsListener) setupRegistrationsListener(user);

        } else {
            setCurrentUserRole('guest');

            if (navAdmin) navAdmin.classList.add('hidden');
            if (navAdminMob) navAdminMob.classList.add('hidden');
            
            if (window.updateRegisterNavVisibility) window.updateRegisterNavVisibility();
            if (navRegMob) navRegMob.classList.add('hidden');
            if (navLogin) navLogin.classList.remove('hidden');
            if (navLoginMob) navLoginMob.classList.remove('hidden');
            if (navLogout) navLogout.classList.add('hidden');
            if (navLogoutMob) navLogoutMob.classList.add('hidden');

            if (greet) greet.innerText = `訪客模式`;
            if (greetMob) greetMob.innerText = `尚未登入系統`;

            if (registrationsUnsubscribe) { 
                registrationsUnsubscribe(); 
                setRegistrationsUnsubscribe(null); 
            }
            
            setRegistrationsData([]); 
            if (window.renderUserTables) window.renderUserTables(); 

            if (!isInitialLoad) {
                const activePage = document.querySelector('.page-section.active');
                if (activePage && (activePage.id === 'page-register' || activePage.id === 'page-admin')) {
                    if (window.navigate) window.navigate('home');
                }
            }
        }

        if (isInitialLoad) {
            window.isAuthReady = true;
            if (window.checkAndHideLoader) window.checkAndHideLoader();

            if (!user && !sessionStorage.getItem('redirectAfterLogin')) {
                const urlParams = new URLSearchParams(window.location.search);
                let targetPage = urlParams.get('page') || 'home';
                if (targetPage === 'register' || targetPage === 'admin') targetPage = 'home';
                if (window.navigate) window.navigate(targetPage, false);
            }
            isInitialLoad = false;
        }
    });
}

// ==========================================
// 5. 閒置自動登出機制 (抗背景休眠版)
// ==========================================
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 分鐘
let lastActivityTime = Date.now();

// 記錄最後一次操作的真實時間戳
const updateActivityTime = () => {
    // ✨ 核心修復：防止背景休眠喚醒時的「滑鼠移動」瞬間重置時間
    // 在重置時間之前，先檢查是否「已經」閒置超過 15 分鐘了！
    if (currentUser && (Date.now() - lastActivityTime > IDLE_TIMEOUT_MS)) {
        lastActivityTime = Date.now(); // 防止重複觸發
        alert(t('login.idle-timeout') || '⚠️ 系統閒置過久，基於安全考量已自動為您登出。');
        if (window.logout) window.logout();
        return;
    }
    lastActivityTime = Date.now();
};

// 擴大監聽範圍，確保任何互動都能重置時間
window.addEventListener('mousemove', updateActivityTime);
window.addEventListener('keydown', updateActivityTime);
window.addEventListener('touchstart', updateActivityTime);
window.addEventListener('scroll', updateActivityTime);
window.addEventListener('click', updateActivityTime);

// 每 30 秒巡邏一次 (捕捉停留在原畫面完全不動的情況)
setInterval(async () => {
    // 只有在「有登入」且「閒置時間大於 15 分鐘」時才執行
    if (currentUser && (Date.now() - lastActivityTime > IDLE_TIMEOUT_MS)) {
        
        // 先把時間重置，避免這 30 秒內不小心觸發第二次
        lastActivityTime = Date.now(); 
        
        // 必須「先」跳出提示讓使用者點擊，再執行登出重整
        alert(t('login.idle-timeout') || '⚠️ 系統閒置過久，基於安全考量已自動為您登出。');
        
        if (window.logout) {
            await window.logout();
        }
    }
}, 30000);