import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isYmyl,
  isEvergreenId,
  resolveVerificationDisplay,
  findFreshnessIssues,
  formatFreshnessReport,
} from '../src/lib/ymyl.mjs';
import { parseArticleFrontmatter, parseTodayArg, collectResults } from './check-ymyl-freshness.mjs';

const TODAY = new Date('2026-09-29T00:00:00Z');

describe('isYmyl', () => {
  test('visa/safety/regulation は YMYL', () => {
    for (const category of ['visa', 'safety', 'regulation']) assert.equal(isYmyl({ category }), true);
  });
  test('ymyl: true は category に関係なく YMYL', () => {
    assert.equal(isYmyl({ category: 'lifestyle', ymyl: true }), true);
  });
  test('その他は YMYL でない', () => {
    assert.equal(isYmyl({ category: 'gourmet' }), false);
    assert.equal(isYmyl({ category: 'lifestyle', ymyl: false }), false);
    assert.equal(isYmyl(undefined), false);
  });
});

describe('isEvergreenId', () => {
  test('日付接頭辞なしがエバーグリーン', () => {
    assert.equal(isEvergreenId('indonesia-tax-guide-japanese'), true);
    assert.equal(isEvergreenId('2026-04-02-maluku-earthquake'), false);
  });
});

describe('resolveVerificationDisplay', () => {
  test('lastVerified があれば「最終確認日」', () => {
    const r = resolveVerificationDisplay({ lastVerified: '2026-08-01', pubDate: '2026-01-01' });
    assert.equal(r.kind, 'verified');
    assert.equal(r.label, '最終確認日');
    assert.equal(r.date.toISOString().slice(0, 10), '2026-08-01');
  });
  test('無ければ updatedDate を「掲載日/更新日」', () => {
    const r = resolveVerificationDisplay({ updatedDate: '2026-05-01', pubDate: '2026-01-01' });
    assert.equal(r.kind, 'published');
    assert.equal(r.label, '掲載日/更新日');
    assert.equal(r.date.toISOString().slice(0, 10), '2026-05-01');
  });
  test('updatedDate も無ければ pubDate', () => {
    const r = resolveVerificationDisplay({ pubDate: new Date('2026-01-01') });
    assert.equal(r.date.toISOString().slice(0, 10), '2026-01-01');
    assert.notEqual(r.label, '最終確認日');
  });
});

describe('findFreshnessIssues', () => {
  const base = { category: 'visa', draft: false, sourceUrl: 'https://example.com' };
  test('lastVerified なしを検出', () => {
    assert.deepEqual(findFreshnessIssues({ id: 'guide', data: base }, TODAY), ['lastVerified なし']);
  });
  test('180日以上前を検出、179日前は検出しない', () => {
    const old = findFreshnessIssues({ id: 'guide', data: { ...base, lastVerified: '2026-04-02' } }, TODAY);
    assert.equal(old.length, 1);
    assert.match(old[0], /180日以上/);
    assert.deepEqual(findFreshnessIssues({ id: 'guide', data: { ...base, lastVerified: '2026-04-03' } }, TODAY), []);
  });
  test('references も sourceUrl も無ければ検出', () => {
    const data = { category: 'visa', lastVerified: '2026-09-01' };
    assert.deepEqual(findFreshnessIssues({ id: 'guide', data }, TODAY), ['references・sourceUrl なし']);
    const withRefs = { ...data, references: [{ title: 't', url: 'https://example.go.id' }] };
    assert.deepEqual(findFreshnessIssues({ id: 'guide', data: withRefs }, TODAY), []);
  });
  test('日付付き記事・draft・非YMYLは対象外', () => {
    assert.deepEqual(findFreshnessIssues({ id: '2026-04-02-x', data: { category: 'safety' } }, TODAY), []);
    assert.deepEqual(findFreshnessIssues({ id: 'guide', data: { category: 'safety', draft: true } }, TODAY), []);
    assert.deepEqual(findFreshnessIssues({ id: 'guide', data: { category: 'gourmet' } }, TODAY), []);
  });
});

describe('formatFreshnessReport / collectResults', () => {
  test('該当なしのメッセージ', () => {
    assert.match(formatFreshnessReport([], TODAY), /ありません/);
  });
  test('該当件数と記事idを含む', () => {
    const results = collectResults([{ id: 'guide', data: { title: 'T', category: 'visa' } }], TODAY);
    const md = formatFreshnessReport(results, TODAY);
    assert.match(md, /該当 1 件/);
    assert.match(md, /`guide` \(T\)/);
  });
});

describe('CLI helpers', () => {
  test('parseArticleFrontmatter', () => {
    const fm = parseArticleFrontmatter('---\ntitle: "a"\ncategory: "visa"\nlastVerified: 2026-09-01\n---\nbody');
    assert.equal(fm.category, 'visa');
    assert.equal(parseArticleFrontmatter('no frontmatter'), null);
  });
  test('parseTodayArg', () => {
    assert.equal(parseTodayArg(['--today', '2026-09-29']).toISOString(), '2026-09-29T00:00:00.000Z');
    assert.throws(() => parseTodayArg(['--today', 'bad']));
    assert.equal(parseTodayArg([], new Date('2026-01-02T10:00:00Z')).toISOString(), '2026-01-02T00:00:00.000Z');
  });
});
