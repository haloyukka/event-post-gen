"""イベントページHTMLから公演情報を抽出する。

抽出の優先順:
  1. JSON-LD (schema.org Event)  … ZAIKO などで構造化データがある場合
  2. 本文テキストのパターン解析   … ぴあ / ローチケ など
取得できなかった項目は None のまま残し、描画時にプレースホルダーへ置き換える。
"""
from __future__ import annotations

import difflib
import json
import re
from dataclasses import dataclass, field, asdict
from datetime import date

from bs4 import BeautifulSoup

WEEKDAYS = "月火水木金土日"

# 公演区分ラベル（ページ記載をそのまま使う）
LABEL_PATTERNS = [
    r"DAY\s*TIME|NIGHT\s*TIME",
    r"\bDAY\b|\bNIGHT\b",
    r"昼公演|夜公演|昼の部|夜の部",
    r"第[一二三四五1-9１-９]部|[1-9１-９]部",
    r"MATINEE|SOIREE|SOIRÉE",
]
LABEL_RE = re.compile("|".join(f"(?:{p})" for p in LABEL_PATTERNS), re.I)

# 2026年11月3日(火・祝) / 2026/11/3（火） / 11月3日(火) など
DATE_RE = re.compile(
    r"(?:(?P<y>20\d{2})\s*[年/.\-]\s*)?"
    r"(?P<m>\d{1,2})\s*[月/.\-]\s*(?P<d>\d{1,2})\s*日?"
    r"\s*[（(]\s*(?P<w>[月火水木金土日])(?:[・･\s]*(?:祝|休))?\s*[）)]"
)
DATE_NOWD_RE = re.compile(
    r"(?P<y>20\d{2})\s*[年/.\-]\s*(?P<m>\d{1,2})\s*[月/.\-]\s*(?P<d>\d{1,2})\s*日?"
)
TIME = r"(\d{1,2})\s*[:：時]\s*(\d{2})?"
OPEN_RE = re.compile(r"(?:開場|OPEN|ＯＰＥＮ|Open)\s*[:：]?\s*" + TIME)
START_RE = re.compile(r"(?:開演|START|ＳＴＡＲＴ|Start)\s*[:：]?\s*" + TIME)
# 「17:00開場」のように時刻が前に来る表記
OPEN_AFTER_RE = re.compile(TIME + r"\s*開場")
START_AFTER_RE = re.compile(TIME + r"\s*開演")
VENUE_RE = re.compile(r"(?:会場|VENUE|Venue|場所)\s*[:：】\]]?\s*([^\n]{2,60})")
HASHTAG_RE = re.compile(r"[#＃]([0-9A-Za-z_぀-ヿ㐀-鿿０-ｚー]+)")


@dataclass
class Performance:
    label: str | None = None
    title: str | None = None
    date_iso: str | None = None        # 2026-11-03
    weekday_page: str | None = None    # ページ記載の曜日（例: 火）
    holiday_page: bool = False         # ページに「祝」表記があったか
    open_time: str | None = None       # 17:00
    start_time: str | None = None
    venue: str | None = None
    hashtag: str | None = None
    sources: dict = field(default_factory=dict)  # 項目ごとの取得元（json-ld / text）

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ExtractResult:
    url: str
    site: str | None
    performances: list[Performance]
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "url": self.url,
            "site": self.site,
            "performances": [p.to_dict() for p in self.performances],
            "errors": self.errors,
        }


def detect_site(url: str) -> str | None:
    u = url.lower()
    if "zaiko.io" in u:
        return "zaiko"
    if "pia.jp" in u:
        return "pia"
    if "l-tike.com" in u:
        return "lawson_ticket"
    return None


# ---------- 補助 ----------

def _first_time(regexes, *texts):
    """複数パターンのうち、テキスト中で最も前に現れたものを採用する。"""
    for t in texts:
        hits = [m for rx in regexes for m in [rx.search(t)] if m]
        if hits:
            return min(hits, key=lambda m: m.start())
    return None


def _fmt_time(h: str, m: str | None) -> str:
    return f"{int(h)}:{(m or '00')}"


def _infer_year(month: int, day: int, today: date) -> int:
    """年の記載がない場合: 今日以降で最も近い日付になる年を採用する。"""
    try:
        cand = date(today.year, month, day)
    except ValueError:
        return today.year
    return today.year if cand >= today else today.year + 1


def _clean(s: str | None) -> str | None:
    if s is None:
        return None
    s = re.sub(r"\s+", " ", s).strip(" 　:：|｜-")
    return s or None


def _page_text(soup: BeautifulSoup) -> str:
    for t in soup(["script", "style", "noscript"]):
        t.decompose()
    text = soup.get_text("\n")
    lines = [re.sub(r"[ \t　]+", " ", ln).strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln)


