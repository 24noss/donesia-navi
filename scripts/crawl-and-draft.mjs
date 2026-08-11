import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fetchAllCandidates } from './lib/sources.mjs';

const ARTICLES_DIR = path.join(process.cwd(), 'src/content/articles');
const MAX_ARTICLES = Number(process.env.CRAWL_MAX_ARTICLES || 3);
const RECENT_DEDUPE_DAYS = 14;
const VALID_LANES = new Set(['news', 'food']);

// レーン決定の優先順位: CLI引数 --lane=food > 環境変数 CRAWL_LANE > デフォルト'news'。
// 純関数（argv/envを引数で受け取り、process.*を直接参照しない）なのでテストしやすい。
export function resolveLane(argv = [], env = {}) {
  const laneArgEntry = argv.find((a) => a.startsWith('--lane='));
  const laneArg = laneArgEntry ? laneArgEntry.slice('--lane='.length) : null;
  if (VALID_LANES.has(laneArg)) return laneArg;
  if (VALID_LANES.has(env.CRAWL_LANE)) return env.CRAWL_LANE;
  return 'news';
}

// --dry-run フラグの有無を判定する純関数。
export function isDryRun(argv = []) {
  return argv.includes('--dry-run');
}

const CATEGORY_NAMES = {
  safety: '安全・災害',
  society: '社会・政治',
  business: '経済・ビジネス',
  lifestyle: '生活情報',
  travel: '旅行・お出かけ',
  visa: 'ビザ・手続き',
  regulation: '規制・法務',
  gourmet: 'グルメ・レストラン',
};
const CATEGORY_SET = new Set(Object.keys(CATEGORY_NAMES));

// Gemini free tier(gemini-flash-latest)を使用。ai-report-biz/pipeline/enrich.pyの
// call_llm()と同じ呼び出し方式（プレーンプロンプト+テキストからJSON抽出）を踏襲する。
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

const ARTICLE_SCHEMA_DESCRIPTION = `
各記事オブジェクトのフィールド:
- title: 記事タイトル（日本語）
- description: 80〜120文字程度の要約
- category: 次の8種類のいずれか1つ（英語のslugのまま）: ${Object.keys(CATEGORY_NAMES).join(', ')}
  - safety: 災害・事故・治安に加え、交通規制/渋滞/デモ等の注意喚起（例: 大規模イベントに伴う交通混雑への注意）
  - society: 政治・行政・社会制度のニュース
  - business: 経済・企業・市場・物価などマクロな動き
  - lifestyle: 買い物・学校・病院など在住者の日常生活情報（注意喚起ニュースはsafety）
  - gourmet: 飲食店・カフェ・グルメイベント・食に関する情報
  - travel/visa/regulation: 旅行・ビザ手続き・法制度の情報（制度の「改正」はregulation、手続きの「案内」はvisa）
- tags: 3〜5個の日本語タグの配列
- pubDate: "YYYY-MM-DD"形式の文字列
- source: 候補の"source"フィールドをそのまま使う
- sourceUrl: 候補の"link"フィールドをそのまま使う（改変・推測・生成をしない）
- slug: 英数字とハイフンのみの短い英語スラッグ
- heading: 本文冒頭の見出し文（##は含めない）
- keyPoints: 要点の箇条書き（3点程度）の配列
- body: 2〜3段落の本文プレーンテキスト（見出しや箇条書き記号は含めない）
- placeCandidates: （gourmetカテゴリの記事のみ、任意）記事で紹介した店舗ごとの{name, area, cuisine}オブジェクトの配列。該当店舗が無い場合や他カテゴリでは省略してよい
`.trim();

// Gemini APIの responseSchema（OpenAPI 3.0のサブセット）。ARTICLE_SCHEMA_DESCRIPTION のフィールドと整合させる。
// トップレベルを配列にできる（type: 'ARRAY' + items: {type: 'OBJECT', ...}）。type値は大文字の列挙値
// （STRING/NUMBER/INTEGER/BOOLEAN/ARRAY/OBJECT）を使う。参考: https://ai.google.dev/api/generate-content の Schema定義。
const ARTICLE_FIELD_ORDER = [
  'title',
  'description',
  'category',
  'tags',
  'pubDate',
  'source',
  'sourceUrl',
  'slug',
  'heading',
  'keyPoints',
  'body',
];

