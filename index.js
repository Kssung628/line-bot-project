
import express from "express";
import line from "@line/bot-sdk";
import fetch from "node-fetch";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";

// -------------------------
// Setup path utilities
// -------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -------------------------
// ENV CONFIG
// -------------------------
const {
  LINE_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  OPENAI_API_KEY,
  SHEET_WEBAPP_URL,
  BASE_URL,
  PORT
} = process.env;

if (!LINE_ACCESS_TOKEN || !LINE_CHANNEL_SECRET || !OPENAI_API_KEY) {
  console.warn("⚠️ Please set LINE_ACCESS_TOKEN, LINE_CHANNEL_SECRET, and OPENAI_API_KEY in your environment.");
}

// -------------------------
// LINE BOT CONFIG
// -------------------------
const lineConfig = {
  channelAccessToken: LINE_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
};

const lineClient = new line.Client(lineConfig);
const app = express();

// Serve generated PDF reports statically
const reportsDir = path.join(__dirname, "reports");
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}
app.use("/reports", express.static(reportsDir));

// OpenAI Client
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// In-memory session store (簡單版)
const sessions = new Map(); // key: userId, value: { lastAnalysisText, lastProfile }

// LINE Webhook — 必須要 raw body
app.post(
  "/callback",
  express.raw({ type: "application/json" }),
  line.middleware(lineConfig),
  async (req, res) => {
    try {
      await Promise.all(req.body.events.map(handleEvent));
      res.json({ status: "ok" });
    } catch (err) {
      console.error("❌ handleEvent error:", err);
      res.status(500).end();
    }
  }
);

// 簡單健康檢查
app.get("/", (req, res) => {
  res.send("LINE Insurance Assistant Bot is running.");
});

// -------------------------
// 主事件處理器
// -------------------------
async function handleEvent(event) {
  if (event.type !== "message") return;

  const msg = event.message;
  const userId = event.source?.userId || "unknown";

  switch (msg.type) {
    case "text":
      return handleText(event, userId);

    case "image":
      return handleImage(event, userId);

    case "file":
      return handleFile(event, userId);

    default:
      return reply(event, "目前僅支援文字、圖片與 PDF / 文件檔案分析喔！");
  }
}

// -------------------------
// 文字訊息處理
// -------------------------
async function handleText(event, userId) {
  const text = event.message.text.trim();

  // 特殊指令：保險試算
  if (text.startsWith("保險試算")) {
    const result = handleInsuranceCalculatorCommand(text);
    const replyText = formatCalculatorResult(result);
    await reply(event, replyText);
    await logToSheet({
      type: "calculator",
      userId,
      rawText: text,
      result: replyText,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  // 特殊指令：產生建議書 PDF
  if (text.includes("產生建議書") || text.includes("PDF建議書") || text.toLowerCase().includes("pdf 建議書")) {
    const sess = sessions.get(userId);
    if (!sess || !sess.lastAnalysisText) {
      await reply(event, "目前還沒有可用的分析內容，請先和我進行一次保險需求或保單分析，再說「產生建議書」。");
      return;
    }

    const pdfInfo = await generatePdfReport(userId, sess.lastAnalysisText);
    const url = BASE_URL
      ? `${BASE_URL}/reports/${pdfInfo.fileName}`
      : `（請在部署環境設定 BASE_URL 後使用此連結） /reports/${pdfInfo.fileName}`;

    await reply(
      event,
      `已為您產生建議書 PDF：
${url}

您可以將此連結提供給客戶下載或列印。`
    );

    await logToSheet({
      type: "pdf_report",
      userId,
      fileName: pdfInfo.fileName,
      url,
      createdAt: new Date().toISOString(),
    });

    return;
  }

  // 若是網址 → 抓取網頁內容後交給 AI
  if (isUrl(text)) {
    const html = await fetch(text).then((r) => r.text());
    await sendToOpenAI(event, userId, [
      { type: "text", text: "請協助分析這個網頁內容，重點放在與保險、風險、財務相關之處，並整理為可與客戶溝通的說明。" },
      { type: "text", text: html },
    ]);
    return;
  }

  // 一般文字 → 直接丟給 AI
  await sendToOpenAI(event, userId, [
    { type: "text", text },
  ]);
}

// -------------------------
// 圖片（通常是保單拍照）
// -------------------------
async function handleImage(event, userId) {
  const buffer = await downloadLineContent(event.message.id);

  await sendToOpenAI(event, userId, [
    { type: "text", text: "請協助解析這張圖片可能包含的保單、說明書或保險相關資訊，並整理重點與建議。" },
    { type: "input_image", image: buffer },
  ]);
}

// -------------------------
// PDF / WORD / EXCEL
// -------------------------
async function handleFile(event, userId) {
  const fileName = event.message.fileName;
  const buffer = await downloadLineContent(event.message.id);

  await sendToOpenAI(event, userId, [
    {
      type: "text",
      text: `收到檔案：${fileName}
請協助閱讀並整理重點（若為保單，請著重於保障內容、除外條款與適合對象）。`,
    },
    {
      type: "input_file",
      input_file: buffer,
      mime_type: guessMimeType(fileName),
    },
  ]);
}

// -------------------------
// 統一提交給 OpenAI
// -------------------------
async function sendToOpenAI(event, userId, contentArray) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: insuranceAssistantPrompt(),
        },
        {
          role: "user",
          content: contentArray,
        },
      ],
    });

    const answer = completion.choices[0].message.content;

    // 簡單記錄在 session（給生成 PDF 用）
    const sess = sessions.get(userId) || {};
    sess.lastAnalysisText = answer;
    sessions.set(userId, sess);

    await reply(event, answer);

    // 寫入 Google Sheet（非必要，可關掉）
    await logToSheet({
      type: "conversation",
      userId,
      userMessage: contentArray.map((c) => c.text || "[binary]").join("\n").slice(0, 5000),
      assistantReply: answer.slice(0, 5000),
      createdAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error("❌ OpenAI error:", err);
    await reply(
      event,
      "抱歉，AI 分析時發生錯誤，請稍後再試或重新傳送資料。"
    );
  }
}

