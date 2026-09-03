import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildJwtClaims, signJwt, matchQueriesToTopic, getGscData, DEFAULT_SITE_URL } from './gsc.mjs';

function base64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

describe('buildJwtClaims', () => {
  test('iss/scope/aud/iat/expを組み立てる(署名は行わない)', () => {
    const now = new Date('2026-09-01T00:00:00Z').getTime();
    const claims = buildJwtClaims('test@example.iam.gserviceaccount.com', { now });
    assert.equal(claims.iss, 'test@example.iam.gserviceaccount.com');
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/webmasters.readonly');
    assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
    assert.equal(claims.iat, Math.floor(now / 1000));
    assert.equal(claims.exp, claims.iat + 3600);
  });

  test('scope/audはオプションで上書きできる', () => {
    const claims = buildJwtClaims('a@b.com', { now: 0, scope: 'custom-scope', aud: 'https://example.com/token' });
    assert.equal(claims.scope, 'custom-scope');
    assert.equal(claims.aud, 'https://example.com/token');
  });
});

describe('signJwt', () => {
  // テスト用RSA鍵ペア(実際のGoogleサービスアカウント鍵は使わない)。
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const serviceAccount = { client_email: 'test@example.iam.gserviceaccount.com', private_key: privateKey };

  test('header.payload.signature の3パートからなるJWT文字列を返す', () => {
    const jwt = signJwt(serviceAccount, { now: new Date('2026-09-01T00:00:00Z').getTime() });
    const parts = jwt.split('.');
    assert.equal(parts.length, 3);
  });

  test('headerがRS256/JWTである', () => {
    const jwt = signJwt(serviceAccount, { now: 0 });
    const header = JSON.parse(base64urlDecode(jwt.split('.')[0]));
    assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  });

  test('payloadにclient_emailがiss、正しいscope/audが入る', () => {
    const jwt = signJwt(serviceAccount, { now: new Date('2026-09-01T00:00:00Z').getTime() });
    const payload = JSON.parse(base64urlDecode(jwt.split('.')[1]));
    assert.equal(payload.iss, 'test@example.iam.gserviceaccount.com');
    assert.equal(payload.scope, 'https://www.googleapis.com/auth/webmasters.readonly');
    assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
    assert.equal(payload.exp, payload.iat + 3600);
  });

  test('署名がprivate_keyに対応するpublic_keyで検証できる(改ざんされていないこと)', () => {
    const jwt = signJwt(serviceAccount, { now: 0 });
    const [headerB64, payloadB64, sigB64] = jwt.split('.');
    const unsigned = `${headerB64}.${payloadB64}`;
    const signature = base64urlDecode(sigB64);
    const verified = crypto.verify('RSA-SHA256', Buffer.from(unsigned), publicKey, signature);
    assert.equal(verified, true);
  });

  test('別の鍵ペアの公開鍵では検証に失敗する(なりすまし防止の裏取り)', () => {
    const other = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const jwt = signJwt(serviceAccount, { now: 0 });
    const [headerB64, payloadB64, sigB64] = jwt.split('.');
    const unsigned = `${headerB64}.${payloadB64}`;
    const signature = base64urlDecode(sigB64);
    const verified = crypto.verify('RSA-SHA256', Buffer.from(unsigned), other.publicKey, signature);
    assert.equal(verified, false);
  });
});

describe('matchQueriesToTopic', () => {
  test('topic.keywordsのいずれかにquery(keys[0])が部分一致する行を返す', () => {
    const topic = { keywords: ['会食', '接待'] };
    const rows = [
      { keys: ['ジャカルタ 会食'], impressions: 10 },
      { keys: ['ジャカルタ 接待 レストラン'], impressions: 20 },
      { keys: ['ジャカルタ ラーメン'], impressions: 30 },
    ];
    const result = matchQueriesToTopic(topic, rows);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((r) => r.keys[0]), ['ジャカルタ 会食', 'ジャカルタ 接待 レストラン']);
  });

  test('一致が無ければ空配列', () => {
    const topic = { keywords: ['寿司'] };
    const rows = [{ keys: ['ジャカルタ ラーメン'], impressions: 10 }];
    assert.deepEqual(matchQueriesToTopic(topic, rows), []);
  });

  test('rowsがnull/undefinedでも落ちない', () => {
    const topic = { keywords: ['寿司'] };
    assert.deepEqual(matchQueriesToTopic(topic, null), []);
    assert.deepEqual(matchQueriesToTopic(topic, undefined), []);
  });

  test('keys欠損の行は無視する(空文字扱い)', () => {
    const topic = { keywords: ['寿司'] };
    const rows = [{ impressions: 10 }];
    assert.deepEqual(matchQueriesToTopic(topic, rows), []);
  });
});

describe('getGscData (fetchモック)', () => {
  test('serviceAccountKeyJsonが未設定ならnullを返す(fail-open、ネットワークを叩かない)', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error('呼ばれてはいけない');
    };
    try {
      const result = await getGscData({ serviceAccountKeyJson: undefined });
      assert.equal(result, null);
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('トークン取得〜Search Analytics取得まで成功すればrows配列を返す', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const serviceAccountKeyJson = JSON.stringify({
      client_email: 'test@example.iam.gserviceaccount.com',
      private_key: privateKey,
    });

    const originalFetch = globalThis.fetch;
    const calledUrls = [];
    globalThis.fetch = async (url, opts) => {
      calledUrls.push(String(url));
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return { ok: true, json: async () => ({ access_token: 'fake-token' }) };
      }
      if (String(url).includes('searchAnalytics/query')) {
        assert.equal(opts.headers.Authorization, 'Bearer fake-token');
        const body = JSON.parse(opts.body);
        assert.deepEqual(body.dimensions, ['query']);
        assert.equal(body.rowLimit, 100);
        return { ok: true, json: async () => ({ rows: [{ keys: ['ジャカルタ 会食'], impressions: 10, clicks: 1 }] }) };
      }
      throw new Error(`想定外のURL: ${url}`);
    };
    try {
      const rows = await getGscData({ serviceAccountKeyJson, siteUrl: DEFAULT_SITE_URL });
      assert.deepEqual(rows, [{ keys: ['ジャカルタ 会食'], impressions: 10, clicks: 1 }]);
      assert.ok(calledUrls.some((u) => u.includes(encodeURIComponent(DEFAULT_SITE_URL))));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('トークン取得が失敗(res.ok:false)してもnullを返す(fail-open)', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });
    const serviceAccountKeyJson = JSON.stringify({ client_email: 'test@example.iam.gserviceaccount.com', private_key: privateKey });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_grant' }) });
    try {
      const result = await getGscData({ serviceAccountKeyJson });
      assert.equal(result, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('秘密鍵が不正な形式(署名失敗)でもnullを返す(fail-open)', async () => {
    const result = await getGscData({ serviceAccountKeyJson: '{"client_email":"a@b.com","private_key":"not-a-real-key"}' });
    assert.equal(result, null);
  });

  test('serviceAccountKeyJsonが不正なJSON文字列でも例外を投げずnullを返す', async () => {
    const result = await getGscData({ serviceAccountKeyJson: 'これはJSONではない' });
    assert.equal(result, null);
  });
});
