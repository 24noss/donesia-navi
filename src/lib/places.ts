import type { CollectionEntry } from 'astro:content';
import { shouldIncludeDrafts } from './draftVisibility';

export type PlaceEntry = CollectionEntry<'places'>;
export type ArticleEntry = CollectionEntry<'articles'>;

/** placeの`category`enum値 → 日本語表示ラベル。 */
export const placeCategoryLabels: Record<PlaceEntry['data']['category'], string> = {
  restaurant: 'レストラン',
  hospital: '病院',
  school: '学校',
  shop: 'ショップ',
  office: 'オフィス',
  spot: 'スポット',
};

/**
 * 表示可能な(=マップ・詳細ページに出してよい)placesを返す。
 *
 * - `status: 'closed'` は常に除外(閉店検知スクリプトが確定させたもの)
 * - `sourceArticles` が空(記事に紐付かない静的place。病院・学校など)はそのまま表示対象
 * - `sourceArticles` がある場合、いずれか1件の記事IDが実在し、かつ
 *   (非draft、または本関数がdraftプレビュービルド中と判定した場合)であれば表示対象
 *
 * `articles` にはdraft記事を含む全件を渡すこと。draftの可否判定はこの関数の中で
 * `shouldIncludeDrafts()`(本番/プレビューの分岐)を見て行うため、呼び出し側で
 * あらかじめ絞り込んだ配列を渡すと存在チェックが正しく機能しない。
 */
export function getVisiblePlaces(places: PlaceEntry[], articles: ArticleEntry[]): PlaceEntry[] {
  const includeDrafts = shouldIncludeDrafts();
  const articleById = new Map(articles.map((article) => [article.id, article]));

  return places.filter((place) => {
    if (place.data.status === 'closed') return false;

    const { sourceArticles } = place.data;
    if (sourceArticles.length === 0) return true;

    return sourceArticles.some((id) => {
      const article = articleById.get(id);
      if (!article) return false;
      return includeDrafts || !article.data.draft;
    });
  });
}

/**
 * カテゴリ非依存の軽量マップポイント形式に変換する(C-1タスク2: /mapの医療レイヤ等、
 * cuisine/price/halal/alcoholのようなレストラン固有フィールドを持たないplace向け)。
 */
export function placeToSimpleMapPoint(place: PlaceEntry) {
  const { data } = place;
  return {
    id: place.id,
    name: data.name,
    nameEn: data.nameEn,
    area: data.area,
    description: data.description,
    googleMapsQuery: data.googleMapsQuery,
    lat: data.lat,
    lng: data.lng,
  };
}

/** RestaurantMapコンポーネントの `restaurants` propが期待する1店舗ぶんのデータ形式に変換する。 */
export function placeToMapPoint(place: PlaceEntry) {
  const { data } = place;
  return {
    id: place.id,
    name: data.name,
    nameEn: data.nameEn,
    area: data.area,
    cuisine: data.cuisine ?? 'other',
    priceRange: data.priceRange,
    halal: data.halal,
    servesAlcohol: data.servesAlcohol,
    googleMapsQuery: data.googleMapsQuery,
    lat: data.lat,
    lng: data.lng,
    // InfoWindow内の「記事を読む」リンク・記事内マップの紐付けに使う代表記事。
    articleSlug: data.sourceArticles[0],
  };
}
