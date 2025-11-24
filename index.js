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
  if (event.type !== "message" || event.message.type !== "text") {
    return;
  }

  const userId = event.source.userId;
  const text = event.message.text.trim();

  // ① 啟動保險規劃流程
  if (text.includes("保險經紀人") || text.includes("保險業務員")) {
    userState[userId] = { step: 1 };
    return client.replyMessage(event.replyToken, {
      type: "text",
      text:
        "您好，我將協助您進行專業保單規劃。\n" +
        "請問您想規劃的保單類型是：\n" +
        "1️⃣ 財富型\n2️⃣ 保障型\n3️⃣ 醫療型",
    });
  }

  const state = userState[userId];

  // 若目前在流程中，依 step 處理
  if (state) {
    // Step 1：保單類型
    if (state.step === 1) {
      if (["財富型", "保障型", "醫療型"].includes(text)) {
        state.type = text;
        state.step = 2;
        return client.replyMessage(event.replyToken, {
          type: "text",
          text:
            `了解！客戶需求：${text}\n` +
            "請問每月可負擔的保費預算大約是多少？（例如：3000）",
        });
      }
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請回答：財富型 / 保障型 / 醫療型",
      });
    }

    // Step 2：預算
    if (state.step === 2) {
      if (!isNaN(text)) {
        state.budget = parseInt(text, 10);
        state.step = 3;
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "請提供客戶保險年齡（例如：30）",
        });
      }
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請輸入數字，例如：3000",
      });
    }

    // Step 3：年齡
    if (state.step === 3) {
      if (!isNaN(text)) {
        state.age = parseInt(text, 10);
        state.step = 4;
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "請問客戶性別？（男 / 女）",
        });
      }
      return;
    }

    // Step 4：性別
    if (state.step === 4) {
      if (["男", "女"].includes(text)) {
        state.gender = text;
        state.step = 5;
        return client.replyMessage(event.replyToken, {
          type: "text",
          text: "請問職業等級？（1~4）",
        });
      }
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請回答 男 / 女",
      });
    }

    // Step 5：職業等級
    if (state.step === 5) {
      const n = parseInt(text, 10);
      if (!isNaN(n) && n >= 1 && n <= 4) {
        state.occupation = n;
        state.step = 6;
        return client.replyMessage(event.replyToken, {
          type: "text",
          text:
            "最後一步：請貼上可銷售保單的產品頁連結（HTML 或 PDF），我會協助解析與規劃建議。",
        });
      }
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請輸入 1~4 之間的數字（職業等級）",
      });
    }

    // Step 6：暫時先只確認有收到連結（之後再串完整解析）
    if (state.step === 6) {
      state.productLink = text;
      const replyText =
        `已收到產品連結：${text}\n` +
        "目前先確認流程運作正常，之後可再加入實際保單解析、IRR 計算與缺口分析。";
      delete userState[userId];
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: replyText,
      });
    }
  }

  // 如果沒有在流程中：使用 ChatGPT 做智慧回覆 + 記錄對話
  const aiReply = await getSmartReply(userId, text);
  return client.replyMessage(event.replyToken, {
    type: "text",
    text: aiReply,
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
