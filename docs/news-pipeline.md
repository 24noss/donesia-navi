# ニュース自動生成エンジン 詳細（共通深掘り）

ニュース系6カテゴリ（`safety` / `society` / `business` / `travel` / `visa` / `regulation`）の記事を作る共通エンジンの内部仕様を、コード（ファイル+関数/定数名）ベースでまとめたものです。「この記事はどうやって出来ているのか」「生成の質を変えたい」ときの一次資料として使います。

- セットアップ手順・運用コマンド・コスト・既知の制約は [`../AUTOMATION.md`](../AUTOMATION.md) を参照
- 情報源・更新方式の一覧（俯瞰）は [`../CONTENT-SOURCES.md`](../CONTENT-SOURCES.md) を参照
- カテゴリ固有の情報源・チューニングは [`categories/`](./categories/) の各ファイルを参照
- 飲食店ガイド（`lifestyle`）は別エンジンです。[`categories/lifestyle.md`](./categories/lifestyle.md) を参照

このドキュメントは上記と内容を重複させず、エンジン内部の挙動に絞っています。

---

## 1. 全体アーキテクチャ

```
GitHub Actions cron（07:00 / 11:00 WIB）または workflow_dispatch
  │  .github/workflows/crawl-articles.yml
  ▼
scripts/crawl-and-draft.mjs  main()
  1. loadExistingArticles()          ← 既存記事から sourceUrl 集合と直近タイトルを収集
  2. fetchAllCandidates()            ← scripts/lib/sources.mjs（Detik/Antara/BMKG/Kompas）
  3. filterCandidates()              ← 重複排除（既存sourceUrl一致・バッチ内重複を除去）
  4. draftArticles()                 ← Gemini(gemini-flash-latest)で選定・執筆（カテゴリもLLMが決定）
  5. validateArticle()               ← スキーマ相当の検証（不正はスキップ）
  6. buildMarkdown() → writeFile()   ← src/content/articles/YYYY-MM-DD-{slug}.md を draft:true で書き込み
  ▼
peter-evans/create-pull-request（branch: auto/articles-{run_id}）でPR作成
  ▼
scripts/notify-draft-pr.mjs  ← Cloudflare Pagesのプレビューデプロイ完了を待ち、
                                Slackに Block Kit（承認ボタン付き）を投稿
  ▼
人間がプレビューで確認 → Slack「✅ 承認して公開」ボタン
  ▼
functions/api/slack-interactivity.js（Cloudflare Pages Functions）
  署名検証 → frontmatterの draft:true → draft:false → PR merge → 本番反映
```

俯瞰図（人間の介在ポイント含む）は [`../CONTENT-SOURCES.md`](../CONTENT-SOURCES.md) の「3. 更新フローの詳細」にもあります。

---

## 2. 候補オブジェクトのデータ形状

すべてのソースは、下記の同一形状のオブジェクトの配列を返します（`scripts/lib/sources.mjs` の `parseRssItems()` および `fetchBmkgEarthquakes()`）。

| フィールド | 型 | 内容 | 生成元 |
|---|---|---|---|
| `title` | string | 見出し（HTMLタグは `stripHtml()` で除去済み） | `item.title` |
| `snippet` | string | 要約文（同上でHTML除去） | RSSは `item.description` / BMKGは発生日時・深さ・津波可能性・有感地域を組み立てた文 |
| `link` | string | 記事URL（前後空白trim済み。無い場合は空文字） | `item.link` |
| `pubDate` | string \| null | ISO 8601文字列（`new Date(item.pubDate).toISOString()`）。`item.pubDate` が無い（falsy）場合のみ `null`（値はあるが不正な日付の場合は `toISOString()` が throw し、そのソース取得ごと `failures` に落ちる） | `item.pubDate` / BMKGは `g.DateTime` |
| `source` | string | ソース名。末尾の `.com` は除去（`.replace(/\.com$/, '')`） | RSSの `item.source` または `fallbackSourceLabel`、BMKGは `'BMKG'` |

