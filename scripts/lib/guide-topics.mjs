// ガイド記事パイプライン共通ライブラリ(台帳・出典の読み込みと検証、参照URL解決、次トピック選択)。
//
// データファイル(別途メンテされる):
//   - src/data/guide-topics.json     : トピック台帳
//   - src/data/official-sources.json : テーマ別の公的・一次情報の出典一覧
// 仕様と運用は docs/guide-pipeline.md を参照。
//
// GitHub照会(オープンPR・却下済みPR)は crawl-and-draft.mjs の fetchOpenPrDedupeData と同じ流儀で
// 「純粋な選択ロジック」と「API呼び出し」を分けてある(テストでは fetchImpl を差し替える)。

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import tagVocabularyData from '../../src/data/tag-vocabulary.json' with { type: 'json' };

export const ROOT = process.cwd();
export const GUIDE_TOPICS_PATH = path.join(ROOT, 'src/data/guide-topics.json');
export const OFFICIAL_SOURCES_PATH = path.join(ROOT, 'src/data/official-sources.json');
// 出典スナップショットは記事ごとのファイル <dir>/<id>.json(PR間でファイルが競合しないようにするため)。
export const SNAPSHOTS_DIR = path.join(ROOT, 'src/data/guide-source-snapshots');
export const snapshotFilePath = (id, dir = SNAPSHOTS_DIR) => path.join(dir, `${id}.json`);
export const ARTICLES_DIR = path.join(ROOT, 'src/content/articles');

// src/content.config.ts の category enum と一致させる(categories-sync.test.mjs 系の流儀。ここでは値を直書きし、
// guide-topics.test.mjs が content.config.ts と一致することを検証する)。
export const ARTICLE_CATEGORIES = ['safety', 'society', 'business', 'gourmet', 'lifestyle', 'travel', 'visa', 'regulation'];
export const AUDIENCES = ['tourist', 'prospective-resident', 'resident'];
export const TOPIC_STATUSES = ['queued', 'on-hold'];
// hub = クラスタの総合ガイド / spoke = 個別ガイド(hub に所属)。キーワード競合(カニバリゼーション)対策。
export const TOPIC_ROLES = ['hub', 'spoke'];
export const TAG_VOCABULARY_SET = new Set(tagVocabularyData.vocabulary.map((v) => v.tag));

export const TOPIC_ID_PATTERN = /^[a-z0-9-]{1,60}$/;
// ブランチ名 auto/guide-<id> と auto/guide-topics-* / auto/guide-refresh-* を区別するため、id の先頭に使えない語。
export const RESERVED_ID_PREFIXES = ['topics-', 'refresh-'];
export const GUIDE_BRANCH_PREFIX = 'auto/guide-';
export const TOPICS_BRANCH_PREFIX = 'auto/guide-topics-';
export const REFRESH_BRANCH_PREFIX = 'auto/guide-refresh-';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

