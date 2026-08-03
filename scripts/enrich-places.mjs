// placeId付与スクリプト(C-0 タスク5)。
//
// 実行はこのマシンからのみ可能: GOOGLE_PLACES_API_KEY はIP制限付きのため、
// 許可されたローカルPC以外(GitHub Actions等のCI含む)からは呼び出しても失敗する。
//
// 対象: src/data/places/*.yaml のうち placeId が未設定のもの。
// 各placeの googleMapsQuery で Places API (New) Text Search を実行し、
// 最有力候補(1件目)の placeId をyamlに書き戻す。
// 検索結果のlat/lngが既存値から500m以上ずれる場合は「別の場所を誤って
// 拾った」可能性が高いため、placeId・lat/lng とも書き換えずに警告のみ出す
// (500m未満なら、より正確な検索結果のlat/lngで既存値を更新する)。
//
// 実装パターンは scripts/lib/places.mjs (discover-restaurants.mjs が使う
// Text Search呼び出し)を参考にしているが、そのファイルは別エージェントが
// 作業中のため変更禁止。よって必要な関数はこのスクリプト内に独立して持つ。

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch {
  // .env.localが無ければシェル環境変数に委ねる
}

const PLACES_DIR = path.join(process.cwd(), 'src/data/places');
const PLACES_API_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = ['places.id', 'places.location', 'places.displayName'].join(',');
const MISMATCH_METERS = 500;
const REQUEST_INTERVAL_MS = 200;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function searchTextFirst(apiKey, textQuery) {
  const res = await fetch(PLACES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({ textQuery }),
  });

  if (!res.ok) {
    throw new Error(`Places API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data.places?.[0] || null;
}

// placeId(と、必要ならlat/lng)を既存のキー順を保ったまま挿入する。
// googleMapsQueryの直後にplaceIdを置き、content.config.tsのフィールド順に近い形にする。
function withPlaceId(data, placeId) {
  const ordered = {};
  let inserted = false;
  for (const key of Object.keys(data)) {
    ordered[key] = data[key];
    if (key === 'googleMapsQuery') {
      ordered.placeId = placeId;
      inserted = true;
    }
  }
  if (!inserted) ordered.placeId = placeId;
  return ordered;
}

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY が未設定です。.env.local またはシェル環境変数に設定してください。');
    process.exit(1);
  }

  const files = (await readdir(PLACES_DIR)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  let alreadyHadPlaceId = 0;
  let updated = 0;
  let mismatchWarned = 0;
  let notFound = 0;
  let failed = 0;

  console.log(`対象ディレクトリ: ${PLACES_DIR}`);
  console.log(`ファイル数: ${files.length}件\n`);

  for (const file of files) {
    const filePath = path.join(PLACES_DIR, file);
    const raw = await readFile(filePath, 'utf-8');
    const data = parseYaml(raw);

    if (data.placeId) {
      alreadyHadPlaceId += 1;
      continue;
    }

    try {
      const result = await searchTextFirst(apiKey, data.googleMapsQuery);
      if (!result || !result.id) {
        console.warn(`  [未検出] ${file}: 該当するPlaceが見つかりませんでした (query="${data.googleMapsQuery}")`);
        notFound += 1;
        continue;
      }

      const foundLat = result.location?.latitude;
      const foundLng = result.location?.longitude;
      let dist = null;
      if (typeof foundLat === 'number' && typeof foundLng === 'number') {
        dist = haversineMeters(data.lat, data.lng, foundLat, foundLng);
      }

      if (dist !== null && dist > MISMATCH_METERS) {
        console.warn(
          `  [警告] ${file}: 検索結果の座標が既存値から約${Math.round(dist)}m離れています(${MISMATCH_METERS}m超)。` +
          `誤ったPlaceを拾った可能性があるため placeId・lat/lng とも書き換えません。` +
          `(query="${data.googleMapsQuery}", 検出placeId=${result.id})`
        );
        mismatchWarned += 1;
      } else {
        const next = withPlaceId(data, result.id);
        if (dist !== null) {
          next.lat = foundLat;
          next.lng = foundLng;
        }
        await writeFile(filePath, stringifyYaml(next, { lineWidth: 0 }), 'utf-8');
        console.log(`  [成功] ${file}: placeId=${result.id}${dist !== null ? ` (座標差 約${Math.round(dist)}m)` : ''}`);
        updated += 1;
      }

      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
    } catch (err) {
      console.warn(`  [失敗] ${file}: ${err.message}`);
      failed += 1;
    }
  }

  console.log('\n=== enrich-places 結果 ===');
  console.log(`対象ファイル: ${files.length}件`);
  console.log(`placeId既存でスキップ: ${alreadyHadPlaceId}件`);
  console.log(`成功(placeId付与): ${updated}件`);
  console.log(`座標不一致で警告のみ(未書き込み): ${mismatchWarned}件`);
  console.log(`該当Place未検出: ${notFound}件`);
  console.log(`APIエラー等で失敗: ${failed}件`);

  if (mismatchWarned > 0 || notFound > 0 || failed > 0) {
    console.log('\n上記の警告・未検出・失敗分は手動確認のうえ、必要ならgoogleMapsQueryを見直して再実行してください。');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
