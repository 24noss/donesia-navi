import { XMLParser } from 'fast-xml-parser';

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const USER_AGENT = 'DonesiaNaviBot/1.0 (+https://indonesia-navi.com; contact: nshou53@yahoo.co.jp)';

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  return res.json();
}

function parseRssItems(xml, { fallbackSourceLabel } = {}) {
  const data = xmlParser.parse(xml);
  const rawItems = data?.rss?.channel?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return items.map((item) => {
    const rawSource = item.source;
    const sourceLabel =
      fallbackSourceLabel ||
      (rawSource && typeof rawSource === 'object' ? rawSource['#text'] : rawSource) ||
      'Unknown';

    return {
      title: stripHtml(item.title),
      snippet: stripHtml(item.description),
      link: typeof item.link === 'string' ? item.link.trim() : '',
      pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : null,
      source: String(sourceLabel).replace(/\.com$/, ''),
    };
  });
}

async function fetchRssSource(url, opts) {
  const xml = await fetchText(url);
  return parseRssItems(xml, opts);
}

function googleNewsSiteSearchUrl(domain, keyword) {
  const q = encodeURIComponent(`site:${domain} ${keyword} when:1d`);
  return `https://news.google.com/rss/search?q=${q}&hl=id&gl=ID&ceid=ID:id`;
}

// Kompasは直接RSSが見つからないため、Google Newsのsite内検索RSSで代替する。
// 制約: item.link はGoogleのJSリダイレクト経由の仲介URLで、実記事URLには直接解決できない。
const KOMPAS_QUERIES = ['jakarta banjir gempa demo', 'kitas visa wna jepang', 'bbm subsidi ekonomi'];

async function fetchKompasViaGoogleNews() {
  const results = await Promise.allSettled(
    KOMPAS_QUERIES.map((keyword) => fetchRssSource(googleNewsSiteSearchUrl('kompas.com', keyword), { fallbackSourceLabel: 'Kompas' }))
  );
  return results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);
}

async function fetchBmkgEarthquakes() {
  const [latest, recent] = await Promise.allSettled([
    fetchJson('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json'),
    fetchJson('https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json'),
  ]);

  const quakes = [];
  if (latest.status === 'fulfilled') {
    const g = latest.value?.Infogempa?.gempa;
    if (g) quakes.push(g);
  }
  if (recent.status === 'fulfilled') {
    const list = recent.value?.Infogempa?.gempa;
    if (Array.isArray(list)) quakes.push(...list);
  }

  const seen = new Set();
  return quakes
    .filter((g) => g && g.DateTime && !seen.has(g.DateTime) && seen.add(g.DateTime))
    .map((g) => ({
      title: `地震 M${g.Magnitude} - ${g.Wilayah}`,
      snippet: `${g.Tanggal} ${g.Jam} (WIB) 発生。震源の深さ ${g.Kedalaman}。${g.Potensi ? `津波の可能性: ${g.Potensi}。` : ''}${g.Dirasakan ? `有感地域: ${g.Dirasakan}。` : ''}`,
      // イベントごとに一意なURLにする（BMKGはイベント別ページを提供していないため、
      // 固定URLだと全地震が同一リンク扱いになり重複排除ロジックで誤って潰れてしまう）
      link: `https://www.bmkg.go.id/gempabumi/gempa-dirasakan.bmkg#${encodeURIComponent(g.DateTime)}`,
      pubDate: g.DateTime ? new Date(g.DateTime).toISOString() : null,
      source: 'BMKG',
    }));
}

export const sources = [
  {
    id: 'detik',
    label: 'Detik',
    fetch: () => fetchRssSource('https://news.detik.com/rss', { fallbackSourceLabel: 'Detik' }),
  },
  {
    id: 'antara',
    label: 'Antara',
    fetch: () => fetchRssSource('https://www.antaranews.com/rss/terkini.xml', { fallbackSourceLabel: 'Antara' }),
  },
  {
    id: 'bmkg',
    label: 'BMKG',
    fetch: fetchBmkgEarthquakes,
  },
  {
    id: 'kompas',
    label: 'Kompas',
    fetch: fetchKompasViaGoogleNews,
  },
];

export async function fetchAllCandidates() {
  const settled = await Promise.allSettled(sources.map((s) => s.fetch()));
  const failures = [];
  const items = [];

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      failures.push({ source: sources[i].id, error: String(result.reason) });
    }
  });

  return { items, failures };
}
