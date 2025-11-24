
# LINE Insurance Assistant Bot

使用 LINE + OpenAI 打造的「個人保險業務助理」，具備：

- ✅ 保險試算計算器（指令：`保險試算 年齡=30 收入=800000 房貸=10000000 預算=2000`）
- ✅ 文字 / 圖片 / PDF / Word / Excel 解析
- ✅ 網頁內容分析（貼網址即可）
- ✅ 自動寫入 Google Sheet（客戶對話 / 試算 / PDF 紀錄）
- ✅ 一鍵產生保險建議書 PDF（指令：`產生建議書`）
- ✅ LINE 富選單（保單健檢 / 傳PDF / 生成建議書）

## 安裝

```bash
npm install
```

## 必要環境變數

- `LINE_ACCESS_TOKEN`：LINE channel access token
- `LINE_CHANNEL_SECRET`：LINE channel secret
- `OPENAI_API_KEY`：OpenAI API key
- `SHEET_WEBAPP_URL`：（選填）Google Apps Script Web App 的網址，用來寫入 Google Sheet
- `BASE_URL`：（選填）你的服務對外網址，例 `https://your-domain.com`，用於組合 PDF 下載連結
- `PORT`：（選填）預設 3000

## 啟動

```bash
npm start
```

並在 LINE Developer Console 中將 Webhook URL 設為：

```
https://your-domain.com/callback
```

## 保險試算用法（功能 A）

在 LINE 中輸入：

```
保險試算 年齡=35 收入=900000 房貸=8000000 預算=3000
```

Bot 會回傳：

- 建議壽險保額區間
- 建議重疾一次金區間
- 醫療實支實付建議額度
- 簡要解釋

## Google Sheet 紀錄（功能 B）

在 `SHEET_WEBAPP_URL` 設定為你自己寫好的 Google Apps Script Web App URL，  
此專案會自動以 `POST JSON` 的方式送出：

```jsonc
{
  "type": "conversation" | "calculator" | "pdf_report",
  "userId": "...",
  "userMessage": "...",
  "assistantReply": "...",
  "result": "...",
  "fileName": "...",
  "url": "...",
  "createdAt": "ISO 8601"
}
```

你可以在 Apps Script 中解析後寫入試算紀錄 / 客戶資料表。

## 產生建議書 PDF（功能 E）

在完成一次保險分析對話後，只要輸入：

```
產生建議書
```

Bot 會：

1. 取用最近一次 AI 分析文字
2. 產生 PDF 檔案，儲存在 `./reports` 資料夾
3. 回傳一個可下載連結（需設定 `BASE_URL`）

## LINE 富選單（功能 C）

`richmenu.json` 提供一個簡單範例，包含三個按鈕：

- 保單健檢
- 傳PDF保單
- 生成建議書

你可以用官方的 LINE API 或工具上傳此 rich menu 設定與圖片。

