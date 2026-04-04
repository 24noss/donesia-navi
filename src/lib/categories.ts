export const categories = {
  safety: {
    name: '安全・災害',
    color: 'safety',
    description: 'インドネシアの地震・津波・火山などの災害情報、治安情報、日本大使館の安全情報をいち早くお届けします。',
    seoTitle: '安全・災害情報 | インドネシア治安・防災ニュース',
  },
  society: {
    name: '社会・政治',
    color: 'society',
    description: 'インドネシアの社会問題、政治動向、政策変更など、在住日本人に影響のあるニュースをわかりやすく解説します。',
    seoTitle: '社会・政治 | インドネシア社会ニュース',
  },
  business: {
    name: '経済・ビジネス',
    color: 'business',
    description: 'インドネシアの経済動向、ビジネスニュース、ルピア為替情報、日系企業の動きなどを日本語でお届けします。',
    seoTitle: '経済・ビジネス | インドネシア経済ニュース',
  },
  lifestyle: {
    name: '生活・グルメ',
    color: 'lifestyle',
    description: 'ジャカルタの日本食レストラン、生活情報、日本人学校、病院など、インドネシア生活に役立つ情報を発信します。',
    seoTitle: '生活・グルメ | インドネシア生活情報',
  },
  travel: {
    name: '旅行・お出かけ',
    color: 'travel',
    description: 'インドネシア国内旅行のおすすめスポット、バリ島・ジョグジャカルタなどの観光情報を在住者目線でお届けします。',
    seoTitle: '旅行・お出かけ | インドネシア国内旅行情報',
  },
  visa: {
    name: 'ビザ・手続き',
    color: 'visa',
    description: 'KITAS・KITAP更新、就労ビザ取得、ノマドビザなど、インドネシアのビザ・滞在許可に関する最新情報をまとめています。',
    seoTitle: 'ビザ・手続き | インドネシアのビザ・KITAS情報',
  },
  regulation: {
    name: '規制・法務',
    color: 'regulation',
    description: 'インドネシアの法人設立、税金、労働法、輸入規制など、在住日本人・日系企業向けの法規制情報を解説します。',
    seoTitle: '規制・法務 | インドネシアの法律・規制情報',
  },
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
