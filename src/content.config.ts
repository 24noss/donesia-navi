import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['safety', 'society', 'business', 'lifestyle', 'travel', 'visa', 'regulation']),
    tags: z.array(z.string()).default([]),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    source: z.string().optional(),
    sourceUrl: z.string().url().optional(),
    draft: z.boolean().default(false),
    hasAffiliate: z.boolean().default(false),
  }),
});

// 店舗データ基盤(C-0)。1店舗=1ファイルの src/data/places/*.yaml を独立コレクション化する。
// 表記ゆれ・記事間重複・閉店検知不能を根治するため、店舗情報は記事frontmatterではなく
// ここに一元化し、記事側は sourceArticles で「どのplaceがどの記事由来か」を保持する
// (逆参照: 記事→place ではなく place→記事)。
const places = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/data/places' }),
  schema: z.object({
    // 日本語優先の表示名(必須)。英語名がある場合はnameEnに別途持つ。
    name: z.string(),
    nameEn: z.string().optional(),
    category: z.enum(['restaurant', 'hospital', 'school', 'shop', 'office', 'spot']),
    // 旧frontmatter方式(記事ごとのfreeform area文字列)は表記ゆれの温床だったため(A-4)、
    // 既存データに実在する正規化済み日本語エリア名のみをenumで許可する。
    area: z.enum([
      'メンテン', 'タムリン', 'スディルマン', 'セノパティ', 'SCBD', 'クマン',
      'グナワルマン', 'グロドック', 'スナヤン', 'ポンドックインダ', 'メガクニンガン',
      'ウィジャヤ', 'ウォルターモンギンシディ', 'パングリマポリム', 'ダルマワンサ',
      'メラワイ', 'ラジオダラム', 'ブロックM',
      // C-1医療タスクで追加(病院・クリニックの実在エリア。既存の飲食店中心エリアとは
      // 別の実在する日本人生活圏のため新規追加): チプテ/バンカ/スマンギ(南ジャカルタ)、
      // チカラン(ブカシ県の工業団地。中心部からは離れるが日本語対応クリニックの
      // 進出先として記事に掲載されているため許容)。
      'チプテ', 'バンカ', 'スマンギ', 'チカラン',
    ]),
    // レストラン以外のcategory(病院・学校等)には該当しないためoptional。
    cuisine: z.enum(['japanese', 'korean', 'chinese', 'indonesian', 'european', 'cafe', 'other']).optional(),
    priceRange: z.enum(['budget', 'mid', 'high', 'luxury']).optional(),
    halal: z.enum(['yes', 'no', 'unverified']).default('unverified'),
    servesAlcohol: z.enum(['yes', 'no', 'unverified']).default('unverified'),
    lat: z.number(),
    lng: z.number(),
    googleMapsQuery: z.string(),
    placeId: z.string().optional(),
    isChain: z.boolean().default(false),
    status: z.enum(['open', 'closed', 'unverified']).default('open'),
    verifiedAt: z.coerce.date().optional(),
    // どの記事がこの店舗を紹介したか(記事id)。0件=記事に紐付かない静的place(病院・学校等)も許容。
    sourceArticles: z.array(z.string()).default([]),
    // 店舗詳細ページ用の一言(任意)。
    description: z.string().optional(),
  }),
});

export const collections = { articles, places };
