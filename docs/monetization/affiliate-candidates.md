# アフィリエイト導入候補記事の洗い出し

作成日: 2026-09-29 / ブランチ: feat/monetization-prep / 対象: `src/content/articles/*.md`

## 1. 概要

- 記事ファイル総数: 298本。うち `draft: true` の11本は除外(記事名は記載しない)。判定対象は **287本**。
- 判定対象の内訳(category): safety 106 / gourmet 45 / lifestyle 33 / society 31 / business 29 / travel 24 / regulation 16 / visa 3。
- 候補としてリストアップした記事は延べ **45件**(同一記事が複数のASPカテゴリに載る場合があるため延べ)。重複を除くと **40記事**(287本の13.9%)、うち確度「高」は **6記事**。
- 明示的に除外した記事(判定した上で候補にしない例)は §5 に 14件を列挙。それ以外の未掲載記事は「関連なし」。
- 特徴: 287本の大半は時事ニュース(2026年4月〜9月)で、旅行ガイド・送金解説・手続きガイドのようなエバーグリーン記事は少ない(確度「高」は6記事のみ)。飲食店ガイド群はASPカテゴリに直接合致せず候補外とした。
### ASPカテゴリ別の候補数(確度別)

| ASPカテゴリ | 高 | 中 | 低 | 計 |
|---|---|---|---|---|
| 1. ホテル・宿泊 (Agoda / Trip.com) | 0 | 3 | 3 | 6 |
| 2. 現地ツアー・アクティビティ・交通チケット・テーマパーク (Klook / Trip.com) | 1 | 4 | 9 | 14 |
| 3. 航空券 (Trip.com) | 1 | 3 | 2 | 6 |
| 4. 海外送金・両替 (Wise) | 1 | 1 | 4 | 6 |
| 5. eSIM・SIM・海外通信 (Klook / Trip.com の eSIM。提携先要確認) | 0 | 1 | 1 | 2 |
| 6. 海外旅行保険・駐在員保険・医療 (提携先要確認) | 1 | 0 | 3 | 4 |
| 7. VPN・ネット規制 (提携先要確認) | 0 | 0 | 0 | 0 |
| 8. その他(法人設立・ビザ代行・会計、空気清浄機・マスク、クレジットカード) | 2 | 2 | 3 | 7 |
| **延べ合計** | **6** | **14** | **25** | **45** |

## 2. 推奨する最初の着手順(ASP登録の優先順位)

数字は「高または中」の確度の記事を、その ASP でカバーできる重複除外の記事数。

| 順位 | 登録先 | カバーする記事(重複除外) | うち高 | 高+中 | 根拠 |
|---|---|---|---|---|---|
| 1 | Trip.com (ホテル・ツアー/チケット・航空券) | 23 | 2 | 11 | §3の1・2・3を1社でカバー。高確度の2本(バンドン日帰りWhoosh記事、トランスヌサ航空ガイド)が両方入る。トランスヌサ記事は「日本のカードがTravelokaで弾かれる」と書いており、日本語対応OTAとの相性が良い |
| 2 | Klook (ツアー・チケット・eSIM) | 16 | 1 | 6 | 鉄道(Whoosh)・テーマパーク・ブロモ/イジェンの再開ニュース等、交通チケット系に強い。Trip.comと併用して案件ごとに成約条件が良い方を使う |
| 3 | Wise (海外送金) | 6 | 1 | 2 | 高確度は税務ガイドの1本のみだが、送金は単価が高い案件。ルピア下落ニュースの3本を「送金・両替まとめ」に統合すれば、新規記事1本で受け皿になる |
| 4 | Agoda (ホテル) | 6 | 0 | 3 | 高確度の記事がなく、Trip.comと候補が重複。Trip.comの宿泊単価が低い場合の補完として後回し |
| 5 | 保険・法人設立/ビザ代行 | - | - | - | 高確度は `jakarta-japanese-hospitals-guide.md`(保険)、`kitas-renewal-guide-2026.md`、`indonesia-company-establishment-guide.md`(いずれも§3の6・8)の3本。提携先未定のため、ASP探し(保険比較、行政書士・会計事務所への紹介契約)を並行して開始 |

結論: **まず Trip.com、次に Klook、3番目に Wise**。Trip.com 1社で高確度6本のうち2本(バンドン日帰り、トランスヌサ航空ガイド)と、ホテル・ツアー・航空券の中確度記事をまとめてカバーできる。残る高確度4本(送金税務ガイド、病院ガイド、KITAS更新、法人設立)は、Wise・保険・代行サービスの提携先探しが必要。VPNは候補記事が0本のため、記事を書いてから探せばよい。

