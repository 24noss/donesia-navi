import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAX_TOPIC_ATTEMPTS, buildDryRunDeps, buildSkipReport, noSourceMessage, parseGenerateArgs, runGenerate, todayYmd } from './generate-guide.mjs';
import { parseArticleFile, validateFrontmatterShape } from './lib/guide-article.mjs';

const FIX = path.join(process.cwd(), 'scripts/fixtures/guide');
const quiet = { log() {}, warn() {} };
const NOW = new Date('2026-09-29T02:00:00Z');

// 固定応答の usedSourceUrls を差し替えた Gemini 応答(別トピックの出典に合わせる)
async function geminiWithUrls(urls) {
  const resp = JSON.parse(await readFile(path.join(FIX, 'gemini-guide-response.json'), 'utf-8'));
  return async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...resp, usedSourceUrls: urls }) }] } }] });
}
const HEALTH = 'https://example.org/fixture/health-info';

async function setup(extra = {}) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'gg-'));
  const args = {
    dryRun: true, topicId: null, outDir,
    topicsPath: path.join(FIX, 'guide-topics.json'), sourcesPath: path.join(FIX, 'official-sources.json'),
    snapshotsDir: path.join(outDir, 'snaps'), ...extra,
  };
  const deps = { ...(await buildDryRunDeps(FIX)), now: NOW, log: quiet, articlesDirForExisting: path.join(outDir, 'no-articles') };
  return { args, deps, outDir };
}

describe('parseGenerateArgs', () => {
  test('--dry-run / --topic= / GUIDE_TOPIC_ID / --out-dir=', () => {
    assert.deepEqual(
      { d: parseGenerateArgs(['--dry-run']).dryRun, t: parseGenerateArgs(['--topic=abc']).topicId, e: parseGenerateArgs([], { GUIDE_TOPIC_ID: 'xyz' }).topicId, o: parseGenerateArgs(['--out-dir=/x']).outDir },
      { d: true, t: 'abc', e: 'xyz', o: '/x' }
    );
    assert.equal(parseGenerateArgs([], { GUIDE_TOPIC_ID: '' }).topicId, null);
    assert.equal(parseGenerateArgs([]).dryRun, false);
  });
  test('todayYmd', () => assert.equal(todayYmd(NOW), '2026-09-29'));
});

