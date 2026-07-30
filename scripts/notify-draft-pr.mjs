import { parse as parseYaml } from 'yaml';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const REPO = process.env.GITHUB_REPOSITORY;
const CLOUDFLARE_PROJECT = process.env.CLOUDFLARE_PAGES_PROJECT || 'donesia-navi';

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (arg.startsWith('--pr=')) args.pr = Number(arg.slice('--pr='.length));
  }
  return args;
}

async function githubApi(path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...opts.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function loadDraftArticles(prNumber, headSha) {
  const files = await githubApi(`/repos/${REPO}/pulls/${prNumber}/files?per_page=100`);
  const articleFiles = files.filter(
    (f) => f.filename.startsWith('src/content/articles/') && f.filename.endsWith('.md') && f.status !== 'removed'
  );

  const articles = [];
  for (const f of articleFiles) {
    const contentRes = await githubApi(`/repos/${REPO}/contents/${encodeURIComponent(f.filename)}?ref=${headSha}`);
    const raw = Buffer.from(contentRes.content, 'base64').toString('utf-8');
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) continue;

    let fm;
    try {
      fm = parseYaml(fmMatch[1]);
    } catch {
      continue;
    }
    if (!fm.draft) continue;

    articles.push({
      path: f.filename,
      id: f.filename.replace('src/content/articles/', '').replace(/\.md$/, ''),
      title: fm.title,
      description: fm.description,
      category: fm.category,
      source: fm.source,
    });
  }
  return articles;
}

// Cloudflare Pagesのデプロイ完了(GitHub Checks API)を待ってプレビューURLを取り出す。
// 見つからない/タイムアウトした場合はnullを返し、呼び出し側でPRリンクにフォールバックする。
async function pollPreviewUrl(headSha, { retries = 12, intervalMs = 10000 } = {}) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const data = await githubApi(`/repos/${REPO}/commits/${headSha}/check-runs`);
      const run = data.check_runs?.find((r) => r.name === 'Cloudflare Pages');
      if (run?.status === 'completed') {
        if (run.conclusion !== 'success') {
          console.warn('Cloudflare Pagesのデプロイが失敗しています。PRリンクにフォールバックします。');
          return null;
        }
        const match = run.output?.summary?.match(new RegExp(`https://[a-z0-9]+\\.${CLOUDFLARE_PROJECT}\\.pages\\.dev`));
        if (match) return match[0];
      }
    } catch (err) {
      console.warn('check-runs取得エラー:', err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  console.warn('プレビューURLの取得がタイムアウトしました。PRリンクにフォールバックします。');
  return null;
}

function buildBlocks(pr, articles, previewUrl) {
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `📝 新しいドラフト記事 (${articles.length}件)` } },
  ];

  for (const a of articles) {
    const link = previewUrl ? `${previewUrl}/articles/${a.id}/` : pr.html_url;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<${link}|${a.title || a.id}>*\n${a.description || ''}\nカテゴリ: ${a.category || '不明'} / ソース: ${a.source || '不明'}`,
      },
    });
  }

  if (!previewUrl) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '⚠️ プレビューURLを取得できなかったため、上記リンクはPR本体を指しています。' }],
    });
  }

  blocks.push({
    type: 'actions',
    block_id: 'draft_pr_actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ 承認して公開' },
        style: 'primary',
        action_id: 'approve_publish',
        value: JSON.stringify({ pr: pr.number, repo: REPO }),
        confirm: {
          title: { type: 'plain_text', text: '公開の確認' },
          text: { type: 'mrkdwn', text: `PR #${pr.number} の記事をそのまま本番公開します。よろしいですか？` },
          confirm: { type: 'plain_text', text: '公開する' },
          deny: { type: 'plain_text', text: 'キャンセル' },
        },
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'PRを見る' },
        url: pr.html_url,
      },
    ],
  });

  return blocks;
}

async function postSlackMessage(pr, articles, previewUrl) {
  const blocks = buildBlocks(pr, articles, previewUrl);
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: SLACK_CHANNEL_ID,
      text: `新しいドラフト記事があります: PR #${pr.number}`,
      blocks,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  console.log('Slack通知を送信しました。ts:', data.ts);
}

async function main() {
  const { pr: prNumber } = parseArgs(process.argv.slice(2));
  if (!prNumber) {
    console.error('--pr=<番号> を指定してください');
    process.exit(1);
  }
  if (!GITHUB_TOKEN || !SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID || !REPO) {
    console.error('GITHUB_TOKEN / SLACK_BOT_TOKEN / SLACK_CHANNEL_ID / GITHUB_REPOSITORY が必要です');
    process.exit(1);
  }

  const pr = await githubApi(`/repos/${REPO}/pulls/${prNumber}`);
  const articles = await loadDraftArticles(prNumber, pr.head.sha);

  if (articles.length === 0) {
    console.log('draft:true の記事変更が見つかりませんでした。通知をスキップします。');
    return;
  }

  console.log(`${articles.length}件のdraft記事を検知。プレビューURLを待機します...`);
  const previewUrl = await pollPreviewUrl(pr.head.sha);
  await postSlackMessage(pr, articles, previewUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
