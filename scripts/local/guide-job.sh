#!/usr/bin/env bash
# ガイド記事の日次生成・月次改訂を、オーナーの Mac(launchd)で実行するジョブ。
#
# 理由: GitHub Actions のランナーからは www.imigrasi.go.id / evisa.imigrasi.go.id / lovebali.baliprov.go.id が
# HTTP 403(データセンターIP遮断)で、出典の一部が取れない。Mac の回線からは取得できる。
# 詳細は docs/guide-pipeline.md「実行場所」節。
#
# 使い方:
#   guide-job.sh generate [--topic <id>] [--dry-run] [--force]
#   guide-job.sh generate --topic <id> --replace [--dry-run]   # 公開済みガイドの作り直し(PRは auto/guide-refresh-<id>-<YYYYMMDD>。承認=mergeのみ)
#   guide-job.sh refresh [--dry-run]
#     --dry-run : Gemini を呼ばずフィクスチャで生成し、commit/push/PR/Issue はせず「実行するはずのコマンド」をログに出す
#     GUIDE_JOB_SKIP_SYNC=1 : 開発用。worktree を origin/main に合わせない
#     --force   : generate の「同日に生成済みなら何もしない」ガードを無視する
#     --replace : 公開済み記事の作り直し。--topic 必須。同日ガードは対象外(topic 明示指定と同じ)
#
# 通常は launchd → scripts/local/guide-launcher.sh(install-launchd.sh が設置)→ worktree 内のこのスクリプト(= origin/main 版)の順で実行される。
# 本リポジトリの作業ツリーには触れない。専用 worktree("$HOME/Library/Application Support/donesia-navi-guide/worktree")で作業する。
# force push は使わない(AGENTS.md 絶対ルール7)。
set -eEuo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# 親リポジトリ(worktree 内のスクリプトとして実行されても、common dir の親 = 本リポジトリ)
REPO_DIR="$(cd "$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)/.." && pwd -P)"
STATE_DIR="$HOME/Library/Application Support/donesia-navi-guide"
WORKTREE="$STATE_DIR/worktree"
LOCK_DIR="$STATE_DIR/lock"
LOCK_HASH_FILE="$STATE_DIR/package-lock.sha256"
LOG_DIR="$HOME/Library/Logs/donesia-navi-guide"
KEYCHAIN_SERVICE="donesia-navi-gemini"

usage() {
  echo "usage: guide-job.sh generate [--topic <id> [--replace]] [--dry-run] [--force] | refresh [--dry-run]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
JOB="$1"; shift
case "$JOB" in generate | refresh) ;; *) usage ;; esac

DRY_RUN=0
FORCE=0
REPLACE=0
TOPIC_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --force) FORCE=1 ;;
    --replace) REPLACE=1 ;;
    --topic)
      [ $# -ge 2 ] || usage
      TOPIC_ID="$2"; shift ;;
    *) usage ;;
  esac
  shift
done
if [ -n "$TOPIC_ID" ] && [ "$JOB" != generate ]; then usage; fi
if [ "$REPLACE" = 1 ] && { [ "$JOB" != generate ] || [ -z "$TOPIC_ID" ]; }; then
  echo "--replace は 'generate --topic <id>' でのみ使えます" >&2
  usage
fi

# ------------------------------------------------------------------ ログ・ロック
mkdir -p "$LOG_DIR" "$STATE_DIR"
LOG_FILE="$LOG_DIR/$JOB-$(date +%Y%m%d).log"
exec > >(tee -a "$LOG_FILE") 2>&1

log() { printf '%s [%s] %s\n' "$(date '+%F %T')" "$JOB" "$*"; }

TMP_DIR=""
cleanup() {
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"
  rm -rf "$LOCK_DIR"
}

# 30日より古いジョブログを削除(launchd-*.log は launchd が追記するので対象外)
find "$LOG_DIR" -maxdepth 1 -type f \( -name 'generate-*.log' -o -name 'refresh-*.log' \) -mtime +30 -delete 2>/dev/null || true

log "開始 job=$JOB dry_run=$DRY_RUN topic=${TOPIC_ID:-(自動)} replace=$REPLACE repo=$REPO_DIR"

# 多重起動防止(generate と refresh は同じ worktree を使うため、ロックは共通)
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ >"$LOCK_DIR/pid"
    return 0
  fi
  local pid
  pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  log "古いロックを削除します(pid=${pid:-不明} は存在しません)"
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null || return 1
  echo $$ >"$LOCK_DIR/pid"
}
if ! acquire_lock; then
  log "別のジョブが実行中のため終了します(ロック: $LOCK_DIR)"
  trap - EXIT
  exit 0
