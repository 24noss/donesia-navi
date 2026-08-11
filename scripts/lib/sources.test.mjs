import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGoogleNewsId,
  parseBatchExecuteResponse,
  mapWithConcurrency,
  resolveDirectLink,
  googleNewsSearchUrl,
  getSourcesForLane,
  sources,
  foodSources,
  FOOD_QUERIES,
} from './sources.mjs';

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

describe('googleNewsSearchUrl (foodレーン: site制限なしGoogle News検索RSSのURL組み立て)', () => {
  test('クエリをそのままURLエンコードし、site:を付けないURLを組み立てる', () => {
    const url = googleNewsSearchUrl('restoran baru jakarta when:7d');
    assert.equal(
      url,
      'https://news.google.com/rss/search?q=restoran%20baru%20jakarta%20when%3A7d&hl=id&gl=ID&ceid=ID:id'
    );
    assert.equal(url.includes('site%3A'), false);
    assert.equal(url.includes('site:'), false);
  });

  test('hl=id&gl=ID&ceid=ID:id の固定パラメータを付与する', () => {
    const url = googleNewsSearchUrl('cafe baru jakarta when:7d');
    assert.ok(url.endsWith('&hl=id&gl=ID&ceid=ID:id'));
  });
});

describe('FOOD_QUERIES', () => {
  test('5〜6本のクエリが定義されている', () => {
    assert.ok(FOOD_QUERIES.length >= 5 && FOOD_QUERIES.length <= 6, `件数=${FOOD_QUERIES.length}`);
  });

  test('全クエリが週次実行を想定したwhen:7dを含む', () => {
    assert.ok(FOOD_QUERIES.every((q) => q.includes('when:7d')));
  });

  test('site:指定を含まない（一般検索であることの確認）', () => {
    assert.ok(FOOD_QUERIES.every((q) => !q.includes('site:')));
  });
});

describe('getSourcesForLane (lane解決: news/foodソースの切り替え)', () => {
  test("lane='food' なら foodSources を返す", () => {
    assert.equal(getSourcesForLane('food'), foodSources);
  });

  test("lane='news' なら 既存の sources を返す（後方互換）", () => {
    assert.equal(getSourcesForLane('news'), sources);
  });

  test('未指定・不正な値なら既存の sources にフォールバックする', () => {
    assert.equal(getSourcesForLane(undefined), sources);
    assert.equal(getSourcesForLane('bogus'), sources);
  });

  test('foodSources は detikFood を含む（RSS実在確認済み: food.detik.com/rss）', () => {
    assert.ok(foodSources.some((s) => s.id === 'detikFood'));
  });

  test('foodSources の各エントリが {id, label, fetch} 形式である（既存sourcesと同形式）', () => {
    for (const s of foodSources) {
      assert.equal(typeof s.id, 'string');
      assert.equal(typeof s.label, 'string');
      assert.equal(typeof s.fetch, 'function');
    }
  });

  test('sources（newsレーン）は変更されず4件のまま（既存挙動の後方互換確認）', () => {
    assert.deepEqual(
      sources.map((s) => s.id),
      ['detik', 'antara', 'bmkg', 'kompas']
    );
  });
});