## 3. ASPカテゴリ別の候補表

確度: 高 = 読者の行動意図が明確(ガイド・手順解説) / 中 = 行動に近いが時事性が混じる / 低 = 関連はあるが時事ニュース寄り、または期限切れ。

### 1. ホテル・宿泊 (Agoda / Trip.com)

| ファイル名 | タイトル | category | 確度 | 推奨する差し込み位置・リンク内容 |
|---|---|---|---|---|
| `2026-09-21-indonesia-hotels-michelin-keys-2026.md` | ミシュラン・キーズ2026、インドネシア国内のホテル・リゾート47軒が選出 | travel | 中 | 本文中盤に「エリア別ホテル」節を追加し、Agoda/Trip.comの掲載ホテル検索リンク。選出ホテルごとの予約導線 |
| `2026-04-04-bandung-top-5-asian-destinations.md` | バンドンがアジア観光地トップ5入り、日本の都市と肩を並べる評価 | travel | 中 | 末尾に「バンドンのおすすめホテル」枠とエリア別検索リンク |
| `2026-09-25-indonesia-public-holidays-cuti-bersama-2027.md` | インドネシア政府、2027年の祝日・有給奨励日26日を正式決定　レバランは最大10連休 | lifestyle | 中 | 長期連休(レバラン10連休)の節に「連休の旅行先ホテルを早めに確保」CTA。航空券と併記 |
| `2026-08-13-bandung-outlet-shopping-guide.md` | バンドンのアウトレット買い物ガイド【2026年版】ジャカルタから日帰りOK | travel | 低 | 日帰り前提だが「泊まりで回る場合」に1段落、バンドン市街ホテル検索リンク |
| `2026-09-18-bromo-reopens-september-19.md` | ブロモ山観光エリアが9月19日より再開、現地当局が定めた新ルールに注意 | travel | 低 | 再開ニュース。末尾にブロモ周辺宿(Cemoro Lawang/Probolinggo)検索リンク |
| `2026-08-10-bali-coastal-flooding-warning-august-2026.md` | バリ島沿岸部で8月11日〜17日に高潮の恐れ　BMKGが注意呼びかけ | safety | 低 | バリ高潮警報。旅行者向けというより在住者向け一過性ニュースで、宿泊導線は弱い。要リライト時のみ |

### 2. 現地ツアー・アクティビティ・交通チケット・テーマパーク (Klook / Trip.com)

