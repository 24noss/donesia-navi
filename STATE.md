最終更新: 2026-10-01

# STATE — donesia-navi

<!-- 変わりやすい情報の唯一の置き場。AGENTS.md には書かない。更新のたびに1行目の日付も直す。 -->

## 現在のゴール

- **「売れる資産」にする(広告+アフィリエイトで収益化しつつ、いつでも売却できる状態を保つ)**。オーナー決定 2026-09-29。
- **直近の期限: 2026-12-31 までに収益スタート**(初回の収益が実際に発生すること)。
- 中期: 月利益(収益 − 運用コスト)1万円以上を6か月連続 → その時点で「売却(相場は月利益の約18か月分)」と「保有継続」を比較して判断する。
- 前提(2026-09-29 調査): 月1〜2万PVではディスプレイ広告は月3,000〜7,000円程度の見込み。売却は PV ではなく利益の安定と引き継ぎやすさで評価される。ビザ・治安は YMYL のため出典と最終確認日が必須。
- 現状(2026-09-29): GA4 導入済み。AdSense 登録済み(2026-09-29、ca-pub-4916493711379223)。記事 298 本。アフィリエイト表示枠(`hasAffiliate`)は実装済みだが有効な記事は 0 本。AdSense 導入済み(PR #120、審査リクエスト・自動広告 ON・EEA 向け Google CMP 3択を設定済み)。Wise はリファラルで提携済み。YMYL 表示と再確認の仕組み、月次収益記録表を `feat/monetization-remaining` で追加。全記事サイドバーに Wise 紹介リンク(`[...id].astro`)が常設されている。

## 完了条件

- 常時: `./verify` が exit 0(`npm test` + `npm run build`)
- 年内(2026-12-31): 次の3つをすべて満たす
  1. 本番ページに収益導線がある(AdSense コード、または ASP のアフィリエイトリンクが `curl` で確認できる)
  2. 管理画面(AdSense / ASP)で収益が 1 円以上計上されている
  3. 月次の「収益・運用コスト(LLM/API・ホスティング)・PV」を記録する表が STATE.md か docs にあり、11月・12月分が埋まっている

## 進捗

- [x] AGENTS.md / CLAUDE.md / STATE.md / LESSONS.md / verify を整備(2026-09-29)
- [x] 収益化の下準備(ブランチ `feat/monetization-prep`、2026-09-29): policy に第三者配信広告・GA4 の記載を追加 / アフィリエイトクリックを GA4 イベント `affiliate_click` で計測(`src/lib/affiliate.mjs`)/ 候補記事リスト `docs/monetization/affiliate-candidates.md`(重複除き40記事、確度高6)
- [ ] README.md は Astro テンプレートのまま(未対応)
- [ ] `docs/improvement-roadmap.md` A-5(Google Maps APIキーのリファラー制限)はユーザー作業で未完了(同ファイルの記載)

## 次の一手

1. [オーナー] バリ向けガイドの自動生成が稼働(2026-10-01〜 Mac の launchd: 毎日10:30 JST に1本の draft PR、毎月1日11:00 に出典再確認。週次トピック提案は Actions の月曜)。Slack で**本文を読んでから**承認/PR close(却下)。公開済みを作り直すときは `docs/guide-pipeline.md` の `--replace`。Mac が停止中は生成されない。hub/spoke 構成・台帳31本(on-hold 2)。韓国語展開は日本語ガイドが軌道に乗った後に5〜10本で試験(未決定)。
2. [オーナー] ASP に登録する: Trip.com → Klook(Wise はリファラルで提携済み。Agoda は後回し。保険・VPN は提携先要確認)。GA4 管理画面で `affiliate_click` の partner / placement をカスタムディメンション登録する。
3. [エージェント] ASP 登録後、`docs/monetization/affiliate-candidates.md` の確度高・中の記事にリンク(`rel="sponsored"`)と `hasAffiliate: true` を入れる(Wise は税金・法人設立ガイドに実施済み)。
4. [エージェント+オーナー確認] YMYL エバーグリーン4本(KITAS・税金・法人設立・病院)を公的情報と照合し `lastVerified` と `references` を記入する(`npm run check-ymyl` で検出。毎月1日に Issue 化)。
5. [オーナー] 毎月 `docs/monetization/revenue-log.csv` に PV・収益・コストを記入し `npm run revenue` で連続月数を確認する。

- 同意設定方針(オーナー決定 2026-09-29): 現地法(インドネシア UU PDP)に準拠する安全側として、広告・解析 Cookie は同意するまで denied のまま(全地域共通)。EEA/英国/スイスは Google CMP(3択)。

## 期限・日付つき事項

- 2026-10 前半: ASP 登録(Trip.com・Klook。オーナー作業)。AdSense は申請済み。審査には数日〜数週間かかるため早めに出す。
- 2026-11: アフィリエイト導線の実装と計測開始、月次記録開始。
- 2026-12-31: 収益スタートの期限(完了条件 1〜3)。
- (以前からの記載) `AUTOMATION.md` に「Slack承認ボタン用の追加設定(未設定・要対応)」の記載あり。現状は要確認。
