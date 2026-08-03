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

**Kompasの `link` は直リンク化を試みる（D-4、2026-08-03対応）**: `fetchKompasViaGoogleNews()` はGoogle News検索RSSから得た仲介URL（`news.google.com/rss/articles/...`）を、`resolveDirectLink()` で `kompas.com` の実記事URLに解決してから返す。解決できない場合は元の仲介URLのままフォールバックする（fail-open。呼び出し側は常に「解決済みかもしれないURL文字列」として扱えばよく、成否を意識する必要はない）。詳細は後述の「14. Kompas直リンク解決（D-4）」を参照。

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
| `KOMPAS_QUERIES`（配列） | Kompas用の検索クエリ6本（2026-08-03に`society`専用クエリを追加し5→6本）。Kompasは直RSSが無いため Google News のサイト内検索で代替。詳細は各カテゴリドキュメント参照 |
| `fetchKompasViaGoogleNews()` | `KOMPAS_QUERIES` 各クエリを `Promise.allSettled` で取得し、成功分を flatMap。`fallbackSourceLabel: 'Kompas'` を付与した後、`resolveDirectLink()`（D-4）で各item.linkを実記事URLへ解決してから返す |
| `extractGoogleNewsId(link)` | `news.google.com/rss/articles/<id>` または `/rss/read/<id>` からGoogle News内部の記事IDを取り出す。google.com以外やパス不一致は`null`（D-4、export済み） |
| `resolveDirectLink(link, timeoutMs?)` | Google仲介URLを実記事URLへ解決する（D-4）。(a)通常のHTTPリダイレクト追跡→(b)google.comのままならGoogle News内部API（batchexecute）のデコードを試行→(c)いずれも失敗時は元のURLのまま返す（fail-open、例外を投げない）。既定タイムアウト5秒。export済み |
| `parseBatchExecuteResponse(text)` | Google News内部APIのレスポンス本文（`)]}'` プレフィックス付きJSON）から実記事URLを取り出す純関数。想定外の形状は例外を投げる（呼び出し側の`resolveDirectLink()`でfail-openに変換）。export済み |
| `mapWithConcurrency(items, limit, fn)` | 並行数を`limit`に絞って`fn`を実行するユーティリティ（D-4で`resolveDirectLink`の並行実行に使用。既定並行数5）。export済み |
| `fetchBmkgEarthquakes()` | BMKG地震API 2エンドポイントを取得し地震候補を生成（詳細は [`categories/safety.md`](./categories/safety.md)） |
| `fetchText()` / `fetchJson()` | `User-Agent`（`DonesiaNaviBot/1.0 ...`）付きfetch。`!res.ok` で throw |

### scripts/crawl-and-draft.mjs（選定・執筆・書き込み層）

