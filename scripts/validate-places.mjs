// placesデータ検証スクリプト(C-0 タスク6)。
//
// src/data/places/*.yaml を全件検証し、違反があればexit 1で終了する:
//   1. YAMLパース成功 + 必須フィールドの型・enum適合
//   2. lat/lngがジャカルタ首都圏bbox(lat -6.6〜-5.9, lng 106.4〜107.2)内
//      (category: 'spot' は圏外の遠出スポット用途のため免除)
//   3. placeId重複なし(同一placeIdが複数ファイルに存在しない)
//   4. 座標60m以内の別ファイル重複 ―― ただし「重複」としてexit 1対象にするのは
//      placeId一致 または 正規化した店名が一致する場合のみ。店名が明確に異なる
//      のに座標だけ近いケースは警告表示のみに留める(exit 1対象にしない)。
//      理由: 実データを検証した結果、ジャカルタの密集した商業エリア
//      (SCBD/セノパティ等)では別々の実在店舗が60m圏内に複数存在するケースが
//      複数確認された(例: 隣接する飲食店、旧mapData由来の座標精度の粗さ)。
//      店名が異なるのに機械的に「重複」と断定して統合対象扱いにすると、
//      実在する別店舗のデータを誤って握りつぶすリスクの方が大きいため、
//      店名一致(またはplaceId一致)という強いシグナルがある場合のみ違反扱いにする。
//      詳細な判断根拠は各エージェントへの完了報告を参照。
//
// src/content.config.ts の `places` コレクションschemaと定義を同期させること。
// astro:content は仮想モジュールでAstroのビルドパイプライン外(素のnode実行)から
// 解決できないため、必要なenum等はこのファイル内に手動で複製している。

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const PLACES_DIR = path.join(process.cwd(), 'src/data/places');

const CATEGORY_VALUES = ['restaurant', 'hospital', 'school', 'shop', 'office', 'spot'];
const AREA_VALUES = [
  'メンテン', 'タムリン', 'スディルマン', 'セノパティ', 'SCBD', 'クマン',
  'グナワルマン', 'グロドック', 'スナヤン', 'ポンドックインダ', 'メガクニンガン',
  'ウィジャヤ', 'ウォルターモンギンシディ', 'パングリマポリム', 'ダルマワンサ',
  'メラワイ', 'ラジオダラム', 'ブロックM',
  // src/content.config.ts と同期(C-1医療タスクで追加)
  'チプテ', 'バンカ', 'スマンギ', 'チカラン',
];
const CUISINE_VALUES = ['japanese', 'korean', 'chinese', 'indonesian', 'european', 'cafe', 'other'];
const PRICE_VALUES = ['budget', 'mid', 'high', 'luxury'];
const YES_NO_UNVERIFIED = ['yes', 'no', 'unverified'];
const STATUS_VALUES = ['open', 'closed', 'unverified'];

const BBOX = { latMin: -6.6, latMax: -5.9, lngMin: 106.4, lngMax: 107.2 };
const NEARBY_METERS = 60;

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
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

function validateSchema(data) {
  const errors = [];
  const req = (cond, msg) => { if (!cond) errors.push(msg); };

  req(typeof data.name === 'string' && data.name.length > 0, 'name is required (string)');
  if (data.nameEn !== undefined) req(typeof data.nameEn === 'string', 'nameEn must be a string');
  req(CATEGORY_VALUES.includes(data.category), `category must be one of ${CATEGORY_VALUES.join('/')} (got: ${data.category})`);
  req(AREA_VALUES.includes(data.area), `area must be one of the known enum values (got: ${data.area})`);
  if (data.cuisine !== undefined) req(CUISINE_VALUES.includes(data.cuisine), `cuisine invalid (got: ${data.cuisine})`);
  if (data.priceRange !== undefined) req(PRICE_VALUES.includes(data.priceRange), `priceRange invalid (got: ${data.priceRange})`);
  if (data.halal !== undefined) req(YES_NO_UNVERIFIED.includes(data.halal), `halal invalid (got: ${data.halal})`);
  if (data.servesAlcohol !== undefined) req(YES_NO_UNVERIFIED.includes(data.servesAlcohol), `servesAlcohol invalid (got: ${data.servesAlcohol})`);
  req(typeof data.lat === 'number' && Number.isFinite(data.lat), 'lat is required (number)');
  req(typeof data.lng === 'number' && Number.isFinite(data.lng), 'lng is required (number)');
  req(typeof data.googleMapsQuery === 'string' && data.googleMapsQuery.length > 0, 'googleMapsQuery is required (string)');
  if (data.placeId !== undefined) req(typeof data.placeId === 'string', 'placeId must be a string');
  if (data.isChain !== undefined) req(typeof data.isChain === 'boolean', 'isChain must be a boolean');
  if (data.status !== undefined) req(STATUS_VALUES.includes(data.status), `status invalid (got: ${data.status})`);
  if (data.verifiedAt !== undefined) {
    req(!Number.isNaN(new Date(data.verifiedAt).getTime()), `verifiedAt is not a valid date (got: ${data.verifiedAt})`);
  }
  if (data.sourceArticles !== undefined) req(Array.isArray(data.sourceArticles), 'sourceArticles must be an array');
  if (data.description !== undefined) req(typeof data.description === 'string', 'description must be a string');

  return errors;
}