fi
trap cleanup EXIT
trap 'log "ERROR: 行 $LINENO で失敗しました(exit $?)"' ERR
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/donesia-guide.XXXXXX")"
TMP_DIR="$(cd "$TMP_DIR" && pwd -P)"

# 変更系コマンド。dry-run では実行せず、実行するはずのコマンドをログに出す。
act() {
  if [ "$DRY_RUN" = 1 ]; then
    local shown="" a
    for a in "$@"; do shown="$shown '${a//\'/\'\\\'\'}'"; done
    log "[dry-run] 実行するはずのコマンド:${shown}"
  else
    "$@"
  fi
}

# ------------------------------------------------------------------ worktree の準備
prepare_worktree() {
  git -C "$REPO_DIR" fetch origin --quiet
  if [ ! -e "$WORKTREE/.git" ]; then
    log "専用 worktree を作成します: $WORKTREE"
    git -C "$REPO_DIR" worktree prune
    git -C "$REPO_DIR" worktree add --detach "$WORKTREE" origin/main
  fi
  cd "$WORKTREE"
  if [ "${GUIDE_JOB_SKIP_SYNC:-0}" = 1 ]; then
    # 開発時の動作確認用(worktree に未pushの変更を置いて試す)。launchd の本番実行では使わない。
    log "GUIDE_JOB_SKIP_SYNC=1: worktree を origin/main に合わせず、現状のまま使います"
  else
    git fetch origin --quiet
    git reset --hard -q
    git checkout --detach -f -q origin/main
    git clean -fdxq -e node_modules
    log "worktree を origin/main($(git rev-parse --short HEAD))に合わせました"
  fi

  local now prev
  now="$(shasum -a 256 package-lock.json | cut -d' ' -f1)"
  prev="$(cat "$LOCK_HASH_FILE" 2>/dev/null || true)"
  if [ ! -d node_modules ] || [ "$now" != "$prev" ]; then
    log "package-lock.json が変わった(または node_modules が無い)ため npm ci を実行します"
    npm ci --no-audit --no-fund --loglevel=error
    echo "$now" >"$LOCK_HASH_FILE"
  else
    log "package-lock.json は前回と同じため npm ci を省略します"
  fi
}

# ------------------------------------------------------------------ 秘密・GitHub 情報
GEMINI_KEY=""
load_gemini_key() {
  if ! GEMINI_KEY="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$USER" -w 2>/dev/null)" || [ -z "$GEMINI_KEY" ]; then
    log "ERROR: キーチェーンに Gemini API キー($KEYCHAIN_SERVICE)がありません。次のコマンドで登録してください(キーは対話入力):"
    log "  security add-generic-password -s $KEYCHAIN_SERVICE -a \"\$USER\" -w"
    exit 1
  fi
}

GH_REPO_NAME=""
load_github_env() {
  if ! GITHUB_TOKEN="$(gh auth token 2>/dev/null)" || [ -z "$GITHUB_TOKEN" ]; then
    log "ERROR: gh にログインしていません。'gh auth login' を実行してください"
    exit 1
  fi
  export GITHUB_TOKEN
  GH_REPO_NAME="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
  export GITHUB_REPOSITORY="$GH_REPO_NAME"
}

# ------------------------------------------------------------------ 共通の GitHub 操作
remote_branch_exists() { git ls-remote --exit-code --heads origin "$1" >/dev/null 2>&1; }

open_pr_number() { gh pr list --head "$1" --state open --json number --jq '.[0].number // empty'; }

# 失敗トピックの JSON([{id, reason}])を Issue にする。同名の open な Issue があれば作らない(generate-guide.yml と同じ規則)。
report_failed_topics() {
  local file="$1" row id reason title existing body
  [ -f "$file" ] || { log "失敗したトピックはありません。"; return 0; }
  while read -r row; do
    id="$(echo "$row" | jq -r .id)"
    reason="$(echo "$row" | jq -r .reason)"
    title="ガイド記事の生成に失敗: $id"
    if [ "$DRY_RUN" = 1 ]; then
      log "[dry-run] 失敗トピックを Issue 化するはずです: $title"
      continue
    fi
    existing="$(gh issue list --state open --limit 100 --search "\"$title\" in:title" --json title --jq "[.[] | select(.title == \"$title\")] | length")"
    if [ "$existing" != "0" ]; then
      log "同名の open issue が既にあるため作成しません: $title"
      continue
    fi
    body="$TMP_DIR/issue.md"
    printf '%s\n\n%s\n\n%s\n' "トピック \`$id\` を自動生成できませんでした(実行: Mac の launchd / $(hostname -s) / $(date '+%F %T'))。" "$reason" "出典(official-sources.json / extraReferences)を見直すか、台帳で status を on-hold にしてください。" >"$body"
    gh issue create --title "$title" --body-file "$body"
  done < <(jq -c '.[]' "$file")
}

