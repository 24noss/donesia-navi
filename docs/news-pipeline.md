# ニュース自動生成エンジン 詳細（共通深掘り）

ニュース系6カテゴリ（`safety` / `society` / `business` / `travel` / `visa` / `regulation`）とグルメ（`gourmet`、foodレーン。第16章）の記事を作る共通エンジンの内部仕様を、コード（ファイル+関数/定数名）ベースでまとめたものです。「この記事はどうやって出来ているのか」「生成の質を変えたい」ときの一次資料として使います。

- セットアップ手順・運用コマンド・コスト・既知の制約は [`../AUTOMATION.md`](../AUTOMATION.md) を参照
- 情報源・更新方式の一覧（俯瞰）は [`../CONTENT-SOURCES.md`](../CONTENT-SOURCES.md) を参照
- カテゴリ固有の情報源・チューニングは [`categories/`](./categories/) の各ファイルを参照
- 飲食店ガイド（`gourmet`の5選記事等）は別エンジンです。[`categories/gourmet.md`](./categories/gourmet.md) を参照（経緯は[`categories/lifestyle.md`](./categories/lifestyle.md)冒頭も参照）

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
| `sources`（配列） | newsレーン用ソースアダプタの登録簿。`{ id, label, fetch }` を並べるだけ。現在は `detik` / `antara` / `bmkg` / `kompas` の4つ。ソース追加はここに1エントリ足すのみ |
| `foodSources`（配列） | foodレーン用ソースアダプタの登録簿（**2026-08-11追加**）。`detikFood` / `foodGoogleNews` の2つ。`sources`とは独立。詳細は第16章 |
| `getSourcesForLane(lane)` | `lane === 'food'` なら`foodSources`、それ以外は`sources`を返す純関数（**2026-08-11追加**）。export済み |
| `fetchAllCandidates(lane = 'news')` | `getSourcesForLane(lane)`で選んだソース全件を `Promise.allSettled()` で並行取得。**成功分は `items` に集約、失敗分は握り潰さず `failures`（`{ source: id, error }`）に記録して両方返す**。1ソースが落ちても他は生きる設計。**2026-08-11、`lane`引数を追加（デフォルト`'news'`のため既存の無引数呼び出しは挙動不変）** |
| `parseRssItems(xml, {fallbackSourceLabel})` | RSS XML → 候補オブジェクト配列（第2章の形状） |
| `fetchRssSource(url, opts)` | `fetchText()` + `parseRssItems()` |
| `googleNewsSiteSearchUrl(domain, keyword)` | `site:${domain} ${keyword} when:1d` を URLエンコードし Google News検索RSS の URL を作る（`hl=id&gl=ID&ceid=ID:id`）。site制限付き（Kompas用） |
| `googleNewsSearchUrl(query)`（**2026-08-11追加**） | site制限なしの一般Google News検索RSSのURLを作る純関数（`hl=id&gl=ID&ceid=ID:id`）。`when:`期間はquery文字列側に含める前提（foodレーンの`FOOD_QUERIES`が`when:7d`を内包）。export済み |
| `KOMPAS_QUERIES`（配列） | Kompas用の検索クエリ6本（2026-08-03に`society`専用クエリを追加し5→6本）。Kompasは直RSSが無いため Google News のサイト内検索で代替。詳細は各カテゴリドキュメント参照 |
| `FOOD_QUERIES`（配列、**2026-08-11追加**） | foodレーン用の一般検索クエリ6本（`restoran baru jakarta when:7d` 等）。週2回実行のため全クエリに`when:7d`を含む。export済み。詳細は第16章 |
| `fetchGoogleNewsSearchUrls(urls, {fallbackSourceLabel?})`（**2026-08-11追加**） | 複数のGoogle News検索RSS URLを並行取得しflatMapした後、`resolveDirectLink()`（D-4）で実記事URLへ解決する共通処理。`fetchKompasViaGoogleNews()`と`fetchFoodViaGoogleNews()`の共通実装（内部関数、未export） |
| `fetchKompasViaGoogleNews()` | `KOMPAS_QUERIES`から`googleNewsSiteSearchUrl()`でURLを組み立て、`fetchGoogleNewsSearchUrls(urls, {fallbackSourceLabel: 'Kompas'})`を呼ぶ。**2026-08-11、内部実装を`fetchGoogleNewsSearchUrls()`へリファクタしたが、外部から見た挙動（返り値の形状・fallbackSourceLabelの付与）は不変** |
| `fetchFoodViaGoogleNews()`（**2026-08-11追加**） | `FOOD_QUERIES`から`googleNewsSearchUrl()`でURLを組み立て、`fetchGoogleNewsSearchUrls(urls)`を呼ぶ（fallbackSourceLabelなし＝RSS内の実際の媒体名をそのまま使う）。`foodSources`の`foodGoogleNews`エントリから使用 |
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
| `resolveLane(argv, env)`（**2026-08-11追加**） | レーン決定の純関数。優先順位は CLI引数 `--lane=food`/`--lane=news` > 環境変数 `CRAWL_LANE` > デフォルト`'news'`。不正な値は次の優先順位にフォールバック。export済み。詳細は第16章 |
| `isDryRun(argv)`（**2026-08-11追加**） | `argv`に`--dry-run`が含まれるかを返す純関数。export済み |
| `CATEGORY_NAMES` | 8 slug → 日本語カテゴリ名（**2026-08-11、`gourmet`追加。第16章参照**）。`CATEGORY_SET`（有効slug集合）と、記事本文フッターの「カテゴリ:」表記に使う |
| `GEMINI_API_URL` | `gemini-flash-latest:generateContent`。モデル差し替え箇所 |
| `ARTICLE_SCHEMA_DESCRIPTION` | LLMに渡す出力フィールド定義（プロンプトに埋め込む。人間可読の説明文）。**2026-08-11、`gourmet`カテゴリの説明と`placeCandidates`フィールドの説明を追加、`lifestyle`の説明文から飲食要素を除去** |
| `ARTICLE_RESPONSE_SCHEMA` | Gemini APIの`responseSchema`（D-5、2026-08-03追加）。`ARTICLE_SCHEMA_DESCRIPTION`のフィールドと同じ内容をOpenAPIサブセット形式で機械的に強制する。詳細は第5章。**2026-08-11、optionalな`placeCandidates`配列を追加（第16章）** |
| `parseGeminiArticlesResponse(text)` | Gemini応答テキストからarticle配列を取り出す（D-5、第5章「応答パース」参照）。export済み |
| `parseFrontmatterBlock(content)` | frontmatterブロック（`---`〜`---`）から`sourceUrl`/`title`/`pubDate`を正規表現で取り出す純関数。`loadExistingArticles()`と`fetchOpenPrDedupeData()`（D-6）の共通ロジック。export済み |
| `loadExistingArticles()` | `src/content/articles/` の全 `.md` の frontmatter を `parseFrontmatterBlock()` で読み、`sourceUrls`（Set）と `recentTitles`（`pubDate` が今から14日以内のものだけ）と `files` を返す |
| `fetchOpenPrDedupeData({token?, repo?})` | オープンPR内で新規追加された記事ファイルのfrontmatterから`sourceUrl`/`title`を集める（D-6、第4章参照）。export済み |
| `filterCandidates(items, existingSourceUrls)` | 重複排除（第4章） |
| `buildNewsPrompt(trimmed, recentTitles)` / `buildFoodPrompt(trimmed, recentTitles)`（**2026-08-11追加**） | レーンごとのプロンプト文字列を組み立てる（内部関数、未export）。第16章参照 |
| `draftArticles(candidates, recentTitles, lane = 'news')` | Gemini呼び出し（第5章）。**2026-08-11、`lane`引数を追加**。`lane === 'food'`なら`buildFoodPrompt()`、それ以外は`buildNewsPrompt()`を使う（デフォルト`'news'`のため既存呼び出しの挙動は不変） |
| `validateArticle(article)` | 書き込み前の検証（第6章）。問題点の配列を返す。`placeCandidates`は検証対象外（任意フィールドのため未指定でもエラーにしない） |
| `buildMarkdown(article, pubDateStr)` | frontmatter + 本文の生成。**常に `draft: true`**（第7章）。`article.placeCandidates`は参照しない（frontmatterに書かれない。第16章） |
| `escapeYaml(value)` | YAML二重引用符文字列用に `\` と `"` をエスケープ |
| `slugify(input)` | ファイル名用スラッグ生成（第7章） |
| `uniqueFilename(existingFiles, dateStr, slug)` | `YYYY-MM-DD-{slug}.md` が衝突したら `-2`, `-3`... を付与 |
| `main()` | 上記を順に実行。`.crawl-result.json` を書き出し、`GITHUB_OUTPUT` があれば `count=` を追記。**2026-08-11**: 冒頭で`resolveLane()`/`isDryRun()`を評価し、dry-run時はGEMINI_API_KEY未設定チェックと候補取得後のGemini呼び出し・ファイル書き込みをスキップする（第16章） |

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
- リクエストボディは `{ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: ARTICLE_RESPONSE_SCHEMA } }`（**D-5、2026-08-03対応**）。`responseSchema` はGemini APIのOpenAPI 3.0サブセット形式（`type`は`STRING`/`ARRAY`/`OBJECT`等の大文字列挙値）で、トップレベルを`type: 'ARRAY'`（`items: {type: 'OBJECT', ...}`）にすることで「記事オブジェクトの配列」という形をAPI側に強制させる。`category`フィールドには`enum: Object.keys(CATEGORY_NAMES)`（8 slug）を指定し、不正なカテゴリ文字列が返る余地自体を減らす。`required`/`propertyOrdering`は`ARTICLE_SCHEMA_DESCRIPTION`のフィールド順と揃えてある。**2026-08-11追加**: optionalフィールド`placeCandidates`（配列。`required`には含めない）も同スキーマに追加した。詳細は第16章
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