export function isHttpUrl(v) {
  if (!isNonEmptyString(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidYmd(v) {
  if (typeof v !== 'string' || !YMD.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * キーワード比較用の正規化: 前後空白除去・連続空白を1つ・全角空白→半角・小文字化。
 * primaryKeyword の一意性・keywords との衝突判定に使う(週次提案の重複判定でも共用)。
 */
export function normalizeKeyword(s) {
  return String(s ?? '').normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------- 読み込み

export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf-8'));
}

export async function loadOfficialSources(filePath = OFFICIAL_SOURCES_PATH) {
  return readJsonFile(filePath);
}

export async function loadGuideTopics(filePath = GUIDE_TOPICS_PATH) {
  return readJsonFile(filePath);
}

/** スナップショットファイルを読む。無ければ空オブジェクト。 */
export async function loadSnapshots(filePath) {
  try {
    const data = JSON.parse(await readFile(filePath, 'utf-8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/** キーをソートして安定した差分にする(1URL = 1ブロック)。 */
export function serializeSnapshots(snapshots) {
  const sorted = {};
  for (const k of Object.keys(snapshots).sort()) sorted[k] = snapshots[k];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** src/content/articles 直下の *.md のファイル名(拡張子なし)集合 = 記事id集合 */
export async function listArticleIds(dir = ARTICLES_DIR) {
  try {
    const files = await readdir(dir);
    return new Set(files.filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')));
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------- 検証

/** official-sources.json の検証。問題点の文字列配列を返す(空 = 合格)。 */
export function validateOfficialSources(data) {
  const problems = [];
  if (!data || typeof data !== 'object') return ['ルートがオブジェクトではありません'];
  if (data.version !== 1) problems.push(`version が 1 ではありません (${data.version})`);
  if (!data.themes || typeof data.themes !== 'object' || Array.isArray(data.themes)) {
    problems.push('themes がオブジェクトではありません');
    return problems;
  }
  const keys = Object.keys(data.themes);
  if (keys.length === 0) problems.push('themes が空です');
  for (const key of keys) {
    const theme = data.themes[key];
    const where = `themes.${key}`;
    if (!isNonEmptyString(theme?.label)) problems.push(`${where}.label が空`);
    if (!Array.isArray(theme?.sources) || theme.sources.length === 0) {
      problems.push(`${where}.sources が空または配列ではありません`);
      continue;
    }
    theme.sources.forEach((s, i) => {
      const w = `${where}.sources[${i}]`;
      if (!isNonEmptyString(s?.title)) problems.push(`${w}.title が空`);
      if (!isHttpUrl(s?.url)) problems.push(`${w}.url が不正 (${s?.url})`);
      if (!isNonEmptyString(s?.publisher)) problems.push(`${w}.publisher が空`);
      if (!isNonEmptyString(s?.lang)) problems.push(`${w}.lang が空`);
    });
  }
  return problems;
}

/**
 * guide-topics.json の検証。問題点の文字列配列を返す(空 = 合格)。
 * @param {object} data 台帳
 * @param {{sourceThemeKeys?: Set<string>|string[], vocabulary?: Set<string>}} [ctx]
 */
export function validateGuideTopics(data, { sourceThemeKeys = new Set(), vocabulary = TAG_VOCABULARY_SET } = {}) {
  const problems = [];
  const themeKeys = sourceThemeKeys instanceof Set ? sourceThemeKeys : new Set(sourceThemeKeys);
  if (!data || typeof data !== 'object') return ['ルートがオブジェクトではありません'];
  if (data.version !== 1) problems.push(`version が 1 ではありません (${data.version})`);
  if (!Array.isArray(data.topics)) {
    problems.push('topics が配列ではありません');
    return problems;
  }
  const seen = new Set();
  data.topics.forEach((t, i) => {
    const label = `topics[${i}](${t?.id})`;
    if (typeof t?.id !== 'string' || !TOPIC_ID_PATTERN.test(t.id)) {
      problems.push(`${label}: id が ^[a-z0-9-]{1,60}$ に合いません`);
    } else {
      if (seen.has(t.id)) problems.push(`${label}: id が重複しています`);
      seen.add(t.id);
      if (RESERVED_ID_PREFIXES.some((p) => t.id.startsWith(p))) {
        problems.push(`${label}: id は ${RESERVED_ID_PREFIXES.join(' / ')} で始められません(ブランチ名と衝突するため)`);
      }
    }
    if (!isNonEmptyString(t?.title)) problems.push(`${label}: title が空`);
    if (!isNonEmptyString(t?.primaryKeyword)) problems.push(`${label}: primaryKeyword が空(このトピックが主に狙う検索語が必要)`);
    if (!TOPIC_ROLES.includes(t?.role)) problems.push(`${label}: role が不正 (${t?.role}。${TOPIC_ROLES.join('/')} のみ)`);
    if (t?.holdReason !== undefined && !isNonEmptyString(t.holdReason)) problems.push(`${label}: holdReason は空でない文字列にしてください`);
    if (!Array.isArray(t?.audience) || t.audience.length === 0 || !t.audience.every((a) => AUDIENCES.includes(a))) {
      problems.push(`${label}: audience が不正(${AUDIENCES.join('/')} のみ、1つ以上)`);
    }
    if (!ARTICLE_CATEGORIES.includes(t?.category)) problems.push(`${label}: category が不正 (${t?.category})`);
    if (!Array.isArray(t?.tags) || t.tags.length === 0) {
      problems.push(`${label}: tags が空`);
    } else {
      for (const tag of t.tags) {
        if (!vocabulary.has(tag)) problems.push(`${label}: tags に語彙外のタグ "${tag}"`);
      }
    }
    if (typeof t?.ymyl !== 'boolean') problems.push(`${label}: ymyl が boolean ではありません`);
    for (const key of ['keywords', 'outline']) {
      if (!Array.isArray(t?.[key]) || !t[key].every(isNonEmptyString)) problems.push(`${label}: ${key} が文字列配列ではありません`);
    }
    if (!Array.isArray(t?.sourceThemes) || !t.sourceThemes.every(isNonEmptyString)) {
      problems.push(`${label}: sourceThemes が文字列配列ではありません`);
    } else {
      for (const k of t.sourceThemes) {
        if (!themeKeys.has(k)) problems.push(`${label}: sourceThemes "${k}" が official-sources.json にありません`);
      }
    }
    if (!Array.isArray(t?.extraReferences)) {
      problems.push(`${label}: extraReferences が配列ではありません`);
    } else {
      t.extraReferences.forEach((r, j) => {
        if (!isNonEmptyString(r?.title) || !isHttpUrl(r?.url)) problems.push(`${label}: extraReferences[${j}] は {title,url} が必要`);
      });
    }
    if (!Array.isArray(t?.affiliate) || !t.affiliate.every(isNonEmptyString)) problems.push(`${label}: affiliate が文字列配列ではありません`);
    if (!Number.isInteger(t?.priority) || t.priority < 1 || t.priority > 5) problems.push(`${label}: priority が 1〜5 の整数ではありません`);
    if (!TOPIC_STATUSES.includes(t?.status)) problems.push(`${label}: status が不正 (${t?.status})`);
    if (!isValidYmd(t?.addedAt)) problems.push(`${label}: addedAt が YYYY-MM-DD ではありません (${t?.addedAt})`);
    // queued なのに参照できる出典が1つも無いトピックは生成できない。
    if (t?.status === 'queued') {
      const hasThemes = Array.isArray(t.sourceThemes) && t.sourceThemes.length > 0;
      const hasExtra = Array.isArray(t.extraReferences) && t.extraReferences.length > 0;
      if (!hasThemes && !hasExtra) problems.push(`${label}: queued だが sourceThemes / extraReferences が両方空(生成できません)`);
    }
  });

  // --- キーワード設計(hub/spoke・primaryKeyword一意・keywords との衝突)
  const byId = new Map(data.topics.filter((t) => typeof t?.id === 'string').map((t) => [t.id, t]));
  const primaryOwner = new Map(); // 正規化した primaryKeyword → 最初の topic id
  data.topics.forEach((t, i) => {
    const label = `topics[${i}](${t?.id})`;
    if (isNonEmptyString(t?.primaryKeyword)) {
      const key = normalizeKeyword(t.primaryKeyword);
      if (primaryOwner.has(key)) problems.push(`${label}: primaryKeyword "${t.primaryKeyword}" が ${primaryOwner.get(key)} と重複しています(台帳全体で一意)`);
      else primaryOwner.set(key, t.id);
    }
    if (t?.role === 'hub') {
      if (t.hub !== undefined) problems.push(`${label}: role が hub のトピックに hub は指定できません`);
    } else if (t?.role === 'spoke') {
      if (!isNonEmptyString(t.hub)) problems.push(`${label}: role が spoke のトピックには hub(所属 hub の id)が必要です`);
      else if (t.hub === t.id) problems.push(`${label}: hub に自分自身は指定できません`);
      else if (!byId.has(t.hub)) problems.push(`${label}: hub "${t.hub}" が台帳にありません`);
      else if (byId.get(t.hub).role !== 'hub') problems.push(`${label}: hub "${t.hub}" の role が hub ではありません`);
    }
  });
  data.topics.forEach((t, i) => {
    const label = `topics[${i}](${t?.id})`;
    if (!Array.isArray(t?.keywords)) return;
    for (const kw of t.keywords) {
      if (!isNonEmptyString(kw)) continue;
      const owner = primaryOwner.get(normalizeKeyword(kw));
      if (owner !== undefined && owner !== t.id) problems.push(`${label}: keywords の "${kw}" が ${owner} の primaryKeyword と同一です(競合)`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------- 参照URL

/** URL比較用の正規化(ハッシュ除去・末尾スラッシュ除去・ホスト小文字化)。不正URLはそのまま返す。 */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    if (u.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return String(url);
  }
}

/**
 * トピック → 参照URL一覧(sourceThemes の sources + extraReferences)。URLは重複排除(正規化キー)。
 * 存在しないテーマキーは無視する(検証は validateGuideTopics 側で行う)。
 * @returns {{title:string, url:string, publisher?:string, lang?:string}[]}
 */
export function resolveTopicReferences(topic, officialSources) {
  const refs = [];
  const seen = new Set();
  const add = (r) => {
    if (!isHttpUrl(r?.url)) return;
    const key = normalizeUrl(r.url);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ title: r.title || r.url, url: r.url, ...(r.publisher ? { publisher: r.publisher } : {}), ...(r.lang ? { lang: r.lang } : {}) });
  };
  for (const key of topic.sourceThemes || []) {
    for (const s of officialSources?.themes?.[key]?.sources || []) add(s);
  }
  for (const r of topic.extraReferences || []) add(r);
  return refs;
}

// ---------------------------------------------------------------- 次トピックの選択

/**
 * 次に生成するトピックを選ぶ純粋関数。
 * 条件: status=queued / 記事ファイル未作成 / オープンPRに同じ記事が無い / 却下済み(クローズ済み未merge PR)でない。
 * 並び: priority 昇順 → addedAt 昇順 → id 昇順(決定的にするため)。
 */
export function listCandidateTopics({ topics, existingArticleIds = new Set(), openPrArticleIds = new Set(), rejectedTopicIds = new Set() }) {
  const candidates = (topics || []).filter(
    (t) =>
      t.status === 'queued' &&
      !existingArticleIds.has(t.id) &&
      !openPrArticleIds.has(t.id) &&
      !rejectedTopicIds.has(t.id)
  );
  candidates.sort((a, b) => a.priority - b.priority || String(a.addedAt).localeCompare(String(b.addedAt)) || a.id.localeCompare(b.id));
  return candidates;
}

/** 次に生成するトピック(listCandidateTopics の先頭)。無ければ null。 */
export function selectNextTopic(params) {
  return listCandidateTopics(params)[0] ?? null;
}

// ---------------------------------------------------------------- GitHub 照会

const GITHUB_API_BASE = 'https://api.github.com';

async function githubGet(apiPath, { token, fetchImpl = fetch }) {
  const res = await fetchImpl(`${GITHUB_API_BASE}${apiPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'donesia-navi-guide-pipeline',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${apiPath} error ${res.status}: ${await res.text()}`);
  return res.json();
}

/** ブランチ名 auto/guide-<id> から id を取り出す。topics/refresh ブランチや無関係なブランチは null。 */
export function topicIdFromBranch(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(GUIDE_BRANCH_PREFIX)) return null;
  if (ref.startsWith(TOPICS_BRANCH_PREFIX) || ref.startsWith(REFRESH_BRANCH_PREFIX)) return null;
  const id = ref.slice(GUIDE_BRANCH_PREFIX.length);
  return TOPIC_ID_PATTERN.test(id) ? id : null;
}

/**
 * オープンPR由来の情報を集める。
 *  - openPrArticleIds: PRが追加/変更する src/content/articles/<id>.md の id 集合 + ブランチ名 auto/guide-<id> 由来の id
 *  - openTopicsPrs: ブランチ auto/guide-topics-* のオープンPR(番号・ブランチ)
 * token / repo が無ければ何もせず空を返す(ローカル実行時)。API失敗は例外を投げる(呼び出し側で判断)。
 */
export async function fetchOpenGuidePrState({ token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY, fetchImpl = fetch } = {}) {
  const openPrArticleIds = new Set();
  const openTopicsPrs = [];
  if (!token || !repo) return { openPrArticleIds, openTopicsPrs, skipped: true };

  const prs = await githubGet(`/repos/${repo}/pulls?state=open&per_page=100`, { token, fetchImpl });
  if (!Array.isArray(prs)) throw new Error('オープンPR一覧のレスポンス形式が想定外です(配列ではありません)');

  for (const pr of prs) {
    const ref = pr?.head?.ref;
    if (typeof ref === 'string' && ref.startsWith(TOPICS_BRANCH_PREFIX)) openTopicsPrs.push({ number: pr.number, branch: ref });
    const idFromBranch = topicIdFromBranch(ref);
    if (idFromBranch) openPrArticleIds.add(idFromBranch);

    const files = await githubGet(`/repos/${repo}/pulls/${pr.number}/files?per_page=100`, { token, fetchImpl });
    if (!Array.isArray(files)) throw new Error(`PR #${pr.number} のファイル一覧が想定外の形式です`);
    for (const f of files) {
      const m = /^src\/content\/articles\/([^/]+)\.md$/.exec(f?.filename || '');
      if (m) openPrArticleIds.add(m[1]);
    }
  }
  return { openPrArticleIds, openTopicsPrs, skipped: false };
}

/**
 * 却下済みトピック(= ブランチ auto/guide-<id> のクローズ済み未mergeのPR)の id 集合。
 * オーナーがPRをcloseしたトピックは再生成しない、という運用のための照会。
 * 直近 maxPages*100 件のクローズ済みPRを新しい順に見る。
 */
export async function fetchRejectedTopicIds({ token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY, fetchImpl = fetch, maxPages = 5 } = {}) {
  const rejected = new Set();
  if (!token || !repo) return rejected;
  for (let page = 1; page <= maxPages; page += 1) {
    const prs = await githubGet(`/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`, { token, fetchImpl });
    if (!Array.isArray(prs)) throw new Error('クローズ済みPR一覧のレスポンス形式が想定外です(配列ではありません)');
    for (const pr of prs) {
      if (pr?.merged_at) continue;
      const id = topicIdFromBranch(pr?.head?.ref);
      if (id) rejected.add(id);
    }
    if (prs.length < 100) break;
  }
  return rejected;
}
