# カテゴリ詳細: グルメ・レストラン（`gourmet`）

> このカテゴリは**2系統**で更新される。(A)新着グルメニュースはニュース共通エンジンの**foodレーン**（`gourmet`専用のソース・プロンプト・cronを持つ）、(B)飲食店ガイドはエンジン対象外の半自動フロー。エンジン共通の仕様とfoodレーンの詳細は [`../news-pipeline.md`](../news-pipeline.md)（第16章）を参照。

## 新設の経緯

Search Console で「ジャカルタ 中華」「ジャカルタ イタリアン」など、レストラン検索での流入が主力であることが判明したため、従来 `lifestyle`（生活・グルメ）に混在していた飲食店・グルメ記事を独立カテゴリとして切り出した。既存の飲食店ガイド記事（日本食・中華・韓国料理・インドネシア料理・洋食のエリア別ガイド）は本カテゴリに付け替え済み。`lifestyle` 側の経緯は [`./lifestyle.md`](./lifestyle.md) の追記を参照。

## `gourmet` の中身は2系統

| 系統 | 対象 | 更新方式 |
|---|---|---|
| **(A) foodレーンのクローラー** | detikFood RSS + Google Newsグルメ検索RSSから拾う新規オープン・閉店移転・フードイベント等 | **自動**（ニュース共通エンジンの `gourmet` 専用レーン。週2回 月・木 07:30 WIB） |
| **(B) 飲食店ガイド** | レストラン・カフェのエリア別おすすめガイド（`src/data/places/*.yaml` に店舗データを持つ記事） | **半自動**（発見はスクリプト、リサーチ・執筆は人手のClaude Codeセッション） |

## (A) foodレーンのクローラー（自動、2026-08-11実装）

他カテゴリと同じ共通エンジン（`scripts/crawl-and-draft.mjs`）だが、レーン分岐（`resolveLane()`: `--lane=food` > 環境変数`CRAWL_LANE` > デフォルト`news`）でソースとプロンプトが切り替わる。詳細仕様は [`../news-pipeline.md`](../news-pipeline.md) 第16章を一次資料とすること。要点:

1. cron `30 0 * * 1,4`（月・木 07:30 WIB、`.github/workflows/crawl-articles.yml`）で起動し、`fetchAllCandidates('food')` が `foodSources`（detikFood RSS + `FOOD_QUERIES` のGoogle News検索RSS、いずれも `scripts/lib/sources.mjs`）から候補を集約
2. `buildFoodPrompt()` のグルメ専用プロンプト（新規オープン・閉店移転・フードイベント優先、店舗事実はソース記事由来のみ、カテゴリは原則`gourmet`）で Gemini が選定・執筆。紹介店舗は `placeCandidates` として `.crawl-result.json` に出力される（places YAMLへの追加とplaceId付与はローカルで手動）
3. `validateArticle()` 通過分を `draft:true` で書き込み → PR（タイトルに【グルメ】） → プレビュー → Slack承認 → `draft:false` → merge

カテゴリの和名を変える場合の揃え先は他カテゴリと同様に2箇所ある:

- `scripts/crawl-and-draft.mjs` の `CATEGORY_NAMES.gourmet`（生成側。記事フッター表記＋有効slug集合）
- `src/lib/categories.ts` の `categories.gourmet`（サイト表示側。`name`/`description`/`seoTitle`/`color`）

## (B) 飲食店ガイド（半自動）

技術的な仕組み（発見スクリプト・執筆フロー・places連携・メンテナンススクリプト）は移行前の `lifestyle` カテゴリ時代から変更していない。詳細は [`./lifestyle.md`](./lifestyle.md) の「(A) 飲食店ガイド」節をそのまま参照すること（`scripts/discover-restaurants.mjs`・`scripts/lib/places.mjs`・`src/data/places/*.yaml`・`scripts/enrich-places.mjs`・`scripts/validate-places.mjs`・`scripts/check-places-status.mjs` はいずれも変更なし）。

**本カテゴリ新設に伴う唯一の変更点**: 新規に飲食店ガイド記事を書く際、Markdownのfrontmatterに指定する `category` は `lifestyle` ではなく **`gourmet`** にする。既存の飲食店ガイド6本（日本食新規オープン・中華・韓国料理・インドネシア料理・洋食・クバヨランバル/セノパティ日本食）は本カテゴリ新設時に `category: "gourmet"` へ一括付け替え済み。

## 品質チューニングガイド

- **(A) の候補を変える** → `scripts/lib/sources.mjs` の `FOOD_QUERIES`（Google News検索クエリ）と `foodSources`（ソース一覧）を編集。選定基準を変える → `scripts/crawl-and-draft.mjs` の `buildFoodPrompt()` を編集
- **(B) 飲食店ガイドのエリア・料理区分を増やす** → [`./lifestyle.md`](./lifestyle.md) の「品質チューニングガイド」節を参照（`scripts/lib/places.mjs` の `AREAS`/`CUISINE_QUERIES` を編集する場所は変わっていない）
- **カテゴリページの見出し・説明・SEO・色を変える** → `src/lib/categories.ts` の `categories.gourmet`

## 既知の制約・注意

- **(A) のGemini実呼び出しは初回cron実行まで実地未検証**（ローカルにGEMINI_API_KEYがないため。foodプロンプト×responseSchemaの組み合わせは初回実行時のログ・生成物を要監視）
- **workflowのレーン判定はcron文字列の完全一致**（`github.event.schedule == '30 0 * * 1,4'`）に依存。cron式を変更する際は判定側も同時に更新しないと、foodレーンが黙って`news`扱いになる
- **(B) の技術的制約は `lifestyle.md` と共通**: Places APIキーのIP制限、`discover-restaurants.mjs` の既存店舗除外がstaleな件など、[`./lifestyle.md`](./lifestyle.md) の「既知の制約・注意」節がそのまま適用される

## 関連リンク

- 生活情報カテゴリ（分離元）: [`./lifestyle.md`](./lifestyle.md)
- エンジン共通詳細: [`../news-pipeline.md`](../news-pipeline.md)
- 情報源・更新方式の俯瞰: [`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md)
- 飲食店ガイドのセットアップ・実行コマンド: [`../../AUTOMATION.md`](../../AUTOMATION.md)（「レストラン・ディレクトリ自動更新パイプライン（飲食店ガイド）」節）
