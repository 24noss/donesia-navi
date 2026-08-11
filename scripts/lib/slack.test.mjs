import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { postSlackMessage } from './slack.mjs';

describe('postSlackMessage', () => {
  test('data.ok:true なら例外を投げずにレスポンスを返す', async () => {
    const originalFetch = globalThis.fetch;
    let calledWith = null;
    globalThis.fetch = async (url, opts) => {
      calledWith = { url, opts };
      return { json: async () => ({ ok: true, ts: '123.456' }) };
    };
    try {
      const result = await postSlackMessage({ token: 'xoxb-test', channel: 'C123', text: 'hello', blocks: [] });
      assert.equal(result.ok, true);
      assert.equal(calledWith.url, 'https://slack.com/api/chat.postMessage');
      assert.equal(calledWith.opts.headers.Authorization, 'Bearer xoxb-test');
      const body = JSON.parse(calledWith.opts.body);
      assert.equal(body.channel, 'C123');
      assert.equal(body.text, 'hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('data.ok:false ならSlack API errorを投げる', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ json: async () => ({ ok: false, error: 'channel_not_found' }) });
    try {
      await assert.rejects(
        () => postSlackMessage({ token: 'xoxb-test', channel: 'C123', text: 'hello', blocks: [] }),
        /Slack API error: channel_not_found/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
