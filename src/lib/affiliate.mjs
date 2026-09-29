// アフィリエイトリンク判定の純関数群。クライアント計測(Base.astro)とユニットテストの両方から使う。

export const AFFILIATE_DOMAINS = {
  'wise.com': 'wise',
  'agoda.com': 'agoda',
  'klook.com': 'klook',
  'trip.com': 'tripcom',
  'px.a8.net': 'a8',
  'ck.jp.ap.valuecommerce.com': 'valuecommerce',
  'af.moshimo.com': 'moshimo',
  'click.linksynergy.com': 'rakuten-linkshare',
  'h.accesstrade.net': 'accesstrade',
};

/** hostname が既知ドメイン(またはそのサブドメイン)なら partner 名、無ければ null */
export function partnerFromHostname(hostname) {
  if (typeof hostname !== 'string' || !hostname) return null;
  const host = hostname.toLowerCase().replace(/\.$/, '');
  for (const [domain, partner] of Object.entries(AFFILIATE_DOMAINS)) {
    if (host === domain || host.endsWith('.' + domain)) return partner;
  }
  return null;
}

/** href 文字列から partner 名を解決。http(s) 以外・不正URLは null */
export function partnerFromUrl(href, base = 'https://indonesia-navi.com') {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return partnerFromHostname(u.hostname);
  } catch {
    return null;
  }
}

/**
 * a 要素の情報から計測パラメータを解決。対象外なら null。
 * @param {{href:string, dataAffiliate?:string|null, dataPlacement?:string|null, inArticleBody?:boolean}} info
 */
export function resolveAffiliateClick(info) {
  const explicit = (info.dataAffiliate || '').trim();
  const partner = explicit || partnerFromUrl(info.href);
  if (!partner) return null;
  const placement = (info.dataPlacement || '').trim() || (info.inArticleBody ? 'article-body' : 'other');
  return { partner, placement, link_url: info.href };
}