出力フィールド（`ARTICLE_SCHEMA_DESCRIPTION`）: `title` / `description`（80〜120字）/ `category`（**8 slugから1つ**）/ `tags`（3〜5個）/ `pubDate`（`YYYY-MM-DD`）/ `source`（候補の値をそのまま）/ `sourceUrl`（候補の `link` をそのまま、改変・生成禁止）/ `slug` / `heading` / `keyPoints`（3点程度の配列）/ `body`（2〜3段落プレーンテキスト）/ `placeCandidates`（gourmetカテゴリのみ、任意。第16章参照）。

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
| `category` | `CATEGORY_SET`（8 slug）のいずれか |
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

- トリガー: cron `0 0 * * *`（07:00 WIB、newsレーン）/ `0 4 * * *`（11:00 WIB、newsレーン）/ `30 0 * * 1,4`（07:30 WIB 月・木、foodレーン。**2026-08-11追加**）+ `workflow_dispatch`（`inputs.lane`でnews/foodを選択可能）
- **レーン判定**（`Determine crawl lane`ステップ、**2026-08-11追加**）: `github.event_name === 'schedule'` かつ `github.event.schedule === '30 0 * * 1,4'` なら`food`、`workflow_dispatch`なら`inputs.lane`、それ以外（通常のnewsレーンcron）は`news`。結果を`CRAWL_LANE`環境変数として後続の`npm run crawl`ステップに渡す。詳細は第16章
- `npm run crawl` 実行ステップには `GEMINI_API_KEY` に加えて `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` / `GITHUB_REPOSITORY: ${{ github.repository }}` を渡す（**D-6、2026-08-03追加**。`fetchOpenPrDedupeData()` がオープンPRを列挙するために使用。GitHub Actionsのデフォルト`GITHUB_TOKEN`で`pulls`/`contents`の読み取りは可能）
- `npm run crawl` 実行後、`git status --porcelain src/content/articles | grep '^??'` で**新規ファイルの有無**を判定（`has_new`）
- 新規があれば `peter-evans/create-pull-request@v8` で PR作成:
  - `add-paths: src/content/articles/*.md`
  - `branch: auto/articles-${{ github.run_id }}`（この命名で後述の二重通知防止が効く。レーンに関わらず共通）
  - `commit-message: 'Add draft articles (auto-crawl)'`
  - `title`: `Determine PR title`ステップの出力（**2026-08-11追加**）。foodレーンなら「自動ドラフト記事【グルメ】(run {run_id})」、それ以外は従来通り「自動ドラフト記事 (run {run_id})」
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
| **候補の質**（どのソース/クエリから拾うか） | newsレーン: `scripts/lib/sources.mjs`: `sources` 配列（ソース追加）/ `KOMPAS_QUERIES`（Kompasクエリ）/ 各 `fetch*` 関数。foodレーン: `foodSources` 配列 / `FOOD_QUERIES`（**2026-08-11追加**、第16章） |
| **選定基準**（何を重要とみなすか） | `scripts/crawl-and-draft.mjs` `buildNewsPrompt()`（newsレーン）/ `buildFoodPrompt()`（foodレーン、**2026-08-11追加**）の「# ルール」節 |
| **文体・記事構成** | `buildNewsPrompt()` / `buildFoodPrompt()` のプロンプト + `ARTICLE_SCHEMA_DESCRIPTION` + `buildMarkdown()`（本文テンプレート） |
| **1回の本数** | 環境変数 `CRAWL_MAX_ARTICLES`（既定は `MAX_ARTICLES` の3）。CI側で設定するなら `crawl-articles.yml` の `env` |
| **モデル** | `scripts/crawl-and-draft.mjs` `GEMINI_API_URL` |
| **応答の構造化出力（responseSchema）** | `scripts/crawl-and-draft.mjs` `ARTICLE_RESPONSE_SCHEMA` / `ARTICLE_FIELD_ORDER`（D-5）/ `PLACE_CANDIDATE_FIELD_ORDER`（**2026-08-11追加**、第16章） |
| **検証（受け入れ基準）** | `validateArticle()` + `src/content.config.ts` のzodスキーマ |
| **重複判定の範囲・期間** | `RECENT_DEDUPE_DAYS` / `loadExistingArticles()` / `filterCandidates()` / `fetchOpenPrDedupeData()`（D-6、オープンPR分） |
| **Kompas仲介URLの直リンク解決** | `scripts/lib/sources.mjs` `resolveDirectLink()` / `LINK_RESOLVE_TIMEOUT_MS` / `LINK_RESOLVE_CONCURRENCY`（D-4） |
| **通知の見た目** | `scripts/notify-draft-pr.mjs` `buildBlocks()` |
| **承認の挙動**（公開時の処理） | `functions/api/slack-interactivity.js` `publishPr()` |
| **実行スケジュール・レーン** | `.github/workflows/crawl-articles.yml` の `cron` / `workflow_dispatch.inputs.lane` / `Determine crawl lane`ステップ（**2026-08-11、food追加**） |
| **カテゴリの増減** | `src/content.config.ts`（`category` enum + `mapData`）+ `scripts/crawl-and-draft.mjs` `CATEGORY_NAMES` + `src/lib/categories.ts`（サイト表示メタ）の3箇所を揃える。**2026-08-11時点で8カテゴリ**（`gourmet`追加、`lifestyle`は「生活情報」に改名） |
| **foodレーンのグルメ選定基準・placeCandidates運用** | 第16章（**2026-08-11追加**） |
| **テスト** | `scripts/crawl-and-draft.test.mjs` / `scripts/lib/sources.test.mjs`（D-8、`node --test`） |

