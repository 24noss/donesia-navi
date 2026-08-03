# CONTENT-SOURCES.md — カテゴリ別・情報源と更新フロー リファレンス

一人運用(西野さん)のオーナーが「このカテゴリの記事はどこから来て、誰が/何が更新しているか」を一目で把握するためのリファレンスです。

- **このドキュメント**: 何がどこから来るか(情報源・更新方式・頻度・人手の介在ポイント)
- **[`AUTOMATION.md`](./AUTOMATION.md)**: セットアップ手順・運用コマンド・既知の制約・コスト

両ドキュメントは相互参照する前提で、内容はできるだけ重複させていません。

## 1. カテゴリ別サマリー

7カテゴリの定義は `src/lib/categories.ts` 参照。

| カテゴリ(日本語/slug) | 情報源 | 更新方式 | 頻度 | 人手の介在ポイント |
|---|---|---|---|---|
| [安全・災害](./docs/categories/safety.md) / `safety` | Detik・Antara(一般ニュースRSS) + BMKG地震API + Kompas(クエリ①、societyと共用) | 自動 | 1日2回(07:00・11:00 WIB) | Slack「✅承認して公開」ボタン(内容修正はしない、公開可否のみ) |
| [社会・政治](./docs/categories/society.md) / `society` | Detik・Antara(一般ニュースRSS) + Kompas(クエリ①共用+専用クエリ⑥) | 自動 | 1日2回 | 同上 |
| [経済・ビジネス](./docs/categories/business.md) / `business` | Detik・Antara(一般ニュースRSS) + Kompas(クエリ③) | 自動 | 1日2回 | 同上 |
| [生活・グルメ(飲食店ガイド)](./docs/categories/lifestyle.md) / `lifestyle` | Google Places API (New)で候補発見 + Claude CodeセッションでのWeb調査・執筆 | 半自動 | 不定期(オーナーが`discover-restaurants`を実行した時のみ) | 発見コマンドの実行判断、WebSearchでの裏取り、執筆、Slack承認 |
| [生活・グルメ(飲食店以外: 学校・病院等)](./docs/categories/lifestyle.md) / `lifestyle` | 都度の手動調査(自動化なし) | 手動 | 不定期 | 発見〜執筆〜PR作成まで全工程 |
| [旅行・お出かけ](./docs/categories/travel.md) / `travel` | Detik・Antara(一般ニュースRSS) + Kompas(クエリ④、2026-07-31追加) | 自動 | 1日2回 | Slack承認 |
| [ビザ・手続き](./docs/categories/visa.md) / `visa` | Detik・Antara(一般ニュースRSS) + Kompas(クエリ②) | 自動 | 1日2回 | Slack承認 |
| [規制・法務](./docs/categories/regulation.md) / `regulation` | Detik・Antara(一般ニュースRSS) + Kompas(クエリ⑤、2026-07-31追加) | 自動 | 1日2回 | Slack承認 |

**注意**: 上表の「対応するKompasクエリ」は候補ニュースが集まりやすいキーワードであるに過ぎません。実際にどのカテゴリに分類するかは、記事ごとにGemini(LLM)が本文内容を見て最終判断します(`scripts/crawl-and-draft.mjs`のプロンプトが7種のslugから1つ選ばせる方式で、ルールベースの振り分けは存在しません)。そのためDetik/Antaraの一般ニュースも実質的に全カテゴリの候補になり得ます。

## 2. 情報源の詳細

