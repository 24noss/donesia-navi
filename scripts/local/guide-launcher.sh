#!/usr/bin/env bash
# launchd から呼ばれる固定ランチャー。install-launchd.sh が
# "$HOME/Library/Application Support/donesia-navi-guide/bin/guide-launcher.sh" にコピーする(リポジトリ作業ツリーの
# ブランチ切替の影響を受けないようにするため)。
# 専用 worktree を origin/main に最新化し、worktree 内の scripts/local/guide-job.sh(= 常に origin/main 版)を実行する。
# 引数は guide-job.sh にそのまま渡す。小さく保ち、このファイル自体を変えたら install-launchd.sh を再実行する。
#   GUIDE_JOB_SKIP_SYNC=1 : 開発用。worktree を origin/main に合わせず現状のまま使う(guide-job.sh 側も同様)
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO_DIR="/Users/shogonishino/Personal/donesia-navi"
STATE_DIR="$HOME/Library/Application Support/donesia-navi-guide"
WORKTREE="$STATE_DIR/worktree"
LOG_DIR="$HOME/Library/Logs/donesia-navi-guide"
mkdir -p "$STATE_DIR" "$LOG_DIR"

sync_worktree() {
  # 別ジョブが実行中(ロック保持)なら worktree を触らない。ジョブ本体がロックで即終了する。
  local pid
  pid="$(cat "$STATE_DIR/lock/pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "$(date '+%F %T') [launcher] 別ジョブ実行中のため worktree の同期を省略します"
    return 0
  fi
  git -C "$REPO_DIR" fetch origin --quiet
  if [ ! -e "$WORKTREE/.git" ]; then
    git -C "$REPO_DIR" worktree prune
    git -C "$REPO_DIR" worktree add --detach "$WORKTREE" origin/main
  fi
  git -C "$WORKTREE" fetch origin --quiet
  git -C "$WORKTREE" reset --hard -q
  git -C "$WORKTREE" checkout --detach -f -q origin/main
}

if [ "${GUIDE_JOB_SKIP_SYNC:-0}" != 1 ]; then
  sync_worktree 2>&1 | tee -a "$LOG_DIR/launcher.log"
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "launcher: worktree の同期に失敗しました" >&2; exit 1; }
fi
exec /bin/bash "$WORKTREE/scripts/local/guide-job.sh" "$@"