---

## 13. ローカルでのテスト方法

`package.json` の `scripts`（実際の定義）:

| コマンド | 実体 | 備考 |
|---|---|---|
| `npm run crawl` | `node scripts/crawl-and-draft.mjs` | **記事生成のみ**（newsレーン）。`GEMINI_API_KEY` 必須（`--dry-run`時を除く）。`src/content/articles/` に実ファイルを書き込む。PR作成・Slack通知はしない（CI側の後続ステップでのみ発生） |
| `npm run crawl:food`（**2026-08-11追加**） | `node scripts/crawl-and-draft.mjs --lane=food` | foodレーン版。挙動は`npm run crawl`と同じで対象ソース・プロンプトのみ異なる。第16章参照 |
| `npm run discover-restaurants` | `node scripts/discover-restaurants.mjs` | 飲食店ガイド用。[`categories/gourmet.md`](./categories/gourmet.md)（旧: [`categories/lifestyle.md`](./categories/lifestyle.md)）参照 |
| `npm run suggest-guides`（**2026-08-11追加**） | `node scripts/suggest-guide-topics.mjs` | 飲食店ガイド記事の未カバートピック提案（詳細は当該スクリプトのテスト `scripts/suggest-guide-topics.test.mjs` 参照。本ドキュメントの主題であるニュース/foodクロールとは別系統） |
| `npm test` | `node --test 'scripts/**/*.test.mjs'`（**D-8、2026-08-03追加**） | ユニットテスト一式。ネットワークアクセス・APIキーとも不要（GitHub API/fetchはモック化）。`.github/workflows/test.yml` が `push`（main）と `pull_request` で自動実行 |

