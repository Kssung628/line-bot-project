export async function generateRecruitingScript(customerData, openai){
  const prompt = `請幫我根據客戶資料提供三個短句招攬話術（每句 100 字內），客戶資料：${JSON.stringify(customerData)}`;
  const resp = await openai.chat.completions.create({
    model:'gpt-4.1-mini',
    messages:[{role:'user', content:prompt}],
    max_tokens:200
  });
  return resp.choices[0].message.content;
}

export function analyzeProtectionGap(customerData, products){
  const gap = [];
  if ((customerData.insurance_age || 0) > 50) gap.push('建議加強重大傷病與失能保障');
  if ((customerData.budget||0) < 5000) gap.push('保費偏低，請評估基礎壽險或意外險');
  return gap.length? gap.join('; '): '無明顯保障缺口（需更多資料）';
}
