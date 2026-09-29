# donesia-navi

<!-- 正本。≤100行。日付・期限・進捗は書かない(STATE.md へ)。詳細は docs/ へポインタ。 -->

## 概要

- donesia-navi: インドネシア在住日本人向けニュース・ガイドメディア(indonesia-navi.com)。Astro 6 の静的サイト、記事は `src/content/articles/` の Markdown。
- ニュース記事は GitHub Actions が RSS/API をクロール → Gemini API でドラフト化 → PR 作成 → Slack で承認 → ボタンで公開、という半自動運用。ホスティングは Cloudflare Pages。

## 地図

| パス | 役割 |
|---|---|
| `AUTOMATION.md` | 記事自動ドラフト生成・Slack承認・飲食店ガイド提案ボットの運用正本 |
| `CONTENT-SOURCES.md` | カテゴリ別の情報源・更新方式・人手の介在点 |
| `docs/news-pipeline.md` | ニュース生成エンジンの内部仕様 |
| `docs/categories/*.md` | カテゴリ別(8種)の情報源・品質チューニング箇所 |
| `docs/improvement-roadmap.md` | 改善ロードマップ(優先度・状態つき) |
| `DESIGN_STRATEGY.md` | デザイン戦略(1269行。必要な節だけ読む。コピーしない) |
| `src/content/articles/` | 記事本体(`draft: true` は本番非表示) |
| `src/data/tag-vocabulary.json` | タグ統制語彙(71語) |
| `scripts/` | クロール・ドラフト生成・Slack通知・テスト(`*.test.mjs`) |
| `functions/api/` | Cloudflare Pages Functions(Slack承認ボタンの受信) |
| `.github/workflows/` | crawl-articles / notify-draft-pr / suggest-guide-topics / test |
| `STATE.md` / `LESSONS.md` | 現在地 / 教訓ログ |

## 検証

- `./verify` : 完了判定の単一入口。exit 0 = 合格。`npm test` → `npm run build`。所要時間: 約30秒
- `./verify --fast` : `npm test` のみ(約5秒)
- 個別コマンド: `npm test`(`node --test 'scripts/**/*.test.mjs'`)、`npm run build`(`astro build && npx pagefind --site dist`、`dist/` は gitignore)
- CI(`.github/workflows/test.yml`)は `npm ci` → `npm test`
- `npm run crawl` / `crawl:food` / `discover-restaurants` / `suggest-guides` は外部API(Gemini・Places・Slack)を呼ぶため verify には含めない

## 絶対ルール

1. 記事ドラフトは必ず PR として作成する。レストランガイド等を手動追加する場合も main へ直接 commit しない(Cloudflare Pages のプレビュー・merge 対象にするため。出典: `AUTOMATION.md`)
2. 公開はドラフトの `draft: true` を Slack の「承認して公開」ボタンで `draft: false` にして PR を merge する経路。本番・ローカルビルドでは draft 記事は表示されない(`src/lib/draftVisibility.ts`)
3. 記事の `tags` と本文末尾の `**タグ:**` 行は `src/data/tag-vocabulary.json` の語彙から選ぶ。新規タグが必要なら語彙ファイルへの追加・既存タグへの統合を先に検討する(タグ増殖の再発防止)
4. 本文はRSSの見出し・要約をもとに生成し、全文スクレイピングはしない(ペイウォール・利用規約リスク回避)
5. 飲食店ガイドでハラール・酒類は確認できなければ「要確認」と書く。エリア単体トピックは新規追加しない(オーナー判断)
6. Google Places 用キーは perth-web-biz の既存キーを流用しない(専用キーを新規発行)
7. `git add -A` / `git commit -a` / `git push --force` は使わない (hook化済み)

## 読む順番

1. `STATE.md`(いまの状況)
2. `AUTOMATION.md`(運用の正本。冒頭に各ドキュメントへの案内あり)
3. 必要に応じて `CONTENT-SOURCES.md` → `docs/news-pipeline.md` → `docs/categories/<カテゴリ>.md`

## 本番・秘密・個人情報

- 本番: Cloudflare Pages(indonesia-navi.com)。main への merge で反映。デプロイ操作は verify に含めない
- 秘密: `.env.local`(gitignore済み。中身を読まない・出力しない)、GitHub Secrets(`GEMINI_API_KEY` / `SLACK_BOT_TOKEN`)、Cloudflare Pages の環境変数(`SLACK_SIGNING_SECRET` / `GITHUB_TOKEN`)。値を文書・ログに書かない
- 個人情報: なし(公開ニュースメディア)
