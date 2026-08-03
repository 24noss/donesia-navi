// 閉店検知スクリプト(C-0 タスク7)。
//
// 実行はこのマシンからのみ可能: GOOGLE_PLACES_API_KEY はIP制限付きのため、
// 許可されたローカルPC以外(GitHub Actions等のCI含む)からは呼び出しても失敗する。
//
// placeIdを持つ全placesについて Places Details API (New) で businessStatus を照会する。
//   - CLOSED_PERMANENTLY → status: closed に書き換え + verifiedAt更新
//   - OPERATIONAL        → verifiedAtのみ更新
//   - それ以外(CLOSED_TEMPORARILY 等) → 自動更新せず要確認として報告のみ
//
// デフォルトはレポートのみ(yamlへの書き込みなし)。`--write` を付けたときだけ
// 実際にファイルへ書き込む。月次で回す想定(docs/improvement-roadmap.md C-1参照)。

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch {
  // .env.localが無ければシェル環境変数に委ねる
}

const PLACES_DIR = path.join(process.cwd(), 'src/data/places');
const DETAILS_API_BASE = 'https://places.googleapis.com/v1/places';
const FIELD_MASK = ['id', 'businessStatus', 'displayName'].join(',');
const REQUEST_INTERVAL_MS = 200;

const writeMode = process.argv.includes('--write');

async function getPlaceDetails(apiKey, placeId) {
  const res = await fetch(`${DETAILS_API_BASE}/${placeId}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
  });
  if (!res.ok) {
    throw new Error(`Places Details API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

// 既存のキー順を保ったままstatus/verifiedAtを更新する(status未設定=既定'open'の
// 場合は挿入位置として末尾を使う。既存キーの値だけ差し替える場合は順序も保たれる)。
function withStatusUpdate(data, { status, verifiedAt }) {
  const next = { ...data };
  if (status !== undefined) next.status = status;
  next.verifiedAt = verifiedAt;
  return next;
}

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY が未設定です。.env.local またはシェル環境変数に設定してください。');
    process.exit(1);
  }

  console.log(
    writeMode
      ? '書き込みモード(--write指定)で実行します。'
      : 'レポートのみモードで実行します(--write を付けると実際にyamlへ書き込みます)。'
  );

  const files = (await readdir(PLACES_DIR)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  let checked = 0;
  let closed = 0;
  let operational = 0;
  let other = 0;
  let skippedNoPlaceId = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = path.join(PLACES_DIR, file);
    const raw = await readFile(filePath, 'utf-8');
    const data = parseYaml(raw);

    if (!data.placeId) {
      skippedNoPlaceId += 1;
      continue;
    }

    try {
      const details = await getPlaceDetails(apiKey, data.placeId);
      checked += 1;
      const businessStatus = details.businessStatus;
      const today = todayDateOnly();

      if (businessStatus === 'CLOSED_PERMANENTLY') {
        closed += 1;
        console.log(`  [閉店検知] ${file}: "${data.name}" (placeId=${data.placeId}) は CLOSED_PERMANENTLY です。` +
          `status: closed に${writeMode ? '更新しました' : '更新します(レポートのみ・未書き込み)'}`);
        if (writeMode) {
          const next = withStatusUpdate(data, { status: 'closed', verifiedAt: today });
          await writeFile(filePath, stringifyYaml(next, { lineWidth: 0 }), 'utf-8');
        }
      } else if (businessStatus === 'OPERATIONAL') {
        operational += 1;
        console.log(`  [営業確認] ${file}: "${data.name}" は OPERATIONAL です。` +
          `verifiedAtを${writeMode ? '更新しました' : '更新します(レポートのみ・未書き込み)'}`);
        if (writeMode) {
          const next = withStatusUpdate(data, { verifiedAt: today });
          await writeFile(filePath, stringifyYaml(next, { lineWidth: 0 }), 'utf-8');
        }
      } else {
        other += 1;
        console.warn(`  [要確認] ${file}: "${data.name}" の businessStatus="${businessStatus}"` +
          '(CLOSED_TEMPORARILY等の可能性)。自動更新は行いません。手動で確認してください。');
      }

      await new Promise((resolve) => setTimeout(resolve, REQUEST_INTERVAL_MS));
    } catch (err) {
      failed += 1;
      console.warn(`  [失敗] ${file}: ${err.message}`);
    }
  }

  console.log('\n=== check-places-status 結果 ===');
  console.log(`モード: ${writeMode ? '書き込みあり(--write)' : 'レポートのみ(--writeなし)'}`);
  console.log(`対象ファイル: ${files.length}件`);
  console.log(`placeId未設定でスキップ: ${skippedNoPlaceId}件`);
  console.log(`照会成功: ${checked}件`);
  console.log(`  うちOPERATIONAL: ${operational}件`);
  console.log(`  うちCLOSED_PERMANENTLY(閉店検知): ${closed}件`);
  console.log(`  うちその他要確認: ${other}件`);
  console.log(`APIエラー等で失敗: ${failed}件`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
