# カテゴリ詳細: 生活・グルメ（`lifestyle`）

> このカテゴリは**ニュース共通エンジンの対象外**。ニュース6カテゴリとは別系統で動く。エンジン共通の仕様は [`../news-pipeline.md`](../news-pipeline.md)、飲食店ガイドのセットアップ・実行コマンドは [`../../AUTOMATION.md`](../../AUTOMATION.md) の「レストラン・ディレクトリ自動更新パイプライン（飲食店ガイド）」節を参照。

`lifestyle` は中身が2系統に分かれる。更新のされ方がまったく違うので分けて説明する。

| 系統 | 対象 | 更新方式 |
|---|---|---|
| **(A) 飲食店ガイド** | レストラン・カフェ（`mapData` 付き記事） | **半自動**（発見はスクリプト、リサーチ・執筆は人手のClaude Codeセッション） |
| **(B) 飲食店以外** | 日本人学校・病院など | **完全手動**（発見〜執筆〜PRまで全工程を人手） |

## TL;DR

| 項目 | (A) 飲食店ガイド | (B) 飲食店以外 |
|---|---|---|
| 更新方式 | 半自動 | 手動 |
| 頻度 | 不定期（オーナーが `discover-restaurants` を実行した時のみ） | 不定期 |
| 情報源 | Google Places API (New) で候補発見 + Claude CodeセッションでのWeb調査 | 都度の手動調査（自動化なし） |
| 人手の介在 | 発見コマンド実行判断 → WebSearchでの裏取り・執筆 → Slack承認 | 全工程 |

---

## (A) 飲食店ガイド（半自動）

### ステップ1: 発見（`scripts/discover-restaurants.mjs`）

**オーナーのローカルPCで手動実行**する（Places APIキーがIP制限付きのため GitHub Actions では弾かれる。`../../AUTOMATION.md` 参照）。`npm run discover-restaurants`。

1. `loadExistingRestaurants()`（`scripts/lib/existing-mapdata.mjs`）が `src/content/articles/` の全 `.md` の frontmatter を `yaml` でパースし、`mapData` 配列を集約する（既知店舗の名前集合・座標リスト）
2. `AREAS` × `Object.keys(CUISINE_QUERIES)` の全組み合わせで Places API (New) Text Search を実行
3. 既知店舗を除いた新規候補だけを `data/restaurant-candidates.json` に出力（`.gitignore` 済み中間ファイル）

**検索定義（`scripts/lib/places.mjs`）**:

| 定数 | 値 |
|---|---|
| `AREAS` | `Kebayoran Baru` / `Senopati` / `SCBD` / `Kemang` / `Menteng` / `PIK (Pantai Indah Kapuk)`（6エリア） |
| `CUISINE_QUERIES` | `japanese` / `korean` / `chinese` / `indonesian` / `european` / `cafe`（6区分、各値は検索キーワード）。**`content.config.ts` の cuisine enum にある `other` は含まない**（検索キーワードを持たない受け皿カテゴリのため） |
| `FIELD_MASK` | Places APIから取得するフィールド。`places.id` / `displayName` / `formattedAddress` / `location` / `rating` / `userRatingCount` / `priceLevel` / `primaryType` / `businessStatus` / `googleMapsUri` / `nextPageToken` |
| `PRICE_LEVEL_MAP` | Places APIの価格帯 → サイト内区分。`FREE`/`INEXPENSIVE`→`budget`、`MODERATE`→`mid`、`EXPENSIVE`→`high`、`VERY_EXPENSIVE`→`luxury` |

検索クエリ本文は `buildQuery()` が `{cuisineキーワード} in {area}, Jakarta, Indonesia` を組む。1ページ20件・最大3ページ（`searchRestaurants()` の `maxPages`、既定1）。

**既知店舗の判定（`scripts/lib/existing-mapdata.mjs` `isKnownRestaurant()`）** — 明らかな重複を減らす粗いフィルタ:

