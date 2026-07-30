const PLACES_API_URL = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.primaryType',
  'places.businessStatus',
  'places.googleMapsUri',
  'nextPageToken',
].join(',');

// 既存ガイド記事で扱われている主要ハブエリア
export const AREAS = ['Kebayoran Baru', 'Senopati', 'SCBD', 'Kemang', 'Menteng', 'PIK (Pantai Indah Kapuk)'];

// content.config.tsのcuisine enumのうち、検索クエリとして意味を持つもののみ
// (「other」は検索キーワードを持たない受け皿カテゴリのため対象外)
export const CUISINE_QUERIES = {
  japanese: 'japanese restaurant',
  korean: 'korean restaurant',
  chinese: 'chinese restaurant',
  indonesian: 'indonesian restaurant',
  european: 'european restaurant',
  cafe: 'cafe',
};

const PRICE_LEVEL_MAP = {
  PRICE_LEVEL_FREE: 'budget',
  PRICE_LEVEL_INEXPENSIVE: 'budget',
  PRICE_LEVEL_MODERATE: 'mid',
  PRICE_LEVEL_EXPENSIVE: 'high',
  PRICE_LEVEL_VERY_EXPENSIVE: 'luxury',
};

function buildQuery(cuisineKeyword, area) {
  return `${cuisineKeyword} in ${area}, Jakarta, Indonesia`;
}

async function searchTextPage(apiKey, textQuery, pageToken) {
  const body = pageToken ? { textQuery, pageToken } : { textQuery };
  const res = await fetch(PLACES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Places API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function normalizePlace(place, cuisine, area) {
  const name = place.displayName?.text || '';
  return {
    placeId: place.id,
    name,
    formattedAddress: place.formattedAddress || '',
    lat: place.location?.latitude,
    lng: place.location?.longitude,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    priceRange: PRICE_LEVEL_MAP[place.priceLevel] || null,
    businessStatus: place.businessStatus,
    googleMapsUri: place.googleMapsUri,
    googleMapsQuery: `${name} ${area} Jakarta`,
    cuisine,
    area,
  };
}

// maxPages: Text Searchは1ページ20件・最大3ページ(60件)まで。
// Googleの仕様上、次ページトークンは発行直後は無効なことがあるため軽くウェイトを入れる。
export async function searchRestaurants(apiKey, cuisine, area, { maxPages = 1 } = {}) {
  const keyword = CUISINE_QUERIES[cuisine];
  if (!keyword) throw new Error(`未対応のcuisine: ${cuisine}`);
  const textQuery = buildQuery(keyword, area);

  const results = [];
  let pageToken;
  let page = 0;

  do {
    const data = await searchTextPage(apiKey, textQuery, pageToken);
    for (const place of data.places || []) {
      results.push(normalizePlace(place, cuisine, area));
    }
    pageToken = data.nextPageToken;
    page += 1;
    if (pageToken && page < maxPages) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } while (pageToken && page < maxPages);

  return results;
}
