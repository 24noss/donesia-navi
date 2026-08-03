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
