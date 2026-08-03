# カテゴリ詳細: 社会・政治（`society`）

> エンジン共通の仕様（候補取得〜Gemini選定〜検証〜PR〜Slack承認）は [`../news-pipeline.md`](../news-pipeline.md) を参照。ここでは `society` 固有の事情とチューニング箇所だけを扱う。

## TL;DR

| 項目 | 内容 |
|---|---|
| 更新方式 | 自動（ニュース共通エンジン） |
| 頻度 | 1日2回（07:00 / 11:00 WIB） |
| 情報源 | Detik・Antara（一般ニュースRSS）+ Kompas クエリ①（`safety` と共用）+ Kompas クエリ⑥（`pemprov jakarta kebijakan warga`、**society専用、2026-08-03追加**） |
| 人手の介在 | Slack「✅ 承認して公開」ボタンのみ（本文の修正はしない、公開可否の判断だけ） |

## このカテゴリの情報源

### 専用Kompasクエリを追加済み（2026-08-03、D-1対応）

`scripts/lib/sources.mjs` の `KOMPAS_QUERIES` は次の6本。⑥が `society` 専用クエリとして新規追加された（従来は5本で、`society` 向けに設計されたクエリは存在しなかった）:

| # | クエリ | 主対応 |
|---|---|---|
| ① | `jakarta banjir gempa demo` | safety / **society**（共用） |
| ② | `kitas visa wna jepang` | visa |
| ③ | `bbm subsidi ekonomi` | business |
| ④ | `wisata liburan destinasi` | travel |
| ⑤ | `aturan kebijakan pajak izin` | regulation |
| ⑥ | `pemprov jakarta kebijakan warga` | **society専用（2026-08-03追加）** |

⑥は導入前に実際にGoogle News RSS（`site:kompas.com pemprov jakarta kebijakan warga when:1d`）をfetchして検証済み。実測で57件のユニークな候補（DPRD DKI、Pemprov（州政府）の政策、ジャカルタ行政関連のニュース等）が取得できることを確認した上で採用した。

### 含意

- `society` の記事は、**Detik / Antara の一般ニュースRSS**（`https://news.detik.com/rss` / `https://www.antaranews.com/rss/terkini.xml`）に加えて、上記クエリ⑥のKompas候補からも直接拾えるようになった。
- カテゴリ分類はソースではなく Gemini が本文を見て決めるため（`scripts/crawl-and-draft.mjs` `draftArticles()`）、クエリ⑥はあくまで候補の母数を増やす役割であり、⑥から拾われた候補が必ず`society`に分類されるわけではない（逆に①や一般ニュースRSS由来でも`society`になり得る）。

## 処理フロー要約

1. cron（07:00 / 11:00 WIB）で `scripts/crawl-and-draft.mjs` が起動
2. `fetchAllCandidates()` が Detik / Antara / BMKG / Kompas(6クエリ) から候補を集約
3. 既存記事の `sourceUrl` と突き合わせ重複排除（`filterCandidates()`）
4. Gemini が重要候補を最大 `CRAWL_MAX_ARTICLES` 件選定・執筆し、カテゴリ（=`society` など）を決定
5. `validateArticle()` 通過分を `draft:true` で書き込み → PR → プレビュー → Slack承認 → `draft:false` → merge

エンジン内部の詳細は [`../news-pipeline.md`](../news-pipeline.md)。

## 品質チューニングガイド

**「`society` の記事の質・量を変えたい」ときに触る場所。**

- **候補をさらに増やす** → `scripts/lib/sources.mjs` の `KOMPAS_QUERIES` に別の`society`寄りクエリを追加する。**クエリ設計の考え方**: `googleNewsSiteSearchUrl()` が `site:kompas.com <クエリ> when:1d`（サイト内・直近1日）を組むので、値は**スペース区切りのインドネシア語キーワード**。既存の⑥（`pemprov jakarta kebijakan warga`）以外にも、他クエリと重複しすぎない範囲で語を選べる。追加すれば `fetchKompasViaGoogleNews()` が自動でそのクエリも回す（新クエリのGoogle News RSSを実際にfetchして候補が返ることを確認してから追加すること）
- **選定基準・文体を変える** → `scripts/crawl-and-draft.mjs` `draftArticles()` のプロンプト（「# ルール」節と `ARTICLE_SCHEMA_DESCRIPTION`）。全カテゴリ共通のため、`society` だけ変えたい場合はプロンプトに但し書きを足す
- **カテゴリの和名を変える** → 2箇所（役割が違う。両方揃える）:
  - `scripts/crawl-and-draft.mjs` の `CATEGORY_NAMES.society`（`'社会・政治'`）… 記事本文フッター表記＋有効slug集合。**生成側**
  - `src/lib/categories.ts` の `categories.society`（`name` / `description` / `seoTitle` / `color`）… カテゴリページ表示。**サイト表示側**

## 既知の制約・注意

- **クエリ①の共用**: ①（`jakarta banjir gempa demo`）は `safety` と共用。①を `society` 寄りに書き換えると `safety`（洪水・地震）の候補が減るトレードオフがある
- **クエリ⑥追加後も候補が薄いと感じる場合**: さらなるクエリ追加を検討（上記チューニングガイド参照）

## 関連リンク

- エンジン共通詳細: [`../news-pipeline.md`](../news-pipeline.md)
- 情報源・更新方式の俯瞰: [`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md)（「5. 更新されないもの」に `society` 専用クエリ不在の記載あり）
- セットアップ・運用: [`../../AUTOMATION.md`](../../AUTOMATION.md)（「記事自動ドラフト生成パイプライン」節）
</content>
