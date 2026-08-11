# カテゴリ詳細: 生活情報（`lifestyle`）

> このカテゴリは**ニュース共通エンジンの対象外**。ニュース6カテゴリとは別系統で動く。エンジン共通の仕様は [`../news-pipeline.md`](../news-pipeline.md)、飲食店ガイドのセットアップ・実行コマンドは [`../../AUTOMATION.md`](../../AUTOMATION.md) の「レストラン・ディレクトリ自動更新パイプライン（飲食店ガイド）」節を参照。

> **2026-08: `gourmet` カテゴリ新設に伴いグルメ・飲食店を分離。** Search Consoleで「ジャカルタ 中華」「ジャカルタ イタリアン」等のレストラン検索流入が主力と判明したため、従来ここに混在していた飲食店ガイド記事（日本食・中華・韓国料理・インドネシア料理・洋食のエリア別ガイド）を新設の [`gourmet`（グルメ・レストラン）](./gourmet.md) カテゴリへ付け替えた。`category: "lifestyle"` だった6本の記事は `category: "gourmet"` に変更済み。`lifestyle` の名称も「生活・グルメ」から「生活情報」に変更し、以後は日本人学校・病院・住居・買い物・物価など**非飲食**の生活情報に専念する。下記「(A) 飲食店ガイド」節が説明する半自動パイプライン自体（発見スクリプト・places連携）は変更していないが、**新規に飲食店ガイド記事を書く場合は `category: "gourmet"` を指定する**（詳細は [`gourmet.md`](./gourmet.md) 参照）。

`lifestyle` は中身が2系統に分かれる。更新のされ方がまったく違うので分けて説明する。

| 系統 | 対象 | 更新方式 |
|---|---|---|
| **(A) 飲食店ガイド** | レストラン・カフェ（`src/data/places/*.yaml` に店舗データを持つ記事） | **半自動**（発見はスクリプト、リサーチ・執筆は人手のClaude Codeセッション） |
| **(B) 飲食店以外** | 日本人学校・病院など | **完全手動**（発見〜執筆〜PRまで全工程を人手） |

> **2026-08: places基盤（C-0）に移行済み。** 店舗データは記事frontmatterの `mapData` ではなく、独立コレクション `src/data/places/*.yaml`（1店舗=1ファイル）で管理する。記事側は店舗情報を持たず、place側の `sourceArticles`（紹介記事のid配列）で「どの記事がこの店舗を紹介したか」を逆参照する。マップ・カテゴリのレストランタブ・記事内ミニマップ・新設の店舗詳細ページ（`/places/[slug]/`）はすべて `src/lib/places.ts` の `getVisiblePlaces()` / `placeToMapPoint()` を経由してplacesコレクションから描画される。以下の説明で `mapData` に言及している箇所は、移行前の設計として歴史的経緯を示す場合を除き、実質的に `src/data/places/*.yaml` に読み替えること。

## TL;DR

| 項目 | (A) 飲食店ガイド | (B) 飲食店以外 |
|---|---|---|
| 更新方式 | 半自動 | 手動 |
| 頻度 | 不定期（オーナーが `discover-restaurants` を実行した時のみ） | 不定期 |
| 情報源 | Google Places API (New) で候補発見 + Claude CodeセッションでのWeb調査 | 都度の手動調査（自動化なし） |
| 人手の介在 | 発見コマンド実行判断 → WebSearchでの裏取り・執筆 → Slack承認 | 全工程 |

---

## (A) 飲食店ガイド（半自動）

> **2026-08〜: このパイプラインが生成する記事の `category` は `gourmet`。** 以下のステップ説明は移行前と同じ仕組みだが、frontmatterの `category` フィールドだけは `lifestyle` ではなく `gourmet` を指定する（[`gourmet.md`](./gourmet.md) 参照）。

### ステップ1: 発見（`scripts/discover-restaurants.mjs`）

**オーナーのローカルPCで手動実行**する（Places APIキーがIP制限付きのため GitHub Actions では弾かれる。`../../AUTOMATION.md` 参照）。`npm run discover-restaurants`。

1. `loadExistingRestaurants()`（`scripts/lib/existing-mapdata.mjs`）が `src/content/articles/` の全 `.md` の frontmatter を `yaml` でパースし、`mapData` 配列を集約する（既知店舗の名前集合・座標リスト）
2. `AREAS` × `Object.keys(CUISINE_QUERIES)` の全組み合わせで Places API (New) Text Search を実行
3. 既知店舗を除いた新規候補だけを `data/restaurant-candidates.json` に出力（`.gitignore` 済み中間ファイル）

