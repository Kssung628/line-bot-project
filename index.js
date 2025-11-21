import "dotenv/config";
import express from "express";
import line from "@line/bot-sdk";
import fs from "fs";

const app = express();
app.use(express.json());

const client = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
});

// 簡易會話記錄（正式可改 Redis）
let userState = {};

app.post("/callback", line.middleware({
  channelSecret: process.env.LINE_CHANNEL_SECRET
}), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(err => console.error(err));
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return;
  }

  const userId = event.source.userId;
  const text = event.message.text.trim();

  // ------------------------
  // ① 啟動保險規劃流程
  // ------------------------
  if (text.includes("保險經紀人") || text.includes("保險業務員")) {
    userState[userId] = { step: 1 };

    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "您好，我將協助您進行專業保單規劃。\n請問您想規劃的保單類型是：\n1️⃣ 財富型\n2️⃣ 保障型\n3️⃣ 醫療型"
    });
  }

  // ------------------------
  // ② 判斷是否在流程中
  // ------------------------
  if (!userState[userId]) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "請先輸入「我是保險經紀人」以啟動智能保單規劃助手。"
    });
  }

  const state = userState[userId];

  // ------------------------
  // Step 1：保單類型
  // ------------------------
  if (state.step === 1) {
    if (["財富型", "保障型", "醫療型"].includes(text)) {
      state.type = text;
      state.step = 2;

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: `了解！您想規劃的是：${text}\n請問每月可負擔的保費預算大約是多少？（例如：3000）`
      });
    } else {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請回答：財富型 / 保障型 / 醫療型"
      });
    }
  }

  // ------------------------
  // Step 2：預算
  // ------------------------
  if (state.step === 2) {
    if (!isNaN(text)) {
      state.budget = parseInt(text, 10);
      state.step = 3;

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請提供客戶保險年齡（例如：30）"
      });
    } else {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請輸入數字，例如：3000"
      });
    }
  }

  // ------------------------
  // Step 3：年齡
  // ------------------------
  if (state.step === 3) {
    if (!isNaN(text)) {
      state.age = parseInt(text, 10);
      state.step = 4;

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請問客戶性別？（男 / 女）"
      });
    }
  }

  // ------------------------
  // Step 4：性別
  // ------------------------
  if (state.step === 4) {
    if (["男", "女"].includes(text)) {
      state.gender = text;
      state.step = 5;

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請問職業等級？（1~4）"
      });
    }
  }

  // ------------------------
  // Step 5：職業等級
  // ------------------------
  if (state.step === 5) {
    if (!isNaN(text) && parseInt(text) >= 1 && parseInt(text) <= 4) {
      state.occupation = parseInt(text, 10);
      state.step = 6;

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "請貼上可銷售保單的產品頁連結，我會協助分析。"
      });
    }
  }

  // ------------------------
  // Step 6：解析商品連結
  // ------------------------
  if (state.step === 6) {
    state.productLink = text;

    // 這裡可接真正的爬蟲或產品資料解析，你目前先用固定文字
    const summary =
      `已收到產品連結：${text}\n\n目前分析邏輯尚未連上資料庫，但流程已確認運作正常。`;

    state.step = 0; // 重置流程
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: summary
    });
  }

   // 萬一流程亂掉
  return client.replyMessage(event.replyToken, {
    type: "text",
    text: "流程已重置，請輸入「我是保險經紀人」重新開始。"
  });
}

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`LINE bot is running on port ${PORT}`);
});
