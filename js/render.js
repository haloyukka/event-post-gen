// 抽出結果を X 投稿用の文面に整形する。
import { WEEKDAYS } from "./extract.js";
import { isHoliday } from "./holiday.js";

export const WEEKDAY_NOTE = "※ページ記載の曜日と日付計算結果が異なります（ページ記載を優先）";

export const DATE_FORMATS = {
  slash: { label: "2026/11/3", fmt: (y, m, d) => `${y}/${m}/${d}` },
  short: { label: "11/3", fmt: (y, m, d) => `${m}/${d}` },
  dot: { label: "2026.11.3", fmt: (y, m, d) => `${y}.${m}.${d}` },
  kanji: { label: "2026年11月3日", fmt: (y, m, d) => `${y}年${m}月${d}日` },
};

function dateLine(p, dateFormat) {
  let mismatch = false;
  let head;
  if (p.dateIso) {
    const [y, m, d] = p.dateIso.split("-").map(Number);
    const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=日
    const calcWd = WEEKDAYS[(jsDay + 6) % 7];
    let wd = p.weekdayPage || calcWd;
    if (p.weekdayPage && p.weekdayPage !== calcWd) mismatch = true; // ページ記載を優先
    const holiday = p.holidayPage || isHoliday(p.dateIso);
    head = `${DATE_FORMATS[dateFormat].fmt(y, m, d)}(${wd}${holiday ? "・祝" : ""})`;
  } else {
    head = "{{日付}}({{曜日}})";
  }
  const open = p.openTime ? `${p.openTime} 開場` : "{{開場時間}} 開場";
  return { line: `${head} ${open}`, mismatch };
}

export function renderOne(p, url, dateFormat = "slash") {
  const { line, mismatch } = dateLine(p, dateFormat);
  const lines = [
    "🔻Next",
    p.hashtag ? `#${p.hashtag}` : "#{{ハッシュタグ}}",
    p.title || "{{イベント名}}",
    line,
    p.venue || "{{会場名}}",
    "🎟",
    url || "{{イベントURL}}",
  ];
  if (mismatch) lines.push(WEEKDAY_NOTE);
  return lines.join("\n");
}

function labelOf(p, i) {
  if (p.label) return p.label;
  if (p.dateIso) {
    const [, m, d] = p.dateIso.split("-").map(Number);
    return `${m}/${d}`;
  }
  return `公演${i}`;
}

/** 公演ごとの { heading, text } を返す。単一公演は heading なし。 */
export function renderPosts(result, dateFormat = "slash") {
  const perfs = result.performances;
  if (perfs.length === 1 && !perfs[0].label) {
    return [{ heading: null, text: renderOne(perfs[0], result.url, dateFormat) }];
  }
  return perfs.map((p, idx) => ({
    heading: `${idx + 1}. 【${labelOf(p, idx + 1)}】`,
    text: renderOne(p, result.url, dateFormat),
  }));
}

/** 要件定義の出力形式（番号・ラベル付きの全文）。 */
export function render(result, dateFormat = "slash") {
  return renderPosts(result, dateFormat)
    .map((b) => (b.heading ? `${b.heading}\n${b.text}` : b.text))
    .join("\n\n");
}

/** X の文字数カウント（概算）: 全角などは2、URLは一律23。 */
export function xWeightedLength(text) {
  let total = 0;
  for (const token of text.split(/(https?:\/\/\S+)/)) {
    if (/^https?:\/\//.test(token)) { total += 23; continue; }
    for (const ch of token) {
      const cp = ch.codePointAt(0);
      const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
      total += light ? 1 : 2;
    }
  }
  return total;
}
