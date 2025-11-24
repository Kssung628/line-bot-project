
import fs from "fs";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const filePath = "./data/conversations.json";

function load() {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function save(db) {
  fs.writeFileSync(filePath, JSON.stringify(db, null, 2));
}

export async function getSmartReply(userId, message) {
  const db = load();
  if (!db[userId]) db[userId] = [];
  db[userId].push({ role: "user", content: message });

  const history = db[userId].slice(-20);
  const messages = [
    { role: "system", content: "你是專業的保險顧問 AI，回答自然且記得上下文。" },
    *history,
  ];

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });
  const reply = resp.choices[0].message.content;
  db[userId].push({ role: "assistant", content: reply });
  save(db);
  return reply;
}
