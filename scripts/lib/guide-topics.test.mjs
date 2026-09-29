import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ARTICLE_CATEGORIES,
  GUIDE_TOPICS_PATH,
  OFFICIAL_SOURCES_PATH,
  TAG_VOCABULARY_SET,
  fetchOpenGuidePrState,
  fetchRejectedTopicIds,
  listArticleIds,
  loadGuideTopics,
  loadOfficialSources,
  loadSnapshots,
  normalizeUrl,
  resolveTopicReferences,
  selectNextTopic,
  serializeSnapshots,
  topicIdFromBranch,
  validateGuideTopics,
  validateOfficialSources,
} from './guide-topics.mjs';

const FIX = path.join(process.cwd(), 'scripts/fixtures/guide');
const fixSources = JSON.parse(await readFile(path.join(FIX, 'official-sources.json'), 'utf-8'));
const fixTopics = JSON.parse(await readFile(path.join(FIX, 'guide-topics.json'), 'utf-8'));
const themeKeys = new Set(Object.keys(fixSources.themes));

function topic(overrides = {}) {
  return {
    id: 'bali-x', title: 't', audience: ['tourist'], category: 'travel', tags: ['観光'], ymyl: false,
    keywords: ['k'], outline: ['o'], sourceThemes: ['entry'], extraReferences: [], affiliate: [], priority: 3,
    status: 'queued', addedAt: '2026-09-01', ...overrides,
  };
}

describe('実ファイルのスキーマ検証(ファイルが存在する場合のみ)', () => {
  test('src/data/official-sources.json', { skip: !existsSync(OFFICIAL_SOURCES_PATH) && 'official-sources.json が未作成のためskip' }, async () => {
    const problems = validateOfficialSources(await loadOfficialSources());
    assert.deepEqual(problems, []);
  });

  test('src/data/guide-topics.json(official-sources.json と相互参照)', { skip: !existsSync(GUIDE_TOPICS_PATH) && 'guide-topics.json が未作成のためskip' }, async () => {
    const sources = existsSync(OFFICIAL_SOURCES_PATH) ? await loadOfficialSources() : { themes: {} };
    const problems = validateGuideTopics(await loadGuideTopics(), { sourceThemeKeys: new Set(Object.keys(sources.themes || {})) });
    assert.deepEqual(problems, []);
  });
});

describe('フィクスチャ', () => {
  test('フィクスチャの出典・台帳は検証を通る', () => {
    assert.deepEqual(validateOfficialSources(fixSources), []);
    assert.deepEqual(validateGuideTopics(fixTopics, { sourceThemeKeys: themeKeys }), []);
  });
});

describe('ARTICLE_CATEGORIES', () => {
  test('src/content.config.ts の category enum と一致する', async () => {
    const cfg = await readFile(path.join(process.cwd(), 'src/content.config.ts'), 'utf-8');
    const m = cfg.match(/category:\s*z\.enum\(\[([^\]]+)\]\)/);
    const fromConfig = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
    assert.deepEqual([...ARTICLE_CATEGORIES].sort(), fromConfig.sort());
  });
});

describe('validateOfficialSources', () => {
  test('不正なURL・空のテーマを検出する', () => {
    const bad = { version: 1, themes: { a: { label: 'x', sources: [{ title: 't', url: 'not a url', publisher: 'p', lang: 'ja' }] }, b: { label: 'y', sources: [] } } };
    const problems = validateOfficialSources(bad);
    assert.ok(problems.some((p) => p.includes('themes.a.sources[0].url')));
    assert.ok(problems.some((p) => p.includes('themes.b.sources')));
  });
  test('version 不一致', () => {
    assert.ok(validateOfficialSources({ version: 2, themes: { a: { label: 'x', sources: [{ title: 't', url: 'https://a.example/', publisher: 'p', lang: 'ja' }] } } }).length > 0);
  });
});

