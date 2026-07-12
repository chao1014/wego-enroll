    // 引入 Firebase 核心與各項服務
    import { initializeApp } from "firebase/app";
    import { getAuth, GoogleAuthProvider } from "firebase/auth";
    import { getFirestore, collection, doc } from "firebase/firestore";
    import { getFunctions } from "firebase/functions";
    import { getStorage } from "firebase/storage";
    import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "firebase/app-check";
    import { getAnalytics } from "firebase/analytics";

    // ==========================================
    // 1. 全域常數與設定
    // ==========================================
    export const SUPER_ADMIN = "chao82465@gmail.com";

    // 判斷是否在預覽環境 (Project IDX / Local)
    export const isPreviewEnv = typeof __firebase_config !== 'undefined';

    const firebaseConfig = isPreviewEnv ? JSON.parse(__firebase_config) : {
        apiKey: "AIzaSyAaBPodx3gxxgGd55PsoVnD1uCmSiXJ174",
        authDomain: "wego-enroll.web.app",
        projectId: "wego-enroll",
        storageBucket: "wego-enroll.firebasestorage.app",
        messagingSenderId: "968806057903",
        appId: "1:968806057903:web:6dbd735c52a787d77f115a"
    };

    // ==========================================
    // 2. 初始化 Firebase 實體
    // ==========================================
    export const app = initializeApp(firebaseConfig);

    export const appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider('6Ld254IsAAAAABIB-FwG28F-mo5H4DjoscTEm5cp'),
        isTokenAutoRefreshEnabled: true
    });

    getToken(appCheck, false)
        .then((appCheckToken) => {
            console.log("✅【App Check 狀態】憑證獲取成功！長度:", appCheckToken.token.length);
        })
        .catch((error) => {
            console.error("❌【App Check 狀態】憑證獲取失敗！原因可能是被瀏覽器阻擋：", error);
        });

    export const auth = getAuth(app);
    export const db = getFirestore(app);
    export const googleProvider = new GoogleAuthProvider();
    export const functions = getFunctions(app);
    export const storage = getStorage(app);
    export const analytics = getAnalytics(app);

    // ==========================================
    // 3. 資料庫路徑輔助函式 (Helper Functions)
    // ==========================================
    export const appIdStr = typeof __app_id !== 'undefined' ? __app_id : 'wego-enroll-app';

    /**
     * 取得指定集合 (Collection) 的 Firestore 參考路徑
     * @param {string} colName 集合名稱 (例如: 'registrations')
     */
    export const getDbPath = (colName) => collection(db, 'artifacts', appIdStr, 'public', 'data', colName);

    /**
     * 取得全域設定檔 (Global Settings) 的 Firestore 文件參考路徑
     */
    export const getSettingsDoc = () => doc(db, 'artifacts', appIdStr, 'public', 'data', 'settings', 'global');