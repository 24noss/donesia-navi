// Google Search Console (Search Analytics API) の薄いラッパー。
// Search Console APIは課金対象外・無料。外部依存パッケージは追加せず、node:crypto で
// サービスアカウントのJWT(RS256)を自前で組み立ててOAuth2トークンを取得する。
//
// suggest-guide-topics.mjs の本番実行(Slack投稿)時に、直近28日の検索クエリを
// 「GSC実クエリ」の参考情報として使う。GSC_SERVICE_ACCOUNT_KEY 未設定時は
// fail-open(呼び出し元はスキップして従来通り動作する)。

import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const DEFAULT_SITE_URL = 'sc-domain:indonesia-navi.com';
const LOOKBACK_DAYS = 28;

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// サービスアカウントのJWTクレーム(ペイロード)を組み立てる純粋関数。署名は行わない。
export function buildJwtClaims(serviceAccountEmail, { now = Date.now(), scope = SCOPE, aud = TOKEN_URL } = {}) {
  const iat = Math.floor(now / 1000);
  return {
    iss: serviceAccountEmail,
    scope,
    aud,
    iat,
    exp: iat + 3600,
  };
}

// サービスアカウントの秘密鍵でRS256署名したJWTアサーション文字列(header.payload.signature)を組み立てる。
export function signJwt(serviceAccount, { now } = {}) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = buildJwtClaims(serviceAccount.client_email, { now });
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key);
  const signatureB64 = signature.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${unsigned}.${signatureB64}`;
}

// サービスアカウントのJSONキー文字列からアクセストークンを取得する。
async function fetchAccessToken(serviceAccountKeyJson) {
  const serviceAccount = JSON.parse(serviceAccountKeyJson);
  const assertion = signJwt(serviceAccount);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`GSCアクセストークン取得失敗: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

// 直近28日分の検索クエリ(dimensions: ['query'])をSearch Analytics APIから取得する。
// 戻り値は { keys: [query], clicks, impressions, ctr, position } の配列(GSC生レスポンスのrows)。
async function fetchSearchAnalyticsQueries(accessToken, siteUrl, { rowLimit = 100, now = new Date() } = {}) {
  const endDate = new Date(now);
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);

  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
      dimensions: ['query'],
      rowLimit,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`GSC Search Analytics取得失敗: ${data.error?.message || res.status}`);
  }
  return data.rows || [];
}

// GSCの実クエリ行群からトピックのkeywordsに部分一致するものを抽出する純粋関数。
export function matchQueriesToTopic(topic, rows) {
  return (rows || []).filter((row) => {
    const q = row.keys?.[0] || '';
    return topic.keywords.some((kw) => q.includes(kw));
  });
}

// サービスアカウントキーが設定されていればGSCの直近28日クエリ(rows)を取得して返す。
// 未設定/取得失敗はいずれもfail-open(nullを返す)。呼び出し元はnullなら該当セクションをスキップする。
export async function getGscData({ serviceAccountKeyJson, siteUrl = DEFAULT_SITE_URL } = {}) {
  if (!serviceAccountKeyJson) {
    console.log('GSC_SERVICE_ACCOUNT_KEY が未設定のため、GSC実クエリ連携をスキップします。');
    return null;
  }
  try {
    const accessToken = await fetchAccessToken(serviceAccountKeyJson);
    return await fetchSearchAnalyticsQueries(accessToken, siteUrl);
  } catch (err) {
    console.warn('GSC連携でエラーが発生したためスキップします:', err.message);
    return null;
  }
}
