from datetime import date

from event_post.extract import extract
from event_post.render import render, WEEKDAY_NOTE
from event_post.cli import generate

TODAY = date(2026, 10, 17)

ZAIKO_HTML = """
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
"""

PIA_HTML = """
<html><head><title>ボカロクラブナイト vol.5 | チケットぴあ</title></head>
<body>
<h1>ボカロクラブナイト vol.5</h1>
<dl><dt>公演日</dt><dd>2026/12/12(土)</dd>
<dt>時間</dt><dd>開場 18:00 開演 18:30</dd>
<dt>会場</dt><dd>渋谷WWW X（東京都）</dd></dl>
<p>#ボカクラ で感想をシェア！</p>
</body></html>
"""

LTIKE_MISMATCH_HTML = """
<html><head><meta property="og:title" content="ナイトパレード東京 のチケット情報"></head>
<body><h2>ナイトパレード東京</h2>
<p>12月20日(土) 17:00開場 / 18:00開演</p>
<p>会場：Zepp Haneda(TOKYO)</p></body></html>
"""  # 2026/12/20 は実際は日曜 → ページ記載(土)を優先し注記


def test_zaiko_multi_performance():
    res = extract(ZAIKO_HTML, "https://zaiko.io/event/123", TODAY)
    assert [p.label for p in res.performances] == ["DAY", "NIGHT"]
    out = render(res)
    assert out.startswith("1. 【DAY】\n🔻Next\n#MIKUNEONNIGHT\nMIKU NEON NIGHT 2026\n")
    assert "2026/11/3(火・祝) 12:30 開場" in out
    assert "2. 【NIGHT】" in out and "2026/11/3(火・祝) 17:30 開場" in out
    assert out.count("Spotify O-EAST") == 2
    assert out.count("🎟\nhttps://zaiko.io/event/123") == 2
    assert WEEKDAY_NOTE not in out


def test_pia_single_performance():
    res = extract(PIA_HTML, "https://t.pia.jp/pia/event/event.do?eventCd=1", TODAY)
    out = render(res)
    assert out == (
        "🔻Next\n#ボカクラ\nボカロクラブナイト vol.5\n"
        "2026/12/12(土) 18:00 開場\n渋谷WWW X\n🎟\n"
        "https://t.pia.jp/pia/event/event.do?eventCd=1"
    )


def test_weekday_mismatch_and_year_inference():
    res = extract(LTIKE_MISMATCH_HTML, "https://l-tike.com/concert/mevent/?mid=1", TODAY)
    p = res.performances[0]
    assert p.date_iso == "2026-12-20"
    out = render(res)
    assert "2026/12/20(土) 17:00 開場" in out
    assert out.endswith(WEEKDAY_NOTE)
    assert "#{{ハッシュタグ}}" in out  # タグなし


def test_fetch_failure_outputs_skeleton():
    res = generate("https://zaiko.io/event/does-not-resolve.invalid", html="")
    out = render(res)
    assert out == (
        "🔻Next\n#{{ハッシュタグ}}\n{{イベント名}}\n{{日付}}({{曜日}}) {{開場時間}} 開場\n"
        "{{会場名}}\n🎟\nhttps://zaiko.io/event/does-not-resolve.invalid"
    )


def test_partial_info_placeholders():
    html = "<html><head><title>謎のイベント | ZAIKO</title></head><body><p>近日公開</p></body></html>"
    out = render(extract(html, "https://zaiko.io/e/x", TODAY))
    assert "謎のイベント" in out
    assert "{{日付}}({{曜日}}) {{開場時間}} 開場" in out
    assert "{{会場名}}" in out
