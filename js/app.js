import { extract, detectSite } from "./extract.js";
import { renderPosts, render, xWeightedLength, DATE_FORMATS, WEEKDAY_NOTE } from "./render.js";

const $ = (id) => document.getElementById(id);
const els = {
  url: $("url"), content: $("content"), paste: $("paste"), format: $("date-format"),
  generate: $("generate"), result: $("result"), notes: $("notes"), posts: $("posts"),
  json: $("json"), copyAll: $("copy-all"), site: $("site"), toast: $("toast"),
};
const SITE_NAMES = { zaiko: "ZAIKO", pia: "チケットぴあ", lawson_ticket: "ローチケ" };
const X_LIMIT = 280;

// 日付書式の選択肢（前回の選択を記憶）
for (const [k, v] of Object.entries(DATE_FORMATS)) els.format.add(new Option(v.label, k));
try { els.format.value = localStorage.getItem("dateFormat") || "slash"; } catch { /* storage 不可 */ }
els.format.addEventListener("change", () => {
  try { localStorage.setItem("dateFormat", els.format.value); } catch { /* noop */ }
  if (!els.result.hidden) generate();
});

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => els.toast.classList.remove("show"), 1600);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  toast("コピーしました");
}

function updateSiteBadge() {
  const u = els.url.value.trim();
  if (!u) { els.site.hidden = true; return; }
  const s = detectSite(u);
  els.site.hidden = false;
  els.site.textContent = s ? SITE_NAMES[s] : "対象外サイト";
  els.site.classList.toggle("off", !s);
}
els.url.addEventListener("input", updateSiteBadge);

els.paste.addEventListener("click", async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) return toast("クリップボードが空です");
    // URL だけがコピーされていたら URL 欄へ
    if (/^https?:\/\/\S+$/.test(t.trim()) && !els.url.value) {
      els.url.value = t.trim(); updateSiteBadge(); toast("URL を入力しました");
    } else {
      els.content.value = t; toast("貼り付けました");
    }
  } catch {
    toast("このブラウザでは直接貼り付けできません。長押しで貼り付けてください");
  }
});

const countPlaceholders = (t) => (t.match(/\{\{[^}]+\}\}/g) || []).length;

function postCard({ heading, text }, i) {
  const card = document.createElement("article");
  card.className = "post";
  const head = document.createElement("div");
  head.className = "post-head";
  head.textContent = heading || "投稿文";
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.rows = text.split("\n").length + 1;
  ta.setAttribute("aria-label", `${heading || "投稿文"} の文面`);

  const foot = document.createElement("div");
  foot.className = "post-foot";
  const meta = document.createElement("span");
  const btns = document.createElement("div");
  btns.className = "btns";
  const copyBtn = Object.assign(document.createElement("button"), { type: "button", className: "ghost small", textContent: "コピー" });
  const xLink = Object.assign(document.createElement("a"), { className: "ghost small", textContent: "X で開く", target: "_blank", rel: "noopener" });
  xLink.style.textDecoration = "none";
  xLink.style.borderRadius = "10px";
  xLink.style.border = "1px solid var(--line)";

  const refresh = () => {
    const n = xWeightedLength(ta.value);
    const ph = countPlaceholders(ta.value);
    meta.innerHTML = "";
    const c = Object.assign(document.createElement("span"), { className: "count" + (n > X_LIMIT ? " over" : ""), textContent: `${n} / ${X_LIMIT}` });
    meta.append(c);
    if (ph) meta.append("　", Object.assign(document.createElement("span"), { className: "ph-count", textContent: `未入力 ${ph}件` }));
    xLink.href = "https://x.com/intent/post?text=" + encodeURIComponent(ta.value);
  };
  ta.addEventListener("input", refresh);
  copyBtn.addEventListener("click", () => copy(ta.value));
  refresh();

  btns.append(copyBtn, xLink);
  foot.append(meta, btns);
  card.append(head, ta, foot);
  return card;
}

let last = null;

function generate() {
  const url = els.url.value.trim();
  const res = extract(els.content.value, url);
  last = res;
  const posts = renderPosts(res, els.format.value);

  els.posts.replaceChildren(...posts.map(postCard));

  const notes = [...res.errors];
  if (!url) notes.push("URL が未入力です");
  else if (!res.site) notes.push("対象外サイトの URL です（ZAIKO / チケットぴあ / ローチケ以外）");
  if (posts.some((p) => p.text.includes(WEEKDAY_NOTE))) notes.push("ページ記載の曜日と日付が合わない公演があります。注記を確認してください");
  if (posts.some((p) => countPlaceholders(p.text))) notes.push("{{ }} の箇所は取得できなかった項目です。直接書き換えてください");
  if (posts.length > 1) notes.push(`${posts.length} 公演を検出しました。投稿は 1 件ずつ行ってください`);
  els.notes.replaceChildren(...notes.map((n) => Object.assign(document.createElement("li"), { textContent: n })));

  els.json.textContent = JSON.stringify(res, null, 2);
  els.result.hidden = false;
  els.result.scrollIntoView({ behavior: "smooth", block: "start" });
}

els.generate.addEventListener("click", generate);
els.copyAll.addEventListener("click", () => {
  // カード上で編集した内容を反映した全文（要件定義の出力形式）
  const cards = [...els.posts.querySelectorAll(".post")];
  if (!last) return;
  const multi = cards.length > 1 || last.performances[0].label;
  const text = multi
    ? cards.map((c) => `${c.querySelector(".post-head").textContent}\n${c.querySelector("textarea").value}`).join("\n\n")
    : cards[0].querySelector("textarea").value;
  copy(text || render(last, els.format.value));
});
