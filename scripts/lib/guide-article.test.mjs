import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_BODY_CHARS,
  assembleArticleFile,
  buildGuideMarkdown,
  buildGuidePrompt,
  buildRoleSection,
  findKeywordCollisions,
  buildRefreshPrompt,
  extractGeminiText,
  extractUrlsFromTexts,
  formatRemovedUrlReport,
  formatReplacedHeadingReport,
  parseArticleFile,
  parseGeminiObject,
  setFrontmatterDate,
  stripDisallowedUrls,
  validateFrontmatterShape,
  validateGuideOutput,
  validateRefreshOutput,
} from './guide-article.mjs';

const A = 'https://gov.example/a';
const B = 'https://gov.example/b';

function goodBody(extra = '') {
  return `## この記事の要点\n\n- 要点\n\n## 本文\n\n${'本文の文章です。'.repeat(320)}${extra}\n\n## よくある質問\n\n**Q. 質問**\nA. 回答`;
}

describe('validateGuideOutput', () => {
  const base = () => ({ title: 'T', description: 'D', body: goodBody(), usedSourceUrls: [A] });

  test('正常な出力は ok', () => {
    const r = validateGuideOutput(base(), { allowedUrls: [A, B] });
    assert.equal(r.ok, true, r.problems.join());
    assert.deepEqual(r.value.usedSourceUrls, [A]);
  });
  test('usedSourceUrls は渡したURLの部分集合のみ残す(渡していないURLは除去)', () => {
    const r = validateGuideOutput({ ...base(), usedSourceUrls: [A, 'https://evil.example/x', `${B}/`, A] }, { allowedUrls: [A, B] });
    assert.deepEqual(r.value.usedSourceUrls, [A, B]);
    assert.deepEqual(r.droppedSourceUrls, ['https://evil.example/x']);
  });
  test('usedSourceUrls が空(または全て渡していないURL)なら失敗', () => {
    assert.equal(validateGuideOutput({ ...base(), usedSourceUrls: [] }, { allowedUrls: [A] }).ok, false);
    assert.equal(validateGuideOutput({ ...base(), usedSourceUrls: ['https://evil.example/'] }, { allowedUrls: [A] }).ok, false);
  });
  test('最低文字数・必須見出しを満たさなければ失敗', () => {
    const short = validateGuideOutput({ ...base(), body: '## この記事の要点\n短い\n## よくある質問\nQ' }, { allowedUrls: [A] });
    assert.equal(short.ok, false);
    assert.ok(short.problems.some((p) => p.includes('短すぎる')));
    const noFaq = validateGuideOutput({ ...base(), body: goodBody().replace('よくある質問', 'その他') }, { allowedUrls: [A] });
    assert.ok(noFaq.problems.some((p) => p.includes('よくある質問')));
    assert.ok(MIN_BODY_CHARS >= 2500);
  });
  test('本文中の渡していない外部URLは除去する(Markdownリンクは文字だけ残す)', () => {
    const body = goodBody(`\n詳細は[外部](https://evil.example/x)と https://evil2.example/y を参照。公式は[公式](${A})と ${B} 。`);
    const r = validateGuideOutput({ ...base(), body }, { allowedUrls: [A, B] });
    assert.equal(r.ok, true);
    assert.ok(!r.value.body.includes('evil'));
    assert.ok(r.value.body.includes('外部'));
    assert.ok(r.value.body.includes(`(${A})`));
    assert.ok(r.value.body.includes(B));
    assert.deepEqual(r.removedUrls.sort(), ['https://evil.example/x', 'https://evil2.example/y']);
  });
  test('H1 は H2 に下げる', () => {
    const r = validateGuideOutput({ ...base(), body: `# 大見出し\n${goodBody()}` }, { allowedUrls: [A] });
    assert.ok(r.value.body.startsWith('## 大見出し'));
  });
});

