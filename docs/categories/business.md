# カテゴリ詳細: 経済・ビジネス（`business`）

> エンジン共通の仕様（候補取得〜Gemini選定〜検証〜PR〜Slack承認）は [`../news-pipeline.md`](../news-pipeline.md) を参照。ここでは `business` 固有の情報源とチューニング箇所だけを扱う。

## TL;DR

| 項目 | 内容 |
|---|---|
| 更新方式 | 自動（ニュース共通エンジン） |
| 頻度 | 1日2回（07:00 / 11:00 WIB） |
| 情報源 | Detik・Antara（一般ニュースRSS）+ Kompas クエリ③ |
| 人手の介在 | Slack「✅ 承認して公開」ボタンのみ（本文の修正はしない、公開可否の判断だけ） |

カテゴリ分類は記事ごとに Gemini が本文を見て決める（`scripts/crawl-and-draft.mjs` `draftArticles()`）。下記の情報源は「`business` の候補が集まりやすい経路」であって、ルールベースの振り分けではない。

## このカテゴリの情報源

### Kompas クエリ③

- `scripts/lib/sources.mjs` の `KOMPAS_QUERIES` ③: **`bbm subsidi ekonomi`**（燃料〔BBM〕/ 補助金 / 経済）。`fetchKompasViaGoogleNews()` が `site:kompas.com bbm subsidi ekonomi when:1d` のGoogle News検索RSSとして取得する。
- 燃料補助金・経済政策・物価などの候補が集まりやすい。

### Detik / Antara（一般ニュースRSS）

- Detik `https://news.detik.com/rss`、Antara `https://www.antaranews.com/rss/terkini.xml`。ジャンル不特定の一般ニュースで、ルピア為替・日系企業・市況などの経済記事も流れてくる（`sources.mjs` の `id: 'detik'` / `'antara'`）。

> 注: 記事本文に書いた為替レート等の数値は執筆時点のスナップショットで自動更新されない。サイト上のリアルタイム為替ウィジェット（`src/components/ExchangeRate.astro`）とは別物（[`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md) 「4. サイト上の動的データ」）。

## 処理フロー要約

1. cron（07:00 / 11:00 WIB）で `scripts/crawl-and-draft.mjs` が起動
2. `fetchAllCandidates()` が Detik / Antara / BMKG / Kompas(5クエリ) から候補を集約
3. 既存記事の `sourceUrl` と突き合わせ重複排除（`filterCandidates()`）
4. Gemini が重要候補を最大 `CRAWL_MAX_ARTICLES` 件選定・執筆し、カテゴリ（=`business` など）を決定
5. `validateArticle()` 通過分を `draft:true` で書き込み → PR → プレビュー → Slack承認 → `draft:false` → merge

エンジン内部の詳細は [`../news-pipeline.md`](../news-pipeline.md)。

## 品質チューニングガイド

**「`business` の記事の質・量を変えたい」ときに触る場所。**

- **候補を変える** → `scripts/lib/sources.mjs` の `KOMPAS_QUERIES` ③（`bbm subsidi ekonomi`）を編集。**クエリ設計の考え方**: `googleNewsSiteSearchUrl()` が `site:kompas.com <クエリ> when:1d`（サイト内・直近1日）を組むので、値は**スペース区切りのインドネシア語キーワード**。為替・投資・雇用など別テーマを厚くしたいなら語を足す（例: `rupiah investasi`）
- **選定基準・文体を変える** → `scripts/crawl-and-draft.mjs` `draftArticles()` のプロンプト（「# ルール」節と `ARTICLE_SCHEMA_DESCRIPTION`）。全カテゴリ共通のため、`business` だけ変えたい場合はプロンプトに但し書きを足す
- **カテゴリの和名を変える** → 2箇所（役割が違う。両方揃える）:
  - `scripts/crawl-and-draft.mjs` の `CATEGORY_NAMES.business`（`'経済・ビジネス'`）… 記事本文フッター表記＋有効slug集合。**生成側**
  - `src/lib/categories.ts` の `categories.business`（`name` / `description` / `seoTitle` / `color`）… カテゴリページ表示。**サイト表示側**

## 既知の制約・注意

- **Kompas候補の `sourceUrl` はGoogle News仲介リンク**: 実記事URLに直接解決しない（`sources.mjs` のコメント、`../../AUTOMATION.md`「既知の制約」）
- **本文の数値は陳腐化しうる**: 為替・物価などは執筆時点の値。動的ウィジェットのようには自動更新されない

## 関連リンク

- エンジン共通詳細: [`../news-pipeline.md`](../news-pipeline.md)
- 情報源・更新方式の俯瞰: [`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md)（Kompasクエリ表・動的データ節）
- セットアップ・運用: [`../../AUTOMATION.md`](../../AUTOMATION.md)（「記事自動ドラフト生成パイプライン」節）
</content>
