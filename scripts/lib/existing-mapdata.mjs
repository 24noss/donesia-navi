// 旧mapData frontmatter方式(記事frontmatterの`mapData:`配列)から、
// src/data/places/*.yaml コレクション方式への移行に伴う書き換え。
// 店舗データは現在 src/data/places/*.yaml (1店舗=1ファイル)に完全移行済みで、
// 記事frontmatter側にはもう`mapData`は存在しないため、discover-restaurants.mjs の
// 重複排除は既存placeデータを直接読み込んで参照する。

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const PLACES_DIR = path.join(process.cwd(), 'src/data/places');
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

// src/data/places/*.yaml (1店舗=1ファイル)を全件読み込み、discover-restaurants.mjsの
// 重複排除用データを組み立てる。レストラン発見スクリプト用途のため、category: 'restaurant'
// 以外(病院・学校等)は対象外。status: 'closed'の店舗も「既知の店舗」として含める
// (閉店済みでも重複判定に含めないと、discover-restaurants.mjsが新規候補として再発見して
// しまうため)。isChainは問わず全件含める。
export async function loadExistingRestaurants() {
  let files = [];
  try {
    files = await readdir(PLACES_DIR);
  } catch {
    return { names: new Set(), points: [], articleCount: 0 };
  }

  const names = new Set();
  const points = [];
  // articleCount: 旧仕様は「mapDataを持つ記事の件数」だったが、新設計ではplace側が
  // sourceArticles: string[] で記事idを持つ(記事→place ではなく place→記事の逆参照)。
  // 全レストランplaceのsourceArticlesを集約し、重複を除いた記事idの件数を
  // 「このレストラン群が何件のガイド記事から集まったか」を表す妥当な代替指標として返す。
  const articleIds = new Set();

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

    let data;
    try {
      const content = await readFile(path.join(PLACES_DIR, file), 'utf-8');
      data = parseYaml(content);
    } catch {
      continue;
    }
    if (!data || data.category !== 'restaurant') continue;

    if (data.name) names.add(normalizeName(data.name));
    if (data.nameEn) names.add(normalizeName(data.nameEn));
    if (typeof data.lat === 'number' && typeof data.lng === 'number') {
      points.push({ lat: data.lat, lng: data.lng, name: data.name });
    }

    if (Array.isArray(data.sourceArticles)) {
      for (const articleId of data.sourceArticles) {
        if (articleId) articleIds.add(articleId);
      }
    }
  }

  return { names, points, articleCount: articleIds.size };
}

// 既知店舗との重複判定: 正規化した店名の完全一致、または座標が近接(60m以内)なら「既知」とみなす。
// 完璧な同定は狙わず、明らかな重複候補を減らす目的の粗いフィルタ(判定ロジックは旧実装から変更なし)。
export function isKnownRestaurant(existing, candidate) {
  const normCandidate = normalizeName(candidate.name);
  if (normCandidate && existing.names.has(normCandidate)) return true;

  if (typeof candidate.lat === 'number' && typeof candidate.lng === 'number') {
    return existing.points.some((p) => haversineMeters(p.lat, p.lng, candidate.lat, candidate.lng) < NEARBY_METERS);
  }
  return false;
}
