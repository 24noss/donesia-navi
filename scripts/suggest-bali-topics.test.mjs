import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  BALI_SEEDS,
  appendTopics,
  buildPrBody,
  buildTopicsPrompt,
  collectUncoveredCandidates,
  isPhraseCovered,
  normalizePhrase,
  normalizeProposals,
  runSuggest,
} from './suggest-bali-topics.mjs';
import { validateGuideTopics } from './lib/guide-topics.mjs';

const FIX = path.join(process.cwd(), 'scripts/fixtures/guide');
const fx = JSON.parse(await readFile(path.join(FIX, 'suggest-fixture.json'), 'utf-8'));
const rawProposals = JSON.parse(await readFile(path.join(FIX, 'gemini-topics-response.json'), 'utf-8'));
const ledger = JSON.parse(await readFile(path.join(FIX, 'guide-topics.json'), 'utf-8'));
const sources = JSON.parse(await readFile(path.join(FIX, 'official-sources.json'), 'utf-8'));
const themeKeys = new Set(Object.keys(sources.themes));
const quiet = { log() {}, warn() {} };
const NOW = new Date('2026-09-29T02:00:00Z');

describe('カバー判定', () => {
  const ctx = { topics: ledger.topics, articleTitles: ['ジャカルタの日本語対応病院ガイド'] };
  test('normalizePhrase は空白除去・小文字化・バリ島→バリ', () => {
    assert.equal(normalizePhrase('バリ島 eSIM'), 'バリesim');
  });
  test('台帳の keywords を含む語はカバー済み(双方向の部分一致)', () => {
    assert.equal(isPhraseCovered('バリ 入国 カード', ctx), true);
    assert.equal(isPhraseCovered('バリ 病院 日本語', ctx), true);
    assert.equal(isPhraseCovered('バリ 雨季 服装', ctx), false);
  });
  test('既存記事タイトルに含まれる語はカバー済み', () => {
    assert.equal(isPhraseCovered('日本語対応病院', ctx), true);
  });
  test('3文字未満のキーワードでは誤爆しない', () => {
    assert.equal(isPhraseCovered('バリ 雨季', { topics: [{ title: 'x', keywords: ['バリ'] }], articleTitles: [] }), false);
  });
});

describe('collectUncoveredCandidates', () => {
  const seedSuggestions = Object.entries(fx.suggestions).map(([seed, suggestions]) => ({ seed, suggestions }));
  const r = collectUncoveredCandidates({ seedSuggestions, gscRows: fx.gscRows, topics: ledger.topics, articleTitles: fx.articleTitles });
  test('未カバーのサジェストだけ残し、バリ関連でない語は除く', () => {
    const all = r.suggestGroups.flatMap((g) => g.phrases);
    assert.ok(all.includes('バリ 雨季 服装') && all.includes('バリ esim おすすめ'));
    assert.ok(!all.includes('バリ 入国 カード') && !all.includes('バリ 病院 日本語') && !all.includes('ジャカルタ 治安'));
  });
  test('GSC は「バリ|bali」を含む未カバークエリだけを表示回数順に返す', () => {
    assert.deepEqual(r.gscQueries.map((q) => q.query), ['バリ島 雨季 服装', 'bali esim']);
  });
  test('GSC 未連携(null)でもサジェストだけで動く', () => {
    const r2 = collectUncoveredCandidates({ seedSuggestions, gscRows: null, topics: ledger.topics, articleTitles: [] });
    assert.equal(r2.gscQueries.length, 0);
  });
  test('シード語に主要なバリ関連語が含まれる', () => {
    for (const s of ['バリ 入国', 'バリ 観光税', 'バリ eSIM', 'バリ 持ち込み']) assert.ok(BALI_SEEDS.includes(s));
  });
});