describe('stripDisallowedUrls', () => {
  test('許可URLは末尾の句読点付きでも残す', () => {
    const r = stripDisallowedUrls(`詳細は ${A}。 と ${A}, です`, [A]);
    assert.equal(r.removed.length, 0);
  });
  test('<url> 形式も処理する', () => {
    const r = stripDisallowedUrls('見る <https://evil.example/x> と <' + A + '>', [A]);
    assert.deepEqual(r.removed, ['https://evil.example/x']);
    assert.ok(r.body.includes(`<${A}>`));
  });
});

describe('stripDisallowedUrls(一律の許可リスト判定)', () => {
  test('タイトル付きリンク [t](url "ttl") は除去され text だけ残る', () => {
    const r = stripDisallowedUrls('見て[t](https://evil.com/x "ttl")ね', [A]);
    assert.equal(r.body, '見てtね');
    assert.deepEqual(r.removed, ['https://evil.com/x']);
  });
  test('括弧を含むURL [a](https://evil.com/p(1)) は全体が除去され ")" が残らない', () => {
    const r = stripDisallowedUrls('[a](https://evil.com/p(1)) 続き', [A]);
    assert.equal(r.body, 'a 続き');
    assert.deepEqual(r.removed, ['https://evil.com/p(1)']);
  });
  test('スキーム無し www. ドメインも除去する(句読点は残す)', () => {
    const r = stripDisallowedUrls('参照: www.evil.com/a。 と www.evil.com。', [A]);
    assert.ok(!r.body.includes('evil'));
    assert.equal(r.body, '参照: 。 と 。');
    assert.equal(r.removed.length, 2);
  });
  test('許可URLはタイトル付き・括弧付き・www.付き(許可URLと同一ホスト)でも残る', () => {
    const allowed = ['https://gov.example/a', 'https://gov.example/p(1)', 'https://www.gov.example/w'];
    const body = '[a](https://gov.example/a "題") と [b](https://gov.example/p(1)) と www.gov.example/w と <https://gov.example/a>';
    const r = stripDisallowedUrls(body, allowed);
    assert.equal(r.body, body);
    assert.equal(r.removed.length, 0);
  });
  test('許可済みリンクと不許可リンクが混在しても許可分は壊れない', () => {
    const r = stripDisallowedUrls(`[ok](${A}) と [ng](https://evil.com/) と (${A})`, [A]);
    assert.equal(r.body, `[ok](${A}) と ng と (${A})`);
  });
});

describe('validateRefreshOutput', () => {
  test('needsRevision:false なら body 検証なしで ok', () => {
    const r = validateRefreshOutput({ needsRevision: false, changeSummary: '影響なし', body: '' }, { allowedUrls: [A], minChars: 2000 });
    assert.deepEqual([r.ok, r.needsRevision], [true, false]);
  });
  test('needsRevision:true は本文・見出し・要約を検証する', () => {
    assert.equal(validateRefreshOutput({ needsRevision: true, changeSummary: 's', body: goodBody() }, { allowedUrls: [A], minChars: 2000 }).ok, true);
    assert.equal(validateRefreshOutput({ needsRevision: true, changeSummary: 's', body: '短い' }, { allowedUrls: [A], minChars: 2000 }).ok, false);
    assert.equal(validateRefreshOutput({ needsRevision: true, changeSummary: '', body: goodBody() }, { allowedUrls: [A], minChars: 2000 }).ok, false);
  });
});