| ソース | 取得方法 | 実装 |
|---|---|---|
| Detik | `https://news.detik.com/rss` を取得。ジャンル不特定の一般ニュース | `scripts/lib/sources.mjs` (`id: 'detik'`) |
| Antara | `https://www.antaranews.com/rss/terkini.xml` を取得。同じく一般ニュース | `scripts/lib/sources.mjs` (`id: 'antara'`) |
| BMKG | インドネシア気象・地球物理庁の地震API。`autogempa.json`(最新1件)+`gempaterkini.json`(直近リスト)を取得し、`safety`カテゴリに直結する候補を生成 | `scripts/lib/sources.mjs` の `fetchBmkgEarthquakes()` |
| Kompas(Google News RSS経由) | Kompasには直接RSSが存在しないため、`site:kompas.com <キーワード> when:1d` のGoogle Newsサイト内検索RSSで代替 | `scripts/lib/sources.mjs` の `fetchKompasViaGoogleNews()` |
| Google Places API (New) | Text Searchでレストラン候補を発見(エリア6×料理6=36クエリ) | `scripts/lib/places.mjs` |
| Gemini API | `gemini-flash-latest`(無料枠)。候補ニュースの選定・カテゴリ判定・日本語記事執筆を担当 | `scripts/crawl-and-draft.mjs` の `GEMINI_API_URL` |

### Kompasクエリ5本とカテゴリ対応(`KOMPAS_QUERIES`, `scripts/lib/sources.mjs`)

| # | クエリ | 主対応カテゴリ | 備考 |
|---|---|---|---|
| ① | `jakarta banjir gempa demo` | safety / society | 洪水・地震・デモ等、両カテゴリにまたがる内容 |
| ② | `kitas visa wna jepang` | visa | |
| ③ | `bbm subsidi ekonomi` | business | 燃料補助金・経済政策系 |
| ④ | `wisata liburan destinasi` | travel | 2026-07-31追加。当日実測34件/日 |
| ⑤ | `aturan kebijakan pajak izin` | regulation | 2026-07-31追加。当日実測65件/日 |

**既知の制約**: Kompas候補の`link`はGoogleのJSリダイレクト経由の仲介URLで、実記事URLに直接解決できない(`scripts/lib/sources.mjs`のコメント、`AUTOMATION.md`の「既知の制約」節にも記載)。

## 3. 更新フローの詳細

### 3-1. ニュース自動経路(safety / society / business / visa / travel / regulation 共通)

1. GitHub Actions cronが毎日07:00 WIB(`0 0 * * *` UTC)と11:00 WIB(`0 4 * * *` UTC)に起動。`workflow_dispatch`で手動起動も可能(`.github/workflows/crawl-articles.yml`)
2. `scripts/crawl-and-draft.mjs`がDetik/Antara/BMKG/Kompas(5クエリ)から候補を取得し、既存記事の`sourceUrl`と突き合わせて重複を除外
3. 候補一覧(1回あたり実測で概ね180件程度、`AUTOMATION.md`のコスト節)をGemini(`gemini-flash-latest`)に渡し、直近14日間に扱ったタイトルと重複しないよう指示した上で、最大`CRAWL_MAX_ARTICLES`件(未設定時デフォルト3件)を選定・日本語で執筆。カテゴリもここでLLMが決定する
4. `validateArticle()`でスキーマ相当のチェックをした上で、`src/content/articles/YYYY-MM-DD-{slug}.md`を`draft: true`で書き込み
5. 新規ファイルがあれば`peter-evans/create-pull-request`でブランチ`auto/articles-{run_id}`を作成しPRを発行
6. 同じワークフロー内で`scripts/notify-draft-pr.mjs`を呼び出し、Cloudflare PagesのプレビューデプロイをGitHub Checks APIでポーリング(最大12回×10秒間隔)してプレビューURLを取得し、Slackに記事タイトル・概要・カテゴリと「✅承認して公開」ボタン付きのBlock Kitメッセージを投稿
7. オーナーがSlackのプレビューリンクで実際の見た目を確認し、問題なければボタンを押す(確認ダイアログあり)。問題があれば何もしなければPRは`draft: true`のまま残り本番には出ない

### 3-2. 手動作成PRの通知経路(レストランガイド等)

`.github/workflows/notify-draft-pr.yml`は`pull_request: opened`(`src/content/articles/**`変更時)で発火しますが、ブランチ名が`auto/articles-`で始まるPRはスキップします(3-1の手順6で既にSlack通知済みのため二重送信防止)。つまりこの経路で通知が飛ぶのは、レストランガイドなど**crawlパイプライン以外の方法で作成したPR**だけです。

### 3-3. Slack承認の仕組み(`functions/api/slack-interactivity.js`、Cloudflare Pages Functions)