| 関数/定数 | 責務 |
|---|---|
| `MAX_ARTICLES` | `Number(process.env.CRAWL_MAX_ARTICLES || 3)`。1回で生成する最大本数 |
| `RECENT_DEDUPE_DAYS` | `14`。直近何日分のタイトルを「重複回避」としてLLMに渡すか |
| `CATEGORY_NAMES` | 7 slug → 日本語カテゴリ名。`CATEGORY_SET`（有効slug集合）と、記事本文フッターの「カテゴリ:」表記に使う |
| `GEMINI_API_URL` | `gemini-flash-latest:generateContent`。モデル差し替え箇所 |
| `ARTICLE_SCHEMA_DESCRIPTION` | LLMに渡す出力フィールド定義（プロンプトに埋め込む。人間可読の説明文） |
| `ARTICLE_RESPONSE_SCHEMA` | Gemini APIの`responseSchema`（D-5、2026-08-03追加）。`ARTICLE_SCHEMA_DESCRIPTION`のフィールドと同じ内容をOpenAPIサブセット形式で機械的に強制する。詳細は第5章 |
| `parseGeminiArticlesResponse(text)` | Gemini応答テキストからarticle配列を取り出す（D-5、第5章「応答パース」参照）。export済み |
| `parseFrontmatterBlock(content)` | frontmatterブロック（`---`〜`---`）から`sourceUrl`/`title`/`pubDate`を正規表現で取り出す純関数。`loadExistingArticles()`と`fetchOpenPrDedupeData()`（D-6）の共通ロジック。export済み |
| `loadExistingArticles()` | `src/content/articles/` の全 `.md` の frontmatter を `parseFrontmatterBlock()` で読み、`sourceUrls`（Set）と `recentTitles`（`pubDate` が今から14日以内のものだけ）と `files` を返す |
| `fetchOpenPrDedupeData({token?, repo?})` | オープンPR内で新規追加された記事ファイルのfrontmatterから`sourceUrl`/`title`を集める（D-6、第4章参照）。export済み |
| `filterCandidates(items, existingSourceUrls)` | 重複排除（第4章） |
| `draftArticles(candidates, recentTitles)` | Gemini呼び出し（第5章） |
| `validateArticle(article)` | 書き込み前の検証（第6章）。問題点の配列を返す |
| `buildMarkdown(article, pubDateStr)` | frontmatter + 本文の生成。**常に `draft: true`**（第7章） |
| `escapeYaml(value)` | YAML二重引用符文字列用に `\` と `"` をエスケープ |
| `slugify(input)` | ファイル名用スラッグ生成（第7章） |
| `uniqueFilename(existingFiles, dateStr, slug)` | `YYYY-MM-DD-{slug}.md` が衝突したら `-2`, `-3`... を付与 |
| `main()` | 上記を順に実行。`.crawl-result.json` を書き出し、`GITHUB_OUTPUT` があれば `count=` を追記 |

`main()` 以外の純粋関数（`escapeYaml` / `validateArticle` / `slugify` / `buildMarkdown` / `parseGeminiArticlesResponse` / `parseFrontmatterBlock` / `fetchOpenPrDedupeData`）は `export` されており、`main()` を走らせずに単体で import して検証できます（第13章）。`node --test` によるユニットテストが `scripts/crawl-and-draft.test.mjs` / `scripts/lib/sources.test.mjs` に整備済み（D-8）。

---

## 4. 重複排除ロジック

重複排除は2層です。いずれも `scripts/crawl-and-draft.mjs` 内。

1. **既存記事＋オープンPRとの突き合わせ（ハードフィルタ、コードで実施）**
   `loadExistingArticles()` が `src/content/articles/` の各 `.md` の frontmatter から `sourceUrl` を抜き `sourceUrls`（Set）を作る。これに加えて `fetchOpenPrDedupeData()`（D-6、2026-08-03追加）が **オープンPR** 内で新規追加された `src/content/articles/*.md`（`status === 'added'`）のfrontmatterから `sourceUrl` / `title` を取得し、同じ`sourceUrls`セットと`recentTitles`配列に合流させる。`filterCandidates(items, sourceUrls)` が次を除去する:
   - `item.link` または `item.title` が無い候補
   - `item.link` が `existingSourceUrls`（既存記事＋オープンPR分を統合したSet）に既にある候補（＝過去に記事化済み、またはレビュー待ちPR内で既にドラフト済み）
   - 同一バッチ内で `link` が重複する候補（`seenLinks` による実行内デデュープ）

   `fetchOpenPrDedupeData()` は `GITHUB_TOKEN` / `GITHUB_REPOSITORY`（`.github/workflows/crawl-articles.yml` のcrawlステップで設定。`github.repository` / `secrets.GITHUB_TOKEN`）が無い場合は何もせずスキップする（ローカル実行時はネットワークアクセス自体が発生しない）。GitHub API呼び出しが失敗した場合も警告ログを出すだけで処理を継続する（fail-open。既存記事のみでの重複排除にフォールバック）。