- **`--dry-run` フラグ（2026-08-11追加）**: `node scripts/crawl-and-draft.mjs [--lane=food] --dry-run` で、候補取得〜重複フィルタまでを実行し件数・候補タイトル（最大5件）をログ出力した時点で終了する。**Gemini呼び出し・ファイル書き込みは行わない**ため `GEMINI_API_KEY` も不要（`main()`冒頭のキー未設定チェックを`isDryRun()`で分岐してスキップする）。挙動を絞る手段は環境変数 `CRAWL_MAX_ARTICLES` と `--dry-run` の2つ
- 純粋関数（`escapeYaml` / `validateArticle` / `slugify` / `buildMarkdown` / `parseGeminiArticlesResponse` / `parseFrontmatterBlock` / `resolveLane` / `isDryRun`）と、ネットワークアクセスをfetchモックで検証するテスト対象関数（`fetchOpenPrDedupeData` / `resolveDirectLink` / `extractGoogleNewsId` / `parseBatchExecuteResponse` / `mapWithConcurrency`）は `export` 済みなので、`main()` を走らせずに import して個別に確認できる（第8章のエントリポイントガード）
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

## 16. foodレーン（グルメ情報、2026-08-11追加）

既存のnewsレーン（Detik/Antara/BMKG/Kompas、安全・社会・経済・生活情報・旅行・ビザ・規制）とは別に、新店オープン等のグルメ情報専用の**foodレーン**を追加した。同じ`scripts/crawl-and-draft.mjs` / `scripts/lib/sources.mjs` を共有し、`lane`引数で候補ソース・プロンプトを切り替える2レーン構成になっている。

