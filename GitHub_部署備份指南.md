# GitHub 專案備份與部署流程指南

本指南旨在說明如何將「Wego Enroll 專案」的原始碼備份至您的 GitHub 儲存庫，以及如何進行專案的本地開發與 Firebase 部署。

* **GitHub 儲存庫網址**：[https://github.com/chao1014/wego-enroll](https://github.com/chao1014/wego-enroll)
* **本地專案路徑**：`d:\firebase\wego-enroll`

---

## 🛠️ 日常開發與 GitHub 備份流程

當您在本地修改了專案內容後，請依照以下任一方式將變更同步到 GitHub 進行備份。

### 方式 A：使用 VS Code 視覺化介面（推薦，最簡單）

如果您使用 VS Code 開發，可以使用內建的 Git 圖形化介面，完全不需要輸入指令：

1. **查看變更**：
   * 點擊 VS Code 左側工具列的 **「原始檔控制 (Source Control)」** 圖示（快捷鍵 `Ctrl + Shift + G`）。
   * 您會在 **「變更 (Changes)」** 列表中看到所有已修改或新增的檔案。
2. **暫存變更 (Stage)**：
   * 將滑鼠移至變更檔案的右側，點擊 **`+` (暫存變更)** 符號。這相當於指令中的 `git add`。
3. **輸入提交訊息**：
   * 在上方的文字輸入框中，輸入這次修改的重點（例如：`調整報名表單樣式` 或 `更新 Firebase 設定`）。
4. **認可變更 (Commit)**：
   * 點擊輸入框上方的 **「認可 (Commit)」** 按鈕。此時修改記錄已保存在您的電腦中。
5. **同步至 GitHub (Push)**：
   * 點擊下方的 **「同步變更 (Sync Changes)」** 或 **「推送 (Push)」** 按鈕。VS Code 將會自動將進度上傳到您的 GitHub。

---

### 方式 B：使用終端機指令（Terminal）

如果您習慣使用命令列，可在專案根目錄下執行以下三個標準步驟：

```bash
# 1. 將所有修改過的檔案加入暫存區
git add .

# 2. 提交變更，並附上修改說明 (請將引號內文字換成您的修改說明)
git commit -m "您的修改說明"

# 3. 推送至 GitHub 的 main 分支
git push origin main
```

---

## 🚀 Firebase 網站部署流程

本專案使用 Vite 進行打包，並部署至 Firebase Hosting，流程如下：

### 1. 本地開發測試
在修改程式碼後，您可以在本地啟動伺服器進行預覽：
```bash
# 啟動 Vite 本地開發伺服器
npm run dev
```

### 2. 打包專案 (Build)
當準備要上線時，需要先將程式碼打包成生產環境的版本（會輸出至 `dist/` 資料夾）：
```bash
# 打包專案
npm run build
```

### 3. 部署至 Firebase Hosting
打包完成後，執行以下指令將 `dist/` 內的靜態檔案發布至 Firebase：
```bash
# 部署至 Firebase
firebase deploy
```

---

## ⚠️ 版本控制注意事項

1. **排除不必要的檔案**：
   我們已經在專案根目錄設定了 [.gitignore](file:///d:/firebase/wego-enroll/.gitignore) 檔案。以下檔案會**自動被忽略**，不會上傳到 GitHub，以維持專案的輕量與安全性：
   * `node_modules/` (第三方依賴套件，可透過 `npm install` 重建)
   * `.firebase/` (Firebase 本地暫存)
   * `dist/` (打包後產生的檔案，不需要上傳至 GitHub，每次部署由本地重新 build 即可)
   * 系統暫存檔（如 `Thumbs.db` 等）

2. **頻繁且小型的 Commit**：
   建議每完成一個小功能或修改，就進行一次 Commit。這能讓您在程式碼出錯時，隨時比對或回復到先前的版本。

---

## 🔄 如何在其他電腦還原專案

若您的電腦故障，或需要在其他裝置上繼續開發，您可以透過以下步驟將 GitHub 上的備份還原至新電腦：

1. **安裝 Git** 與 **Node.js**。
2. 開啟終端機並切換至您想存放專案的資料夾，執行：
   ```bash
   git clone https://github.com/chao1014/wego-enroll.git
   ```
3. 進入專案資料夾：
   ```bash
   cd wego-enroll
   ```
4. 執行以下指令安裝專案所需的相依套件：
   ```bash
   npm install
   ```
5. 安裝完成後，即可使用 `npm run dev` 啟動本地開發環境。
