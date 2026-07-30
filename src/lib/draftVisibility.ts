// Cloudflare Pagesはビルド時にCF_PAGES_BRANCHへ実際のブランチ名を注入する
// (ローカル/本番ビルドでは未設定)。mainブランチ以外＝プレビューデプロイの場合のみ
// draft記事のページ生成を許可し、Slack承認フローでのレビューを可能にする。
// 本番(main)・ローカルでは常にfalseを返し、既存の非公開挙動を変えない。
export function shouldIncludeDrafts(): boolean {
  const branch = import.meta.env.CF_PAGES_BRANCH;
  return Boolean(branch) && branch !== 'main';
}
