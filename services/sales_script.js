
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function buildSalesScript(profile, gap, productTitle, irrInfo) {
  const prompt = `
你是一位專業、合規、低壓力的保險顧問，對象是「保險經紀人／保險業務員」，要給他用於說明商品的話術草稿。

【客戶資料】
年齡：${profile.age || "未提供"}
性別：${profile.gender || "未提供"}
預算：${profile.budget || "未提供"}
職業等級：${profile.occupation || "未提供"}

【產品名稱】
${productTitle || "未提供"}

【保障缺口分析】
${JSON.stringify(gap, null, 2)}

【財富型資訊（若有）】
${irrInfo ? `估算 IRR：約 ${(irrInfo * 100).toFixed(2)}%` : "IRR 資料不足或非財富型商品"}

請產生：
1. 一段約 80~120 字的專業說明話術，重點放在「需求對應」、「風險提醒」而非推銷。
2. 接著列出 3 句可直接對客戶說的短句話術（每句 25 字內，一行一句）。
用繁體中文輸出。`;

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 400
  });

  return resp.choices[0].message.content;
}
