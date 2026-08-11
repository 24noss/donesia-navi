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

// site:制限なしの一般Google News検索RSSのURLを組み立てる純関数。
// KOMPAS用のgoogleNewsSiteSearchUrl()と異なり when: 期間はqueryの側に含める前提
// （foodレーンは週2回実行のため when:7d を使う。呼び出し側のFOOD_QUERIESを参照）。
export function googleNewsSearchUrl(query) {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=id&gl=ID&ceid=ID:id`;
}

// Kompasは直接RSSが見つからないため、Google Newsのsite内検索RSSで代替する。
// item.link はGoogleの仲介URL（news.google.com/rss/articles/...）だが、
// fetchKompasViaGoogleNews() が resolveDirectLink() で実記事URLへの解決を試みる（D-4、fail-open）。
const KOMPAS_QUERIES = [
  'jakarta banjir gempa demo',
  'kitas visa wna jepang',
  'bbm subsidi ekonomi',
  'wisata liburan destinasi',
  'aturan kebijakan pajak izin',
  'pemprov jakarta kebijakan warga', // society専用（D-1、2026-08-03追加。実測57件/日のユニーク候補を確認済み）
];

const LINK_RESOLVE_TIMEOUT_MS = 5000;
const LINK_RESOLVE_CONCURRENCY = 5;

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...opts,
      headers: { 'User-Agent': USER_AGENT, ...(opts?.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// news.google.com/rss/articles/<id> または /rss/read/<id> 形式のURLから
// Google News内部の記事IDを取り出す。google.com以外やパス形状が違う場合はnullを返す。
export function extractGoogleNewsId(link) {
  let u;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(u.hostname)) return null;
  const parts = u.pathname.split('/');
  const idx = parts.findIndex((p) => p === 'articles' || p === 'read');
  if (idx === -1 || !parts[idx + 1]) return null;
  return parts[idx + 1];
}

// Google News内部API（batchexecute）のレスポンス本文（")]}'\n\n[[...]]" 形式）から
// 実記事URLを取り出す。想定外の形状なら例外を投げる（呼び出し側でfail-openさせる）。
export function parseBatchExecuteResponse(text) {
  const jsonText = text.replace(/^\)\]\}'/, '').trim();
  const outer = JSON.parse(jsonText);
  const wrbLine = Array.isArray(outer) && outer.find((row) => Array.isArray(row) && row[0] === 'wrb.fr');
  if (!wrbLine) throw new Error('wrb.fr行が見つかりません');
  const inner = JSON.parse(wrbLine[2]);
  if (inner[0] !== 'garturlres' || !inner[1]) throw new Error('想定外のレスポンス形状です');
  return inner[1];
}

// Google Newsの仲介リンクをKompasの実記事URLに解決する。
// (a) 通常のHTTPリダイレクト追跡（fetch redirect:'follow' の res.url）
// (b) それでもgoogle.comドメインのままなら、Google News内部APIのデコードを試行
// (c) いずれも失敗したら元のURLのまま返す（fail-open。呼び出し側は例外を意識しなくてよい）
export async function resolveDirectLink(link, timeoutMs = LINK_RESOLVE_TIMEOUT_MS) {
  try {
    const res = await fetchWithTimeout(link, { redirect: 'follow' }, timeoutMs);
    const finalHost = new URL(res.url).hostname;
    if (!/(^|\.)google\.com$/.test(finalHost)) {
      return res.url;
    }

    const base64Str = extractGoogleNewsId(link);
    if (!base64Str) return link;

    const html = await res.text();
    const sgMatch = html.match(/data-n-a-sg="([^"]+)"/);
    const tsMatch = html.match(/data-n-a-ts="([^"]+)"/);
    if (!sgMatch || !tsMatch) return link;

    const innerArgs = JSON.stringify([
      'garturlreq',
      [
        ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
        'X',
        'X',
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0,
      ],
      base64Str,
      Number(tsMatch[1]),
      sgMatch[1],
    ]);
    const freq = JSON.stringify([[['Fbv4je', innerArgs, null, 'generic']]]);

    const batchRes = await fetchWithTimeout(
      `https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je&source-path=/rss/articles/${base64Str}&hl=en-US&gl=US`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `f.req=${encodeURIComponent(freq)}`,
      },
      timeoutMs
    );
    const text = await batchRes.text();
    return parseBatchExecuteResponse(text);
  } catch {
    return link;
  }
}

// items を並行数を limit 件に絞って fn に渡し、結果配列を返す（順序は入力と同じ）。
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

// 複数のGoogle News検索RSS URLを並行取得し、実記事URLへの解決（D-4）まで行う共通処理。
// fetchKompasViaGoogleNews()（既存newsレーン）とfetchFoodViaGoogleNews()（foodレーン）の両方から使う。
// fallbackSourceLabelを渡さない場合はRSS内のitem.source（実際の掲載媒体名）をそのまま使う。
async function fetchGoogleNewsSearchUrls(urls, { fallbackSourceLabel } = {}) {
  const results = await Promise.allSettled(
    urls.map((url) => fetchRssSource(url, fallbackSourceLabel ? { fallbackSourceLabel } : undefined))
  );
  const items = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);

  // Google Newsの仲介リンクを実記事URLへ解決する（D-4）。解決できない項目は元のリンクのまま返す（fail-open）。
  return mapWithConcurrency(items, LINK_RESOLVE_CONCURRENCY, async (item) => ({
    ...item,
    link: await resolveDirectLink(item.link),
  }));
}

async function fetchKompasViaGoogleNews() {
  const urls = KOMPAS_QUERIES.map((keyword) => googleNewsSiteSearchUrl('kompas.com', keyword));
  return fetchGoogleNewsSearchUrls(urls, { fallbackSourceLabel: 'Kompas' });
}

// foodレーン専用: site制限なしの一般検索RSSでジャカルタのグルメ・新規オープン情報を拾う。
// 週2回実行のため各クエリに when:7d を含める。一般検索なのでitem.sourceには実際の掲載媒体名
// （Detik/Kompas/CNN Indonesia等）が入るため、fallbackSourceLabelで上書きしない（元の媒体名を尊重する）。
export const FOOD_QUERIES = [
  'restoran baru jakarta when:7d',
  'restoran jepang jakarta when:7d',
  'kuliner jakarta selatan when:7d',
  'cafe baru jakarta when:7d',
  'restoran mall jakarta when:7d',
  'festival kuliner jakarta when:7d',
];

async function fetchFoodViaGoogleNews() {
  const urls = FOOD_QUERIES.map((query) => googleNewsSearchUrl(query));
  return fetchGoogleNewsSearchUrls(urls);
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

// foodレーン（グルメ情報）専用のソース登録簿。newsレーンの`sources`とは独立に管理する。
// - detikFood: food.detik.com の公式RSS（実在確認済み、2026-08-11）。100件規模のグルメニュースを配信。
// - foodGoogleNews: site制限なしのGoogle News検索RSS（FOOD_QUERIES）。新規オープン等を横断的に拾う。
export const foodSources = [
  {
    id: 'detikFood',
    label: 'Detik Food',
    fetch: () => fetchRssSource('https://food.detik.com/rss', { fallbackSourceLabel: 'Detik' }),
  },
  {
    id: 'foodGoogleNews',
    label: 'Google News (Kuliner)',
    fetch: fetchFoodViaGoogleNews,
  },
];

// lane('news' | 'food')から使用するソース配列を選ぶ純関数。'food'以外は常にnewsレーン（既存挙動）。
export function getSourcesForLane(lane) {
  return lane === 'food' ? foodSources : sources;
}

export async function fetchAllCandidates(lane = 'news') {
  const activeSources = getSourcesForLane(lane);
  const settled = await Promise.allSettled(activeSources.map((s) => s.fetch()));
  const failures = [];
  const items = [];

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      failures.push({ source: activeSources[i].id, error: String(result.reason) });
    }
  });

  return { items, failures };
}
