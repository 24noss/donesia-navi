import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeYaml,
  validateArticle,
  slugify,
  buildMarkdown,
  parseGeminiArticlesResponse,
  parseFrontmatterBlock,
  fetchOpenPrDedupeData,
  resolveLane,
  isDryRun,
  callGeminiApi,
  geminiApiUrl,
  GEMINI_MODEL_PRIMARY,
  GEMINI_MODEL_FALLBACK,
} from './crawl-and-draft.mjs';

describe('escapeYaml', () => {
  test('バックスラッシュとダブルクォートをエスケープする', () => {
    assert.equal(escapeYaml('a"b\\c'), 'a\\"b\\\\c');
  });

  test('文字列でない値も String() を通してエスケープする', () => {
    assert.equal(escapeYaml(123), '123');
  });
});

describe('validateArticle', () => {
  const validArticle = () => ({
    title: 'タイトル',
    description: '説明文',
    category: 'society',
    tags: ['タグ1'],
    source: 'Kompas',
    sourceUrl: 'https://example.com/a',
    heading: '見出し',
    keyPoints: ['要点1'],
    body: '本文',
  });

  test('正しい記事は問題なしの空配列を返す', () => {
    assert.deepEqual(validateArticle(validArticle()), []);
  });

  test('category が gourmet でも問題なしと判定する（食レーン用カテゴリ追加の確認）', () => {
    const article = { ...validArticle(), category: 'gourmet' };
    assert.deepEqual(validateArticle(article), []);
  });

  test('placeCandidates が無くても必須項目扱いにしない（optional）', () => {
    const article = validArticle();
    assert.equal('placeCandidates' in article, false);
    assert.deepEqual(validateArticle(article), []);
  });

  test('placeCandidates が付与されていても無視して検証を通す', () => {
    const article = {
      ...validArticle(),
      category: 'gourmet',
      placeCandidates: [{ name: 'Sushi Tei', area: 'Senopati', cuisine: '日本食' }],
    };
    assert.deepEqual(validateArticle(article), []);
  });

  test('title が空なら検出する', () => {
    const article = { ...validArticle(), title: '' };
    assert.ok(validateArticle(article).some((p) => p.includes('title')));
  });

  test('category が不正な値なら検出する', () => {
    const article = { ...validArticle(), category: 'not-a-category' };
    assert.ok(validateArticle(article).some((p) => p.includes('category')));
  });

  test('sourceUrl が不正なURLなら検出する', () => {
    const article = { ...validArticle(), sourceUrl: 'not-a-url' };
    assert.ok(validateArticle(article).some((p) => p.includes('sourceUrl')));
  });

  test('tags / keyPoints が空配列なら両方検出する', () => {
    const article = { ...validArticle(), tags: [], keyPoints: [] };
    const problems = validateArticle(article);
    assert.ok(problems.some((p) => p.includes('tags')));
    assert.ok(problems.some((p) => p.includes('keyPoints')));
  });
});

describe('slugify', () => {
  test('小文字化してハイフン区切りにする', () => {
    assert.equal(slugify('Hello World!'), 'hello-world');
  });

  test('発音区別符号を除去する', () => {
    assert.equal(slugify('Café Déjà Vu'), 'cafe-deja-vu');
  });

  test('英数字が残らない場合は article にフォールバックする', () => {
    assert.equal(slugify('!!!'), 'article');
  });

  test('60文字にスライスされる', () => {
    const long = 'a'.repeat(100);
    assert.equal(slugify(long).length, 60);
  });
});