// placeCandidatesはfoodレーン（gourmetカテゴリ）専用のoptionalフィールド。
// requiredには含めない（news/food両レーン共通のスキーマとして安全に共存させるため）。
const PLACE_CANDIDATE_FIELD_ORDER = ['name', 'area', 'cuisine'];

const ARTICLE_RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      description: { type: 'STRING' },
      category: { type: 'STRING', enum: Object.keys(CATEGORY_NAMES) },
      tags: { type: 'ARRAY', items: { type: 'STRING' } },
      pubDate: { type: 'STRING' },
      source: { type: 'STRING' },
      sourceUrl: { type: 'STRING' },
      slug: { type: 'STRING' },
      heading: { type: 'STRING' },
      keyPoints: { type: 'ARRAY', items: { type: 'STRING' } },
      body: { type: 'STRING' },
      placeCandidates: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            area: { type: 'STRING' },
            cuisine: { type: 'STRING' },
          },
          required: PLACE_CANDIDATE_FIELD_ORDER,
          propertyOrdering: PLACE_CANDIDATE_FIELD_ORDER,
        },
      },
    },
    required: ARTICLE_FIELD_ORDER,
    propertyOrdering: [...ARTICLE_FIELD_ORDER, 'placeCandidates'],
  },
};

// Gemini応答テキストからarticle配列を取り出す。
// 1. responseMimeType: 'application/json' 指定時に想定される経路（素のJSON.parse）を先に試す。
// 2. 失敗、またはJSON.parseできても配列でない場合は、既存の```json フェンス抽出→正規表現フォールバックを試す
//    （モデルがフェンス付きで返した場合や、responseSchemaが効かなかった場合の保険。挙動は変えず維持）。
export function parseGeminiArticlesResponse(text) {
  try {
    const direct = JSON.parse(text);
    if (Array.isArray(direct)) return direct;
  } catch {
    // フォールバックへ
  }

  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : (text.match(/\[[\s\S]*\]/) || [])[0];
  if (!jsonText) throw new Error(`モデル応答からJSON配列を抽出できませんでした: ${text.slice(0, 500)}`);

  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error('モデル応答が配列ではありません');
  return parsed;
}

export function escapeYaml(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidUrl(v) {
  if (!isNonEmptyString(v)) return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}

// content.config.ts のzodスキーマに違反するデータをそのままwriteFileすると、
// マージ後のastro buildがサイト全体でクラッシュしうる（draft:trueでも実害が出る）ため、
// 書き込み前にLLM出力を検証する。
export function validateArticle(article) {
  const problems = [];
  if (!isNonEmptyString(article.title)) problems.push('title が空');
  if (!isNonEmptyString(article.description)) problems.push('description が空');
  if (!CATEGORY_SET.has(article.category)) problems.push(`category が不正 (${article.category})`);
  if (!Array.isArray(article.tags) || article.tags.length === 0 || !article.tags.every(isNonEmptyString)) {
    problems.push('tags が空または不正');
  }
  if (!isNonEmptyString(article.source)) problems.push('source が空');
  if (!isValidUrl(article.sourceUrl)) problems.push(`sourceUrl が不正なURL (${article.sourceUrl})`);
  if (!isNonEmptyString(article.heading)) problems.push('heading が空');
  if (!Array.isArray(article.keyPoints) || article.keyPoints.length === 0) problems.push('keyPoints が空');
  if (!isNonEmptyString(article.body)) problems.push('body が空');
  return problems;
}

export function slugify(input) {
  const slug = String(input)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'article';
}

// frontmatterブロック（---〜---の中身）から sourceUrl / title を正規表現で取り出す。
// loadExistingArticles() と fetchOpenPrDedupeData()（D-6）の両方から使う共通ロジック。
export function parseFrontmatterBlock(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const block = fmMatch[1];

  const sourceUrlMatch = block.match(/^sourceUrl:\s*"?(.*?)"?\s*$/m);
  const titleMatch = block.match(/^title:\s*"?(.*?)"?\s*$/m);
  const pubDateMatch = block.match(/^pubDate:\s*(.*?)\s*$/m);

  return {
    sourceUrl: sourceUrlMatch?.[1]?.trim() || null,
    title: titleMatch?.[1]?.trim() || null,
    pubDate: pubDateMatch?.[1]?.trim() || null,
  };
}

async function loadExistingArticles() {
  let files = [];
  try {
    files = await readdir(ARTICLES_DIR);
  } catch {
    return { sourceUrls: new Set(), recentTitles: [], files: [] };
  }

  const sourceUrls = new Set();
  const recentTitles = [];
  const cutoff = Date.now() - RECENT_DEDUPE_DAYS * 24 * 60 * 60 * 1000;

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const content = await readFile(path.join(ARTICLES_DIR, file), 'utf-8');
    const fm = parseFrontmatterBlock(content);
    if (!fm) continue;

    if (fm.sourceUrl) sourceUrls.add(fm.sourceUrl);

    if (fm.title && fm.pubDate) {
      const pubDate = new Date(fm.pubDate);
      if (!Number.isNaN(pubDate.getTime()) && pubDate.getTime() >= cutoff) {
        recentTitles.push(fm.title);
      }
    }
  }

  return { sourceUrls, recentTitles, files };
}

