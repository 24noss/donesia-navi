// 公開済みガイド記事の月次改訂。
//
// 対象: 台帳(guide-topics.json)に id があり、src/content/articles/<id>.md が存在し、draft:false のガイド記事。
// 各記事の references の URL を再取得し、src/data/guide-source-snapshots/<id>.json の sha256 と比較する。
//   - 全て変化なし   -> frontmatter の lastVerified を当日にする(まとめて1PR)
//   - 変化あり       -> 旧本文 + 新資料を Gemini に渡し、資料の変化に基づく修正だけの改訂版を作る(記事ごとに1PR)
//   - 取得失敗       -> その記事は更新せず、失敗として一覧化する(Issueで通知)
// このスクリプトは git を操作しない。PR単位の変更ファイル一式を --out-dir 配下に書き出し、
// ワークフロー(refresh-guides.yml)がブランチ作成・PR作成を行う。詳細は docs/guide-pipeline.md を参照。
//
//   node scripts/refresh-guides.mjs --out-dir=<dir>
//   node scripts/refresh-guides.mjs --dry-run       # フィクスチャで最後まで通す(外部呼び出しなし)

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { callGeminiApi, isDryRun } from './crawl-and-draft.mjs';
import {
  ARTICLES_DIR,
  GUIDE_TOPICS_PATH,
  OFFICIAL_SOURCES_PATH,
  snapshotFilePath,
  loadGuideTopics,
  loadOfficialSources,
  loadSnapshots,
  readJsonFile,
  serializeSnapshots,
  validateGuideTopics,
  validateOfficialSources,
} from './lib/guide-topics.mjs';
import { applyTotalBudget, fetchSources } from './lib/guide-fetch.mjs';
import {
  MIN_BODY_CHARS,
  REFRESH_RESPONSE_SCHEMA,
  assembleArticleFile,
  buildRefreshPrompt,
  extractGeminiText,
  parseArticleFile,
  parseGeminiObject,
  setFrontmatterDate,
  validateFrontmatterShape,
  validateRefreshOutput,
} from './lib/guide-article.mjs';

const DEFAULT_FIXTURES_DIR = path.join(process.cwd(), 'scripts/fixtures/guide');
const DEFAULT_MAX_REVISIONS = 10;

export function parseRefreshArgs(argv = [], env = {}) {
  const get = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  return {
    dryRun: isDryRun(argv),
    outDir: get('out-dir'),
    fixturesDir: get('fixtures-dir'),
    topicsPath: get('topics'),
    sourcesPath: get('sources'),
    snapshotsDir: get('snapshots-dir'),
    articlesDir: get('articles-dir'),
    maxRevisions: Number(env.REFRESH_MAX_REVISIONS || DEFAULT_MAX_REVISIONS),
  };
}

/**
 * 記事の出典URLごとの変化を判定する純関数。
 * @param {string[]} urls 記事の references の URL
 * @param {Map<string, {sha256:string}>} fetched URL -> 取得成功結果(正規化キーではなくURLそのままで引く)
 * @param {Record<string,{sha256:string}>} snapshots
 * @returns {{changed:string[], unchanged:string[], noBaseline:string[]}}
 */
export function compareWithSnapshots(urls, fetched, snapshots) {
  const changed = [];
  const unchanged = [];
  const noBaseline = [];
  for (const u of urls) {
    const base = snapshots[u];
    const now = fetched.get(u);
    if (!base?.sha256) noBaseline.push(u);
    else if (base.sha256 !== now.sha256) changed.push(u);
    else unchanged.push(u);
  }
  return { changed, unchanged, noBaseline };
}

const ymd = (d) => d.toISOString().slice(0, 10);

/**
 * 月次改訂本体。ネットワーク・Gemini は deps で差し替え可能。
 * @returns {Promise<{groups: object[], failures: {id:string,url?:string,reason:string}[], deferred: string[], stats: object}>}
 */