> **⚠️ 既知の不整合（要フォローアップ）:** places基盤への移行（C-0）で記事frontmatterから `mapData` を撤去したため、上記1.の `loadExistingRestaurants()` は現状 **常に空集合を返す**（`src/content/articles/*.md` にはもう `mapData` が存在しないため）。つまり `isKnownRestaurant()` による重複除外が事実上無効化されており、`discover-restaurants.mjs` は既存店舗も含めて全件を新規候補として出力してしまう。本来は `src/data/places/*.yaml` を読むように `existing-mapdata.mjs` 側を更新する必要があるが、同ファイルは本places基盤タスクの対象外（別作業と競合するため変更禁止）としたため未対応のまま残っている。次にdiscoverを実行する担当者は、この既知の不整合を踏まえて候補リストを重複込みで確認すること（roadmapのC-1「レストラン: 既存マップをplaces起点に」で対応予定）。

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
- **確認できない項目は「不明／要確認」と明示する規約**。具体的には `content.config.ts` の `places` コレクションschemaの enum で、`halal` と `servesAlcohol` は `'yes' | 'no' | 'unverified'` を取り、**裏が取れないものは `'unverified'`**（スキーマ上の既定値も `'unverified'`）にする。憶測で `yes`/`no` を書かない
- 既存ガイドと同じ構成で `draft: true` の Markdown を作成する。**店舗情報は記事frontmatterには書かず**、店舗ごとに `src/data/places/<slug>.yaml`（1店舗=1ファイル。slugは英語名のローマ字/kebab-case）を新規作成し、`sourceArticles` にこの記事のid（ファイル名から `.md` を除いたもの）を追加する。同じ店舗が既に別記事から参照されている場合（店名正規化一致 or 座標60m以内）は新規ファイルを作らず、既存placeの `sourceArticles` に記事idを追記する
- 記事・place双方ができたら**PRを作る**（直接 `main` にcommitしない）

placeの各エントリのスキーマ（`src/content.config.ts` の `places` コレクション）:

