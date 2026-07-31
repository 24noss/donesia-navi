# カテゴリ詳細: 安全・災害（`safety`）

> エンジン共通の仕様（候補取得〜Gemini選定〜検証〜PR〜Slack承認）は [`../news-pipeline.md`](../news-pipeline.md) を参照。ここでは `safety` 固有の情報源とチューニング箇所だけを扱う。

## TL;DR

| 項目 | 内容 |
|---|---|
| 更新方式 | 自動（ニュース共通エンジン） |
| 頻度 | 1日2回（07:00 / 11:00 WIB） |
| 情報源 | Detik・Antara（一般ニュースRSS）+ **BMKG地震API** + Kompas クエリ①（`society` と共用） |
| 人手の介在 | Slack「✅ 承認して公開」ボタンのみ（本文の修正はしない、公開可否の判断だけ） |

このカテゴリの分類自体は、他カテゴリと同様に記事ごとに Gemini が本文を見て決定する（`scripts/crawl-and-draft.mjs` の `draftArticles()`）。下記の情報源は「`safety` の候補が集まりやすい経路」であって、ルールベースの振り分けではない。

## このカテゴリの情報源

### 1. BMKG地震API（このカテゴリ特有）

`scripts/lib/sources.mjs` の `fetchBmkgEarthquakes()`。インドネシア気象・気候・地球物理庁（BMKG）の地震データを直接取得する。

- **2エンドポイント**を `Promise.allSettled` で取得:
  - `https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json` — 最新1件（`Infogempa.gempa`）
  - `https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json` — 直近リスト（`Infogempa.gempa` が配列）
- 両者を結合し、`DateTime` をキーに重複排除（`seen` Set）
- 各地震を候補オブジェクトに変換:
  - `title`: `地震 M{Magnitude} - {Wilayah}`
  - `snippet`: 発生日時（`Tanggal` `Jam` WIB）・震源の深さ（`Kedalaman`）・津波の可能性（`Potensi`）・有感地域（`Dirasakan`）を組み立てた文
  - **`link`（一意化ハック）**: `https://www.bmkg.go.id/gempabumi/gempa-dirasakan.bmkg#{encodeURIComponent(DateTime)}`。BMKGはイベント別ページを持たないため、固定URLだと全地震が同一リンク扱いになり、`filterCandidates()` の重複排除（`link` 一致）で誤って1件に潰れてしまう。これを避けるため `DateTime` をフラグメント（`#...`）に付けてイベントごとに一意なURLにしている
  - `source`: `'BMKG'`

### 2. Detik / Antara（一般ニュースRSS）

- Detik `https://news.detik.com/rss`、Antara `https://www.antaranews.com/rss/terkini.xml`。ジャンル不特定の一般ニュースで、災害・治安の記事も流れてくる（`sources.mjs` の `id: 'detik'` / `'antara'`）。

### 3. Kompas クエリ①（`society` と共用）

- `KOMPAS_QUERIES` の①: **`jakarta banjir gempa demo`**（ジャカルタ / 洪水 / 地震 / デモ）。`fetchKompasViaGoogleNews()` が `site:kompas.com jakarta banjir gempa demo when:1d` のGoogle News検索RSSとして取得する。
- このクエリは洪水・地震・デモを含み、**`safety` と `society` の両方にまたがる**（`society` に専用クエリは無い。[`society.md`](./society.md) 参照）。

## 処理フロー要約

1. cron（07:00 / 11:00 WIB）で `scripts/crawl-and-draft.mjs` が起動
2. `fetchAllCandidates()` が Detik / Antara / BMKG / Kompas(5クエリ) から候補を集約
3. 既存記事の `sourceUrl` と突き合わせ重複排除（`filterCandidates()`）
4. Gemini が在住日本人向けに重要な候補を最大 `CRAWL_MAX_ARTICLES` 件選定・執筆し、カテゴリ（=`safety` など）も決定
5. `validateArticle()` 通過分を `draft:true` で書き込み → PR → プレビュー → Slack承認 → `draft:false` → merge

エンジン内部の詳細は [`../news-pipeline.md`](../news-pipeline.md)。

## 品質チューニングガイド

**「`safety` の記事の質を変えたい」ときに触る場所。**

- **候補（拾ってくる元ネタ）を変える**
  - 地震以外の防災（火山・津波警報・気象警報など）を拾いたい → 現状 BMKG は地震APIのみ。新エンドポイントを足すには `scripts/lib/sources.mjs` に `fetch*` 関数を追加し `sources` 配列に登録（[`../news-pipeline.md`](../news-pipeline.md) 第3章）
  - Kompas経由の候補を増やす/絞る → `scripts/lib/sources.mjs` の `KOMPAS_QUERIES` ①（`jakarta banjir gempa demo`）を編集。**クエリ設計の考え方**: `googleNewsSiteSearchUrl()` が `site:kompas.com <クエリ> when:1d` を組むので、値は「サイト内・直近1日」を前提にした**スペース区切りキーワード**にする。①は `society` と共用なので、片方に寄せると他方の候補が減る点に注意
  - BMKG候補の見出し・要約の作り方を変える → `fetchBmkgEarthquakes()` の `title` / `snippet` 生成部
- **選定基準・文体を変える** → `scripts/crawl-and-draft.mjs` `draftArticles()` のプロンプト（「# ルール」節と `ARTICLE_SCHEMA_DESCRIPTION`）。ここは全カテゴリ共通なので、`safety` だけを変えたい場合はプロンプトにカテゴリ別の但し書きを足す形になる
- **カテゴリの和名を変える** → 2箇所あり役割が違う。両方を揃える:
  - `scripts/crawl-and-draft.mjs` の `CATEGORY_NAMES.safety`（`'安全・災害'`）… 記事本文フッターの「カテゴリ:」表記と、有効slug集合（`CATEGORY_SET`）に使う。**生成側**
  - `src/lib/categories.ts` の `categories.safety`（`name` / `description` / `seoTitle` / `color`）… カテゴリページの見出し・説明・SEO・色。**サイト表示側**

## 既知の制約・注意

- **BMKGは地震のみ**: 火山・気象などの他災害は現状カバーしていない（一般ニュースRSSに流れてくれば拾える程度）
- **BMKGの `sourceUrl` はフラグメント付きURL**: `...gempa-dirasakan.bmkg#{DateTime}` で、個別地震の専用ページに解決するわけではない（重複排除のための一意化目的）
- **クエリ①の共用**: `safety` と `society` で同じKompasクエリを使うため、実際にどちらのカテゴリになるかは Gemini 次第

## 関連リンク

- エンジン共通詳細: [`../news-pipeline.md`](../news-pipeline.md)
- 情報源・更新方式の俯瞰: [`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md)（BMKGの説明・Kompasクエリ表）
- セットアップ・運用: [`../../AUTOMATION.md`](../../AUTOMATION.md)（「記事自動ドラフト生成パイプライン」節）
</content>
