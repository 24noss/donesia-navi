# DonesiaNavi Design Strategy
## Comprehensive Design Document for indonesia-navi.com

**Date:** 2026-04-02
**Status:** Proposal
**Target:** Japanese expats in Indonesia, mobile-first news consumption

---

## Table of Contents
1. [Current State Assessment](#1-current-state-assessment)
2. [Competitive Design Analysis](#2-competitive-design-analysis)
3. [Optimal Design Recommendations](#3-optimal-design-recommendations)
4. [Typography & Visual Design](#4-typography--visual-design)
5. [Mobile-First Design](#5-mobile-first-design)
6. [Performance Strategy](#6-performance-strategy)
7. [Design System Specification](#7-design-system-specification)
8. [Implementation Priority](#8-implementation-priority)

---

## 1. Current State Assessment

### What exists now
- Single-column layout (800px max-width)
- Sticky header with inline category navigation
- Simple article list: badge + date + title + excerpt
- Red accent color (#dc2626), 8 category colors
- Noto Sans JP / Hiragino Kaku Gothic ProN font stack
- No images, no widgets, no dark mode
- No mobile-specific navigation (relies on wrapping flex nav)
- ~174 lines of CSS total

### Key problems
1. **No visual hierarchy on homepage** -- all articles look identical regardless of importance
2. **Navigation breaks on mobile** -- 8 category links wrapping in flex creates messy layout
3. **No above-the-fold hook** -- users see "最新記事" heading and a flat list; no urgency
4. **Safety alerts have no special treatment** -- critical info looks like any other article
5. **No daily digest prominence** -- the daily summary is buried in chronological order
6. **Missing utility info** -- no exchange rate, weather, or quick-reference tools
7. **No font loading strategy** -- relies on system fonts only (actually good for perf, but limits control)
8. **No dark mode** -- many expats read news at night
9. **Footer is bare minimum** -- missed opportunity for navigation and trust signals

---

## 2. Competitive Design Analysis

### 2.1 じゃかるた新聞 (jakartashimbun.com)

| Aspect | Details |
|--------|---------|
| **Layout** | 2-column: main content + sidebar. Traditional newspaper portal. |
| **Navigation** | Horizontal top nav: トップ, 社会, 政治, 経済, 日イ, 文化, スポーツ |
| **Color** | Conservative: black text, white bg, red logo accent |
| **Articles** | Thumbnail + headline + date + category tag. List format. |
| **Special features** | Access ranking, popular series, event listings, subscription CTA |
| **Strengths** | Established credibility, content density, ranking widget |
| **Weaknesses** | Dated design, heavy ad placement, paywall friction, not mobile-optimized |

**Takeaway for DonesiaNavi:** Their access ranking widget is valuable social proof. Their content density works for desktop but fails on mobile. We should offer ranking without the clutter.

### 2.2 Lifenesia / Businesia (news.lifenesia.com)

| Aspect | Details |
|--------|---------|
| **Layout** | 2-column with sidebar. WordPress-based. max-width 1166px. |
| **Navigation** | Horizontal nav: 日系企業, ビジネス/現地企業, 基礎情報. Hamburger on mobile. |
| **Color** | Navy blue (#0b0660) primary, orange (#eda515) hover, white bg |
| **Typography** | Yu Gothic / Hiragino stack. Responsive clamp() sizing. |
| **Articles** | Card grid with featured images (16:10 ratio), headlines, dates, category labels |
| **Special features** | Popular posts with numbered ranking, TOC blocks, LINE official account promotion, slider carousel |
| **Strengths** | Modern card-based design, responsive clamp() typography, proper mobile hamburger |
| **Weaknesses** | Heavy WordPress overhead, cluttered sidebar, inconsistent spacing |

**Takeaway for DonesiaNavi:** Their card-based article display and clamp() typography are best practices we should adopt. Their navy+orange scheme conveys professionalism. Their LINE integration is smart for the expat audience.

### 2.3 MYANMAR JAPON (myanmarjapon.com)

| Aspect | Details |
|--------|---------|
| **Layout** | Multi-column grid, main + sidebar. Traditional news portal. |
| **Navigation** | ホーム, 最新ニュース, 特集記事. Social icons in header. |
| **Color** | Neutral palette. White bg, dark text. Professional, restrained. |
| **Articles** | Thumbnail + headline + date + category tag + excerpt |
| **Special features** | Premium membership CTA, email subscription, e-magazine preview, real estate listings, video carousel |
| **Strengths** | Comprehensive content ecosystem, multiple content types (video, columns, listings), clear monetization |
| **Weaknesses** | Premium gating hinders discovery, ad-heavy, dated aesthetic |

**Takeaway for DonesiaNavi:** Their multi-content approach (news + listings + video) shows the potential for a full expat portal. For now, focus on news excellence first, but architect for future expansion.

### 2.4 Yahoo! News Japan (news.yahoo.co.jp)

| Aspect | Details |
|--------|---------|
| **Layout** | Fixed 990px, main feed + right sidebar (300px). |
| **Navigation** | Horizontal tabs: トップ, 速報, ライブ, エキスパート + sub-categories |
| **Color** | Dark header (#4E555D), blue links (#0033CC), red hover (#CC3434), gray muted (#949494) |
| **Articles** | **Headline-only in rankings** (no excerpts). 8 curated "topics" with larger images above. |
| **Special features** | 3 ranking types (access, comments, video), live streaming, comment trends |
| **Strengths** | Multiple discovery paths, headline-centric for rapid scanning, social proof via rankings, authoritative sourcing |
| **Weaknesses** | Desktop-first, dense for mobile, ad-heavy |

**Takeaway for DonesiaNavi:** The "8 curated topics" above-the-fold pattern is extremely effective. Their headline-only approach for scanning is the gold standard. We should adopt: curated top stories + scannable list below.

### 2.5 SmartNews (Design Patterns)

| Aspect | Details |
|--------|---------|
| **Organization** | Horizontal swipeable tabs for channels/categories |
| **Layout** | Card-based, page-turning metaphor |
| **Discovery** | 1000+ channels, customizable tab order |
| **Mobile patterns** | Gesture-based (swipe, long-press), minimal friction, background sync |
| **Strengths** | Best-in-class mobile news UX, customizable, fast |

**Takeaway for DonesiaNavi:** Horizontal swipeable category tabs are the mobile standard. Card-based layouts with clear visual hierarchy. Minimize friction at every step.

### Synthesis: Design Pattern Winners

| Pattern | Source | Apply to DonesiaNavi |
|---------|--------|---------------------|
| Curated top stories (hero section) | Yahoo! News | Yes -- pin daily digest + safety alerts |
| Headline-only scannable lists | Yahoo! News | Yes -- for category pages |
| Horizontal category tabs | SmartNews | Yes -- for mobile navigation |
| Card grid with images | Lifenesia | Partially -- text-only cards (no images) |
| Access ranking widget | jakartashimbun | Future -- when we have traffic data |
| Navy/blue professional palette | Lifenesia | Yes -- shift from red to blue-based |
| clamp() responsive typography | Lifenesia | Yes |

---

## 3. Optimal Design Recommendations

### 3.1 Layout Strategy

**Recommendation: Responsive single-column with optional sidebar on wide screens**

```
Mobile (< 768px):     Single column, full width
Tablet (768-1023px):  Single column, centered (720px)
Desktop (>= 1024px):  Main (680px) + Sidebar (300px), centered (1040px)
```

Rationale: The audience is 70%+ mobile. A single-column mobile experience is non-negotiable. On desktop, a sidebar adds value (exchange rate widget, category list, recent articles).

### 3.2 Homepage Structure (Above the Fold)

```
+-----------------------------------------------+
| [Logo: DonesiaNavi]     [Search] [Dark toggle] |
| [Category tabs: scrollable horizontal]         |
+-----------------------------------------------+
| [SAFETY ALERT BANNER - if active]              |
| Red bg, white text, pulsing icon               |
+-----------------------------------------------+
| [TODAY'S DIGEST CARD]                          |
| Large card: "今日のインドネシア 4月2日"          |
| Exchange: 1円 = 108.5ルピア                     |
| Weather: Jakarta 32C Cloudy                    |
| Top 3 headlines from digest                    |
+-----------------------------------------------+
| [LATEST NEWS]                                  |
| Article 1: badge + title + time ("3時間前")     |
| Article 2: badge + title + time                |
| Article 3: badge + title + time                |
| ...                                            |
+-----------------------------------------------+
```

**Key decisions:**
- **Safety alert gets highest visual priority** -- full-width red banner, always on top if active
- **Daily digest is a hero card** -- not just another article in the list
- **Exchange rate + weather are embedded in digest card** -- the #1 utility info for expats
- **Article list uses relative time** ("3時間前") not absolute dates for freshness

### 3.3 Category Navigation

**Recommendation: Horizontally scrollable pill tabs (SmartNews pattern)**

```css
.category-tabs {
  display: flex;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  scrollbar-width: none; /* hide scrollbar */
}
.category-tab {
  white-space: nowrap;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  transition: all 0.15s;
}
.category-tab.active,
.category-tab:hover {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}
```

- 8 categories fit in a scrollable row
- Active category highlighted with filled pill
- Sticky below header on scroll (combined sticky header + tabs)
- Each tab shows category color as left border accent

### 3.4 Article List Design

**Recommendation: Compact text-based list with category badge and relative time**

For the homepage, use a **headline-forward** design (Yahoo! News pattern adapted):

```
[Badge: 安全] タイトルがここに表示されます          3時間前
              短い説明文が1行で表示されます...
─────────────────────────────────────────────────
[Badge: 経済] 別の記事のタイトル                    5時間前
              説明文...
```

- **No images** -- this is an AI-generated text news site; images would be stock photos adding no value
- **Badge is color-coded** -- instant category recognition
- **Relative time on the right** -- freshness indicator
- **1-line excerpt** -- truncated with ellipsis on mobile, 2 lines on desktop
- **Tap target is the entire row** -- not just the title text

### 3.5 Daily Digest Special Treatment

The daily digest should be **visually distinct** from regular articles:

```
+------------------------------------------+
| 今日のインドネシア                         |
| 2026年4月2日（木）                         |
|                                          |
| 💱 1円 = 108.5 IDR (▲0.3%)               |
| 🌤 Jakarta 32°C くもり                    |
|                                          |
| ● 記事1タイトル                           |
| ● 記事2タイトル                           |
| ● 記事3タイトル                           |
|                                          |
| [全文を読む →]                            |
+------------------------------------------+
```

CSS approach:
```css
.digest-card {
  background: linear-gradient(135deg, var(--color-primary-50), var(--color-primary-100));
  border: 1px solid var(--color-primary-200);
  border-radius: 12px;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}
.digest-card h2 {
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--color-primary-800);
}
.digest-meta {
  display: flex;
  gap: 1rem;
  margin: 0.75rem 0;
  font-size: 0.85rem;
  font-weight: 600;
}
```

### 3.6 Safety Alert Design

Safety alerts must be **impossible to miss**:

```css
.safety-banner {
  background: var(--color-danger);
  color: #fff;
  padding: 0.75rem 1rem;
  font-weight: 700;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  animation: safety-pulse 2s ease-in-out infinite;
}
.safety-banner::before {
  content: '⚠';
  font-size: 1.2rem;
}
@keyframes safety-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.85; }
}
```

- Positioned above the header (not below)
- Full-width red banner with white text
- Warning icon + headline + "詳細を見る" link
- Persists until user dismisses or alert expires
- On article page: displayed as a top banner linking to the safety article

### 3.7 Exchange Rate + Weather Widget

For the sidebar (desktop) and digest card (mobile):

```css
.utility-widget {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--color-surface);
  border-radius: 8px;
  border: 1px solid var(--color-border);
}
.widget-item {
  text-align: center;
}
.widget-label {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.widget-value {
  font-size: 1.1rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--color-text);
}
.widget-change {
  font-size: 0.75rem;
  font-weight: 600;
}
.widget-change.up { color: var(--color-success); }
.widget-change.down { color: var(--color-danger); }
```

---

## 4. Typography & Visual Design

### 4.1 Font Stack (Updated for 2026)

```css
:root {
  --font-sans: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN",
               "Hiragino Sans", "Noto Sans JP", sans-serif;
  --font-mono: "SF Mono", "Fira Code", monospace;
}
```

Rationale:
- Hiragino Kaku Gothic ProN for macOS/iOS (best Japanese rendering)
- Hiragino Sans for macOS Firefox fallback
- Noto Sans JP now ships with Windows 11 (Oct 2025) -- no web font needed
- No Yu Gothic (causes rendering issues on Windows)
- **No web font loading needed** -- system fonts cover all platforms

### 4.2 Typography Scale

Using a modular scale (1.2 ratio) with clamp() for responsive sizing:

```css
:root {
  /* Body */
  --text-xs: clamp(0.7rem, 0.65rem + 0.25vw, 0.75rem);      /* 11-12px */
  --text-sm: clamp(0.8rem, 0.75rem + 0.25vw, 0.875rem);      /* 13-14px */
  --text-base: clamp(0.9rem, 0.85rem + 0.25vw, 1rem);        /* 14-16px */
  --text-lg: clamp(1rem, 0.9rem + 0.5vw, 1.125rem);          /* 16-18px */
  --text-xl: clamp(1.1rem, 1rem + 0.5vw, 1.25rem);           /* 18-20px */
  --text-2xl: clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem);       /* 20-24px */
  --text-3xl: clamp(1.5rem, 1.3rem + 1vw, 1.875rem);         /* 24-30px */

  /* Line heights for Japanese text */
  --leading-tight: 1.4;    /* Headlines */
  --leading-normal: 1.8;   /* UI text */
  --leading-relaxed: 2.0;  /* Article body -- critical for Japanese readability */
}
```

### 4.3 Japanese-Specific Typography Rules

```css
body {
  font-feature-settings: "palt" 1; /* Proportional alternates -- tighter kana spacing */
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  word-break: break-all; /* Japanese word-break */
  overflow-wrap: break-word;
}

/* Article body: optimized for long-form Japanese reading */
.article-body {
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);  /* 2.0 for Japanese */
  letter-spacing: 0.02em;  /* Slight letter-spacing aids readability */
  font-feature-settings: "palt" 1;
}

/* Headlines: tighter spacing */
h1, h2, h3 {
  line-height: var(--leading-tight);
  letter-spacing: -0.01em;
  font-feature-settings: "palt" 1;
}
```

### 4.4 Color Palette

Shifting from the current red-accent scheme to a **blue-based professional palette** with red reserved for safety/urgency:

```css
:root {
  /* Primary: Deep navy blue -- trust, professionalism */
  --color-primary: #1e3a5f;
  --color-primary-50: #f0f5fa;
  --color-primary-100: #dae5f2;
  --color-primary-200: #b8cde3;
  --color-primary-500: #3b6fa0;
  --color-primary-700: #1e3a5f;
  --color-primary-800: #152c49;
  --color-primary-900: #0d1e33;

  /* Accent: Warm Indonesian gold */
  --color-accent: #d4942a;
  --color-accent-light: #fdf5e8;

  /* Semantic colors */
  --color-danger: #dc2626;       /* Safety alerts, breaking news */
  --color-success: #16a34a;      /* Positive indicators, exchange rate up */
  --color-warning: #f59e0b;      /* Warnings, attention */
  --color-info: #2563eb;         /* Informational */

  /* Neutral scale */
  --color-bg: #ffffff;
  --color-surface: #f8f9fa;      /* Cards, elevated surfaces */
  --color-surface-2: #f1f3f5;    /* Secondary surface */
  --color-border: #e2e5e9;
  --color-border-light: #f0f1f3;
  --color-text: #1a1d21;
  --color-text-secondary: #4a5568;
  --color-text-muted: #8a929e;

  /* Category colors (refined) */
  --color-cat-daily: #2563eb;
  --color-cat-safety: #dc2626;
  --color-cat-society: #7c3aed;
  --color-cat-business: #059669;
  --color-cat-lifestyle: #d97706;
  --color-cat-travel: #0891b2;
  --color-cat-visa: #4f46e5;
  --color-cat-regulation: #64748b;
}
```

**Rationale:**
- **Blue primary (#1e3a5f):** Conveys trust and authority (NHK, Yahoo! News, all major news orgs use blue)
- **Gold accent (#d4942a):** References Indonesian culture (temple gold, batik), warm contrast to blue
- **Red only for danger:** By reserving red for safety alerts, it becomes a genuine warning signal instead of decoration
- **Category colors remain distinct** but are used only in small badges, not large areas

### 4.5 Dark Mode

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0f1117;
    --color-surface: #1a1d25;
    --color-surface-2: #242830;
    --color-border: #2d3139;
    --color-border-light: #23272e;
    --color-text: #e8eaed;
    --color-text-secondary: #a0a7b4;
    --color-text-muted: #6b7280;

    --color-primary: #5b93d4;
    --color-primary-50: #1a2332;
    --color-primary-100: #1e2d42;
    --color-accent: #e8a840;
    --color-accent-light: #2a2218;
  }
}
```

Dark mode considerations:
- Reduce contrast slightly (not pure white on pure black)
- Category badge colors need lightened variants for dark backgrounds
- Safety banner remains bright red in both modes
- Respect `prefers-color-scheme` -- no toggle needed initially (add later as enhancement)

### 4.6 Whitespace & Content Density

The current site is too sparse. News sites need **moderate density** -- not cramped like Yahoo JP, but denser than a blog.

```css
:root {
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
}

/* Article list items: tighter than current */
.article-item {
  padding: var(--space-3) 0;          /* was 1.25rem, now 0.75rem */
  border-bottom: 1px solid var(--color-border-light);
}

/* Section spacing */
.section { margin-bottom: var(--space-8); }
.section-title {
  font-size: var(--text-sm);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-2);
  border-bottom: 2px solid var(--color-primary);
}
```

---

## 5. Mobile-First Design

### 5.1 Navigation: Bottom Tab Bar + Top Category Scroll

**Do NOT use a hamburger menu.** Research shows hamburger menus reduce navigation engagement by 50%+. Instead:

**Top:** Sticky header with logo + scrollable category tabs
**Bottom:** Fixed bottom navigation bar with 5 key actions

```
Bottom nav bar:
[ホーム] [カテゴリ] [安全情報] [検索] [設定]
  🏠       📂        🛡         🔍      ⚙
```

```css
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--color-bg);
  border-top: 1px solid var(--color-border);
  display: flex;
  justify-content: space-around;
  padding: 0.5rem 0;
  padding-bottom: env(safe-area-inset-bottom); /* iPhone notch safe area */
  z-index: 100;
}
.bottom-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  font-size: 0.65rem;
  color: var(--color-text-muted);
  text-decoration: none;
  padding: 0.25rem 0.75rem;
  min-width: 48px;       /* Touch target */
  min-height: 48px;      /* Touch target */
  justify-content: center;
}
.bottom-nav-item.active {
  color: var(--color-primary);
}
.bottom-nav-item .icon {
  font-size: 1.25rem;
}

/* Add padding to body to prevent content hiding behind bottom nav */
body { padding-bottom: calc(60px + env(safe-area-inset-bottom)); }

/* Hide bottom nav on desktop */
@media (min-width: 768px) {
  .bottom-nav { display: none; }
  body { padding-bottom: 0; }
}
```

### 5.2 Touch Targets

All interactive elements must meet 48x48px minimum:

```css
/* Ensure all tap targets are adequate */
.article-item a {
  display: block;
  padding: var(--space-3) 0;
  /* The entire row is tappable, not just the text */
}
.category-tab {
  min-height: 36px;
  padding: 0.4rem 0.9rem;
}
.badge {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
}
```

### 5.3 Reading Experience for Long Japanese Articles

```css
/* Mobile article reading */
@media (max-width: 768px) {
  .article-body {
    font-size: var(--text-base);  /* ~15px on mobile */
    line-height: 2.0;
    padding: 0 var(--space-2);
  }
  .article-body h2 {
    font-size: var(--text-lg);
    margin: var(--space-8) 0 var(--space-4);
    /* Sticky section headers help orientation in long articles */
    position: sticky;
    top: 56px; /* below sticky header */
    background: var(--color-bg);
    padding: var(--space-2) 0;
    z-index: 5;
  }
  .article-header h1 {
    font-size: var(--text-xl);
    line-height: 1.4;
  }
}

/* Progress indicator for long articles */
.reading-progress {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  background: var(--color-primary);
  z-index: 200;
  transition: width 0.1s;
}
```

### 5.4 AMP Considerations

**Recommendation: Skip AMP entirely.**

AMP is effectively deprecated for news SEO as of 2024. Google no longer gives AMP pages preferential treatment in search results or the Top Stories carousel. The overhead of maintaining AMP templates alongside Astro is not justified. Instead:

- Focus on Core Web Vitals (LCP, CLS, FID) which Astro already excels at
- Use standard `<meta>` tags for Google News indexing
- Implement structured data (NewsArticle schema) for search visibility

### 5.5 PWA Potential

**Recommendation: Implement as Phase 2 feature.**

PWA makes strong sense for this audience:
- Indonesia has variable connectivity (especially outside Jakarta/Bali)
- Offline reading of cached articles is high value
- Push notifications for safety alerts are critical
- Home screen install replaces app store friction

Minimum PWA implementation:
```json
// manifest.json
{
  "name": "DonesiaNavi",
  "short_name": "DonesiaNavi",
  "description": "インドネシア在住日本人のための情報ポータル",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1e3a5f",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Service worker strategy:
- Cache-first for static assets (CSS, fonts)
- Network-first for article pages (freshness matters)
- Background sync for new article check
- Offline fallback page: "オフラインです。保存済みの記事を表示しています。"

---

## 6. Performance Strategy

### 6.1 Image Strategy

**Recommendation: No images for most articles. Selective use of category icons and utility graphics.**

Rationale:
- Articles are AI-generated from RSS -- no original photography
- Stock photos add visual noise without information value
- Category-colored icons/badges provide sufficient visual variety
- Exception: Daily digest could have a simple weather icon

What to use instead of article images:
- **Color-coded left border** on article cards (category color)
- **Category badge** with distinct color
- **Typography hierarchy** (bold titles, lighter excerpts) creates visual rhythm
- **Whitespace** between sections replaces image-driven scanning

For the future (Phase 3):
- OGP images auto-generated with category color + title text (for social sharing)
- Simple SVG illustrations for category headers

### 6.2 CSS Strategy

**Recommendation: Keep single CSS file, but restructure with custom properties and layers.**

The current 174-line CSS is efficient. Do NOT add a framework. Instead:

```css
/* Use CSS layers for organization */
@layer reset, tokens, base, layout, components, utilities;

@layer reset {
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
}

@layer tokens {
  :root { /* all custom properties */ }
  @media (prefers-color-scheme: dark) { :root { /* dark overrides */ } }
}

@layer base {
  body { /* base styles */ }
  a { /* link styles */ }
}

@layer layout {
  .container { /* layout */ }
  .sidebar { /* sidebar */ }
}

@layer components {
  .site-header { }
  .article-item { }
  .badge { }
  .digest-card { }
  .safety-banner { }
  .bottom-nav { }
  /* etc */
}

@layer utilities {
  .sr-only { /* screen reader only */ }
  .truncate { /* text truncation */ }
}
```

Target: Keep total CSS under 400 lines. No build step needed for CSS.

### 6.3 Font Loading Strategy

**Recommendation: System fonts only -- no web font loading.**

Since 2025, the system font stack covers all platforms:
- macOS/iOS: Hiragino Kaku Gothic ProN (pre-installed)
- Windows 11: Noto Sans JP (pre-installed since Oct 2025)
- Android: Noto Sans CJK JP (pre-installed)

This means:
- Zero font loading latency
- No FOIT/FOUT
- No bandwidth cost
- Consistent rendering

If you want to add Noto Sans JP as a web font fallback for older Windows:
```css
/* Only load for systems that need it */
@supports not (font-family: "Noto Sans JP") {
  @font-face {
    font-family: "Noto Sans JP";
    src: url("/fonts/NotoSansJP-Regular.woff2") format("woff2");
    font-weight: 400;
    font-display: swap;
    unicode-range: U+3000-9FFF, U+F900-FAFF; /* CJK only */
  }
  @font-face {
    font-family: "Noto Sans JP";
    src: url("/fonts/NotoSansJP-Bold.woff2") format("woff2");
    font-weight: 700;
    font-display: swap;
    unicode-range: U+3000-9FFF, U+F900-FAFF;
  }
}
```

### 6.4 Lazy Loading

```html
<!-- For any future images -->
<img loading="lazy" decoding="async" ... />

<!-- For below-the-fold article lists, use Astro's built-in static rendering -->
<!-- No JS-based lazy loading needed for a static site -->
```

Astro already generates static HTML -- the browser handles lazy loading natively. No JavaScript frameworks needed.

---

## 7. Design System Specification

### 7.1 Color Tokens (Complete)

```css
:root {
  /* Brand */
  --color-primary: #1e3a5f;
  --color-primary-50: #f0f5fa;
  --color-primary-100: #dae5f2;
  --color-primary-200: #b8cde3;
  --color-primary-500: #3b6fa0;
  --color-primary-700: #1e3a5f;
  --color-primary-800: #152c49;
  --color-primary-900: #0d1e33;
  --color-accent: #d4942a;
  --color-accent-light: #fdf5e8;

  /* Semantic */
  --color-danger: #dc2626;
  --color-success: #16a34a;
  --color-warning: #f59e0b;
  --color-info: #2563eb;

  /* Neutral */
  --color-bg: #ffffff;
  --color-surface: #f8f9fa;
  --color-surface-2: #f1f3f5;
  --color-border: #e2e5e9;
  --color-border-light: #f0f1f3;
  --color-text: #1a1d21;
  --color-text-secondary: #4a5568;
  --color-text-muted: #8a929e;

  /* Category */
  --color-cat-daily: #2563eb;
  --color-cat-safety: #dc2626;
  --color-cat-society: #7c3aed;
  --color-cat-business: #059669;
  --color-cat-lifestyle: #d97706;
  --color-cat-travel: #0891b2;
  --color-cat-visa: #4f46e5;
  --color-cat-regulation: #64748b;
}
```

### 7.2 Typography Scale

```css
:root {
  --font-sans: "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN",
               "Hiragino Sans", "Noto Sans JP", sans-serif;
  --text-xs: clamp(0.7rem, 0.65rem + 0.25vw, 0.75rem);
  --text-sm: clamp(0.8rem, 0.75rem + 0.25vw, 0.875rem);
  --text-base: clamp(0.9rem, 0.85rem + 0.25vw, 1rem);
  --text-lg: clamp(1rem, 0.9rem + 0.5vw, 1.125rem);
  --text-xl: clamp(1.1rem, 1rem + 0.5vw, 1.25rem);
  --text-2xl: clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem);
  --text-3xl: clamp(1.5rem, 1.3rem + 1vw, 1.875rem);
  --leading-tight: 1.4;
  --leading-normal: 1.8;
  --leading-relaxed: 2.0;
}
```

### 7.3 Spacing System

```css
:root {
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
}
```

### 7.4 Responsive Breakpoints

```css
/* Mobile-first breakpoints */
/* Default: mobile (< 768px) */
@media (min-width: 768px)  { /* Tablet  */ }
@media (min-width: 1024px) { /* Desktop */ }
@media (min-width: 1280px) { /* Wide    */ }
```

### 7.5 Component Specifications

#### Header
```
Height: 56px (mobile), 64px (desktop)
Background: var(--color-bg)
Border-bottom: 2px solid var(--color-primary)
Content: Logo (left) + utility icons (right)
Position: sticky, top: 0
z-index: 100
```

#### Category Tabs Bar
```
Position: sticky, top: 56px (below header)
Background: var(--color-bg)
Border-bottom: 1px solid var(--color-border-light)
Padding: 0.5rem 1rem
Overflow-x: auto (horizontal scroll)
Items: pill-shaped buttons, 36px height
```

#### Safety Alert Banner
```
Position: fixed top (above everything) OR top of page
Background: var(--color-danger)
Color: white
Padding: 0.75rem 1rem
Font-weight: 700
Icon: warning triangle (left)
Dismiss: X button (right)
Animation: subtle pulse
z-index: 200
```

#### Daily Digest Card
```
Background: gradient from primary-50 to primary-100
Border: 1px solid var(--color-primary-200)
Border-radius: 12px
Padding: 1.25rem
Margin-bottom: 1.5rem
Contains: date, exchange rate, weather, top 3 headlines, CTA
```

#### Article List Item
```
Padding: 0.75rem 0
Border-bottom: 1px solid var(--color-border-light)
Layout: badge + title (left), relative time (right)
Title: var(--text-base), font-weight 700, line-height 1.5
Excerpt: var(--text-sm), color text-secondary, 1-line truncate (mobile), 2-line (desktop)
Badge: 0.7rem, pill shape, category color bg, white text
Time: var(--text-xs), color text-muted, right-aligned
Tap target: entire row (min-height 48px)
```

#### Category Badge
```
Font-size: 0.7rem
Font-weight: 700
Padding: 0.15rem 0.5rem
Border-radius: 999px (pill shape, changed from 3px)
Color: white
Background: category-specific color
```

#### Article Page Header
```
Title: var(--text-2xl), font-weight 800, line-height 1.4
Meta: badge + date + tags row
Border-bottom: 2px solid var(--color-border)
Margin-bottom: var(--space-8)
```

#### Article Body
```
Font-size: var(--text-base)
Line-height: 2.0
Letter-spacing: 0.02em
Max-width: 680px
h2: border-left 3px solid primary (instead of border-bottom)
Blockquote: left-border primary, bg primary-50
```

#### Sidebar (Desktop only)
```
Width: 280px
Margin-left: var(--space-8)
Contains: utility widget (exchange+weather), category list, recent articles
Position: sticky, top: 120px
```

#### Bottom Navigation (Mobile only)
```
Position: fixed, bottom: 0
Height: 56px + safe-area-inset-bottom
Background: var(--color-bg)
Border-top: 1px solid var(--color-border)
5 items: ホーム, カテゴリ, 安全情報, 検索, 設定
Icons: 1.25rem
Labels: 0.65rem
Active: var(--color-primary)
z-index: 100
```

#### Footer
```
Background: var(--color-primary-900)
Color: white / rgba(255,255,255,0.7)
Padding: var(--space-8) 0
Contains: about text, category links, disclaimer, copyright
```

---

## 8. Implementation Priority

### Phase 1: Critical UX Improvements (This Week)

**Impact: High | Effort: Low-Medium**

These changes use existing Astro structure; no new dependencies.

1. **Update color scheme** -- Replace red accent with navy blue primary
   - Change `--color-accent` from `#dc2626` to `#1e3a5f`
   - Add gold accent `#d4942a`
   - Reserve red for safety only
   - File: `src/styles/global.css` (token changes only)

2. **Fix mobile navigation** -- Replace wrapping flex with scrollable pill tabs
   - Horizontal scroll with `-webkit-overflow-scrolling: touch`
   - Pill-shaped category buttons
   - File: `src/styles/global.css` + `src/layouts/Base.astro`

3. **Add dark mode** -- CSS-only via `prefers-color-scheme`
   - Add dark token overrides at the end of global.css
   - No JavaScript needed

4. **Improve article list density** -- Tighter spacing, relative time, truncated excerpts
   - Modify `.article-item` padding and layout
   - Add relative time helper to `categories.ts`
   - File: `src/lib/categories.ts`, `src/pages/index.astro`, `src/styles/global.css`

5. **Typography refinement** -- Add clamp() sizing, proper Japanese line-height
   - Update font stack, add `font-feature-settings: "palt"`
   - File: `src/styles/global.css`

6. **Make badge pills** -- Change border-radius from 3px to 999px for modern pill shape
   - One CSS change

### Phase 2: Enhanced Features (This Month)

**Impact: High | Effort: Medium**

7. **Daily digest hero card** -- Special component for digest articles on homepage
   - Create a `DigestCard.astro` component
   - Filter digest articles and render separately above the list
   - Add exchange rate + weather display

8. **Safety alert banner** -- Conditional red banner when safety articles exist from today
   - Create `SafetyBanner.astro` component
   - Query for recent safety category articles
   - Render above header

9. **Desktop sidebar** -- Exchange rate widget, category list, recent articles
   - Modify `Base.astro` for 2-column layout on desktop
   - Create `Sidebar.astro` component

10. **Bottom navigation bar** -- Fixed mobile bottom nav
    - Create `BottomNav.astro` component
    - 5 key navigation items
    - CSS-only, no JavaScript

11. **Footer redesign** -- Dark footer with navigation, about text, disclaimer
    - Expand current minimal footer

12. **Structured data** -- Add NewsArticle JSON-LD schema
    - Improve Google News indexing
    - Add to article page template

### Phase 3: Advanced Features (3 Months)

**Impact: Medium | Effort: High**

13. **PWA implementation** -- manifest.json, service worker, offline support
    - Cache strategy for articles
    - Offline reading capability
    - Push notifications for safety alerts (requires backend)

14. **Search functionality** -- Client-side search with Pagefind (Astro-compatible)
    - Pagefind generates a search index at build time
    - Zero runtime cost, works offline

15. **Reading progress indicator** -- Scroll-based progress bar on article pages
    - Small JS snippet for scroll tracking

16. **OGP image generation** -- Auto-generate social sharing images
    - Use `@astrojs/og` or Satori for build-time OGP image generation
    - Category color + title text overlay

17. **Related articles** -- Show related articles by category/tags at article bottom
    - Static generation at build time, no runtime cost

18. **Analytics integration** -- Lightweight, privacy-respecting analytics
    - Plausible or Umami (self-hosted)
    - Future: access ranking widget based on real data

---

## Appendix: Quick-Reference Mockup Descriptions

### Mobile Homepage (320-767px)

```
┌─────────────────────────┐
│ DonesiaNavi        [🌙] │  <- Logo + dark mode toggle
├─────────────────────────┤
│ [全て][日常][安全][社会] │  <- Scrollable category tabs
│     [経済][生活][旅行]→  │     (scroll indicator)
├─────────────────────────┤
│ ⚠ 安全情報: ジャカルタ  │  <- Safety banner (if active)
│   南部で洪水発生 [詳細]  │     Red bg, white text
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ 今日のインドネシア    │ │  <- Digest hero card
│ │ 2026年4月2日（木）   │ │     Blue gradient bg
│ │                     │ │
│ │ 💱 1円=108.5IDR ▲   │ │
│ │ 🌤 Jakarta 32°C     │ │
│ │                     │ │
│ │ ・見出し1           │ │
│ │ ・見出し2           │ │
│ │ ・見出し3           │ │
│ │        [全文を読む→] │ │
│ └─────────────────────┘ │
├─────────────────────────┤
│ 最新ニュース            │  <- Section header
├─────────────────────────┤
│ [安全] タイトル... 3h前 │  <- Article list items
│  短い説明文1行...       │
│─────────────────────────│
│ [経済] タイトル... 5h前 │
│  短い説明文1行...       │
│─────────────────────────│
│ [社会] タイトル... 8h前 │
│  短い説明文1行...       │
│─────────────────────────│
│ ...                     │
├─────────────────────────┤
│ [🏠][📂][🛡][🔍][⚙]    │  <- Fixed bottom nav
└─────────────────────────┘
```

### Desktop Homepage (1024px+)

```
┌──────────────────────────────────────────────────────────┐
│  DonesiaNavi                          [検索] [🌙 ダーク]  │
│  インドネシア在住日本人のための情報ポータル                   │
├──────────────────────────────────────────────────────────┤
│  [全て] [日常] [安全] [社会] [経済] [生活] [旅行] [ビザ] [規制] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────┐  ┌──────────────────┐  │
│  │                              │  │  為替レート       │  │
│  │   今日のインドネシア 4/2      │  │  1JPY = 108.5IDR │  │
│  │   💱 1円=108.5IDR  🌤 32°C   │  │  ▲ 0.3%          │  │
│  │                              │  ├──────────────────┤  │
│  │   ・見出し1                  │  │  ジャカルタの天気  │  │
│  │   ・見出し2                  │  │  32°C くもり      │  │
│  │   ・見出し3                  │  ├──────────────────┤  │
│  │              [全文を読む →]   │  │  カテゴリ         │  │
│  └──────────────────────────────┘  │  ・今日のインドネシア │
│                                    │  ・安全・災害      │  │
│  最新ニュース                       │  ・社会・政治      │  │
│  ─────────────────────────────     │  ・経済・ビジネス   │  │
│  [安全] タイトル...      3時間前    │  ・生活・グルメ    │  │
│   説明文が2行まで表示されます。     │  ・旅行・お出かけ   │  │
│   長い場合は省略されます...        │  ・ビザ・手続き    │  │
│  ─────────────────────────────     │  ・規制・法務      │  │
│  [経済] タイトル...      5時間前    ├──────────────────┤  │
│   説明文2行...                     │  最近の記事        │  │
│  ─────────────────────────────     │  ・記事タイトル    │  │
│  ...                               │  ・記事タイトル    │  │
│                                    │  ・記事タイトル    │  │
│                                    └──────────────────┘  │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐│
│  │  DonesiaNavi について | カテゴリ一覧 | お問い合わせ    ││
│  │  AI生成ニュース。人間のレビュー済み。                  ││
│  │  (c) 2026 DonesiaNavi                               ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### Article Page (Mobile)

```
┌─────────────────────────┐
│ DonesiaNavi        [🌙] │
├─────────────────────────┤
│ [← 戻る]               │
├─────────────────────────┤
│ ━━━━━━━━━ (progress 35%)│  <- Reading progress bar
├─────────────────────────┤
│ [安全] 2026年4月2日     │
│                         │
│ ジャカルタ南部で大規模   │  <- Article title
│ 洪水、日本人居住エリア   │
│ にも影響                 │
│                         │
│ #洪水 #ジャカルタ #安全  │
│─────────────────────────│
│                         │
│ 本文がここに表示されます。│
│ 行間は2.0で読みやすく設定│
│ されています。日本語の長文│
│ 記事でも快適に読めるよう  │
│ 最適化しています。       │
│                         │
│ ■ 見出し2               │  <- Sticky on scroll
│                         │
│ セクション本文...        │
│                         │
│─────────────────────────│
│ 情報ソース: Liputan6     │
│─────────────────────────│
│ ℹ AI生成記事。公式情報を │
│   ご確認ください。       │
│─────────────────────────│
│ [← トップに戻る]        │
├─────────────────────────┤
│ [🏠][📂][🛡][🔍][⚙]    │
└─────────────────────────┘
```

---

## Summary of Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary color | Navy blue #1e3a5f | Trust, professionalism; red reserved for alerts |
| Layout | Single-column mobile, 2-column desktop | 70%+ mobile audience |
| Navigation | Scrollable pill tabs + bottom nav | SmartNews pattern, proven for mobile |
| Article images | None | AI-generated content; stock photos add no value |
| Daily digest | Hero card with embedded utilities | Most valuable content gets premium position |
| Safety alerts | Full-width red banner, highest z-index | Life-critical info must be unmissable |
| Typography | System fonts, line-height 2.0, clamp() sizing | Zero loading cost, Japanese readability |
| CSS framework | None (custom properties + layers) | 400 lines is sufficient; no framework overhead |
| Dark mode | CSS-only, prefers-color-scheme | No JS, respects OS preference |
| PWA | Phase 2 | High value for Indonesia connectivity, moderate effort |
| AMP | Skip entirely | Deprecated for SEO, unnecessary overhead |
| Images | Future: OGP only (auto-generated) | Performance-first, text-focused content |