### レーン決定（`resolveLane(argv, env)`）

優先順位: **CLI引数 `--lane=food`/`--lane=news`** > **環境変数 `CRAWL_LANE`** > **デフォルト`'news'`**。不正な値（`food`/`news`以外）は次の優先順位にフォールバックする（`crawl-and-draft.mjs`、export済み・純関数）。CIでの実際のレーン判定（cron種別からの割り出し）は第9章「レーン判定」を参照。

### ソース（`scripts/lib/sources.mjs` の `foodSources`）

| id | 内容 |
|---|---|
| `detikFood` | `https://food.detik.com/rss`。**実在確認済み（2026-08-11、curl実測）**: `HTTP/2 200`、`content-type: text/xml`、直近100件のグルメ関連記事（`<title>`/`<description>`/`<link>`/`<pubDate>`/`<guid>`を含む標準RSS 2.0形式）。`<item>`内に`<source>`タグが無いため`fallbackSourceLabel: 'Detik'`を指定 |
| `foodGoogleNews` | site制限なしのGoogle News検索RSS（`googleNewsSearchUrl()`、`FOOD_QUERIES`6本）。`fetchFoodViaGoogleNews()`が各クエリを並行取得しflatMapした後、Kompasと同じ`resolveDirectLink()`（D-4）で実記事URLへ解決する |