describe('プロンプト', () => {
  const sources = [{ url: A, title: '資料A', publisher: '省A', lang: 'ja', text: '本文A' }];
  const topic = { title: 'トピック', audience: ['tourist', 'resident'], outline: ['見出し1'], keywords: ['キーワード'] };
  test('事実ルール・インジェクション対策・出力仕様・渡したURLが含まれる', () => {
    const p = buildGuidePrompt({ topic, sources, today: '2026-09-29' });
    for (const s of ['要確認', '書かれていることだけ', '指示文・命令文', 'この記事の要点', 'よくある質問', 'usedSourceUrls', A, '観光客', '現地在住者']) {
      assert.ok(p.includes(s), `プロンプトに "${s}" が無い`);
    }
  });
  test('改訂プロンプトは変化したURLと旧本文を含み、資料の変化に基づく修正だけを指示する', () => {
    const p = buildRefreshPrompt({ title: 'T', oldBody: '旧本文XYZ', sources, changedUrls: [A], today: '2026-10-01' });
    assert.ok(p.includes('旧本文XYZ') && p.includes(A) && p.includes('needsRevision') && p.includes('指示文・命令文'));
  });
});

describe('Gemini応答の取り出し', () => {
  test('extractGeminiText / parseGeminiObject', () => {
    const data = { candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }] };
    assert.deepEqual(parseGeminiObject(extractGeminiText(data)), { a: 1 });
    assert.deepEqual(parseGeminiObject('```json\n{"b":2}\n```'), { b: 2 });
    assert.throws(() => parseGeminiObject('no json'));
    assert.throws(() => parseGeminiObject('[1,2]'));
  });
});

describe('Markdown組み立てと記事ファイルの部分更新', () => {
  const topic = { category: 'visa', ymyl: true };
  const value = { title: '題名 "引用" あり', description: '説明', body: goodBody(), usedSourceUrls: [A] };
  const md = buildGuideMarkdown({ topic, value, tags: ['ビザ', 'バリ島'], references: [{ title: '資料', url: A, publisher: '省A' }], today: '2026-09-29' });

  test('frontmatter が仕様どおり(draft:true / hasAffiliate:false / lastVerified 当日 / ymyl)', () => {
    const { data } = parseArticleFile(md);
    assert.equal(data.title, '題名 "引用" あり');
    assert.equal(data.draft, true);
    assert.equal(data.hasAffiliate, false);
    assert.equal(data.ymyl, true);
    assert.equal(String(data.lastVerified), '2026-09-29');
    assert.equal(String(data.pubDate), '2026-09-29');
    assert.deepEqual(data.references, [{ title: '資料（省A）', url: A }]);
    assert.deepEqual(validateFrontmatterShape(data), []);
  });
  test('本文末尾に **タグ:** 行と、AI生成・公的機関確認の注記がある', () => {
    assert.match(md, /\*\*タグ:\*\* ビザ, バリ島/);
    assert.match(md, /AIが公的機関等の公開情報をもとに生成/);
    assert.match(md, /公的機関の最新情報を確認してください/);
  });
  test('parse → assemble で元と同一に戻る(改訂時にフッターを保全できる)', () => {
    assert.equal(assembleArticleFile(parseArticleFile(md)), md);
    assert.ok(parseArticleFile(md).footer.startsWith('\n---\n**カテゴリ:**'));
    assert.ok(!parseArticleFile(md).body.includes('**タグ:**'));
  });
  test('setFrontmatterDate: 既存キーの置換 / updatedDate を pubDate の後ろに挿入', () => {
    const p = parseArticleFile(md);
    let fm = setFrontmatterDate(p.frontmatter, 'lastVerified', '2026-10-01');
    fm = setFrontmatterDate(fm, 'updatedDate', '2026-10-01');
    const lines = fm.split('\n');
    assert.equal(lines[lines.indexOf('pubDate: 2026-09-29') + 1], 'updatedDate: 2026-10-01');
    assert.ok(lines.includes('lastVerified: 2026-10-01'));
    assert.equal(lines.filter((l) => l.startsWith('lastVerified:')).length, 1);
  });
  test('setFrontmatterDate: lastVerified が無い記事には挿入する', () => {
    const fm = setFrontmatterDate('title: "x"\npubDate: 2026-01-01\ndraft: false', 'lastVerified', '2026-10-01');
    assert.equal(fm, 'title: "x"\npubDate: 2026-01-01\nlastVerified: 2026-10-01\ndraft: false');
  });
});