describe('normalizeProposals', () => {
  const groups = [{ seed: 's', phrases: ['バリ 雨季 服装', 'バリ esim おすすめ'] }];
  const gsc = [{ query: 'bali esim', impressions: 60, clicks: 1 }];
  const run = (raw, extra = {}) =>
    normalizeProposals({ raw, ledgerTopics: ledger.topics, themeKeys, existingArticleIds: new Set(), suggestGroups: groups, gscQueries: gsc, today: '2026-09-29', ...extra });

  const r = run(rawProposals);
  test('id は再正規化、重複/既存トピックと被る案は除外、最終台帳は検証を通る', () => {
    assert.deepEqual(r.added.map((t) => t.id), ['bali-esim-guide', 'bali-rainy-season-clothes']);
    assert.deepEqual(r.skipped.map((s) => s.id).sort(), ['bali-entry-card-duplicate', 'fixture-bali-entry-checklist']);
    assert.deepEqual(validateGuideTopics(appendTopics(ledger, r.added), { sourceThemeKeys: themeKeys }), []);
  });
  test('sourceThemes は official-sources に存在するキーのみ。空なら on-hold + 理由', () => {
    const esim = r.added.find((t) => t.id === 'bali-esim-guide');
    const rain = r.added.find((t) => t.id === 'bali-rainy-season-clothes');
    assert.deepEqual([esim.status, esim.sourceThemes], ['queued', ['entry']]);
    assert.deepEqual([rain.status, rain.sourceThemes], ['on-hold', []]);
    assert.ok(r.holdReasons['bali-rainy-season-clothes']);
  });
  test('tags は語彙でフィルタされ「バリ島」が補われる。extraReferences/affiliate は常に空', () => {
    const rain = r.added.find((t) => t.id === 'bali-rainy-season-clothes');
    assert.ok(!rain.tags.includes('独自タグ'));
    assert.ok(rain.tags.includes('バリ島'));
    assert.ok(r.added.every((t) => t.extraReferences.length === 0 && t.affiliate.length === 0 && t.addedAt === '2026-09-29'));
  });
  test('根拠は収集した語句と一致するものだけ採用する', () => {
    assert.deepEqual(r.evidence['bali-esim-guide'].suggest, ['バリ esim おすすめ']);
    assert.deepEqual(r.evidence['bali-esim-guide'].gsc.map((g) => g.query), ['bali esim']);
    assert.deepEqual(r.evidence['bali-rainy-season-clothes'].gsc, []); // GSC候補に無い語は不採用
  });
  test('最大件数で打ち切る / ymyl はカテゴリから補う / 予約プレフィックスは回避', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `bali-t${i}`, title: `案${i}`, audience: ['tourist'], category: 'visa', tags: ['ビザ'], ymyl: false, keywords: [`kw${i}長い`], outline: [], sourceThemes: ['entry'], priority: 9, evidenceQueries: [] }));
    const rr = run(many);
    assert.equal(rr.added.length, 7);
    assert.ok(rr.added.every((t) => t.ymyl === true && t.priority === 5));
    const reserved = run([{ ...many[0], id: 'topics-x', keywords: ['別語彙'] }]);
    assert.equal(reserved.added[0].id, 'bali-topics-x');
  });
  test('role/hub/primaryKeyword: spoke は既存 hub の id だけ有効、不明な hub は role hub に落として注意を残す', () => {
    const esim = r.added.find((t) => t.id === 'bali-esim-guide');
    const rain = r.added.find((t) => t.id === 'bali-rainy-season-clothes');
    assert.deepEqual([esim.role, esim.hub, esim.primaryKeyword], ['spoke', 'fixture-bali-entry-checklist', 'バリ esim']);
    assert.deepEqual([rain.role, rain.hub], ['hub', undefined]);
    assert.ok(r.notes['bali-rainy-season-clothes'].includes('no-such-hub'));
    assert.ok(esim.keywords.includes('バリ esim')); // primaryKeyword は keywords に含まれる
  });
  test('primaryKeyword が既存台帳の primaryKeyword と(正規化後)一致する案は除外', () => {
    const rr = run([{ ...rawProposals[1], id: 'bali-dup-pk', primaryKeyword: '　バリ  入国 ', keywords: ['別語彙A'] }]);
    assert.equal(rr.added.length, 0);
    assert.match(rr.skipped[0].reason, /primaryKeyword .* fixture-bali-entry-checklist/);
  });
  test('keywords に既存の primaryKeyword を含む案は除外', () => {
    const rr = run([{ ...rawProposals[1], id: 'bali-kw-pk', primaryKeyword: 'バリ 新語彙', keywords: ['バリ 新語彙', 'バリ 入国'] }]);
    assert.equal(rr.added.length, 0);
    assert.match(rr.skipped[0].reason, /keywords の "バリ 入国" が fixture-bali-entry-checklist の primaryKeyword/);
  });
  test('既存トピックの keywords と2語以上一致する案は除外(1語だけなら別ルール)', () => {
    const led = { ...ledger, topics: ledger.topics.map((t) => (t.id === 'fixture-bali-hospital' ? { ...t, keywords: ['バリ 病院', '病院 保証金', '病院 日本語'] } : t)) };
    const base = { ...rawProposals[1], id: 'bali-overlap', primaryKeyword: 'バリ 病院 新', title: 'まったく別のタイトル' };
    const two = run([{ ...base, keywords: ['バリ 病院 新', '病院 保証金', '病院 日本語'] }], { ledgerTopics: led.topics });
    assert.equal(two.added.length, 0);
    assert.match(two.skipped[0].reason, /fixture-bali-hospital と keywords が2語以上一致/);
  });
  test('同じバッチ内で primaryKeyword が重複する案は後の方を除外し、最終台帳は検証を通る', () => {
    const a = { ...rawProposals[1], id: 'bali-a', primaryKeyword: 'バリ 新A', keywords: ['バリ 新A'], title: '案A' };
    const b = { ...a, id: 'bali-b', title: '案B', primaryKeyword: ' バリ　新a ', keywords: ['別語彙B'] };
    const rr = run([a, b]);
    assert.deepEqual(rr.added.map((t) => t.id), ['bali-a']);
    assert.equal(rr.skipped[0].id, 'bali-b');
    assert.deepEqual(validateGuideTopics(appendTopics(ledger, rr.added), { sourceThemeKeys: themeKeys }), []);
  });
  test('プロンプトに既存の主キーワードと hub の id が入り、PR本文に role/primaryKeyword が出る', () => {
    const p = buildTopicsPrompt({ suggestGroups: groups, gscQueries: gsc, existingTopics: ledger.topics, themes: sources.themes });
    assert.ok(p.includes('バリ 入国 | バリ 入国') || p.includes('[バリ 入国 |'));
    assert.ok(p.includes('# 既存の hub') && p.includes('- fixture-bali-entry-checklist:'));
    const body = buildPrBody({ ...r, today: '2026-09-29', gscUsed: true });
    assert.ok(body.includes('primaryKeyword: バリ esim / role: spoke (hub: `fixture-bali-entry-checklist`)'));
    assert.ok(body.includes('注意: spoke として提案された'));
  });
  test('プロンプトに出典テーマのキー・語彙・既存トピックが入る', () => {
    const p = buildTopicsPrompt({ suggestGroups: groups, gscQueries: gsc, existingTopics: ledger.topics, themes: sources.themes });
    assert.ok(p.includes('entry:') && p.includes('バリ島') && p.includes('fixture-bali-entry-checklist') && p.includes('bali esim'));
  });
  test('PR本文に keywords・根拠・sourceThemes・保留理由が入る', () => {
    const body = buildPrBody({ ...r, today: '2026-09-29', gscUsed: true });
    for (const s of ['bali-esim-guide', 'keywords:', '根拠(サジェスト)', 'sourceThemes: entry', '保留の理由', '除外した案']) assert.ok(body.includes(s), s);
  });
});