`FOOD_QUERIES`（すべて`when:7d` — 週2回実行のため1日分ではなく直近7日分を対象にする）:
`restoran baru jakarta` / `restoran jepang jakarta` / `kuliner jakarta selatan` / `cafe baru jakarta` / `restoran mall jakarta` / `festival kuliner jakarta`

一般検索RSS（`foodGoogleNews`）は`site:`指定が無いため`item.source`に実際の掲載媒体名（Detik/Kompas/CNN Indonesia等）が入る。そのため`fetchGoogleNewsSearchUrls()`呼び出し時に`fallbackSourceLabel`を渡さず、RSS由来の媒体名をそのまま尊重する（Kompas専用の`fetchKompasViaGoogleNews()`とはこの点が異なる）。

**動作未確認の既知の制約**: `food.detik.com/rss`はローカルのcurl検証では200を安定して返したが、`-o /dev/null`で本文を捨てるリクエストの一部でタイムアウトする揺れも観測した（本文を保存する取得では毎回成功）。CI実行時にタイムアウトが発生しても`fetchAllCandidates()`の`Promise.allSettled`によりfoodGoogleNews側は独立して継続する（fail-open、newsレーンの既存設計を踏襲）。

### 実行頻度・トリガー

`.github/workflows/crawl-articles.yml` に**月・木 07:30 WIB**（`cron: '30 0 * * 1,4'`）を追加。newsレーンの07:00/11:00 WIB（毎日）とは独立したスケジュール。`workflow_dispatch`実行時は`inputs.lane`（`news`/`food`、既定`news`）で手動選択できる。レーン判定の詳細は第9章。

### 選定基準（`buildFoodPrompt()`）

`draftArticles(candidates, recentTitles, lane)`が`lane === 'food'`のとき使うプロンプト（`crawl-and-draft.mjs`）。newsレーン用`buildNewsPrompt()`と並存し、`ARTICLE_SCHEMA_DESCRIPTION`・`ARTICLE_RESPONSE_SCHEMA`は両レーン共通。

- 対象: 新規オープン、閉店・移転、話題の飲食店、フードフェス・グルメイベント、季節限定情報
- ジャカルタ首都圏在住の日本人にとって有用な情報を優先（日本食、接待・会食向き、家族向き、話題の新店など）
- 店名・住所・価格・営業時間などの事実情報は候補ニュース（title/snippet）に実際に書かれている内容のみ使用し、推測・創作を禁止
- `category`は原則`gourmet`
- 直近`RECENT_DEDUPE_DAYS`（14）日以内の重複回避ルールはnewsレーンと共通

### カテゴリ（8種類への拡張）

`CATEGORY_NAMES`（`crawl-and-draft.mjs`）に`gourmet: 'グルメ・レストラン'`を追加し、7 slug→**8 slug**になった（`src/lib/categories.ts` / `src/content.config.ts`の3箇所を同期。**2026-08-11時点で全て同期済み**）。あわせて既存の`lifestyle`の和名を「生活・グルメ」から**「生活情報」**に改名（グルメ要素を`gourmet`へ分離したため。飲食店ガイド専用エンジンの経緯は[`categories/lifestyle.md`](./categories/lifestyle.md)冒頭の追記および[`categories/gourmet.md`](./categories/gourmet.md)を参照）。`ARTICLE_SCHEMA_DESCRIPTION`の`lifestyle`説明文からも飲食要素を除去し「買い物・学校・病院など在住者の日常生活情報」に変更した。

`gourmet`は`CATEGORY_RESPONSE_SCHEMA`の`enum`にも含まれる共通スキーマのため、理論上はnewsレーンの記事（例: Kompas/Detik発の飲食店関連ニュース）が`gourmet`を選ぶことも起こりうる（レーン別にスキーマを分けていないため）。これは意図した設計（サイト全体でのカテゴリ追加）であり、foodレーン限定の制約ではない。

### placeCandidates（店舗候補、任意フィールド）

