"""コマンドライン入口。

使い方:
  python -m event_post <URL>
  python -m event_post <URL> --html saved.html   # 取得できないページは保存HTMLで
  python -m event_post <URL> --json              # 抽出結果をJSONで（Grok Bot連携用）
"""
from __future__ import annotations

import argparse
import json
import sys

import requests

from .extract import extract, detect_site, Performance, ExtractResult
from .render import render, x_weighted_length, DATE_FORMATS

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")


def fetch(url: str, timeout: int = 15) -> str:
    r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "ja,en;q=0.8"},
                     timeout=timeout)
    r.raise_for_status()
    if not r.encoding or r.encoding.lower() == "iso-8859-1":
        r.encoding = r.apparent_encoding
    return r.text


def generate(url: str, html: str | None = None) -> ExtractResult:
    """URLから抽出結果を作る。取得・解析に失敗しても骨格だけは返す。"""
    errors = []
    if html is None:
        try:
            html = fetch(url)
        except Exception as e:  # noqa: BLE001 失敗時もプレースホルダーで出力する
            errors.append(f"ページ取得に失敗: {e}")
    if html:
        try:
            res = extract(html, url)
            res.errors = errors + res.errors
            return res
        except Exception as e:  # noqa: BLE001
            errors.append(f"ページ解析に失敗: {e}")
    return ExtractResult(url=url, site=detect_site(url), performances=[Performance()], errors=errors)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="event_post", description="イベントURLからX投稿文面を生成")
    ap.add_argument("url", help="イベントページのURL（ZAIKO / チケットぴあ / ローチケ）")
    ap.add_argument("--html", help="保存済みHTMLファイル（取得できないページ用）")
    ap.add_argument("--json", action="store_true", help="抽出結果をJSONで出力")
    ap.add_argument("--date-format", choices=list(DATE_FORMATS), default="slash",
                    help="日付の書式（既定: slash = 2026/11/3）")
    args = ap.parse_args(argv)

    html = None
    if args.html:
        with open(args.html, encoding="utf-8", errors="replace") as f:
            html = f.read()

    res = generate(args.url, html)
    if args.json:
        print(json.dumps(res.to_dict(), ensure_ascii=False, indent=2))
        return 0

    print(render(res, args.date_format))

    # レビュー用の補足（投稿文には含めない）
    notes = []
    if res.site is None:
        notes.append("対象外サイトのURLです（ZAIKO / チケットぴあ / ローチケ以外）")
    notes += res.errors
    for i, block in enumerate(render(res, args.date_format).split("\n\n"), 1):
        n = x_weighted_length(block.split("\n", 1)[1] if block[:1].isdigit() else block)
        if n > 280:
            notes.append(f"{i}件目がXの文字数上限を超えています（{n}/280）")
    if "{{" in render(res, args.date_format):
        notes.append("{{ }} の箇所は取得できなかった項目です。手で補完してください")
    if notes:
        print("\n" + "-" * 20, file=sys.stderr)
        for n in notes:
            print("・" + n, file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
