// ガイド記事ギャップ提案ボット。
//
// 背景: Search Console(GSC)の流入クエリは「ジャカルタ 中華」「ジャカルタ イタリアン」のような
// エリア×料理ジャンルのガイド型検索が主力。既存のレストランガイド記事(中華5選・韓国5選など)
// がこれを取っているが、未カバーの組み合わせが多い。
// 毎週(月曜朝)、未カバートピックを算出してSlackに「次はこれを書きませんか」と提案する。
//
// 承認後のフロー: Slack提案 → 人間が承認 → 別セッション(Claude Code)で
// npm run discover-restaurants による店舗発見 → WebSearchでのリサーチ・執筆
// (詳細はAUTOMATION.mdの「ガイド記事ギャップ提案ボット」節を参照)。

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { postSlackMessage } from './lib/slack.mjs';

const ARTICLES_DIR = path.join(process.cwd(), 'src/content/articles');
const PLACES_DIR = path.join(process.cwd(), 'src/data/places');

// 候補店舗数がこれ未満の未カバートピックには「要ディスカバリー」と付記する。
export const MIN_CANDIDATE_PLACES = 5;
// Slackへの提案は優先度順の上位N件のみ。
export const TOP_SUGGESTION_COUNT = 3;

export const PRIORITY_ORDER = { high: 0, mid: 1, low: 2 };
const PRIORITY_LABEL = { high: '🔴 高', mid: '🟡 中', low: '🟢 低' };

// ターゲットトピック定義。
// Search Console実クエリ由来の初期リスト。四半期ごとに見直す。
// - keywords: category が gourmet/lifestyle の記事の title にこの語のいずれかが含まれていれば
//   「カバー済み」とみなす(tagsのみの一致は「関連記事あり(部分カバー)」の参考情報止まり。詳細はisTopicCoveredのコメント参照)
// - cuisine: src/data/places/*.yaml の cuisine と一致する店舗を候補としてカウントする(任意)
// - area: src/data/places/*.yaml の area と一致する店舗を候補としてカウントする(任意)
//   ※ cuisine/area は content.config.ts の places スキーマのenum値と一致させること
export const TARGET_TOPICS = [
  {
    id: 'italian',
    label: 'イタリアン単体ガイド',
    keywords: ['イタリアン'],
    area: null,
    cuisine: 'european',
    priority: 'high',
    rationale: 'GSCでクリックあり、専用記事なし(欧州料理5選に混在)',
  },
  {
    id: 'cafe',
    label: 'カフェガイド',
    keywords: ['カフェ'],
    area: null,
    cuisine: 'cafe',
    priority: 'high',
    rationale: 'GSCでクリックあり、専用記事なし',
  },
  {
    id: 'yakiniku',
    label: '焼肉ガイド',
    keywords: ['焼肉'],
    area: null,
    cuisine: 'japanese',
    priority: 'high',
    rationale: '「gokuniku」等の店名検索あり',
  },
  {
    id: 'ramen',
    label: 'ラーメンガイド',
    keywords: ['ラーメン'],
    area: null,
    cuisine: 'japanese',
    priority: 'mid',
    rationale: 'ラーメン専門店の指名検索が一定数あり、専用記事なし',
  },
  {
    id: 'sushi',
    label: '寿司ガイド',
    keywords: ['寿司', 'すし'],
    area: null,
    cuisine: 'japanese',
    priority: 'mid',
    rationale: '寿司関連クエリの流入があるが専用記事なし',
  },
  {
    id: 'french',
    label: 'フレンチガイド',
    keywords: ['フレンチ', 'フランス料理'],
    area: null,
    cuisine: 'european',
    priority: 'mid',
    rationale: '欧州料理5選に混在しており、フレンチ単体クエリもある',
  },
  {
    id: 'seafood',
    label: 'シーフードガイド',
    keywords: ['シーフード', '海鮮'],
    area: null,
    cuisine: 'other',
    priority: 'mid',
    rationale: 'シーフード関連クエリの流入があるが専用記事なし',
  },
  {
    id: 'halal',
    label: 'ハラルレストランガイド',
    keywords: ['ハラル'],
    area: null,
    cuisine: 'other',
    priority: 'mid',
    rationale: 'ムスリム在住者・出張者からのハラル検索需要',
  },
  {
    id: 'scbd',
    label: 'SCBDランチ・レストランガイド',
    keywords: ['SCBD'],
    area: 'SCBD',
    cuisine: null,
    priority: 'mid',
    rationale: 'SCBDオフィス街のランチ需要があるが、エリア横断ガイドなし',
  },
  {
    id: 'blok-m',
    label: 'ブロックMのレストランガイド',
    keywords: ['ブロックM'],
    area: 'ブロックM',
    cuisine: null,
    priority: 'mid',
    rationale: '在住日本人の生活圏だが、エリア単体ガイドなし',
  },
  {
    id: 'senayan',
    label: 'スナヤンのレストランガイド',
    keywords: ['スナヤン'],
    area: 'スナヤン',
    cuisine: null,
    priority: 'low',
    rationale: 'エリア単体のレストランガイドなし',
  },
  {
    id: 'kemang',
    label: 'クマンのレストランガイド',
    keywords: ['クマン'],
    area: 'クマン',
    cuisine: null,
    priority: 'mid',
    rationale: '在住日本人の生活圏だが、エリア単体ガイドなし',
  },
  {
    id: 'pondok-indah',
    label: 'ポンドックインダのレストランガイド',
    keywords: ['ポンドックインダ'],
    area: 'ポンドックインダ',
    cuisine: null,
    priority: 'low',
    rationale: 'ファミリー層在住エリアだが、専用ガイドなし',
  },
  {
    id: 'indian-curry',
    label: 'インドカレーガイド',
    keywords: ['インドカレー', 'インド料理'],
    area: null,
    cuisine: 'other',
    priority: 'low',
    rationale: '一定の流入はあるが、中華・韓国ほど優先度は高くない',
  },
  {
    id: 'thai',
    label: 'タイ料理ガイド',
    keywords: ['タイ料理'],
    area: null,
    cuisine: 'other',
    priority: 'low',
    rationale: '一定の流入はあるが、中華・韓国ほど優先度は高くない',
  },
  {
    id: 'vietnamese',
    label: 'ベトナム料理ガイド',
    keywords: ['ベトナム料理'],
    area: null,
    cuisine: 'other',
    priority: 'low',
    rationale: '一定の流入はあるが、中華・韓国ほど優先度は高くない',
  },
];

