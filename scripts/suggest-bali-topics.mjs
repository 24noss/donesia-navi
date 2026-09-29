// バリ向けガイド記事の週次トピック提案。
//
// バリ関連シード語のGoogleサジェストとSearch Console(GSC)の「バリ|bali」クエリを集め、台帳・既存記事でカバー済みのものを除き、
// Geminiで最大7件のトピック案(台帳スキーマ)に整形して src/data/guide-topics.json に追記する。
// 追記した変更はワークフロー(suggest-bali-topics.yml)がPRにし、Slackの承認ボタンでmergeされると台帳に反映される。
// 詳細は docs/guide-pipeline.md を参照。
//
//   node scripts/suggest-bali-topics.mjs               # 本番(Gemini・サジェスト・GSC・GitHub照会を実行し台帳を更新)
//   node scripts/suggest-bali-topics.mjs --dry-run     # フィクスチャで最後まで通す(外部呼び出しなし、書き出しは一時ディレクトリ)

import { mkdir, mkdtemp, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { callGeminiApi, filterTagsByVocabulary, isDryRun, parseGeminiArticlesResponse, TAG_VOCABULARY } from './crawl-and-draft.mjs';
import { fetchGoogleSuggestions } from './lib/google-suggest.mjs';
import { getGscData } from './lib/gsc.mjs';
import {
  ARTICLE_CATEGORIES,
  AUDIENCES,
  GUIDE_TOPICS_PATH,
  OFFICIAL_SOURCES_PATH,
  RESERVED_ID_PREFIXES,
  TOPIC_ID_PATTERN,
  fetchOpenGuidePrState,
  listArticleIds,
  loadGuideTopics,
  loadOfficialSources,
  readJsonFile,
  validateGuideTopics,
  validateOfficialSources,
  ARTICLES_DIR,
} from './lib/guide-topics.mjs';
import { extractGeminiText } from './lib/guide-article.mjs';
import { YMYL_CATEGORIES } from '../src/lib/ymyl.mjs';

export const BALI_SEEDS = [
  'バリ 入国', 'バリ 観光税', 'バリ ビザ', 'バリ 移住', 'バリ 治安', 'バリ 病院', 'バリ 両替', 'バリ 空港', 'バリ 雨季',
  'バリ 服装', 'バリ 寺院', 'バリ バイク', 'バリ 長期滞在', 'バリ eSIM', 'バリ 持ち込み', 'バリ 保険', 'バリ タクシー', 'バリ チップ',
];
export const MAX_PROPOSALS = 7;
const BALI_RE = /バリ|bali/i;
const FIXTURES_DIR = path.join(process.cwd(), 'scripts/fixtures/guide');

// ---------------------------------------------------------------- 候補の収集とカバー判定(純関数)

/** 比較用の正規化: 小文字化・空白除去・「バリ島」→「バリ」。 */
export function normalizePhrase(s) {
  return String(s).toLowerCase().replace(/[\s　]+/g, '').replace(/バリ島/g, 'バリ');
}

/**
 * 語句が台帳(keywords/title)または既存記事タイトルでカバー済みか。
 * 双方向の部分一致で判定する(「バリ 入国 ビザ」は keyword「バリ 入国」に含まれる → カバー済み)。
 * 短すぎる語(3文字未満)の一致は誤爆しやすいため無視する。
 */
export function isPhraseCovered(phrase, { topics = [], articleTitles = [] }) {
  const p = normalizePhrase(phrase);
  if (p.length === 0) return true;
  const hit = (target) => {
    const t = normalizePhrase(target);
    if (t.length < 3) return false;
    return p.includes(t) || (p.length >= 3 && t.includes(p));
  };
  for (const topic of topics) {
    if (hit(topic.title || '')) return true;
    for (const kw of topic.keywords || []) if (hit(kw)) return true;
  }
  return articleTitles.some((title) => normalizePhrase(title).includes(p));
}

/**
 * サジェストとGSCの結果から、未カバーの候補だけを残す。
 * @param {{seed:string, suggestions:string[]}[]} seedSuggestions
 * @param {object[]|null} gscRows GSC生行(keys[0]=クエリ)
 * @returns {{suggestGroups:{seed:string, phrases:string[]}[], gscQueries:{query:string, impressions:number, clicks:number}[]}}
 */
export function collectUncoveredCandidates({ seedSuggestions, gscRows, topics, articleTitles }) {
  const ctx = { topics, articleTitles };
  const suggestGroups = [];
  const seen = new Set();
  for (const { seed, suggestions } of seedSuggestions) {
    const phrases = [];
    for (const s of suggestions || []) {
      const key = normalizePhrase(s);
      if (seen.has(key) || key === normalizePhrase(seed) || !BALI_RE.test(s)) continue;
      seen.add(key);
      if (!isPhraseCovered(s, ctx)) phrases.push(s);
    }
    if (phrases.length) suggestGroups.push({ seed, phrases });
  }
  const gscQueries = [];
  for (const row of gscRows || []) {
    const query = row?.keys?.[0] || '';
    if (!BALI_RE.test(query)) continue;
    if (isPhraseCovered(query, ctx)) continue;
    gscQueries.push({ query, impressions: row.impressions || 0, clicks: row.clicks || 0 });
  }
  gscQueries.sort((a, b) => b.impressions - a.impressions);
  return { suggestGroups, gscQueries: gscQueries.slice(0, 40) };
}

// ---------------------------------------------------------------- Gemini

export const TOPICS_RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      title: { type: 'STRING' },
      audience: { type: 'ARRAY', items: { type: 'STRING', enum: AUDIENCES } },
      category: { type: 'STRING', enum: ARTICLE_CATEGORIES },
      tags: { type: 'ARRAY', items: { type: 'STRING' } },
      ymyl: { type: 'BOOLEAN' },
      keywords: { type: 'ARRAY', items: { type: 'STRING' } },
      outline: { type: 'ARRAY', items: { type: 'STRING' } },
      sourceThemes: { type: 'ARRAY', items: { type: 'STRING' } },
      priority: { type: 'INTEGER' },
      evidenceQueries: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['id', 'title', 'audience', 'category', 'tags', 'ymyl', 'keywords', 'outline', 'sourceThemes', 'priority', 'evidenceQueries'],
    propertyOrdering: ['id', 'title', 'audience', 'category', 'tags', 'ymyl', 'keywords', 'outline', 'sourceThemes', 'priority', 'evidenceQueries'],
  },
};

