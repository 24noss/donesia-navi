// Cloudflare Pages Function: Slackの「承認して公開」ボタン押下を受け取るWebhook。
// ルート: POST /api/slack-interactivity
//
// 必要な環境変数(Cloudflare Pagesダッシュボードの donesia-navi プロジェクト、Production環境):
//   SLACK_SIGNING_SECRET - Slack App の Basic Information ページで取得
//   GITHUB_TOKEN         - このリポジトリのみに絞ったfine-grained PAT(contents:write, pull-requests:write)

const REQUEST_MAX_AGE_SECONDS = 60 * 5;

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function verifySlackSignature(request, rawBody, signingSecret) {
  const timestamp = request.headers.get('X-Slack-Request-Timestamp');
  const signature = request.headers.get('X-Slack-Signature');
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > REQUEST_MAX_AGE_SECONDS) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString));
  const computedSig =
    'v0=' +
    Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  return timingSafeEqual(computedSig, signature);
}

export function base64ToUtf8(base64) {
  const binary = atob(base64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

async function githubApi(env, path, opts = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      // GitHub APIはUser-Agent必須(未指定だと403 "Request forbidden by administrative rules")
      'User-Agent': 'donesia-navi-slack-interactivity',
      ...opts.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ファイル更新直後はGitHub側のmergeable判定がまだ非同期に計算中で、
// 405 "Pull Request is not mergeable" が一時的に返ることがあるためリトライする。
async function mergeWithRetry(env, repo, prNumber, { retries = 5, intervalMs = 2000 } = {}) {
  for (let i = 0; i < retries; i += 1) {
    try {
      await githubApi(env, `/repos/${repo}/pulls/${prNumber}/merge`, {
        method: 'PUT',
        body: JSON.stringify({}),
      });
      return;
    } catch (err) {
      const isLastAttempt = i === retries - 1;
      if (isLastAttempt || !String(err.message).includes('405')) throw err;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

async function updateSlackMessage(responseUrl, text) {
  await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ replace_original: true, text }),
  });
}

async function publishPr({ env, repo, prNumber, responseUrl, clickedBy }) {
  try {
    const pr = await githubApi(env, `/repos/${repo}/pulls/${prNumber}`);
    const branch = pr.head.ref;

    const files = await githubApi(env, `/repos/${repo}/pulls/${prNumber}/files?per_page=100`);
    const articleFiles = files.filter(
      (f) => f.filename.startsWith('src/content/articles/') && f.filename.endsWith('.md') && f.status !== 'removed'
    );

    let publishedCount = 0;
    for (const f of articleFiles) {
      const fileData = await githubApi(env, `/repos/${repo}/contents/${encodeURIComponent(f.filename)}?ref=${branch}`);
      const raw = base64ToUtf8(fileData.content);

      // 本文中に偶然"draft: true"という文字列が現れても誤爆しないよう、
      // frontmatterブロック(先頭の---〜次の---)だけを置換対象にする。
      const fmMatch = raw.match(/^(---\n[\s\S]*?\n---)/);
      if (!fmMatch) continue;
      const frontmatter = fmMatch[1];
      const draftMatches = frontmatter.match(/draft:\s*true/g) || [];
      if (draftMatches.length === 0) continue;
      if (draftMatches.length > 1) {
        throw new Error(`${f.filename}: frontmatter内に draft:true が複数箇所見つかりました(想定外のためスキップ)`);
      }

      const updatedFrontmatter = frontmatter.replace(/draft:\s*true/, 'draft: false');
      const updated = updatedFrontmatter + raw.slice(frontmatter.length);
      await githubApi(env, `/repos/${repo}/contents/${encodeURIComponent(f.filename)}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: `Publish: ${f.filename} (approved via Slack by ${clickedBy})`,
          content: utf8ToBase64(updated),
          sha: fileData.sha,
          branch,
        }),
      });
      publishedCount += 1;
    }

    await mergeWithRetry(env, repo, prNumber);

    await updateSlackMessage(
      responseUrl,
      `✅ *${clickedBy}* さんが承認し、PR #${prNumber} を公開しました(${publishedCount}件の記事がdraft:falseになりmergeされました)。`
    );
  } catch (err) {
    console.error('publishPr failed:', err);
    await updateSlackMessage(
      responseUrl,
      `❌ 公開処理に失敗しました: ${err.message}\nPR #${prNumber} は手動で確認してください。`
    );
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();

  const valid = await verifySlackSignature(request, rawBody, env.SLACK_SIGNING_SECRET);
  if (!valid) {
    return new Response('invalid signature', { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get('payload');
  if (!payloadStr) {
    return new Response('no payload', { status: 400 });
  }

  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return new Response('invalid payload', { status: 400 });
  }

  const action = payload.actions?.[0];
  if (!action || action.action_id !== 'approve_publish') {
    return new Response('', { status: 200 });
  }

  let value;
  try {
    value = JSON.parse(action.value);
  } catch {
    return new Response('invalid action value', { status: 400 });
  }

  const clickedBy = payload.user?.username || payload.user?.name || 'unknown';
  context.waitUntil(
    publishPr({
      env,
      repo: value.repo,
      prNumber: value.pr,
      responseUrl: payload.response_url,
      clickedBy,
    })
  );

  return new Response('', { status: 200 });
}
