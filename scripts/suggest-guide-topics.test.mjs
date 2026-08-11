import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  isTopicCovered,
  countCandidatePlaces,
  buildUncoveredTopics,
  buildDraftOnlyCoveredTopics,
  formatDryRunReport,
  buildSlackBlocks,
  TARGET_TOPICS,
  MIN_CANDIDATE_PLACES,
  PRIORITY_ORDER,
} from './suggest-guide-topics.mjs';

describe('parseFrontmatter', () => {
  test('title / tags / category / draft を抽出する', () => {
    const content = [
      '---',
      'title: "ジャカルタのイタリアン5選"',
      'category: "lifestyle"',
      'tags: ["イタリアン", "グルメ", "ジャカルタ"]',
      'draft: false',
      '---',
      '',
      '本文',
    ].join('\n');
    const fm = parseFrontmatter(content);
    assert.equal(fm.title, 'ジャカルタのイタリアン5選');
    assert.equal(fm.category, 'lifestyle');
    assert.deepEqual(fm.tags, ['イタリアン', 'グルメ', 'ジャカルタ']);
    assert.equal(fm.draft, false);
  });

  test('draft: true を正しく真偽値として扱う', () => {
    const content = '---\ntitle: "テスト"\ndraft: true\n---\n\n本文';
    const fm = parseFrontmatter(content);
    assert.equal(fm.draft, true);
  });

  test('draft指定がなければfalse扱い', () => {
    const content = '---\ntitle: "テスト"\n---\n\n本文';
    const fm = parseFrontmatter(content);
    assert.equal(fm.draft, false);
  });

  test('tagsが無ければ空配列を返す', () => {
    const content = '---\ntitle: "テスト"\n---\n\n本文';
    const fm = parseFrontmatter(content);
    assert.deepEqual(fm.tags, []);
  });

  test('frontmatterが無ければnullを返す', () => {
    assert.equal(parseFrontmatter('frontmatterなしの本文だけ'), null);
  });
});

describe('isTopicCovered', () => {
  const topic = { id: 'italian', keywords: ['イタリアン'] };

  test('gourmet記事のtitleにキーワードが含まれていればカバー済み', () => {
    const articles = [{ title: 'ジャカルタのイタリアン5選', category: 'gourmet', tags: [], draft: false }];
    const result = isTopicCovered(topic, articles);
    assert.equal(result.covered, true);
    assert.equal(result.allDraft, false);
  });

  test('lifestyle記事のtitleにキーワードが含まれていてもカバー済み(gourmet限定ではない)', () => {
    const articles = [{ title: 'ジャカルタのイタリアン5選', category: 'lifestyle', tags: [], draft: false }];
    assert.equal(isTopicCovered(topic, articles).covered, true);
  });

  test('2026-08-11〜: tagsのみの一致はカバー済みにしない(混在ガイドのtags誤判定対策)', () => {
    const articles = [{ title: '洋食ガイド', category: 'gourmet', tags: ['イタリアン', 'フレンチ'], draft: false }];
    const result = isTopicCovered(topic, articles);
    assert.equal(result.covered, false);
  });

  test('tagsのみの一致はrelatedTagsOnlyとして返す(部分カバーの参考情報)', () => {
    const articles = [{ title: '洋食ガイド', category: 'gourmet', tags: ['イタリアン', 'フレンチ'], draft: false }];
    const result = isTopicCovered(topic, articles);
    assert.equal(result.relatedTagsOnly.length, 1);
    assert.equal(result.relatedTagsOnly[0].title, '洋食ガイド');
  });

  test('category が gourmet/lifestyle 以外の記事はtitle一致でも判定対象外(交通ニュース等の誤判定防止)', () => {
    // 「ブロックM」エリアトピックが「ブロックM発着バス運賃改定」ニュース記事(category: travel)で
    // 誤ってカバー済み判定される問題の再現ケース。
    const blokMTopic = { id: 'blok-m', keywords: ['ブロックM'] };
    const articles = [{ title: 'ブロックM〜空港間のバス運賃改定', category: 'travel', tags: ['ブロックM'], draft: false }];
    const result = isTopicCovered(blokMTopic, articles);
    assert.equal(result.covered, false);
    assert.equal(result.relatedTagsOnly.length, 0);
  });

  test('一致する記事が無ければ未カバー', () => {
    const articles = [{ title: '韓国料理5選', category: 'gourmet', tags: ['韓国料理'], draft: false }];
    const result = isTopicCovered(topic, articles);
    assert.equal(result.covered, false);
    assert.deepEqual(result.matched, []);
  });

  test('一致する記事が全てdraft:trueならallDraft:trueを返す', () => {
    const articles = [{ title: 'イタリアンガイド(下書き)', category: 'gourmet', tags: [], draft: true }];
    const result = isTopicCovered(topic, articles);
    assert.equal(result.covered, true);
    assert.equal(result.allDraft, true);
  });

  test('draftと公開済みが混在する場合はallDraft:false', () => {
    const articles = [
      { title: 'イタリアンガイド(下書き)', category: 'gourmet', tags: [], draft: true },
      { title: 'イタリアン特集', category: 'gourmet', tags: [], draft: false },
    ];
    const result = isTopicCovered(topic, articles);
    assert.equal(result.covered, true);
    assert.equal(result.allDraft, false);
  });

  test('複数キーワードのいずれかで一致すればカバー済み(寿司/すし)', () => {
    const sushiTopic = { id: 'sushi', keywords: ['寿司', 'すし'] };
    const articles = [{ title: '本格すしランチ', category: 'gourmet', tags: [], draft: false }];
    assert.equal(isTopicCovered(sushiTopic, articles).covered, true);
  });
});