export function buildTopicsPrompt({ suggestGroups, gscQueries, existingTopics, themes, max = MAX_PROPOSALS }) {
  const themeLines = Object.entries(themes).map(([k, v]) => `- ${k}: ${v.label}`).join('\n');
  return `あなたはドネシアナビ(インドネシア関連の日本語情報メディア)の編集者です。バリ島に関するエバーグリーンなガイド記事の「トピック案」を、検索需要のデータから最大${max}件作ってください。

# 方針
- 読者は、バリ旅行を計画中の観光客 / 移住・長期滞在を検討中の人 / 現地在住者。実際に検索されている語(下の「検索サジェスト」「GSC実クエリ」)に答える、実用的なガイドになるトピックを選ぶ。
- 需要の根拠が弱いもの、既存トピックと実質的に重複するものは選ばない。0件でもよい。
- 1トピックは1つの検索意図に絞る。広すぎる(「バリ島ガイド」など)・時事ニュース性が高いものは避ける。
- sourceThemes は、下の「利用可能な出典テーマ」のキーの中から、そのトピックを公的機関・一次情報で裏づけられるものだけを選ぶ。該当するテーマが無ければ空配列にする(その場合は保留扱いになる)。テーマのキーを新しく作らないこと。
- tags は次の統制語彙から2〜5個(語彙外は不可): ${TAG_VOCABULARY.join(', ')}
- category は ${ARTICLE_CATEGORIES.join(' / ')} のいずれか(ビザ・入国は visa、治安・医療・災害は safety、法令・規則は regulation、旅行は travel、生活情報は lifestyle)。
- ymyl は、健康・金銭・安全・法的手続きに関わる内容なら true。
- id は英小文字・数字・ハイフンのみ、60字以内、"bali-" で始める(例: bali-entry-checklist)。
- priority は 1(最優先)〜5。需要が強く公的出典が揃うものを小さい数字にする。
- evidenceQueries には、根拠にした「検索サジェスト」「GSC実クエリ」の語句を、下に示した表記のまま1〜5個入れる(創作しない)。
- keywords は記事が狙う検索語(2〜5個)、outline は見出し案(3〜7個)。

# 既存トピック(重複させない)
${existingTopics.map((t) => `- ${t.id}: ${t.title} [${(t.keywords || []).join(', ')}]`).join('\n') || '(なし)'}

# 利用可能な出典テーマ
${themeLines}

# 検索サジェスト(シード語ごと。未カバーのもののみ)
${suggestGroups.map((g) => `- ${g.seed}: ${g.phrases.join(' / ')}`).join('\n') || '(なし)'}

# GSC実クエリ(バリ関連。未カバーのもののみ、表示回数順)
${gscQueries.map((q) => `- ${q.query} (表示${q.impressions}回/クリック${q.clicks}回)`).join('\n') || '(GSC未連携または該当なし)'}

出力はトピック案オブジェクトの配列のみ。`;
}