describe('validateGuideTopics', () => {
  const ctx = { sourceThemeKeys: themeKeys };
  const check = (t, needle) => {
    const problems = validateGuideTopics({ version: 1, topics: [t] }, ctx);
    assert.ok(problems.some((p) => p.includes(needle)), `${needle} を含む問題が無い: ${problems.join(' | ')}`);
  };

  test('正常なトピックは合格', () => {
    assert.deepEqual(validateGuideTopics({ version: 1, topics: [topic()] }, ctx), []);
  });
  test('id 形式(大文字・長さ・予約プレフィックス)', () => {
    check(topic({ id: 'Bali_X' }), 'id が');
    check(topic({ id: 'a'.repeat(61) }), 'id が');
    check(topic({ id: 'topics-abc' }), '始められません');
    check(topic({ id: 'refresh-abc' }), '始められません');
  });
  test('id 重複', () => {
    const problems = validateGuideTopics({ version: 1, topics: [topic(), topic()] }, ctx);
    assert.ok(problems.some((p) => p.includes('重複')));
  });
  test('tags が語彙外', () => {
    assert.ok(!TAG_VOCABULARY_SET.has('存在しないタグ'));
    check(topic({ tags: ['存在しないタグ'] }), '語彙外');
  });
  test('sourceThemes が official-sources に無い', () => check(topic({ sourceThemes: ['nothing'] }), 'official-sources.json にありません'));
  test('category / audience / priority / status / addedAt', () => {
    check(topic({ category: 'foo' }), 'category');
    check(topic({ audience: ['alien'] }), 'audience');
    check(topic({ priority: 6 }), 'priority');
    check(topic({ status: 'done' }), 'status');
    check(topic({ addedAt: '2026-13-40' }), 'addedAt');
  });
  test('extraReferences の形式', () => check(topic({ extraReferences: [{ title: 'x', url: 'ftp://x' }] }), 'extraReferences'));
  test('queued なのに出典が無い', () => check(topic({ sourceThemes: [], extraReferences: [] }), '生成できません'));
  test('on-hold は出典が無くてもよい', () => {
    assert.deepEqual(validateGuideTopics({ version: 1, topics: [topic({ status: 'on-hold', sourceThemes: [] })] }, ctx), []);
  });
});

describe('resolveTopicReferences', () => {
  test('sourceThemes の sources + extraReferences を返し、URLは重複排除する', () => {
    const sources = { themes: { a: { sources: [{ title: 'A1', url: 'https://x.example/a', publisher: 'P' }] }, b: { sources: [{ title: 'A1dup', url: 'https://x.example/a/' }, { title: 'B1', url: 'https://x.example/b' }] } } };
    const refs = resolveTopicReferences({ sourceThemes: ['a', 'b', 'missing'], extraReferences: [{ title: 'E', url: 'https://x.example/b#frag' }, { title: 'E2', url: 'https://x.example/e' }] }, sources);
    assert.deepEqual(refs.map((r) => r.url), ['https://x.example/a', 'https://x.example/b', 'https://x.example/e']);
    assert.equal(refs[0].publisher, 'P');
  });
  test('normalizeUrl: ハッシュと末尾スラッシュを無視する', () => {
    assert.equal(normalizeUrl('https://a.example/x/#h'), normalizeUrl('https://a.example/x'));
  });
});

describe('selectNextTopic', () => {
  const topics = [
    topic({ id: 'c', priority: 2, addedAt: '2026-09-02' }),
    topic({ id: 'a', priority: 2, addedAt: '2026-09-01' }),
    topic({ id: 'b', priority: 1, addedAt: '2026-09-09' }),
    topic({ id: 'hold', priority: 1, addedAt: '2026-01-01', status: 'on-hold' }),
  ];
  test('priority 昇順 → addedAt 昇順、on-hold は除外', () => {
    assert.equal(selectNextTopic({ topics }).id, 'b');
    assert.equal(selectNextTopic({ topics, existingArticleIds: new Set(['b']) }).id, 'a');
  });
  test('既存記事・オープンPR・却下済みを除外する', () => {
    assert.equal(selectNextTopic({ topics, existingArticleIds: new Set(['b']), openPrArticleIds: new Set(['a']) }).id, 'c');
    assert.equal(selectNextTopic({ topics, existingArticleIds: new Set(['b']), rejectedTopicIds: new Set(['a', 'c']) }), null);
  });
  test('候補が無ければ null', () => assert.equal(selectNextTopic({ topics: [] }), null));
});

describe('topicIdFromBranch', () => {
  test('auto/guide-<id> だけ id を返し、topics / refresh ブランチは null', () => {
    assert.equal(topicIdFromBranch('auto/guide-bali-entry'), 'bali-entry');
    assert.equal(topicIdFromBranch('auto/guide-topics-20260929'), null);
    assert.equal(topicIdFromBranch('auto/guide-refresh-bali-entry-202610'), null);
    assert.equal(topicIdFromBranch('auto/articles-123'), null);
    assert.equal(topicIdFromBranch(undefined), null);
  });
});

function mockGithub(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const p = url.replace('https://api.github.com', '');
    calls.push(p);
    const hit = Object.entries(routes).find(([k]) => p.startsWith(k));
    if (!hit) return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
    const val = typeof hit[1] === 'function' ? hit[1](p) : hit[1];
    return { ok: true, status: 200, json: async () => val, text: async () => JSON.stringify(val) };
  };
  return { fetchImpl, calls };
}

