# カテゴリ詳細: ビザ・手続き（`visa`）

> エンジン共通の仕様（候補取得〜Gemini選定〜検証〜PR〜Slack承認）は [`../news-pipeline.md`](../news-pipeline.md) を参照。ここでは `visa` 固有の情報源とチューニング箇所だけを扱う。

## TL;DR

| 項目 | 内容 |
|---|---|
| 更新方式 | 自動（ニュース共通エンジン） |
| 頻度 | 1日2回（07:00 / 11:00 WIB） |
| 情報源 | Detik・Antara（一般ニュースRSS）+ Kompas クエリ② |
| 人手の介在 | Slack「✅ 承認して公開」ボタンのみ（本文の修正はしない、公開可否の判断だけ） |

カテゴリ分類は記事ごとに Gemini が本文を見て決める（`scripts/crawl-and-draft.mjs` `draftArticles()`）。下記の情報源は「`visa` の候補が集まりやすい経路」であって、ルールベースの振り分けではない。

## このカテゴリの情報源

### Kompas クエリ②

- `scripts/lib/sources.mjs` の `KOMPAS_QUERIES` ②: **`kitas visa wna jepang`**（KITAS / ビザ / 外国人〔WNA〕/ 日本〔jepang〕）。`fetchKompasViaGoogleNews()` が `site:kompas.com kitas visa wna jepang when:1d` のGoogle News検索RSSとして取得する。
- KITAS/KITAP・就労ビザ・ビザ免除政策など、在留手続き系の候補が集まりやすい。日本人（`jepang`）を明示している唯一のクエリ。

### Detik / Antara（一般ニュースRSS）

- Detik `https://news.detik.com/rss`、Antara `https://www.antaranews.com/rss/terkini.xml`（`sources.mjs` の `id: 'detik'` / `'antara'`）。入国管理・在留制度の変更などもここに流れてくる。

## 処理フロー要約

1. cron（07:00 / 11:00 WIB）で `scripts/crawl-and-draft.mjs` が起動
2. `fetchAllCandidates()` が Detik / Antara / BMKG / Kompas(5クエリ) から候補を集約
3. 既存記事の `sourceUrl` と突き合わせ重複排除（`filterCandidates()`）
4. Gemini が重要候補を最大 `CRAWL_MAX_ARTICLES` 件選定・執筆し、カテゴリ（=`visa` など）を決定
5. `validateArticle()` 通過分を `draft:true` で書き込み → PR → プレビュー → Slack承認 → `draft:false` → merge

エンジン内部の詳細は [`../news-pipeline.md`](../news-pipeline.md)。

## 品質チューニングガイド

**「`visa` の記事の質・量を変えたい」ときに触る場所。**

- **候補を変える** → `scripts/lib/sources.mjs` の `KOMPAS_QUERIES` ②（`kitas visa wna jepang`）を編集。**クエリ設計の考え方**: `googleNewsSiteSearchUrl()` が `site:kompas.com <クエリ> when:1d`（サイト内・直近1日）を組むので、値は**スペース区切りのインドネシア語キーワード**。就労系や特定ビザを厚くしたいなら語を足す（例: `imigrasi izin tinggal`）
- **選定基準・文体を変える** → `scripts/crawl-and-draft.mjs` `draftArticles()` のプロンプト（「# ルール」節と `ARTICLE_SCHEMA_DESCRIPTION`）。全カテゴリ共通のため、`visa` だけ変えたい場合はプロンプトに但し書きを足す
- **カテゴリの和名を変える** → 2箇所（役割が違う。両方揃える）:
  - `scripts/crawl-and-draft.mjs` の `CATEGORY_NAMES.visa`（`'ビザ・手続き'`）… 記事本文フッター表記＋有効slug集合。**生成側**
  - `src/lib/categories.ts` の `categories.visa`（`name` / `description` / `seoTitle` / `color`）… カテゴリページ表示。**サイト表示側**

## 既知の制約・注意

- **`visa` と `regulation` は内容が近接**: ビザ・在留（`visa`）と法規制・行政手続き（`regulation`）は境界が曖昧。最終分類は Gemini 次第で、意図と違うカテゴリに入ることがある
- **Kompas候補の `sourceUrl` はGoogle News仲介リンク**: 実記事URLに直接解決しない（`../../AUTOMATION.md`「既知の制約」）

## 関連リンク

- エンジン共通詳細: [`../news-pipeline.md`](../news-pipeline.md)
- 情報源・更新方式の俯瞰: [`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md)（Kompasクエリ表）
- セットアップ・運用: [`../../AUTOMATION.md`](../../AUTOMATION.md)（「記事自動ドラフト生成パイプライン」節）
</content>
