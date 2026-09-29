// YMYL(健康・金銭・安全に関わる)記事の判定と、確認日表示・再確認検出の純関数群。
// 記事ページ(src/pages/articles/[...id].astro)と scripts/check-ymyl-freshness.mjs、テストで共有する。

export const YMYL_CATEGORIES = ['visa', 'safety', 'regulation'];

/** 再確認を促すまでの日数 */
export const STALE_DAYS = 180;

/** category が visa/safety/regulation、または frontmatter に ymyl: true がある記事 */
export function isYmyl(data) {
  if (!data) return false;
  return data.ymyl === true || YMYL_CATEGORIES.includes(data.category);
}

/** ファイル名/記事idが YYYY-MM-DD- で始まらない記事 = エバーグリーン(ガイド)記事 */
export function isEvergreenId(id) {
  return !/^\d{4}-\d{2}-\d{2}-/.test(String(id));
}

function toDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 表示用の日付を決める。
 * lastVerified があれば「最終確認日」、無ければ updatedDate ?? pubDate を「掲載日/更新日」として返す。
 * 未確認の記事に「確認日」ラベルを付けないため kind で区別する。
 * @returns {{kind:'verified'|'published', label:string, date:Date|null}}
 */
export function resolveVerificationDisplay(data) {
  const verified = toDate(data?.lastVerified);
  if (verified) return { kind: 'verified', label: '最終確認日', date: verified };
  return {
    kind: 'published',
    label: '掲載日/更新日',
    date: toDate(data?.updatedDate) ?? toDate(data?.pubDate),
  };
}

/** UTC 日付同士の経過日数(切り捨て) */
export function daysBetween(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

/**
 * 再確認が必要な理由の一覧を返す(空配列 = 問題なし)。
 * 対象外(YMYLでない・draft・日付付き時事記事)は空配列。
 * @param {{id:string, data:object}} article
 * @param {Date} today
 * @returns {string[]}
 */
export function findFreshnessIssues(article, today, staleDays = STALE_DAYS) {
  const { id, data } = article;
  if (!isYmyl(data) || data.draft === true || !isEvergreenId(id)) return [];
  const issues = [];
  const verified = toDate(data.lastVerified);
  if (!verified) {
    issues.push('lastVerified なし');
  } else if (daysBetween(verified, today) >= staleDays) {
    issues.push(`lastVerified が${daysBetween(verified, today)}日前(${staleDays}日以上)`);
  }
  const hasRefs = Array.isArray(data.references) && data.references.length > 0;
  if (!hasRefs && !data.sourceUrl) issues.push('references・sourceUrl なし');
  return issues;
}

/** 検出結果の Markdown 一覧。results: [{id, title, issues}] */
export function formatFreshnessReport(results, today) {
  const ymd = today.toISOString().slice(0, 10);
  if (results.length === 0) return `# YMYL記事の再確認\n\n基準日 ${ymd}: 再確認が必要な記事はありません。\n`;
  const lines = [
    '# YMYL記事の再確認',
    '',
    `基準日 ${ymd} / 該当 ${results.length} 件`,
    '',
    '公的情報と照合し、`lastVerified` と `references` を記事の frontmatter に記入してください。',
    '',
  ];
  for (const r of results) {
    lines.push(`- \`${r.id}\` ${r.title ? `(${r.title})` : ''}`.trimEnd());
    for (const i of r.issues) lines.push(`  - ${i}`);
  }
  return lines.join('\n') + '\n';
}
