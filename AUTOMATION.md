# 記事自動ドラフト生成パイプライン

> 各カテゴリの情報源・更新方式の一覧は [`CONTENT-SOURCES.md`](./CONTENT-SOURCES.md) を参照してください。このドキュメントはセットアップ手順・運用コマンドが中心です。生成エンジンの内部仕様は [`docs/news-pipeline.md`](./docs/news-pipeline.md)、カテゴリごとの情報源・品質チューニング箇所は [`docs/categories/`](./docs/categories/) の各ファイル（後述の「カテゴリ別詳細ドキュメント」節）を参照してください。

2026年4月に存在した「複数メディアをクロール→事実確認しながら記事化→Slackで承認」という運用（当時は`CLAUDE.md`/`soul.md`という人間向け運用指示書＋手動Claude Codeセッションで回していた）を、正式なアプリケーションコードとして再実装したもの。

## カテゴリ別詳細ドキュメント

「このカテゴリはどう更新されているか」「記事の質を変えたいのでどこを触ればいいか」を、カテゴリ単位でまとめた詳細ドキュメント。エンジン共通の内部仕様は [`docs/news-pipeline.md`](./docs/news-pipeline.md) に切り出してある。

### 安全・災害（`safety`）

Detik/Antara + **BMKG地震API**（2エンドポイント・リンク一意化ハック）+ Kompasクエリ①（`society`と共用）で自動生成。地震まわりの候補生成ロジックの詳細あり。 詳細: [`docs/categories/safety.md`](./docs/categories/safety.md)

### 社会・政治（`society`）

Detik/Antaraの一般ニュース + Kompasクエリ①（`safety`と共用）で自動生成。**専用Kompasクエリが無い**事実と、候補を増やしたいときの対処を記載。 詳細: [`docs/categories/society.md`](./docs/categories/society.md)

### 経済・ビジネス（`business`）

Detik/Antara + Kompasクエリ③（`bbm subsidi ekonomi`）で自動生成。為替など本文の数値が陳腐化しうる点の注意あり。 詳細: [`docs/categories/business.md`](./docs/categories/business.md)

### 旅行・お出かけ（`travel`）

Detik/Antara + Kompasクエリ④（`wisata liburan destinasi`、2026-07-31追加）で自動生成。 詳細: [`docs/categories/travel.md`](./docs/categories/travel.md)

### ビザ・手続き（`visa`）

Detik/Antara + Kompasクエリ②（`kitas visa wna jepang`）で自動生成。`regulation`との境界の曖昧さに注意。 詳細: [`docs/categories/visa.md`](./docs/categories/visa.md)

### 規制・法務（`regulation`）

Detik/Antara + Kompasクエリ⑤（`aturan kebijakan pajak izin`、2026-07-31追加）で自動生成。 詳細: [`docs/categories/regulation.md`](./docs/categories/regulation.md)

### グルメ・レストラン（`gourmet`）

(A)新着グルメニュース=自動（foodレーン、週2回 月・木 07:30 WIB。detikFood RSS + Google Newsグルメ検索RSS）、(B)飲食店ガイド（5選記事等）=半自動（Places APIで発見→Claude Codeで人手リサーチ執筆。書くべきトピックは週次のガイド提案ボットがSlackに提案）。 詳細: [`docs/categories/gourmet.md`](./docs/categories/gourmet.md)

### 生活情報（`lifestyle`）

ニュースエンジン対象だが専用ソースなし（学校・病院等のガイド記事は完全手動）。2026-08-11にグルメ要素を`gourmet`へ分離。 詳細: [`docs/categories/lifestyle.md`](./docs/categories/lifestyle.md)

## 何が自動化されているか

**自動:** クロール → 記事ドラフト作成 → GitHub PR作成 → Slackにプレビューリンク+承認ボタンつきで通知 → **ボタン一発で公開まで完了**

