// ガイド記事用の出典ページ取得(公的機関・一次情報の公開ページの本文のみ)。
//
// 取得対象は台帳(guide-topics.json / official-sources.json)に登録されたURLだけ。
// 呼び出し側が渡した URL 以外は決して取得しない(モデルが返したURLを取得する経路は存在しない)。
// ニュース記事のような全文スクレイピングとは目的が異なる(AGENTS.md 絶対ルール4)。

import crypto from 'node:crypto';
import { isHttpUrl } from './guide-topics.mjs';

export const FETCH_TIMEOUT_MS = 20_000;
export const MAX_CHARS_PER_SOURCE = 12_000;
export const MAX_CHARS_TOTAL = 40_000;
// 本文がこれ未満なら「取れていない」(JS描画・ブロック・エラーページ)とみなす。
export const MIN_SOURCE_CHARS = 200;
export const USER_AGENT = 'donesia-navi-guide-bot/1.0 (+https://indonesia-navi.com)';

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...' };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITY_MAP[name.toLowerCase()] ?? m);
}

function safeFromCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/** HTML → 読みやすいプレーンテキスト。script/style/nav/footer 等を除去し、空白を圧縮する。 */
export function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of ['script', 'style', 'noscript', 'svg', 'nav', 'footer', 'template']) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ');
  }
  s = s.replace(/<h[1-6]\b[^>]*>/gi, '\n\n## ');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|section|article|main|tr|table|ul|ol|h[1-6]|dt|dd|blockquote|pre)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t 　]+/g, ' ').trim())
    .join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

export function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function hostKey(url) {
  return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
}

/**
 * 1URLを取得してテキスト化する。失敗は例外にせず { ok:false, reason } で返す(呼び出し側で除外して続行するため)。
 * 成功時: text は1ソース上限(MAX_CHARS_PER_SOURCE)で切り詰め済み、sha256 はその切り詰め後テキストのハッシュ
 * (他ソースの分量に影響されず、モデルが実際に読んだ範囲の変化だけを検知するため)。
 */
export async function fetchSourceText(url, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (!isHttpUrl(url)) return { ok: false, url, reason: 'http(s) URL ではありません' };
  let res;
  try {
    res = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1' },
    });
  } catch (err) {
    return { ok: false, url, reason: `取得エラー: ${err.name === 'TimeoutError' ? `タイムアウト(${timeoutMs / 1000}秒)` : err.message}` };
  }
  if (!res.ok) return { ok: false, url, reason: `HTTP ${res.status}` };

  // 台帳外ホストへのリダイレクトは採用しない(台帳由来のURLのみ、という原則を守る)。
  if (res.url) {
    try {
      if (hostKey(res.url) !== hostKey(url)) return { ok: false, url, reason: `別ホストへリダイレクトされました: ${res.url}` };
    } catch {
      // res.url が解釈できない場合は無視
    }
  }

  const contentType = (res.headers?.get?.('content-type') || '').toLowerCase();
  const isHtml = contentType === '' || contentType.includes('html');
  const isText = contentType.startsWith('text/');
  if (!isHtml && !isText) return { ok: false, url, reason: `未対応の Content-Type: ${contentType}` };

  let raw;
  try {
    raw = await res.text();
  } catch (err) {
    return { ok: false, url, reason: `本文読み取りエラー: ${err.message}` };
  }
  const text = (contentType.includes('html') || contentType === '' ? htmlToText(raw) : raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
  if (text.length < MIN_SOURCE_CHARS) return { ok: false, url, reason: `本文が短すぎます(${text.length}字。JS描画・アクセス制限の可能性)` };

  const capped = text.slice(0, MAX_CHARS_PER_SOURCE);
  return { ok: true, url, text: capped, sha256: sha256Hex(capped), truncated: text.length > MAX_CHARS_PER_SOURCE, fetchedAt: new Date().toISOString() };
}

/** 合計上限内に収める(先頭のソースから優先)。上限を超えて入らないソースは omitted に入れる。 */
export function applyTotalBudget(sources, maxTotal = MAX_CHARS_TOTAL) {
  const included = [];
  const omitted = [];
  let used = 0;
  for (const s of sources) {
    const remaining = maxTotal - used;
    if (remaining < MIN_SOURCE_CHARS) {
      omitted.push(s);
      continue;
    }
    const text = s.text.slice(0, remaining);
    used += text.length;
    included.push({ ...s, text });
  }
  return { included, omitted };
}

/**
 * refs([{title,url,...}])を順に取得する。同一URLは1回だけ取得(cache引数で複数呼び出し間共有可)。
 * @returns {{ok:Array, failed:Array<{url,reason}>}} ok の各要素は fetchSourceText 成功結果 + ref メタ
 */
export async function fetchSources(refs, { fetchImpl = fetch, cache = new Map(), log = console } = {}) {
  const ok = [];
  const failed = [];
  for (const ref of refs) {
    let result = cache.get(ref.url);
    if (!result) {
      result = await fetchSourceText(ref.url, { fetchImpl });
      cache.set(ref.url, result);
    }
    if (result.ok) {
      ok.push({ ...result, title: ref.title, publisher: ref.publisher, lang: ref.lang });
    } else {
      failed.push({ url: ref.url, reason: result.reason });
      log.warn?.(`出典の取得に失敗(除外して続行): ${ref.url} — ${result.reason}`);
    }
  }
  return { ok, failed };
}