| ファイル名 | タイトル | category | 確度 | 推奨する差し込み位置・リンク内容 |
|---|---|---|---|---|
| `2026-08-13-bandung-outlet-shopping-guide.md` | バンドンのアウトレット買い物ガイド【2026年版】ジャカルタから日帰りOK | travel | 高 | 「予約方法」節(Whoosh)にKlook/Trip.comのWhooshチケットへのリンク。日帰りモデルコース節にバンドン現地ツアー |
| `2026-09-26-yia-airport-train-ticket-app-c-access.md` | ジョグジャカルタ空港連絡鉄道、予約が公式アプリ「C-Access」等に移行 運営移管に伴い | travel | 中 | 予約アプリ移行の解説。C-Access併記のうえ、YIA空港鉄道のKlook/Trip.com取扱有無を確認して補足リンク(取扱がなければ不可) |
| `2026-08-21-whoosh-bullet-train-20-percent-discount-promo.md` | インドネシア高速鉄道「Whoosh」、8月〜9月に運賃20％割引プロモを実施 | travel | 中 | 割引期間(8〜9月)終了後は通常運賃ガイドに差し替えてWhooshチケットリンク。期限切れ前後で要更新 |
| `2026-09-18-bromo-reopens-september-19.md` | ブロモ山観光エリアが9月19日より再開、現地当局が定めた新ルールに注意 | travel | 中 | ブロモ日の出ツアー(ジープ・ジョグジャ/スラバヤ発)へのリンク。新ルール節の直後 |
| `2026-09-26-kawah-ijen-reopens-after-forest-fire.md` | 東ジャワ・イジェン火山観光エリア、山火事から復旧し来週初めより一般受け入れ再開へ | travel | 中 | イジェン青い炎ツアーへのリンク。再開日程の節の直後 |
| `2026-08-06-ancol-dufan-88-promo-buy-1-get-1.md` | アンコールが「8.8」特別プロモ実施、Dufanチケット購入で1枚無料に | lifestyle | 低 | Dufanチケット(Klook取扱)。8.8プロモは期限切れなので通常チケット導線に差し替え |
| `2026-08-05-komodo-padar-islands-boat-trips-closed.md` | コモド島・パダール島への観光船航路が一時閉鎖、8月8日まで閉鎖継続へ | travel | 低 | コモド島ツアーは強い商材だが、記事は一時閉鎖(8月8日まで)の一過性ニュース。再開後の追記が前提 |
| `2026-08-11-transjakarta-kepulauan-seribu-transport.md` | トランスジャカルタ、千島列島への水上交通を統括へ　手頃な運賃でアクセス向上を目指す | society | 低 | 千島列島(ブサリ諸島)ツアー・島巡りへの補足リンク。行政ニュース寄り |
| `2026-08-01-transjabodetabek-blokm-airport-fare-change.md` | ブロックM〜空港間のバス「TransJabodetabek」、9月1日より運賃が1万5000ルピアに | travel | 低 | 空港バス運賃改定。Klookの空港送迎(専用車)を代替手段として1行 |
| `2026-09-02-transjabodetabek-sh2-blok-m-airport-fare.md` | ブロックMとスカルノ・ハッタ空港を結ぶ直通バス「SH2」、運賃1万5,000ルピアで運行中 | lifestyle | 低 | 空港直通バスSH2の運賃情報。空港送迎(Klook)を代替案として1行 |
| `2026-08-20-damri-promo-blok-m-airport-bus-fare.md` | 国営バスDAMRI、ブロックM〜スカルノ・ハッタ国際空港線を5万ルピアに割引プロモ | travel | 低 | DAMRI空港バスの割引プロモ。期限切れ。空港送迎の代替案として1行 |
| `2026-09-22-kai-unifies-semarang-gambir-train-into-ka-muria.md` | KAI、ジャカルタ〜スマラン間特急を「KAムリア」に統合 10月1日運行開始へ | travel | 低 | KAムリア統合(10月1日開始)。開始後の運賃・予約ガイドにする場合のみ |
| `2026-08-12-kai-offers-17-percent-discount-for-independence-day.md` | 国鉄KAI、独立記念日を祝し長距離列車で17％割引プロモを実施 | travel | 低 | 独立記念日17%割引の期限切れ記事。鉄道チケットリンクの価値は低い |
| `2026-04-06-jogja-special-train-fares-april.md` | ジョグジャ発の特別割引列車、4月のGo Show運賃一覧 | travel | 低 | 4月のGo Show運賃一覧。pubDateが古く一過性 |

### 3. 航空券 (Trip.com)

| ファイル名 | タイトル | category | 確度 | 推奨する差し込み位置・リンク内容 |
|---|---|---|---|---|
| `2026-08-13-transnusa-airline-guide.md` | トランスヌサ航空の利用ガイド【2026年版】路線・予約・手荷物を徹底解説 | travel | 高 | 「予約方法」節(日本のカード可否・OTA比較)にTrip.com航空券検索リンク。「他社比較」節にも路線別リンク |
| `2026-08-13-garuda-indonesia-bandung-denpasar-route.md` | ガルーダ航空、バンドン〜バリ（デンパサール）直行便を開設　往復130万ルピア台から | travel | 中 | 路線開設ニュース(往復130万ルピア台〜)。運賃節の直下にバンドン〜デンパサール検索リンク |
| `2026-08-04-transnusa-direct-flights-jakarta-bali-thailand.md` | 航空トランスヌサ、ジャカルタ・バリ発タイ行きの直行便を新設 | travel | 中 | タイ行き直行便。Trip.comのジャカルタ/バリ〜バンコク検索リンク。eSIM(タイ)も併記可 |
| `2026-09-25-indonesia-public-holidays-cuti-bersama-2027.md` | インドネシア政府、2027年の祝日・有給奨励日26日を正式決定　レバランは最大10連休 | lifestyle | 中 | 祝日カレンダー。連休ごとの旅行先案とTrip.com航空券リンク(ホテルと同一箇所) |
| `2026-08-07-bandung-husein-sastranegara-airport-reopening-august-2026.md` | バンドンのフセイン・サストラネガラ空港、8月14日の運航再開に向け準備進行中 | travel | 低 | バンドン空港再開。再開後の就航路線が分かれば航空券リンクの余地 |
| `2026-08-04-emirates-airbus-a380-first-landing-jakarta-soetta.md` | エミレーツ航空の超大型機「A380」、スカルノ・ハッタ空港に初就航へ | travel | 低 | エミレーツA380就航ニュース。国際線予約の意図は弱い |