describe('runGenerate(フィクスチャ)', () => {
  test('次のトピックを選び、取得失敗の出典を除外して記事とスナップショットを書き出す', async () => {
    const { args, deps, outDir } = await setup();
    const r = await runGenerate({ args, deps });
    assert.equal(r.status, 'generated');
    assert.equal(r.topic.id, 'fixture-bali-entry-checklist'); // on-hold(priority 1)は選ばれない
    assert.ok(r.warnings.some((w) => w.includes('missing')));
    assert.deepEqual(r.usedSourceUrls, ['https://example.org/fixture/entry-procedure', 'https://example.org/fixture/entry-visa', 'https://example.org/fixture/tourist-levy']);

    const md = await readFile(path.join(outDir, 'fixture-bali-entry-checklist.md'), 'utf-8');
    const { data } = parseArticleFile(md);
    assert.deepEqual(validateFrontmatterShape(data), []);
    assert.equal(data.draft, true);
    assert.equal(String(data.lastVerified), '2026-09-29');
    assert.ok(!md.includes('広告')); // 資料中のインジェクション文が結果に影響しない(固定応答の確認)

    const snaps = JSON.parse(await readFile(path.join(args.snapshotsDir, 'fixture-bali-entry-checklist.json'), 'utf-8'));
    assert.deepEqual(Object.keys(snaps).sort(), r.usedSourceUrls.slice().sort());
    assert.match(snaps[r.usedSourceUrls[0]].sha256, /^[0-9a-f]{64}$/);
  });

  test('Gemini に渡すプロンプトには台帳由来の資料だけが入り、取得失敗URLは入らない', async () => {
    const { args, deps } = await setup();
    let prompt = '';
    const inner = deps.callGemini;
    deps.callGemini = async (p) => ((prompt = p), inner(p));
    await runGenerate({ args, deps });
    assert.ok(prompt.includes('https://example.org/fixture/entry-procedure'));
    assert.ok(prompt.includes('https://example.org/fixture/tourist-levy'));
    assert.ok(!prompt.includes('fixture/missing'));
    assert.ok(!prompt.includes('alert(1)') && !prompt.includes('ホーム')); // script / nav は除去済み
  });

  test('取得する URL は台帳(出典+extraReferences)のものだけ', async () => {
    const { args, deps } = await setup();
    const fetched = [];
    const inner = deps.fetchImpl;
    deps.fetchImpl = async (u, i) => (fetched.push(u), inner(u, i));
    await runGenerate({ args, deps });
    assert.deepEqual(fetched.sort(), [
      'https://example.org/fixture/entry-procedure', 'https://example.org/fixture/entry-visa',
      'https://example.org/fixture/missing', 'https://example.org/fixture/tourist-levy',
    ]);
  });

  test('本文の取れた出典が0件なら生成せずエラー(URLと理由をメッセージに含める)', async () => {
    const { args, deps, outDir } = await setup();
    deps.fetchImpl = async () => new Response('x', { status: 500 });
    await assert.rejects(() => runGenerate({ args, deps }), (err) => err.message.includes('0件') && err.message.includes('example.org/fixture/entry-procedure') && err.message.includes('HTTP 500'));
    assert.ok(!existsSync(path.join(outDir, 'fixture-bali-entry-checklist.md')));
  });

  test('検証に失敗する応答(短すぎる本文)ではファイルを書かない', async () => {
    const { args, deps, outDir } = await setup();
    deps.callGemini = async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: 't', description: 'd', body: '短い', usedSourceUrls: ['https://example.org/fixture/entry-procedure'] }) }] } }] });
    await assert.rejects(() => runGenerate({ args, deps }), /検証に失敗/);
    assert.ok(!existsSync(path.join(outDir, 'fixture-bali-entry-checklist.md')));
  });

  test('GUIDE_TOPIC_ID 指定: そのトピックを生成(on-hold も可)。台帳に無い/記事が既にあるとエラー', async () => {
    const { args, deps } = await setup({ topicId: 'fixture-bali-hospital' });
    deps.callGemini = await geminiWithUrls([HEALTH]);
    const r = await runGenerate({ args, deps });
    assert.equal(r.topic.id, 'fixture-bali-hospital');
    await assert.rejects(() => runGenerate({ args: { ...args, topicId: 'nope' }, deps }), /台帳に/);
    await assert.rejects(() => runGenerate({ args: { ...args, topicId: 'Bad ID' }, deps }), /不正/);
    const { args: a2, deps: d2, outDir } = await setup({ topicId: 'fixture-bali-entry-checklist' });
    await writeFile(path.join(outDir, 'existing.md'), '');
    d2.articlesDirForExisting = outDir; // 既存記事ディレクトリに同名ファイルを置く
    await writeFile(path.join(outDir, 'fixture-bali-entry-checklist.md'), '---\n---\n');
    await assert.rejects(() => runGenerate({ args: a2, deps: d2 }), /既に存在/);
  });

  test('生成すべきトピックが無ければ status:none(エラーにしない)', async () => {
    const { args, deps } = await setup();
    deps.openPrState = async () => ({ openPrArticleIds: new Set() });
    deps.rejectedIds = async () => new Set();
    const ledger = JSON.parse(await readFile(args.topicsPath, 'utf-8'));
    ledger.topics.forEach((t) => (t.status = 'on-hold'));
    const p = path.join(args.outDir, 'ledger.json');
    await writeFile(p, JSON.stringify(ledger));
    const r = await runGenerate({ args: { ...args, topicsPath: p }, deps });
    assert.equal(r.status, 'none');
  });

  test('非dry-run: オープンPR・却下済みのトピックを除外して選ぶ(GitHub照会はモック)', async () => {
    const { args, deps } = await setup({ dryRun: false });
    deps.openPrState = async () => ({ openPrArticleIds: new Set(['fixture-bali-entry-checklist']) });
    deps.rejectedIds = async () => new Set(['fixture-bali-hospital']);
    deps.callGemini = await geminiWithUrls([HEALTH]);
    const r = await runGenerate({ args, deps });
    assert.equal(r.topic.id, 'fixture-bali-broken'); // 残る queued は priority 4 の1件のみ
  });

  test('noSourceMessage', () => {
    assert.match(noSourceMessage('t', [{ url: 'https://a/', reason: 'r' }]), /t.*0件[\s\S]*https:\/\/a\/: r/);
  });
});