describe('countCandidatePlaces', () => {
  test('cuisine一致かつstatusがclosed以外の件数を数える', () => {
    const topic = { id: 'yakiniku', cuisine: 'japanese', area: null };
    const places = [
      { cuisine: 'japanese', status: 'open' },
      { cuisine: 'japanese', status: 'open' },
      { cuisine: 'japanese', status: 'closed' },
      { cuisine: 'korean', status: 'open' },
    ];
    assert.equal(countCandidatePlaces(topic, places), 2);
  });

  test('areaトピックはareaも一致条件に加える', () => {
    const topic = { id: 'scbd', cuisine: null, area: 'SCBD' };
    const places = [
      { area: 'SCBD', status: 'open' },
      { area: 'SCBD', status: 'closed' },
      { area: 'クマン', status: 'open' },
    ];
    assert.equal(countCandidatePlaces(topic, places), 1);
  });

  test('candidateが0件のケース', () => {
    const topic = { id: 'cafe', cuisine: 'cafe', area: null };
    assert.equal(countCandidatePlaces(topic, []), 0);
  });

  test('nullish/不正な要素が混じっていても落ちない', () => {
    const topic = { id: 'yakiniku', cuisine: 'japanese', area: null };
    const places = [null, { cuisine: 'japanese', status: 'open' }];
    assert.equal(countCandidatePlaces(topic, places), 1);
  });
});

describe('buildUncoveredTopics', () => {
  test('priority順(high→mid→low)で未カバートピックのみ返す', () => {
    const topics = [
      { id: 'a', keywords: ['A'], cuisine: null, area: null, priority: 'low' },
      { id: 'b', keywords: ['B'], cuisine: null, area: null, priority: 'high' },
      { id: 'c', keywords: ['C'], cuisine: null, area: null, priority: 'mid' },
    ];
    // 'B' はすでにカバー済み記事がある想定
    const articlesMeta = [{ title: 'Bガイド', category: 'gourmet', tags: [], draft: false }];
    const result = buildUncoveredTopics(topics, articlesMeta, []);

    assert.equal(result.length, 2);
    assert.deepEqual(result.map((r) => r.topic.id), ['c', 'a']);
  });

  test('全トピックカバー済みなら空配列を返す', () => {
    const topics = [{ id: 'a', keywords: ['A'], cuisine: null, area: null, priority: 'high' }];
    const articlesMeta = [{ title: 'Aガイド', category: 'gourmet', tags: [], draft: false }];
    assert.deepEqual(buildUncoveredTopics(topics, articlesMeta, []), []);
  });
});

