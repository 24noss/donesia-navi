import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';
import { categories } from '../../lib/categories';
import type { CategorySlug } from '../../lib/categories';
import { shouldIncludeDrafts } from '../../lib/draftVisibility';

// Category accent colors — mirrors global.css `.cat-dot.*` / ArticleCard.astro
// `.cat-*` so the OG image band matches the color the reader sees on-site.
// Duplicated here (rather than imported) because categories.ts only stores
// the category *slug* as `color`, not the hex value.
const CATEGORY_COLOR: Record<CategorySlug, string> = {
  safety: '#CE3B3B',
  society: '#3A6B8C',
  business: '#C9A44A',
  gourmet: '#C1502B',
  lifestyle: '#5BA88E',
  travel: '#8B6FBF',
  visa: '#D47B3E',
  regulation: '#2A4168',
};

const NAVY = '#1B2D4F';
const GOLD = '#C9A44A';
const TEAL = '#3A6B8C';
const OFFWHITE = '#FAFAF8';

// Bold Noto Sans JP (OFL), committed at src/assets/fonts/ so the build never
// fetches fonts over the network (see task brief: build must work offline).
const fontData = fs.readFileSync(
  path.resolve(process.cwd(), 'src/assets/fonts/NotoSansJP-Bold.ttf')
);

// Rough cap so a 3-line wrap never overflows the 630px canvas. Article
// titles in this content set run 21-44 chars (checked against the current
// corpus), so this only ever engages for unusually long future titles.
const TITLE_MAX_CHARS = 50;

function truncateTitle(title: string): string {
  const chars = [...title];
  if (chars.length <= TITLE_MAX_CHARS) return title;
  return chars.slice(0, TITLE_MAX_CHARS - 1).join('') + '…';
}

export const getStaticPaths: GetStaticPaths = async () => {
  const includeDrafts = shouldIncludeDrafts();
  const articles = await getCollection('articles', ({ data }) => !data.draft || includeDrafts);
  return articles.map((article) => ({ params: { id: article.id }, props: { article } }));
};

export const GET: APIRoute = async ({ props }) => {
  const { article } = props as { article: Awaited<ReturnType<typeof getCollection>>[number] };
  const cat = categories[article.data.category as CategorySlug];
  const accent = CATEGORY_COLOR[article.data.category as CategorySlug];
  const title = truncateTitle(article.data.title);

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: '1200px',
          height: '630px',
          display: 'flex',
          background: OFFWHITE,
        },
        children: [
          // Thick left-edge category-color band (no gradients/photos, per site
          // design principles — flat color block only).
          {
            type: 'div',
            props: {
              style: {
                width: '28px',
                height: '630px',
                background: accent,
                display: 'flex',
                flexShrink: 0,
              },
            },
          },
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                flex: 1,
                padding: '64px 72px 56px 72px',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: '26px',
                            color: accent,
                            letterSpacing: '2px',
                            display: 'flex',
                          },
                          children: cat.name,
                        },
                      },
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: '58px',
                            color: NAVY,
                            lineHeight: 1.42,
                            marginTop: '26px',
                            display: 'flex',
                            whiteSpace: 'pre-wrap',
                          },
                          children: title,
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      alignItems: 'baseline',
                      fontSize: '30px',
                    },
                    children: [
                      {
                        type: 'span',
                        props: { style: { color: NAVY, fontWeight: 700, display: 'flex' }, children: 'DONESIA' },
                      },
                      {
                        type: 'span',
                        props: { style: { color: TEAL, display: 'flex', marginLeft: '2px' }, children: 'NAV' },
                      },
                      {
                        type: 'span',
                        props: { style: { color: GOLD, display: 'flex' }, children: 'i' },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: 'Noto Sans JP',
          data: fontData,
          weight: 700,
          style: 'normal',
        },
      ],
    }
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  });
  const png = resvg.render().asPng();

  return new Response(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