| フィールド | 型 | 既定/制約 |
|---|---|---|
| `name` | string | 必須（日本語優先の表示名） |
| `nameEn` | string | 任意 |
| `category` | enum | `restaurant`/`hospital`/`school`/`shop`/`office`/`spot` |
| `area` | enum | ジャカルタの正規化済み日本語エリア名18種（`content.config.ts` に列挙。自由記述不可。表記ゆれ対策のA-4はこれで恒久化） |
| `cuisine` | enum | `japanese`/`korean`/`chinese`/`indonesian`/`european`/`cafe`/**`other`**（任意。飲食店以外のcategoryでは省略） |
| `priceRange` | enum | `budget`/`mid`/`high`/`luxury`（任意） |
| `lat` / `lng` | number | 必須（重複判定・地図ピンに使用。CIの`validate-places.mjs`がジャカルタ首都圏bbox内かを検証） |
| `googleMapsQuery` | string | 必須（地図の「Googleマップで開く」リンク生成に使用） |
| `placeId` | string | 任意（`scripts/enrich-places.mjs` が後から自動付与） |
| `isChain` | boolean | 既定 `false`（`true` は地図から除外される） |
| `status` | enum | `open`/`closed`/`unverified`（既定 `open`。`scripts/check-places-status.mjs` が更新） |
| `verifiedAt` | date | 任意（最終確認日。記事執筆時点ならその記事の `pubDate` を入れる） |
| `halal` | enum | `yes`/`no`/`unverified`（既定 `unverified`） |
| `servesAlcohol` | enum | `yes`/`no`/`unverified`（既定 `unverified`） |
| `sourceArticles` | string[] | 既定 `[]`。この店舗を紹介した記事idの配列（0件=記事に紐付かない静的place） |
| `description` | string | 任意（店舗詳細ページ用の一言） |

### ステップ3: 公開

記事の公開フローはニュースと共通（プレビュー確認 → Slack「✅ 承認して公開」ボタン → `draft:false` → merge。[`../news-pipeline.md`](../news-pipeline.md) 第10〜11章、[`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md) 「3-4」）。ただしplacesの可視性は記事の `draft` フラグと独立に**`src/lib/places.ts` の `getVisiblePlaces()`** が判定する（`status !== 'closed'` かつ、`sourceArticles` が空、またはいずれかの参照記事が実在し非draftであること。draftプレビュービルドではdraft記事由来のplaceも表示される）。つまり、記事がdraftのままでも `src/data/places/*.yaml` 自体はmainにmergeされていれば良く、記事がdraft解除されて初めてそのplaceがマップ・詳細ページに公開表示される。

### 店舗データのメンテナンス用スクリプト（`src/data/places/*.yaml` 共通）

| スクリプト | 用途 | 実行方法 |
|---|---|---|
| `scripts/enrich-places.mjs` | `placeId` が未設定のplacesについて Places API (New) Text Search で候補を検索し、`placeId` を書き戻す。検索結果の座標が既存値から500m以上ずれる場合は誤検出の疑いがあるため書き換えず警告のみ出す（500m未満ならlat/lngもより正確な検索結果へ更新する） | `node scripts/enrich-places.mjs`（ローカルPC限定。理由は発見ステップと同じくAPIキーのIP制限） |
| `scripts/validate-places.mjs` | 全placesのスキーマ適合・ジャカルタ首都圏bbox内・`placeId`重複なし・座標60m以内の重複（店名一致 or `placeId`一致の場合のみ違反扱い、店名が異なる近接ケースは警告に留める）を検証。違反があれば`exit 1` | `node scripts/validate-places.mjs`（CIでも実行可能。APIキー不要） |
| `scripts/check-places-status.mjs` | `placeId` を持つplacesの営業状態をPlaces Details APIで照会。`CLOSED_PERMANENTLY`→`status: closed`+`verifiedAt`更新、`OPERATIONAL`→`verifiedAt`のみ更新。**既定はレポートのみ**（yaml書き込みなし）、`--write` を付けたときだけ実際に書き込む | `node scripts/check-places-status.mjs`（レポートのみ）/ `node scripts/check-places-status.mjs --write`（書き込み。月次想定。ローカルPC限定） |

---

## (B) 飲食店以外（完全手動）

日本人学校・病院・生活手続きなど、飲食店ガイド以外の `lifestyle` 記事には**発見の仕組みも半自動パイプラインも無い**。テーマ選定・調査・執筆・PR作成まですべて人手で行う（`../../CONTENT-SOURCES.md` 「5. 更新されないもの」）。店舗・施設データを持たない通常記事として書く（`src/data/places/*.yaml` に紐付けない）。ただし病院・学校など地図に載せたい施設が出てきた場合は、`category: 'hospital'` / `category: 'school'` のplaceを手動で追加すれば「医療」「教育」レイヤ（roadmap C-1）の土台になる。

---

## 品質チューニングガイド

### 対象エリア / 料理区分を増やす

- **エリアを足す** → `scripts/lib/places.mjs` の `AREAS` 配列に文字列を追加（`buildQuery()` がそのまま `... in {area}, Jakarta, Indonesia` に使う）
- **料理区分を足す** → `scripts/lib/places.mjs` の `CUISINE_QUERIES` にキー（cuisine slug）と検索キーワードを追加。**ただし cuisine を新設する場合は下記のスキーマ影響範囲に注意**

### placesスキーマを変えるときの影響範囲

スキーマ（`src/content.config.ts` の `places` コレクション）はサイトの地図表示と直結している。**cuisine の設定（ラベル/色/アイコン）と価格記号は `src/lib/cuisines.ts` の `cuisineConfig` / `priceLabels` を唯一の定義元に統一済み**:

- `src/lib/cuisines.ts` の `cuisineConfig` / `priceLabels` … **唯一の定義元**。`/map` ページのエリア別一覧パネル（`src/pages/map.astro`）・店舗詳細ページ（`src/pages/places/[slug].astro`）が直接 import して使うほか、`src/components/RestaurantMap.astro` の Astro frontmatter（サーバー側）でも import し、`<script is:inline define:vars={{ ..., cuisineConfig, priceLabels }}>` でクライアントJSにそのまま渡している（地図本体のピン・絞り込みボタンもこの値を参照。`cuisineConfig[r.cuisine] || cuisineConfig.other` のフォールバックも同じオブジェクトを指す）
- `src/lib/places.ts` … placesコレクションを地図・詳細ページ向けに変換する共通ロジックの唯一の定義元。`getVisiblePlaces(places, articles)`（可視性判定: `status`/`sourceArticles`/draftプレビュー）と `placeToMapPoint(place)`（`RestaurantMap` の `restaurants` prop形式への変換）、`placeCategoryLabels`（`category` enumの日本語ラベル）を提供する

したがって:

- **cuisine enum に値を追加**する場合、揃える必要があるのは:
  1. `src/content.config.ts`（`places` の `cuisine` enum）… 必須。未追加の値を使うと Astro のコンテンツ collection のスキーマ検証（zod enum）でビルドが失敗する
  2. `src/lib/cuisines.ts` の `cuisineConfig`（`label`/`color`/`icon`）… `/map`・店舗詳細ページ・`RestaurantMap.astro`（地図のピン・絞り込みボタン）の**すべてに自動で反映される**（各ページの個別更新は不要）
  3. 発見でも拾いたいなら `scripts/lib/places.mjs` の `CUISINE_QUERIES`
- **priceRange enum を変える**場合 → `src/lib/cuisines.ts` の `priceLabels` を更新すれば `/map`・店舗詳細ページ・`RestaurantMap.astro` すべてに反映される
- **`area` enum に値を追加**する場合 → `src/content.config.ts`（`places` の `area` enum）に追記するだけでよい（`RestaurantMap.astro` はareaを自由文字列として扱うため個別更新不要）
- **placesのフィールドを削除/改名**する場合、地図・詳細ページが壊れる箇所:
  - `src/lib/places.ts` … `getVisiblePlaces()`（`status`/`sourceArticles`）、`placeToMapPoint()`（`name`/`nameEn`/`area`/`cuisine`/`priceRange`/`halal`/`servesAlcohol`/`googleMapsQuery`/`lat`/`lng`/`sourceArticles`）
  - `src/pages/map.astro` / `src/pages/category/[slug]/[...page].astro` / `src/pages/articles/[...id].astro` … いずれも `getVisiblePlaces()` + `placeToMapPoint()` 経由でplacesを取得し `RestaurantMap` に渡す（`isChain` 除外は各ページ側の責務）
  - `src/pages/places/[slug].astro` … 店舗詳細ページ。`getStaticPaths()` で可視placesを全件生成し、`data` の各フィールド（バッジ表示・JSON-LD）を直接参照
  - `src/components/RestaurantMap.astro` … `cuisine`（絞り込み・`cuisineConfig` 参照）/ `area`（エリアフィルタ）/ `servesAlcohol`（酒類フィルタ、`'yes'` 判定）/ `halal`（ハラールフィルタ、`'yes'` 判定。`unverified` は対象外）/ `priceRange`（`priceLabels`）/ `googleMapsQuery`（マップリンク）/ `id`（店舗詳細ページへのリンク）/ `nameEn` / `name` を直接参照
  - `src/components/StructuredData.astro` … `type="place"` のRestaurant/LocalBusiness JSON-LD（`buildPlaceSchema()`）が `name`/`nameEn`/`category`/`cuisine`/`priceRange`/`lat`/`lng`/`area` を参照
- 要するに **cuisine/priceRange/area enum追加は「`content.config.ts` + `cuisines.ts`（+ 必要なら `scripts/lib/places.mjs`）」の更新だけで済む**。地図・詳細ページ側は `cuisines.ts` / `lib/places.ts` を import しているだけなので個別に直す必要はない。フィールド改名時は上記の直接参照箇所を直す。

### 執筆方針を変える

執筆はエンジンではなく Claude Code セッションでの人手作業なので、コード変更ではなく**依頼プロンプト側**で調整する（例: 裏取り項目の追加、構成の変更）。`halal`/`servesAlcohol` の `unverified` 規約は維持する。

## 既知の制約・注意

- **Places APIキーはIP制限付きでローカル専用**: 発見・`enrich-places.mjs`・`check-places-status.mjs` は CI では動かない（`../../AUTOMATION.md`）
- **`discover-restaurants.mjs` の既存店舗除外は現在stale**: 上記「⚠️ 既知の不整合」参照。`scripts/lib/existing-mapdata.mjs` が記事frontmatterの `mapData`（既にplaces基盤への移行で撤去済み）を読む前提のままのため、実質的に重複除外が効いていない。`src/data/places/*.yaml` を読むように更新するまでは、discover実行後の候補リストを手動で目視確認すること
- **座標60m以内の重複判定は「店名一致 or placeId一致」の場合のみ違反扱い**: `validate-places.mjs` は密集した商業エリア（SCBD・セノパティ等）に実在する別々の店舗を誤って「重複」と断定しないよう、店名が明確に異なる近接ケースは警告（exit 1対象外）に留めている。完璧な同定を狙ったものではない点は移行前の粗いフィルタ（`existing-mapdata.mjs` の `isKnownRestaurant()`）と同じ設計思想
- **`isChain: true` は地図に出ない**: `map.astro` / `category/[slug]/[...page].astro` の両方で除外される（`src/pages/articles/[...id].astro` の記事内ミニマップは移行前と同様、`isChain` を除外しない）
- **`enrich-places.mjs` は500m以上の座標ずれを自動採用しない**: Text Searchの1件目が誤って別の店舗・別支店を指すリスクを避けるための安全弁。警告が出たplaceは `googleMapsQuery` を見直すか、手動でplaceIdを確認して直接yamlに書き込む
- **(B) 飲食店以外は完全手動**: 自動化の予定はスコープ外

## 関連リンク

- 飲食店ガイドのセットアップ・実行コマンド: [`../../AUTOMATION.md`](../../AUTOMATION.md)（「レストラン・ディレクトリ自動更新パイプライン（飲食店ガイド）」節）
- 情報源・更新方式の俯瞰: [`../../CONTENT-SOURCES.md`](../../CONTENT-SOURCES.md)（「3-4」半自動経路、「5」更新されないもの）
- 公開フロー（Slack承認）の詳細: [`../news-pipeline.md`](../news-pipeline.md)（第10〜11章）
</content>
