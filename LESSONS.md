# LESSONS — donesia-navi

教訓ログ。同じ失敗を繰り返さないための記録で、記録 → ルール → 機械化の順に「昇格」させる。

## 昇格ラダー

1. 再発1回目: この LESSONS.md に記録する(Stop hook が促す)。
2. 再発2回目: AGENTS.md の「絶対ルール」へ昇格し、状態を `昇格済み-AGENTS` にする。
3. 機械化できるもの: hook / lint / test へ昇格し(`昇格済み-hook` / `昇格済み-lint`)、AGENTS.md には「hook化済み」とだけ残す。
4. 複数プロジェクトで出たものは `~/Personal/_harness/LESSONS.md` へ集約し、グローバル CLAUDE.md / グローバル hook へ。

状態: `記録` / `昇格済み-AGENTS` / `昇格済み-hook` / `昇格済み-lint` / `廃止`
再発が2以上なのに状態が `記録` のままの教訓は harness-lint(L12)が警告する。

## 書式(1件)

```
## L-012 2026-09-29 [再発:1] [状態:記録]
- 何が起きた: …
- 正しいやり方: …
- 昇格先候補: AGENTS.md ルール / hook / lint / test
```

再発したら `[再発:N]` を増やし、日付は初出のまま残す。新しい教訓は末尾に追記する。

---

## L-001 2026-09 [再発:1] [状態:昇格済み-AGENTS]
- 何が起きた: タグが自由記述で増殖し、タグページ495件(73%が記事1本)が noindex となり GSC の「インデックス未登録」ノイズの主因になった(出典: `AUTOMATION.md` の「タグ統制」節)。
- 正しいやり方: タグは `src/data/tag-vocabulary.json` の統制語彙から選ぶ。自動記事は `filterTagsByVocabulary` でコード強制済み。
- 昇格先候補: AGENTS.md ルール(反映済み。手動記事側は lint 化の余地あり)

## L-002 2026-08 [再発:1] [状態:記録]
- 何が起きた: ガイド提案ボットのカバレッジ判定が title/tags の単純キーワード一致だったため、無関係な記事で誤判定した(`italian`・`french`・`blok-m`)。2026-08-11 に修正済み(出典: `AUTOMATION.md` の「既知の制約」)。
- 正しいやり方: カバレッジ判定は記事の `category` も見る。tags のみの一致ではカバー済みにしない。
- 昇格先候補: test

## L-003 2026-09 [再発:1] [状態:記録]
- 何が起きた: ガイド生成用の公的出典を集めた際、在インドネシア日本大使館・在デンパサール総領事館・mofa.go.jp の渡航系ページはボット遮断(403)、All Indonesia・空港公式・OSS 等は JS 描画で本文が取れなかった。人間がブラウザで見られても自動取得できるとは限らない。
- 正しいやり方: `official-sources.json` に追加する URL は、生成スクリプトと同じ User-Agent(`scripts/lib/guide-fetch.mjs` の `USER_AGENT`)で取得し、本文が十分に取れることを確認してから登録する。日本政府の渡航情報は anzen.mofa.go.jp(海外安全ホームページ)が取得可能。
- 昇格先候補: test(official-sources の URL を実取得する定期チェック)

## L-004 2026-09 [再発:1] [状態:記録]
- 何が起きた: GitHub Actions のランナーから www.imigrasi.go.id / evisa.imigrasi.go.id / lovebali.baliprov.go.id が HTTP 403(データセンターIP遮断とみられる)で、出典90件中32件が取れなかった。出典を登録した時のローカル(自宅回線)での取得確認では成功していたため気付かなかった(L-003 の延長)。
- 正しいやり方: 出典の取得確認は、実際に実行する環境と同じ場所(ランナー or 実行するMac)で行う。ローカルで取れても Actions で取れるとは限らない。取得元IPに依存する出典があるジョブは、取得できる環境(Mac の launchd)で実行する。
- 昇格先候補: test(実行環境での official-sources 取得チェック。L-003 と統合)

## L-006 2026-10 [再発:1] [状態:記録]
- 何が起きた: `public/_redirects` に www→apex のリダイレクト(`https://www.indonesia-navi.com/* ...`)を書いていたが、Cloudflare Pages の `_redirects` はドメイン単位のリダイレクト非対応で効かず、www は HTTP 522 のまま気付かれていなかった(AdSense 審査後の確認で発覚)。
- 正しいやり方: ホスト名をまたぐリダイレクトは Cloudflare ダッシュボードの Rules → Redirect Rules(テンプレ「Redirect from WWW to root」、`*://www.*` → `https://${2}`、301、クエリ保持)で行う。設定後は `curl -sI https://www.indonesia-navi.com/` で 301 を確認する。
- 昇格先候補: test(verify 外の本番 smoke として www の 301 を定期確認)
