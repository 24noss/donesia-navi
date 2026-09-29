import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, summarizeRow, countStreak, formatSummary } from './revenue-summary.mjs';

const HEADER = 'month,pageviews,adsense_jpy,affiliate_jpy,other_revenue_jpy,cost_jpy,notes';
const summarize = (lines) => parseCsv([HEADER, ...lines].join('\n')).map(summarizeRow);

describe('parseCsv', () => {
  test('引用符内のカンマ・改行コード差を扱う', () => {
    const rows = parseCsv(`${HEADER}\r\n2026-09,100,1,2,3,4,"a,b"\r\n`);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notes, 'a,b');
  });
});

describe('summarizeRow', () => {
  test('利益 = 収益合計 - コスト', () => {
    assert.equal(summarize(['2026-09,100,8000,5000,0,3000,'])[0].profit, 10000);
  });
  test('空欄があれば未記入(0 とは区別)', () => {
    assert.equal(summarize(['2026-09,,,,,,'])[0].profit, null);
    assert.equal(summarize(['2026-09,,0,0,0,0,'])[0].profit, 0);
    assert.equal(summarize(['2026-09,,100,,0,0,'])[0].profit, null);
  });
});

describe('countStreak', () => {
  test('最新月から遡って連続をカウント', () => {
    const s = summarize(['2026-06,1,0,0,0,0,', '2026-07,1,10000,0,0,0,', '2026-08,1,20000,0,0,5000,', '2026-09,1,10000,0,0,0,']);
    assert.equal(countStreak(s), 3);
  });
  test('未満の月で途切れる(境界 9999)', () => {
    const s = summarize(['2026-07,1,20000,0,0,0,', '2026-08,1,9999,0,0,0,', '2026-09,1,20000,0,0,0,']);
    assert.equal(countStreak(s), 1);
  });
  test('未記入の月は連続を途切れさせる', () => {
    const s = summarize(['2026-07,1,20000,0,0,0,', '2026-08,,,,,,', '2026-09,1,20000,0,0,0,']);
    assert.equal(countStreak(s), 1);
    assert.equal(countStreak(summarize(['2026-08,1,20000,0,0,0,', '2026-09,,,,,,'])), 0);
  });
  test('月が飛んでいる場合も途切れる・年跨ぎは連続', () => {
    assert.equal(countStreak(summarize(['2026-06,1,20000,0,0,0,', '2026-09,1,20000,0,0,0,'])), 1);
    assert.equal(countStreak(summarize(['2025-12,1,20000,0,0,0,', '2026-01,1,20000,0,0,0,'])), 2);
  });
  test('空配列は 0', () => {
    assert.equal(countStreak([]), 0);
  });
});

describe('formatSummary', () => {
  test('未記入と連続月数を表示', () => {
    const out = formatSummary(summarize(['2026-09,,,,,,']));
    assert.match(out, /未記入/);
    assert.match(out, /連続月数.*: 0 \/ 6/);
    assert.match(out, /ゴール未達/);
  });
  test('6か月連続でゴール達成', () => {
    const lines = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((m) => `${m},1,10000,0,0,0,`);
    assert.match(formatSummary(summarize(lines)), /ゴール達成/);
  });
});
