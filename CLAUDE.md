@AGENTS.md

## Claude Code 固有

- セッション開始時に SessionStart hook が STATE.md と直近の LESSONS を注入する。内容が古ければ先に STATE.md を直す。
- 作業終了前に、学びがあれば `LESSONS.md` に、進捗があれば `STATE.md` に書き戻す(Stop hook が1回だけ促す)。
- 完了報告の前に `./verify` を実行し、結果を報告に含める。
- `.claude/worktrees/` は gitignore 済みの作業用領域。検索対象から外して読む。
