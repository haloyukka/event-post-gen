// 貼り付けられたページ内容（本文テキスト or HTMLソース）から公演情報を抽出する。
// 抽出の優先順: JSON-LD (schema.org Event) → 本文テキストのパターン解析
// 取得できなかった項目は null のまま残し、描画時にプレースホルダーへ置き換える。

export const WEEKDAYS = "月火水木金土日";

const LABEL_RE = new RegExp(
  [
    String.raw`DAY\s*TIME|NIGHT\s*TIME`,
    String.raw`\bDAY\b|\bNIGHT\b`,
    String.raw`昼公演|夜公演|昼の部|夜の部`,
    String.raw`第[一二三四五1-9１-９]部|[1-9１-９]部`,
    String.raw`MATINEE|SOIREE|SOIRÉE`,
  ].map((p) => `(?:${p})`).join("|"),
  "i",
);

const DATE_RE =
  /(?:(20\d{2})\s*[年/.\-]\s*)?(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?\s*[（(]\s*([月火水木金土日])(?:[・･\s]*(?:祝|休))?\s*[）)]/;
const DATE_NOWD_RE = /(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?/;
const TIME = String.raw`(\d{1,2})\s*[:：時]\s*(\d{2})?`;
const OPEN_RE = new RegExp(String.raw`(?:開場|OPEN|ＯＰＥＮ|Open)\s*[:：]?\s*` + TIME);
const OPEN_AFTER_RE = new RegExp(TIME + String.raw`\s*開場`);
const START_RE = new RegExp(String.raw`(?:開演|START|ＳＴＡＲＴ|Start)\s*[:：]?\s*` + TIME);
const START_AFTER_RE = new RegExp(TIME + String.raw`\s*開演`);
const VENUE_RE = /(?:会場|VENUE|Venue|場所)\s*[:：】\]]?\s*([^\n]{2,60})/;
const VENUE_LINE_RE = /^(?:会場|VENUE|Venue|場所)\s*[:：】\]]?\s*$/;
const HASHTAG_RE = /[#＃]([0-9A-Za-z_぀-ヿ㐀-鿿０-ｚー]+)/g;
const TITLE_LABEL_RE = /^(?:公演名|イベント名|タイトル|公演タイトル)\s*[:：]?\s*(.*)$/;

export function detectSite(url = "") {
  const u = url.toLowerCase();
  if (u.includes("zaiko.io")) return "zaiko";
  if (u.includes("pia.jp")) return "pia";
  if (u.includes("l-tike.com")) return "lawson_ticket";
  return null;
}

// ---------- 補助 ----------

const clean = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/\s+/g, " ").replace(/^[\s　:：|｜-]+|[\s　:：|｜-]+$/g, "");
  return t || null;
};

const fmtTime = (h, m) => `${Number(h)}:${m ?? "00"}`;

const isoOf = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};

function inferYear(m, d, today) {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const c = Date.UTC(today.getFullYear(), m - 1, d);
  return c >= t ? today.getFullYear() : today.getFullYear() + 1;
}

function firstTime(regexes, ...texts) {
  for (const t of texts) {
    if (!t) continue;
    const hits = regexes.map((rx) => rx.exec(t)).filter(Boolean);
    if (hits.length) return hits.reduce((a, b) => (a.index <= b.index ? a : b));
  }
  return null;
}

function stripSiteSuffix(s) {
  if (!s) return null;
  let t = s.split(/\s*[|｜]\s*(?:ZAIKO|チケットぴあ|ローチケ|ローソンチケット)/)[0];
  t = t.replace(/\s*[-–]\s*(?:ZAIKO|チケットぴあ|ローチケ).*$/, "");
  t = t.replace(/のチケット情報.*$/, "");
  t = t.replace(/^[【\[]?チケット[】\]]?\s*/, "");
  return clean(t);
}

const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

export function looksLikeHtml(s) {
  return /<(?:html|head|body|meta|script|div|p|h1)[\s>]/i.test(s);
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:p|div|li|ul|ol|dl|dt|dd|tr|td|th|h[1-6]|section|article|header|footer|table)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function normalizeLines(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t　]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function metaTitle(html) {
  const m =
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html) ||
    /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ||
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? stripSiteSuffix(decodeEntities(m[1].replace(/<[^>]+>/g, " "))) : null;
}