// ---------------------------------------------------------------- 整形・検証

function sanitizeId(raw) {
  let id = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  if (RESERVED_ID_PREFIXES.some((p) => id.startsWith(p))) id = `bali-${id}`.slice(0, 60);
  return TOPIC_ID_PATTERN.test(id) ? id : null;
}

function strList(v, max) {
  return (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, max);
}

/**
 * Geminiの提案をコードで再検証し、台帳エントリに整形する。
 *  - id は再正規化し、台帳・既存記事・今回分と重複したら除外
 *  - tags は統制語彙でフィルタ(+「バリ島」タグを補う)
 *  - sourceThemes は official-sources.json に存在するキーのみ。空になったら status:"on-hold"
 *  - extraReferences / affiliate は常に空(モデルにURLを創作させない。オーナーが後から足す)
 *  - 根拠(evidence)は、実際に収集した語句と一致するものだけを採用する
 * @returns {{added: object[], skipped: {id:string, reason:string}[], evidence: Record<string, {suggest:string[], gsc:object[]}>, holdReasons: Record<string,string>}}
 */
export function normalizeProposals({ raw, ledgerTopics, themeKeys, existingArticleIds, suggestGroups, gscQueries, today, max = MAX_PROPOSALS }) {
  const added = [];
  const skipped = [];
  const evidence = {};
  const holdReasons = {};
  const usedIds = new Set([...ledgerTopics.map((t) => t.id), ...existingArticleIds]);
  const existingKw = new Set(ledgerTopics.flatMap((t) => (t.keywords || []).map(normalizePhrase)));
  const existingTitles = new Set(ledgerTopics.map((t) => normalizePhrase(t.title)));
  const suggestSet = new Map(suggestGroups.flatMap((g) => g.phrases.map((p) => [normalizePhrase(p), p])));
  const gscMap = new Map(gscQueries.map((q) => [normalizePhrase(q.query), q]));

  for (const r of Array.isArray(raw) ? raw : []) {
    if (added.length >= max) break;
    const id = sanitizeId(r?.id);
    if (!id) {
      skipped.push({ id: String(r?.id), reason: 'id が不正' });
      continue;
    }
    if (usedIds.has(id)) {
      skipped.push({ id, reason: 'id が台帳・既存記事・今回の提案と重複' });
      continue;
    }
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!title) {
      skipped.push({ id, reason: 'title が空' });
      continue;
    }
    const keywords = strList(r.keywords, 8);
    if (existingTitles.has(normalizePhrase(title)) || keywords.some((k) => existingKw.has(normalizePhrase(k)))) {
      skipped.push({ id, reason: '既存トピックとタイトルまたはキーワードが重複' });
      continue;
    }

    const category = ARTICLE_CATEGORIES.includes(r.category) ? r.category : 'travel';
    let tags = filterTagsByVocabulary(r.tags, category);
    if (TAG_VOCABULARY.includes('バリ島') && !tags.includes('バリ島')) tags = ['バリ島', ...tags].slice(0, 5);
    const audience = strList(r.audience, 3).filter((a) => AUDIENCES.includes(a));
    const sourceThemes = strList(r.sourceThemes, 6).filter((k) => themeKeys.has(k));
    const priority = Number.isInteger(r.priority) ? Math.min(5, Math.max(1, r.priority)) : 3;

    const ev = { suggest: [], gsc: [] };
    for (const qStr of strList(r.evidenceQueries, 10)) {
      const key = normalizePhrase(qStr);
      if (suggestSet.has(key) && !ev.suggest.includes(suggestSet.get(key))) ev.suggest.push(suggestSet.get(key));
      if (gscMap.has(key) && !ev.gsc.includes(gscMap.get(key))) ev.gsc.push(gscMap.get(key));
    }

    const status = sourceThemes.length > 0 ? 'queued' : 'on-hold';
    if (status === 'on-hold') holdReasons[id] = '該当する出典テーマが official-sources.json に無い(公的・一次情報の出典を追加してから queued にする)';

    usedIds.add(id);
    evidence[id] = ev;
    added.push({
      id,
      title,
      audience: audience.length ? audience : ['tourist'],
      category,
      tags,
      ymyl: r.ymyl === true || YMYL_CATEGORIES.includes(category),
      keywords,
      outline: strList(r.outline, 8),
      sourceThemes,
      extraReferences: [],
      affiliate: [],
      priority,
      status,
      addedAt: today,
    });
  }
  return { added, skipped, evidence, holdReasons };
}