- RSSのパースは `fast-xml-parser` の `XMLParser`。`data.rss.channel.item` を配列化して map する。
- `source` は、明示的な `fallbackSourceLabel`（例: `'Detik'` `'Antara'` `'Kompas'`）があればそれを優先。RSS内 `item.source`（オブジェクトなら `#text`）を次点、どちらも無ければ `'Unknown'`。

---

## 3. モジュール構成と各関数の責務

### scripts/lib/sources.mjs（候補の取得層）

| 関数/定数 | 責務 |
|---|---|
| `sources`（配列） | ソースアダプタの登録簿。`{ id, label, fetch }` を並べるだけ。現在は `detik` / `antara` / `bmkg` / `kompas` の4つ。ソース追加はここに1エントリ足すのみ |
| `fetchAllCandidates()` | `sources` 全件を `Promise.allSettled()` で並行取得。**成功分は `items` に集約、失敗分は握り潰さず `failures`（`{ source: id, error }`）に記録して両方返す**。1ソースが落ちても他は生きる設計 |
| `parseRssItems(xml, {fallbackSourceLabel})` | RSS XML → 候補オブジェクト配列（第2章の形状） |
| `fetchRssSource(url, opts)` | `fetchText()` + `parseRssItems()` |
| `googleNewsSiteSearchUrl(domain, keyword)` | `site:${domain} ${keyword} when:1d` を URLエンコードし Google News検索RSS の URL を作る（`hl=id&gl=ID&ceid=ID:id`） |
| `KOMPAS_QUERIES`（配列） | Kompas用の検索クエリ5本。Kompasは直RSSが無いため Google News のサイト内検索で代替。詳細は各カテゴリドキュメント参照 |
| `fetchKompasViaGoogleNews()` | `KOMPAS_QUERIES` 各クエリを `Promise.allSettled` で取得し、成功分を flatMap。`fallbackSourceLabel: 'Kompas'` を付与 |
| `fetchBmkgEarthquakes()` | BMKG地震API 2エンドポイントを取得し地震候補を生成（詳細は [`categories/safety.md`](./categories/safety.md)） |
| `fetchText()` / `fetchJson()` | `User-Agent`（`DonesiaNaviBot/1.0 ...`）付きfetch。`!res.ok` で throw |

### scripts/crawl-and-draft.mjs（選定・執筆・書き込み層）

| 関数/定数 | 責務 |
|---|---|
| `MAX_ARTICLES` | `Number(process.env.CRAWL_MAX_ARTICLES || 3)`。1回で生成する最大本数 |
| `RECENT_DEDUPE_DAYS` | `14`。直近何日分のタイトルを「重複回避」としてLLMに渡すか |
| `CATEGORY_NAMES` | 7 slug → 日本語カテゴリ名。`CATEGORY_SET`（有効slug集合）と、記事本文フッターの「カテゴリ:」表記に使う |
| `GEMINI_API_URL` | `gemini-flash-latest:generateContent`。モデル差し替え箇所 |
| `ARTICLE_SCHEMA_DESCRIPTION` | LLMに渡す出力フィールド定義（プロンプトに埋め込む） |
| `loadExistingArticles()` | `src/content/articles/` の全 `.md` の frontmatter を正規表現で読み、`sourceUrls`（Set）と `recentTitles`（`pubDate` が今から14日以内のものだけ）と `files` を返す |
| `filterCandidates(items, existingSourceUrls)` | 重複排除（第4章） |
| `draftArticles(candidates, recentTitles)` | Gemini呼び出し（第5章） |
| `validateArticle(article)` | 書き込み前の検証（第6章）。問題点の配列を返す |
| `buildMarkdown(article, pubDateStr)` | frontmatter + 本文の生成。**常に `draft: true`**（第7章） |
| `escapeYaml(value)` | YAML二重引用符文字列用に `\` と `"` をエスケープ |
| `slugify(input)` | ファイル名用スラッグ生成（第7章） |
| `uniqueFilename(existingFiles, dateStr, slug)` | `YYYY-MM-DD-{slug}.md` が衝突したら `-2`, `-3`... を付与 |
| `main()` | 上記を順に実行。`.crawl-result.json` を書き出し、`GITHUB_OUTPUT` があれば `count=` を追記 |