// 貼り付けテキストからのイベント名推定
function titleFromText(text) {
  const lines = text.split("\n");
  for (const ln of lines) {
    const m = TITLE_LABEL_RE.exec(ln);
    if (m && clean(m[1])) return stripSiteSuffix(m[1]);
  }
  // ページ内で繰り返し現れる見出し行（パンくず・h1・ページタイトル等）を候補にする
  const ng = /https?:|ログイン|会員|チケット(?:を|購入|発売|一覧)|お問い合わせ|ヘルプ|検索|開場|開演|OPEN|START|会場|[#＃]|(\d{1,2})[:：]\d{2}|\d{1,2}[月/]\d{1,2}/i;
  const counts = new Map();
  lines.forEach((ln, i) => {
    const t = stripSiteSuffix(ln);
    if (!t || t.length < 4 || t.length > 80 || ng.test(t)) return;
    const c = counts.get(t) || { n: 0, first: i };
    c.n += 1;
    counts.set(t, c);
  });
  let best = null;
  for (const [t, c] of counts) {
    if (c.n < 2) continue;
    if (!best || c.n > best.c.n || (c.n === best.c.n && c.first < best.c.first)) best = { t, c };
  }
  return best ? best.t : null;
}

// ---------- JSON-LD ----------

function* jsonldEvents(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const stack = Array.isArray(data) ? [...data] : [data];
    while (stack.length) {
      const obj = stack.shift();
      if (!obj || typeof obj !== "object") continue;
      if (Array.isArray(obj["@graph"])) stack.push(...obj["@graph"]);
      const types = [].concat(obj["@type"] || []);
      if (types.some((t) => typeof t === "string" && t.endsWith("Event"))) {
        yield obj;
        for (const sub of [].concat(obj.subEvent || [])) {
          if (sub && typeof sub === "object") {
            yield { ...sub, name: sub.name ?? obj.name, location: sub.location ?? obj.location, _parentName: obj.name, _isSub: true };
          }
        }
      }
    }
  }
}