describe('先頭トピックが失敗したら次の候補へ進む(自動選択時のみ、最大3候補)', () => {
  const ENTRY = ['https://example.org/fixture/entry-procedure', 'https://example.org/fixture/entry-visa', 'https://example.org/fixture/tourist-levy'];

  test('先頭の出典が全て取れなければ2番目のトピックで生成し、失敗した id と理由を skipped に残す', async () => {
    const { args, deps, outDir } = await setup();
    const inner = deps.fetchImpl;
    deps.fetchImpl = async (u, i) => (ENTRY.includes(u) ? new Response('x', { status: 500 }) : inner(u, i));
    deps.callGemini = await geminiWithUrls([HEALTH]);
    const r = await runGenerate({ args, deps });
    assert.equal(r.topic.id, 'fixture-bali-hospital');
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0].id, 'fixture-bali-entry-checklist');
    assert.match(r.skipped[0].reason, /0件.*HTTP 500/s);
    assert.ok(!existsSync(path.join(outDir, 'fixture-bali-entry-checklist.md'))); // 失敗した候補は何も残さない
  });

  test('先頭の検証失敗(usedSourceUrls が渡したURLと無関係)でも次の候補へ進む', async () => {
    const { args, deps } = await setup();
    let n = 0;
    const good = await geminiWithUrls([HEALTH]);
    deps.callGemini = async (p) => (++n === 1 ? (await geminiWithUrls(['https://evil.example/']))(p) : good(p));
    const r = await runGenerate({ args, deps });
    assert.equal(r.topic.id, 'fixture-bali-hospital');
    assert.match(r.skipped[0].reason, /検証に失敗/);
  });

  test('全候補が失敗したらエラー終了(skipped を持つ)。試行は最大3件', async () => {
    const { args, deps, outDir } = await setup();
    const ledger = JSON.parse(await readFile(args.topicsPath, 'utf-8'));
    ledger.topics.push({ ...ledger.topics[0], id: 'fixture-extra-4', priority: 5, keywords: ['x'] });
    const p = path.join(outDir, 'ledger4.json');
    await writeFile(p, JSON.stringify(ledger));
    deps.fetchImpl = async () => new Response('x', { status: 500 });
    await assert.rejects(() => runGenerate({ args: { ...args, topicsPath: p }, deps }), (err) => {
      assert.equal(err.skipped.length, MAX_TOPIC_ATTEMPTS);
      assert.deepEqual(err.skipped.map((x) => x.id), ['fixture-bali-entry-checklist', 'fixture-bali-hospital', 'fixture-bali-broken']);
      return true;
    });
  });

  test('明示指定(topicId)は次の候補へ進まず単一トピックでエラー終了', async () => {
    const { args, deps } = await setup({ topicId: 'fixture-bali-entry-checklist' });
    deps.fetchImpl = async () => new Response('x', { status: 500 });
    await assert.rejects(() => runGenerate({ args, deps }), (err) => !err.skipped && /0件/.test(err.message));
  });

  test('Gemini API 自体の失敗は次の候補へ進まずそのままエラー', async () => {
    const { args, deps } = await setup();
    let calls = 0;
    deps.callGemini = async () => { calls += 1; throw new Error('Gemini API error 503'); };
    await assert.rejects(() => runGenerate({ args, deps }), /Gemini API error 503/);
    assert.equal(calls, 1);
  });

  test('buildSkipReport: id と理由を含む。失敗が無ければ null', () => {
    assert.equal(buildSkipReport([], {}), null);
    const r = buildSkipReport([{ id: 'a-b', reason: 'x\ny' }], { generatedId: 'c', today: '2026-09-29' });
    assert.ok(r.includes('`a-b`') && r.includes('x / y') && r.includes('`c`'));
  });
});

describe('runGenerate(資料本文に出現するURLの許可)', () => {
  test('資料本文にあるURLは本文に残り、無いURLは除去されて removedUrlReport に出る', async () => {
    const { args, deps } = await setup();
    const OFFICIAL = 'https://official.example/apply';
    const baseFetch = deps.fetchImpl;
    deps.fetchImpl = async (url, init) => {
      const res = await baseFetch(url, init);
      if (!String(url).endsWith('/entry-procedure')) return res;
      const html = await res.text();
      return new Response(html.replace('</body>', `<p>申請は ${OFFICIAL} から行います。</p></body>`), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    };
    const resp = JSON.parse(await readFile(path.join(FIX, 'gemini-guide-response.json'), 'utf-8'));
    resp.body = resp.body.replace('## よくある質問', `公式サイト（${OFFICIAL}）またはアプリから申請します。詳細は税関サイト（https://evil.example/customs）(出典: 資料)。\n\n## よくある質問`);
    deps.callGemini = async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(resp) }] } }] });
    const r = await runGenerate({ args, deps });
    assert.equal(r.status, 'generated');
    assert.ok(r.markdown.includes(`公式サイト（${OFFICIAL}）またはアプリから申請します。`));
    assert.ok(r.markdown.includes('税関サイト(出典: 資料)。'));
    assert.ok(!r.markdown.includes('evil.example'));
    assert.match(r.removedUrlReport, /evil\.example\/customs/);
    assert.ok(!r.removedUrlReport.includes('official.example/apply`,'));
  });
});