いずれも `main()` 以外の純粋関数（`escapeYaml` / `validateArticle` / `slugify` / `buildMarkdown`）は `export` されており、`main()` を走らせずに単体で import して検証できます（第13章）。

---

## 4. 重複排除ロジック

重複排除は2層です。いずれも `scripts/crawl-and-draft.mjs` 内。

1. **既存記事との突き合わせ（ハードフィルタ、コードで実施）**
   `loadExistingArticles()` が `src/content/articles/` の各 `.md` の frontmatter から `sourceUrl` を抜き `sourceUrls`（Set）を作る。`filterCandidates(items, sourceUrls)` が次を除去する:
   - `item.link` または `item.title` が無い候補
   - `item.link` が `existingSourceUrls` に既にある候補（＝過去に記事化済み）
   - 同一バッチ内で `link` が重複する候補（`seenLinks` による実行内デデュープ）

2. **直近タイトルとの重複回避（ソフトフィルタ、LLMに委任）**
   `recentTitles`（`pubDate` が今から `RECENT_DEDUPE_DAYS`=14日以内の既存記事タイトル）を `draftArticles()` のプロンプトに渡し、「これらと重複する内容は選ぶな」と指示する。コードで機械的に弾いてはおらず、最終判断はLLM。

**既知の制約**: 突き合わせ対象は `main` ブランチ上の既存記事のみ。未マージのオープンPRの中身は見ないため、同じニュースが次回cronで再度ドラフトされうる（`../AUTOMATION.md` の「既知の制約」節）。

---

## 5. Gemini による選定・執筆（draftArticles）

### 呼び出し

- エンドポイント: `GEMINI_API_URL`（`gemini-flash-latest`、無料枠）。ヘッダ `x-goog-api-key: process.env.GEMINI_API_KEY`
- リクエストボディは `{ contents: [{ parts: [{ text: prompt }] }] }`。構造化出力（responseSchema）は使わず、プレーンプロンプト+テキストからのJSON抽出方式
- 候補は送信前に `trimmed` に縮約: `title` / `snippet`（**先頭300字にスライス**）/ `source` / `link` / `pubDate` のみ

### プロンプトの構造（何を指示しているか）

1. **役割**: ドネシアナビ（ジャカルタ在住日本人向け）の記者
2. **選定**: 候補一覧から在住日本人にとって重要度の高いものを**最大 `MAX_ARTICLES` 件**選び日本語記事化
3. **ルール**:
   - 同一の出来事が複数ソースに跨る場合は事実を突き合わせ、本文でどのソースの報道か言及（例:「Kompas、Detik各紙の報道によると」）。食い違う場合は断定を避け保守的に
   - 直近 `RECENT_DEDUPE_DAYS`（14）日以内に扱った `recentTitles` と重複する内容は選ばない
   - 重要な候補が無ければ無理に選ばず0件でよい