describe('buildMarkdown', () => {
  test('frontmatterとdraft:trueを含んだMarkdownを生成する', () => {
    const article = {
      title: 'テスト記事',
      description: '説明',
      category: 'society',
      tags: ['タグA', 'タグB'],
      source: 'Kompas',
      sourceUrl: 'https://example.com/news/1',
      heading: '本文見出し',
      keyPoints: ['要点1', '要点2'],
      body: '本文テキストです。',
    };
    const md = buildMarkdown(article, '2026-08-03');

    assert.match(md, /^---\n/);
    assert.match(md, /draft: true/);
    assert.match(md, /pubDate: 2026-08-03/);
    assert.match(md, /## 本文見出し/);
    assert.match(md, /- 要点1/);
    assert.match(md, /\*\*カテゴリ:\*\* 社会・政治/);
    assert.match(md, /\[Kompas\]\(https:\/\/example\.com\/news\/1\)/);
  });

  test('placeCandidatesが付与されていてもfrontmatter・本文に出力しない（無視する）', () => {
    const article = {
      title: 'グルメ記事',
      description: '説明',
      category: 'gourmet',
      tags: ['グルメ'],
      source: 'Detik',
      sourceUrl: 'https://example.com/food/1',
      heading: '本文見出し',
      keyPoints: ['要点1'],
      body: '本文テキストです。',
      placeCandidates: [{ name: 'Sushi Tei', area: 'Senopati', cuisine: '日本食' }],
    };
    const md = buildMarkdown(article, '2026-08-11');
    assert.equal(md.includes('placeCandidates'), false);
    assert.equal(md.includes('Sushi Tei'), false);
    assert.match(md, /\*\*カテゴリ:\*\* グルメ・レストラン/);
  });
});

describe('resolveLane (レーン決定: --lane= > CRAWL_LANE > デフォルトnews)', () => {
  test('CLI引数 --lane=food が最優先される', () => {
    assert.equal(resolveLane(['--lane=food'], { CRAWL_LANE: 'news' }), 'food');
  });

  test('CLI引数が無ければ環境変数CRAWL_LANEを見る', () => {
    assert.equal(resolveLane([], { CRAWL_LANE: 'food' }), 'food');
  });

  test('CLI引数・環境変数どちらも無ければnewsをデフォルトにする', () => {
    assert.equal(resolveLane([], {}), 'news');
  });

  test('CLI引数が不正な値ならCRAWL_LANEにフォールバックする', () => {
    assert.equal(resolveLane(['--lane=invalid'], { CRAWL_LANE: 'food' }), 'food');
  });

  test('CLI引数・環境変数とも不正な値ならnewsにフォールバックする', () => {
    assert.equal(resolveLane(['--lane=invalid'], { CRAWL_LANE: 'bogus' }), 'news');
  });

  test('--lane=news を明示指定した場合はnewsを返す（既存の暗黙デフォルトと同じ結果になることの確認）', () => {
    assert.equal(resolveLane(['--lane=news'], { CRAWL_LANE: 'food' }), 'news');
  });
});

describe('isDryRun', () => {
  test('--dry-run が含まれていればtrue', () => {
    assert.equal(isDryRun(['--lane=food', '--dry-run']), true);
  });

  test('--dry-run が無ければfalse', () => {
    assert.equal(isDryRun(['--lane=food']), false);
  });

  test('引数無しでもエラーにならずfalseを返す', () => {
    assert.equal(isDryRun([]), false);
  });
});

describe('parseGeminiArticlesResponse (D-5: 構造化出力パース強化)', () => {
  test('responseSchema想定経路: 素のJSON配列をそのままパースする', () => {
    const text = '[{"title":"a"}]';
    assert.deepEqual(parseGeminiArticlesResponse(text), [{ title: 'a' }]);
  });

  test('フォールバック1: ```json フェンス内から抽出する', () => {
    const text = '前置き\n```json\n[{"title":"b"}]\n```\n後書き';
    assert.deepEqual(parseGeminiArticlesResponse(text), [{ title: 'b' }]);
  });

  test('フォールバック2: フェンスが無ければ角括弧の正規表現で抽出する', () => {
    const text = '前置き [{"title":"c"}] 後書き';
    assert.deepEqual(parseGeminiArticlesResponse(text), [{ title: 'c' }]);
  });

  test('何も抽出できなければ例外を投げる', () => {
    assert.throws(() => parseGeminiArticlesResponse('json配列を含まないテキスト'));
  });

  test('パースできても配列でなければ例外を投げる', () => {
    assert.throws(() => parseGeminiArticlesResponse('{"not":"array"}'));
  });
});

describe('callGeminiApi (リトライ+指数バックオフ+フォールバックモデル)', () => {
  const jsonResponse = (text) => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  });
  const errorResponse = (status, body = 'error') => ({
    ok: false,
    status,
    text: async () => body,
  });
  const fakeSleep = (log) => async (ms) => {
    log.push(ms);
  };

  test('503が2回続いた後に成功したらプライマリモデル内でリトライして結果を返す', async () => {
    const originalFetch = globalThis.fetch;
    const calledUrls = [];
    let callCount = 0;
    globalThis.fetch = async (url) => {
      calledUrls.push(String(url));
      callCount += 1;
      if (callCount <= 2) return errorResponse(503, 'high demand');
      return jsonResponse('[{"title":"ok"}]');
    };
    const sleeps = [];
    try {
      const data = await callGeminiApi('prompt', { sleep: fakeSleep(sleeps) });
      assert.equal(callCount, 3);
      assert.ok(calledUrls.every((u) => u === geminiApiUrl(GEMINI_MODEL_PRIMARY)));
      assert.deepEqual(sleeps, [30000, 90000]);
      assert.equal(data.candidates[0].content.parts[0].text, '[{"title":"ok"}]');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('プライマリモデルが3回とも失敗したらフォールバックモデルのURLで呼び出される', async () => {
    const originalFetch = globalThis.fetch;
    const calledUrls = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      calledUrls.push(u);
      if (u === geminiApiUrl(GEMINI_MODEL_PRIMARY)) return errorResponse(503, 'high demand');
      return jsonResponse('[{"title":"fallback-ok"}]');
    };
    const sleeps = [];
    try {
      const data = await callGeminiApi('prompt', { sleep: fakeSleep(sleeps) });
      const primaryCalls = calledUrls.filter((u) => u === geminiApiUrl(GEMINI_MODEL_PRIMARY)).length;
      const fallbackCalls = calledUrls.filter((u) => u === geminiApiUrl(GEMINI_MODEL_FALLBACK)).length;
      assert.equal(primaryCalls, 3);
      assert.equal(fallbackCalls, 1);
      assert.equal(data.candidates[0].content.parts[0].text, '[{"title":"fallback-ok"}]');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('プライマリ・フォールバックとも全滅したら最後のエラーをthrowする', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return errorResponse(503, 'high demand');
    };
    const sleeps = [];
    try {
      await assert.rejects(
        () => callGeminiApi('prompt', { sleep: fakeSleep(sleeps) }),
        /Gemini API error 503/
      );
      assert.equal(callCount, 5); // プライマリ3回 + フォールバック2回
      assert.deepEqual(sleeps, [30000, 90000, 180000]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('400エラー(429以外)は即座にthrowしリトライしない', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return errorResponse(400, 'bad request');
    };
    const sleepCalled = { value: false };
    const sleep = async () => {
      sleepCalled.value = true;
    };
    try {
      await assert.rejects(() => callGeminiApi('prompt', { sleep }), /Gemini API error 400/);
      assert.equal(callCount, 1);
      assert.equal(sleepCalled.value, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('ネットワークエラー(fetch reject)はリトライ対象になる', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      if (callCount === 1) throw new TypeError('fetch failed');
      return jsonResponse('[{"title":"network-retry-ok"}]');
    };
    const sleeps = [];
    try {
      const data = await callGeminiApi('prompt', { sleep: fakeSleep(sleeps) });
      assert.equal(callCount, 2);
      assert.deepEqual(sleeps, [30000]);
      assert.equal(data.candidates[0].content.parts[0].text, '[{"title":"network-retry-ok"}]');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('parseFrontmatterBlock', () => {
  test('sourceUrl / title / pubDate を抽出する', () => {
    const content = '---\ntitle: "こんにちは"\nsourceUrl: "https://x.com/a"\npubDate: 2026-08-01\n---\n\n本文';
    const fm = parseFrontmatterBlock(content);
    assert.equal(fm.title, 'こんにちは');
    assert.equal(fm.sourceUrl, 'https://x.com/a');
    assert.equal(fm.pubDate, '2026-08-01');
  });

  test('frontmatterが無ければnullを返す', () => {
    assert.equal(parseFrontmatterBlock('frontmatterなしの本文だけ'), null);
  });
});

describe('fetchOpenPrDedupeData (D-6: オープンPRの重複排除)', () => {
  test('GITHUB_TOKEN/GITHUB_REPOSITORYが無ければネットワークアクセスせずスキップする', async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      throw new Error('呼ばれてはいけない');
    };
    try {
      const result = await fetchOpenPrDedupeData({ token: undefined, repo: undefined });
      assert.deepEqual([...result.sourceUrls], []);
      assert.deepEqual(result.titles, []);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('GitHub APIエラー時はfail-open（警告して空データで継続）', async () => {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'server error' });
    try {
      const result = await fetchOpenPrDedupeData({ token: 'tok', repo: 'owner/repo' });
      assert.deepEqual([...result.sourceUrls], []);
      assert.deepEqual(result.titles, []);
      assert.equal(warned, true);
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });

  test('GitHub APIが200で配列以外の想定外形状を返してもクラッシュせずfail-openする', async () => {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    // /pulls?state=open が配列ではなくオブジェクトを返す想定外ケース
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ message: 'unexpected shape' }) });
    try {
      const result = await fetchOpenPrDedupeData({ token: 'tok', repo: 'owner/repo' });
      assert.deepEqual([...result.sourceUrls], []);
      assert.deepEqual(result.titles, []);
      assert.equal(warned, true);
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });

  test('PRのファイル一覧が配列以外の想定外形状でも他のPRの処理を続行する', async () => {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    console.warn = () => {};

    const md = '---\ntitle: "正常PR"\nsourceUrl: "https://kompas.com/ok"\npubDate: 2026-08-01\n---\n\n本文';
    const base64Content = Buffer.from(md, 'utf-8').toString('base64');

    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/pulls?state=open')) {
        return {
          ok: true,
          json: async () => [
            { number: 1, head: { sha: 'bad' } }, // このPRのfiles取得が想定外形状を返す
            { number: 2, head: { sha: 'good' } },
          ],
        };
      }
      if (u.includes('/pulls/1/files')) {
        return { ok: true, json: async () => ({ message: 'not an array' }) };
      }
      if (u.includes('/pulls/2/files')) {
        return { ok: true, json: async () => [{ filename: 'src/content/articles/2026-08-01-ok.md', status: 'added' }] };
      }
      if (u.includes('/contents/')) {
        return { ok: true, json: async () => ({ content: base64Content }) };
      }
      throw new Error('想定外のURL: ' + u);
    };

    try {
      const result = await fetchOpenPrDedupeData({ token: 'tok', repo: 'owner/repo' });
      assert.ok(result.sourceUrls.has('https://kompas.com/ok'));
      assert.ok(result.titles.includes('正常PR'));
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });

  test('オープンPRの追加ファイルからsourceUrl/titleを収集する', async () => {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    console.warn = () => {};

    const md = '---\ntitle: "PR記事"\nsourceUrl: "https://kompas.com/x"\npubDate: 2026-08-01\n---\n\n本文';
    const base64Content = Buffer.from(md, 'utf-8').toString('base64');

    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/pulls?state=open')) {
        return { ok: true, json: async () => [{ number: 1, head: { sha: 'abc123' } }] };
      }
      if (u.includes('/pulls/1/files')) {
        return {
          ok: true,
          json: async () => [
            { filename: 'src/content/articles/2026-08-01-x.md', status: 'added' },
            { filename: 'src/content/articles/2026-07-01-old.md', status: 'modified' }, // added以外は除外される
          ],
        };
      }
      if (u.includes('/contents/')) {
        return { ok: true, json: async () => ({ content: base64Content }) };
      }
      throw new Error('想定外のURL: ' + u);
    };

    try {
      const result = await fetchOpenPrDedupeData({ token: 'tok', repo: 'owner/repo' });
      assert.ok(result.sourceUrls.has('https://kompas.com/x'));
      assert.ok(result.titles.includes('PR記事'));
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });
});
