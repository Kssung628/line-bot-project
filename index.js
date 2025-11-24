
import "dotenv/config";
import express from "express";
import line from "@line/bot-sdk";

import { parseInsuranceProduct } from "./services/policy_parser.js";
import { extractFromPdf } from "./services/pdf_reader.js";
import { calcIRR } from "./services/irr_calculator.js";
import { analyzeGap } from "./services/gap_analyzer.js";
import { buildSalesScript } from "./services/sales_script.js";
import { saveUserProfile } from "./services/db.js";
import { getSmartReply } from "./services/conversationService.js";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const app = express();

// ❗千萬不能在 callback 前使用 json parser
// app.use(express.json());

// Webhook — 必須保留 raw body
app.post(
  "/callback",
  express.raw({ type: "application/json" }),   // ① 保留 raw
  line.middleware({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET
  }),                                         // ② LINE 驗簽
  async (req, res) => {
    try {
      await Promise.all(req.body.events.map(handleEvent));
      return res.json({ status: "ok" });
    } catch (e) {
      console.error("handleEvent error:", e);
      return res.status(500).end();
    }
  }
);

// 其他 API 可以使用 JSON parser
app.use(express.json());

app.get("/", (req, res) => res.status(200).send("OK"));
});


const client = new line.Client(config);

// 簡易記憶：正式可改 Redis 或 DB
const userState = {};

app.post("/callback", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    return res.json({ status: "ok" });
  } catch (e) {
    console.error("handleEvent error:", e);
    return res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const text = event.message.text.trim();
  const userId = event.source.userId;

  // 啟動保險規劃流程
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

  // 若未在流程中
  if (!userState[userId]) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "請先輸入「我是保險經紀人」以啟動智能保單規劃助手。",
    });
  }

  const state = userState[userId];

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

  // Step 6：解析保單連結 + IRR + 缺口 + 話術
  if (state.step === 6) {
    state.productLink = text;
    const profile = {
      type: state.type,
      budget: state.budget,
      age: state.age,
      gender: state.gender,
      occupation: state.occupation,
      // 這裡先預設，之後可在流程中多問問題
      income: 600000,
      debt: 0,
      childCost: 0,
    };

    try {
      const parsed = await parseInsuranceProduct(text);
      let title = "";
      let coverage = [];
      let irrValue = null;

      if (!parsed.ok) {
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "保單連結解析失敗，請確認網址是否正確或改貼文字條款。",
        });
        state.step = 0;
        return;
      }

      if (parsed.type === "html") {
        title = parsed.title || "未取得產品名稱";
        coverage = parsed.coverage || [];
      } else if (parsed.type === "pdf") {
        const { text: pdfText, cashValues } = await extractFromPdf(parsed.raw);
        title = "PDF 保單（名稱可改由手動輸入）";
        coverage = [];
        if (cashValues && cashValues.length > 0 && state.type === "財富型") {
          const annualPremium = state.budget * 12;
          irrValue = calcIRR(cashValues, annualPremium);
        }
      }

      const gap = analyzeGap(profile, coverage);
      await saveUserProfile(userId, {
        profile,
        productLink: state.productLink,
        productTitle: title,
        gap,
        irr: irrValue,
      });

      const script = await buildSalesScript(profile, gap, title, irrValue);

      state.step = 0;

      const summaryText =
        `✅ 保單解析完成：${title}\n` +
        (irrValue
          ? `估算 IRR 約為 ${(irrValue * 100).toFixed(2)}%（假設以年繳 ${state.budget * 12} 元、繳至現金價值表末年）\n`
          : "") +
        `我幫你整理了一份可用於向客戶說明的話術草稿：\n\n${script}`;

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: summaryText,
      });
    } catch (e) {
      console.error("analysis error:", e);
      state.step = 0;
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "保單解析或分析時發生錯誤，請稍後重試或改貼文字內容。",
      });
    }
  }

  // 流程意外狀況：重置
  userState[userId] = null;
  
  // AI fallback
  const aiReply = await getSmartReply(userId, text);
  return client.replyMessage(event.replyToken, { type: "text", text: aiReply });

}
