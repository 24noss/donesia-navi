// 関連ガイド欄(hub/spoke)の純粋関数。台帳(guide-topics.json)の role / hub から、
// 記事ページに出す「所属 hub」「同じ hub の兄弟 spoke」「配下の spoke」を求める。
// 公開済み(呼び出し側が渡す publishedIds に含まれる)記事だけを返す。台帳順を保つ。
// draft の扱い(本番は draft:false のみ、プレビューは draft も含める)は呼び出し側が publishedIds で決める。

/**
 * @param {object} p
 * @param {string} p.id 表示中の記事 id(= 台帳のトピック id)
 * @param {{topics: Array<{id:string, title:string, role?:string, hub?:string}>}} p.ledger 台帳
 * @param {Set<string>|string[]} p.publishedIds 表示してよい記事 id の集合
 * @param {Map<string,string>|Record<string,string>} [p.titleById] 記事の実タイトル(無ければ台帳の title)
 * @returns {{hub?: {id:string, title:string}, siblings: {id:string, title:string}[], children: {id:string, title:string}[]}}
 */
export function getRelatedGuides({ id, ledger, publishedIds, titleById = new Map() }) {
  const published = publishedIds instanceof Set ? publishedIds : new Set(publishedIds);
  const titles = titleById instanceof Map ? titleById : new Map(Object.entries(titleById));
  const topics = Array.isArray(ledger?.topics) ? ledger.topics : [];
  const self = topics.find((t) => t.id === id);
  const result = { siblings: [], children: [] };
  if (!self) return result;

  const link = (t) => ({ id: t.id, title: titles.get(t.id) || t.title });
  const visible = (t) => t.id !== id && published.has(t.id);

  if (self.role === 'hub') {
    result.children = topics.filter((t) => t.role === 'spoke' && t.hub === id && visible(t)).map(link);
  } else if (self.role === 'spoke' && self.hub) {
    const hub = topics.find((t) => t.id === self.hub && t.role === 'hub');
    if (hub && visible(hub)) result.hub = link(hub);
    result.siblings = topics.filter((t) => t.role === 'spoke' && t.hub === self.hub && visible(t)).map(link);
  }
  return result;
}

/** 表示すべき項目が1つも無いか。 */
export function isEmptyRelatedGuides(r) {
  return !r.hub && r.siblings.length === 0 && r.children.length === 0;
}
