#!/usr/bin/env bash
# ops/launchd/*.plist を ~/Library/LaunchAgents にコピーし、launchd に登録し直す(冪等)。
# 実行すると日次生成・月次改訂が Mac の launchd で動き始める。実行前に docs/guide-pipeline.md の
# 「実行場所」節(キーチェーン登録・初回の許可ダイアログ)を確認すること。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SRC_DIR="$SCRIPT_DIR/../../ops/launchd"
DEST_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

BIN_DIR="$HOME/Library/Application Support/donesia-navi-guide/bin"
mkdir -p "$DEST_DIR" "$HOME/Library/Logs/donesia-navi-guide" "$BIN_DIR"
# 固定ランチャーを設置する(plist はこれを実行する。ジョブ本体は専用 worktree の origin/main 版)
cp "$SCRIPT_DIR/guide-launcher.sh" "$BIN_DIR/guide-launcher.sh"
chmod +x "$BIN_DIR/guide-launcher.sh"
echo "ランチャーを設置しました: $BIN_DIR/guide-launcher.sh"
for src in "$SRC_DIR"/com.shogonishino.donesia-guide-*.plist; do
  name="$(basename "$src")"
  label="${name%.plist}"
  plutil -lint "$src" >/dev/null
  cp "$src" "$DEST_DIR/$name"
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$DEST_DIR/$name"
  echo "登録しました: $label"
done
echo "確認: launchctl print $DOMAIN/com.shogonishino.donesia-guide-generate | head"
