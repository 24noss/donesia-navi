export const cuisineConfig = {
  japanese:    { label: '日本食', color: '#1B2D4F', icon: '🍣' },
  korean:      { label: '韓国料理', color: '#CE3B3B', icon: '🍖' },
  chinese:     { label: '中華料理', color: '#D97706', icon: '🥟' },
  indonesian:  { label: 'インドネシア料理', color: '#C9A44A', icon: '🌶️' },
  european:    { label: '西洋料理', color: '#3A6B8C', icon: '🍷' },
  cafe:        { label: 'カフェ', color: '#64748B', icon: '☕' },
  other:       { label: 'その他', color: '#7A8A9E', icon: '🍽️' },
} as const;

export type CuisineType = keyof typeof cuisineConfig;

export const priceLabels: Record<string, string> = {
  budget: '¥', mid: '¥¥', high: '¥¥¥', luxury: '¥¥¥¥',
};