const GITHUB_API_BASE = 'https://api.github.com';

async function githubApi(apiPath, token) {
  const res = await fetch(`${GITHUB_API_BASE}${apiPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${apiPath} error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// オープンPR内で新規追加された src/content/articles/*.md のfrontmatterから
// sourceUrl / title を集め、重複排除セットに合流させる（D-6）。
// GITHUB_TOKEN / GITHUB_REPOSITORY が無ければ何もせず空を返す（ローカル実行時はネットワークアクセスなしでスキップ）。
// GitHub APIが失敗しても警告を出すだけで処理は継続する（fail-open。main側のクロール自体は止めない）。
export async function fetchOpenPrDedupeData({
  token = process.env.GITHUB_TOKEN,
  repo = process.env.GITHUB_REPOSITORY,
} = {}) {
  const sourceUrls = new Set();
  const titles = [];

  if (!token || !repo) {
    return { sourceUrls, titles };
  }

  let prs;
  try {
    prs = await githubApi(`/repos/${repo}/pulls?state=open&per_page=100`, token);
    if (!Array.isArray(prs)) throw new Error('オープンPR一覧のレスポンス形式が想定外です（配列ではありません）');
  } catch (err) {
    console.warn('オープンPR一覧の取得に失敗しました。既存記事のみで重複排除します:', err.message);
    return { sourceUrls, titles };
  }

  for (const pr of prs) {
    let files;
    try {
      files = await githubApi(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`, token);
      if (!Array.isArray(files)) throw new Error('ファイル一覧のレスポンス形式が想定外です（配列ではありません）');
    } catch (err) {
      console.warn(`オープンPR #${pr.number} のファイル一覧取得に失敗しました（続行）:`, err.message);
      continue;
    }

    const articleFiles = files.filter(
      (f) => f?.filename?.startsWith('src/content/articles/') && f.filename.endsWith('.md') && f.status === 'added'
    );

    for (const f of articleFiles) {
      try {
        const contentRes = await githubApi(`/repos/${repo}/contents/${encodeURIComponent(f.filename)}?ref=${pr.head.sha}`, token);
        const raw = Buffer.from(contentRes.content, 'base64').toString('utf-8');
        const fm = parseFrontmatterBlock(raw);
        if (!fm) continue;
        if (fm.sourceUrl) sourceUrls.add(fm.sourceUrl);
        if (fm.title) titles.push(fm.title);
      } catch (err) {
        console.warn(`オープンPR #${pr.number} のファイル ${f.filename} 取得に失敗しました（続行）:`, err.message);
      }
    }
  }

  return { sourceUrls, titles };
}

function filterCandidates(items, existingSourceUrls) {
  const seenLinks = new Set();
  return items.filter((item) => {
    if (!item.link || !item.title) return false;
    if (existingSourceUrls.has(item.link)) return false;
    if (seenLinks.has(item.link)) return false;
    seenLinks.add(item.link);
    return true;
  });
}

function buildNewsPrompt(trimmed, recentTitles) {
  return `あなたはドネシアナビ（インドネシア・ジャカルタ在住日本人向けニュースサイト）の記者です。
以下の候補ニュース一覧から、在住日本人にとって重要度の高いものを最大${MAX_ARTICLES}件選び、日本語記事として執筆してください。

# ルール
- 同一の出来事が複数ソースの候補に含まれる場合は、内容を突き合わせて事実確認し、本文中でどのソースの報道か言及すること（例:「Kompas、Detik各紙の報道によると」）。ソース間で情報が食い違う場合は断定を避け保守的な表現にする。
- 直近${RECENT_DEDUPE_DAYS}日以内に既に扱った以下のトピックと重複する内容は選ばない: ${recentTitles.length ? recentTitles.join(' / ') : '(なし)'}
- 在住日本人にとって十分に重要な候補がなければ無理に選ばず、0件を返してもよい

# 出力フォーマット
${ARTICLE_SCHEMA_DESCRIPTION}

出力は上記フィールドを持つオブジェクトの配列を、\`\`\`json で始まるコードブロック内のJSON配列のみで返すこと。前後に説明文を付けないこと。該当なしの場合は \`\`\`json\n[]\n\`\`\` を返すこと。

候補ニュース一覧（${trimmed.length}件）:
${JSON.stringify(trimmed, null, 2)}`;
}