`ARTICLE_RESPONSE_SCHEMA`に`placeCandidates`（`ARRAY of OBJECT {name, area, cuisine}`、全て`STRING`）をoptionalフィールドとして追加した（`required`には含めない。`propertyOrdering`には追加）。`buildFoodPrompt()`が「記事で紹介した店舗があれば`name`（現地表記）・`area`・`cuisine`を含めること」と指示する。

- **`validateArticle()`では必須にしない**（未指定でもエラーにならない）
- **`buildMarkdown()`では無視する**（frontmatter・本文どちらにも書き込まない。記事ファイル自体は`placeCandidates`の有無に関わらず従来通り生成される）
- **`.crawl-result.json`の`created`エントリ**には、`placeCandidates`が空でない場合のみ`placeCandidates`フィールドを含める
- **コンソール出力**: 記事作成ログの直後に `  places YAML追加候補: [...]` として出力する

**運用（ローカルでの手動enrich）**: `placeCandidates`は座標（`lat`/`lng`）を含まず、LLMが生成した店名・エリア・料理ジャンルの参考情報にすぎない。`src/data/places/*.yaml`（1店舗=1ファイル、[`categories/lifestyle.md`](./categories/lifestyle.md)「9. 店舗データのメンテナンス用スクリプト」参照）への正式な追加は自動化されておらず、人間が`.crawl-result.json`またはCIログの`placeCandidates`を見て次を手動で行う想定:

1. 既存の`src/data/places/*.yaml`に同一店舗が無いか確認（店名正規化一致 or 座標60m以内は重複扱い）
2. 新規なら`src/data/places/<slug>.yaml`を作成し、`sourceArticles`にその記事のid（ファイル名から`.md`を除いたもの）を追加
3. `placeId`が未設定なら`node scripts/enrich-places.mjs`（ローカルPC限定、Places APIキーがIP制限付きのため）でGoogle Places APIから座標・`placeId`を補完
4. `node scripts/validate-places.mjs`でスキーマ適合・重複を検証してからコミット

foodレーンのGemini呼び出し自体はplacesコレクションを書き換えない（記事生成と店舗データ登録は独立した工程のまま）。

### PRタイトルの分岐

`.github/workflows/crawl-articles.yml`の`Determine PR title`ステップ（第9章）が、foodレーンのPRタイトルを「自動ドラフト記事【グルメ】(run {run_id})」にする。newsレーンは従来通り「自動ドラフト記事 (run {run_id})」。

### CLIオプションまとめ

| オプション/コマンド | 内容 |
|---|---|
| `--lane=food` / `--lane=news` | `resolveLane()`が最優先で参照するCLI引数 |
| `CRAWL_LANE=food` 環境変数 | CLI引数が無い場合に参照（CIの`Determine crawl lane`ステップがこれを設定） |
| `--dry-run` | 候補取得〜フィルタまで実行し件数・タイトル最大5件を表示して終了（`GEMINI_API_KEY`不要。第13章） |
| `npm run crawl:food` | `node scripts/crawl-and-draft.mjs --lane=food` のショートカット |

例: `node scripts/crawl-and-draft.mjs --lane=food --dry-run`（APIキー不要でfoodレーンの候補件数だけ確認したいとき）

---

## 関連ドキュメント

- [`../AUTOMATION.md`](../AUTOMATION.md) — セットアップ・運用コマンド・コスト・既知の制約
- [`../CONTENT-SOURCES.md`](../CONTENT-SOURCES.md) — 情報源・更新方式の俯瞰
- カテゴリ別詳細: [`categories/safety.md`](./categories/safety.md) / [`categories/society.md`](./categories/society.md) / [`categories/business.md`](./categories/business.md) / [`categories/travel.md`](./categories/travel.md) / [`categories/visa.md`](./categories/visa.md) / [`categories/regulation.md`](./categories/regulation.md) / [`categories/lifestyle.md`](./categories/lifestyle.md) / [`categories/gourmet.md`](./categories/gourmet.md)
</content>
</invoke>