4. **出力フォーマット**: `ARTICLE_SCHEMA_DESCRIPTION`（下記フィールド）。`` ```json `` コードブロック内のJSON配列のみで返す。該当なしは `[]`

出力フィールド（`ARTICLE_SCHEMA_DESCRIPTION`）: `title` / `description`（80〜120字）/ `category`（**7 slugから1つ**）/ `tags`（3〜5個）/ `pubDate`（`YYYY-MM-DD`）/ `source`（候補の値をそのまま）/ `sourceUrl`（候補の `link` をそのまま、改変・生成禁止）/ `slug` / `heading` / `keyPoints`（3点程度の配列）/ `body`（2〜3段落プレーンテキスト）。

**カテゴリはここでLLMが本文内容を見て決める**。ソースやKompasクエリはあくまで候補が集まりやすいだけで、ルールベースの振り分けは存在しない。

### 応答パース

- 応答テキストから `` ```json ... ``` `` フェンス内を優先抽出、無ければ `\[[\s\S]*\]`（角括弧）でフォールバック
- `JSON.parse` して配列でなければ throw。抽出できなければ throw
- 得た配列は `main()` 側で `.slice(0, MAX_ARTICLES)` により件数上限を再度キャップ

---

## 6. validateArticle() の検証項目

`content.config.ts` のzodスキーマ違反データをそのまま書き込むと、**マージ後の `astro build` がサイト全体でクラッシュしうる**（`draft:true` でも実害）ため、writeFile前に検証します。問題があればその記事だけスキップ（他は続行）。

| 検証項目 | 条件 |
|---|---|
| `title` | 空でない文字列 |
| `description` | 空でない文字列 |
| `category` | `CATEGORY_SET`（7 slug）のいずれか |
| `tags` | 配列かつ1個以上、全要素が空でない文字列 |
| `source` | 空でない文字列 |
| `sourceUrl` | `new URL()` で解釈できる有効なURL |
| `heading` | 空でない文字列 |
| `keyPoints` | 配列かつ1個以上 |
| `body` | 空でない文字列 |

---

## 7. Markdown生成（buildMarkdown / escapeYaml / slugify）

- **frontmatter**: `title` / `description` / `category` / `tags`（`["...", "..."]`）/ `pubDate` / `source` / `sourceUrl` / `draft: true`。文字列値は `escapeYaml()` で `\` と `"` をエスケープ
- **本文**: `## {heading}` → 「**要点:**」+ `keyPoints` の箇条書き → `body` → 区切り線 → 情報ソースのリンク（`[source](sourceUrl)`）/ カテゴリ（`CATEGORY_NAMES[category]`）/ タグ → 「*この記事はAIが生成し、公開前に人間の編集者がレビューします。*」
- **`draft` は常に `true`** でハードコード。公開時に Slack承認フローが `draft: false` に書き換える
- `slugify()`: 小文字化 → NFKD正規化 → 発音区別符号除去 → 英数字以外を `-` に → 前後の `-` を除去 → 60字にスライス。空なら `'article'`
- `pubDate` は `article.pubDate` が `YYYY-MM-DD` 形式ならそれを、違えば当日（`new Date().toISOString().slice(0,10)`）を採用
- ファイル名は `uniqueFilename()` が `YYYY-MM-DD-{slug}.md`、衝突時は `-2`, `-3`...

---

## 8. エントリポイントガードと副産物

- `scripts/crawl-and-draft.mjs` 末尾は `if (import.meta.url === \`file://${process.argv[1]}\`)` で、直接実行時のみ `main()` を呼ぶ。関数を import してテストしても `main()` は走らない
- `main()` は `.crawl-result.json`（生成した記事のメタ配列）を必ず書き出す（0件でも `[]`）
- `process.env.GITHUB_OUTPUT` があれば `count={件数}` を追記（後続のPR作成ステップの分岐に使用）

---

## 9. PR作成（.github/workflows/crawl-articles.yml）

- トリガー: cron `0 0 * * *`（07:00 WIB）/ `0 4 * * *`（11:00 WIB）+ `workflow_dispatch`
- `npm run crawl` 実行後、`git status --porcelain src/content/articles | grep '^??'` で**新規ファイルの有無**を判定（`has_new`）
- 新規があれば `peter-evans/create-pull-request@v8` で PR作成:
  - `add-paths: src/content/articles/*.md`
  - `branch: auto/articles-${{ github.run_id }}`（この命名で後述の二重通知防止が効く）
  - `commit-message: 'Add draft articles (auto-crawl)'`
- PR番号が取れたら `scripts/notify-draft-pr.mjs --pr=<番号>` を実行

---

## 10. Slack通知（scripts/notify-draft-pr.mjs）

`crawl-articles.yml` と `notify-draft-pr.yml` の両方から呼ばれる共通ロジック。必要env: `GITHUB_TOKEN` / `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` / `GITHUB_REPOSITORY`（+ 任意 `CLOUDFLARE_PAGES_PROJECT`、既定 `donesia-navi`）。

