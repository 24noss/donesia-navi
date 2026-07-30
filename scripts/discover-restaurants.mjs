import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadExistingRestaurants, isKnownRestaurant } from './lib/existing-mapdata.mjs';
import { searchRestaurants, AREAS, CUISINE_QUERIES } from './lib/places.mjs';

// Node標準の.env読み込み。.env.localが存在しない場合はシェル環境変数のみに委ねる。
try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch {
  // .env.localが無ければ何もしない
}

const OUTPUT_PATH = path.join(process.cwd(), 'data/restaurant-candidates.json');
const MAX_PAGES = Number(process.env.PLACES_MAX_PAGES || 1);

function parseArgs(argv) {
  const args = { areas: null, cuisines: null };
  for (const arg of argv) {
    if (arg.startsWith('--area=')) {
      args.areas = [arg.slice('--area='.length)];
    } else if (arg.startsWith('--cuisine=')) {
      args.cuisines = [arg.slice('--cuisine='.length)];
    } else if (arg.startsWith('--max-pages=')) {
      args.maxPages = Number(arg.slice('--max-pages='.length));
    }
  }
  return args;
}

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY が未設定です。.env.local またはシェル環境変数に設定してください。');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const areas = args.areas || AREAS;
  const cuisines = args.cuisines || Object.keys(CUISINE_QUERIES);
  const maxPages = Number.isFinite(args.maxPages) ? args.maxPages : MAX_PAGES;

  console.log(`対象: ${areas.length}エリア × ${cuisines.length}カテゴリ = ${areas.length * cuisines.length}クエリ`);

  const existing = await loadExistingRestaurants();
  console.log(`既存記事から ${existing.articleCount}件のガイド記事・${existing.names.size}件の既知店舗名を読み込み`);

  // placeIdはGoogle側で物理的な店舗ロケーションごとに一意なため、これのみで
  // 実行内重複排除する。店名の正規化一致で弾くと、同じチェーンの別エリアの
  // 別支店（＝正当な別候補）まで誤って除外してしまうため使わない。
  const seenPlaceIds = new Set();
  const candidates = [];
  const failures = [];

  for (const area of areas) {
    for (const cuisine of cuisines) {
      try {
        const results = await searchRestaurants(apiKey, cuisine, area, { maxPages });
        for (const place of results) {
          if (place.placeId && seenPlaceIds.has(place.placeId)) continue;
          if (isKnownRestaurant(existing, place)) continue;

          if (place.placeId) seenPlaceIds.add(place.placeId);
          candidates.push(place);
        }
        console.log(`  ${cuisine} in ${area}: ${results.length}件取得`);
      } catch (err) {
        failures.push({ area, cuisine, error: String(err) });
        console.warn(`  ${cuisine} in ${area}: 失敗 (${err.message})`);
      }
    }
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), candidates, failures }, null, 2));

  console.log(`\n新規候補: ${candidates.length}件 → ${OUTPUT_PATH}`);
  if (failures.length) console.log(`失敗: ${failures.length}件`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