function buildFoodPrompt(trimmed, recentTitles) {
  return `あなたはドネシアナビ（インドネシア・ジャカルタ在住日本人向けニュースサイト）のグルメ担当記者です。
以下の候補ニュース一覧から、ジャカルタ首都圏在住の日本人にとって有用度の高いグルメ情報を最大${MAX_ARTICLES}件選び、日本語記事として執筆してください。

# ルール
- 対象は次のいずれかに該当するものに限る: 新規オープン、閉店・移転、話題の飲食店、フードフェス・グルメイベント、季節限定情報
- ジャカルタ首都圏在住の日本人にとって有用な情報を優先すること（日本食、接待・会食向き、家族向き、話題の新店など）
- 店名・住所・価格・営業時間などの事実情報は、候補ニュース一覧（title/snippet）に実際に書かれている内容のみを使用すること。書かれていない情報を推測・創作してはならない
- category は原則 "gourmet" を選ぶこと
- 直近${RECENT_DEDUPE_DAYS}日以内に既に扱った以下のトピックと重複する内容は選ばない: ${recentTitles.length ? recentTitles.join(' / ') : '(なし)'}
- 在住日本人にとって十分に有用な候補がなければ無理に選ばず、0件を返してもよい

# 出力フォーマット
${ARTICLE_SCHEMA_DESCRIPTION}

記事で紹介した店舗があれば、placeCandidates配列にその店舗のname（現地表記のまま）・area（記事に書かれたエリア名）・cuisine（料理ジャンル）を含めること。店名・エリア・料理ジャンルのいずれも候補ニュースに書かれていない情報を創作しないこと。該当する店舗が無い場合は placeCandidates を省略するか空配列でよい。

出力は上記フィールドを持つオブジェクトの配列を、\`\`\`json で始まるコードブロック内のJSON配列のみで返すこと。前後に説明文を付けないこと。該当なしの場合は \`\`\`json\n[]\n\`\`\` を返すこと。

候補ニュース一覧（${trimmed.length}件）:
${JSON.stringify(trimmed, null, 2)}`;
}

async function draftArticles(candidates, recentTitles, lane = 'news') {
  const trimmed = candidates.map((c) => ({
    title: c.title,
    snippet: (c.snippet || '').slice(0, 300),
    source: c.source,
    link: c.link,
    pubDate: c.pubDate,
  }));

  const prompt = lane === 'food' ? buildFoodPrompt(trimmed, recentTitles) : buildNewsPrompt(trimmed, recentTitles);

  const res = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': process.env.GEMINI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ARTICLE_RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  return parseGeminiArticlesResponse(text);
}

export function buildMarkdown(article, pubDateStr) {
  const tagsYaml = article.tags.map((t) => `"${escapeYaml(t)}"`).join(', ');
  const frontmatter = [
    '---',
    `title: "${escapeYaml(article.title)}"`,
    `description: "${escapeYaml(article.description)}"`,
    `category: "${article.category}"`,
    `tags: [${tagsYaml}]`,
    `pubDate: ${pubDateStr}`,
    `source: "${escapeYaml(article.source)}"`,
    `sourceUrl: "${escapeYaml(article.sourceUrl)}"`,
    'draft: true',
    '---',
  ].join('\n');

  const body = [
    `## ${article.heading}`,
    '',
    '**要点:**',
    ...article.keyPoints.map((p) => `- ${p}`),
    '',
    article.body.trim(),
    '',
    '---',
    `**情報ソース:** [${article.source}](${article.sourceUrl})`,
    `**カテゴリ:** ${CATEGORY_NAMES[article.category]}`,
    `**タグ:** ${article.tags.join(', ')}`,
    '',
    '*この記事はAIが生成し、公開前に人間の編集者がレビューします。*',
  ].join('\n');

  return `${frontmatter}\n\n${body}\n`;
}

