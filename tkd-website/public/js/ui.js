import { currentUser, currentUserRole, selectedTournament } from "./store.js";
import { setPendingTargetPage } from "./auth.js";
import { t, getLang } from "./i18n.js";

// ==========================================
// 1. 導覽列與選單控制
// ==========================================

export const updateRegisterNavVisibility = () => {
    // 登入後即顯示「我的報名」
    const isLoggedIn = !!currentUser;
    
    // 隱藏舊的「進入報名」
    document.getElementById('nav-register')?.classList.add('hidden');
    document.getElementById('nav-register-mobile')?.classList.add('hidden');
    
    // 顯示新按鈕
    document.getElementById('nav-my-records')?.classList.toggle('hidden', !isLoggedIn);
    document.getElementById('nav-my-records-mobile')?.classList.toggle('hidden', !isLoggedIn);
};
// 綁定到 window 讓 HTML 也能直接呼叫
window.updateRegisterNavVisibility = updateRegisterNavVisibility;

// 手機版漢堡選單開關
window.toggleMobileMenu = () => {
    const menu = document.getElementById('mobile-menu');
    const icon = document.getElementById('menu-icon');
    if (!menu || !icon) return;
    
    if (menu.classList.contains('open')) {
        menu.classList.remove('open');
        icon.classList.replace('fa-times', 'fa-bars');
    } else {
        menu.classList.add('open');
        icon.classList.replace('fa-bars', 'fa-times');
    }
};

// ==========================================
// 🌟 滑動視窗時自動關閉手機版漢堡選單
// ==========================================
window.addEventListener('scroll', () => {
    const menu = document.getElementById('mobile-menu');
    const icon = document.getElementById('menu-icon');
    
    if (menu && icon && menu.classList.contains('open')) {
        menu.classList.remove('open');
        icon.classList.replace('fa-times', 'fa-bars');
    }
}, { 
    passive: true, 
    capture: true
});

// ==========================================
// 🌟 點擊或觸碰外部，自動關閉手機版漢堡選單
// ==========================================
['click', 'touchstart'].forEach(eventType => {
    document.addEventListener(eventType, (event) => {
        const menu = document.getElementById('mobile-menu');
        const icon = document.getElementById('menu-icon');
        
        if (menu && icon && menu.classList.contains('open')) {
            const toggleBtn = icon.closest('button');
            
            // 如果點擊目標不在選單內，也不在漢堡按鈕上，就關閉選單
            if (!menu.contains(event.target) && (!toggleBtn || !toggleBtn.contains(event.target))) {
                menu.classList.remove('open');
                icon.classList.replace('fa-times', 'fa-bars');
            }
        }
    }, { passive: true });
});

// 清除首頁搜尋條件並返回賽事列表
window.clearHomeFilterAndNavigate = () => {
    const currentUrl = new URL(window.location.href);

    const cityEl = document.getElementById('home-city-filter');
    const searchEl = document.getElementById('home-search');
    const statusEl = document.getElementById('home-status-filter'); // ✨ 新增狀態
    
    if (cityEl) cityEl.value = currentUrl.searchParams.get('city') || '';
    if (searchEl) searchEl.value = currentUrl.searchParams.get('search') || '';
    if (statusEl) statusEl.value = currentUrl.searchParams.get('status') || '';

    window.navigate('home', true);

    if (window.renderHomePage) window.renderHomePage();
};

// ==========================================
// 2. 核心路由與分頁切換 (Router)
// ==========================================

window.navigate = (p, isPushState = true, scrollToTop = true) => {
    // 1. 處理選單 UI 狀態 (Mobile Menu)
    const menu = document.getElementById('mobile-menu');
    const icon = document.getElementById('menu-icon');
    if (menu && menu.classList.contains('open')) {
        menu.classList.remove('open');
        icon?.classList.replace('fa-times', 'fa-bars');
    }

    // 2. 監聽器效能優化：離開管理後台時，釋放數據監聽
    if (p !== 'admin' && typeof window.adminSettingsUnsubscribe === 'function') {
        window.adminSettingsUnsubscribe();
        window.adminSettingsUnsubscribe = null;
        console.log("已釋放管理員數據監聽，節省系統資源。");
    }

    // 3. 路由守衛 (權限與登入檢查)
    
    // A. 管理後台權限檢查
    if (p === 'admin') {
        const isAdmin = ['admin', 'super_admin', 'scoped_admin'].includes(currentUserRole);
        if (!isAdmin) {
            console.warn("權限不足，拒絕進入管理後台");
            p = 'home'; 
        }
    }

    // B. 登入狀態攔截 (報名頁與個人紀錄頁必須登入)
    const authRequiredPages = ['register', 'my-records'];
    if (authRequiredPages.includes(p) && !currentUser) {
        console.warn(`未登入，攔截進入 ${p} 頁面`);
        
        // 紀錄使用者原本想去的頁面，登入後自動導回
        if (typeof setPendingTargetPage === 'function') {
            setPendingTargetPage(p);
        }
        
        // 顯示登入提示彈窗
        const modal = document.getElementById('loginModal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            setTimeout(() => {
                modal.firstElementChild.classList.replace('scale-95', 'scale-100');
            }, 10);
        }
        return; // 終止導航，停留在當前頁面
    }
    
    // C. 檢查報名頁面是否已選定賽事
    if (p === 'register' && !selectedTournament) {
        // ✨ 新增防呆：如果 session 或 URL 中有待恢復的賽事，代表資料還在非同步載入，此時先放行，不要踢回首頁
        const hasPendingTour = sessionStorage.getItem('redirectTournamentId') || new URLSearchParams(window.location.search).get('tour');
        if (!hasPendingTour) {
            p = 'home';
        }
    }