# ------------------------------------------------------------------ generate
# 今日(JST)に作られた日次生成PR(auto/guide-<id>。topics/refresh を除く)があるか。あれば1日1本の原則で何もしない。
generated_today_pr() {
  local today
  today="$(TZ=Asia/Tokyo date +%Y-%m-%d)"
  gh pr list --state all --limit 50 --json headRefName,createdAt \
    --jq "[.[] | select((.headRefName | startswith(\"auto/guide-\")) and (.headRefName | startswith(\"auto/guide-topics-\") | not) and (.headRefName | startswith(\"auto/guide-refresh-\") | not)) | select((.createdAt | fromdateiso8601 + 32400 | strftime(\"%Y-%m-%d\")) == \"$today\") | .headRefName] | first // empty"
}

compose_pr_body() {
  local id="$1" report="$2" out="$3"
  {
    printf '%s\n' "バリ向けガイド記事の自動生成ドラフトです(トピックID: \`$id\`)。\`draft: true\` のため、マージしても公開されません。" ""
    printf '%s\n' '- 本文は、台帳(`src/data/guide-topics.json`)と出典一覧(`src/data/official-sources.json`)に登録された公的機関・一次情報の公開ページだけを根拠に生成しています。'
    printf '%s\n' '- 「要確認」と書かれた箇所は、資料に記載がない・資料間で矛盾する事項です。公的機関の最新情報で確認してから公開してください。'
    printf '%s\n' '- `references` の各URLと本文の内容を照合してください。`lastVerified` は資料を取得・照合した日です。'
    printf '%s\n' '- 却下する場合はこのPRを **close** してください(同じトピックは再生成されません)。' ""
    printf '%s\n' 'Slackの「承認して公開」で `draft: false` にしてmergeできます。(実行: Mac の launchd)'
    if [ -f "$report" ]; then
      echo
      cat "$report"
    fi
  } >"$out"
}

# 公開済み記事の作り直しPR(--replace)の本文。除去URL・見出し置換の報告があれば末尾に付ける。
compose_replace_pr_body() {
  local id="$1" report="$2" out="$3"
  {
    printf '%s\n' "公開済みガイド記事の作り直しです(トピックID: \`$id\`)。" ""
    printf '%s\n' '公開済み記事の作り直し(理由: 出典の追加・見出し整理)。差分を確認して承認してください。'
    printf '%s\n' '- `pubDate` / `draft` / `hasAffiliate` は既存記事から引き継ぎ、`updatedDate` と `lastVerified` を当日にしています。出典スナップショットも更新します。'
    printf '%s\n' '- 公開済み(`draft: false`)のまま変更されるため、Slackの承認(= merge)で本番に反映されます。' ""
    printf '%s\n' '却下する場合はこのPRを **close** してください。(実行: Mac の launchd)'
    if [ -f "$report" ]; then
      echo
      cat "$report"
    fi
  } >"$out"
}