async function main() {
  const files = (await readdir(PLACES_DIR)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const violations = [];
  const warnings = [];
  const entries = [];

  for (const file of files) {
    const raw = await readFile(path.join(PLACES_DIR, file), 'utf-8');
    let data;
    try {
      data = parseYaml(raw);
    } catch (err) {
      violations.push(`[${file}] YAMLパースエラー: ${err.message}`);
      continue;
    }

    validateSchema(data).forEach((msg) => violations.push(`[${file}] ${msg}`));

    if (typeof data.lat === 'number' && typeof data.lng === 'number' && data.category !== 'spot') {
      const inBbox = data.lat >= BBOX.latMin && data.lat <= BBOX.latMax && data.lng >= BBOX.lngMin && data.lng <= BBOX.lngMax;
      if (!inBbox) {
        violations.push(`[${file}] 座標がジャカルタ首都圏bbox外です (lat=${data.lat}, lng=${data.lng})`);
      }
    }

    entries.push({ file, data });
  }

  // placeId重複
  const placeIdToFiles = new Map();
  entries.forEach(({ file, data }) => {
    if (!data.placeId) return;
    if (!placeIdToFiles.has(data.placeId)) placeIdToFiles.set(data.placeId, []);
    placeIdToFiles.get(data.placeId).push(file);
  });
  placeIdToFiles.forEach((fileList, placeId) => {
    if (fileList.length > 1) {
      violations.push(`placeId重複: ${placeId} が [${fileList.join(', ')}] に重複しています`);
    }
  });

  // 座標60m以内の別ファイル重複(判定方針は本ファイル冒頭コメント参照)
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (typeof a.data.lat !== 'number' || typeof b.data.lat !== 'number') continue;

      const dist = haversineMeters(a.data.lat, a.data.lng, b.data.lat, b.data.lng);
      if (dist >= NEARBY_METERS) continue;

      const samePlaceId = Boolean(a.data.placeId) && a.data.placeId === b.data.placeId;
      if (samePlaceId) {
        // placeId重複は上のチェックで既に報告済みなので二重報告はしない
        continue;
      }

      const nameA = normalizeName(a.data.name);
      const nameMatch = nameA.length > 0 && nameA === normalizeName(b.data.name);

      if (nameMatch) {
        violations.push(
          `座標60m以内かつ店名一致の重複候補: "${a.data.name}" (${a.file}) と "${b.data.name}" (${b.file}) が約${Math.round(dist)}m`
        );
      } else {
        warnings.push(
          `"${a.data.name}" (${a.file}) と "${b.data.name}" (${b.file}) は座標が約${Math.round(dist)}mしか離れていませんが、` +
          `店名が一致しないため別店舗として扱っています(密集商業エリアの近隣店、または座標精度の粗さに起因する可能性。要目視確認)。`
        );
      }
    }
  }

  console.log(`検証対象: ${entries.length}件 (${PLACES_DIR})\n`);

  if (warnings.length > 0) {
    console.log(`--- 警告 (exit 1対象外・要目視確認: ${warnings.length}件) ---`);
    warnings.forEach((w) => console.log(`  ${w}`));
    console.log('');
  }

  if (violations.length > 0) {
    console.log(`--- 違反 (exit 1対象: ${violations.length}件) ---`);
    violations.forEach((v) => console.error(`  ${v}`));
    console.log(`\n${violations.length}件の違反が見つかりました。`);
    process.exit(1);
  }

  console.log(`違反なし。${entries.length}件全て検証をパスしました。`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
