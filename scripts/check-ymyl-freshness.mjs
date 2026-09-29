// YMYL エバーグリーン記事の再確認漏れを検出し、Markdown を標準出力する。
// 使い方: node scripts/check-ymyl-freshness.mjs [--today YYYY-MM-DD]
// 検出は情報提供のみ(終了コードは常に 0)。
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { findFreshnessIssues, formatFreshnessReport } from '../src/lib/ymyl.mjs';

const ARTICLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content', 'articles');

export function parseArticleFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  try {
    return YAML.parse(m[1]) ?? {};
  } catch {
    return null;
  }
}

export function parseTodayArg(argv, now = new Date()) {
  const i = argv.indexOf('--today');
  if (i === -1) return new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  const v = argv[i + 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') || Number.isNaN(new Date(v).getTime())) {
    throw new Error('--today は YYYY-MM-DD 形式で指定してください');
  }
  return new Date(v + 'T00:00:00Z');
}

export function collectResults(articles, today) {
  return articles
    .map((a) => ({ id: a.id, title: a.data.title, issues: findFreshnessIssues(a, today) }))
    .filter((r) => r.issues.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function main() {
  const today = parseTodayArg(process.argv.slice(2));
  const articles = [];
  for (const f of readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'))) {
    const data = parseArticleFrontmatter(readFileSync(join(ARTICLES_DIR, f), 'utf8'));
    if (data) articles.push({ id: f.replace(/\.md$/, ''), data });
  }
  process.stdout.write(formatFreshnessReport(collectResults(articles, today), today));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
