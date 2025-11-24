import "dotenv/config";
import express from "express";
import line from "@line/bot-sdk";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { fileURLToPath } from "url";

import { parseInsuranceProduct } from "./services/policy_parser.js";
import { extractFromPdf } from "./services/pdf_reader.js";
import { calcIRR } from "./services/irr_calculator.js";
import { analyzeGap } from "./services/gap_analyzer.js";
import { buildSalesScript } from "./services/sales_script.js";
import { saveUserProfile } from "./services/db.js";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const app = express();

const client = new line.Client(config);
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// 取得 __dirname（因為是 ES module）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 對話紀錄檔案
const convoPath = path.join(__dirname, "data", "conversations.json");

function loadConvos() {
  try {
    if (!fs.existsSync(convoPath)) {
      return {};
    }
    const raw = fs.readFileSync(convoPath, "utf-8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("loadConvos error:", e);
    return {};
  }
}

function saveConvos(db) {
  try {
    fs.writeFileSync(convoPath, JSON.stringify(db, null, 2), "utf-8");
  } catch (e) {
    console.error("saveConvos error:", e);
  }
}

async function getSmartReply(userId, message) {
  if (!openai) {
    return "目前尚未設定 OpenAI API Key，所以僅能回覆簡單訊息：\n" + message;
  }
  const db = loadConvos();
  if (!db[userId]) db[userId] = [];

  db[userId].push({ role: "user", content: message });

  const history = db[userId].slice(-20);
  const messages = [
    {
      role: "system",
      content:
        "你是一位協助保險經紀人的智慧助理，使用繁體中文回答，語氣專業且自然，記得上下文。"
    },
    ...history,
  ];

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  const reply = resp.choices[0].message.content;
  db[userId].push({ role: "assistant", content: reply });
  saveConvos(db);
  return reply;
}

// 簡易流程記憶：正式可改用 Redis / DB
const userState = {};

// Webhook：必須使用 raw body 給 LINE middleware 驗簽
app.post(
  "/callback",
  express.raw({ type: "application/json" }),
  line.middleware(config),
  async (req, res) => {
    try {
      const events = req.body.events || [];
      await Promise.all(events.map(handleEvent));
      return res.json({ status: "ok" });
    } catch (e) {
      console.error("handleEvent error:", e);
      return res.status(500).end();
    }
  }
);

// 其他路由再掛 JSON parser
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

async function handleEvent(event) {
  if (event.type !== "message") return;

  const userId = event.source.userId;
  const msg = event.message;

  // ✅ A. 處理使用者直接上傳的 PDF 檔案
  if (msg.type === "file" && msg.fileName.toLowerCase().endsWith(".pdf")) {
    // 先把 LINE 的檔案抓下來
    const stream = await client.getMessageContent(msg.id);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // 用你現有的 pdf_reader 解析
    const { text, cashValues } = await extractFromPdf(buffer);

    // 若這時候剛好在 Step 6，就順便帶入 profile 資料
    const state = userState[userId];
    let profile = {};
    if (state && state.step === 6) {
      profile = {
        type: state.type,
        budget: state.budget,
        age: state.age,
        gender: state.gender,
        occupation: state.occupation,
        income: 600000,
        debt: 0,
        childCost: 0,
      };
    }

    let irrValue = null;
    if (
      cashValues &&
      cashValues.length > 0 &&
      profile.type === "財富型" &&
      profile.budget
    ) {
      irrValue = calcIRR(cashValues, profile.budget * 12);
    }

    // 這邊先用通用的 AI 回覆（conversationService），
    // 請 AI 根據 PDF 內容給出保單整理 + 規劃建議
    const aiReply = await getSmartReply(
      userId,
      `以下是客戶提供的保單 PDF 文字內容，請幫我：
1) 條列保單主要保障項目與保額
2) 檢視保障是否足夠，指出主要保障缺口
3) 給我可以對客戶說明的建議話術（約 3~5 句）

保單內容如下：
${text}`
    );

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: aiReply,
    });
  }

  // ✅ B. 其他非文字訊息（圖片、貼圖等等）就先忽略
  if (msg.type !== "text") return;

  // ✅ C. 原本的文字流程：保險規劃 Step 1~6 + fallback
  const text = msg.text.trim();

  // 以下保留你原本的程式內容：
  // 1) 啟動流程：「我是保險經紀人」、「保險業務員」
  // 2) Step 1~5 問保單類型/預算/年齡/性別/職業等級
  // 3) Step 6 貼網址 → 解析 + IRR + 缺口 + 話術
  // 4) 流程外的對話 → getSmartReply Fallback

  // 👉 這裡開始貼回你原本 handleEvent 裡處理文字的那一大段邏輯
  // （從「// 啟動保險規劃流程」一直到最後 AI fallback 那段）
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