```
GitHub Actions (毎日 07:00 / 11:00 WIB = newsレーン、月・木 07:30 WIB = foodレーン)
  → scripts/crawl-and-draft.mjs
      1. Detik RSS / Antara RSS / BMKG地震API / Kompas(Google News経由) から候補ニュースを取得
      2. 既存記事の sourceUrl と突き合わせて重複候補を除外
      3. 候補一覧を Gemini API（無料枠、gemini-flash-latest）に渡し、
         最大3件のニュースを選定・記事化（複数ソースがある場合は事実を突き合わせる）
         書き込み前に validateArticle() でスキーマ相当のチェックを実施
      4. src/content/articles/YYYY-MM-DD-{slug}.md を draft:true で生成
  → 新規ファイルがあれば peter-evans/create-pull-request でブランチ作成・commit・PR作成
  → scripts/notify-draft-pr.mjs が Cloudflare Pages のプレビュー完了を待って
     Slack (#02-donesia-navi) に Block Kit メッセージを投稿
     （タイトル・カテゴリ・実際のサイト見た目で確認できるプレビューリンク・「✅ 承認して公開」ボタン）

人間: Slackのプレビューリンクで実際の見た目を確認
     → 問題なければ「✅ 承認して公開」ボタンを押す(確認ダイアログあり)
        → functions/api/slack-interactivity.js (Cloudflare Pages Functions) が
          draft:false に書き換えてPRをmerge、本番サイトに反映される
     → 問題があれば何もしない(PRはdraft:trueのまま残るので本番には出ない)
```

### Slack承認フローの補足

- ドラフト記事は必ず**PRとして**作成する運用（Cloudflare Pagesのプレビューデプロイ・mergeの対象にするため）。レストランガイド等を手動で追加する場合も直接mainにcommitせずPRを作る
- `src/pages/articles/[...id].astro` は `CF_PAGES_BRANCH` が `main` 以外（＝プレビュービルド）のときだけdraft記事のページも生成する（`src/lib/draftVisibility.ts`）。本番・ローカルビルドでは従来通りdraftは一切表示されない
- 承認ボタンを押せるのはSlackワークスペース/チャンネルにアクセスできる人全員（Slack側でのユーザー単位の権限制御はしていない）

## ファイル構成

| ファイル | 役割 |
|---|---|
| `.github/workflows/crawl-articles.yml` | cronトリガー（`0 0,4 * * *` = JKT 07:00/11:00）+ `workflow_dispatch`（手動実行用）。crawl実行→新規ファイル検知→PR作成→Slack通知 |
| `.github/workflows/notify-draft-pr.yml` | `pull_request: opened`（`src/content/articles/**`変更時のみ）。手動で作成したPR（レストランガイド等）を検知しSlack通知する |
| `scripts/crawl-and-draft.mjs` | 本体。候補取得〜Gemini API呼び出し〜Markdown書き込みまでを担う |
| `scripts/lib/sources.mjs` | ソースアダプタ（Detik/Antara/BMKG/Kompas）。ソース追加時はここに1エントリ追加するだけでよい |
| `scripts/notify-draft-pr.mjs` | PRのdraft記事を検知し、Cloudflare Pagesプレビュー完了を待ってSlackにBlock Kit通知（承認ボタンつき）を送る。`crawl-articles.yml`と`notify-draft-pr.yml`の両方から呼ばれる共通ロジック |
| `functions/api/slack-interactivity.js` | Cloudflare Pages Functions。Slackの「承認して公開」ボタン押下Webhookを受信し、署名検証→draft:false化→PR merge |
| `src/lib/draftVisibility.ts` | `CF_PAGES_BRANCH`を見てCloudflare Pagesのプレビュービルドかどうかを判定する1関数 |

## 必要な設定（初回のみ）

トークン・APIキーはこのチャットには貼らず、ご自身の端末で実行してください。

```bash
cd ~/Personal/donesia-navi
gh secret set GEMINI_API_KEY      # 設定済み（ai-report-bizで使っているキーと共用、2026-07-30登録）
gh secret set SLACK_BOT_TOKEN     # 設定済み（2026-07-30登録）
gh variable set SLACK_CHANNEL_ID --body "C0AQFC6U8UE"   # 設定済み（2026-07-30登録、#02-donesia-navi）
```

`GEMINI_API_KEY`は無料枠（`gemini-flash-latest`、ai-report-bizと共通のキー）。Google Cloudプロジェクト単位でクォータを共有するため、他プロジェクトでの利用状況次第でレート制限に達する可能性がある点に留意。

### Slack承認ボタン用の追加設定（未設定・要対応）