| 関数 | 責務 |
|---|---|
| `loadDraftArticles(prNumber, headSha)` | PRの変更ファイルから `src/content/articles/*.md`（`status !== 'removed'`）を抽出し、各ファイルの frontmatter を `yaml` でパース。`fm.draft` が真のものだけを `{path, id, title, description, category, source}` として返す |
| `pollPreviewUrl(headSha, {retries=12, intervalMs=10000})` | GitHub Checks API（`/commits/{sha}/check-runs`）を最大12回×10秒間隔でポーリング。`name === 'Cloudflare Pages'` の run が `completed` かつ `conclusion === 'success'` になったら、`output.summary` から正規表現 `https://[a-z0-9]+\.{project}\.pages\.dev` でプレビューURLを抽出。失敗/タイムアウト時は `null`（PRリンクにフォールバック） |
| `buildBlocks(pr, articles, previewUrl)` | Block Kit を組み立て |
| `postSlackMessage()` | `chat.postMessage` に投稿。`data.ok` が偽なら throw |

### Block Kit構造（buildBlocks）

- `header`: 「📝 新しいドラフト記事 (N件)」
- 記事ごとの `section`: タイトルをリンク（プレビューがあれば `{previewUrl}/articles/{id}/`、無ければ `pr.html_url`）+ 概要 + 「カテゴリ: … / ソース: …」
- プレビューURLが取れなかった場合は `context` で警告表示
- `actions`（`block_id: 'draft_pr_actions'`）:
  - 「✅ 承認して公開」ボタン（`style: 'primary'`、`action_id: 'approve_publish'`）
    - **`value`**: `JSON.stringify({ pr: pr.number, repo: REPO })`（承認Webhook側がこれを読む）
    - `confirm` 確認ダイアログ付き
  - 「PRを見る」ボタン（`url: pr.html_url`）

---

## 11. Slack承認（functions/api/slack-interactivity.js）

Cloudflare Pages Functions。ルート `POST /api/slack-interactivity`。必要env: `SLACK_SIGNING_SECRET` / `GITHUB_TOKEN`。

| 関数 | 責務 |
|---|---|
| `onRequestPost(context)` | 生ボディ取得 → 署名検証 → `payload` パース → `actions[0].action_id === 'approve_publish'` 以外は 200で無視 → `action.value` を JSON パースして `{pr, repo}` 取得 → `context.waitUntil(publishPr(...))` で非同期処理を継続（レスポンスは即 200返却） |
| `verifySlackSignature(request, rawBody, secret)` | `X-Slack-Request-Timestamp` の齢が5分（`REQUEST_MAX_AGE_SECONDS`）以内かを確認。`v0:{timestamp}:{rawBody}` を HMAC-SHA256 で署名し、`X-Slack-Signature` と `timingSafeEqual()` で定数時間比較 |
| `publishPr({env, repo, prNumber, responseUrl, clickedBy})` | PR取得→ブランチ（`pr.head.ref`）特定→変更ファイルの各記事について、**frontmatterブロック（先頭 `---`〜次の `---`）の中だけ** `draft:\s*true` を `draft: false` に置換し Contents API でコミット。本文中の同文字列で誤爆しない設計。frontmatter内に `draft:true` が2箇所以上あれば想定外として throw。全件更新後 `mergeWithRetry()` |
| `mergeWithRetry(env, repo, prNumber, {retries=5, intervalMs=2000})` | merge が非同期のmergeable判定遅れで返す **405「not mergeable」** を最大5回・2秒間隔でリトライ。405以外のエラーは即throw |
| `updateSlackMessage(responseUrl, text)` | `response_url` に `replace_original: true` で結果メッセージを反映 |

承認ボタンは Slackチャンネルにアクセスできる全員が押せる（ユーザー単位の権限制御なし。`../AUTOMATION.md`「Slack承認フローの補足」）。

---