describe('runSuggest(フィクスチャ)', () => {
  async function args() {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'sb-'));
    return { dryRun: true, outDir, topicsPath: path.join(FIX, 'guide-topics.json'), sourcesPath: path.join(FIX, 'official-sources.json') };
  }
  const baseDeps = () => ({
    fetchSuggestions: async (seed) => fx.suggestions[seed] || [],
    getGsc: async () => fx.gscRows,
    callGemini: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(rawProposals) }] } }] }),
    articleTitles: fx.articleTitles,
    existingArticleIdsOverride: new Set(),
    now: NOW,
    log: quiet,
  });

  test('提案あり: 台帳(出力先)に追記され、PR本文が返る。元の台帳ファイルは変更しない', async () => {
    const a = await args();
    const before = await readFile(a.topicsPath, 'utf-8');
    const r = await runSuggest({ args: a, deps: baseDeps() });
    assert.equal(r.status, 'proposed');
    const written = JSON.parse(await readFile(r.ledgerPath, 'utf-8'));
    assert.equal(written.topics.length, ledger.topics.length + 2);
    assert.equal(await readFile(a.topicsPath, 'utf-8'), before);
    assert.ok(r.prBody.includes('bali-esim-guide'));
  });
  test('未カバー候補が0件ならPRを作らず status:none(Geminiも呼ばない)', async () => {
    const d = baseDeps();
    d.fetchSuggestions = async () => [];
    d.getGsc = async () => null;
    d.callGemini = async () => assert.fail('呼ばれないはず');
    assert.equal((await runSuggest({ args: await args(), deps: d })).status, 'none');
  });
  test('Gemini が0件を返したら status:none', async () => {
    const d = baseDeps();
    d.callGemini = async () => ({ candidates: [{ content: { parts: [{ text: '[]' }] } }] });
    assert.equal((await runSuggest({ args: await args(), deps: d })).status, 'none');
  });
  test('未処理のトピック提案PRがあれば(非dry-run)スキップ', async () => {
    const d = baseDeps();
    d.openPrState = async () => ({ openTopicsPrs: [{ number: 7, branch: 'auto/guide-topics-20260922' }] });
    const a = { ...(await args()), dryRun: false };
    const r = await runSuggest({ args: a, deps: d });
    assert.equal(r.status, 'skipped');
    assert.match(r.reason, /#7/);
  });
});
