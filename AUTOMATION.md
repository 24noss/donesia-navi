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

### 生活・グルメ（`lifestyle`）

ニュースエンジンとは別系統。(A)飲食店ガイド=半自動（Places APIで発見→Claude Codeで人手リサーチ執筆）、(B)飲食店以外（学校・病院等）=完全手動。`mapData`スキーマと地図表示の関係も記載。 詳細: [`docs/categories/lifestyle.md`](./docs/categories/lifestyle.md)

## 何が自動化されているか

**自動:** クロール → 記事ドラフト作成 → GitHub PR作成 → Slackにプレビューリンク+承認ボタンつきで通知 → **ボタン一発で公開まで完了**

```
GitHub Actions (毎日 07:00 / 11:00 WIB)
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

- **Kompasの`sourceUrl`はGoogle Newsの仲介リンクになる**: Kompasには直接RSSが見つからなかったため、Google Newsのsite内検索RSSを使っている。ブラウザでは実記事に遷移するが、`megapolitan.kompas.com/read/...`のような直リンクではない
- **本文はRSSの見出し・要約文をもとに生成**: 全文スクレイピングは行わない（ペイウォール・利用規約リスクを避けるため）。事実確認の深さは旧記事と同等〜やや浅めになりうる
- **未マージのPRがある間、同じニュースが次のcron実行で再度ドラフトされうる**: 重複判定は`main`ブランチ上の既存記事のみを見ており、オープンPRの中身までは見ていない。実害はPRが余分に積まれる程度
- 生活DB化（2026年7月の事業転換提案）は本パイプラインのスコープ外。ニュースポータル路線を前提にしている
- **飲食店ガイド（ハラール・酒類・エリア等のmapDataつき）は本パイプラインの対象外**: 既存のレストランガイド記事群（`content.config.ts`の`mapData`フィールド、料理別ガイド）はニュースではなく常時更新型のディレクトリコンテンツであり、ニュースRSSクロールでは生成できない。別途Google Places API等を使った専用の仕組みが必要。実装済み（後述の「レストラン・ディレクトリ自動更新パイプライン」節を参照）
- Gemini APIの構造化出力機能（responseSchema）は使わず、プロンプトでJSON配列を指示してテキストから抽出する方式を採用（`ai-report-biz/pipeline/enrich.py`の実績あるパターンを踏襲）。書き込み前の`validateArticle()`が実質的なスキーマガード

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