async function uniqueFilename(existingFiles, dateStr, slug) {
  const files = new Set(existingFiles);
  let candidate = `${dateStr}-${slug}.md`;
  let n = 2;
  while (files.has(candidate)) {
    candidate = `${dateStr}-${slug}-${n}.md`;
    n += 1;
  }
  return candidate;
}

async function main() {
  const argv = process.argv.slice(2);
  const lane = resolveLane(argv, process.env);
  const dryRun = isDryRun(argv);

  // dry-run時はGemini呼び出し・ファイル書き込みを行わないため、GEMINI_API_KEY未設定でも動作させる。
  if (!dryRun && !process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY が未設定です。`gh secret set GEMINI_API_KEY` (CI) または `export GEMINI_API_KEY=...` (ローカル) を実行してください。');
    process.exit(1);
  }

  console.log(`候補ニュースを取得中...（レーン: ${lane}${dryRun ? ' / dry-run' : ''}）`);
  const { sourceUrls, recentTitles, files: existingFiles } = await loadExistingArticles();

  // オープンPR（未マージのドラフト記事）も重複排除対象に含める（D-6）。
  // GITHUB_TOKEN/GITHUB_REPOSITORY が無ければ何もせずスキップする。
  const openPrDedupe = await fetchOpenPrDedupeData();
  if (openPrDedupe.sourceUrls.size > 0 || openPrDedupe.titles.length > 0) {
    console.log(`オープンPR由来の重複排除データ: sourceUrl ${openPrDedupe.sourceUrls.size}件 / title ${openPrDedupe.titles.length}件`);
  }
  openPrDedupe.sourceUrls.forEach((url) => sourceUrls.add(url));
  const combinedRecentTitles = [...recentTitles, ...openPrDedupe.titles];

  const { items, failures } = await fetchAllCandidates(lane);
  if (failures.length) {
    console.warn('一部ソースの取得に失敗しました:', failures);
  }

  const candidates = filterCandidates(items, sourceUrls);
  console.log(`候補 ${items.length}件 → 既存記事・オープンPRとの重複除外後 ${candidates.length}件`);

  if (dryRun) {
    console.log('--dry-run のため、Gemini呼び出し・ファイル書き込みをスキップして終了します。');
    console.log('候補タイトル（最大5件）:');
    candidates.slice(0, 5).forEach((c, i) => console.log(`  ${i + 1}. [${c.source}] ${c.title}`));
    return;
  }

  if (candidates.length === 0) {
    console.log('新規候補がありません。終了します。');
    await writeFile(path.join(process.cwd(), '.crawl-result.json'), '[]');
    return;
  }

  const drafted = await draftArticles(candidates, combinedRecentTitles, lane);
  const capped = drafted.slice(0, MAX_ARTICLES);
  console.log(`${capped.length}件の記事をドラフト生成します。`);

  const created = [];
  let filesForNaming = existingFiles;

  for (const article of capped) {
    const problems = validateArticle(article);
    if (problems.length > 0) {
      console.warn(`スキーマ不正のためスキップ: "${article.title}" — ${problems.join(', ')}`);
      continue;
    }

    const pubDateStr = article.pubDate && /^\d{4}-\d{2}-\d{2}$/.test(article.pubDate)
      ? article.pubDate
      : new Date().toISOString().slice(0, 10);
    const slug = slugify(article.slug || article.title);
    const filename = await uniqueFilename(filesForNaming, pubDateStr, slug);
    filesForNaming = [...filesForNaming, filename];

    const markdown = buildMarkdown(article, pubDateStr);
    await writeFile(path.join(ARTICLES_DIR, filename), markdown, 'utf-8');

    const hasPlaceCandidates = Array.isArray(article.placeCandidates) && article.placeCandidates.length > 0;
    created.push({
      filename,
      title: article.title,
      category: article.category,
      source: article.source,
      sourceUrl: article.sourceUrl,
      ...(hasPlaceCandidates ? { placeCandidates: article.placeCandidates } : {}),
    });
    console.log(`作成: ${filename}`);
    if (hasPlaceCandidates) {
      console.log(`  places YAML追加候補: ${JSON.stringify(article.placeCandidates)}`);
    }
  }

  await writeFile(path.join(process.cwd(), '.crawl-result.json'), JSON.stringify(created, null, 2));

  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_OUTPUT, `count=${created.length}\n`);
  }

  console.log(`完了: ${created.length}件の draft:true 記事を作成しました。`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
