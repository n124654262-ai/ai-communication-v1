# AI 雙向溝通機 V1

目前已完成手機介面、語音輸入、確認原意、翻譯結果、重點用詞、雙語溝通紀錄，以及安全 Gemini 後端程式。

## 目前狀態

- 尚未在部署平台填入公司 Gemini API Key，因此目前仍會使用模擬資料。
- API Key 只允許放在後端環境變數 `GEMINI_API_KEY`，前端與公開程式碼均不保存金鑰。
- `api/communicate.js` 使用 Google Gemini API 與結構化輸出，並限制來源網站、文字長度與基本請求頻率。
- 溝通紀錄只保留在目前頁面，重新整理後清除，也不會作為下一句的 AI 上下文。

## 本機測試

可直接開啟 `index.html` 測試文字輸入及介面。

麥克風通常需要 HTTPS 或 localhost。電腦測試時可在此資料夾執行：

```powershell
python -m http.server 8080
```

再開啟 `http://localhost:8080`。

## GitHub Pages

專案已包含 `.github/workflows/deploy-pages.yml` 與 `.nojekyll`，可從 Repository 根目錄部署，並使用相對路徑載入 CSS、JavaScript 與設定檔，避免 GitHub Pages 子目錄路徑錯誤。

推送至 GitHub 並啟用 Pages 後，網站會使用 HTTPS，才能在 Android Chrome 正常要求麥克風權限。

## 測試流程

1. 選擇翻譯目標語言。
2. 按「開始說話」，或使用文字輸入替代方案。
3. 查看「AI辨識說話者原意」。
4. 按「YES」進入翻譯，或按「NO」再次輸入。
5. 查看翻譯、重點用詞與下方雙語溝通紀錄。

## 已知限制

- 未部署安全後端及設定 API Key 前，仍不是實際 Gemini 翻譯。
- 瀏覽器語音辨識能力依 Android Chrome 與裝置服務而異。
- 若拒絕麥克風權限，頁面會提示重新授權，且仍可使用文字輸入。
- 公開測試期間仍須在公司 Google Cloud 專案設定用量與預算；程式內的基本頻率限制不能取代正式的雲端防濫用服務。

## 安全 Gemini 後端

後端預設使用 `gemini-3.6-flash`。部署時必須在後端平台設定：

- `GEMINI_API_KEY`：公司 Google AI Studio 建立的秘密金鑰。
- `ALLOWED_ORIGINS`：允許呼叫後端的完整 GitHub Pages 網址，多個網址以逗號分隔。
- `GEMINI_MODEL`：可選，預設 `gemini-3.6-flash`。
- `MAX_REQUESTS_PER_MINUTE`：可選，預設每個來源位置每分鐘 10 次。

部署後只需把 `config.js` 的 `apiBaseUrl` 改成後端完整網址，例如 `https://你的後端網址/api/communicate`。不要把 API Key 寫進 `config.js`。
