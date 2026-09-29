import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AFFILIATE_DOMAINS,
  partnerFromHostname,
  partnerFromUrl,
  resolveAffiliateClick,
} from '../src/lib/affiliate.mjs';

describe('partnerFromHostname', () => {
  test('既知ドメイン全件が対応する partner に解決される', () => {
    for (const [domain, partner] of Object.entries(AFFILIATE_DOMAINS)) {
      assert.equal(partnerFromHostname(domain), partner);
    }
  });
  test('サブドメイン(www.等)も一致', () => {
    assert.equal(partnerFromHostname('www.agoda.com'), 'agoda');
    assert.equal(partnerFromHostname('jp.trip.com'), 'tripcom');
  });
  test('大文字・末尾ドットを許容', () => {
    assert.equal(partnerFromHostname('WWW.Klook.COM.'), 'klook');
  });
  test('似た別ドメインは一致しない', () => {
    assert.equal(partnerFromHostname('notwise.com'), null);
    assert.equal(partnerFromHostname('wise.com.evil.example'), null);
    assert.equal(partnerFromHostname('a8.net'), null);
    assert.equal(partnerFromHostname(''), null);
    assert.equal(partnerFromHostname(undefined), null);
  });
});

describe('partnerFromUrl', () => {
  test('絶対URL', () => {
    assert.equal(partnerFromUrl('https://wise.com/invite/dic/shogon67'), 'wise');
    assert.equal(partnerFromUrl('https://px.a8.net/svt/ejp?a8mat=x'), 'a8');
  });
  test('相対URL・mailto・不正URLは null', () => {
    assert.equal(partnerFromUrl('/articles/foo/'), null);
    assert.equal(partnerFromUrl('mailto:info@wise.com'), null);
    assert.equal(partnerFromUrl('http://['), null);
  });
});

describe('resolveAffiliateClick', () => {
  test('data-affiliate 優先・data-placement をそのまま使う', () => {
    assert.deepEqual(
      resolveAffiliateClick({ href: 'https://example.com/x', dataAffiliate: 'wise', dataPlacement: 'sidebar' }),
      { partner: 'wise', placement: 'sidebar', link_url: 'https://example.com/x' },
    );
  });
  test('ドメイン一致 + 記事本文内 -> article-body', () => {
    assert.deepEqual(
      resolveAffiliateClick({ href: 'https://www.agoda.com/a', inArticleBody: true }),
      { partner: 'agoda', placement: 'article-body', link_url: 'https://www.agoda.com/a' },
    );
  });
  test('記事本文外で placement 無し -> other', () => {
    assert.equal(resolveAffiliateClick({ href: 'https://klook.com/', inArticleBody: false }).placement, 'other');
  });
  test('data-placement は本文内でも優先', () => {
    assert.equal(
      resolveAffiliateClick({ href: 'https://klook.com/', inArticleBody: true, dataPlacement: 'cta' }).placement,
      'cta',
    );
  });
  test('対象外リンクは null', () => {
    assert.equal(resolveAffiliateClick({ href: 'https://example.com/', inArticleBody: true }), null);
    assert.equal(resolveAffiliateClick({ href: '/policy/', dataAffiliate: '  ' }), null);
  });
});
