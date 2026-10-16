# Event Post Gen

イベントページ（ZAIKO / チケットぴあ / ローチケ）の内容から、X 告知用の文面を生成するツール。
生成した文面はレビューしてから手動で投稿する。

**公開ページ**: https://haloyukka.github.io/event-post-gen/

## 使い方（Web版）

1. イベントURLを入力
2. イベントページを開いて全選択 → コピー → 「ページ内容」に貼り付け
   （PCならページのソース＝HTMLを貼ると、構造化データも使えるので精度が上がる）
3. 「文面を生成」→ 公演ごとのカードで確認・修正 → コピー or 「X で開く」

入力内容はブラウザ内だけで処理し、外部には送信しない。

### URL だけで取得しない理由

GitHub Pages は静的サイトのため、ブラウザの制約（CORS）でチケットサイトのページを直接読み込めない。
外部プロキシを経由させずに確実に動かすため、ページ内容の貼り付け方式にしている。
URL だけで取得したい場合は `python/` の CLI 版を使う。

## 出力形式

```
1. 【DAY】
🔻Next
#ハッシュタグ
イベント名
2026/11/3(火・祝) 12:30 開場
会場名
🎟
https://zaiko.io/event/xxxxx
※注記（曜日不一致時のみ）
```

- 単一公演のときは番号・ラベルなし
- 取得できない項目は `{{イベント名}}` `{{日付}}` `{{曜日}}` `{{開場時間}}` `{{会場名}}` `#{{ハッシュタグ}}`
- ページ記載の曜日と計算結果が違う場合はページ記載を優先し、末尾に注記
- ラベルが無い複数公演は日付（例：`【11/3】`）をラベルにする
- 年の記載が無い日付は「今日以降で最も近い日付」の年を採用

## 構成

```
index.html, css/, js/     Web版（GitHub Pages）
  js/extract.js           抽出（JSON-LD → 本文パターン）
  js/render.js            文面整形・X文字数の概算
  js/holiday.js           日本の祝日判定
tests/                    Web版ロジックのテスト（node --test）
python/                   CLI版（URL から直接取得）
```

## テスト

```bash
npm test                                   # Web版
cd python && pip install -r requirements.txt && python -m pytest   # CLI版
```

## CLI版

```bash
cd python
pip install -r requirements.txt
python -m event_post "https://zaiko.io/event/xxxxx"
python -m event_post "https://t.pia.jp/..." --html saved.html   # 取得できないとき
python -m event_post "https://zaiko.io/event/xxxxx" --json      # Grok Bot 連携用
```

## 今後の拡張候補

- Grok Bot への組み込み（`--json` の抽出結果を入口にする想定）
- 対応サイトの追加、出演者情報などの任意項目
