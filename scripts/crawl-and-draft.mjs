import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fetchAllCandidates } from './lib/sources.mjs';

const ARTICLES_DIR = path.join(process.cwd(), 'src/content/articles');
const MAX_ARTICLES = Number(process.env.CRAWL_MAX_ARTICLES || 3);
const RECENT_DEDUPE_DAYS = 14;

const CATEGORY_NAMES = {
  safety: '安全・災害',
  society: '社会・政治',
  business: '経済・ビジネス',
  lifestyle: '生活・グルメ',
  travel: '旅行・お出かけ',
  visa: 'ビザ・手続き',
  regulation: '規制・法務',
};
const CATEGORY_SET = new Set(Object.keys(CATEGORY_NAMES));

// Gemini free tier(gemini-flash-latest)を使用。ai-report-biz/pipeline/enrich.pyの
// call_llm()と同じ呼び出し方式（プレーンプロンプト+テキストからJSON抽出）を踏襲する。
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

const ARTICLE_SCHEMA_DESCRIPTION = `
各記事オブジェクトのフィールド:
- title: 記事タイトル（日本語）
- description: 80〜120文字程度の要約
- category: 次の7種類のいずれか1つ（英語のslugのまま）: ${Object.keys(CATEGORY_NAMES).join(', ')}
- tags: 3〜5個の日本語タグの配列
- pubDate: "YYYY-MM-DD"形式の文字列
- source: 候補の"source"フィールドをそのまま使う
- sourceUrl: 候補の"link"フィールドをそのまま使う（改変・推測・生成をしない）
- slug: 英数字とハイフンのみの短い英語スラッグ
- heading: 本文冒頭の見出し文（##は含めない）
- keyPoints: 要点の箇条書き（3点程度）の配列
- body: 2〜3段落の本文プレーンテキスト（見出しや箇条書き記号は含めない）
`.trim();

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
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;
    const block = fmMatch[1];

    const sourceUrlMatch = block.match(/^sourceUrl:\s*"?(.*?)"?\s*$/m);
    if (sourceUrlMatch?.[1]) sourceUrls.add(sourceUrlMatch[1].trim());

    const titleMatch = block.match(/^title:\s*"?(.*?)"?\s*$/m);
    const pubDateMatch = block.match(/^pubDate:\s*(.*?)\s*$/m);
    if (titleMatch?.[1] && pubDateMatch?.[1]) {
      const pubDate = new Date(pubDateMatch[1].trim());
      if (!Number.isNaN(pubDate.getTime()) && pubDate.getTime() >= cutoff) {
        recentTitles.push(titleMatch[1].trim());
      }
    }
  }

  return { sourceUrls, recentTitles, files };
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

async function draftArticles(candidates, recentTitles) {
  const trimmed = candidates.map((c) => ({
    title: c.title,
    snippet: (c.snippet || '').slice(0, 300),
    source: c.source,
    link: c.link,
    pubDate: c.pubDate,
  }));

  const prompt = `あなたはドネシアナビ（インドネシア・ジャカルタ在住日本人向けニュースサイト）の記者です。
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

  const res = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'x-goog-api-key': process.env.GEMINI_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1] : (text.match(/\[[\s\S]*\]/) || [])[0];
  if (!jsonText) throw new Error(`モデル応答からJSON配列を抽出できませんでした: ${text.slice(0, 500)}`);

  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error('モデル応答が配列ではありません');
  return parsed;
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
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY が未設定です。`gh secret set GEMINI_API_KEY` (CI) または `export GEMINI_API_KEY=...` (ローカル) を実行してください。');
    process.exit(1);
  }

  console.log('候補ニュースを取得中...');
  const { sourceUrls, recentTitles, files: existingFiles } = await loadExistingArticles();
  const { items, failures } = await fetchAllCandidates();
  if (failures.length) {
    console.warn('一部ソースの取得に失敗しました:', failures);
  }

  const candidates = filterCandidates(items, sourceUrls);
  console.log(`候補 ${items.length}件 → 既存記事との重複除外後 ${candidates.length}件`);

  if (candidates.length === 0) {
    console.log('新規候補がありません。終了します。');
    await writeFile(path.join(process.cwd(), '.crawl-result.json'), '[]');
    return;
  }

  const drafted = await draftArticles(candidates, recentTitles);
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
    created.push({ filename, title: article.title, category: article.category, source: article.source, sourceUrl: article.sourceUrl });
    console.log(`作成: ${filename}`);
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