- Slackの「✅承認して公開」ボタン押下 → `POST /api/slack-interactivity` が受信
- HMAC-SHA256でSlack署名を検証(タイムスタンプは5分以内のみ許可)
- `action_id === 'approve_publish'`の場合、PR内の各記事`.md`ファイルについて**frontmatterブロックの中だけ**を対象に`draft: true`→`draft: false`を置換(本文中に偶然同じ文字列があっても誤爆しない設計)し、GitHub Contents APIでコミット
- PRをmerge。GitHub側のmergeable判定が非同期で遅れて出る405エラーは5回・2秒間隔でリトライ
- 結果(成功/失敗)をSlackメッセージに`response_url`経由で反映

### 3-4. レストランガイド半自動経路(lifestyleの一部)

1. **[発見]** オーナーが`npm run discover-restaurants`をローカルPCで手動実行(Places APIキーがIP制限付きのためGitHub Actionsでは動かせない)。既存記事の`mapData`を集約したうえで、エリア6(Kebayoran Baru/Senopati/SCBD/Kemang/Menteng/PIK)×料理6(japanese/korean/chinese/indonesian/european/cafe)=36クエリでPlaces API (New) Text Searchを実行し、既知店舗(placeId一致、または名前・座標一致)を除いた新規候補を`data/restaurant-candidates.json`に出力(`scripts/discover-restaurants.mjs`, `scripts/lib/places.mjs`)
2. **[リサーチ・執筆]** Claude Codeセッションで候補を渡し、WebSearchで営業時間・ハラール・酒類・電話番号・メニュー価格等を裏取りしながら日本語で執筆。確認できない項目は「要確認」等と明示する方針(`halal: "unverified"`と同じ規約)。`draft: true`でPRを作成
3. 以降は3-1の6〜7、3-3と共通(プレビュー確認 → 承認ボタン → `draft: false` → merge)

## 4. サイト上の動的データ(記事コンテンツとは別枠)

| 項目 | 実装ファイル | API | キャッシュ(localStorage) |
|---|---|---|---|
| 天気 | `src/pages/index.astro`(インラインscript) | Open-Meteo(`api.open-meteo.com/v1/forecast`、ジャカルタ座標 -6.2088, 106.8456) | キー`dn_weather`、TTL 30分 |
| 為替(現在レート) | `src/components/ExchangeRate.astro` | open.er-api.com(`/v6/latest/JPY`) | キー`donesia_fx_cache`、TTL 30分 |
| 為替(前日比・30日トレンド) | `src/components/ExchangeRate.astro` | frankfurter.dev(`api.frankfurter.dev/v2/rates`) | キー`donesia_fx_history`、TTL 6時間 |

**常に最新である理由**: どちらもビルド時ではなく**ページ閲覧のたびにブラウザが直接外部APIをfetch**する実装です。そのため記事の自動クロールや手動デプロイの頻度とは無関係に、上記TTLの範囲内で常に最新値が表示されます。デプロイ不要です。

**注意**: 記事本文中に為替レートなどの数値を書いた場合、それは執筆時点のスナップショットであり、上記の動的ウィジェットのようには自動更新されません。古い記事本文の数値は時間の経過とともに実態と乖離しえます。

## 5. 更新されないもの(自動化の対象外)

- **既存記事の本文**: 一度公開した記事は自動では書き換わりません。誤りの訂正や数値の更新は手動でPRを作る必要があります
- **`lifestyle`のうち飲食店ガイド以外**(学校・病院など): 発見の仕組みも半自動パイプラインも存在せず、完全手動でのリサーチ・執筆・PR作成が必要です
- ~~`society`専用のKompasクエリなし~~ → 2026-08-03にクエリ⑥`pemprov jakarta kebijakan warga`を追加済み
- **Kompasの実記事URL**: 取得時に直リンクへ解決されます(2026-08-03〜、解決率約99%。失敗時のみ仲介URLのまま)
- ニュースポータル路線以外の事業転換(生活DB化など): 本パイプラインのスコープ外です(`AUTOMATION.md`「既知の制約」節)

---

最終更新: 2026-07-31