// frontmatterブロック(---〜---の中身)から title / tags / category / draft を正規表現で取り出す。
// scripts/crawl-and-draft.mjs の parseFrontmatterBlock を参考にしつつ、
// カバレッジ判定に必要な tags / category / draft も取得できるよう拡張したもの。
export function parseFrontmatter(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const block = fmMatch[1];

  const titleMatch = block.match(/^title:\s*"?(.*?)"?\s*$/m);
  const categoryMatch = block.match(/^category:\s*"?(.*?)"?\s*$/m);
  const draftMatch = block.match(/^draft:\s*(true|false)\s*$/m);
  const tagsMatch = block.match(/^tags:\s*\[(.*)\]\s*$/m);

  const tags = tagsMatch
    ? tagsMatch[1]
        .split(',')
        .map((t) => t.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'))
        .filter((t) => t.length > 0)
    : [];

  return {
    title: titleMatch?.[1]?.trim() || null,
    category: categoryMatch?.[1]?.trim() || null,
    draft: draftMatch?.[1] === 'true',
    tags,
  };
}

// src/content/articles/*.md を全件読み、frontmatterをパースして返す。
// ディレクトリが無い場合は空配列を返す(dry-runがネットワーク・環境なしで動く要件のため、例外にしない)。
export async function loadArticlesMeta(dir = ARTICLES_DIR) {
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const metas = [];
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const content = await readFile(path.join(dir, file), 'utf-8');
    const fm = parseFrontmatter(content);
    if (!fm) continue;
    metas.push({ file, ...fm });
  }
  return metas;
}

// src/data/places/*.yaml を全件読み、パースして返す。
// 1ファイルが壊れていても他のファイルの処理は継続する(fail-open)。
export async function loadPlaces(dir = PLACES_DIR) {
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const places = [];
  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const content = await readFile(path.join(dir, file), 'utf-8');
    try {
      const data = parseYaml(content);
      if (data) places.push(data);
    } catch (err) {
      console.warn(`places YAML解析エラー(${file})、スキップします:`, err.message);
    }
  }
  return places;
}