describe('buildDraftOnlyCoveredTopics', () => {
  test('draft:trueのみで一致したトピックだけを返す', () => {
    const topics = [
      { id: 'a', keywords: ['A'] },
      { id: 'b', keywords: ['B'] },
      { id: 'c', keywords: ['C'] },
    ];
    const articlesMeta = [
      { title: 'Aガイド(下書き)', category: 'gourmet', tags: [], draft: true }, // a: draftのみで一致 → 対象
      { title: 'Bガイド', category: 'gourmet', tags: [], draft: false }, // b: 公開済みで一致 → 対象外
      // c: 一致なし → 対象外
    ];
    const result = buildDraftOnlyCoveredTopics(topics, articlesMeta);
    assert.equal(result.length, 1);
    assert.equal(result[0].topic.id, 'a');
  });

  test('一致が無ければ空配列', () => {
    const topics = [{ id: 'a', keywords: ['A'] }];
    assert.deepEqual(buildDraftOnlyCoveredTopics(topics, []), []);
  });
});

describe('formatDryRunReport', () => {
  test('未カバートピックが無ければ「提案なし」の文言を返す', () => {
    const report = formatDryRunReport([]);
    assert.match(report, /提案なし/);
  });

  test('未カバートピックの件数・優先度・理由・候補店舗数を含む', () => {
    const entries = [
      {
        topic: { id: 'italian', label: 'イタリアン単体ガイド', priority: 'high', rationale: 'テスト理由' },
        candidateCount: 5,
      },
    ];
    const report = formatDryRunReport(entries);
    assert.match(report, /未カバートピック: 1件/);
    assert.match(report, /イタリアン単体ガイド/);
    assert.match(report, /テスト理由/);
    assert.match(report, /5店/);
  });

  test('候補店舗数がMIN_CANDIDATE_PLACES未満なら要ディスカバリーと付記する', () => {
    const entries = [
      {
        topic: { id: 'cafe', label: 'カフェガイド', priority: 'high', rationale: 'テスト理由' },
        candidateCount: MIN_CANDIDATE_PLACES - 1,
      },
    ];
    const report = formatDryRunReport(entries);
    assert.match(report, /要ディスカバリー/);
    assert.match(report, /npm run discover-restaurants/);
  });

  test('候補店舗数がMIN_CANDIDATE_PLACES以上なら要ディスカバリーを付記しない', () => {
    const entries = [
      {
        topic: { id: 'yakiniku', label: '焼肉ガイド', priority: 'high', rationale: 'テスト理由' },
        candidateCount: MIN_CANDIDATE_PLACES,
      },
    ];
    const report = formatDryRunReport(entries);
    assert.doesNotMatch(report, /要ディスカバリー/);
  });

  test('draftOnlyEntriesを渡すと(draft)付きの参考セクションを追加する', () => {
    const entries = [
      {
        topic: { id: 'yakiniku', label: '焼肉ガイド', priority: 'high', rationale: 'テスト理由' },
        candidateCount: 5,
      },
    ];
    const draftOnlyEntries = [{ topic: { id: 'cafe', label: 'カフェガイド' } }];
    const report = formatDryRunReport(entries, draftOnlyEntries);
    assert.match(report, /カフェガイド \(cafe\) \(draft\)/);
  });

  test('未カバー0件でもdraftOnlyEntriesがあれば(draft)付きの参考セクションを追加する', () => {
    const draftOnlyEntries = [{ topic: { id: 'cafe', label: 'カフェガイド' } }];
    const report = formatDryRunReport([], draftOnlyEntries);
    assert.match(report, /提案なし/);
    assert.match(report, /カフェガイド \(cafe\) \(draft\)/);
  });

  test('coverage.relatedTagsOnlyがあれば「関連記事あり(部分カバー)」を表示する', () => {
    const entries = [
      {
        topic: { id: 'italian', label: 'イタリアン単体ガイド', priority: 'high', rationale: 'r' },
        candidateCount: 5,
        coverage: { relatedTagsOnly: [{ title: '洋食・ヨーロッパ料理レストラン5選' }] },
      },
    ];
    const report = formatDryRunReport(entries);
    assert.match(report, /関連記事あり\(部分カバー/);
    assert.match(report, /洋食・ヨーロッパ料理レストラン5選/);
  });

  test('coverage.relatedTagsOnlyが空/未指定なら関連記事の行は出さない', () => {
    const entries = [
      {
        topic: { id: 'yakiniku', label: '焼肉ガイド', priority: 'high', rationale: 'r' },
        candidateCount: 5,
        coverage: { relatedTagsOnly: [] },
      },
    ];
    const report = formatDryRunReport(entries);
    assert.doesNotMatch(report, /関連記事あり/);
  });
});

describe('buildSlackBlocks', () => {
  test('見出しブロックと各トピックのsectionブロックを含む', () => {
    const entries = [
      {
        topic: { id: 'italian', label: 'イタリアン単体ガイド', priority: 'high', rationale: 'テスト理由' },
        candidateCount: 5,
      },
      {
        topic: { id: 'cafe', label: 'カフェガイド', priority: 'high', rationale: 'テスト理由2' },
        candidateCount: 0,
      },
    ];
    const blocks = buildSlackBlocks(entries);

    assert.equal(blocks[0].type, 'header');
    assert.equal(blocks[0].text.text, '📝 今週のガイド記事提案');

    const sectionBlocks = blocks.filter((b) => b.type === 'section');
    assert.equal(sectionBlocks.length, 2);
    assert.match(sectionBlocks[0].text.text, /イタリアン単体ガイド/);
    assert.match(sectionBlocks[0].text.text, /テスト理由/);
    assert.match(sectionBlocks[0].text.text, /5店/);
    assert.match(sectionBlocks[1].text.text, /要ディスカバリー/);
  });

  test('draftOnlyEntriesを渡すと(draft)付きのcontextブロックを追加する', () => {
    const entries = [{ topic: { id: 'yakiniku', label: '焼肉ガイド', priority: 'high', rationale: 'r' }, candidateCount: 5 }];
    const draftOnlyEntries = [{ topic: { id: 'cafe', label: 'カフェガイド' } }];
    const blocks = buildSlackBlocks(entries, draftOnlyEntries);
    const contextBlocks = blocks.filter((b) => b.type === 'context');
    assert.ok(contextBlocks.some((b) => /カフェガイド \(draft\)/.test(b.elements[0].text)));
  });

  test('coverage.relatedTagsOnlyがあればsectionテキストに「関連記事あり(部分カバー)」を含む', () => {
    const entries = [
      {
        topic: { id: 'italian', label: 'イタリアン単体ガイド', priority: 'high', rationale: 'r' },
        candidateCount: 5,
        coverage: { relatedTagsOnly: [{ title: '洋食・ヨーロッパ料理レストラン5選' }] },
      },
    ];
    const blocks = buildSlackBlocks(entries);
    const sectionBlocks = blocks.filter((b) => b.type === 'section');
    assert.match(sectionBlocks[0].text.text, /関連記事あり\(部分カバー/);
    assert.match(sectionBlocks[0].text.text, /洋食・ヨーロッパ料理レストラン5選/);
  });
});

describe('TARGET_TOPICS / PRIORITY_ORDER 整合性', () => {
  test('全トピックがpriority(high/mid/low)のいずれかを持つ', () => {
    for (const topic of TARGET_TOPICS) {
      assert.ok(Object.keys(PRIORITY_ORDER).includes(topic.priority), `${topic.id} のpriorityが不正: ${topic.priority}`);
    }
  });

  test('全トピックがid/keywords/rationaleを持つ', () => {
    for (const topic of TARGET_TOPICS) {
      assert.ok(topic.id, 'idが空のトピックがある');
      assert.ok(Array.isArray(topic.keywords) && topic.keywords.length > 0, `${topic.id} のkeywordsが空`);
      assert.ok(topic.rationale, `${topic.id} のrationaleが空`);
    }
  });

  test('idが重複していない', () => {
    const ids = TARGET_TOPICS.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('15〜20トピック程度である', () => {
    assert.ok(TARGET_TOPICS.length >= 15 && TARGET_TOPICS.length <= 20, `件数: ${TARGET_TOPICS.length}`);
  });
});