**Slack側**（[api.slack.com](https://api.slack.com/apps) のアプリ管理画面）:
- 「Interactivity & Shortcuts」を有効化し、Request URLに `https://<本番ドメイン>/api/slack-interactivity` を設定
- 「Basic Information」の「App Credentials」からSigning Secretを取得

**Cloudflare Pages側**（ダッシュボード → プロジェクト → Settings → Environment variables）:
- `SLACK_SIGNING_SECRET`（上記で取得したもの）
- `GITHUB_TOKEN`: このリポジトリのみに絞ったfine-grained PAT（`contents:write`, `pull-requests:write`）を [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens) で新規発行

いずれもこのセッションでは未設定（Cloudflareダッシュボード・Slackアプリ管理画面へのアクセス権がこちらにはないため、ユーザー側での対応が必要）。

## 手動での動作確認方法

- **ローカルでの記事生成のみ確認**: `GEMINI_API_KEY=xxx npm run crawl`（`src/content/articles/`に実際にファイルが書き込まれる。PR作成・Slack通知はこのコマンド単体では行われない＝GitHub Actions側の後続ステップでのみ発生する）
- **パイプライン全体（PR作成・Slack通知含む）**: GitHub Actionsの画面から `Crawl & Draft Articles` ワークフローを `workflow_dispatch`（手動実行）で1回走らせる

## 既知の制約

- **Kompasの`sourceUrl`は直リンクに解決される(2026-08-03〜)**: Google Newsのsite内検索RSSを使うのは従来通りだが、取得時に`resolveDirectLink()`(リダイレクト追跡→Google News内部APIデコード→fail-open)で`kompas.com`の実URLへ解決する。解決率は実測約99%(失敗時は仲介URLのまま保存)
- **本文はRSSの見出し・要約文をもとに生成**: 全文スクレイピングは行わない（ペイウォール・利用規約リスクを避けるため）。事実確認の深さは旧記事と同等〜やや浅めになりうる
- **オープンPRも重複排除の対象(2026-08-03〜)**: `GITHUB_TOKEN`/`GITHUB_REPOSITORY`があるとき、オープンPRで追加予定の記事のsourceUrl/タイトルも重複判定に含める(`fetchOpenPrDedupeData()`、APIエラー時はfail-openで従来動作)
- 生活DB化（2026年7月の事業転換提案）は本パイプラインのスコープ外。ニュースポータル路線を前提にしている
- **飲食店ガイド（ハラール・酒類・エリア等のmapDataつき）は本パイプラインの対象外**: 既存のレストランガイド記事群（`content.config.ts`の`mapData`フィールド、料理別ガイド）はニュースではなく常時更新型のディレクトリコンテンツであり、ニュースRSSクロールでは生成できない。別途Google Places API等を使った専用の仕組みが必要。実装済み（後述の「レストラン・ディレクトリ自動更新パイプライン」節を参照）
- Gemini APIは構造化出力（responseSchema + responseMimeType: application/json）を使用（2026-08-03〜）。パースは素のJSON.parse→失敗時に旧来のフェンス抽出/正規表現へフォールバックする多段構成。書き込み前の`validateArticle()`のスキーマガードも従来通り維持

## コスト

- Gemini API呼び出し: 1日2回 × 1回あたり候補180件程度をまとめて1コールに渡す設計（`gemini-flash-latest`、無料枠）
- GitHub Actions: 無料枠で十分収まる想定（1回数分程度のジョブを1日2回）

---

# レストラン・ディレクトリ自動更新パイプライン（飲食店ガイド）

上記のニュースパイプラインとは別に、既存のレストランガイド記事（`mapData`つき）を拡充するための、2段階・ローカル実行のパイプライン。

## なぜニュースパイプラインと方式が違うのか

- Places API (New) はIPアドレス制限のあるキーだと外部環境（GitHub Actions等）から弾かれることを実地確認済み。→ **発見ステップはユーザーのローカルPCで手動実行**
- Gemini APIの「Google Search grounding（検索グラウンディング）」機能は無料枠に含まれず課金必須（公式ドキュメントで確認）。無料枠のみで運用したいため使わない。→ **事実確認・執筆はClaude Code自身（WebSearch/WebFetch）が担当**

## 2段階の流れ

```
[ステップ1: 発見] npm run discover-restaurants   ← ローカルPCで手動実行
  既存記事のmapDataを集約 → Places API (New) Text Searchで
  主要ハブエリア(Kebayoran Baru/Senopati/SCBD/Kemang/Menteng/PIK)×
  cuisine(japanese/korean/chinese/indonesian/european/cafe)を検索
  → 既知店舗と重複しない新規候補を data/restaurant-candidates.json に出力

[ステップ2: リサーチ・執筆] Claude Codeセッションで対話的に実行
  data/restaurant-candidates.json をClaudeに渡し、各店舗をWebSearchで調査
  （ハラール・酒類・営業時間・電話番号・メニュー価格）
  → 確認できない項目は「要確認」と明示（既存の halal: "unverified" と同じ規約）
  → 既存ガイドと同じ構成でdraft:trueのMarkdownを作成
  → 人間がgit diffでレビュー・修正してから draft:false に変更して公開
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `scripts/discover-restaurants.mjs` | ステップ1の本体 |
| `scripts/lib/places.mjs` | Places API (New) Text Searchの呼び出しラッパー、エリア/cuisineの定義 |
| `scripts/lib/existing-mapdata.mjs` | 全記事のmapDataを`yaml`パッケージで集約、重複判定（店名の正規化一致 or 座標60m以内） |
| `data/restaurant-candidates.json` | ステップ1の出力（`.gitignore`済み中間ファイル） |

## 必要な設定

```bash
# donesia-navi/.env.local に追記（.gitignore済み）
GOOGLE_PLACES_API_KEY=...
```

- **perth-web-bizの既存キーは流用しない**（IP制限があり、用途も混在させたくないため新規発行を推奨）
- Google Cloud Consoleで「Places API (New)」のみを有効化した専用キーを新規発行し、課金を有効化（Places APIの仕様上、無料枠内でも billing 有効化は必須）。月5,000件の無料枠内に収まる設計
- 正しいGCPアカウント/プロジェクトの特定と課金有効化はユーザー自身で対応（このセッションでは意図的に操作していない）

## 動作確認（実施済み）

- `GOOGLE_PLACES_API_KEY`未設定時にエラーメッセージを出して終了することを確認
- 無効なキーで実行し、Places APIからの400エラーを正しく捕捉して`failures`に記録し、クラッシュせず正常終了することを確認（リクエスト形式自体は正しいことの裏付け）
- `existing-mapdata.mjs`を実データで実行し、既存5記事・40店舗名・26座標を正しく集約し、名前一致・座標一致・未知判定がいずれも正しく動くことを確認
- **実際のPlaces API呼び出し（本物のキーでの動作）は2026-07-30に検証済み**: `data/restaurant-candidates.json`（generatedAt: 2026-07-30T08:36:26.767Z）にplaceId・住所・座標・評価数を含む実データ20件をfailures 0件で取得できたことを確認済み

## 使い方（新規キー発行後）

```bash
# 小規模テスト(1エリア×1カテゴリ)
npm run discover-restaurants -- --area="Kebayoran Baru" --cuisine=japanese

# 通常実行(全エリア×全カテゴリ)
npm run discover-restaurants
```

出力された`data/restaurant-candidates.json`をClaude Codeに渡し、「この候補を調査してレストランガイド記事のdraftを作って」と依頼する。

---

# ガイド記事ギャップ提案ボット

上記2つのパイプライン（ニュース自動生成／レストラン・ディレクトリ更新）とは別に、「次にどのガイド記事を書くべきか」を毎週提案するボット。記事の自動生成は行わず、Slackへの提案止まり。

## 目的

Search Console(GSC)の流入クエリは「ジャカルタ 中華」「ジャカルタ イタリアン」「ジャカルタ 韓国料理」のような、料理ジャンル軸のガイド型検索が主力。既存のレストランガイド記事（中華5選・韓国5選など）がこれを一部カバーしているが、未対応の組み合わせ（イタリアン単体・カフェ・焼肉など）も多い。人手でGSCを毎回確認する代わりに、あらかじめ定義したターゲットトピック一覧と既存記事・掲載店舗データを突き合わせて未カバートピックを算出し、優先度順にSlackで提案する。

**トピック軸について(2026-09〜)**: 当初は「料理ジャンル」に加えて「エリア」（SCBD・ブロックM・スナヤン・クマン・ポンドックインダ）も軸にしていたが、「エリア名では誰も検索しない」というオーナー判断によりエリア単体トピックは全廃止した。代わりに、ユーザーが実際に検索する軸である「用途」（会食・接待/子連れ・ファミリー/デート・記念日/大人数・宴会/作業・ノマド/個室あり）をトピックに追加している。用途軸トピックは`cuisine`/`area`のいずれも指定できない（特定の料理ジャンル・エリアに紐づかないため）ため、候補店舗数は算出せず「算出対象外(用途軸)」と表示する（詳細は下記「トピックリストのメンテ方法」）。

## 実行頻度

毎週月曜 08:00 WIB（cron `0 1 * * 1`）+ `workflow_dispatch`（手動実行用）。

## 動作

```
scripts/suggest-guide-topics.mjs
  1. スクリプト内定数 TARGET_TOPICS（GSCクエリ由来、15〜20件程度。料理ジャンル軸+用途軸）を評価
  2. src/content/articles/*.md のfrontmatter(title/tags/category/draft)を読み、
     category が gourmet または lifestyle の記事に絞った上で、
     トピックのkeywordsが title に含まれていれば「カバー済み」と判定
     （2026-08-11〜: tagsのみの一致はカバー済みにしない。中華5選・韓国5選のような
       専用記事とは違い、複数ジャンルを1本で扱う「洋食・ヨーロッパ料理」ガイドの
       tagsに「イタリアン」「フレンチ」が混在しているだけで専用記事扱いされてしまう
       誤判定があったため。tagsのみで一致した記事は「関連記事あり(部分カバー)」として
       出力に参考表示するが、未カバー扱いは維持する。category限定も、レストランと無関係な
       交通ニュース記事のtitleにエリア名が含まれることによる誤判定を防ぐために追加した）
     （draft:trueの記事のみでtitleが一致した場合は「(draft)」付きの執筆済み扱い）
  3. src/data/places/*.yaml を集計し、各未カバートピックについて
     cuisine一致（areaトピックならarea一致）かつstatus!=closedの店舗数を
     「既知の掲載候補」としてカウント。5件未満なら「要ディスカバリー」と付記
     （2026-09〜: cuisine/areaともnullの用途軸トピックは絞り込み条件が無く全店舗を
       誤カウントしてしまうため、候補数をnullとし「算出対象外(用途軸)」と表示。
       「要ディスカバリー」注記も付けない）
  4. 未カバートピックを優先度(high→mid→low)順に並べ、上位3件をSlackへ投稿
     （全件カバー済みなら投稿をスキップ）
  5.（本番実行のみ、--dry-runではスキップ）Slack提案対象の上位トピックそれぞれについて
     Googleサジェスト（無料・認証不要）で「実際に検索されている語」を最大5語取得して添える。
     一般シード語（「ジャカルタ グルメ」「ジャカルタ レストラン」「ジャカルタ カフェ」）の
     サジェストもまとめてSlackのcontextブロックで表示する
  6.（本番実行のみ、GSC_SERVICE_ACCOUNT_KEY設定時のみ）Search Console APIから直近28日の
     検索クエリを取得し、各トピックのkeywordsに部分一致する実クエリを「GSC実クエリ」として
     添える。表示回数上位10クエリもcontextブロックで表示する。キー未設定時は従来通り
     このステップをスキップする（fail-open）
```

## トピックリストのメンテ方法

`scripts/suggest-guide-topics.mjs`内の`TARGET_TOPICS`配列を直接編集する。1件は`{id, label, keywords, area, cuisine, priority, rationale}`のオブジェクト。

- `keywords`: 記事のtitleとの一致判定に使う語（表記ゆれがあれば複数指定。例: `寿司`/`すし`）。tagsは判定に使わない(2026-08-11〜)ため、専用記事のtitleに実際に入る語を選ぶこと
- `cuisine`/`area`: `src/content.config.ts`のplacesスキーマのenum値と一致させること（一致しないと候補店舗数が常に0になる）。**用途軸トピック（後述）はいずれもnullにする**
- `priority`: `high`/`mid`/`low`。Slack提案は上位3件のみのため、優先度の並びが提案結果に直結する
- トピックには2つの軸がある:
  - **料理ジャンル軸**（`cuisine`を指定。例: `italian`/`cafe`/`yakiniku`など）: 「何を食べたいか」で検索されるトピック。候補店舗数はcuisine（+area）一致で算出される
  - **用途軸**（`cuisine: null, area: null`。例: `kaishoku`/`family`/`date-dinner`/`group-party`/`work-cafe`/`private-room`）: 「どういう用途で使うか」で検索されるトピック。cuisine/areaで絞り込めないため候補店舗数は算出せず、出力側で「算出対象外(用途軸)」と表示する（`countCandidatePlaces`が`null`を返す仕様。「要ディスカバリー」注記も付かない）
  - **エリア単体トピックは廃止済み**（2026-09〜）。「エリア名では誰も検索しない」というオーナー判断による。新規追加は行わないこと

GSCの実クエリは変動するため、**四半期ごとに見直す**（Search Consoleの検索パフォーマンスレポートを確認し、クリック・表示回数の多いクエリで未カバーのものを追加/優先度調整する。GSC連携（後述）を設定していればSlack投稿内の「GSC実クエリ」「表示回数上位クエリ」も参考にできる）。

## 提案後のフロー

```
Slackに提案が投稿される（優先度・理由・既知の掲載候補数つき）
  → 人間が内容を確認し、書く価値があると判断したトピックを選ぶ
  → Claude Codeセッションで対話的に実行
      候補店舗数が少ない（要ディスカバリー付記あり）場合は
      先に npm run discover-restaurants で店舗候補を発見
      → 各店舗をWebSearchで調査（既存レストランガイド記事と同じ規約:
        ハラール/酒類は確認できなければ「要確認」、価格・営業時間つき）
      → 既存ガイドと同じ構成で draft:true のMarkdownを作成
      → 人間がレビューし、通常のPRフロー（Slack承認ボタン、または手動merge）で公開
```

## ファイル構成

| ファイル | 役割 |
|---|---|
| `.github/workflows/suggest-guide-topics.yml` | cronトリガー（月曜08:00 WIB）+ `workflow_dispatch` |
| `scripts/suggest-guide-topics.mjs` | 本体。トピック定義・カバレッジ判定・候補店舗数算出・Slack投稿 |
| `scripts/lib/slack.mjs` | Slack `chat.postMessage`の共通ラッパー（`postSlackMessage({ token, channel, text, blocks })`） |
| `scripts/lib/google-suggest.mjs` | Google検索サジェスト（オートコンプリート）取得の薄いラッパー（`fetchGoogleSuggestions(query)`）。無料・APIキー不要、fail-open |
| `scripts/lib/gsc.mjs` | Google Search Console (Search Analytics API) 連携。サービスアカウントJWTを自前生成してアクセストークンを取得し、直近28日の検索クエリを取得する（`getGscData(...)`）。fail-open |

## 動作確認方法

```bash
# Slack投稿なし・ネットワーク/環境変数不要。未カバートピック一覧をコンソールに出力
node scripts/suggest-guide-topics.mjs --dry-run

# Slackに実際に投稿（SLACK_BOT_TOKEN / SLACK_CHANNEL_ID が必要。
# GSC_SERVICE_ACCOUNT_KEY / GSC_SITE_URL は任意。未設定でも従来通り動く）
SLACK_BOT_TOKEN=xxx SLACK_CHANNEL_ID=xxx node scripts/suggest-guide-topics.mjs
```

## Googleサジェスト連携

`scripts/lib/google-suggest.mjs`が`https://suggestqueries.google.com/complete/search`（無料・APIキー不要）を叩き、指定クエリの検索サジェスト語を取得する。本番実行（Slack投稿）時のみ、Slack提案対象の上位トピックそれぞれについて「ジャカルタ &lt;先頭keyword&gt;」のサジェストを取得し、Slackの各トピックブロックに「実際に検索されている語」として最大5語添える。一般シード語（「ジャカルタ グルメ」「ジャカルタ レストラン」「ジャカルタ カフェ」）のサジェストもまとめてcontextブロックで表示する。タイムアウト5秒、失敗時はthrowせず空配列を返すfail-open設計のため、`--dry-run`はこれまで通りネットワークなしで動く（このステップ自体を呼ばない）。

## Search Console(GSC)連携

Search Console APIは無料（課金対象外）。外部依存パッケージは追加せず、`scripts/lib/gsc.mjs`が`node:crypto`でサービスアカウントのJWT(RS256)を自前生成し、OAuth2トークン取得→Search Analytics APIで直近28日の検索クエリ（`dimensions: ['query']`, `rowLimit: 100`）を取得する。

環境変数:

- `GSC_SERVICE_ACCOUNT_KEY`: サービスアカウントのJSONキー文字列（GitHub Secrets）
- `GSC_SITE_URL`: GSCプロパティのURL（GitHub Variables）。デフォルト`sc-domain:indonesia-navi.com`

本番実行時、`GSC_SERVICE_ACCOUNT_KEY`が設定されていれば、(a) 各`TARGET_TOPICS`のkeywordsに部分一致する実クエリがあればそのトピックのSlackブロックに「GSC実クエリ: &lt;クエリ&gt; (表示X回/クリックY回)」を添え、(b) 表示回数上位10クエリをcontextブロックで表示する。未設定なら`console.log`で案内してスキップする（fail-open。2026-09時点ではまだ未設定のため、未設定時も従来通り動くことを担保している）。

### GSC側セットアップ手順（初回のみ、ユーザー作業）

1. GCPプロジェクトで **Search Console API** を有効化する
2. GCPで **サービスアカウント** を作成する
3. サービスアカウントの **JSONキーを発行** する
4. Google Search Consoleの`indonesia-navi.com`プロパティに、そのサービスアカウントのメールアドレスを **「閲覧者」として追加** する（Search Console > 設定 > ユーザーと権限）
5. GitHubリポジトリのSecretsに、発行したJSONキーの中身をそのまま **`GSC_SERVICE_ACCOUNT_KEY`** として登録する（Settings > Secrets and variables > Actions）
6. （任意）GSCプロパティがデフォルトの`sc-domain:indonesia-navi.com`と異なる場合は、GitHub Variablesに **`GSC_SITE_URL`** を登録する

## 既知の制約

- **（2026-08-11時点で修正済み）カバレッジ判定は当初、記事の`category`を見ずtitle/tagsの単純なキーワード一致のみで行っていたため、`italian`・`french`（既存の洋食・ヨーロッパ料理ガイド記事のtagsに`イタリアン`・`フレンチ`が別ジャンルの一部として含まれていた）や`blok-m`（レストランガイドと無関係な交通ニュース記事`2026-08-01-transjabodetabek-blokm-airport-fare-change.md`のtitleに`ブロックM`が含まれていた）が「カバー済み」と誤判定され、ボットの主目的である未カバートピック検出が機能しない問題があった。現在は下記の仕様に変更してこれを解消している:**
  - 判定対象記事を`category`が`gourmet`または`lifestyle`のものに限定（交通ニュース等の誤判定を排除）
  - キーワード一致は**title のみ**で判定（tagsのみの一致は「カバー済み」にせず、`関連記事あり(部分カバー)`として出力に参考表示するに留める）
  - この変更により、上記3トピックはいずれも未カバーへ戻り、`italian`はSlack提案の上位に再び表示されるようになった（実データで確認済み。中華・韓国・インドネシア料理などの専用ガイドがあるトピックは引き続き正しくカバー済み判定される）
  - 残存リスク: gourmet/lifestyle以外のcategoryで書かれたガイド記事があれば拾えない、専用記事のtitleにトピックの語が含まれない言い回し（例:「本場の味」のような婉曲表現のみ）だと未カバー扱いのままになる、といったエッジケースは残る。`TARGET_TOPICS`のkeywords選定時は実際の記事titleの言い回しを意識すること
- 候補店舗数はcuisine/areaの一致のみで算出しており、料理ジャンル内の細分類（例:「イタリアン」トピックに対して`cuisine: european`の店舗を全てカウント。フレンチ店も含まれる）までは区別していない
- **（2026-09〜）エリア単体トピックは全廃止した**。「エリア名では誰も検索しない」というオーナー判断による。代わりに追加した用途軸トピック（会食・接待/子連れ・ファミリー/デート・記念日/大人数・宴会/作業・ノマド/個室あり）は`cuisine`/`area`を持たないため候補店舗数を算出できず、「算出対象外(用途軸)」と表示する仕様（要ディスカバリー注記も付けない）
- Googleサジェスト・GSC連携はいずれも「本番実行（Slack投稿）時のみ」動作する参考情報であり、未カバートピックの判定ロジック自体（カバレッジ判定・優先度順ソート）には影響しない