// -------------------------
// 工具：回覆訊息
// -------------------------
function reply(event, text) {
  return lineClient.replyMessage(event.replyToken, {
    type: "text",
    text,
  });
}

// -------------------------
// 工具：下載 LINE 檔案內容
// -------------------------
async function downloadLineContent(messageId) {
  const stream = await lineClient.getMessageContent(messageId);
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// -------------------------
// 工具：判斷 URL
// -------------------------
function isUrl(text) {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

// -------------------------
// 工具：猜 MIME TYPE
// -------------------------
function guessMimeType(filename) {
  const ext = filename.toLowerCase();

  if (ext.endsWith(".pdf")) return "application/pdf";
  if (ext.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext.endsWith(".doc")) return "application/msword";
  if (ext.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext.endsWith(".xls")) return "application/vnd.ms-excel";
  if (ext.endsWith(".csv")) return "text/csv";
  if (ext.endsWith(".txt")) return "text/plain";

  return "application/octet-stream"; // fallback
}

// -------------------------
// 工具：保險試算指令解析 & 計算器 (A)
// 指令格式範例：
// 保險試算 年齡=30 收入=800000 家庭=已婚小孩1 房貸=10000000 預算=2000
// -------------------------
function handleInsuranceCalculatorCommand(text) {
  const payload = {
    age: null,
    income: null,
    family: "",
    mortgage: 0,
    budget: null,
  };

  const parts = text.replace("保險試算", "").trim().split(/\s+/);
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (!k || !v) continue;
    if (k.includes("年齡")) payload.age = Number(v);
    if (k.includes("收入")) payload.income = Number(v);
    if (k.includes("家庭")) payload.family = v;
    if (k.includes("房貸")) payload.mortgage = Number(v);
    if (k.includes("預算")) payload.budget = Number(v);
  }

  const age = payload.age || 30;
  const income = payload.income || 800000;
  const mortgage = payload.mortgage || 0;

  // 簡單建議：壽險保額 ≈ 年收入 5–10 年 + 房貸
  const lifeMin = income * 5 + mortgage;
  const lifeMax = income * 10 + mortgage;

  // 重疾一次金 ≈ 年收入 1–3 年
  const ciMin = income * 1;
  const ciMax = income * 3;

  // 醫療實支實付建議：住院日額 + 醫療上限
  const medicalSum = 1000000; // 假設總額建議

  return {
    input: payload,
    suggestion: {
      life: { min: lifeMin, max: lifeMax },
      criticalIllness: { min: ciMin, max: ciMax },
      medical: { sumInsured: medicalSum },
    },
  };
}

function formatCalculatorResult(result) {
  const { input, suggestion } = result;

  return [
    "🧮【簡易保險試算結果】",
    "",
    "▶ 輸入條件",
    `- 年齡：${input.age || "未填寫（預設 30 歲）"}`,
    `- 年收入：約 ${input.income || "800000"} 元`,
    `- 房貸餘額：約 ${input.mortgage || 0} 元`,
    input.family ? `- 家庭狀況：${input.family}` : "",
    input.budget ? `- 保費預算：約 ${input.budget} / 月` : "",
    "",
    "▶ 建議保障區間（僅供概念與規劃參考，實際以商品設計與核保為準）",
    `- 壽險保額建議：約 ${formatNumber(suggestion.life.min)} ~ ${formatNumber(suggestion.life.max)} 元`,
    `- 重大疾病一次金：約 ${formatNumber(suggestion.criticalIllness.min)} ~ ${formatNumber(suggestion.criticalIllness.max)} 元`,
    `- 醫療險實支實付總額建議：約 ${formatNumber(suggestion.medical.sumInsured)} 元`,
    "",
    "▶ 解讀說明",
    "- 壽險部分以「收入 5–10 年 + 房貸」作為家庭責任的概念估算。",
    "- 重大疾病一次金是為了彌補治療期間的收入中斷與額外開銷。",
    "- 醫療實支實付則用來支應住院、自費手術與雜費。",
    "",
    "如需更精細的規劃，可將客戶的實際家庭結構、保障現況提供給我，我可以協助生成更完整的建議文字。"
  ]
    .filter(Boolean)
    .join("\n");
}

function formatNumber(n) {
  if (!n && n !== 0) return "";
  return n.toLocaleString("zh-TW");
}

// -------------------------
// (B) Google Sheet 紀錄 / 客戶資料
// 透過 Apps Script Web App URL 寫入
// -------------------------
async function logToSheet(payload) {
  if (!SHEET_WEBAPP_URL) return; // 沒設定就跳過
  try {
    await fetch(SHEET_WEBAPP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("⚠️ logToSheet failed:", err.message);
  }
}

// -------------------------
// (E) 產生 PDF 建議書
// -------------------------
async function generatePdfReport(userId, analysisText) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `insurance-report-${userId}-${timestamp}.pdf`;
  const filePath = path.join(reportsDir, fileName);

  const doc = new PDFDocument({ margin: 50 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(18).text("保險規劃建議書", { align: "center" });
  doc.moveDown();
  doc.fontSize(10).text(`產生時間：${new Date().toLocaleString("zh-TW")}`);
  doc.moveDown();

  doc.fontSize(12).text(analysisText, {
    align: "left",
  });

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return { fileName, filePath };
}

// -------------------------
// ⭐ AI 保險助理人格設定
// -------------------------
function insuranceAssistantPrompt() {
  return `
你是一名「專業保險經紀人專屬 AI 助理」。
你的任務是協助經紀人：
- 分析 PDF、圖片、文字形式的保單內容
- 做保障缺口分析（壽險 / 醫療 / 意外 / 重疾 / 長照）
- 產生專業、白話的保險建議
- 用條列與表格整理資訊
- 主動詢問缺少的必要資訊（例如：年齡、家庭狀況、收入、預算等）
- 不推薦特定公司，不提供實際費率
- 可依照經紀人輸入的客戶資料，協助撰寫「建議書文字內容」，方便貼到簡報或 LINE

回答要求：
- 清楚、友善、專業
- 醫療與保險名詞要白話化
- 不誇大、不推銷
- 若內容不足，要主動詢問細節
- 優先協助經紀人整理可用於與客戶溝通的資訊

若資料來自圖片或檔案，你要先 OCR / 解析後，再整理出：
1. 保單類型
2. 保額
3. 主要保障
4. 除外與限制
5. 優缺點
6. 建議補強方向

同時，你也要能依照經紀人的需求，整理為「建議書格式」：
- 先寫【客戶基本資料摘要】
- 再寫【現有保障與缺口】
- 再寫【建議調整方向】
- 最後寫【整體說明】，語氣溫和、容易被客戶接受。
  `;
}

// -------------------------

const listenPort = PORT || 3000;
app.listen(listenPort, () => {
  console.log(`🚀 LINE Insurance Assistant Bot running on port ${listenPort}`);
});