def _title_from_meta(soup: BeautifulSoup) -> str | None:
    for attrs in ({"property": "og:title"}, {"name": "twitter:title"}):
        tag = soup.find("meta", attrs=attrs)
        if tag and tag.get("content"):
            return _strip_site_suffix(tag["content"])
    h1 = soup.find("h1")
    if h1 and h1.get_text(strip=True):
        return _strip_site_suffix(h1.get_text(" ", strip=True))
    if soup.title and soup.title.string:
        return _strip_site_suffix(soup.title.string)
    return None


def _strip_site_suffix(s: str) -> str | None:
    s = re.split(r"\s*[|｜]\s*(?:ZAIKO|チケットぴあ|ローチケ|ローソンチケット).*$", s)[0]
    s = re.sub(r"\s*[-–]\s*(?:ZAIKO|チケットぴあ|ローチケ).*$", "", s)
    s = re.sub(r"のチケット情報.*$", "", s)
    s = re.sub(r"^[【\[]?チケット[】\]]?\s*", "", s)
    return _clean(s)


# ---------- JSON-LD ----------

def _iter_jsonld_events(soup: BeautifulSoup):
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or tag.get_text() or "")
        except (json.JSONDecodeError, TypeError):
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            obj = stack.pop(0)
            if not isinstance(obj, dict):
                continue
            if "@graph" in obj:
                stack.extend(obj["@graph"])
            t = obj.get("@type")
            types = t if isinstance(t, list) else [t]
            if any(isinstance(x, str) and x.endswith("Event") for x in types):
                yield obj
                for sub in obj.get("subEvent", []) or []:
                    if isinstance(sub, dict):
                        sub["_parent_name"] = obj.get("name")
                        sub.setdefault("name", obj.get("name"))
                        sub.setdefault("location", obj.get("location"))
                        sub["_is_sub"] = True
                        yield sub


ISO_DT_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?")


def _from_jsonld(ev: dict) -> Performance:
    p = Performance()
    if ev.get("name"):
        p.title = _clean(str(ev["name"]))
        p.sources["title"] = "json-ld"
    m = ISO_DT_RE.search(str(ev.get("startDate", "")))
    if m:
        p.date_iso = f"{m[1]}-{m[2]}-{m[3]}"
        p.sources["date"] = "json-ld"
        if m[4]:
            p.start_time = _fmt_time(m[4], m[5])
            p.sources["start_time"] = "json-ld"
    dm = ISO_DT_RE.search(str(ev.get("doorTime", "")))
    if dm and dm[4]:
        p.open_time = _fmt_time(dm[4], dm[5])
        p.sources["open_time"] = "json-ld"
    loc = ev.get("location")
    if isinstance(loc, list):
        loc = loc[0] if loc else None
    if isinstance(loc, dict) and loc.get("name"):
        p.venue = _clean(str(loc["name"]))
        p.sources["venue"] = "json-ld"
    elif isinstance(loc, str):
        p.venue = _clean(loc)
        p.sources["venue"] = "json-ld"
    return p


# ---------- テキスト解析 ----------

def _split_blocks(text: str) -> list[tuple[str | None, str]]:
    """公演ラベル（DAY / NIGHT 等）でテキストを区切る。ラベルが無ければ全文を1ブロック。"""
    lines = text.splitlines()
    blocks: list[tuple[str | None, list[str]]] = []
    for ln in lines:
        m = LABEL_RE.search(ln)
        # ラベルは短い見出し行にあるものだけを区切りとみなす
        if m and len(ln) <= 40:
            label = m.group(0).strip().upper() if m.group(0).isascii() else m.group(0).strip()
            label = re.sub(r"\s+", " ", label)
            if not blocks or blocks[-1][0] != label:
                blocks.append((label, [ln]))
                continue
        if blocks:
            blocks[-1][1].append(ln)
        else:
            blocks.append((None, [ln]))
    labeled = [(lb, "\n".join(ls)) for lb, ls in blocks if lb is not None]
    # 日付や時刻を含む区切りが2つ以上ある場合のみ複数公演とみなす
    meaningful = [b for b in labeled if DATE_RE.search(b[1]) or OPEN_RE.search(b[1])
                  or OPEN_AFTER_RE.search(b[1]) or START_RE.search(b[1])]
    if len(meaningful) >= 2:
        head = "\n".join(ls for lb, ls in [(b[0], "\n".join(b[1])) for b in blocks] if lb is None)
        return [(lb, head + "\n" + body) for lb, body in meaningful]
    return [(None, text)]