// 4. 執行頁面切換視覺效果
    document.querySelectorAll('.page-section').forEach(section => {
        section.classList.add('hidden');
        section.classList.remove('active', 'fade-in');
    });

    // ✨ 根據進入的頁面，平滑切換全局背景色
    if (p === 'home') {
        document.body.classList.add('bg-tkdDark');
        document.body.classList.remove('bg-gray-50');
    } else {
        document.body.classList.remove('bg-tkdDark');
        document.body.classList.add('bg-gray-50');
    }

    const targetPage = document.getElementById(`page-${p}`);
    if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.classList.add('active', 'fade-in');
        
        const adSection = document.getElementById('footer-sponsor-section');
        if (adSection) {
            adSection.classList.toggle('hidden', p === 'login');
        }

        if (p === 'home' && window.renderHomePage) window.renderHomePage();
        
        if (p === 'info') {
            const hasTour = !!selectedTournament;
            const notSelectedEl = document.getElementById('info-not-selected');
            const contentEl = document.getElementById('info-content');
    
            if (notSelectedEl && contentEl) {
                if (hasTour) {
                    notSelectedEl.classList.add('hidden');
                    contentEl.classList.remove('hidden');
                    if (window.renderInfoPage) window.renderInfoPage();
                } else {
                    notSelectedEl.classList.remove('hidden');
                    contentEl.classList.add('hidden');
                }
            }
        }

        if (p === 'register') {
            const hasTour = !!selectedTournament;
            document.getElementById('reg-not-selected')?.classList.toggle('hidden', hasTour);
            document.getElementById('reg-form-container')?.classList.toggle('hidden', !hasTour);
            if (hasTour) {
                if (window.renderFormOptions) window.renderFormOptions();
                if (window.checkTournamentStatus) window.checkTournamentStatus();
                if (window.renderUserTables) window.renderUserTables();
            }
        }

        if (p === 'my-records' && window.renderMyRecordsPage) window.renderMyRecordsPage();
        
        if (p === 'admin' && window.setupAdminDataListener) {
            window.setupAdminDataListener();
        }
    }

    // 6. 更新 URL 狀態
    if (isPushState) {
        const newUrl = new URL(window.location.protocol + "//" + window.location.host + window.location.pathname);
        newUrl.searchParams.set('page', p);
        
        if ((p === 'info' || p === 'register') && selectedTournament) {
            newUrl.searchParams.set('tour', selectedTournament.name);
        }
        
        window.history.pushState({ path: newUrl.toString() }, '', newUrl.toString());
    }

    // 7. 置頂捲動
    if (scrollToTop) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    // 8. 同步更新導覽列按鈕的高亮狀態
    document.querySelectorAll('.nav-link').forEach(link => {
        const page = link.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
        if (page === p) {
            link.classList.add('text-tkdRed', 'font-black');
        } else {
            link.classList.remove('text-tkdRed', 'font-black');
        }
    });
};

// 監聽瀏覽器上一頁/下一頁按鈕事件
window.addEventListener('popstate', (event) => {
    const urlParams = new URLSearchParams(window.location.search);
    let page = urlParams.get('page') || 'home';
    const tourName = urlParams.get('tour');

    if (tourName) {
        const t = appData.tournaments.find(x => x.name === tourName);
        if (t) setSelectedTournament(t);
    }

    if (page === 'login' && currentUser) {
        page = 'home';
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('page', 'home');
        window.history.replaceState({ page: 'home' }, '', currentUrl.toString());
    }

    if (page === 'home') {
        const cityEl = document.getElementById('home-city-filter');
        const searchEl = document.getElementById('home-search');
        if (cityEl) cityEl.value = urlParams.get('city') || '';
        if (searchEl) searchEl.value = urlParams.get('search') || '';
        if (window.renderHomePage) window.renderHomePage();
    }

    window.navigate(page, false, false); 
});

// ==========================================
// 3. 通用 UI 小工具
// ==========================================