2. **直近タイトルとの重複回避（ソフトフィルタ、LLMに委任）**
   `recentTitles`（既存記事のうち`pubDate`が今から `RECENT_DEDUPE_DAYS`=14日以内のタイトル + オープンPR内のドラフト記事タイトル）を `draftArticles()` のプロンプトに渡し、「これらと重複する内容は選ぶな」と指示する。コードで機械的に弾いてはおらず、最終判断はLLM。

**既知の制約（2026-08-03、D-6対応で緩和）**: 従来は突き合わせ対象が `main` ブランチ上の既存記事のみで、未マージのオープンPRの中身は見ていなかった（同じニュースが次回cronで再度ドラフトされうる問題があった）。D-6でオープンPRも突き合わせ対象に加わったが、これは `GITHUB_TOKEN` / `GITHUB_REPOSITORY` が利用可能なCI実行時のみ有効。ローカル実行（`npm run crawl`単体）ではこれらの環境変数が無いため引き続き既存記事のみでの重複排除になる。

---

## 5. Gemini による選定・執筆（draftArticles）

### 呼び出し

- エンドポイント: `GEMINI_API_URL`（`gemini-flash-latest`、無料枠）。ヘッダ `x-goog-api-key: process.env.GEMINI_API_KEY`
- リクエストボディは `{ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: ARTICLE_RESPONSE_SCHEMA } }`（**D-5、2026-08-03対応**）。`responseSchema` はGemini APIのOpenAPI 3.0サブセット形式（`type`は`STRING`/`ARRAY`/`OBJECT`等の大文字列挙値）で、トップレベルを`type: 'ARRAY'`（`items: {type: 'OBJECT', ...}`）にすることで「記事オブジェクトの配列」という形をAPI側に強制させる。`category`フィールドには`enum: Object.keys(CATEGORY_NAMES)`（7 slug）を指定し、不正なカテゴリ文字列が返る余地自体を減らす。`required`/`propertyOrdering`は`ARTICLE_SCHEMA_DESCRIPTION`のフィールド順と揃えてある
- 候補は送信前に `trimmed` に縮約: `title` / `snippet`（**先頭300字にスライス**）/ `source` / `link` / `pubDate` のみ
- **要監視（2026-08-03時点で未検証）**: ローカルに `GEMINI_API_KEY` が無い環境で実装したため、`responseSchema`込みの実呼び出しは一度も検証できていない。Gemini REST APIの公式ドキュメント（`ai.google.dev/api/generate-content`のSchema定義）に準拠する形で実装したが、**次回cron実行時（07:00/11:00 WIB）のログとPR生成結果を要監視**。もし`responseSchema`が原因でGemini APIがエラーを返す場合は、`generationConfig`ごと取り除けば旧来のプレーンプロンプト方式に戻せる（`parseGeminiArticlesResponse()`のフォールバック経路は維持されているため、パース側の後方互換は保たれる）

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

### 応答パース（`parseGeminiArticlesResponse()`、D-5で強化）

`generationConfig.responseSchema` を指定したことで、応答テキストはコードフェンス無しの素のJSON配列になることが期待されるが、モデルの挙動保証はできないため多段フォールバックを維持する:

1. **素のJSON.parseを試す**（`responseMimeType: 'application/json'` 指定時の想定経路）。パースできて配列ならそれを返す
2. 1.が失敗、またはパースできても配列でない場合 → 応答テキストから `` ```json ... ``` `` フェンス内を優先抽出、無ければ `\[[\s\S]*\]`（角括弧）でフォールバック抽出（**既存の抽出ロジックはそのまま維持**）
3. `JSON.parse` して配列でなければ throw。抽出できなければ throw

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
- `npm run crawl` 実行ステップには `GEMINI_API_KEY` に加えて `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` / `GITHUB_REPOSITORY: ${{ github.repository }}` を渡す（**D-6、2026-08-03追加**。`fetchOpenPrDedupeData()` がオープンPRを列挙するために使用。GitHub Actionsのデフォルト`GITHUB_TOKEN`で`pulls`/`contents`の読み取りは可能）
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
| **応答の構造化出力（responseSchema）** | `scripts/crawl-and-draft.mjs` `ARTICLE_RESPONSE_SCHEMA` / `ARTICLE_FIELD_ORDER`（D-5） |
| **検証（受け入れ基準）** | `validateArticle()` + `src/content.config.ts` のzodスキーマ |
| **重複判定の範囲・期間** | `RECENT_DEDUPE_DAYS` / `loadExistingArticles()` / `filterCandidates()` / `fetchOpenPrDedupeData()`（D-6、オープンPR分） |
| **Kompas仲介URLの直リンク解決** | `scripts/lib/sources.mjs` `resolveDirectLink()` / `LINK_RESOLVE_TIMEOUT_MS` / `LINK_RESOLVE_CONCURRENCY`（D-4） |
| **通知の見た目** | `scripts/notify-draft-pr.mjs` `buildBlocks()` |
| **承認の挙動**（公開時の処理） | `functions/api/slack-interactivity.js` `publishPr()` |
| **実行スケジュール** | `.github/workflows/crawl-articles.yml` の `cron` |
| **カテゴリの増減** | `src/content.config.ts`（`category` enum + `mapData`）+ `scripts/crawl-and-draft.mjs` `CATEGORY_NAMES` + `src/lib/categories.ts`（サイト表示メタ）の3箇所を揃える |
| **テスト** | `scripts/crawl-and-draft.test.mjs` / `scripts/lib/sources.test.mjs`（D-8、`node --test`） |

---

## 13. ローカルでのテスト方法

`package.json` の `scripts`（実際の定義）:

| コマンド | 実体 | 備考 |
|---|---|---|
| `npm run crawl` | `node scripts/crawl-and-draft.mjs` | **記事生成のみ**。`GEMINI_API_KEY` 必須。`src/content/articles/` に実ファイルを書き込む。PR作成・Slack通知はしない（CI側の後続ステップでのみ発生） |
| `npm run discover-restaurants` | `node scripts/discover-restaurants.mjs` | 飲食店ガイド用。[`categories/lifestyle.md`](./categories/lifestyle.md) 参照 |
| `npm test` | `node --test 'scripts/**/*.test.mjs'`（**D-8、2026-08-03追加**） | ユニットテスト一式。ネットワークアクセス・APIキーとも不要（GitHub API/fetchはモック化）。`.github/workflows/test.yml` が `push`（main）と `pull_request` で自動実行 |

- **dry-runフラグは無い**。`scripts/crawl-and-draft.mjs` には CLIオプションの解析が無く（唯一の `process.argv` 参照は末尾の実行判定ガード `import.meta.url === \`file://${process.argv[1]}\``のみ）、実行すると必ず Gemini を呼び本番同様に `.md` を書き込む。挙動を絞る手段は環境変数 `CRAWL_MAX_ARTICLES` のみ
- 純粋関数（`escapeYaml` / `validateArticle` / `slugify` / `buildMarkdown` / `parseGeminiArticlesResponse` / `parseFrontmatterBlock`）と、ネットワークアクセスをfetchモックで検証するテスト対象関数（`fetchOpenPrDedupeData` / `resolveDirectLink` / `extractGoogleNewsId` / `parseBatchExecuteResponse` / `mapWithConcurrency`）は `export` 済みなので、`main()` を走らせずに import して個別に確認できる（第8章のエントリポイントガード）
- **`node --test` のglob指定は要注意**: `package.json` の `test` スクリプトは `node --test 'scripts/**/*.test.mjs'` のようにglobパターンをシングルクォートで囲む必要がある。クォート無しだと呼び出し元シェル（`npm`経由だと`/bin/sh`、macOS/Linuxとも既定でdash相当）が`**`をglobstarとして展開せず`scripts/*/*.test.mjs`のように1階層のみにマッチしてしまい、`scripts/`直下の`.test.mjs`（`crawl-and-draft.test.mjs`）が実行されなくなる。`node --test scripts`（ディレクトリ指定のみ、glob無し）は本バージョンのNodeでは動作しなかった（`Cannot find module 'scripts'`エラー）ため不採用
- `scripts/notify-draft-pr.mjs` は `--pr=<番号>` を取り、`GITHUB_TOKEN` / `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` / `GITHUB_REPOSITORY` が揃えば単体実行可能

