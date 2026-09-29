import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFailureIssueBody, compareWithSnapshots, parseRefreshArgs, runRefresh, writeRefreshOutput } from './refresh-guides.mjs';
import { parseArticleFile, validateFrontmatterShape } from './lib/guide-article.mjs';

const FIX = path.join(process.cwd(), 'scripts/fixtures/guide');
const quiet = { log() {}, warn() {} };
const NOW = new Date('2026-10-01T03:00:00Z');
const S = {
  proc: 'https://example.org/fixture/entry-procedure',
  visa: 'https://example.org/fixture/entry-visa',
  levy: 'https://example.org/fixture/tourist-levy',
  health: 'https://example.org/fixture/health-info',
};

async function setup() {
  const pages = JSON.parse(await readFile(path.join(FIX, 'pages.json'), 'utf-8'));
  const resp = JSON.parse(await readFile(path.join(FIX, 'gemini-refresh-response.json'), 'utf-8'));
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'rg-'));
  const articlesDir = path.join(tmp, 'articles');
  await cp(path.join(FIX, 'articles'), articlesDir, { recursive: true });
  const args = {
    topicsPath: path.join(FIX, 'guide-topics.json'), sourcesPath: path.join(FIX, 'official-sources.json'),
    articlesDir, snapshotsDir: path.join(FIX, 'refresh-snapshots'), maxRevisions: 10,
  };
  const deps = {
    now: NOW, log: quiet,
    fetchImpl: async (u) => (u in pages ? new Response(pages[u], { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('nf', { status: 404 })),
    callGemini: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(resp) }] } }] }),
  };
  return { args, deps, tmp, articlesDir, pages, resp };
}

describe('compareWithSnapshots', () => {
  test('changed / unchanged / noBaseline に分類する', () => {
    const fetched = new Map([['a', { sha256: '1' }], ['b', { sha256: '2' }], ['c', { sha256: '3' }]]);
    const r = compareWithSnapshots(['a', 'b', 'c'], fetched, { a: { sha256: '1' }, b: { sha256: 'x' } });
    assert.deepEqual(r, { changed: ['b'], unchanged: ['a'], noBaseline: ['c'] });
  });
});

