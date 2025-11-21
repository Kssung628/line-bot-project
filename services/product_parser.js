import axios from 'axios';
import cheerio from 'cheerio';

export async function fetchAndExtract(url){
  const res = await axios.get(url, { timeout: 8000, headers: {'User-Agent':'Mozilla/5.0'} });
  const $ = cheerio.load(res.data);
  const title = $('meta[property="og:title"]').attr('content') || $('title').text() || '';
  const desc = $('meta[name="description"]').attr('content') || '';
  let body = '';
  $('p').each((i, el) => {
    const t = $(el).text().trim();
    if (t.length > 20) body += t + "\\n";
  });
  return `Title: ${title}\\nDescription: ${desc}\\n\\n${body}`.trim();
}