### 4. 海外送金・両替 (Wise)

| ファイル名 | タイトル | category | 確度 | 推奨する差し込み位置・リンク内容 |
|---|---|---|---|---|
| `indonesia-tax-guide-japanese.md` | インドネシアの税金を完全解説 — 日本人駐在員・現地採用が知るべき税制【2026年】 | regulation | 高 | 「日本への送金と課税」節の直後に、Wiseでインドネシア→日本へ送金する場合の手数料・レート比較CTA |
| `indonesia-company-establishment-guide.md` | インドネシアで法人設立する手順と費用【2026年完全ガイド】 | regulation | 中 | 「払込資本金」節に、海外(日本)から資本金をインドネシア法人口座へ送金する方法としてWise Business。要確認: ルピア宛て・法人向けの対応可否 |
| `2026-07-30-rupiah-depreciates-against-usd-fed-rate-decision.md` | ルピア相場が対米ドルで下落、1米ドル＝18,111ルピアを記録 | business | 低 | ルピア下落ニュース。末尾に「レートが動くときの送金・両替の考え方」1段落+Wise。一過性 |
| `2026-09-11-rupiah-drops-against-us-dollar.md` | ルピア相場が急落、一時1ドル＝1万7,600ルピア台へ　国際原油高が市場の重荷に | business | 低 | 同上(ルピア急落)。ニュースの重複記事のため統合を検討 |
| `2026-09-14-rupiah-depreciation-september-2026.md` | ルピア相場が一時1ドル＝1万7,600ルピア台へ下落、国際原油高が影響 | business | 低 | 同上(ルピア1万7,600台)。`2026-09-11-rupiah-drops-against-us-dollar.md` と内容重複 |
| `2026-08-19-bi-announces-zero-mdr-qris-under-500k-october.md` | インドネシア中銀、10月1日より50万ルピア以下のQRIS決済手数料を無料化 | business | 低 | QRIS手数料無料化。決済ニュースで、送金導線は弱い |

### 5. eSIM・SIM・海外通信 (Klook / Trip.com の eSIM。提携先要確認)

| ファイル名 | タイトル | category | 確度 | 推奨する差し込み位置・リンク内容 |
|---|---|---|---|---|
| `2026-08-22-singapore-sg-arrival-card-update-passport-scan.md` | シンガポールの電子入国カード「SG Arrival Card」が更新 パスポート読み取り機能や多言語に対応 | travel | 中 | シンガポール入国カード更新。入国前準備の一覧にシンガポール用eSIMリンク |
| `2026-08-18-garuda-indonesia-in-flight-high-speed-wifi-trial.md` | ガルーダ・インドネシア航空、高度3万フィートでの高速機内Wi-Fi試験運用を開始 | travel | 低 | 機内Wi-Fi試験。通信商材との接点は薄く、eSIM導線は補足程度 |

### 6. 海外旅行保険・駐在員保険・医療 (提携先要確認)

| ファイル名 | タイトル | category | 確度 | 推奨する差し込み位置・リンク内容 |
|---|---|---|---|---|
| `jakarta-japanese-hospitals-guide.md` | ジャカルタで日本語が通じる病院・クリニック一覧【2026年版】 | lifestyle | 高 | 「保険の使い方」節(海外旅行保険・駐在員保険・キャッシュレス受診)に保険比較・見積りリンク。提携先要確認 |
| `2026-09-25-jakarta-health-dialysis-warning-2026.md` | ジャカルタ保健局が警告：若年層の間で腎疾患や透析治療が増加、安易な服薬に注意 | lifestyle | 低 | 透析・腎疾患の注意喚起。保険の必要性に触れる程度 |
| `2026-09-25-west-jakarta-pneumonia-cases-spike-health-alert.md` | 西ジャカルタで小児などの肺炎症例が急増、第3四半期で約1万6000件に　保健当局が注意喚起 | safety | 低 | 肺炎急増の健康ニュース。医療保険の導線は弱い |
| `2026-09-12-bpom-warns-against-31-illegal-herbal-supplements.md` | BPOM、有害成分を含む違法ハーブ薬・サプリメント31品目を公表し警告 | safety | 低 | 違法ハーブ薬・サプリの警告。保険とは接点が薄い |