export async function runRefresh({ args, deps = {} }) {
  const {
    fetchImpl = fetch,
    callGemini = (prompt) => callGeminiApi(prompt, { responseSchema: REFRESH_RESPONSE_SCHEMA }),
    now = new Date(),
    log = console,
  } = deps;
  const today = ymd(now);
  const yyyymm = today.slice(0, 7).replace('-', '');
  const ym = today.slice(0, 7);
  const articlesDir = args.articlesDir || ARTICLES_DIR;
  const snapshotsDir = args.snapshotsDir || undefined;
  const relArticle = (id) => `src/content/articles/${id}.md`;
  const relSnapshots = (id) => `src/data/guide-source-snapshots/${id}.json`;

  const sourcesData = await loadOfficialSources(args.sourcesPath || OFFICIAL_SOURCES_PATH);
  const sp = validateOfficialSources(sourcesData);
  if (sp.length) throw new Error(`official-sources.json が不正です:\n- ${sp.join('\n- ')}`);
  const ledger = await loadGuideTopics(args.topicsPath || GUIDE_TOPICS_PATH);
  const lp = validateGuideTopics(ledger, { sourceThemeKeys: new Set(Object.keys(sourcesData.themes)) });
  if (lp.length) throw new Error(`guide-topics.json が不正です:\n- ${lp.join('\n- ')}`);

  const cache = new Map();
  const failures = [];
  const deferred = [];

  // --- 対象記事の収集(台帳にあり・ファイルがあり・draft:false)
  const targets = [];
  for (const topic of ledger.topics) {
    const file = path.join(articlesDir, `${topic.id}.md`);
    if (!existsSync(file)) continue;
    const raw = await readFile(file, 'utf-8');
    let parsed;
    try {
      parsed = parseArticleFile(raw);
    } catch (err) {
      failures.push({ id: topic.id, reason: `記事の解析に失敗: ${err.message}` });
      continue;
    }
    if (parsed.data.draft !== false) continue; // 下書き(draft:true)は対象外
    const urls = (parsed.data.references || []).map((r) => r?.url).filter(Boolean);
    if (urls.length === 0) {
      failures.push({ id: topic.id, reason: 'references が無いため出典を確認できません' });
      continue;
    }
    targets.push({ topic, raw, parsed, urls });
  }
  log.log(`対象記事: ${targets.length}本`);

  // --- 取得と比較
  const unchangedItems = []; // lastVerified を更新する記事 { id, title, note? }
  const baselineOnly = []; // ベースライン記録のみ
  const revisionCandidates = [];
  for (const t of targets) {
    const refs = t.urls.map((url) => ({ url, title: (t.parsed.data.references.find((r) => r.url === url) || {}).title || url }));
    const { ok, failed } = await fetchSources(refs, { fetchImpl, cache, log });
    if (failed.length) {
      for (const f of failed) failures.push({ id: t.topic.id, url: f.url, reason: f.reason });
      continue; // 取得できない出典がある記事は更新しない
    }
    const fetched = new Map(ok.map((s) => [s.url, s]));
    t.sources = ok;
    t.fetched = fetched;
    t.cmp = compareWithSnapshots(t.urls, fetched, await loadSnapshots(snapshotFilePath(t.topic.id, snapshotsDir)));
    if (t.cmp.changed.length > 0) revisionCandidates.push(t);
    else if (t.cmp.noBaseline.length > 0) baselineOnly.push(t);
    else unchangedItems.push(t);
  }

  const snapshotEntry = (t, url) => ({ sha256: t.fetched.get(url).sha256, fetchedAt: t.fetched.get(url).fetchedAt });
  // 記事ごとのスナップショットファイル(その記事の references の現在の状態)
  const snapshotFile = (t) => {
    const snap = {};
    for (const u of t.urls) snap[u] = snapshotEntry(t, u);
    return serializeSnapshots(snap);
  };
  const bump = (t) => assembleArticleFile({ ...t.parsed, frontmatter: setFrontmatterDate(t.parsed.frontmatter, 'lastVerified', today) });

  const groups = [];
  const noImpact = []; // 資料は変化したが記事への影響なしと判断
  const revised = [];

  // --- 変化あり: 記事ごとに改訂
  let done = 0;
  for (const t of revisionCandidates) {
    if (done >= args.maxRevisions) {
      deferred.push(t.topic.id);
      continue;
    }
    done += 1;
    const { included } = applyTotalBudget(t.sources);
    const oldBody = t.parsed.body.trim();
    let validated;
    try {
      const prompt = buildRefreshPrompt({ title: t.parsed.data.title, oldBody, sources: included, changedUrls: t.cmp.changed, today });
      const data = await callGemini(prompt);
      const output = parseGeminiObject(extractGeminiText(data));
      validated = validateRefreshOutput(output, {
        allowedUrls: t.urls,
        minChars: Math.min(MIN_BODY_CHARS, Math.floor(oldBody.length * 0.6)),
      });
    } catch (err) {
      failures.push({ id: t.topic.id, reason: `改訂案の生成に失敗: ${err.message}` });
      continue;
    }
    if (!validated.ok) {
      failures.push({ id: t.topic.id, reason: `改訂案の検証に失敗: ${validated.problems.join(' / ')}` });
      continue;
    }
    if (!validated.needsRevision) {
      noImpact.push({ t, summary: validated.changeSummary });
      continue;
    }
    let fm = setFrontmatterDate(t.parsed.frontmatter, 'updatedDate', today);
    fm = setFrontmatterDate(fm, 'lastVerified', today);
    const content = assembleArticleFile({ frontmatter: fm, body: `\n${validated.body}\n`, footer: t.parsed.footer });
    const shape = validateFrontmatterShape(parseArticleFile(content).data);
    if (shape.length) {
      failures.push({ id: t.topic.id, reason: `改訂後の frontmatter が不正: ${shape.join(' / ')}` });
      continue;
    }
    revised.push(t);
    groups.push({
      kind: 'revision',
      id: t.topic.id,
      branch: `auto/guide-refresh-${t.topic.id}-${yyyymm}`,
      title: `ガイド記事の改訂(${ym}): ${t.parsed.data.title}`,
      body: [
        `出典の内容が前回確認時から変わったため、資料の変化に基づいて記事を改訂しました(${today})。公開済み記事(\`draft: false\`)への変更です。差分を確認してmergeしてください。`,
        '',
        '## 変化した出典',
        ...t.cmp.changed.map((u) => `- ${u}`),
        '',
        '## 改訂の要約(AIによる)',
        validated.changeSummary,
        ...(validated.removedUrls.length ? ['', `注意: 資料に無い外部URLを本文から除去しました: ${validated.removedUrls.join(', ')}`] : []),
        '',
        '`updatedDate` と `lastVerified` を当日に更新し、出典のスナップショット(`src/data/guide-source-snapshots/${t.topic.id}.json`)を更新しています。',
      ].join('\n'),
      files: {
        [relArticle(t.topic.id)]: content,
        [relSnapshots(t.topic.id)]: snapshotFile(t),
      },
    });
  }

  // --- 変化なし(+影響なし・ベースライン記録)を1PRにまとめる
  const bumped = [...unchangedItems, ...noImpact.map((n) => n.t)];
  const batchItems = [...bumped, ...baselineOnly];
  if (batchItems.length > 0) {
    const files = {};
    for (const t of bumped) files[relArticle(t.topic.id)] = bump(t);
    for (const t of batchItems) files[relSnapshots(t.topic.id)] = snapshotFile(t);
    const lines = [
      `公開済みガイド記事の出典を再取得し、前回確認時から内容が変わっていない記事の \`lastVerified\` を ${today} に更新します。`,
      '',
      `## 変化なし(lastVerified を更新): ${unchangedItems.length}本`,
      ...unchangedItems.map((t) => `- \`${t.topic.id}\` ${t.parsed.data.title}`),
    ];
    if (noImpact.length) {
      lines.push('', `## 出典に変化はあったが記事への影響なしと判断(lastVerified を更新): ${noImpact.length}本`);
      for (const n of noImpact) lines.push(`- \`${n.t.topic.id}\` ${n.t.parsed.data.title} — ${n.summary || '(要約なし)'}`);
    }
    if (baselineOnly.length) {
      lines.push('', `## ベースライン(出典ハッシュ)を初回記録のみ・lastVerified は更新しない: ${baselineOnly.length}本`);
      for (const t of baselineOnly) lines.push(`- \`${t.topic.id}\` ${t.parsed.data.title}(新規記録: ${t.cmp.noBaseline.join(', ')})`);
    }
    groups.push({
      kind: 'unchanged',
      branch: `auto/guide-refresh-unchanged-${yyyymm}`,
      title: `ガイド出典の定期確認(${ym}): 変化なし ${unchangedItems.length}本`,
      body: lines.join('\n'),
      files,
    });
  }

  return {
    groups,
    failures,
    deferred,
    stats: {
      targets: targets.length,
      unchanged: unchangedItems.length,
      noImpact: noImpact.length,
      baselineOnly: baselineOnly.length,
      revised: revised.length,
      failed: failures.length,
      deferred: deferred.length,
    },
    today,
  };
}

