import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuggestResponse, fetchGoogleSuggestions } from './google-suggest.mjs';

describe('parseSuggestResponse', () => {
  test('["<クエリ>", ["候補1", "候補2"]] 形式から候補配列を取り出す', () => {
    const data = ['ジャカルタ 会食', ['ジャカルタ 会食 個室', 'ジャカルタ 会食 レストラン']];
    assert.deepEqual(parseSuggestResponse(data), ['ジャカルタ 会食 個室', 'ジャカルタ 会食 レストラン']);
  });

  test('候補が空配列でも空配列を返す', () => {
    assert.deepEqual(parseSuggestResponse(['q', []]), []);
  });

  test('文字列以外の候補要素は除外する', () => {
    const data = ['q', ['ok', 123, null, 'ok2']];
    assert.deepEqual(parseSuggestResponse(data), ['ok', 'ok2']);
  });

  test('配列でないレスポンスは空配列を返す', () => {
    assert.deepEqual(parseSuggestResponse({ foo: 'bar' }), []);
    assert.deepEqual(parseSuggestResponse(null), []);
    assert.deepEqual(parseSuggestResponse(undefined), []);
  });

  test('data[1]が配列でなければ空配列を返す', () => {
    assert.deepEqual(parseSuggestResponse(['q', 'not-an-array']), []);
  });
});

describe('fetchGoogleSuggestions (fetchモック)', () => {
  test('正常レスポンスを候補配列に変換して返す', async () => {
    const originalFetch = globalThis.fetch;
    let calledUrl = null;
    globalThis.fetch = async (url) => {
      calledUrl = url;
      return { ok: true, json: async () => ['ジャカルタ 会食', ['ジャカルタ 会食 個室']] };
    };
    try {
      const result = await fetchGoogleSuggestions('ジャカルタ 会食');
      assert.deepEqual(result, ['ジャカルタ 会食 個室']);
      // ie/oe=utf-8は日本語レスポンスの文字化け防止に必須(google-suggest.mjsのコメント参照)
      assert.match(calledUrl, /^https:\/\/suggestqueries\.google\.com\/complete\/search\?client=firefox&hl=ja&ie=utf-8&oe=utf-8&q=/);
      assert.match(calledUrl, /q=%E3%82%B8%E3%83%A3%E3%82%AB%E3%83%AB%E3%82%BF/); // 「ジャカルタ」のURLエンコード
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('res.ok:false なら例外を投げず空配列を返す(fail-open)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    try {
      const result = await fetchGoogleSuggestions('ジャカルタ 会食');
      assert.deepEqual(result, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('fetchが例外を投げても(タイムアウト等)空配列を返す(fail-open)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network error');
    };
    try {
      const result = await fetchGoogleSuggestions('ジャカルタ 会食');
      assert.deepEqual(result, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('レスポンスJSONが想定外の形状でも例外を投げず空配列を返す', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ unexpected: true }) });
    try {
      const result = await fetchGoogleSuggestions('ジャカルタ 会食');
      assert.deepEqual(result, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
