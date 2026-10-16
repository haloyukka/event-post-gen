"""抽出結果を X 投稿用の文面に整形する。"""
from __future__ import annotations

from datetime import date

try:
    import jpholiday
except ImportError:  # 祝日判定は任意
    jpholiday = None

from .extract import ExtractResult, Performance, WEEKDAYS

WEEKDAY_NOTE = "※ページ記載の曜日と日付計算結果が異なります（ページ記載を優先）"
DATE_FORMATS = {
    "slash": "{y}/{m}/{d}",     # 2026/11/3
    "short": "{m}/{d}",         # 11/3
    "dot": "{y}.{m}.{d}",       # 2026.11.3
    "kanji": "{y}年{m}月{d}日",  # 2026年11月3日
}


def _date_line(p: Performance, date_format: str) -> tuple[str, bool]:
    """「日付(曜日) 時間 開場」行と、曜日不一致フラグを返す。"""
    mismatch = False
    if p.date_iso:
        d = date.fromisoformat(p.date_iso)
        date_str = DATE_FORMATS[date_format].format(y=d.year, m=d.month, d=d.day)
        calc_wd = WEEKDAYS[d.weekday()]
        if p.weekday_page and p.weekday_page != calc_wd:
            mismatch = True
            wd = p.weekday_page  # ページ記載を優先
        else:
            wd = p.weekday_page or calc_wd
        is_holiday = p.holiday_page or bool(jpholiday and jpholiday.is_holiday(d))
        wd_str = f"({wd}・祝)" if is_holiday else f"({wd})"
        head = f"{date_str}{wd_str}"
    else:
        head = "{{日付}}({{曜日}})"
    open_str = f"{p.open_time} 開場" if p.open_time else "{{開場時間}} 開場"
    return f"{head} {open_str}", mismatch


def render_one(p: Performance, url: str, date_format: str = "slash") -> str:
    date_line, mismatch = _date_line(p, date_format)
    lines = [
        "🔻Next",
        f"#{p.hashtag}" if p.hashtag else "#{{ハッシュタグ}}",
        p.title or "{{イベント名}}",
        date_line,
        p.venue or "{{会場名}}",
        "🎟",
        url or "{{イベントURL}}",
    ]
    if mismatch:
        lines.append(WEEKDAY_NOTE)
    return "\n".join(lines)


def render(result: ExtractResult, date_format: str = "slash") -> str:
    perfs = result.performances
    if len(perfs) == 1 and not perfs[0].label:
        return render_one(perfs[0], result.url, date_format)
    out = []
    for i, p in enumerate(perfs, 1):
        label = p.label or (f"{date.fromisoformat(p.date_iso).month}/{date.fromisoformat(p.date_iso).day}"
                            if p.date_iso else f"公演{i}")
        out.append(f"{i}. 【{label}】\n{render_one(p, result.url, date_format)}")
    return "\n\n".join(out)


def x_weighted_length(text: str) -> int:
    """X の文字数カウント（概算）: 全角などは2、URLは一律23。"""
    import re
    total = 0
    for token in re.split(r"(https?://\S+)", text):
        if token.startswith("http"):
            total += 23
            continue
        for ch in token:
            cp = ord(ch)
            light = (cp <= 0x10FF or 0x2000 <= cp <= 0x200D or 0x2010 <= cp <= 0x201F
                     or 0x2032 <= cp <= 0x2037)
            total += 1 if light else 2
    return total
