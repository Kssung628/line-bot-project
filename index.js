import express from "express";
import line from "@line/bot-sdk";

// LINE Bot config
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const app = express();

// ❗ LINE Webhook 必須使用 raw body
app.post(
  "/callback",
  express.raw({ type: "application/json" }),
  line.middleware(config),
  async (req, res) => {
    try {
      const events = req.body.events;
      await Promise.all(events.map(handleEvent));
      return res.json({ status: "ok" });
    } catch (err) {
      console.error("handleEvent error:", err);
      return res.status(500).end();
    }
  }
);

// 其他 API 才能用 JSON parser
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

// 處理 LINE 訊息
async function handleEvent(event) {
  console.log("Received event:", event);

  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const replyText = "收到：" + event.message.text;

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: replyText
  });
}

const client = new line.Client(config);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`LINE Bot running on port ${port}`);
});
