# カテゴリ詳細: 旅行・お出かけ（`travel`）

> エンジン共通の仕様（候補取得〜Gemini選定〜検証〜PR〜Slack承認）は [`../news-pipeline.md`](../news-pipeline.md) を参照。ここでは `travel` 固有の情報源とチューニング箇所だけを扱う。

## TL;DR

| 項目 | 内容 |
|---|---|
| 更新方式 | 自動（ニュース共通エンジン） |
| 頻度 | 1日2回（07:00 / 11:00 WIB） |
| 情報源 | Detik・Antara（一般ニュースRSS）+ Kompas クエリ④（2026-07-31追加） |
| 人手の介在 | Slack「✅ 承認して公開」ボタンのみ（本文の修正はしない、公開可否の判断だけ） |

カテゴリ分類は記事ごとに Gemini が本文を見て決める（`scripts/crawl-and-draft.mjs` `draftArticles()`）。下記の情報源は「`travel` の候補が集まりやすい経路」であって、ルールベースの振り分けではない。

## このカテゴリの情報源

### Kompas クエリ④

- `scripts/lib/sources.mjs` の `KOMPAS_QUERIES` ④: **`wisata liburan destinasi`**（観光 / 休暇 / 目的地）。`fetchKompasViaGoogleNews()` が `site:kompas.com wisata liburan destinasi when:1d` のGoogle News検索RSSとして取得する。
- **2026-07-31追加**のクエリ（`../../CONTENT-SOURCES.md` のクエリ表に追加日と当日実測件数の記載あり）。バリ・ジョグジャなどの観光・お出かけ候補が集まりやすい。

### Detik / Antara（一般ニュースRSS）

- Detik `https://news.detik.com/rss`、Antara `https://www.antaranews.com/rss/terkini.xml`（`sources.mjs` の `id: 'detik'` / `'antara'`）。祝祭日の交通・観光地の混雑などもここに流れてくる。

## 処理フロー要約

1. cron（07:00 / 11:00 WIB）で `scripts/crawl-and-draft.mjs` が起動
2. `fetchAllCandidates()` が Detik / Antara / BMKG / Kompas(5クエリ) から候補を集約
3. 既存記事の `sourceUrl` と突き合わせ重複排除（`filterCandidates()`）
4. Gemini が重要候補を最大 `CRAWL_MAX_ARTICLES` 件選定・執筆し、カテゴリ（=`travel` など）を決定
5. `validateArticle()` 通過分を `draft:true` で書き込み → PR → プレビュー → Slack承認 → `draft:false` → merge

エンジン内部の詳細は [`../news-pipeline.md`](../news-pipeline.md)。

## 品質チューニングガイド

**「`travel` の記事の質・量を変えたい」ときに触る場所。**

- **候補を変える** → `scripts/lib/sources.mjs` の `KOMPAS_QUERIES` ④（`wisata liburan destinasi`）を編集。**クエリ設計の考え方**: `googleNewsSiteSearchUrl()` が `site:kompas.com <クエリ> when:1d`（サイト内・直近1日）を組むので、値は**スペース区切りのインドネシア語キーワード**。特定地域を厚くしたいなら地名を足す（例: `bali yogyakarta`）
- **選定基準・文体を変える** → `scripts/crawl-and-draft.mjs` `draftArticles()` のプロンプト（「# ルール」節と `ARTICLE_SCHEMA_DESCRIPTION`）。全カテゴリ共通のため、`travel` だけ変えたい場合はプロンプトに但し書きを足す
- **カテゴリの和名を変える** → 2箇所（役割が違う。両方揃える）:
  - `scripts/crawl-and-draft.mjs` の `CATEGORY_NAMES.travel`（`'旅行・お出かけ'`）… 記事本文フッター表記＋有効slug集合。**生成側**
  - `src/lib/categories.ts` の `categories.travel`（`name` / `description` / `seoTitle` / `color`）… カテゴリページ表示。**サイト表示側**

## 既知の制約・注意

- **クエリ④は比較的新しい**（2026-07-31追加）: 追加前の記事は一般ニュースRSS経由でのみ拾われていた
- **Kompas候補の `sourceUrl` はGoogle News仲介リンク**: 実記事URLに直接解決しない（`../../AUTOMATION.md`「既知の制約」）

## 関連リンク

- エンジン共通詳細: [`../news-pipeline.md`](../news-pipeline.md)
- 情報源・更新方式の俯瞰: [`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md)（Kompasクエリ表）
- セットアップ・運用: [`../../AUTOMATION.md`](../../AUTOMATION.md)（「記事自動ドラフト生成パイプライン」節）
</content>
