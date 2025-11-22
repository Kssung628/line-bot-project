
import pdf from "pdf-parse";

export async function extractFromPdf(buffer) {
  const data = await pdf(buffer);
  const text = data.text || "";

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const cashValues = [];

  lines.forEach(line => {
    const m = line.match(/^(\d{1,2})年\s*([\d,]+)元?/);
    if (m) {
      const year = parseInt(m[1], 10);
      const cash = parseInt(m[2].replace(/,/g, ""), 10);
      cashValues.push({ year, cash });
    }
  });

  return { text, cashValues };
}
