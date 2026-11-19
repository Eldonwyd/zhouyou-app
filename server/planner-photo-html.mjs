import { isPublicWebUrl } from '../src/planner-domain.ts';
import { plannerPhotoMatches } from '../src/planner-photo.ts';

/** 从图片自己的说明寻找地点，而不是因整篇文章提到景点就取第一张图。
 * 新闻图集经常没有 alt，却在图片后第一段写明城市、地点和摄影者。
 * 只读取到下一张图片之前的短说明，避免把其他城市的图误配到当前景点。
 */
export function plannerCaptionImage(html, pageUrl, placeName, city = '', pageContext = '') {
  const images = [...html.matchAll(/<img\b[^>]*>/gi)];
  const candidates = [];
  const addCandidate = (url, caption) => {
    // 旅行配图优先地点景观，图集中同地的表演/比赛照片仍可作为最后备选。
    const score = (/全景|鸟瞰|湖面|风光|景色|景观|观光游览/.test(caption) ? 2 : 0)
      - (/演出|京剧|比赛|签约|会议/.test(caption) ? 2 : 0);
    candidates.push({ url, caption, score });
  };
  for (let index = 0; index < images.length; index++) {
    const tag = images[index][0];
    const source = tag.match(/(?:data-src|src)\s*=\s*["']([^"']*)["']/i)?.[1];
    if (!source || /logo|favicon|avatar|sprite|qrcode|ewm|sharelogo|zxcode/i.test(source)) continue;
    let url;
    try { url = new URL(source.replaceAll('&amp;', '&'), pageUrl).href; }
    catch { continue; }
    if (!isPublicWebUrl(url)) continue;
    const alt = tag.match(/alt\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
    if (plannerPhotoMatches(alt, city, placeName, pageContext)) { addCandidate(url, alt); continue; }
    const start = images[index].index + tag.length;
    const end = Math.min(images[index + 1]?.index ?? html.length, start + 1400);
    const following = html.slice(start, end);
    const paragraphs = [...following.matchAll(/<(?:p|figcaption)\b[^>]*>([\s\S]*?)<\/(?:p|figcaption)>/gi)];
    const caption = paragraphs.map((match) => match[1].replace(/<[^>]*>/g, ' ').replace(/&(?:emsp|ensp|nbsp);/g, ' ').replace(/\s+/g, ' ').trim()).find(Boolean);
    if (!caption || caption.length > 400) continue;
    if (plannerPhotoMatches(caption, city, placeName, pageContext)) addCandidate(url, caption);
  }
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  return best ? { url: best.url, caption: best.caption } : null;
}
