// バリ向けエバーグリーン「ガイド記事」の日次生成。
//
// 台帳(src/data/guide-topics.json)から次のトピックを1件選び、台帳・出典一覧(official-sources.json)に登録された
// 公的機関・一次情報のページ本文を取得し、その資料だけを根拠に Gemini で記事を書かせて draft:true の Markdown を出力する。
// 詳細な仕様・運用は docs/guide-pipeline.md を参照。
//
// 使い方:
//   npm run generate-guide                       # 次のトピックを1件生成
//   GUIDE_TOPIC_ID=bali-entry-checklist npm run generate-guide   # トピック指定(--topic=<id> でも可)
//   npm run generate-guide -- --dry-run          # Gemini・出典取得・GitHub照会をせず、フィクスチャで最後まで通す
//   GUIDE_TOPIC_ID=<id> npm run generate-guide -- --replace   # 公開済みガイドの作り直し(--replace または GUIDE_REPLACE=1。topic 明示指定が必須)
//     --out-dir=<dir>      記事の書き出し先(dry-run の既定は一時ディレクトリ)
//     --fixtures-dir=<dir> dry-run のフィクスチャ(既定 scripts/fixtures/guide)

import { mkdir, mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { callGeminiApi, filterTagsByVocabulary, isDryRun } from './crawl-and-draft.mjs';
import {
  ARTICLES_DIR,
  GUIDE_TOPICS_PATH,
  OFFICIAL_SOURCES_PATH,
  snapshotFilePath,
  TOPIC_ID_PATTERN,
  fetchOpenGuidePrState,
  fetchRejectedTopicIds,
  listArticleIds,
  loadGuideTopics,
  loadOfficialSources,
  normalizeUrl,
  readJsonFile,
  resolveTopicReferences,
  listCandidateTopics,
  serializeSnapshots,
  validateGuideTopics,
  validateOfficialSources,
} from './lib/guide-topics.mjs';
import { applyTotalBudget, fetchSources } from './lib/guide-fetch.mjs';
import {
  GUIDE_RESPONSE_SCHEMA,
  buildGuideMarkdown,
  buildGuidePrompt,
  extractGeminiText,
  extractUrlsFromTexts,
  formatRemovedUrlReport,
  formatReplacedHeadingReport,
  parseArticleFile,
  parseGeminiObject,
  validateFrontmatterShape,
  validateGuideOutput,
} from './lib/guide-article.mjs';

// 自動選択時に、トピック固有の失敗があったとき次の候補へ進む最大試行数。
export const MAX_TOPIC_ATTEMPTS = 3;

/** トピック固有の失敗(出典本文0件・検証失敗など)。自動選択時は次の候補へ進む対象。 */
export class TopicSkipError extends Error {}

const DEFAULT_FIXTURES_DIR = path.join(process.cwd(), 'scripts/fixtures/guide');

/** CLI引数・環境変数の解釈(純関数)。 */
export function parseGenerateArgs(argv = [], env = {}) {
  const get = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  return {
    dryRun: isDryRun(argv),
    topicId: get('topic') || env.GUIDE_TOPIC_ID || null,
    replace: argv.includes('--replace') || ['1', 'true'].includes(String(env.GUIDE_REPLACE ?? '')),
    outDir: get('out-dir'),
    fixturesDir: get('fixtures-dir'),
    topicsPath: get('topics'),
    sourcesPath: get('sources'),
    snapshotsDir: get('snapshots-dir'),
  };
}

export function todayYmd(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** 取得に失敗した出典を含む、「本文の取れたソースが0件」エラーのメッセージ。 */
export function noSourceMessage(topicId, failed) {
  return [`トピック ${topicId} は本文の取れた出典が0件のため生成しません。`, ...failed.map((f) => `  - ${f.url}: ${f.reason}`)].join('\n');
}

/**
 * 生成本体。ネットワーク・Gemini・GitHub は deps で差し替え可能(テスト・dry-run 用)。
 * @returns {Promise<{status:'none'} | {status:'generated', topic, filePath, markdown, usedSourceUrls, warnings:string[]}>}
 */
export async function runGenerate({ args, deps = {} }) {
  const {
    fetchImpl = fetch,
    callGemini = (prompt) => callGeminiApi(prompt, { responseSchema: GUIDE_RESPONSE_SCHEMA }),
    now = new Date(),
    openPrState = fetchOpenGuidePrState,
    rejectedIds = fetchRejectedTopicIds,
    log = console,
    articlesDirForExisting = ARTICLES_DIR,
  } = deps;
  const today = todayYmd(now);

  const sourcesData = await loadOfficialSources(args.sourcesPath || OFFICIAL_SOURCES_PATH);
  const sourceProblems = validateOfficialSources(sourcesData);
  if (sourceProblems.length) throw new Error(`official-sources.json が不正です:\n- ${sourceProblems.join('\n- ')}`);
  const ledger = await loadGuideTopics(args.topicsPath || GUIDE_TOPICS_PATH);
  const ledgerProblems = validateGuideTopics(ledger, { sourceThemeKeys: new Set(Object.keys(sourcesData.themes)) });
  if (ledgerProblems.length) throw new Error(`guide-topics.json が不正です:\n- ${ledgerProblems.join('\n- ')}`);

  const existingArticleIds = await listArticleIds(articlesDirForExisting);

  // --replace: 公開済み記事の作り直し。topic 明示指定が必須(自動選択では使わない)。
  if (args.replace && !args.topicId) throw new Error('--replace(GUIDE_REPLACE=1)には topic の明示指定(--topic=<id> / GUIDE_TOPIC_ID)が必要です');

  // --- トピック決定
  let candidates;
  if (args.topicId) {
    if (!TOPIC_ID_PATTERN.test(args.topicId)) throw new Error(`トピックID が不正です: ${args.topicId}`);
    const topic = ledger.topics.find((t) => t.id === args.topicId);
    if (!topic) throw new Error(`台帳にトピック ${args.topicId} がありません`);
    if (args.replace) {
      // 存在しない記事の作り直しは typo の可能性が高いので、通常生成にフォールバックせずエラーにする。
      if (!existingArticleIds.has(topic.id)) throw new Error(`--replace: 作り直し対象の記事 ${topic.id}.md が存在しません(新規生成は --replace なしで実行してください)`);
    } else if (existingArticleIds.has(topic.id)) throw new Error(`記事 ${topic.id}.md が既に存在します`);
    log.log(`トピック指定: ${topic.id}(${topic.status})${args.replace ? ' [--replace: 公開済み記事の作り直し]' : ''}`);
    candidates = [topic];
  } else {
    let openPrArticleIds = new Set();
    let rejectedTopicIds = new Set();
    if (!args.dryRun) {
      // 却下済み(クローズ済み未merge)の照会に失敗した状態で進むと、オーナーが却下したトピックを再生成しうる。
      // 重複PRは無害だが再生成は不快なので、ここは fail-open にせず失敗させる(翌日再試行される)。
      openPrArticleIds = (await openPrState()).openPrArticleIds;
      rejectedTopicIds = await rejectedIds();
    }
    candidates = listCandidateTopics({ topics: ledger.topics, existingArticleIds, openPrArticleIds, rejectedTopicIds }).slice(0, MAX_TOPIC_ATTEMPTS);
    if (candidates.length === 0) {
      log.log('生成すべきトピックがありません(queued が無い、または全て生成済み/PR中/却下済み)。正常終了します。');
      return { status: 'none', skipped: [] };
    }
  }

  // 自動選択のときだけ、トピック固有の失敗(出典本文0件・検証失敗)なら次の候補へ進む(最大 MAX_TOPIC_ATTEMPTS 件)。
  // Gemini API 自体の失敗(リトライ尽き)や台帳不正などは TopicSkipError ではないのでそのまま例外になる。
  const skipped = [];
  for (const topic of candidates) {
    log.log(`トピック: ${topic.id} — ${topic.title}(priority ${topic.priority}, addedAt ${topic.addedAt})`);
    try {
      const result = await attemptTopic(topic);
      return { ...result, skipped };
    } catch (err) {
      if (!(err instanceof TopicSkipError) || args.topicId) throw err;
      skipped.push({ id: topic.id, reason: err.message });
      log.warn?.(`トピック ${topic.id} は生成できませんでした。次の候補へ進みます: ${err.message}`);
    }
  }
  const failure = new Error(`試行した ${skipped.length} 件のトピックがすべて失敗しました:\n${skipped.map((s) => `- ${s.id}: ${s.reason}`).join('\n')}`);
  failure.skipped = skipped;
  throw failure;

  async function attemptTopic(topic) {
    const warnings = [];
    // --- 出典取得(台帳由来のURLのみ)
    const refs = resolveTopicReferences(topic, sourcesData);
    if (refs.length === 0) throw new TopicSkipError(`トピック ${topic.id} に参照URLがありません`);
    log.log(`参照URL ${refs.length}件を取得します...`);
    const { ok, failed } = await fetchSources(refs, { fetchImpl, log });
    if (ok.length === 0) throw new TopicSkipError(noSourceMessage(topic.id, failed));
    const { included, omitted } = applyTotalBudget(ok);
    for (const s of omitted) warnings.push(`合計文字数上限のため資料から除外: ${s.url}`);
    for (const f of failed) warnings.push(`取得失敗のため除外: ${f.url} (${f.reason})`);
    log.log(`資料 ${included.length}件 / 合計 ${included.reduce((n, s) => n + s.text.length, 0)}字`);

    // --- Gemini(API失敗はそのまま例外。応答の中身の問題はトピック固有の失敗として扱う)
    const prompt = buildGuidePrompt({ topic, sources: included, today, ledgerTopics: ledger.topics });
    const data = await callGemini(prompt);
    let output;
    try {
      output = parseGeminiObject(extractGeminiText(data));
    } catch (err) {
      throw new TopicSkipError(`生成結果を解釈できませんでした(${topic.id}): ${err.message}`);
    }
    const allowedUrls = included.map((s) => s.url);
    // 許可リスト = 渡した references URL ∪ 資料本文に文字列として出現するURL(公的ページが案内する公式URL)
    const extraAllowedUrls = extractUrlsFromTexts(included.map((s) => s.text));
    const validated = validateGuideOutput(output, { allowedUrls, extraAllowedUrls, topic, ledgerTopics: ledger.topics });
    if (validated.removedUrls.length) warnings.push(`資料に無い外部URLを本文から除去: ${validated.removedUrls.join(', ')}`);
    const removedUrlReport = formatRemovedUrlReport(validated.removedDetails);
    const replacedHeadingReport = formatReplacedHeadingReport(validated.replacedHeadings);
    for (const r of validated.replacedHeadings || []) {
      warnings.push(`hub の見出しが spoke ${r.spokeId} と衝突したため label に置換: 「${r.before}」→「${r.after}」`);
    }
    if (validated.droppedSourceUrls.length) warnings.push(`usedSourceUrls のうち渡していないURLを除去: ${validated.droppedSourceUrls.join(', ')}`);
    if (!validated.ok) throw new TopicSkipError(`生成結果の検証に失敗しました(${topic.id}): ${validated.problems.join(' / ')}`);

    // --- Markdown
    const tags = filterTagsByVocabulary(topic.tags, topic.category);
    const refMeta = new Map(included.map((s) => [normalizeUrl(s.url), s]));
    const references = validated.value.usedSourceUrls.map((u) => {
      const s = refMeta.get(normalizeUrl(u));
      return { title: s?.title || u, url: u, publisher: s?.publisher };
    });
    // --replace: 既存記事の frontmatter から pubDate / draft / hasAffiliate を引き継ぎ、updatedDate・lastVerified を当日にする
    let carryOver;
    if (args.replace) {
      const existing = parseArticleFile(await readFile(path.join(articlesDirForExisting, `${topic.id}.md`), 'utf-8')).data;
      carryOver = { pubDate: existing.pubDate, draft: existing.draft, hasAffiliate: existing.hasAffiliate };
    }
    const markdown = buildGuideMarkdown({ topic, value: validated.value, tags, references, today, carryOver });

    const shapeProblems = validateFrontmatterShape(parseArticleFile(markdown).data);
    if (shapeProblems.length) throw new TopicSkipError(`frontmatter がスキーマに合いません(${topic.id}): ${shapeProblems.join(' / ')}`);

    // --- 書き出し(ここまで失敗しなければ初めてファイルを書く。失敗した候補は何も残さない)
    const outDir = args.outDir || ARTICLES_DIR;
    await mkdir(outDir, { recursive: true });
    const filePath = path.join(outDir, `${topic.id}.md`);
    if (!args.replace && existsSync(filePath)) throw new Error(`${filePath} が既に存在します(上書きしません)`);
    await writeFile(filePath, markdown, 'utf-8');

    // --- スナップショット(実際に使った出典のみ。月次改訂の変更検知の基準)
    const snapshotsPath = snapshotFilePath(topic.id, args.snapshotsDir || undefined);
    const snapshots = {};
    for (const u of validated.value.usedSourceUrls) {
      const s = refMeta.get(normalizeUrl(u));
      if (s) snapshots[u] = { sha256: s.sha256, fetchedAt: s.fetchedAt };
    }
    await mkdir(path.dirname(snapshotsPath), { recursive: true });
    await writeFile(snapshotsPath, serializeSnapshots(snapshots), 'utf-8');

    return { status: 'generated', topic, filePath, snapshotsPath, markdown, usedSourceUrls: validated.value.usedSourceUrls, title: validated.value.title, warnings, removedUrlReport, replacedHeadingReport };
  }
}

/** 生成できなかったトピックの報告文(job summary / Issue 用 Markdown)。skipped が空なら null。 */
export function buildSkipReport(skipped, { generatedId = null, today = '' } = {}) {
  if (!skipped || skipped.length === 0) return null;
  const lines = [
    `## ガイド記事の生成: 失敗したトピック(${today})`,
    '',
    generatedId ? `次の候補 \`${generatedId}\` で生成しました。以下のトピックは生成できませんでした(毎日同じトピックで失敗し続ける場合は、出典の見直しか台帳で on-hold にしてください)。` : '試行した全候補が失敗しました。',
    '',
    ...skipped.map((s) => `- \`${s.id}\`: ${String(s.reason).split('\n').join(' / ')}`),
    '',
  ];
  return lines.join('\n');
}

// 報告ファイルの書き出し先。CI(GITHUB_OUTPUT あり)は RUNNER_TEMP、ローカル実行(scripts/local/guide-job.sh)は
// GUIDE_REPORT_DIR で差し替える。どちらも無ければ null(ファイルは書かない)。
function reportDir() {
  if (process.env.GITHUB_OUTPUT) return process.env.RUNNER_TEMP || os.tmpdir();
  return process.env.GUIDE_REPORT_DIR || null;
}

// CI(GitHub Actions)では job summary・アノテーション・失敗一覧JSON(Issue作成用)に残す。ローカルでは標準エラーのみ。
async function reportSkipped(skipped, { generatedId, today }) {
  const report = buildSkipReport(skipped, { generatedId, today });
  if (!report) return;
  console.warn(report);
  for (const sk of skipped) console.log(`::warning title=ガイド生成に失敗したトピック::${sk.id}: ${String(sk.reason).split('\n')[0]}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  const dir = reportDir();
  if (dir) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'guide-generate-failures.json'), JSON.stringify(skipped, null, 2), 'utf-8');
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `failed_topics=${skipped.map((sk) => sk.id).join(',')}\n`);
}

// dry-run 用: フィクスチャ(pages.json / gemini-guide-response.json)から fetch と Gemini 応答を作る。
export async function buildDryRunDeps(fixturesDir) {
  const pages = await readJsonFile(path.join(fixturesDir, 'pages.json'));
  const geminiResponse = await readJsonFile(path.join(fixturesDir, 'gemini-guide-response.json'));
  return {
    fetchImpl: async (url) => {
      if (!(url in pages)) return new Response('not found', { status: 404 });
      return new Response(pages[url], { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
    callGemini: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiResponse) }] } }] }),
  };
}

async function main() {
  const args = parseGenerateArgs(process.argv.slice(2), process.env);
  const deps = {};

  if (args.dryRun) {
    const fixturesDir = args.fixturesDir || DEFAULT_FIXTURES_DIR;
    Object.assign(deps, await buildDryRunDeps(fixturesDir));
    // 既定は同梱フィクスチャの台帳・出典(実データの有無に依存しない)。実ファイルで確認したいときは --topics= / --sources= を指定。
    args.topicsPath ||= path.join(fixturesDir, 'guide-topics.json');
    args.sourcesPath ||= path.join(fixturesDir, 'official-sources.json');
    args.outDir ||= await mkdtemp(path.join(os.tmpdir(), 'guide-dry-run-'));
    // --replace の dry-run は、実記事ではなくフィクスチャの既存記事(<fixtures>/articles/)を作り直し対象とする
    if (args.replace) deps.articlesDirForExisting = path.join(fixturesDir, 'articles');
    args.snapshotsDir ||= path.join(args.outDir, 'guide-source-snapshots');
    console.log(`--dry-run: Gemini・出典取得・GitHub照会を行いません。出力先: ${args.outDir}`);
  } else if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY が未設定です。`gh secret set GEMINI_API_KEY` (CI) または `export GEMINI_API_KEY=...` (ローカル) を実行してください。');
    process.exit(1);
  }

  let result;
  try {
    result = await runGenerate({ args, deps });
  } catch (err) {
    // 自動選択で全候補が失敗した場合: 理由を残してから異常終了する(Gemini API失敗などは skipped なし)。
    if (err.skipped) await reportSkipped(err.skipped, { generatedId: null, today: todayYmd() });
    throw err;
  }
  await reportSkipped(result.skipped, { generatedId: result.topic?.id ?? null, today: todayYmd() });

  const dir = reportDir();
  const writeResultJson = async (data) => {
    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'guide-result.json'), JSON.stringify(data, null, 2), 'utf-8');
  };
  if (result.status === 'none') {
    if (process.env.GITHUB_OUTPUT && !args.dryRun) await appendFile(process.env.GITHUB_OUTPUT, 'generated=false\n');
    await writeResultJson({ generated: false });
    return;
  }
  for (const w of result.warnings) console.warn(`警告: ${w}`);
  // PR本文に追記するレビュー用の報告(除去したURL・置換した見出し)。generate-guide.yml の「Compose PR body」/ guide-job.sh が読む。
  const reviewReport = [result.removedUrlReport, result.replacedHeadingReport].filter(Boolean).join('\n\n');
  if (reviewReport) {
    console.warn(reviewReport);
    if (dir) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'guide-removed-urls.md'), `${reviewReport}\n`, 'utf-8');
    }
    if (process.env.GITHUB_OUTPUT && process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${reviewReport}\n`);
  }
  await writeResultJson({
    generated: true,
    replace: args.replace === true,
    topic_id: result.topic.id,
    title: result.title,
    file: path.relative(process.cwd(), result.filePath),
    snapshot: path.relative(process.cwd(), result.snapshotsPath),
  });
  console.log(`作成: ${result.filePath}`);
  console.log(`スナップショット更新: ${result.snapshotsPath}`);
  if (args.dryRun) {
    console.log(`--- dry-run 生成結果(先頭40行) ---\n${result.markdown.split('\n').slice(0, 40).join('\n')}`);
  } else if (process.env.GITHUB_OUTPUT) {
    const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ');
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `generated=true\ntopic_id=${result.topic.id}\ntitle=${oneLine(result.title)}\n`
    );
  }
}

// パスに空白(例: "Application Support")があると import.meta.url は %20 になるため、file:// 文字列比較ではなく pathToFileURL で比べる。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