describe('validateFrontmatterShape(content.config.ts の articles スキーマ相当)', () => {
  const ok = { title: 't', description: 'd', category: 'visa', tags: ['ビザ'], pubDate: '2026-09-29', draft: true };
  test('正常', () => assert.deepEqual(validateFrontmatterShape(ok), []));
  test('語彙外タグ・不正category・不正references・不正日付を検出', () => {
    assert.ok(validateFrontmatterShape({ ...ok, tags: ['独自'] }).some((p) => p.includes('語彙外')));
    assert.ok(validateFrontmatterShape({ ...ok, category: 'x' }).some((p) => p.includes('category')));
    assert.ok(validateFrontmatterShape({ ...ok, references: [{ title: 'a', url: 'bad' }] }).some((p) => p.includes('references')));
    assert.ok(validateFrontmatterShape({ ...ok, pubDate: 'nope' }).some((p) => p.includes('pubDate')));
    assert.ok(validateFrontmatterShape({ ...ok, ymyl: 'yes' }).some((p) => p.includes('ymyl')));
  });
});

// PR #124 (bali-entry-checklist) で壊れた箇所の再現。
// 原因1: 全角括弧「）」や日本語の続きまでURLとして巻き込んで除去していた
// 原因2: 許可リストが references のURLだけで、資料本文が案内する公式URLまで除去していた
describe('PR #124 の再現(URL除去で文が壊れる)', () => {
  const OFFICIAL = 'https://allindonesia.imigrasi.go.id';
  const EVOA = 'https://evisa.imigrasi.go.id';

  test('全角括弧で閉じた裸URLの除去で「）」や後続の日本語を巻き込まない', () => {
    const r = stripDisallowedUrls('E-VOAは公式サイト（https://evil.example/x）またはAll Indonesiaから申請できます(出典: 外務省)。', [A]);
    assert.equal(r.body, 'E-VOAは公式サイトまたはAll Indonesiaから申請できます(出典: 外務省)。');
    assert.deepEqual(r.removed, ['https://evil.example/x']);
  });
  test('「サイト（URL）(出典…)」は空括弧が残らず「サイト(出典…)」になる', () => {
    const r = stripDisallowedUrls('従来通り税関サイト（https://evil.example/c）(出典: 外務省 海外安全ホームページ)。', [A]);
    assert.equal(r.body, '従来通り税関サイト(出典: 外務省 海外安全ホームページ)。');
  });
  test('値がURLだけの箇条書きは、ラベルと出典だけの行ごと落とす(除去情報には残る)', () => {
    const r = stripDisallowedUrls('- 手順\n- **公式アクセスリンク**: https://evil.example/x (出典: 外務省)\n- **入力可能時期**: 3日前', [A]);
    assert.equal(r.body, '- 手順\n- **入力可能時期**: 3日前');
    assert.equal(r.details.length, 1);
    assert.equal(r.details[0].after, null);
    assert.match(r.details[0].before, /公式アクセスリンク/);
  });
  test('Markdownリンクは文字だけ残り、裸URLだけの箇条書きは記号ごと落ちる', () => {
    const r = stripDisallowedUrls('[公式](https://evil.example/x)を参照\n- https://evil.example/y\n（https://evil.example/z）', [A]);
    assert.equal(r.body, '公式を参照\n');
  });
  test('資料本文に出現するURLは、references に無くても残る(末尾の句読点・括弧・大文字ホスト・末尾スラッシュを吸収)', () => {
    const extra = extractUrlsFromTexts(['公式サイトは https://AllIndonesia.imigrasi.go.id/ です。', `申請は (${EVOA}) から、詳細は www.example.go.id/info。`]);
    const body = `公式サイト（${OFFICIAL}）またはE-VOA（${EVOA}）、${OFFICIAL}。詳細は www.example.go.id/info。`;
    const r = stripDisallowedUrls(body, [A, ...extra]);
    assert.equal(r.body, body);
    assert.equal(r.removed.length, 0);
    assert.equal(r.details.length, 0);
  });
  test('資料本文に無いURLは同じ本文でも除去される', () => {
    const extra = extractUrlsFromTexts([`公式は ${OFFICIAL} です`]);
    const r = stripDisallowedUrls(`公式（${OFFICIAL}）や（https://evil.example/q）で`, [A, ...extra]);
    assert.equal(r.body, `公式（${OFFICIAL}）や で`.replace('や で', 'やで'));
    assert.deepEqual(r.removed, ['https://evil.example/q']);
  });
  test('extractUrlsFromTexts: 日本語の続きや全角括弧は含めず、重複は1件', () => {
    const urls = extractUrlsFromTexts([`（https://x.go.id/a）または https://X.go.id/a/ 、www.y.go.id。`]);
    assert.deepEqual(urls, ['https://x.go.id/a', 'www.y.go.id']);
  });
  test('validateGuideOutput / validateRefreshOutput は extraAllowedUrls で許可URLを残し、removedDetails を返す', () => {
    const body = goodBody(`\n公式（${OFFICIAL}）と（https://evil.example/x）(出典: 外務省)`);
    const g = validateGuideOutput({ title: 'T', description: 'D', body, usedSourceUrls: [A] }, { allowedUrls: [A], extraAllowedUrls: [OFFICIAL] });
    assert.equal(g.ok, true, g.problems.join());
    assert.ok(g.value.body.includes(`（${OFFICIAL}）`));
    assert.ok(g.value.body.includes('と(出典: 外務省)'));
    assert.deepEqual(g.removedUrls, ['https://evil.example/x']);
    assert.equal(g.removedDetails.length, 1);
    const f = validateRefreshOutput({ needsRevision: true, changeSummary: 's', body }, { allowedUrls: [A], extraAllowedUrls: [OFFICIAL], minChars: 2000 });
    assert.ok(f.body.includes(`（${OFFICIAL}）`));
    assert.deepEqual(f.removedUrls, ['https://evil.example/x']);
  });
  test('formatRemovedUrlReport: 除去が無ければ null、あれば URL・元の行・整形後を含む', () => {
    assert.equal(formatRemovedUrlReport([]), null);
    const r = stripDisallowedUrls('- **リンク**: https://evil.example/x (出典: a)\n税関（https://evil.example/y）(出典: b)', [A]);
    const md = formatRemovedUrlReport(r.details);
    assert.match(md, /除去したURLと該当行/);
    assert.match(md, /https:\/\/evil\.example\/x/);
    assert.match(md, /行ごと削除/);
    assert.match(md, /整形後: `税関\(出典: b\)`/);
  });
});