// カバレッジ判定の対象とする記事category。
// 交通ニュース等(travel/safety等)のtitleにトピックのkeywordがたまたま含まれることによる
// 誤判定(例: 「ブロックM」エリアトピックが「ブロックM発着バスの運賃改定」ニュースで
// 誤ってカバー済み扱いされる)を防ぐため、ガイド記事が属するcategoryのみに限定する。
const COVERAGE_CATEGORIES = new Set(['gourmet', 'lifestyle']);

// トピックのkeywordsのいずれかが記事の title に含まれていれば「カバー済み」。
// (2026-08-11〜: tagsでの一致は「カバー済み」に含めない。中華5選・韓国5選のような
//  複数料理ジャンルを1記事で扱う「洋食・ヨーロッパ料理」ガイドのtagsに「イタリアン」
//  「フレンチ」が混在していることで、専用記事が無いにも関わらず誤ってカバー済みと
//  判定される問題があったため。tagsのみで一致する記事は relatedTagsOnly として
//  別扱いにし、「関連記事あり(部分カバー)」の参考情報として出力側に渡す)
// draft:true の記事のみでtitleが一致した場合はallDraft:trueを返す(呼び出し側で「(draft)」と付記する)。
export function isTopicCovered(topic, articlesMeta) {
  const eligible = articlesMeta.filter((a) => COVERAGE_CATEGORIES.has(a.category));

  const titleMatched = eligible.filter((a) => {
    const title = a.title || '';
    return topic.keywords.some((kw) => title.includes(kw));
  });

  const relatedTagsOnly = eligible.filter((a) => {
    if (titleMatched.includes(a)) return false;
    const tags = a.tags || [];
    return topic.keywords.some((kw) => tags.some((tag) => tag.includes(kw)));
  });

  if (titleMatched.length === 0) {
    return { covered: false, matched: [], allDraft: false, relatedTagsOnly };
  }
  const allDraft = titleMatched.every((a) => a.draft);
  return { covered: true, matched: titleMatched, allDraft, relatedTagsOnly };
}

// トピックに対する既知の掲載候補店舗数。
// cuisine一致(+ areaトピックならarea一致)かつ status !== 'closed' の店舗数を数える。
export function countCandidatePlaces(topic, places) {
  return places.filter((p) => {
    if (!p || p.status === 'closed') return false;
    if (topic.cuisine && p.cuisine !== topic.cuisine) return false;
    if (topic.area && p.area !== topic.area) return false;
    return true;
  }).length;
}

// 全トピックについてカバレッジ・候補店舗数を評価し、未カバートピックのみをpriority順(high→mid→low)で返す。
// 同一priority内では TARGET_TOPICS の記載順を保つ(Array#sortは安定ソート)。
export function buildUncoveredTopics(topics, articlesMeta, places) {
  return topics
    .map((topic) => ({
      topic,
      coverage: isTopicCovered(topic, articlesMeta),
      candidateCount: countCandidatePlaces(topic, places),
    }))
    .filter((entry) => !entry.coverage.covered)
    .sort((a, b) => PRIORITY_ORDER[a.topic.priority] - PRIORITY_ORDER[b.topic.priority]);
}

// draft:true の記事のみでカバー済み(=執筆済み扱いだが未公開)のトピックを抽出する。
// 「未カバートピック」には含めない(=Slack提案の対象にはしない)が、
// 「実はすでに下書きが存在する」という情報は出力側で「(draft)」付きで案内する(buildUncoveredTopicsとは別集計)。
export function buildDraftOnlyCoveredTopics(topics, articlesMeta) {
  return topics
    .map((topic) => ({ topic, coverage: isTopicCovered(topic, articlesMeta) }))
    .filter((entry) => entry.coverage.covered && entry.coverage.allDraft);
}

function discoveryNote(candidateCount) {
  return candidateCount < MIN_CANDIDATE_PLACES ? '（要ディスカバリー: npm run discover-restaurants）' : '';
}

// tagsのみで一致した記事(=専用記事ではないが関連はある)を「関連記事あり(部分カバー)」の参考行として整形する。
// coverage.relatedTagsOnly が空なら何も返さない(カバー済み扱いにはしないため、あくまで参考情報)。
function formatRelatedNote(coverage) {
  if (!coverage?.relatedTagsOnly?.length) return null;
  const titles = coverage.relatedTagsOnly.map((a) => a.title || a.file).join(' / ');
  return `   関連記事あり(部分カバー、tagsのみ一致): ${titles}`;
}

