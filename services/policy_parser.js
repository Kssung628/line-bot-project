import axios from "axios";
import * as cheerio from "cheerio";

/**
 * 解析保單產品頁（HTML 或 PDF）
 * @param {string} url
 * @returns {Promise<{ok:boolean, type:"html"|"pdf", raw?:Buffer, title?:string, description?:string, coverage?:Array, error?:string}>}
 */
export async function parseInsuranceProduct(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      responseType: "arraybuffer",   // 讓 HTML / PDF 都先拿到 buffer
      validateStatus: () => true,
    });

    if (res.status < 200 || res.status >= 300) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const contentType = res.headers["content-type"] || "";
    const isPdf =
      contentType.includes("application/pdf") ||
      url.toLowerCase().endsWith(".pdf");

    // ✅ 情況一：PDF（例如壽險商品 DM、條款 PDF）
    if (isPdf) {
      return {
        ok: true,
        type: "pdf",
        raw: Buffer.from(res.data),   // 交給 extractFromPdf 處理
      };
    }

    // ✅ 情況二：一般 HTML 商品頁
    const html = bufferToUtf8(res.data, contentType);
    const $ = cheerio.load(html);

    // 標題：盡量抓比較像商品名稱的欄位
    const title =
      $("meta[property='og:title']").attr("content")?.trim() ||
      $("title").text().trim() ||
      $("h1").first().text().trim() ||
      "";

    const description =
      $("meta[name='description']").attr("content")?.trim() || "";

    const coverage = [];

    // 嘗試抓有「保額 / 保險金額 / 給付」等字眼的表格
    $("table").each((i, table) => {
      const $table = $(table);
      const headerTexts = $table
        .find("tr")
        .first()
        .find("th,td")
        .map((i, el) => $(el).text().trim())
        .get();

      const hasCoverageHeader = headerTexts.some((t) =>
        /(保額|保險金額|給付|保險金)/.test(t)
      );
      if (!hasCoverageHeader) return;

      $table
        .find("tr")
        .slice(1)
        .each((rowIdx, tr) => {
          const tds = $(tr)
            .find("th,td")
            .map((i, el) =>
              $(el).text().trim().replace(/\s+/g, " ")
            )
            .get();

          if (tds.length === 0) return;

          coverage.push({
            item: tds[0] || "",
            amount: tds[1] || "",
            raw: tds.join(" / "),
          });
        });
    });

    // 若沒有抓到 table，就退而求其次，抓包含「保額」、「給付」的條列
    if (coverage.length === 0) {
      $("li").each((i, li) => {
        const text = $(li).text().trim();
        if (/(保額|保險金額|給付|保險金)/.test(text)) {
          coverage.push({ item: text, amount: "" });
        }
      });
    }

    return {
      ok: true,
      type: "html",
      title,
      description,
      coverage,
    };
  } catch (e) {
    console.error("parseInsuranceProduct error:", e);
    return { ok: false, error: e.message };
  }
}

// 很簡單的 buffer → utf8 轉換（若之後遇到 BIG5 / MS950 再加 iconv 也可以）
function bufferToUtf8(buf, contentType) {
  if (Buffer.isBuffer(buf)) return buf.toString("utf8");
  if (typeof buf === "string") return buf;
  return Buffer.from(buf).toString("utf8");
}
