// Google検索サジェスト(オートコンプリート)の薄いラッパー。
// 無料・APIキー不要(https://suggestqueries.google.com/complete/search)。
// suggest-guide-topics.mjs の本番実行(Slack投稿)時に「実際に検索されている語」の参考情報として使う。
// --dry-run では呼び出さない(ネットワークなしで動く既存要件を維持するため)。

const SUGGEST_URL = 'https://suggestqueries.google.com/complete/search';
const TIMEOUT_MS = 5000;

// client=firefox のレスポンスは ["<クエリ>", ["<候補1>", "<候補2>", ...], ...] という素のJSON配列。
// 想定外の形状(配列でない/候補が配列でない等)ならフォールバックで空配列を返す。
export function parseSuggestResponse(data) {
  if (!Array.isArray(data)) return [];
  const suggestions = data[1];
  if (!Array.isArray(suggestions)) return [];
  return suggestions.filter((s) => typeof s === 'string');
}

// 指定クエリのGoogleサジェスト語配列を取得する。
// タイムアウト(5秒)・ネットワークエラー・不正レスポンスいずれも例外を投げず空配列を返す(fail-open)。
export async function fetchGoogleSuggestions(query) {
  // ie/oe を付けないと日本語クエリのレスポンスがUTF-8以外のエンコーディングで返り
  // 文字化けする(2026-09-03 実挙動で確認)ため、入出力ともUTF-8を明示する。
  const url = `${SUGGEST_URL}?client=firefox&hl=ja&ie=utf-8&oe=utf-8&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.warn(`Googleサジェスト取得失敗(status ${res.status}): ${query}`);
      return [];
    }
    const data = await res.json();
    return parseSuggestResponse(data);
  } catch (err) {
    console.warn(`Googleサジェスト取得エラー(${query}):`, err.message);
    return [];
  }
}