---

## 14. Kompas直リンク解決の仕組み（D-4、2026-08-03追加）

Google News検索RSSの `item.link` は `https://news.google.com/rss/articles/<内部ID>?oc=5` という仲介URLで、ブラウザでは実記事に自動遷移するが機械的なfetchでは直接読めない。`resolveDirectLink()`（`scripts/lib/sources.mjs`）は次の手順で実記事URL（`kompas.com`等）への解決を試みる:

1. **(a) 通常のHTTPリダイレクト追跡**: `fetch(link, {redirect:'follow'})` の `res.url` を見る。実測では、Google側がこの経路では`news.google.com`のまま（`hl`/`gl`/`ceid`パラメータが付与されるのみ）を返し、素のリダイレクトでは解決しないことを確認済み（それでも将来別の仲介URL形式が出てきた場合に備えて最初に試す）
2. **(b) Google News内部APIのデコード**: (a)の結果がまだ`google.com`ドメインの場合、そのレスポンス本文（(a)で取得したHTMLをそのまま再利用し、二重fetchはしない）から `data-n-a-sg` / `data-n-a-ts` 属性（署名とタイムスタンプ）を正規表現で取り出し、Google Newsの内部API `https://news.google.com/_/DotsSplashUi/data/batchexecute`（`rpcids=Fbv4je`）にPOSTする。レスポンスは `)]}'` プレフィックス付きJSONで、`["garturlres", "<実URL>", 1]` という配列が埋め込まれている（`parseBatchExecuteResponse()`が抽出）
3. **(c) fail-open**: (a)(b)いずれの過程でも例外が発生した場合（タイムアウト・想定外のレスポンス形状・ネットワークエラー等）は、元の仲介URLをそのまま返す。呼び出し側（`fetchKompasViaGoogleNews()`）は常に文字列を受け取るだけでよく、解決の成否を意識する必要はない

### 実証結果（実装前後に複数回実測）

- 単発の少数サンプル検証（実装検討時）: `pemprov jakarta kebijakan warga` クエリの20件で **20/20件（100%）**、別3クエリの13件で **13/13件（100%）**（累計33/33件）。短いタイムアウト（1ms）を強制した場合はタイムアウトで例外化され、元URLへのfail-openが正しく働くことも確認済み
- 実装後、`fetchAllCandidates()`（全ソース込み・本番と同じ並行数5・タイムアウト5秒）を3回実行した結果: **105/105件（100%）**、**70/104件（67%）**、**101/101件（100%）**
  - 67%に落ちた回の原因を追跡したところ、失敗理由はすべて `This operation was aborted`（自前の5秒タイムアウトによる中断）であり、パースエラーやfail-open外の例外は0件だった。同一クエリ・同一件数でも並行数5で負荷をかけた状態だとGoogle側のレイテンシが伸びる瞬間があり、5秒以内に完了しない項目が一定数出る（=fail-openで元の仲介URLのまま残る）ことを示している
  - 3回の合計では **276/280件（約99%）** が解決成功。単発失敗時も例外はfail-open内で吸収されており、クラッシュや誤ったURLが書き込まれる事象は一度も観測していない
  - **確信度: 中** — Google側の応答速度は日によって変動しうるため、本番cronでの実測（ログの`失敗理由`相当の記録は現状無いため、Kompas記事の`sourceUrl`が引き続き`news.google.com`のままかどうかで間接的に確認可能）を継続的に見ておくことが望ましい