/** Issue本文(取得失敗・上限超過の一覧)。無ければ null。 */
export function buildFailureIssueBody({ failures, deferred, today }) {
  if (failures.length === 0 && deferred.length === 0) return null;
  const lines = [`ガイド記事の月次確認(${today})で、更新できなかった記事があります。`, ''];
  if (failures.length) {
    lines.push('## 取得・改訂に失敗した記事(今回は更新していません)', '');
    for (const f of failures) lines.push(`- \`${f.id}\`${f.url ? ` ${f.url}` : ''}: ${f.reason}`);
    lines.push('', '出典URLが移動・廃止された場合は、記事の `references` と `src/data/official-sources.json` を直してください。');
  }
  if (deferred.length) {
    lines.push('', '## 1回の実行上限のため次回に持ち越した記事', '', ...deferred.map((id) => `- \`${id}\``));
  }
  return lines.join('\n') + '\n';
}

/** グループごとの変更ファイルと result.json を書き出す(ワークフローが読む)。 */
export async function writeRefreshOutput({ groups, failures, deferred, today }, outDir) {
  await mkdir(outDir, { recursive: true });
  const index = [];
  for (const [i, g] of groups.entries()) {
    const dir = path.join(outDir, `group-${i}`);
    for (const [rel, content] of Object.entries(g.files)) {
      const dest = path.join(dir, 'files', rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, content, 'utf-8');
    }
    await writeFile(path.join(dir, 'body.md'), g.body, 'utf-8');
    index.push({ kind: g.kind, id: g.id ?? null, branch: g.branch, title: g.title, dir: path.resolve(dir), files: Object.keys(g.files) });
  }
  const issueBody = buildFailureIssueBody({ failures, deferred, today });
  if (issueBody) await writeFile(path.join(outDir, 'issue-body.md'), issueBody, 'utf-8');
  await writeFile(
    path.join(outDir, 'result.json'),
    JSON.stringify({ groups: index, hasIssue: Boolean(issueBody), issueTitle: `ガイド出典の確認に失敗した記事(${today.slice(0, 7)})` }, null, 2),
    'utf-8'
  );
  return index;
}

