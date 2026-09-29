// docs/monetization/revenue-log.csv を読み、月ごとの利益と「月利益1万円以上の連続月数」を表示する。
// 使い方: node scripts/revenue-summary.mjs [csvPath]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROFIT_TARGET_JPY = 10000;
export const GOAL_MONTHS = 6;
const REVENUE_COLUMNS = ['adsense_jpy', 'affiliate_jpy', 'other_revenue_jpy'];
const DEFAULT_CSV = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'monetization', 'revenue-log.csv');

/** ダブルクォート対応の最小 CSV パーサ。行 = 列名をキーにしたオブジェクト */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

function parseAmount(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[,¥]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 1行から月次サマリを作る。収益3列とcost_jpyのいずれかが空欄(または数値でない)なら未記入(profit: null)。
 * @returns {{month:string, pageviews:number|null, profit:number|null, filled:boolean}}
 */
export function summarizeRow(row) {
  const revenues = REVENUE_COLUMNS.map((k) => parseAmount(row[k]));
  const cost = parseAmount(row.cost_jpy);
  const filled = revenues.every((v) => v !== null) && cost !== null;
  const profit = filled ? revenues.reduce((a, b) => a + b, 0) - cost : null;
  return { month: row.month, pageviews: parseAmount(row.pageviews), profit, filled };
}

/**
 * 最新の月から遡って、利益が target 以上の月が連続する数を返す。
 * 未記入の月・target 未満の月・月が飛んでいる箇所で途切れる。
 * @param {{month:string, profit:number|null}[]} summaries
 */
export function countStreak(summaries, target = PROFIT_TARGET_JPY) {
  const sorted = [...summaries].filter((s) => /^\d{4}-\d{2}$/.test(s.month)).sort((a, b) => b.month.localeCompare(a.month));
  let streak = 0;
  let expected = null;
  for (const s of sorted) {
    if (expected !== null && s.month !== expected) break;
    if (s.profit === null || s.profit < target) break;
    streak++;
    const [y, m] = s.month.split('-').map(Number);
    expected = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  }
  return streak;
}

export function formatSummary(summaries, target = PROFIT_TARGET_JPY, goalMonths = GOAL_MONTHS) {
  const sorted = [...summaries].sort((a, b) => a.month.localeCompare(b.month));
  const lines = ['月次サマリ', 'month    pageviews  profit_jpy'];
  for (const s of sorted) {
    const pv = s.pageviews === null ? '-' : String(s.pageviews);
    const pr = s.profit === null ? '未記入' : String(s.profit);
    lines.push(`${s.month}  ${pv.padStart(9)}  ${pr.padStart(10)}`);
  }
  const streak = countStreak(summaries, target);
  lines.push('', `月利益${target}円以上の連続月数(最新月から遡る): ${streak} / ${goalMonths}`);
  lines.push(streak >= goalMonths ? 'ゴール達成' : 'ゴール未達');
  return lines.join('\n') + '\n';
}

function main() {
  const path = process.argv[2] ?? DEFAULT_CSV;
  const summaries = parseCsv(readFileSync(path, 'utf8')).map(summarizeRow);
  process.stdout.write(formatSummary(summaries));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
