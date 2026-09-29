// ガイドパイプライン用のSlack通知ブロック(トピック提案PR・既存記事の改訂PR)。
// 承認ボタンの action_id は既存の approve_publish のまま(functions/api/slack-interactivity.js が
// 「draft:true の記事があれば draft:false にし、無ければそのまま merge」する)。

import { REFRESH_BRANCH_PREFIX, TOPICS_BRANCH_PREFIX } from './guide-topics.mjs';

const SECTION_TEXT_MAX = 2800; // Slack section の上限は3000字
const MAX_LISTED_ARTICLES = 10;

/** PRのブランチ名から通知の種類を決める: 'topics' | 'refresh' | 'draft'(従来の新規ドラフト記事) */
export function detectNotifyKind(headRef) {
  if (typeof headRef === 'string' && headRef.startsWith(TOPICS_BRANCH_PREFIX)) return 'topics';
  if (typeof headRef === 'string' && headRef.startsWith(REFRESH_BRANCH_PREFIX)) return 'refresh';
  return 'draft';
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function actionsBlock(pr, repo, { confirmTitle, confirmText, confirmButton, approveLabel }) {
  return {
    type: 'actions',
    block_id: 'draft_pr_actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: approveLabel },
        style: 'primary',
        action_id: 'approve_publish',
        value: JSON.stringify({ pr: pr.number, repo }),
        confirm: {
          title: { type: 'plain_text', text: confirmTitle },
          text: { type: 'mrkdwn', text: confirmText },
          confirm: { type: 'plain_text', text: confirmButton },
          deny: { type: 'plain_text', text: 'キャンセル' },
        },
      },
      { type: 'button', text: { type: 'plain_text', text: 'PRを見る' }, url: pr.html_url },
    ],
  };
}

/** トピック提案PR(台帳のみの変更)の通知。記事ファイルが無いのでプレビューは待たない。 */
export function buildTopicsBlocks(pr, repo) {
  return [
    { type: 'header', text: { type: 'plain_text', text: '🗂 バリ向けガイドのトピック提案' } },
    { type: 'section', text: { type: 'mrkdwn', text: `*<${pr.html_url}|${pr.title}>*\n${truncate(pr.body, SECTION_TEXT_MAX - 200)}` } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '承認すると台帳(guide-topics.json)に追加され、queued のトピックは毎日の生成ワークフローが順に下書き記事にします。不要な案はPR上で削除するか、PRをcloseしてください。' }],
    },
    actionsBlock(pr, repo, {
      confirmTitle: '台帳への追加の確認',
      confirmText: `PR #${pr.number} をmergeし、提案トピックを台帳に追加します。よろしいですか？`,
      confirmButton: '追加する',
      approveLabel: '✅ 承認して台帳に追加',
    }),
  ];
}

/** 公開済み記事の改訂・出典確認PRの通知(draft:false のまま、merge のみで反映される)。 */
// baselineIds: 記事ファイルは変わらず出典ハッシュ(スナップショット)だけ記録するPRの対象 id(記事0件でも通知するため)。
export function buildRefreshBlocks(pr, articles, previewUrl, repo, { snapshotIds = [] } = {}) {
  const blocks = [{ type: 'header', text: { type: 'plain_text', text: `🔄 ガイド記事の改訂・出典確認 (${articles.length}件)` } }];
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*<${pr.html_url}|${pr.title}>*\n${truncate(pr.body, 1200)}` } });
  const articleIds = new Set(articles.map((a) => a.id));
  const baselineOnly = snapshotIds.filter((id) => !articleIds.has(id));
  if (baselineOnly.length > 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: truncate(`出典ハッシュのみ記録(記事ファイルの変更なし): ${baselineOnly.map((id) => `\`${id}\``).join(', ')}`, SECTION_TEXT_MAX) } });
  }
  for (const a of articles.slice(0, MAX_LISTED_ARTICLES)) {
    const link = previewUrl ? `${previewUrl}/articles/${a.id}/` : pr.html_url;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*<${link}|${a.title || a.id}>*\nカテゴリ: ${a.category || '不明'}` } });
  }
  if (articles.length > MAX_LISTED_ARTICLES) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `ほか ${articles.length - MAX_LISTED_ARTICLES} 件はPRを参照してください。` }] });
  }
  if (!previewUrl && articles.length > 0) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '⚠️ プレビューURLを取得できなかったため、上記リンクはPR本体を指しています。' }] });
  }
  blocks.push(
    actionsBlock(pr, repo, {
      confirmTitle: 'mergeの確認',
      confirmText: `PR #${pr.number} をそのままmergeします(記事は公開済みのため、変更内容が本番に反映されます)。よろしいですか？`,
      confirmButton: 'mergeする',
      approveLabel: '✅ 承認してmerge',
    })
  );
  return blocks;
}