def _fill_from_text(p: Performance, text: str, today: date, own_text: str | None = None) -> None:
    """own_text: そのブロック固有の部分（日付・時刻はここを優先）。"""
    scope = own_text or text
    if p.date_iso is None:
        m = DATE_RE.search(scope) or DATE_RE.search(text)
        if m:
            mo, d = int(m["m"]), int(m["d"])
            y = int(m["y"]) if m["y"] else _infer_year(mo, d, today)
            try:
                p.date_iso = date(y, mo, d).isoformat()
                p.weekday_page = m["w"]
                p.holiday_page = bool(re.search(r"祝|休", m.group(0)))
                p.sources["date"] = "text" if m["y"] else "text(年は推定)"
            except ValueError:
                pass
        else:
            m = DATE_NOWD_RE.search(scope) or DATE_NOWD_RE.search(text)
            if m:
                try:
                    p.date_iso = date(int(m["y"]), int(m["m"]), int(m["d"])).isoformat()
                    p.sources["date"] = "text"
                except ValueError:
                    pass
    elif p.weekday_page is None:
        # JSON-LD で日付が取れた場合も、ページ記載の曜日を拾って照合に使う
        y, mo, d = map(int, p.date_iso.split("-"))
        for m in DATE_RE.finditer(text):
            if int(m["m"]) == mo and int(m["d"]) == d:
                p.weekday_page = m["w"]
                p.holiday_page = bool(re.search(r"祝|休", m.group(0)))
                break
    if p.open_time is None:
        m = _first_time((OPEN_RE, OPEN_AFTER_RE), scope, text)
        if m:
            p.open_time = _fmt_time(m.group(1), m.group(2))
            p.sources["open_time"] = "text"
    if p.start_time is None:
        m = _first_time((START_RE, START_AFTER_RE), scope, text)
        if m:
            p.start_time = _fmt_time(m.group(1), m.group(2))
            p.sources["start_time"] = "text"
    if p.venue is None:
        m = VENUE_RE.search(scope) or VENUE_RE.search(text)
        if m:
            v = re.split(r"\s*[（(]?(?:東京都|大阪府|〒|\d{3}-\d{4}|開場|OPEN)", m.group(1))[0]
            p.venue = _clean(v)
            if p.venue:
                p.sources["venue"] = "text"


def pick_hashtag(text: str, title: str | None) -> str | None:
    """ページ内のハッシュタグのうち、イベント名に最も近いものを返す。"""
    tags = []
    for t in HASHTAG_RE.findall(text):
        if t.isdigit() or len(t) < 2:
            continue
        if t not in tags:
            tags.append(t)
    if not tags:
        return None
    if not title:
        return tags[0]
    norm_title = re.sub(r"[\s\W_]+", "", title).lower()

    def score(tag: str) -> float:
        n = tag.lower()
        s = difflib.SequenceMatcher(None, n, norm_title).ratio()
        if n in norm_title:
            s += 0.5
        return s

    best = max(tags, key=score)
    return best if score(best) >= 0.3 else None


# ---------- エントリポイント ----------

def extract(html: str, url: str, today: date | None = None) -> ExtractResult:
    today = today or date.today()
    soup = BeautifulSoup(html, "html.parser")
    meta_title = _title_from_meta(soup)
    jsonld = list(_iter_jsonld_events(soup))
    text = _page_text(soup)

    performances: list[Performance] = []
    subs = [e for e in jsonld if e.get("_is_sub")]
    events = subs or jsonld

    if events:
        for ev in events:
            p = _from_jsonld(ev)
            nm = str(ev.get("name", ""))
            parent = ev.get("_parent_name")
            if parent:
                # 子公演名から親イベント名を除いた残りでラベルを探す（名前自体の NIGHT 等の誤検出防止）
                nm = nm.replace(str(parent), " ")
                p.title = _clean(str(parent))
                p.sources["title"] = "json-ld"
            lm = LABEL_RE.search(nm) or LABEL_RE.search(str(ev.get("description", "")))
            if lm and len(events) > 1:
                p.label = lm.group(0).strip()
            performances.append(p)
        # JSON-LD に無い項目は本文で補完
        blocks = _split_blocks(text)
        for i, p in enumerate(performances):
            own = None
            if len(blocks) == len(performances):
                p.label = p.label or blocks[i][0]
                own = blocks[i][1]
            _fill_from_text(p, text, today, own)
    else:
        for label, body in _split_blocks(text):
            p = Performance(label=label)
            _fill_from_text(p, text, today, body)
            performances.append(p)

    hashtag = pick_hashtag(text, meta_title or (performances[0].title if performances else None))
    for p in performances:
        if p.title is None and meta_title:
            p.title = meta_title
            p.sources["title"] = "meta"
        if p.title and p.label:
            # イベント名にラベルが入り込んでいたら除去（ラベル行で表示するため）
            p.title = _clean(re.sub(rf"\s*(?:[【\[(（]{re.escape(p.label)}[】\])）]|{re.escape(p.label)})\s*$", "", p.title, flags=re.I)) or p.title
        if hashtag:
            p.hashtag = hashtag
            p.sources["hashtag"] = "text"

    if not performances:
        performances = [Performance()]
    return ExtractResult(url=url, site=detect_site(url), performances=performances)
