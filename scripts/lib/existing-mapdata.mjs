import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const ARTICLES_DIR = path.join(process.cwd(), 'src/content/articles');
const NEARBY_METERS = 60;

export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 全記事のfrontmatterからmapDataを集約する。既存記事は手書きのYAMLで、
// 配列やネストを含むため正規表現ではなく実際のYAMLパーサーで読む。
export async function loadExistingRestaurants() {
  let files = [];
  try {
    files = await readdir(ARTICLES_DIR);
  } catch {
    return { names: new Set(), points: [], articleCount: 0 };
  }

  const names = new Set();
  const points = [];
  let articleCount = 0;

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const content = await readFile(path.join(ARTICLES_DIR, file), 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    let frontmatter;
    try {
      frontmatter = parseYaml(fmMatch[1]);
    } catch {
      continue;
    }

    if (!Array.isArray(frontmatter?.mapData)) continue;
    articleCount += 1;

    for (const r of frontmatter.mapData) {
      if (r.name) names.add(normalizeName(r.name));
      if (r.nameEn) names.add(normalizeName(r.nameEn));
      if (typeof r.lat === 'number' && typeof r.lng === 'number') {
        points.push({ lat: r.lat, lng: r.lng, name: r.name });
      }
    }
  }

  return { names, points, articleCount };
}

// 既知店舗との重複判定: 正規化した店名の完全一致、または座標が近接(60m以内)なら「既知」とみなす。
// 完璧な同定は狙わず、明らかな重複候補を減らす目的の粗いフィルタ。
export function isKnownRestaurant(existing, candidate) {
  const normCandidate = normalizeName(candidate.name);
  if (normCandidate && existing.names.has(normCandidate)) return true;

  if (typeof candidate.lat === 'number' && typeof candidate.lng === 'number') {
    return existing.points.some((p) => haversineMeters(p.lat, p.lng, candidate.lat, candidate.lng) < NEARBY_METERS);
  }
  return false;
}