job_generate() {
  local report_dir="$TMP_DIR/report" rc=0
  mkdir -p "$report_dir"

  if [ "$DRY_RUN" = 0 ]; then
    load_gemini_key
    load_github_env
  fi

  # 同日ガードは topic 明示指定(--replace を含む)のときは対象外
  if [ -z "$TOPIC_ID" ] && [ "$FORCE" = 0 ]; then
    local today_pr=""
    if [ "$DRY_RUN" = 1 ]; then
      today_pr="$(generated_today_pr 2>/dev/null || true)"
      if [ -n "$today_pr" ]; then
        log "[dry-run] 同日ガードの確認: 今日作成済み($today_pr)。実行時はここで終了します"
      else
        log "[dry-run] 同日ガードの確認: 今日作成済みのPRはありません"
      fi
    else
      today_pr="$(generated_today_pr)"
      if [ -n "$today_pr" ]; then
        log "今日(JST)は既に日次生成PR($today_pr)があるため、何もしません(--force で無視できます)"
        return 0
      fi
    fi
  fi

  local -a node_args=()
  [ "$DRY_RUN" = 1 ] && node_args+=(--dry-run)
  [ "$REPLACE" = 1 ] && node_args+=(--replace)
  log "node scripts/generate-guide.mjs ${node_args[*]:-}"
  set +e
  GUIDE_REPORT_DIR="$report_dir" GEMINI_API_KEY="$GEMINI_KEY" GUIDE_TOPIC_ID="$TOPIC_ID" node scripts/generate-guide.mjs ${node_args[@]+"${node_args[@]}"}
  rc=$?
  set -e

  report_failed_topics "$report_dir/guide-generate-failures.json"
  if [ "$rc" -ne 0 ]; then
    log "ERROR: generate-guide.mjs が exit $rc で失敗しました"
    exit "$rc"
  fi

  if [ ! -f "$report_dir/guide-result.json" ]; then
    log "ERROR: generate-guide.mjs は正常終了しましたが結果ファイルがありません(スクリプトが実行されなかった可能性)"
    exit 1
  fi
  if [ "$(jq -r '.generated // false' "$report_dir/guide-result.json" 2>/dev/null || echo false)" != "true" ]; then
    log "生成すべきトピックが無かったため、正常終了します"
    return 0
  fi

  local id title file snapshot branch
  id="$(jq -r .topic_id "$report_dir/guide-result.json")"
  title="$(jq -r .title "$report_dir/guide-result.json")"
  file="$(jq -r .file "$report_dir/guide-result.json")"
  snapshot="$(jq -r .snapshot "$report_dir/guide-result.json")"
  branch="auto/guide-$id"
  local pr_title="ガイド記事ドラフト: $title"
  local commit_new="Add guide draft: $id" commit_regen="Regenerate guide draft: $id"
  if [ "$REPLACE" = 1 ]; then
    # auto/guide-refresh-* は detectNotifyKind で 'refresh'(承認=mergeのみ)になり、日次生成の同日ガード・オープンPR判定からも外れる
    branch="auto/guide-refresh-$id-$(TZ=Asia/Tokyo date +%Y%m%d)"
    pr_title="ガイド記事の改訂: $title"
    commit_new="Replace guide: $id"
    commit_regen="Replace guide (update): $id"
    log "作り直しました: $id(「${title}」)ブランチ=$branch"
    compose_replace_pr_body "$id" "$report_dir/guide-removed-urls.md" "$TMP_DIR/pr-body.md"
  else
    log "生成されました: $id(「${title}」)"
    compose_pr_body "$id" "$report_dir/guide-removed-urls.md" "$TMP_DIR/pr-body.md"
  fi
  log "PRタイトル: $pr_title"
  log "ブランチ: $branch"

  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] 生成物(一時ディレクトリ): $file / $snapshot"
    log "[dry-run] PR本文(先頭):"
    head -n 12 "$TMP_DIR/pr-body.md" | sed 's/^/    | /'
    if [ -f "$report_dir/guide-removed-urls.md" ]; then log "[dry-run] レビュー用の報告(除去URL・置換見出し)がPR本文に付きます"; fi
    act git checkout -B "$branch" origin/main
    act git add -- "src/content/articles/$id.md" "src/data/guide-source-snapshots/$id.json"
    act git commit -m "$commit_new"
    act git push origin "$branch"
    act gh pr create --base main --head "$branch" --title "$pr_title" --body-file "$TMP_DIR/pr-body.md"
    return 0
  fi

  # 生成物を退避 → ブランチへ切り替え → 置き直して通常の commit(force push はしない)
  local stash="$TMP_DIR/stash"
  mkdir -p "$stash/$(dirname "$file")" "$stash/$(dirname "$snapshot")"
  mv "$file" "$stash/$file"
  mv "$snapshot" "$stash/$snapshot"
  local action_msg="$commit_new"
  if remote_branch_exists "$branch"; then
    action_msg="$commit_regen"
    log "リモートに既存ブランチ $branch があります。その上に通常の commit を積みます"
    git fetch origin "$branch" --quiet
    git checkout -f -q -B "$branch" "origin/$branch"
  else
    git checkout -f -q -B "$branch" origin/main
  fi
  mkdir -p "$(dirname "$file")" "$(dirname "$snapshot")"
  cp "$stash/$file" "$file"
  cp "$stash/$snapshot" "$snapshot"
  git add -- "$file" "$snapshot"
  if git diff --cached --quiet; then
    log "既存ブランチと差分が無いため commit しません"
  else
    git commit -q -m "$action_msg"
    log "commit: $(git rev-parse --short HEAD) $action_msg"
  fi
  git push origin "$branch"

  local pr
  pr="$(open_pr_number "$branch")"
  if [ -z "$pr" ]; then
    gh pr create --base main --head "$branch" --title "$pr_title" --body-file "$TMP_DIR/pr-body.md"
  else
    log "オープンなPR #$pr があるため、push のみで更新しコメントを残します"
    {
      echo "再生成しました($(TZ=Asia/Tokyo date '+%F %T') JST / Mac の launchd)。ブランチに新しい commit を追加しています。"
      if [ -f "$report_dir/guide-removed-urls.md" ]; then
        echo
        cat "$report_dir/guide-removed-urls.md"
      fi
    } >"$TMP_DIR/comment.md"
    gh pr comment "$pr" --body-file "$TMP_DIR/comment.md"
  fi
  git checkout -f -q --detach origin/main
}

