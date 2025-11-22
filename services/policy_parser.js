
import axios from "axios";
import * as cheerio from "cheerio";

export async function parseInsuranceProduct(url) {
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      responseType: "arraybuffer",
      validateStatus: () => true
    });

    const contentType = res.headers["content-type"] || "";
    const isPdf = contentType.includes("application/pdf") || url.toLowerCase().endsWith(".pdf");

    if (isPdf) {
      return {
        ok: true,
        type: "pdf",
        raw: res.data
      };
    }

    const html = res.data.toString("utf-8");
    const $ = cheerio.load(html);
    const title =
      $('meta[property="og:title"]').attr("content") ||
      $("title").text().trim();

    const description =
      $('meta[name="description"]').attr("content") || "";

    const coverage = [];
    $("table tr").each((i, el) => {
      const cells = cheerio.default(el).find("td");
      if (cells.length >= 2) {
        const item = cheerio.default(cells[0]).text().trim();
        const amount = cheerio.default(cells[1]).text().trim();
        if (item && amount) {
          coverage.push({ item, amount });
        }
      }
    });

    return {
      ok: true,
      type: "html",
      title,
      description,
      coverage
    };
  } catch (e) {
    console.error("parseInsuranceProduct error:", e);
    return { ok: false, error: e.message };
  }
}