## 12. 生成ロジックを変えたいときの変更箇所マップ

| 変えたいこと | 触るファイル・関数/定数 |
|---|---|
| **候補の質**（どのソース/クエリから拾うか） | `scripts/lib/sources.mjs`: `sources` 配列（ソース追加）/ `KOMPAS_QUERIES`（Kompasクエリ）/ 各 `fetch*` 関数 |
| **選定基準**（何を重要とみなすか） | `scripts/crawl-and-draft.mjs` `draftArticles()` のプロンプト「# ルール」節 |
| **文体・記事構成** | `draftArticles()` のプロンプト + `ARTICLE_SCHEMA_DESCRIPTION` + `buildMarkdown()`（本文テンプレート） |
| **1回の本数** | 環境変数 `CRAWL_MAX_ARTICLES`（既定は `MAX_ARTICLES` の3）。CI側で設定するなら `crawl-articles.yml` の `env` |
| **モデル** | `scripts/crawl-and-draft.mjs` `GEMINI_API_URL` |
| **検証（受け入れ基準）** | `validateArticle()` + `src/content.config.ts` のzodスキーマ |
| **重複判定の範囲・期間** | `RECENT_DEDUPE_DAYS` / `loadExistingArticles()` / `filterCandidates()` |
| **通知の見た目** | `scripts/notify-draft-pr.mjs` `buildBlocks()` |
| **承認の挙動**（公開時の処理） | `functions/api/slack-interactivity.js` `publishPr()` |
| **実行スケジュール** | `.github/workflows/crawl-articles.yml` の `cron` |
| **カテゴリの増減** | `src/content.config.ts`（`category` enum + `mapData`）+ `scripts/crawl-and-draft.mjs` `CATEGORY_NAMES` + `src/lib/categories.ts`（サイト表示メタ）の3箇所を揃える |

---

## 13. ローカルでのテスト方法

`package.json` の `scripts`（実際の定義）:

| コマンド | 実体 | 備考 |
|---|---|---|
| `npm run crawl` | `node scripts/crawl-and-draft.mjs` | **記事生成のみ**。`GEMINI_API_KEY` 必須。`src/content/articles/` に実ファイルを書き込む。PR作成・Slack通知はしない（CI側の後続ステップでのみ発生） |
| `npm run discover-restaurants` | `node scripts/discover-restaurants.mjs` | 飲食店ガイド用。[`categories/lifestyle.md`](./categories/lifestyle.md) 参照 |

- **dry-runフラグは無い**。`scripts/crawl-and-draft.mjs` には CLIオプションの解析が無く（唯一の `process.argv` 参照は末尾の実行判定ガード `import.meta.url === \`file://${process.argv[1]}\``のみ）、実行すると必ず Gemini を呼び本番同様に `.md` を書き込む。挙動を絞る手段は環境変数 `CRAWL_MAX_ARTICLES` のみ
- 純粋関数（`escapeYaml` / `validateArticle` / `slugify` / `buildMarkdown`）は `export` 済みなので、`main()` を走らせずに import して個別に確認できる（第8章のエントリポイントガード）
- `scripts/notify-draft-pr.mjs` は `--pr=<番号>` を取り、`GITHUB_TOKEN` / `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` / `GITHUB_REPOSITORY` が揃えば単体実行可能

---

## 関連ドキュメント

- [`../AUTOMATION.md`](../AUTOMATION.md) — セットアップ・運用コマンド・コスト・既知の制約
- [`../CONTENT-SOURCES.md`](../CONTENT-SOURCES.md) — 情報源・更新方式の俯瞰
- カテゴリ別詳細: [`categories/safety.md`](./categories/safety.md) / [`categories/society.md`](./categories/society.md) / [`categories/business.md`](./categories/business.md) / [`categories/travel.md`](./categories/travel.md) / [`categories/visa.md`](./categories/visa.md) / [`categories/regulation.md`](./categories/regulation.md) / [`categories/lifestyle.md`](./categories/lifestyle.md)
</content>
</invoke>