# ------------------------------------------------------------------ refresh
job_refresh() {
  local out="$TMP_DIR/guide-refresh" rc=0
  if [ "$DRY_RUN" = 0 ]; then
    load_gemini_key
    load_github_env
  fi
  local -a node_args=("--out-dir=$out")
  [ "$DRY_RUN" = 1 ] && node_args+=(--dry-run)
  log "node scripts/refresh-guides.mjs ${node_args[*]}"
  set +e
  GEMINI_API_KEY="$GEMINI_KEY" node scripts/refresh-guides.mjs ${node_args[@]+"${node_args[@]}"}
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    log "ERROR: refresh-guides.mjs が exit $rc で失敗しました"
    exit "$rc"
  fi

  local result="$out/result.json" base_sha count i branch title dir pr
  base_sha="$(git rev-parse HEAD)"
  count="$(jq '.groups | length' "$result")"
  log "PR候補: $count グループ"
  for i in $(seq 0 $((count - 1))); do
    [ "$count" -gt 0 ] || break
    branch="$(jq -r ".groups[$i].branch" "$result")"
    title="$(jq -r ".groups[$i].title" "$result")"
    dir="$(jq -r ".groups[$i].dir" "$result")"
    if [ "$DRY_RUN" = 1 ]; then
      log "[dry-run] グループ $i: $branch 「${title}」 files=$(jq -r ".groups[$i].files | join(\",\")" "$result")"
      act git checkout -B "$branch" "$base_sha"
      act git add -- $(jq -r ".groups[$i].files | join(\" \")" "$result")
      act git commit -m "$title"
      act git push origin "$branch"
      act gh pr create --base main --head "$branch" --title "$title" --body-file "$dir/body.md"
      continue
    fi
    if remote_branch_exists "$branch"; then
      log "既存ブランチ $branch の上に通常の commit を積みます"
      git fetch origin "$branch" --quiet
      git checkout -f -q -B "$branch" "origin/$branch"
    else
      git checkout -f -q -B "$branch" "$base_sha"
    fi
    cp -R "$dir/files/." .
    jq -r ".groups[$i].files[]" "$result" | xargs git add --
    if git diff --cached --quiet; then
      log "$branch: 差分が無いため commit しません"
    else
      git commit -q -m "$title"
    fi
    git push origin "$branch"
    pr="$(open_pr_number "$branch")"
    if [ -n "$pr" ]; then
      gh pr edit "$pr" --title "$title" --body-file "$dir/body.md"
    else
      gh pr create --base main --head "$branch" --title "$title" --body-file "$dir/body.md"
    fi
    git checkout -f -q --detach "$base_sha"
  done

  # 取得・改訂に失敗した記事は更新せず Issue で知らせる(同名の open な Issue があれば作らない)
  if [ "$(jq -r .hasIssue "$result")" != "true" ]; then
    log "失敗した記事はありません。"
    return 0
  fi
  local issue_title existing
  issue_title="$(jq -r .issueTitle "$result")"
  if [ "$DRY_RUN" = 1 ]; then
    log "[dry-run] Issue を作るはずです: $issue_title"
    return 0
  fi
  existing="$(gh issue list --state open --limit 100 --search "\"$issue_title\" in:title" --json title --jq "[.[] | select(.title == \"$issue_title\")] | length")"
  if [ "$existing" != "0" ]; then
    log "同名の open issue が既にあるため作成しません: $issue_title"
    return 0
  fi
  gh issue create --title "$issue_title" --body-file "$out/issue-body.md"
}

# ------------------------------------------------------------------ main
prepare_worktree
case "$JOB" in
  generate) job_generate ;;
  refresh) job_refresh ;;
esac
log "完了"