### 7. VPN・ネット規制 (提携先要確認)

該当する候補記事なし(0本)。§4で新規記事を提案。

### 8. その他(法人設立・ビザ代行・会計、空気清浄機・マスク、クレジットカード)

| ファイル名 | タイトル | category | 確度 | 推奨する差し込み位置・リンク内容 |
|---|---|---|---|---|
| `kitas-renewal-guide-2026.md` | 【2026年最新】KITAS更新の完全ガイド — 必要書類・費用・手順を解説 | visa | 高 | 更新手順・費用の節にビザ更新代行サービスへの相談導線(ASP/直接提携かは要確認) |
| `indonesia-company-establishment-guide.md` | インドネシアで法人設立する手順と費用【2026年完全ガイド】 | regulation | 高 | 設立手順・費用の節に設立代行・会計事務所への相談導線(リード型。ASP/直接提携かは要確認) |
| `indonesia-tax-guide-japanese.md` | インドネシアの税金を完全解説 — 日本人駐在員・現地採用が知るべき税制【2026年】 | regulation | 中 | 申告・NPWP節に税務申告代行・会計事務所への相談導線 |
| `2026-09-02-jakarta-air-pollution-masks-advisory.md` | ジャカルタで大気汚染が悪化、保健局がマスク着用や乳児の外出自粛を呼びかけ | safety | 中 | マスク着用の呼びかけ。推奨マスク/空気清浄機の物販アフィリ(Amazon/楽天等。ASPは別途) |
| `2026-07-31-jakarta-air-quality-ranks-fourth-worst.md` | ジャカルタの大気汚染が世界4位の悪化水準に　乾季の影響でPM2.5高水準 | safety | 低 | 大気汚染ランキングニュース。`2026-09-02-jakarta-air-pollution-masks-advisory.md` と同種の物販導線を付ける場合のみ |
| `2026-09-17-jakarta-air-quality-ranks-fourth-worst-globally.md` | ジャカルタの大気汚染が世界ワースト4位に悪化、専門家が注意喚起 | safety | 低 | 同上。`2026-07-31-jakarta-air-quality-ranks-fourth-worst.md` と内容重複 |
| `2026-08-21-cimb-niaga-launches-retail-indonesia-credit-card.md` | CIMB Niaga、QRIS連携の個人向け「インドネシア・クレジットカード（KKI）」を発行 | business | 低 | CIMB Niaga KKIカード。日本人向けカード紹介の導線は弱い |

## 4. 補足: 候補が少ない/ゼロのカテゴリと新規記事の提案

既存287本の中に、以下と同じテーマの記事は見当たらなかった(タイトル・description・本文キーワードで確認)。

| 提案テーマ | 対象ASP | 狙い |
|---|---|---|
| インドネシアで使えるVPN比較と、ネット規制・接続遮断への備え(日本の動画配信・銀行アプリの利用も含む) | VPN(提携先要確認) | VPN案件が0本。在住者はゲオブロックや公共Wi-Fiの安全性で検索意図が明確で、成約に近い |
| ジャカルタ在住者のための日本↔インドネシア送金・両替ガイド(手数料比較、Wiseなど) | Wise | ルピア下落ニュース3本の受け皿。エバーグリーン化して内部リンクを集める |
| バリ・ロンボク・ジョグジャ・ブロモ旅行の予約ガイド(ホテル・ツアー・航空券・eSIMを1ページに) | Trip.com / Klook / Agoda | 現状、旅行記事はニュース寄りで高確度が2本のみ。旅行の実用ガイドが不足 |
| インドネシア在住者・出張者の海外旅行保険/駐在員保険の選び方(キャッシュレス受診対応の日系クリニック連携) | 保険(提携先要確認) | 病院ガイド1本しか保険に触れていない。保険比較は単価が高い |
| インドネシア用eSIMの選び方(観光・出張・KITAS保持者別、SIMカード購入との比較) | Klook / Trip.com eSIM | eSIM案件の記事が0本。空港到着時の設定手順まで書けば高確度 |

参考: gourmet 45本(飲食店ガイド)は今回のASPカテゴリに直接合致しない。店舗予約・クーポン系(例: Klookのダイニングバウチャー、ホテルのアフタヌーンティー)を追加検討する余地はあるが、提携可否の確認が先。

