// Slack chat.postMessage の共通ラッパー。
// scripts/notify-draft-pr.mjs の postSlackMessage(pr, articles, previewUrl) と
// 同じ呼び出し方式(fetch + chat.postMessage + data.ok チェック)を踏襲しつつ、
// 呼び出し側でBlock Kitを組み立てる用途向けに汎用化したもの。
//
// notify-draft-pr.mjs 自体は今回リファクタしていない(重複は許容)。
// 将来的にはnotify-draft-pr.mjs側もこのlibに寄せられる。

const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

export async function postSlackMessage({ token, channel, text, blocks }) {
  const res = await fetch(SLACK_POST_MESSAGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ channel, text, blocks }),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data;
}
