import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CHARS_PER_SOURCE, applyTotalBudget, fetchSourceText, fetchSources, htmlToText, sha256Hex } from './guide-fetch.mjs';

const LONG = 'これはテスト用の本文です。'.repeat(30); // 210字以上

function res(body, { status = 200, type = 'text/html; charset=utf-8', url } = {}) {
  return new Response(body, { status, headers: { 'content-type': type } }).constructor === Response
    ? Object.defineProperty(new Response(body, { status, headers: { 'content-type': type } }), 'url', { value: url ?? '' })
    : null;
}

describe('htmlToText', () => {
  test('script/style/nav/footer/コメントを除去し、見出しとリストを保つ', () => {
    const html = `<html><head><style>.a{}</style><script>alert(1)</script></head><body><nav>メニュー</nav><!-- c --><h1>見出し</h1><p>本文&amp;続き&nbsp;です</p><ul><li>項目1</li><li>項目2</li></ul><footer>フッター</footer></body></html>`;
    const t = htmlToText(html);
    assert.ok(!t.includes('alert') && !t.includes('メニュー') && !t.includes('フッター') && !t.includes('.a{}'));
    assert.match(t, /## 見出し/);
    assert.match(t, /本文&続き です/);
    assert.match(t, /- 項目1\n- 項目2/);
  });
  test('空白を圧縮し、連続改行を最大2つにする', () => {
    const t = htmlToText('<p>a     b</p>\n\n\n\n<p>c</p>');
    assert.equal(t, 'a b\n\nc');
  });
  test('数値文字参照を復号する', () => {
    assert.equal(htmlToText('<p>&#x3042;&#12356;</p>'), 'あい');
  });
});

describe('fetchSourceText', () => {
  test('成功: テキスト化・1ソース上限で切り詰め・切り詰め後テキストのsha256を返す', async () => {
    const big = `<p>${'あ'.repeat(MAX_CHARS_PER_SOURCE + 500)}</p>`;
    const r = await fetchSourceText('https://a.example/x', { fetchImpl: async () => res(big) });
    assert.equal(r.ok, true);
    assert.equal(r.text.length, MAX_CHARS_PER_SOURCE);
    assert.equal(r.truncated, true);
    assert.equal(r.sha256, sha256Hex(r.text));
  });
  test('User-Agent とタイムアウト用 signal を付けて取得する', async () => {
    let init;
    await fetchSourceText('https://a.example/x', { fetchImpl: async (u, i) => ((init = i), res(`<p>${LONG}</p>`)) });
    assert.match(init.headers['User-Agent'], /donesia-navi/);
    assert.ok(init.signal instanceof AbortSignal);
  });
  test('HTTPエラー・ネットワークエラー・タイムアウトは ok:false', async () => {
    assert.match((await fetchSourceText('https://a.example/', { fetchImpl: async () => res('x', { status: 503 }) })).reason, /HTTP 503/);
    assert.match((await fetchSourceText('https://a.example/', { fetchImpl: async () => { throw new Error('boom'); } })).reason, /boom/);
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    assert.match((await fetchSourceText('https://a.example/', { fetchImpl: async () => { throw timeout; } })).reason, /タイムアウト/);
  });
  test('本文が短すぎる場合は ok:false', async () => {
    assert.match((await fetchSourceText('https://a.example/', { fetchImpl: async () => res('<p>短い</p>') })).reason, /短すぎ/);
  });
  test('PDFなど未対応の Content-Type は ok:false', async () => {
    assert.match((await fetchSourceText('https://a.example/', { fetchImpl: async () => res('%PDF', { type: 'application/pdf' }) })).reason, /Content-Type/);
  });
  test('別ホストへのリダイレクトは採用しない(www 違いは許容)', async () => {
    const other = await fetchSourceText('https://a.example/x', { fetchImpl: async () => res(`<p>${LONG}</p>`, { url: 'https://evil.example/x' }) });
    assert.match(other.reason, /別ホスト/);
    const www = await fetchSourceText('https://a.example/x', { fetchImpl: async () => res(`<p>${LONG}</p>`, { url: 'https://www.a.example/x' }) });
    assert.equal(www.ok, true);
  });
  test('http(s) 以外は取得しない', async () => {
    const r = await fetchSourceText('file:///etc/passwd', { fetchImpl: () => assert.fail('呼ばれないはず') });
    assert.equal(r.ok, false);
  });
});

describe('applyTotalBudget', () => {
  test('合計上限を超えた分は切り詰め、入らないものは omitted', () => {
    const mk = (n, u) => ({ url: u, text: 'x'.repeat(n) });
    const { included, omitted } = applyTotalBudget([mk(12000, 'a'), mk(12000, 'b'), mk(12000, 'c'), mk(12000, 'd')], 40000);
    assert.deepEqual(included.map((s) => s.text.length), [12000, 12000, 12000, 4000]);
    assert.equal(omitted.length, 0);
    const r2 = applyTotalBudget([mk(12000, 'a'), mk(12000, 'b')], 12100);
    assert.equal(r2.included.length, 1);
    assert.equal(r2.omitted.length, 1);
  });
});

describe('fetchSources', () => {
  test('失敗したURLは除外して続行し、同一URLは1回だけ取得する', async () => {
    let calls = 0;
    const fetchImpl = async (u) => (calls++, u.endsWith('bad') ? res('x', { status: 404 }) : res(`<p>${LONG}</p>`));
    const cache = new Map();
    const quiet = { warn() {} , log() {} };
    const refs = [{ url: 'https://a.example/ok', title: 'ok' }, { url: 'https://a.example/bad', title: 'bad' }];
    const r1 = await fetchSources(refs, { fetchImpl, cache, log: quiet });
    assert.equal(r1.ok.length, 1);
    assert.deepEqual(r1.failed.map((f) => f.url), ['https://a.example/bad']);
    await fetchSources(refs, { fetchImpl, cache, log: quiet });
    assert.equal(calls, 2);
  });
});