### パフォーマンス上の注意

- 並行数は `LINK_RESOLVE_CONCURRENCY = 5`、1件あたりのタイムアウトは `LINK_RESOLVE_TIMEOUT_MS = 5000`（5秒）
- 並行数を10まで上げても所要時間はほぼ変わらなかった（56件で21.7秒→19.1秒）ため、Google側のレイテンシがボトルネックと判断し、安全側の5を採用した
- 解決は `fetchKompasViaGoogleNews()` 内、**重複排除（`filterCandidates()`）より前**に行う。これにより、異なるKompasクエリが同一記事を別々の仲介URLで返してきた場合でも、解決後は同じ実URLになるため正しく重複排除できるという副次効果がある

---

## 15. 今後のソース候補（D-2、2026-08-03調査・見送り）

以下3つの一次ソースについて、安定した機械可読フィード（RSS/Atom/JSON API）の有無を実フェッチで調査したが、**いずれも安定したフィードが確認できず追加を見送った**。将来再調査する際の参考として記録する。

| ソース | 試したURL | 結果 | 断念理由 |
|---|---|---|---|
| BNPB（国家防災庁、`bnpb.go.id`） | `/`, `/feed`, `/rss`, `/berita/rss`, `/wp-json/` 等 | トップページ含め全パスで**HTTP 520**（Cloudflareのオリジンサーバーエラー）。経路によっては403も観測 | サイト自体が現状不安定/到達不能で、RSS/JSON以前の問題。フィード形式の有無を判定できる状態にない |
| imigrasi.go.id（入国管理局） | `/`, `/berita`, `/feed/`, `/rss`, `/wp-json/` 等 | トップページ・`/berita`は200（HTML）だが、`/feed/`や`/wp-json/`は301後404。HTML内に`rel="alternate" type="application/rss+xml"`等のRSS自動検出タグやWordPressの痕跡なし（独自CMS） | 機械可読フィードが存在しない。HTML一覧ページのスクレイピングしか手段がなく、壊れやすいため今回の採用基準（安定した機械可読フィード）を満たさない |
| 在インドネシア日本国大使館（`id.emb-japan.go.jp`）+ 関連の外務省海外安全情報（`anzen.mofa.go.jp`） | `/`, `/rss`, `/feed`, `/itpr_ja/index.html`, `/itprtop_ja/index.html` 等 | ルート含む多くのパスがAkamai WAFで**403 Access Denied**（bot判定）。実在の下層ページ（`/itprtop_ja/`等）は200だがRSS/Atomタグなしの静的HTML。`anzen.mofa.go.jp`はSPAのソフト404 | 機械可読フィードが存在しないことに加え、WAFによる自動アクセスブロックがありパイプライン運用上も不安定 |

**総合方針**: 3ソースとも `{id, label, fetch}` パターンでのアダプタ追加はせず、現状の Detik/Antara/BMKG/Kompas の4系統を維持する。将来これらの機関が正式なAPI/フィードを公開した場合は再調査の余地あり。

---

## 関連ドキュメント

- [`../AUTOMATION.md`](../AUTOMATION.md) — セットアップ・運用コマンド・コスト・既知の制約
- [`../CONTENT-SOURCES.md`](../CONTENT-SOURCES.md) — 情報源・更新方式の俯瞰
- カテゴリ別詳細: [`categories/safety.md`](./categories/safety.md) / [`categories/society.md`](./categories/society.md) / [`categories/business.md`](./categories/business.md) / [`categories/travel.md`](./categories/travel.md) / [`categories/visa.md`](./categories/visa.md) / [`categories/regulation.md`](./categories/regulation.md) / [`categories/lifestyle.md`](./categories/lifestyle.md)
</content>
</invoke>