describe('fetchOpenGuidePrState (GitHub APIモック)', () => {
  test('token が無ければ照会せず空を返す', async () => {
    const r = await fetchOpenGuidePrState({ token: '', repo: 'o/r', fetchImpl: () => assert.fail('呼ばれないはず') });
    assert.equal(r.skipped, true);
    assert.equal(r.openPrArticleIds.size, 0);
  });
  test('オープンPRのファイルとブランチ名から記事idを集め、topics PR を検出する', async () => {
    const { fetchImpl } = mockGithub({
      '/repos/o/r/pulls?state=open': [
        { number: 1, head: { ref: 'auto/guide-bali-a' } },
        { number: 2, head: { ref: 'auto/guide-topics-20260929' } },
        { number: 3, head: { ref: 'feature/x' } },
      ],
      '/repos/o/r/pulls/1/files': [{ filename: 'src/content/articles/bali-a.md' }, { filename: 'src/data/guide-source-snapshots/bali-a.json' }],
      '/repos/o/r/pulls/2/files': [{ filename: 'src/data/guide-topics.json' }],
      '/repos/o/r/pulls/3/files': [{ filename: 'src/content/articles/manual-guide.md' }],
    });
    const r = await fetchOpenGuidePrState({ token: 't', repo: 'o/r', fetchImpl });
    assert.deepEqual([...r.openPrArticleIds].sort(), ['bali-a', 'manual-guide']);
    assert.deepEqual(r.openTopicsPrs, [{ number: 2, branch: 'auto/guide-topics-20260929' }]);
  });
  test('API エラーは例外(呼び出し側で判断)', async () => {
    const { fetchImpl } = mockGithub({});
    await assert.rejects(() => fetchOpenGuidePrState({ token: 't', repo: 'o/r', fetchImpl }), /GitHub API/);
  });
});

describe('fetchRejectedTopicIds (GitHub APIモック)', () => {
  test('クローズ済み未mergeの auto/guide-<id> PR だけを却下済みとする', async () => {
    const { fetchImpl } = mockGithub({
      '/repos/o/r/pulls?state=closed': [
        { number: 10, merged_at: null, head: { ref: 'auto/guide-rejected-one' } },
        { number: 11, merged_at: '2026-09-01T00:00:00Z', head: { ref: 'auto/guide-merged-one' } },
        { number: 12, merged_at: null, head: { ref: 'auto/guide-topics-20260901' } },
        { number: 13, merged_at: null, head: { ref: 'auto/guide-refresh-bali-a-202609' } },
        { number: 14, merged_at: null, head: { ref: 'auto/articles-99' } },
      ],
    });
    const ids = await fetchRejectedTopicIds({ token: 't', repo: 'o/r', fetchImpl });
    assert.deepEqual([...ids], ['rejected-one']);
  });
  test('token が無ければ空', async () => {
    assert.equal((await fetchRejectedTopicIds({ token: '', repo: '', fetchImpl: () => assert.fail() })).size, 0);
  });
  test('100件ごとにページングする', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ number: i, merged_at: null, head: { ref: `auto/guide-p1-${i}` } }));
    const { fetchImpl, calls } = mockGithub({ '/repos/o/r/pulls?state=closed': (p) => (p.endsWith('&page=1') ? page1 : [{ number: 999, merged_at: null, head: { ref: 'auto/guide-p2' } }]) });
    const ids = await fetchRejectedTopicIds({ token: 't', repo: 'o/r', fetchImpl });
    assert.equal(ids.size, 101);
    assert.equal(calls.length, 2);
  });
});

describe('ファイルI/O', () => {
  test('loadSnapshots: 無ければ {}、serializeSnapshots はキーをソートして末尾改行', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gt-'));
    assert.deepEqual(await loadSnapshots(path.join(dir, 'none.json')), {});
    const out = serializeSnapshots({ 'https://b/': { sha256: '2', fetchedAt: 'x' }, 'https://a/': { sha256: '1', fetchedAt: 'x' } });
    assert.ok(out.endsWith('\n'));
    assert.deepEqual(Object.keys(JSON.parse(out)), ['https://a/', 'https://b/']);
    await writeFile(path.join(dir, 's.json'), out);
    assert.equal((await loadSnapshots(path.join(dir, 's.json')))['https://a/'].sha256, '1');
  });
  test('listArticleIds: ディレクトリが無ければ空集合', async () => {
    assert.equal((await listArticleIds('/nonexistent-dir-xyz')).size, 0);
  });
});
