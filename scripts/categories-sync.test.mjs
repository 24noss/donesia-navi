import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// astro:content は Node の素の `node --test` からはimportできないため（Astroランタイム前提のモジュール）、
// src/lib/categories.ts と src/content.config.ts の両方をテキストとして読み、
// 正規表現でカテゴリ集合を抽出して比較する。実際のimport解決ではなくテキスト突合のため、
// 抽出ロジックが対象ファイルのフォーマット変更に追従できていないと誤検出しうる点に注意。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const categoriesPath = path.join(__dirname, '..', 'src', 'lib', 'categories.ts');
const configPath = path.join(__dirname, '..', 'src', 'content.config.ts');

const categoriesSrc = fs.readFileSync(categoriesPath, 'utf-8');
const configSrc = fs.readFileSync(configPath, 'utf-8');

// src/lib/categories.ts の `export const categories = { ... } as const;` からトップレベルの
// カテゴリキー（例: `  safety: {`）だけを抽出する。ネストした `name:` / `color:` 等は
// 4スペース以上のインデントなので、2スペースインデント + `key: {` の行だけにマッチさせて除外する。
function extractCategoriesKeys(src) {
  const objMatch = src.match(/export const categories = \{([\s\S]*?)\n\} as const;/);
  assert.ok(objMatch, 'src/lib/categories.ts から categories オブジェクトの本体を抽出できなかった');
  const body = objMatch[1];
  const keys = [...body.matchAll(/^ {2}(\w+): \{/gm)].map((m) => m[1]);
  assert.ok(keys.length > 0, 'categories オブジェクトからキーを1つも抽出できなかった');
  return keys;
}

// src/content.config.ts には articles コレクションと places コレクションの両方に
// `category: z.enum([...])` があるため、`places` コレクション定義より前（= articles側）
// だけを対象に最初の1件を抽出する。
function extractArticlesCategoryEnum(src) {
  const placesDeclIndex = src.indexOf('const places = defineCollection');
  const articlesSrc = placesDeclIndex === -1 ? src : src.slice(0, placesDeclIndex);
  const enumMatch = articlesSrc.match(/category:\s*z\.enum\(\[([^\]]+)\]\)/);
  assert.ok(enumMatch, 'src/content.config.ts の articles コレクションから category enum を抽出できなかった');
  const values = [...enumMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(values.length > 0, 'category enum から値を1つも抽出できなかった');
  return values;
}

describe('extractCategoriesKeys', () => {
  test('categories.ts のトップレベルキーを抽出する（ネストしたname/color等は含めない）', () => {
    const keys = extractCategoriesKeys(categoriesSrc);
    assert.ok(keys.includes('safety'));
    assert.ok(keys.includes('gourmet'));
    assert.ok(!keys.includes('name'));
    assert.ok(!keys.includes('color'));
  });
});

describe('extractArticlesCategoryEnum', () => {
  test('content.config.ts の articles category enum を抽出する（placesの category enum とは混同しない）', () => {
    const values = extractArticlesCategoryEnum(configSrc);
    assert.ok(values.includes('safety'));
    assert.ok(values.includes('gourmet'));
    // places コレクションの category enum（restaurant/hospital/school/shop/office/spot）の値が
    // 混入していないことを確認する。
    assert.ok(!values.includes('restaurant'));
    assert.ok(!values.includes('hospital'));
  });
});

describe('categories.ts と content.config.ts のカテゴリ整合性', () => {
  test('キー集合とenum値集合が完全一致する（片方だけの追加漏れを検出する）', () => {
    const keys = extractCategoriesKeys(categoriesSrc);
    const values = extractArticlesCategoryEnum(configSrc);
    const keySet = new Set(keys);
    const valueSet = new Set(values);

    const missingInConfig = keys.filter((k) => !valueSet.has(k));
    const missingInCategories = values.filter((v) => !keySet.has(v));

    assert.deepEqual(
      missingInConfig,
      [],
      `src/lib/categories.ts にあって content.config.ts の enum に無いキー: ${missingInConfig.join(', ')}`
    );
    assert.deepEqual(
      missingInCategories,
      [],
      `content.config.ts の enum にあって src/lib/categories.ts に無い値: ${missingInCategories.join(', ')}`
    );
    assert.equal(keySet.size, valueSet.size);
  });

  test('gourmet カテゴリが両ファイルに存在する', () => {
    const keys = extractCategoriesKeys(categoriesSrc);
    const values = extractArticlesCategoryEnum(configSrc);
    assert.ok(keys.includes('gourmet'), 'src/lib/categories.ts に gourmet が無い');
    assert.ok(values.includes('gourmet'), 'content.config.ts の category enum に gourmet が無い');
  });
});
