# カテゴリ詳細: 社会・政治（`society`）

> エンジン共通の仕様（候補取得〜Gemini選定〜検証〜PR〜Slack承認）は [`../news-pipeline.md`](../news-pipeline.md) を参照。ここでは `society` 固有の事情とチューニング箇所だけを扱う。

## TL;DR

| 項目 | 内容 |
|---|---|
| 更新方式 | 自動（ニュース共通エンジン） |
| 頻度 | 1日2回（07:00 / 11:00 WIB） |
| 情報源 | Detik・Antara（一般ニュースRSS）+ Kompas クエリ①（`safety` と共用）。**専用Kompasクエリは無い** |
| 人手の介在 | Slack「✅ 承認して公開」ボタンのみ（本文の修正はしない、公開可否の判断だけ） |

## このカテゴリの情報源

### 専用Kompasクエリが無い（重要）

`scripts/lib/sources.mjs` の `KOMPAS_QUERIES`（5本）に、`society` 向けに設計されたクエリは**存在しない**。実測でも `KOMPAS_QUERIES` は次の5本のみ:

| # | クエリ | 主対応 |
|---|---|---|
| ① | `jakarta banjir gempa demo` | safety / **society**（共用） |
| ② | `kitas visa wna jepang` | visa |
| ③ | `bbm subsidi ekonomi` | business |
| ④ | `wisata liburan destinasi` | travel |
| ⑤ | `aturan kebijakan pajak izin` | regulation |

`society` に一番近いのは①（`jakarta banjir gempa demo`）に含まれる `demo`（デモ）程度で、これは `safety` と共用のクエリである。

### 含意

- `society` の記事は、実質的に **Detik / Antara の一般ニュースRSS**（`https://news.detik.com/rss` / `https://www.antaranews.com/rss/terkini.xml`）に流れてくる社会・政治ニュースを Gemini が拾い、`society` と分類することで成立している。
- カテゴリ分類はソースではなく Gemini が本文を見て決めるため（`scripts/crawl-and-draft.mjs` `draftArticles()`）、専用クエリが無くても `society` 記事は生成されうる。ただし Kompas由来の候補が他カテゴリより構造的に薄いため、**候補の母数を意図的に増やしたいなら専用クエリの追加が有効**（下記チューニング参照）。

## 処理フロー要約

1. cron（07:00 / 11:00 WIB）で `scripts/crawl-and-draft.mjs` が起動
2. `fetchAllCandidates()` が Detik / Antara / BMKG / Kompas(5クエリ) から候補を集約
3. 既存記事の `sourceUrl` と突き合わせ重複排除（`filterCandidates()`）
4. Gemini が重要候補を最大 `CRAWL_MAX_ARTICLES` 件選定・執筆し、カテゴリ（=`society` など）を決定
5. `validateArticle()` 通過分を `draft:true` で書き込み → PR → プレビュー → Slack承認 → `draft:false` → merge

エンジン内部の詳細は [`../news-pipeline.md`](../news-pipeline.md)。

## 品質チューニングガイド

**「`society` の記事の質・量を変えたい」ときに触る場所。**

- **候補を増やす（最も効くのはここ）** → `scripts/lib/sources.mjs` の `KOMPAS_QUERIES` に **`society` 専用クエリを1本追加**する。**クエリ設計の考え方**: `googleNewsSiteSearchUrl()` が `site:kompas.com <クエリ> when:1d`（サイト内・直近1日）を組むので、値は**スペース区切りのインドネシア語キーワード**。社会・政治系なら例えば `politik pemerintah kebijakan sosial` のような語を、他クエリと重複しすぎない範囲で選ぶ。追加すれば `fetchKompasViaGoogleNews()` が自動でそのクエリも回す
- **選定基準・文体を変える** → `scripts/crawl-and-draft.mjs` `draftArticles()` のプロンプト（「# ルール」節と `ARTICLE_SCHEMA_DESCRIPTION`）。全カテゴリ共通のため、`society` だけ変えたい場合はプロンプトに但し書きを足す
- **カテゴリの和名を変える** → 2箇所（役割が違う。両方揃える）:
  - `scripts/crawl-and-draft.mjs` の `CATEGORY_NAMES.society`（`'社会・政治'`）… 記事本文フッター表記＋有効slug集合。**生成側**
  - `src/lib/categories.ts` の `categories.society`（`name` / `description` / `seoTitle` / `color`）… カテゴリページ表示。**サイト表示側**

## 既知の制約・注意

- **専用の情報源が無い**: 上記の通り Kompas専用クエリが無く、`society` は一般ニュースRSS頼み。候補が薄く感じるときはクエリ追加を検討
- **クエリ①の共用**: ①（`jakarta banjir gempa demo`）は `safety` と共用。①を `society` 寄りに書き換えると `safety`（洪水・地震）の候補が減るトレードオフがある

## 関連リンク

- エンジン共通詳細: [`../news-pipeline.md`](../news-pipeline.md)
- 情報源・更新方式の俯瞰: [`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md)（「5. 更新されないもの」に `society` 専用クエリ不在の記載あり）
- セットアップ・運用: [`../../AUTOMATION.md`](../../AUTOMATION.md)（「記事自動ドラフト生成パイプライン」節）
</content>