// 複製專屬連結功能 (支援傳入當前點擊的按鈕元件)
window.copyShareLink = async (btn) => {
    const currentUrl = new URL(window.location.href);
    
    // ✨ 動態抓取目前的篩選條件
    const cityFilter = document.getElementById('home-city-filter')?.value;
    const searchInput = document.getElementById('home-search')?.value;
    const statusFilter = document.getElementById('home-status-filter')?.value; 

    // ✨ 將條件轉化為網址參數
    if (cityFilter) currentUrl.searchParams.set('city', cityFilter);
    else currentUrl.searchParams.delete('city');

    if (searchInput) currentUrl.searchParams.set('search', searchInput);
    else currentUrl.searchParams.delete('search');

    if (statusFilter) currentUrl.searchParams.set('status', statusFilter);
    else currentUrl.searchParams.delete('status');

    // 取得帶有參數的完整專屬網址
    const beautifulUrl = decodeURI(currentUrl.toString());
    
    // 如果沒有傳入 btn，則試圖抓取舊的 ID (防呆)，若都沒抓到則中斷
    if (!btn) {
        btn = document.getElementById('btn-copy-link');
        if (!btn) return;
    }
    
    const originalHtml = btn.innerHTML;

    // 萬用複製函式
    const copyToClipboard = async (text) => {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }
    };

    try {
        await copyToClipboard(beautifulUrl);
        btn.innerHTML = '<i class="fas fa-check-circle mr-1.5 text-green-400"></i> <span class="text-green-400">已複製連結</span>';
        btn.classList.add('border-green-400/50', 'bg-green-400/10');
        
        window.history.replaceState({ page: 'home' }, '', beautifulUrl);

        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.remove('border-green-400/50', 'bg-green-400/10');
        }, 2000);
    } catch (err) {
        alert('複製失敗，您的瀏覽器可能不支援此功能，請直接從上方網址列複製！');
    }
};

// ==========================================
// 🌟 LINE 客服視窗控制
// ==========================================
window.toggleLineModal = () => {
    const modal = document.getElementById('lineModal');
    if (!modal) return;
    
    if (modal.classList.contains('hidden')) {
        // 打開視窗
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.firstElementChild.classList.remove('scale-95');
            modal.firstElementChild.classList.add('scale-100');
        }, 10);
    } else {
        // 關閉視窗
        modal.firstElementChild.classList.remove('scale-100');
        modal.firstElementChild.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
};

// ==========================================
// 🌟 隱私權政策與報名按鈕控制
// ==========================================
window.togglePrivacyModal = () => {
    const modal = document.getElementById('privacyModal');
    if (!modal) return;
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.firstElementChild.classList.remove('scale-95');
            modal.firstElementChild.classList.add('scale-100');
        }, 10);
    } else {
        modal.firstElementChild.classList.remove('scale-100');
        modal.firstElementChild.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
};

window.toggleRegisterBtn = () => {
    const checkbox = document.getElementById('privacy-consent');
    const btn = document.getElementById('btn-go-register');
    if (!checkbox || !btn) return;

    if (checkbox.checked) {
        btn.className = "w-full sm:w-auto bg-tkdBlue text-white px-10 py-4 rounded-2xl font-black hover:bg-blue-700 transition-all duration-300 shadow-lg shadow-blue-500/30 flex items-center justify-center active:scale-95 group";
    } else {
        btn.className = "w-full sm:w-auto bg-gray-100 text-gray-400 cursor-not-allowed px-10 py-4 rounded-2xl font-black transition-all duration-300 flex items-center justify-center group";
    }
};

window.toggleConsentAlertModal = (show) => {
    const modal = document.getElementById('consentAlertModal');
    if (!modal) return;
    if (show) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.firstElementChild.classList.replace('scale-95', 'scale-100');
        }, 10);
    } else {
        modal.firstElementChild.classList.replace('scale-100', 'scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
};

// 修改後的導航檢查函式
window.checkConsentAndNavigate = () => {
    const checkbox = document.getElementById('privacy-consent');
    if (checkbox && checkbox.checked) {
        if (window.navigate) window.navigate('register');
    } else {
        // 視覺晃動提示
        const label = document.querySelector('label[for="privacy-consent"]') || document.getElementById('privacy-consent').parentElement.parentElement;
        label.classList.add('animate-pulse', 'text-red-500');
        setTimeout(() => label.classList.remove('animate-pulse', 'text-red-500'), 1000);
        
        // ✨ 使用自訂 Modal 取代 alert()
        window.toggleConsentAlertModal(true);
    }
};

window.agreePrivacyAndClose = () => {
    const checkbox = document.getElementById('privacy-consent');
    if (checkbox) checkbox.checked = true;
    window.toggleRegisterBtn();
    window.togglePrivacyModal();
};

// ==========================================
// 🌟 賽事規程專屬：複製中文連結
// ==========================================
window.copyTourLink = async () => {
    const currentUrl = new URL(window.location.href);
    // decodeURI 是讓網址保持中文字的關鍵魔法
    const beautifulUrl = decodeURI(currentUrl.toString());

    const copyToClipboard = async (text) => {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        }
    };

    try {
        await copyToClipboard(beautifulUrl);
        // 改用全域 Toast 提示，避免破壞標題 DOM 結構
        if (window.showToast) {
            window.showToast('✅ 賽事連結已複製！');
        } else {
            alert('✅ 賽事連結已複製！');
        }
    } catch (err) {
        alert('複製失敗，請直接從上方網址列複製！');
    }
};