describe('見出しのキーワード競合検証(hub が spoke の検索語を奪う不具合)', () => {
  const ledger = [
    { id: 'hub-a', role: 'hub', title: 'バリ島入国に必要なもの【2026年版】チェックリスト', primaryKeyword: 'バリ 入国 必要なもの', label: '入国準備の全体像' },
    { id: 'spoke-levy', role: 'spoke', hub: 'hub-a', title: 'バリ島の外国人観光税(15万ルピア)の払い方と支払い証明【最新】', primaryKeyword: 'バリ 観光税 払い方', label: '観光税' },
    { id: 'spoke-evoa', role: 'spoke', hub: 'hub-a', title: 'バリ島のe-VOA申請ガイド:料金・滞在日数・有効期間・手順', primaryKeyword: 'e-VOA 申請 バリ', label: 'e-VOA' },
    { id: 'spoke-hold', role: 'spoke', hub: 'hub-a', status: 'on-hold', title: '保留の記事', primaryKeyword: 'バリ 保留', label: '保留' },
  ];
  const hub = ledger[0];
  const bodyWith = (...h2) => goodBody(h2.map((h) => `\n\n## ${h}\n\n要約です。`).join(''));
  const run = (o, topic = hub) => validateGuideOutput(o, { allowedUrls: [A], topic, ledgerTopics: ledger });

  test('PR #124 の見出し(spoke の title そのまま)は、hub なら spoke の label に自動置換され通る', () => {
    const r = run({ title: 'バリ島入国に必要なもの', description: 'D', usedSourceUrls: [A],
      body: bodyWith('バリ島の外国人観光税(15万ルピア)の払い方と支払い証明【最新】', 'バリ島のe-VOA申請ガイド:料金・滞在日数・有効期間・手順') });
    assert.deepEqual(r.problems, []);
    assert.equal(r.ok, true);
    assert.deepEqual(r.replacedHeadings.map((x) => [x.after, x.spokeId]), [['観光税', 'spoke-levy'], ['e-VOA', 'spoke-evoa']]);
    assert.match(r.value.body, /^## 観光税$/m);
    assert.match(r.value.body, /^## e-VOA$/m);
    assert.ok(!r.value.body.includes('払い方と支払い証明'));
  });
  test('本番ケース: 「e-VOAの申請」は spoke の label に置換。on-hold の spoke と衝突する見出しは対象外', () => {
    const led = [...ledger, { id: 'spoke-arrival', role: 'spoke', hub: 'hub-a', status: 'on-hold', title: 'All Indonesia 到着カード', primaryKeyword: 'All Indonesia 到着カード', label: '到着カード' }];
    const r = validateGuideOutput({ title: 'バリ島入国に必要なもの', description: 'D', usedSourceUrls: [A],
      body: bodyWith('e-VOAの申請', 'All Indonesia到着カードと税関申告') }, { allowedUrls: [A], topic: hub, ledgerTopics: led });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.replacedHeadings.map((x) => [x.before, x.after]), [['e-VOAの申請', 'e-VOA']]);
    assert.match(r.value.body, /^## All Indonesia到着カードと税関申告$/m);
    const md = formatReplacedHeadingReport(r.replacedHeadings);
    assert.match(md, /自動置換した見出し/);
    assert.match(md, /「e-VOAの申請」→「e-VOA」/);
    assert.equal(formatReplacedHeadingReport([]), null);
  });
  test('on-hold トピックは衝突判定の対象外(spoke 記事でも)', () => {
    assert.deepEqual(findKeywordCollisions({ title: 'T', body: '## 保留の記事 バリ 保留' }, ledger[1], ledger), []);
  });
  test('spoke 記事の見出しが兄弟 spoke / hub と衝突したら従来どおり失敗(置換しない)', () => {
    const r = run({ title: 'T', description: 'D', usedSourceUrls: [A], body: bodyWith('e-VOAの申請') }, ledger[1]);
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /spoke-evoa.*primaryKeyword/);
    assert.deepEqual(r.replacedHeadings, []);
  });
  test('hub でも、自分の spoke ではない他トピックとの衝突は失敗のまま', () => {
    const led = [...ledger, { id: 'other-hub', role: 'hub', title: '別ハブ', primaryKeyword: '別 ハブ 検索語', label: '別' }];
    const r = validateGuideOutput({ title: 'T', description: 'D', usedSourceUrls: [A], body: bodyWith('別ハブ 検索語の話') }, { allowedUrls: [A], topic: hub, ledgerTopics: led });
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /other-hub/);
  });
  test('primaryKeyword の全トークンを含む見出し(全角/大文字小文字の揺れ)は spoke 記事では失敗', () => {
    const r = run({ title: 'T', description: 'D', usedSourceUrls: [A], body: bodyWith('Ｅ-ＶＯＡ の申請手順(バリ)') }, ledger[1]);
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /spoke-evoa.*primaryKeyword/);
  });
  test('生成 title が自分の spoke の title を含む場合は hub でも失敗(title は置換しない)', () => {
    const r = run({ title: 'バリ島の外国人観光税(15万ルピア)の払い方と支払い証明【最新】まとめ', description: 'D', usedSourceUrls: [A], body: bodyWith('観光税') });
    assert.equal(r.ok, false);
    assert.match(r.problems.join('\n'), /title「.*」が他トピック spoke-levy/);
  });
  test('label だけの見出し(短い総称)は通る', () => {
    const r = run({ title: 'バリ島入国に必要なもの', description: 'D', usedSourceUrls: [A], body: bodyWith('観光税', 'e-VOA', '入国準備の全体像') });
    assert.deepEqual(r.problems, []);
    assert.equal(r.ok, true);
  });
  test('自分自身の title・primaryKeyword は衝突扱いしない。topic 未指定なら検査しない', () => {
    const spoke = ledger[1];
    assert.deepEqual(findKeywordCollisions({ title: spoke.title, body: '## バリ 観光税 払い方' }, spoke, ledger), []);
    assert.deepEqual(findKeywordCollisions({ title: spoke.title, body: '## x' }, undefined, ledger), []);
  });
  test('H3以下の見出しも検査する', () => {
    const p = findKeywordCollisions({ title: 'T', body: '### e-VOA 申請 バリ' }, hub, ledger);
    assert.equal(p.length, 1);
  });
});