- **placeId 一致**: `discover-restaurants.mjs` 側で実行内の `seenPlaceIds` によりGoogleのplaceId重複を除去（同じ物理店舗を二重取得しない。※チェーンの別支店は別placeIdなので残す）
- **正規化した店名の完全一致**: `normalizeName()`（小文字化→NFKD→発音区別符号除去→英数字以外を空白→trim）した名前が既知集合にある
- **座標の近接**: 候補の緯度経度が既知店舗と `NEARBY_METERS`（**60m**）以内（`haversineMeters()`）

出力 `data/restaurant-candidates.json` は `{ generatedAt, candidates, failures }` 形式。各候補は `normalizePlace()` の結果（`placeId` / `name` / `formattedAddress` / `lat` / `lng` / `rating` / `userRatingCount` / `priceRange` / `businessStatus` / `googleMapsUri` / `googleMapsQuery` / `cuisine` / `area`）。

### ステップ2: リサーチ・執筆（Claude Codeセッション、人手）

`data/restaurant-candidates.json` を Claude Code に渡し、対話的に執筆する（Gemini の検索グラウンディングは無料枠外のため使わない。`../../AUTOMATION.md` 参照）。

- 各店舗を **WebSearch/WebFetch** で調査（営業時間・ハラール・酒類・電話番号・メニュー価格など）
- **確認できない項目は「不明／要確認」と明示する規約**。具体的には `content.config.ts` の `mapData` スキーマの enum で、`halal` と `servesAlcohol` は `'yes' | 'no' | 'unverified'` を取り、**裏が取れないものは `'unverified'`**（スキーマ上の既定値も `'unverified'`）にする。憶測で `yes`/`no` を書かない
- 既存ガイドと同じ構成で `draft: true` の Markdown を作成し**PRを作る**（直接 `main` にcommitしない）

`mapData` の各エントリのスキーマ（`src/content.config.ts`）:

