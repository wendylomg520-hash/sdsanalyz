# SDS Vercel 安全部署版

## 檔案結構
- `index.html`：前端頁面
- `api/analyze.js`：Vercel Function，代替前端去呼叫 Gemini
- `vercel.json`：可選設定，啟用 cleanUrls 並將分析函式的最長執行時間設為 60 秒

## 上線前要做
1. 把這個資料夾上傳到 GitHub
2. 到 Vercel 匯入這個 repo
3. 在 Vercel 專案設定新增環境變數：
   - `GEMINI_API_KEY`：你的 Gemini API Key
   - `GEMINI_MODEL`：可選，不填就使用 `gemini-2.5-flash`
4. 重新部署

## 注意
- 圖片型 PDF 會被縮成最多前 4 頁，以避免請求體過大。
- 如果你的 SDS 常常是掃描版而且頁數很多，之後可以再升級成「先上傳檔案到 Blob，再由後端讀取」的架構。