/** 台帳に追記した新しい台帳オブジェクトを返す(元は変更しない)。 */
export function appendTopics(ledger, newTopics) {
  return { ...ledger, topics: [...ledger.topics, ...newTopics] };
}

export function serializeLedger(ledger) {
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

/** PR本文(Markdown)。 */
export function buildPrBody({ added, evidence, holdReasons, skipped, today, gscUsed }) {
  const lines = [
    `バリ向けガイド記事のトピック提案です(${today})。マージすると \`src/data/guide-topics.json\` に追加され、\`status: "queued"\` のトピックは毎日の生成ワークフローが priority 順に1本ずつ下書き記事にします。`,
    '',
    '- 不要な案は、ファイル上で該当エントリを削除してからマージするか、このPRをcloseしてください。',
    '- `status: "on-hold"` の案は、出典テーマが無いため保留です。`official-sources.json` に公的・一次情報を追加してから `queued` に変更してください。',
    `- 根拠データ: Googleサジェスト${gscUsed ? ' + Search Console' : '(Search Consoleは未連携またはスキップ)'}`,
    '',
    `## 提案 ${added.length}件`,
    '',
  ];
  for (const t of added) {
    const ev = evidence[t.id] || { suggest: [], gsc: [] };
    lines.push(`### ${t.title} (\`${t.id}\`) — ${t.status}`);
    lines.push(`- keywords: ${t.keywords.join(', ') || '(なし)'}`);
    lines.push(`- category: ${t.category} / ymyl: ${t.ymyl} / priority: ${t.priority} / audience: ${t.audience.join(', ')}`);
    lines.push(`- sourceThemes: ${t.sourceThemes.join(', ') || '(なし)'}`);
    lines.push(`- 根拠(サジェスト): ${ev.suggest.join(' / ') || '(なし)'}`);
    lines.push(`- 根拠(GSC): ${ev.gsc.map((g) => `${g.query}(表示${g.impressions}回/クリック${g.clicks}回)`).join(' / ') || '(なし)'}`);
    if (holdReasons[t.id]) lines.push(`- 保留の理由: ${holdReasons[t.id]}`);
    lines.push('');
  }
  if (skipped.length) {
    lines.push('## 除外した案', '');
    for (const s of skipped) lines.push(`- \`${s.id}\`: ${s.reason}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 実行本体

export function parseSuggestArgs(argv = []) {
  const get = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  return { dryRun: isDryRun(argv), outDir: get('out-dir'), fixturesDir: get('fixtures-dir'), topicsPath: get('topics'), sourcesPath: get('sources') };
}

/**
 * @returns {Promise<{status:'none'|'skipped'|'proposed', reason?:string, added?:object[], prBody?:string, ledgerPath?:string}>}
 */
export async function runSuggest({ args, deps = {} }) {
  const {
    fetchSuggestions = fetchGoogleSuggestions,
    getGsc = () => getGscData({ serviceAccountKeyJson: process.env.GSC_SERVICE_ACCOUNT_KEY, siteUrl: process.env.GSC_SITE_URL || undefined }),
    callGemini = (prompt) => callGeminiApi(prompt, { responseSchema: TOPICS_RESPONSE_SCHEMA }),
    openPrState = fetchOpenGuidePrState,
    now = new Date(),
    log = console,
    articleTitles: articleTitlesOverride,
    existingArticleIdsOverride,
  } = deps;
  const today = now.toISOString().slice(0, 10);

  const sourcesData = await loadOfficialSources(args.sourcesPath || OFFICIAL_SOURCES_PATH);
  const sp = validateOfficialSources(sourcesData);
  if (sp.length) throw new Error(`official-sources.json が不正です:\n- ${sp.join('\n- ')}`);
  const themeKeys = new Set(Object.keys(sourcesData.themes));
  const ledgerPath = args.topicsPath || GUIDE_TOPICS_PATH;
  const ledger = await loadGuideTopics(ledgerPath);
  const lp = validateGuideTopics(ledger, { sourceThemeKeys: themeKeys });
  if (lp.length) throw new Error(`guide-topics.json が不正です:\n- ${lp.join('\n- ')}`);

  // 未処理のトピック提案PRがあれば今週は重複提案を避けてスキップする(ローカル実行では照会しない)。
  if (!args.dryRun) {
    const { openTopicsPrs } = await openPrState();
    if (openTopicsPrs.length > 0) {
      const reason = `未処理のトピック提案PRがあるためスキップ: ${openTopicsPrs.map((p) => `#${p.number}`).join(', ')}`;
      log.log(reason);
      return { status: 'skipped', reason };
    }
  }

  const existingArticleIds = existingArticleIdsOverride ?? (await listArticleIds(ARTICLES_DIR));
  const articleTitles = articleTitlesOverride ?? (await loadArticleTitles());

  // --- 需要データの収集
  const seedSuggestions = [];
  for (const seed of BALI_SEEDS) seedSuggestions.push({ seed, suggestions: await fetchSuggestions(seed) });
  const gscRows = await getGsc();
  const gscUsed = Array.isArray(gscRows);
  const { suggestGroups, gscQueries } = collectUncoveredCandidates({ seedSuggestions, gscRows, topics: ledger.topics, articleTitles });
  log.log(`未カバー候補: サジェスト ${suggestGroups.reduce((n, g) => n + g.phrases.length, 0)}語 / GSC ${gscQueries.length}クエリ`);
  if (suggestGroups.length === 0 && gscQueries.length === 0) {
    log.log('未カバーの候補がありません。PRは作りません。');
    return { status: 'none', reason: '未カバー候補なし' };
  }

  // --- Gemini
  const prompt = buildTopicsPrompt({ suggestGroups, gscQueries, existingTopics: ledger.topics, themes: sourcesData.themes });
  const data = await callGemini(prompt);
  const raw = parseGeminiArticlesResponse(extractGeminiText(data));
  const { added, skipped, evidence, holdReasons } = normalizeProposals({
    raw,
    ledgerTopics: ledger.topics,
    themeKeys,
    existingArticleIds,
    suggestGroups,
    gscQueries,
    today,
  });
  if (added.length === 0) {
    log.log('採用できる提案が0件でした。PRは作りません。');
    for (const s of skipped) log.log(`  除外: ${s.id} — ${s.reason}`);
    return { status: 'none', reason: '採用できる提案なし' };
  }

  const newLedger = appendTopics(ledger, added);
  const problems = validateGuideTopics(newLedger, { sourceThemeKeys: themeKeys });
  if (problems.length) throw new Error(`追記後の台帳が不正です(実装バグの可能性):\n- ${problems.join('\n- ')}`);

  const outLedgerPath = args.dryRun ? path.join(args.outDir, 'guide-topics.json') : ledgerPath;
  await mkdir(path.dirname(outLedgerPath), { recursive: true });
  await writeFile(outLedgerPath, serializeLedger(newLedger), 'utf-8');
  const prBody = buildPrBody({ added, evidence, holdReasons, skipped, today, gscUsed });
  return { status: 'proposed', added, prBody, ledgerPath: outLedgerPath, today };
}

async function loadArticleTitles() {
  const { readdir, readFile } = await import('node:fs/promises');
  const titles = [];
  try {
    for (const f of await readdir(ARTICLES_DIR)) {
      if (!f.endsWith('.md')) continue;
      const m = (await readFile(path.join(ARTICLES_DIR, f), 'utf-8')).match(/^title:\s*"?(.*?)"?\s*$/m);
      if (m?.[1]) titles.push(m[1]);
    }
  } catch {
    // 記事ディレクトリが無ければ空
  }
  return titles;
}

async function main() {
  const args = parseSuggestArgs(process.argv.slice(2));
  const deps = {};

  if (args.dryRun) {
    const fixturesDir = args.fixturesDir || FIXTURES_DIR;
    const fx = await readJsonFile(path.join(fixturesDir, 'suggest-fixture.json'));
    const geminiResponse = await readJsonFile(path.join(fixturesDir, 'gemini-topics-response.json'));
    Object.assign(deps, {
      fetchSuggestions: async (seed) => fx.suggestions[seed] || [],
      getGsc: async () => fx.gscRows,
      callGemini: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiResponse) }] } }] }),
      articleTitles: fx.articleTitles || [],
      existingArticleIdsOverride: new Set(),
    });
    args.topicsPath ||= path.join(fixturesDir, 'guide-topics.json');
    args.sourcesPath ||= path.join(fixturesDir, 'official-sources.json');
    args.outDir ||= await mkdtemp(path.join(os.tmpdir(), 'guide-topics-dry-run-'));
    console.log(`--dry-run: 外部呼び出しを行いません。出力先: ${args.outDir}`);
  } else if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY が未設定です。');
    process.exit(1);
  }

  const result = await runSuggest({ args, deps });
  const out = process.env.GITHUB_OUTPUT && !args.dryRun ? process.env.GITHUB_OUTPUT : null;

  if (result.status !== 'proposed') {
    if (out) await appendFile(out, 'count=0\n');
    return;
  }

  const bodyDir = args.dryRun ? args.outDir : process.env.RUNNER_TEMP || os.tmpdir();
  const bodyPath = path.join(bodyDir, 'guide-topics-pr-body.md');
  await writeFile(bodyPath, result.prBody, 'utf-8');
  console.log(`提案 ${result.added.length}件を ${result.ledgerPath} に追記しました。PR本文: ${bodyPath}`);
  if (args.dryRun) console.log(`--- PR本文 ---\n${result.prBody}`);
  if (out) {
    await appendFile(out, `count=${result.added.length}\ndate=${result.today.replace(/-/g, '')}\nbody_path=${bodyPath}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