describe('runRefresh(フィクスチャ)', () => {
  test('変化あり→記事ごとの改訂PR、変化なし→まとめPR、取得失敗→更新せず一覧化', async () => {
    const { args, deps } = await setup();
    const r = await runRefresh({ args, deps });
    assert.deepEqual(r.stats, { targets: 3, unchanged: 1, noImpact: 0, baselineOnly: 0, revised: 1, failed: 1, deferred: 0 });
    const rev = r.groups.find((g) => g.kind === 'revision');
    const batch = r.groups.find((g) => g.kind === 'unchanged');
    assert.equal(rev.branch, 'auto/guide-refresh-fixture-bali-entry-checklist-202610');
    assert.equal(batch.branch, 'auto/guide-refresh-unchanged-202610');
    assert.equal(batch.title, 'ガイド出典の定期確認(2026-10): 変化なし 1本');
    assert.deepEqual(r.failures.map((f) => f.id), ['fixture-bali-broken']);
    assert.match(r.failures[0].reason, /HTTP 404/);
  });

  test('改訂: updatedDate と lastVerified が当日、draft:false のまま、フッターと frontmatter が保たれる', async () => {
    const { args, deps } = await setup();
    const rev = (await runRefresh({ args, deps })).groups.find((g) => g.kind === 'revision');
    const content = rev.files['src/content/articles/fixture-bali-entry-checklist.md'];
    const { data, footer, body } = parseArticleFile(content);
    assert.equal(String(data.updatedDate), '2026-10-01');
    assert.equal(String(data.lastVerified), '2026-10-01');
    assert.equal(data.draft, false);
    assert.deepEqual(validateFrontmatterShape(data), []);
    assert.match(footer, /\*\*タグ:\*\*/);
    assert.ok(body.includes('要確認'));
    assert.match(rev.body, /entry-visa/); // PR本文に変化したURL
    assert.match(rev.body, /変更された|要確認/);
  });

  test('スナップショット: 改訂PRは自分の出典だけ更新、変化なしPRは自分の分だけ更新(互いに独立)', async () => {
    const { args, deps } = await setup();
    const r = await runRefresh({ args, deps });
    const rev = r.groups.find((g) => g.kind === 'revision');
    const batch = r.groups.find((g) => g.kind === 'unchanged');
    const revSnap = JSON.parse(rev.files['src/data/guide-source-snapshots/fixture-bali-entry-checklist.json']);
    assert.notEqual(revSnap[S.visa].sha256, '0'.repeat(64)); // 更新された
    assert.ok(revSnap[S.levy]); // ベースラインが新規記録された
    // 記事ごとに別ファイル: 改訂PRは自分のファイルだけ、まとめPRは自分の記事のファイルだけを触る(互いに競合しない)
    assert.deepEqual(Object.keys(rev.files).filter((f) => f.includes('snapshots')), ['src/data/guide-source-snapshots/fixture-bali-entry-checklist.json']);
    assert.deepEqual(Object.keys(batch.files).filter((f) => f.includes('snapshots')), ['src/data/guide-source-snapshots/fixture-bali-hospital.json']);
  });

  test('変化なしの記事は lastVerified だけ更新(本文・他のキーは不変)', async () => {
    const { args, deps, articlesDir } = await setup();
    const batch = (await runRefresh({ args, deps })).groups.find((g) => g.kind === 'unchanged');
    const before = await readFile(path.join(articlesDir, 'fixture-bali-hospital.md'), 'utf-8');
    const after = batch.files['src/content/articles/fixture-bali-hospital.md'];
    const diffLines = after.split('\n').filter((l, i) => l !== before.split('\n')[i]);
    assert.deepEqual(diffLines, ['lastVerified: 2026-10-01']);
  });

  test('draft:true の記事・ファイルが無い台帳エントリは対象外', async () => {
    const { args, deps, articlesDir } = await setup();
    const p = path.join(articlesDir, 'fixture-bali-hospital.md');
    await writeFile(p, (await readFile(p, 'utf-8')).replace('draft: false', 'draft: true'));
    const r = await runRefresh({ args, deps });
    assert.equal(r.stats.targets, 2);
  });

  test('Gemini が needsRevision:false なら記事は書き換えず lastVerified のみ更新(まとめPRに影響なしとして記載)', async () => {
    const { args, deps } = await setup();
    deps.callGemini = async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ needsRevision: false, changeSummary: '日付表記のみの変化', body: '' }) }] } }] });
    const r = await runRefresh({ args, deps });
    assert.equal(r.groups.filter((g) => g.kind === 'revision').length, 0);
    const batch = r.groups.find((g) => g.kind === 'unchanged');
    assert.match(batch.body, /日付表記のみの変化/);
    assert.ok(batch.files['src/content/articles/fixture-bali-entry-checklist.md'].includes('lastVerified: 2026-10-01'));
  });

  test('改訂案の検証失敗・Gemini エラーは記事を更新せず失敗として記録(スナップショットも更新しない)', async () => {
    const { args, deps } = await setup();
    deps.callGemini = async () => { throw new Error('503'); };
    const r = await runRefresh({ args, deps });
    assert.ok(r.failures.some((f) => f.id === 'fixture-bali-entry-checklist' && f.reason.includes('改訂案の生成に失敗')));
    assert.equal(r.groups.filter((g) => g.kind === 'revision').length, 0);
    const batch = r.groups.find((g) => g.kind === 'unchanged');
    assert.equal(batch.files['src/data/guide-source-snapshots/fixture-bali-entry-checklist.json'], undefined); // 更新されない
  });

  test('ベースライン記録のみの記事は独立PRにせず「変化なし」まとめPRに同梱(記事ファイルは変更しない)', async () => {
    const { args, deps, tmp } = await setup();
    const r = await runRefresh({ args: { ...args, snapshotsDir: path.join(tmp, 'empty-snaps') }, deps });
    assert.equal(r.groups.length, 1);
    const batch = r.groups[0];
    assert.equal(batch.kind, 'unchanged');
    assert.deepEqual(Object.keys(batch.files).sort(), [
      'src/data/guide-source-snapshots/fixture-bali-entry-checklist.json',
      'src/data/guide-source-snapshots/fixture-bali-hospital.json',
    ]);
    assert.match(batch.body, /ベースライン/);
    assert.match(batch.body, /fixture-bali-hospital/);
  });

  test('1回の実行上限(maxRevisions)を超えた分は deferred', async () => {
    const { args, deps } = await setup();
    const r = await runRefresh({ args: { ...args, maxRevisions: 0 }, deps });
    assert.deepEqual(r.deferred, ['fixture-bali-entry-checklist']);
    assert.equal(r.groups.filter((g) => g.kind === 'revision').length, 0);
  });

  test('出典が1つでも取得失敗した記事は更新しない', async () => {
    const { args, deps } = await setup();
    const inner = deps.fetchImpl;
    deps.fetchImpl = async (u, i) => (u === S.levy ? new Response('x', { status: 500 }) : inner(u, i));
    const r = await runRefresh({ args, deps });
    assert.ok(r.failures.some((f) => f.url === S.levy));
    assert.equal(r.groups.filter((g) => g.kind === 'revision').length, 0);
  });
});

describe('出力', () => {
  test('writeRefreshOutput: グループごとの files/ と result.json を書く。失敗があれば issue-body.md も', async () => {
    const { args, deps, tmp } = await setup();
    const r = await runRefresh({ args, deps });
    const out = path.join(tmp, 'out');
    await writeRefreshOutput(r, out);
    const result = JSON.parse(await readFile(path.join(out, 'result.json'), 'utf-8'));
    assert.equal(result.groups.length, 2);
    assert.equal(result.hasIssue, true);
    const g0 = result.groups[0];
    assert.ok((await readFile(path.join(g0.dir, 'files', g0.files[0]), 'utf-8')).startsWith('---'));
    assert.match(await readFile(path.join(out, 'issue-body.md'), 'utf-8'), /fixture-bali-broken/);
  });
  test('buildFailureIssueBody: 失敗も持ち越しも無ければ null', () => {
    assert.equal(buildFailureIssueBody({ failures: [], deferred: [], today: '2026-10-01' }), null);
    assert.match(buildFailureIssueBody({ failures: [], deferred: ['x'], today: '2026-10-01' }), /持ち越/);
  });
  test('parseRefreshArgs', () => {
    assert.equal(parseRefreshArgs([], { REFRESH_MAX_REVISIONS: '3' }).maxRevisions, 3);
    assert.equal(parseRefreshArgs(['--dry-run', '--out-dir=/x']).outDir, '/x');
  });
});