| フィールド | 型 | 既定/制約 |
|---|---|---|
| `name` | string | 必須 |
| `nameEn` | string | 任意 |
| `area` | string | 必須（表示・地図のエリアグループに使用） |
| `cuisine` | enum | `japanese`/`korean`/`chinese`/`indonesian`/`european`/`cafe`/**`other`** |
| `priceRange` | enum | `budget`/`mid`/`high`/`luxury` |
| `googleMapsQuery` | string | 必須（地図の「Googleマップで開く」リンク生成に使用） |
| `lat` / `lng` | number | 任意（重複判定・地図ピンに使用） |
| `isChain` | boolean | 既定 `false`（`true` は地図から除外される） |
| `halal` | enum | `yes`/`no`/`unverified`（既定 `unverified`） |
| `servesAlcohol` | enum | `yes`/`no`/`unverified`（既定 `unverified`） |

### ステップ3: 公開

以降はニュースと共通。プレビュー確認 → Slack「✅ 承認して公開」ボタン → `draft:false` → merge（[`../news-pipeline.md`](../news-pipeline.md) 第10〜11章、[`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md) 「3-4」）。

---

## (B) 飲食店以外（完全手動）

日本人学校・病院・生活手続きなど、飲食店ガイド以外の `lifestyle` 記事には**発見の仕組みも半自動パイプラインも無い**。テーマ選定・調査・執筆・PR作成まですべて人手で行う（`../../CONTENT-SOURCES.md` 「5. 更新されないもの」）。`mapData` を持たない通常記事として書く。

---

## 品質チューニングガイド

### 対象エリア / 料理区分を増やす

- **エリアを足す** → `scripts/lib/places.mjs` の `AREAS` 配列に文字列を追加（`buildQuery()` がそのまま `... in {area}, Jakarta, Indonesia` に使う）
- **料理区分を足す** → `scripts/lib/places.mjs` の `CUISINE_QUERIES` にキー（cuisine slug）と検索キーワードを追加。**ただし cuisine を新設する場合は下記のスキーマ影響範囲に注意**

### `mapData` スキーマを変えるときの影響範囲

スキーマ（`src/content.config.ts`）はサイトの地図表示と直結している。特に注意すべきは、**cuisine の設定（ラベル/色/アイコン）と価格記号が2箇所に重複定義されている**こと（`grep` で確認済み）:

- `src/lib/cuisines.ts` の `cuisineConfig` / `priceLabels` … **サーバー描画側**。`/map` ページのエリア別一覧パネル（`src/pages/map.astro`）が import して使う
- `src/components/RestaurantMap.astro` の inline script 内の `var cuisineConfig` / `var priceLabels` … **地図本体側**（ピンと絞り込みボタン）。これは `cuisines.ts` を **import せず独立にハードコードした別コピー**で、`cuisineConfig[r.cuisine] || cuisineConfig.other` のフォールバックもこの内部コピーを指す

したがって:

- **cuisine enum に値を追加**する場合、揃える必要があるのは:
  1. `src/content.config.ts`（`mapData` の `cuisine` enum）… 必須。未追加の値を使うと Astro のコンテンツ collection のスキーマ検証（zod enum）でビルドが失敗する
  2. `src/lib/cuisines.ts` の `cuisineConfig`（`label`/`color`/`icon`）… `/map` のエリア別一覧パネルに反映
  3. `src/components/RestaurantMap.astro` の内部 `var cuisineConfig`（同じフィールド）… **地図のピンと絞り込みボタンに反映。ここを忘れると地図側だけ `other`（その他）表示にフォールバックする**
  4. 発見でも拾いたいなら `src/lib/places.mjs` の `CUISINE_QUERIES`
- **priceRange enum を変える**場合 → `src/lib/cuisines.ts` の `priceLabels` と `src/components/RestaurantMap.astro` 内部の `priceLabels`（`budget`→`¥` … `luxury`→`¥¥¥¥`）の**両方**を揃える
- **`mapData` のフィールドを削除/改名**する場合、地図が壊れる箇所:
  - `src/pages/map.astro` … `!data.draft && !!data.mapData` の記事を集め、`isChain` を除外して `area` でグループ化（全店舗マップ `/map`）
  - `src/pages/category/[slug].astro` … `lifestyle` カテゴリページで `mapData` を集約（`isChain` 除外）し `RestaurantMap` に渡す
  - `src/components/RestaurantMap.astro` … `cuisine`（絞り込み・内部 `cuisineConfig` 参照）/ `servesAlcohol`（酒類フィルタ、`'yes'` 判定）/ `priceRange`（内部 `priceLabels`）/ `googleMapsQuery`（マップリンク）/ `nameEn` / `area` / `name` を直接参照
- 要するに **cuisine enum追加は「`content.config.ts` + `cuisines.ts` + `RestaurantMap.astro` の内部コピー（+ 必要なら `places.mjs`）」**。cuisine・価格の設定は2箇所にコピーがある点を忘れない。フィールド改名は上記3コンポーネントの参照名を同時に直す。

### 執筆方針を変える

執筆はエンジンではなく Claude Code セッションでの人手作業なので、コード変更ではなく**依頼プロンプト側**で調整する（例: 裏取り項目の追加、構成の変更）。`halal`/`servesAlcohol` の `unverified` 規約は維持する。

## 既知の制約・注意

- **Places APIキーはIP制限付きでローカル専用**: 発見ステップは CI では動かない（`../../AUTOMATION.md`）
- **重複判定は粗いフィルタ**: 名前正規化一致 or 座標60m以内で「既知」とみなすだけで、完璧な同定は狙っていない（`existing-mapdata.mjs` のコメント）
- **`isChain: true` は地図に出ない**: `map.astro` / `category/[slug].astro` の両方で除外される
- **(B) 飲食店以外は完全手動**: 自動化の予定はスコープ外

## 関連リンク

- 飲食店ガイドのセットアップ・実行コマンド: [`../../AUTOMATION.md`](../../AUTOMATION.md)（「レストラン・ディレクトリ自動更新パイプライン（飲食店ガイド）」節）
- 情報源・更新方式の俯瞰: [`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md)（「3-4」半自動経路、「5」更新されないもの）
- 公開フロー（Slack承認）の詳細: [`../news-pipeline.md`](../news-pipeline.md)（第10〜11章）
</content>