## 5. 判定方法と限界

### 判定方法

1. 298本の frontmatter(title / description / category / tags / pubDate / draft)を機械的に抽出し、`draft: true` の11本を除いた287本の全タイトルを目視で確認した。
2. 単純なキーワード一致では判断せず、タイトルと description から「読者がこの記事を読んだ直後に予約/申込の行動を取り得るか」で仮判定した。
3. 仮判定した候補について、本文の見出し構成と、送金・保険・予約・OTA・eSIM 等のキーワード周辺を確認し、差し込み位置を決めた(本文の全文精読ではなく、必要箇所のみ)。
4. 確度は §3 冒頭の基準に従った。pubDate が古い、期限切れのプロモ、災害・事故・犯罪の報道は「低」または除外にした。

### 除外した例(誤判定防止のため明記)

| ファイル名 | 除外理由 |
|---|---|
| `2026-08-01-pullman-hotel-fire-jakarta-electrical-short.md` | ホテル火災のニュース。宿泊予約の意図なし |
| `2026-09-04-pavilion-apartment-fire-tanah-abang.md` | アパート火災。日本人救助の事件ニュースで、保険・宿泊いずれの意図もない |
| `2026-08-15-ntt-flores-earthquake-m7-labuan-bajo.md` | フローレス島沖M7.7地震(ラブアンバジョ)。災害報道で予約導線は不適切 |
| `2026-08-21-kalimantan-wildfires-haze-flights-suspended-singkawang.md` | カリマンタン煙霧の欠航。障害情報のため航空券導線は不適切 |
| `2026-08-24-soetta-kalimantan-flights-cancelled-haze.md` | 同上(43便欠航) |
| `2026-09-06-soekarno-hatta-airport-temporary-closure-anak-krakatau-erupt.md` | アナクラカタウ噴火による空港閉鎖(災害)。航空券導線は不適切 |
| `2026-08-04-bmkg-july-2026-driest-july-since-1991.md` | 1991年以来最乾燥の7月(気象)。無関係 |
| `2026-08-04-mount-bromo-forest-fire-tourist-access-restricted.md` | ブロモ山火事(観光アクセス制限)。238の再開記事に集約 |
| `2026-08-23-lombok-sade-traditional-village-fire.md` | ロンボク島サデ村火災。事故報道 |
| `2026-08-04-kpk-searches-jakarta-immigration-offices.md` | KPKが入管を家宅捜索。汚職捜査でビザ代行導線は不適切 |
| `2026-09-08-bali-immigration-deports-foreigner-visa-violation.md` | バリ強制送還ニュース。不法就労の摘発報道 |
| `2026-09-21-jw-marriott-jakarta-mid-autumn-mooncake-collection.md` | JWマリオット月餅。ホテルブランドの物販で、宿泊予約意図なし |
| `2026-09-20-the-langham-jakarta-restaurant-brimo-discount.md` | ザ・ランガムのレストランプロモ。飲食で宿泊予約意図なし |
| `2026-07-31-indonesia-ec-platforms-withhold-tax-august-2026.md` | EC出品者の源泉徴収。在住者向け税制で、送金意図なし |

### 限界・手作業で確認すべき点

- 確度は主にタイトル・description・見出しで判定しており、本文全文は候補の一部しか読んでいない。差し込み前に本文を通読して文脈が合うか確認する。
- ASPごとの取扱商品(例: Klook/Trip.comがYIA空港鉄道、Whoosh、Dufanのチケットを扱うか)は未確認。案件検索で実在を確認すること。
- Wise Business(法人向け・ルピア宛て)の対応可否、保険・VPN・eSIM の提携先、ビザ代行・会計事務所の紹介契約はすべて未調査。
- 国別・カード別の利用可否(例: TravelokaでJCB/日本発行カードが弾かれる件は、記事の記述をそのまま参照した)は最新情報を要確認。
- 複数のASPカテゴリに同じ記事が載る場合があり(例: `2026-09-25-indonesia-public-holidays-cuti-bersama-2027.md` はホテルと航空券)、延べ件数と記事数は一致しない。
- 景品表示法・ステマ規制に基づく「広告(PR)表記」を、リンク挿入と同時に対応する必要がある(ドキュメント作成時点では未実装)。
- pubDate から見た一過性の判断は2026-09-29時点。日付が進むとプロモ記事(Whoosh割引、DAMRI割引等)は自動的に期限切れになる。