const ISO_DT_RE = /(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

function newPerformance() {
  return {
    label: null, title: null, dateIso: null, weekdayPage: null, holidayPage: false,
    openTime: null, startTime: null, venue: null, hashtag: null, sources: {},
  };
}

function fromJsonld(ev) {
  const p = newPerformance();
  if (ev.name) { p.title = clean(ev.name); p.sources.title = "json-ld"; }
  const m = ISO_DT_RE.exec(String(ev.startDate || ""));
  if (m) {
    p.dateIso = `${m[1]}-${m[2]}-${m[3]}`;
    p.sources.date = "json-ld";
    if (m[4]) { p.startTime = fmtTime(m[4], m[5]); p.sources.startTime = "json-ld"; }
  }
  const dm = ISO_DT_RE.exec(String(ev.doorTime || ""));
  if (dm && dm[4]) { p.openTime = fmtTime(dm[4], dm[5]); p.sources.openTime = "json-ld"; }
  let loc = ev.location;
  if (Array.isArray(loc)) loc = loc[0];
  if (loc && typeof loc === "object" && loc.name) { p.venue = clean(loc.name); p.sources.venue = "json-ld"; }
  else if (typeof loc === "string") { p.venue = clean(loc); p.sources.venue = "json-ld"; }
  return p;
}

// ---------- テキスト解析 ----------

const hasSchedule = (s) =>
  DATE_RE.test(s) || OPEN_RE.test(s) || OPEN_AFTER_RE.test(s) || START_RE.test(s) || START_AFTER_RE.test(s);

function splitBlocks(text) {
  const blocks = [];
  for (const ln of text.split("\n")) {
    const m = LABEL_RE.exec(ln);
    if (m && ln.length <= 40) {
      const raw = m[0].trim().replace(/\s+/g, " ");
      const label = /^[\x00-\x7f]+$/.test(raw) ? raw.toUpperCase() : raw;
      if (!blocks.length || blocks[blocks.length - 1].label !== label) {
        blocks.push({ label, lines: [ln] });
        continue;
      }
    }
    if (blocks.length) blocks[blocks.length - 1].lines.push(ln);
    else blocks.push({ label: null, lines: [ln] });
  }
  const head = blocks.filter((b) => b.label === null).map((b) => b.lines.join("\n")).join("\n");
  const meaningful = blocks
    .filter((b) => b.label !== null)
    .map((b) => ({ label: b.label, body: b.lines.join("\n") }))
    .filter((b) => hasSchedule(b.body));
  if (meaningful.length >= 2) return meaningful.map((b) => ({ label: b.label, body: head + "\n" + b.body }));
  return [{ label: null, body: text }];
}

function fillFromText(p, text, today, own) {
  const scope = own || text;
  if (p.dateIso == null) {
    const m = DATE_RE.exec(scope) || DATE_RE.exec(text);
    if (m) {
      const mo = Number(m[2]), d = Number(m[3]);
      const y = m[1] ? Number(m[1]) : inferYear(mo, d, today);
      const iso = isoOf(y, mo, d);
      if (iso) {
        p.dateIso = iso;
        p.weekdayPage = m[4];
        p.holidayPage = /祝|休/.test(m[0]);
        p.sources.date = m[1] ? "text" : "text(年は推定)";
      }
    } else {
      const n = DATE_NOWD_RE.exec(scope) || DATE_NOWD_RE.exec(text);
      if (n) {
        const iso = isoOf(Number(n[1]), Number(n[2]), Number(n[3]));
        if (iso) { p.dateIso = iso; p.sources.date = "text"; }
      }
    }
  } else if (p.weekdayPage == null) {
    // JSON-LDで日付が取れた場合も、ページ記載の曜日を拾って照合に使う
    const [, mo, d] = p.dateIso.split("-").map(Number);
    const all = new RegExp(DATE_RE.source, "g");
    let m;
    while ((m = all.exec(text))) {
      if (Number(m[2]) === mo && Number(m[3]) === d) {
        p.weekdayPage = m[4];
        p.holidayPage = /祝|休/.test(m[0]);
        break;
      }
    }
  }
  if (p.openTime == null) {
    const m = firstTime([OPEN_RE, OPEN_AFTER_RE], scope, text);
    if (m) { p.openTime = fmtTime(m[1], m[2]); p.sources.openTime = "text"; }
  }
  if (p.startTime == null) {
    const m = firstTime([START_RE, START_AFTER_RE], scope, text);
    if (m) { p.startTime = fmtTime(m[1], m[2]); p.sources.startTime = "text"; }
  }
  if (p.venue == null) {
    let v = null;
    const m = VENUE_RE.exec(scope) || VENUE_RE.exec(text);
    if (m) v = m[1];
    else {
      // 「会場」見出しの次の行に会場名があるレイアウト
      const lines = scope.split("\n");
      const i = lines.findIndex((l) => VENUE_LINE_RE.test(l));
      if (i >= 0 && lines[i + 1]) v = lines[i + 1];
    }
    if (v) {
      v = v.split(/\s*[（(]?(?:東京都|大阪府|〒|\d{3}-\d{4}|開場|OPEN)/)[0];
      p.venue = clean(v);
      if (p.venue) p.sources.venue = "text";
    }
  }
}

export function pickHashtag(text, title) {
  const tags = [];
  for (const m of text.matchAll(HASHTAG_RE)) {
    const t = m[1];
    if (/^\d+$/.test(t) || t.length < 2 || tags.includes(t)) continue;
    tags.push(t);
  }
  if (!tags.length) return null;
  if (!title) return tags[0];
  const normTitle = title.replace(/[\s\p{P}\p{S}_]+/gu, "").toLowerCase();
  const score = (tag) => {
    const n = tag.toLowerCase();
    let s = similarity(n, normTitle);
    if (normTitle.includes(n)) s += 0.5;
    return s;
  };
  const best = tags.reduce((a, b) => (score(b) > score(a) ? b : a));
  return score(best) >= 0.3 ? best : null;
}

// difflib.SequenceMatcher.ratio 相当の近似（最長共通部分列ベース）
function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  const A = [...a], B = [...b];
  const dp = Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    let prev = 0;
    for (let j = 1; j <= B.length; j++) {
      const tmp = dp[j];
      dp[j] = A[i - 1] === B[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return (2 * dp[B.length]) / (A.length + B.length);
}

// ---------- エントリポイント ----------

export function extract(content, url, today = new Date()) {
  const raw = content || "";
  const isHtml = looksLikeHtml(raw);
  const text = normalizeLines(isHtml ? htmlToText(raw) : raw);
  const pageTitle = isHtml ? metaTitle(raw) : titleFromText(text);

  let performances = [];
  const all = isHtml ? [...jsonldEvents(raw)] : [];
  const subs = all.filter((e) => e._isSub);
  const events = subs.length ? subs : all;

  if (events.length) {
    for (const ev of events) {
      const p = fromJsonld(ev);
      let nm = String(ev.name || "");
      if (ev._parentName) {
        // 子公演名から親イベント名を除いた残りでラベルを探す（名前自体の NIGHT 等の誤検出防止）
        nm = nm.replace(String(ev._parentName), " ");
        p.title = clean(ev._parentName);
        p.sources.title = "json-ld";
      }
      const lm = LABEL_RE.exec(nm) || LABEL_RE.exec(String(ev.description || ""));
      if (lm && events.length > 1) p.label = lm[0].trim();
      performances.push(p);
    }
    const blocks = splitBlocks(text);
    performances.forEach((p, i) => {
      let own = null;
      if (blocks.length === performances.length) {
        p.label = p.label || blocks[i].label;
        own = blocks[i].body;
      }
      fillFromText(p, text, today, own);
    });
  } else {
    for (const b of splitBlocks(text)) {
      const p = newPerformance();
      p.label = b.label;
      fillFromText(p, text, today, b.body);
      performances.push(p);
    }
  }

  const hashtag = pickHashtag(text, pageTitle || performances[0]?.title);
  for (const p of performances) {
    if (p.title == null && pageTitle) { p.title = pageTitle; p.sources.title = isHtml ? "meta" : "text"; }
    if (p.title && p.label) {
      const esc = p.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(String.raw`\s*(?:[【\[(（]${esc}[】\])）]|${esc})\s*$`, "i");
      p.title = clean(p.title.replace(re, "")) || p.title;
    }
    if (hashtag) { p.hashtag = hashtag; p.sources.hashtag = "text"; }
  }
  if (!performances.length) performances = [newPerformance()];

  const errors = [];
  if (!raw.trim()) errors.push("ページ内容が貼り付けられていません");
  return { url, site: detectSite(url), inputType: isHtml ? "html" : "text", performances, errors };
}