describe('buildRoleSection(label のみ渡す)', () => {
  const ledger = [
    { id: 'hub-a', role: 'hub', title: 'HUBタイトル', primaryKeyword: 'ハブ 検索語', label: 'ハブ呼称' },
    { id: 's1', role: 'spoke', hub: 'hub-a', title: 'スポーク1のタイトル', primaryKeyword: 'スポーク 一', label: 'スポーク甲' },
    { id: 's2', role: 'spoke', hub: 'hub-a', title: 'スポーク2のタイトル', primaryKeyword: 'スポーク 二', label: 'スポーク乙' },
  ];
  test('hub のプロンプトに spoke の title / primaryKeyword は出ず、label が出る', () => {
    const p = buildRoleSection(ledger[0], ledger);
    assert.ok(p.includes('スポーク甲') && p.includes('スポーク乙'));
    for (const s of ['スポーク1のタイトル', 'スポーク2のタイトル', 'スポーク 一', 'スポーク 二']) assert.ok(!p.includes(s), s);
    assert.ok(p.includes('個別記事のタイトルや主キーワード'));
  });
  test('spoke のプロンプトは兄弟を label で、hub は title で渡す(兄弟の title / primaryKeyword は出さない)', () => {
    const p = buildRoleSection(ledger[1], ledger);
    assert.ok(p.includes('HUBタイトル') && p.includes('スポーク乙'));
    assert.ok(!p.includes('スポーク2のタイトル') && !p.includes('スポーク 二'));
    assert.ok(!p.includes('スポーク甲')); // 自分は含めない
  });
});

test('findKeywordCollisions: 地名を除いて1語になる primaryKeyword は語で判定しない(誤検知防止)', async () => {
  const { findKeywordCollisions } = await import('./guide-article.mjs');
  const ledger = [
    { id: 'self', title: 'バリ空港から市内', primaryKeyword: 'バリ 空港 から 市内' },
    { id: 'safety-hub', title: 'バリ島の治安と詐欺対策の総合ガイド', primaryKeyword: 'バリ 治安' },
    { id: 'hospital-hub', title: '医療の総合', primaryKeyword: 'バリ 病院 日本語' },
  ];
  const ok = findKeywordCollisions({ title: 'x', body: '## バリ空港周辺の治安と注意点' }, ledger[0], ledger);
  assert.deepEqual(ok, []);
  const ng = findKeywordCollisions({ title: 'x', body: '## 日本語が通じるバリの病院' }, ledger[0], ledger);
  assert.equal(ng.length, 1);
});
