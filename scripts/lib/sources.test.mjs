import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractGoogleNewsId, parseBatchExecuteResponse, mapWithConcurrency, resolveDirectLink } from './sources.mjs';

describe('extractGoogleNewsId (D-4: 直リンク解決)', () => {
  test('/rss/articles/<id> 形式のリンクからIDを取り出す', () => {
    const link = 'https://news.google.com/rss/articles/CBMiABC123?oc=5';
    assert.equal(extractGoogleNewsId(link), 'CBMiABC123');
  });

  test('/rss/read/<id> 形式のリンクからIDを取り出す', () => {
    const link = 'https://news.google.com/rss/read/CBMiXYZ789?hl=id';
    assert.equal(extractGoogleNewsId(link), 'CBMiXYZ789');
  });

  test('google.com以外のドメインはnullを返す', () => {
    assert.equal(extractGoogleNewsId('https://kompas.com/read/123'), null);
  });

  test('不正なURL文字列はnullを返す', () => {
    assert.equal(extractGoogleNewsId('not a url'), null);
  });

  test('articles/readセグメントが無いパスはnullを返す', () => {
    assert.equal(extractGoogleNewsId('https://news.google.com/foo/bar'), null);
  });
});

describe('parseBatchExecuteResponse (D-4: Google News内部APIレスポンス解析)', () => {
  test('正常なレスポンスから実記事URLを取り出す', () => {
    const inner = JSON.stringify(['garturlres', 'https://kompas.com/read/123', 1]);
    const outer = JSON.stringify([['wrb.fr', 'Fbv4je', inner, null, null, null, 'generic']]);
    const text = `)]}'\n\n${outer}`;
    assert.equal(parseBatchExecuteResponse(text), 'https://kompas.com/read/123');
  });

  test('wrb.fr行が無ければ例外を投げる', () => {
    const text = `)]}'\n\n${JSON.stringify([['di', 14]])}`;
    assert.throws(() => parseBatchExecuteResponse(text));
  });

  test('想定外のinner形状なら例外を投げる', () => {
    const inner = JSON.stringify(['not-garturlres']);
    const outer = JSON.stringify([['wrb.fr', 'Fbv4je', inner]]);
    const text = `)]}'\n\n${outer}`;
    assert.throws(() => parseBatchExecuteResponse(text));
  });

  test('JSONとして不正なテキストなら例外を投げる', () => {
    assert.throws(() => parseBatchExecuteResponse('これはJSONではない'));
  });
});

describe('mapWithConcurrency', () => {
  test('完了順が前後しても入力順で結果を返す', async () => {
    const items = [30, 10, 20];
    const results = await mapWithConcurrency(
      items,
      3,
      (ms) => new Promise((resolve) => setTimeout(() => resolve(ms), ms))
    );
    assert.deepEqual(results, [30, 10, 20]);
  });

  test('並行数の上限を超えて実行しない', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    });
    assert.ok(maxActive <= 3, `maxActive=${maxActive} は3以下であるべき`);
  });

  test('空配列を渡すとfnを呼ばず空配列を返す', async () => {
    const results = await mapWithConcurrency([], 5, () => {
      throw new Error('呼ばれてはいけない');
    });
    assert.deepEqual(results, []);
  });
});

describe('resolveDirectLink (D-4: fail-open, fetchをモック)', () => {
  test('fetchが例外を投げても元のリンクを返す（fail-open）', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    try {
      const link = 'https://news.google.com/rss/articles/CBMiXYZ?oc=5';
      const result = await resolveDirectLink(link, 50);
      assert.equal(result, link);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('通常のリダイレクトでgoogle.com以外に解決した場合はそのURLを返す', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ url: 'https://kompas.com/read/999', text: async () => '' });
    try {
      const link = 'https://news.google.com/rss/articles/CBMiXYZ?oc=5';
      const result = await resolveDirectLink(link, 50);
      assert.equal(result, 'https://kompas.com/read/999');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('google.comのままでsignature/timestampが見つからなければ元のリンクを返す', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      url: 'https://news.google.com/rss/articles/CBMiXYZ?oc=5&hl=en',
      text: async () => '<html>署名情報なし</html>',
    });
    try {
      const link = 'https://news.google.com/rss/articles/CBMiXYZ?oc=5';
      const result = await resolveDirectLink(link, 50);
      assert.equal(result, link);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('デコードAPIまで到達し正常応答なら実URLを返す', async () => {
    const originalFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = async (url) => {
      call += 1;
      if (call === 1) {
        return {
          url: 'https://news.google.com/rss/articles/CBMiXYZ?oc=5&hl=en',
          text: async () => '<div data-n-a-ts="1234567890" data-n-a-sg="sig-value"></div>',
        };
      }
      const inner = JSON.stringify(['garturlres', 'https://kompas.com/read/decoded', 1]);
      const outer = JSON.stringify([['wrb.fr', 'Fbv4je', inner]]);
      return { text: async () => `)]}'\n\n${outer}` };
    };
    try {
      const link = 'https://news.google.com/rss/articles/CBMiXYZ?oc=5';
      const result = await resolveDirectLink(link, 50);
      assert.equal(result, 'https://kompas.com/read/decoded');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
