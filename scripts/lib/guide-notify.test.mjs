import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRefreshBlocks, buildTopicsBlocks, detectNotifyKind } from './guide-notify.mjs';

const pr = { number: 42, html_url: 'https://github.com/o/r/pull/42', title: 'タイトル', body: '本文'.repeat(2000) };

describe('detectNotifyKind', () => {
  test('ブランチ名から種類を判定する', () => {
    assert.equal(detectNotifyKind('auto/guide-topics-20260929'), 'topics');
    assert.equal(detectNotifyKind('auto/guide-refresh-x-202610'), 'refresh');
    assert.equal(detectNotifyKind('auto/guide-bali-entry'), 'draft');
    assert.equal(detectNotifyKind('auto/articles-1'), 'draft');
  });
});

describe('Slackブロック', () => {
  const findApprove = (blocks) => blocks.find((b) => b.type === 'actions').elements.find((e) => e.action_id === 'approve_publish');

  test('トピック提案: 承認ボタンは既存の approve_publish、value に pr と repo、文面はトピック用、上限内', () => {
    const blocks = buildTopicsBlocks(pr, 'o/r');
    const btn = findApprove(blocks);
    assert.deepEqual(JSON.parse(btn.value), { pr: 42, repo: 'o/r' });
    assert.match(btn.text.text, /台帳/);
    assert.match(btn.confirm.text.text, /台帳に追加/);
    assert.ok(blocks.every((b) => b.type !== 'section' || b.text.text.length <= 3000));
    assert.ok(!JSON.stringify(blocks).includes('公開'));
  });

  test('改訂PR: merge の確認文面、記事一覧は10件まで', () => {
    const articles = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, title: `記事${i}`, category: 'visa' }));
    const blocks = buildRefreshBlocks(pr, articles, 'https://x.pages.dev', 'o/r');
    assert.match(findApprove(blocks).confirm.text.text, /merge/);
    assert.equal(blocks.filter((b) => b.type === 'section').length, 1 + 10);
    assert.ok(JSON.stringify(blocks).includes('ほか 2 件'));
    assert.ok(JSON.stringify(blocks).includes('https://x.pages.dev/articles/a0/'));
  });

  test('記事0件でもベースライン記録のみのPRは対象 id を列挙して通知できる', () => {
    const blocks = buildRefreshBlocks(pr, [], null, 'o/r', { snapshotIds: ['bali-a', 'bali-b'] });
    const text = JSON.stringify(blocks);
    assert.ok(text.includes('出典ハッシュのみ記録') && text.includes('bali-a') && text.includes('bali-b'));
    assert.ok(!text.includes('プレビューURLを取得できなかった'));
    assert.ok(findApprove(blocks));
  });

  test('プレビューURLが無ければ PR へのリンクと注記', () => {
    const blocks = buildRefreshBlocks(pr, [{ id: 'a', title: 'A' }], null, 'o/r');
    assert.ok(JSON.stringify(blocks).includes('プレビューURLを取得できなかった'));
  });
});
