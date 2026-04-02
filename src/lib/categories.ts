export const categories = {
  daily: { name: '今日のインドネシア', color: 'daily' },
  safety: { name: '安全・災害', color: 'safety' },
  society: { name: '社会・政治', color: 'society' },
  business: { name: '経済・ビジネス', color: 'business' },
  lifestyle: { name: '生活・グルメ', color: 'lifestyle' },
  travel: { name: '旅行・お出かけ', color: 'travel' },
  visa: { name: 'ビザ・手続き', color: 'visa' },
  regulation: { name: '規制・法務', color: 'regulation' },
} as const;

export type CategorySlug = keyof typeof categories;

export function formatDate(date: Date): string {
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const dow = days[date.getDay()];
  return `${y}年${m}月${d}日（${dow}）`;
}
