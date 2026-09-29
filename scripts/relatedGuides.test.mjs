import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getRelatedGuides, isEmptyRelatedGuides } from '../src/lib/relatedGuides.mjs';

const t = (id, role, hub) => ({ id, title: `台帳:${id}`, role, ...(hub ? { hub } : {}) });
const ledger = { topics: [t('h', 'hub'), t('s1', 'spoke', 'h'), t('s2', 'spoke', 'h'), t('s3', 'spoke', 'h'), t('h2', 'hub'), t('x1', 'spoke', 'h2')] };
const all = new Set(['h', 's1', 's2', 's3', 'h2', 'x1']);

describe('getRelatedGuides', () => {
  test('hub 記事: 配下の spoke を children に(台帳順・自分の hub は無し)', () => {
    const r = getRelatedGuides({ id: 'h', ledger, publishedIds: all });
    assert.deepEqual(r.children.map((c) => c.id), ['s1', 's2', 's3']);
    assert.equal(r.hub, undefined);
    assert.deepEqual(r.siblings, []);
  });
  test('spoke 記事: hub と兄弟 spoke(自分と他クラスタは除く)', () => {
    const r = getRelatedGuides({ id: 's2', ledger, publishedIds: all });
    assert.deepEqual(r.hub, { id: 'h', title: '台帳:h' });
    assert.deepEqual(r.siblings.map((c) => c.id), ['s1', 's3']);
    assert.deepEqual(r.children, []);
  });
  test('公開済み(publishedIds)にある記事だけを返す', () => {
    const r = getRelatedGuides({ id: 's1', ledger, publishedIds: new Set(['s1', 's3']) });
    assert.equal(r.hub, undefined); // hub 未公開
    assert.deepEqual(r.siblings.map((c) => c.id), ['s3']);
    assert.deepEqual(getRelatedGuides({ id: 'h', ledger, publishedIds: ['h', 's2'] }).children.map((c) => c.id), ['s2']);
  });
  test('title は titleById(記事の実タイトル)を優先し、無ければ台帳の title', () => {
    const r = getRelatedGuides({ id: 's1', ledger, publishedIds: all, titleById: new Map([['h', '実タイトルH']]) });
    assert.equal(r.hub.title, '実タイトルH');
    assert.equal(r.siblings[0].title, '台帳:s2');
    assert.equal(getRelatedGuides({ id: 's1', ledger, publishedIds: all, titleById: { s2: 'Obj指定' } }).siblings[0].title, 'Obj指定');
  });
  test('台帳に無い id / 関係が無いときは空。isEmptyRelatedGuides で判定できる', () => {
    assert.ok(isEmptyRelatedGuides(getRelatedGuides({ id: 'unknown', ledger, publishedIds: all })));
    assert.ok(isEmptyRelatedGuides(getRelatedGuides({ id: 'x1', ledger, publishedIds: new Set(['x1']) })));
    assert.ok(!isEmptyRelatedGuides(getRelatedGuides({ id: 'h', ledger, publishedIds: all })));
    assert.ok(isEmptyRelatedGuides(getRelatedGuides({ id: 'h', ledger: null, publishedIds: all })));
  });
  test('hub の role が hub でない spoke には hub を出さない', () => {
    const bad = { topics: [t('a', 'spoke', 'b'), t('b', 'spoke', 'a')] };
    assert.equal(getRelatedGuides({ id: 'a', ledger: bad, publishedIds: new Set(['a', 'b']) }).hub, undefined);
  });
  test('実台帳: 全 spoke を公開扱いにすると hub の children 数が台帳の spoke 数と一致する', async () => {
    const real = JSON.parse(await readFile(path.join(process.cwd(), 'src/data/guide-topics.json'), 'utf-8'));
    const published = new Set(real.topics.map((x) => x.id));
    for (const hub of real.topics.filter((x) => x.role === 'hub')) {
      const expected = real.topics.filter((x) => x.role === 'spoke' && x.hub === hub.id).length;
      assert.equal(getRelatedGuides({ id: hub.id, ledger: real, publishedIds: published }).children.length, expected, hub.id);
    }
  });
});
