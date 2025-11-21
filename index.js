import express from "express";
import { Client, middleware } from "@line/bot-sdk";

const app = express();

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);

app.post("/webhook", middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(err => {
      console.error(err);
      res.status(500).end();
    });
});

function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return Promise.resolve(null);
  }

  const replyText = event.message.text;

  return client.replyMessage(event.replyToken, {
    type: "text",
    text: `你說了：${replyText}`
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`LINE Bot running on port ${port}`);
});