async function main() {
  const args = parseRefreshArgs(process.argv.slice(2), process.env);
  const deps = {};
  if (args.dryRun) {
    const fixturesDir = args.fixturesDir || DEFAULT_FIXTURES_DIR;
    const pages = await readJsonFile(path.join(fixturesDir, 'pages.json'));
    const resp = await readJsonFile(path.join(fixturesDir, 'gemini-refresh-response.json'));
    Object.assign(deps, {
      fetchImpl: async (url) =>
        url in pages
          ? new Response(pages[url], { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
          : new Response('not found', { status: 404 }),
      callGemini: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(resp) }] } }] }),
    });
    args.topicsPath ||= path.join(fixturesDir, 'guide-topics.json');
    args.sourcesPath ||= path.join(fixturesDir, 'official-sources.json');
    args.articlesDir ||= path.join(fixturesDir, 'articles');
    args.snapshotsDir ||= path.join(fixturesDir, 'refresh-snapshots');
    args.outDir ||= await mkdtemp(path.join(os.tmpdir(), 'guide-refresh-dry-run-'));
    console.log(`--dry-run: Gemini・出典取得を行いません。出力先: ${args.outDir}`);
  } else {
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY が未設定です。');
      process.exit(1);
    }
    if (!args.outDir) {
      console.error('--out-dir=<dir> を指定してください(PR単位の変更ファイルの書き出し先)。');
      process.exit(2);
    }
  }

  const result = await runRefresh({ args, deps });
  await writeRefreshOutput(result, args.outDir);

  console.log(`統計: ${JSON.stringify(result.stats)}`);
  for (const g of result.groups) console.log(`PR候補: [${g.kind}] ${g.branch} — ${g.title}`);
  for (const f of result.failures) console.warn(`失敗: ${f.id}${f.url ? ` ${f.url}` : ''} — ${f.reason}`);
  if (process.env.GITHUB_OUTPUT && !args.dryRun) {
    await appendFile(process.env.GITHUB_OUTPUT, `result_path=${path.resolve(args.outDir, 'result.json')}\ngroups=${result.groups.length}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
