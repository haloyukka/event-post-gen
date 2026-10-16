import { test } from "node:test";
import assert from "node:assert/strict";
import { extract } from "../js/extract.js";
import { render, WEEKDAY_NOTE } from "../js/render.js";
import { isHoliday } from "../js/holiday.js";

const TODAY = new Date(2026, 9, 17);
const ZAIKO_HTML = `
<html><head>
<meta property="og:title" content="MIKU NEON NIGHT 2026 | ZAIKO">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"MusicEvent","name":"MIKU NEON NIGHT 2026",
 "location":{"@type":"Place","name":"Spotify O-EAST"},
 "subEvent":[
  {"@type":"MusicEvent","name":"MIKU NEON NIGHT 2026 DAY","startDate":"2026-11-03T13:00:00+09:00","doorTime":"2026-11-03T12:30:00+09:00"},
  {"@type":"MusicEvent","name":"MIKU NEON NIGHT 2026 NIGHT","startDate":"2026-11-03T18:00:00+09:00","doorTime":"2026-11-03T17:30:00+09:00"}
 ]}
</script></head>
<body><h1>MIKU NEON NIGHT 2026</h1>
<p>公式ハッシュタグ #ミクネオン #ボカロ #MIKUNEONNIGHT</p>
<h3>DAY</h3><p>2026年11月3日(火・祝) OPEN 12:30 / START 13:00</p>
<h3>NIGHT</h3><p>2026年11月3日(火・祝) OPEN 17:30 / START 18:00</p>
<p>会場：Spotify O-EAST</p></body></html>
`;
const PIA_HTML = `
<html><head><title>ボカロクラブナイト vol.5 | チケットぴあ</title></head>
<body>
<h1>ボカロクラブナイト vol.5</h1>
<dl><dt>公演日</dt><dd>2026/12/12(土)</dd>
<dt>時間</dt><dd>開場 18:00 開演 18:30</dd>
<dt>会場</dt><dd>渋谷WWW X（東京都）</dd></dl>
<p>#ボカクラ で感想をシェア！</p>
</body></html>
`;
const LTIKE_HTML = `
<html><head><meta property="og:title" content="ナイトパレード東京 のチケット情報"></head>
<body><h2>ナイトパレード東京</h2>
<p>12月20日(土) 17:00開場 / 18:00開演</p>
<p>会場：Zepp Haneda(TOKYO)</p></body></html>
`;

// ページ上で全選択コピーしたときのような本文テキスト
const PASTED_TEXT = `ログイン 新規会員登録
トップ > ライブ > ボカロクラブナイト vol.5
ボカロクラブナイト vol.5
ボカロクラブナイト vol.5
公演日
2026/12/12(土)
時間
開場 18:00 開演 18:30
会場
渋谷WWW X
#ボカクラ で感想をシェア！
チケットを購入する`;

test("ZAIKO: JSON-LDの複数公演", () => {
  const res = extract(ZAIKO_HTML, "https://zaiko.io/event/123", TODAY);
  assert.deepEqual(res.performances.map((p) => p.label), ["DAY", "NIGHT"]);
  const out = render(res);
  assert.ok(out.startsWith("1. 【DAY】\n🔻Next\n#MIKUNEONNIGHT\nMIKU NEON NIGHT 2026\n"));
  assert.ok(out.includes("2026/11/3(火・祝) 12:30 開場"));
  assert.ok(out.includes("2. 【NIGHT】") && out.includes("2026/11/3(火・祝) 17:30 開場"));
  assert.equal(out.split("Spotify O-EAST").length - 1, 2);
  assert.ok(!out.includes(WEEKDAY_NOTE));
});

test("ぴあ: 単一公演（HTML）", () => {
  const out = render(extract(PIA_HTML, "https://t.pia.jp/x", TODAY));
  assert.equal(out, "🔻Next\n#ボカクラ\nボカロクラブナイト vol.5\n2026/12/12(土) 18:00 開場\n渋谷WWW X\n🎟\nhttps://t.pia.jp/x");
});

test("貼り付けテキスト（全選択コピー）からも同じ文面", () => {
  const res = extract(PASTED_TEXT, "https://t.pia.jp/x", TODAY);
  assert.equal(res.inputType, "text");
  assert.equal(render(res), "🔻Next\n#ボカクラ\nボカロクラブナイト vol.5\n2026/12/12(土) 18:00 開場\n渋谷WWW X\n🎟\nhttps://t.pia.jp/x");
});

test("曜日不一致は注記・年は推定", () => {
  const res = extract(LTIKE_HTML, "https://l-tike.com/x", TODAY);
  assert.equal(res.performances[0].dateIso, "2026-12-20");
  const out = render(res);
  assert.ok(out.includes("2026/12/20(土) 17:00 開場"));
  assert.ok(out.endsWith(WEEKDAY_NOTE));
  assert.ok(out.includes("#{{ハッシュタグ}}"));
});

test("空入力でも骨格を出力", () => {
  const res = extract("", "https://zaiko.io/e/1", TODAY);
  assert.equal(render(res), "🔻Next\n#{{ハッシュタグ}}\n{{イベント名}}\n{{日付}}({{曜日}}) {{開場時間}} 開場\n{{会場名}}\n🎟\nhttps://zaiko.io/e/1");
  assert.equal(res.errors.length, 1);
});

test("祝日判定", () => {
  for (const d of ["2026-11-03", "2026-11-23", "2026-09-21", "2026-09-22", "2026-09-23", "2026-05-06", "2027-01-11"])
    assert.ok(isHoliday(d), d);
  for (const d of ["2026-12-12", "2026-11-04", "2026-12-24"]) assert.ok(!isHoliday(d), d);
});