function formatDraftOnlyLines(draftOnlyEntries) {
  if (!draftOnlyEntries || draftOnlyEntries.length === 0) return [];
  return [
    '',
    `参考: 下書き記事のみでカバー済み(未公開のためフォロー推奨、提案対象外): ${draftOnlyEntries.length}件`,
    ...draftOnlyEntries.map((entry) => `- ${entry.topic.label} (${entry.topic.id}) (draft)`),
  ];
}

// --dry-run 用のコンソール整形出力。
// draftOnlyEntries: buildDraftOnlyCoveredTopics()の結果(省略可)。指定時は「(draft)」付きの参考セクションを末尾に追加する。
export function formatDryRunReport(uncoveredEntries, draftOnlyEntries = []) {
  if (uncoveredEntries.length === 0) {
    const base = '未カバートピックはありません。全トピックがカバー済みです。提案なし。';
    return [base, ...formatDraftOnlyLines(draftOnlyEntries)].join('\n');
  }

  const lines = [`未カバートピック: ${uncoveredEntries.length}件\n`];
  uncoveredEntries.forEach((entry, i) => {
    const { topic, candidateCount, coverage } = entry;
    lines.push(
      `${i + 1}. [${PRIORITY_LABEL[topic.priority] || topic.priority}] ${topic.label} (${topic.id})`,
      `   理由: ${topic.rationale}`,
      `   既知の掲載候補: ${candidateCount}店${discoveryNote(candidateCount)}`
    );
    const relatedNote = formatRelatedNote(coverage);
    if (relatedNote) lines.push(relatedNote);
  });
  lines.push(...formatDraftOnlyLines(draftOnlyEntries));
  return lines.join('\n');
}

// Slack投稿用のBlock Kitメッセージを組み立てる。
// draftOnlyEntries: buildDraftOnlyCoveredTopics()の結果(省略可)。指定時は末尾に「(draft)」付きのcontextブロックを追加する。
export function buildSlackBlocks(entries, draftOnlyEntries = []) {
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: '📝 今週のガイド記事提案' } }];

  for (const entry of entries) {
    const { topic, candidateCount, coverage } = entry;
    const priorityLabel = PRIORITY_LABEL[topic.priority] || topic.priority;
    const relatedNote = coverage?.relatedTagsOnly?.length
      ? `\n関連記事あり(部分カバー、tagsのみ一致): ${coverage.relatedTagsOnly.map((a) => a.title || a.file).join(' / ')}`
      : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${topic.label}*\n優先度: ${priorityLabel}\n理由: ${topic.rationale}\n既知の掲載候補: ${candidateCount}店${discoveryNote(candidateCount)}${relatedNote}`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '承認する場合はこのスレッドに返信するか、Claude Codeセッションでリサーチ・執筆を進めてください。' }],
  });

  if (draftOnlyEntries.length > 0) {
    const list = draftOnlyEntries.map((e) => `${e.topic.label} (draft)`).join(' / ');
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `参考: 下書き記事のみでカバー済み(提案対象外): ${list}` }],
    });
  }

  return blocks;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const [articlesMeta, places] = await Promise.all([loadArticlesMeta(), loadPlaces()]);
  const uncovered = buildUncoveredTopics(TARGET_TOPICS, articlesMeta, places);
  const draftOnlyCovered = buildDraftOnlyCoveredTopics(TARGET_TOPICS, articlesMeta);

  if (dryRun) {
    console.log(formatDryRunReport(uncovered, draftOnlyCovered));
    process.exit(0);
  }

  if (uncovered.length === 0) {
    console.log('全トピックカバー済みです。提案はありません。');
    process.exit(0);
  }

  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) {
    console.error('SLACK_BOT_TOKEN / SLACK_CHANNEL_ID が未設定です。');
    process.exit(1);
  }

  const top = uncovered.slice(0, TOP_SUGGESTION_COUNT);
  const blocks = buildSlackBlocks(top, draftOnlyCovered);
  await postSlackMessage({
    token,
    channel,
    text: `今週のガイド記事提案: ${top.map((e) => e.topic.label).join(' / ')}`,
    blocks,
  });
  console.log(`Slackに${top.length}件のトピックを提案しました。`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
