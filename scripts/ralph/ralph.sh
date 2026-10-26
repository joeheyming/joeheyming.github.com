#!/bin/bash
# Ralph loop for joeheyming.github.io /paint/.
# Each iteration is a fresh agent with clean context.
# Memory persists via git history, scripts/ralph/prd.json, and scripts/ralph/progress.txt.
#
# Usage:
#   ./scripts/ralph/ralph.sh [max_iterations]
#   ./scripts/ralph/ralph.sh --tool claude [max_iterations]
#   ./scripts/ralph/ralph.sh --tool cursor [max_iterations]
#
# Default tool is deCLAWd (sandboxed Claude Code). Requires `jq`.
# deCLAWd --yolo needs the secure VPN; without it, permission prompts come back.

set -euo pipefail

TOOL="declawd"
MAX_ITERATIONS=10

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --tool=*)
      TOOL="${1#*=}"
      shift
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      else
        echo "Error: unexpected argument '$1'"
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ "$TOOL" != "declawd" && "$TOOL" != "cursor" && "$TOOL" != "claude" ]]; then
  echo "Error: invalid tool '$TOOL'. Use 'declawd', 'cursor', or 'claude'."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
PROMPT_FILE="$SCRIPT_DIR/prompt.md"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"

if [[ ! -f "$PRD_FILE" ]]; then
  echo "Error: missing $PRD_FILE"
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required (brew install jq)."
  exit 1
fi

BRANCH="$(jq -r '.branchName // empty' "$PRD_FILE")"
if [[ -z "$BRANCH" || "$BRANCH" == "master" || "$BRANCH" == "main" ]]; then
  echo "Error: prd.json branchName must be a feature branch, not master/main."
  exit 1
fi

# Archive the previous run when the feature branch changes.
if [[ -f "$LAST_BRANCH_FILE" ]]; then
  LAST_BRANCH="$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")"
  if [[ -n "$LAST_BRANCH" && "$LAST_BRANCH" != "$BRANCH" ]]; then
    DATE="$(date +%Y-%m-%d)"
    FOLDER_NAME="$(echo "$LAST_BRANCH" | sed 's|^ralph/||')"
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"
    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [[ -f "$PROGRESS_FILE" ]] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "# Ralph Progress Log" > "$PROGRESS_FILE"
    echo "Started: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi
echo "$BRANCH" > "$LAST_BRANCH_FILE"

if [[ ! -f "$PROGRESS_FILE" ]]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

cd "$REPO_ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: $REPO_ROOT is not a git repository."
  exit 1
fi

CURRENT="$(git branch --show-current)"
if [[ "$CURRENT" == "master" || "$CURRENT" == "main" ]]; then
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout "$BRANCH"
  else
    git checkout -b "$BRANCH"
  fi
elif [[ "$CURRENT" != "$BRANCH" ]]; then
  echo "Error: refusing to switch branches."
  echo "Current branch is '$CURRENT'. prd.json wants '$BRANCH'."
  echo "Checkout that branch yourself, or start from master so this script can create it."
  exit 1
fi

case "$TOOL" in
  declawd)
    if ! command -v declawd >/dev/null 2>&1; then
      echo "Error: declawd is not on PATH."
      exit 1
    fi
    ;;
  cursor)
    if ! command -v agent >/dev/null 2>&1; then
      echo "Error: Cursor agent CLI not on PATH (expected 'agent')."
      exit 1
    fi
    ABOUT="$(agent about 2>&1 || true)"
    if echo "$ABOUT" | grep -q "Not logged in"; then
      echo "Error: Cursor agent CLI is not logged in."
      echo "  agent --print refuses to run until you authenticate."
      echo "  In this terminal, run:  agent login"
      echo "  Or use the default:  ./scripts/ralph/ralph.sh --tool declawd $MAX_ITERATIONS"
      exit 1
    fi
    ;;
  claude)
    if ! command -v claude >/dev/null 2>&1; then
      echo "Error: claude CLI not on PATH."
      exit 1
    fi
    ;;
esac

echo "Starting Ralph"
echo "  Tool:       $TOOL"
echo "  Iterations: $MAX_ITERATIONS"
echo "  Branch:     $BRANCH"
echo "  Repo:       $REPO_ROOT"
echo "  Remaining:  $(jq '[.userStories[] | select(.passes == false)] | length' "$PRD_FILE") stories"

PASSED_BEFORE="$(jq '[.userStories[] | select(.passes == true)] | length' "$PRD_FILE")"
STALLS=0

for i in $(seq 1 "$MAX_ITERATIONS"); do
  OPEN="$(jq '[.userStories[] | select(.passes == false)] | length' "$PRD_FILE")"
  if [[ "$OPEN" -eq 0 ]]; then
    echo ""
    echo "Ralph: no open stories left at iteration $i of $MAX_ITERATIONS."
    echo "A person adds the next wave in scripts/ralph/prd.json when the window still disagrees with PhotoCraft."
    exit 0
  fi

  echo ""
  echo "==============================================================="
  echo "  Ralph iteration $i of $MAX_ITERATIONS ($TOOL) — $OPEN open"
  echo "==============================================================="

  case "$TOOL" in
    declawd)
      # --yolo is deCLAWd's unattended switch (Claude --dangerously-skip-permissions).
      # PhotoCraft is a read-only extra root. Skip the per-iteration skills upgrade.
      # deCLAWd starts Claude on a pty, so a stdin redirect never arrives.
      # Pass a short prompt argument; the full assignment is prompt.md in the repo.
      OUTPUT="$(
        declawd \
          --yolo \
          --skip-skills-upgrade \
          --additional-workspace /Users/jheyming/git/photocraft \
          "$REPO_ROOT" \
          --print \
          "Follow scripts/ralph/prompt.md. One story. Run only that story's test file with node --test. Do not run npm test, eslint, prettier, or parity-score. Then stop." \
          2>&1 | tee /dev/stderr
      )" || true
      ;;
    cursor)
      # --force lets the unattended loop edit, test, and commit.
      # --trust skips the workspace prompt. PhotoCraft is a read-only extra root.
      OUTPUT="$(
        agent --print --force --trust --output-format text \
          --workspace "$REPO_ROOT" \
          --add-dir /Users/jheyming/git/photocraft \
          "$(cat "$PROMPT_FILE")" 2>&1 | tee /dev/stderr
      )" || true
      ;;
    claude)
      OUTPUT="$(claude --dangerously-skip-permissions --print < "$PROMPT_FILE" 2>&1 | tee /dev/stderr)" || true
      ;;
  esac

  if echo "$OUTPUT" | grep -q "Authentication required\|cannot run without authentication"; then
    echo ""
    echo "Error: the agent CLI rejected the call (not logged in)."
    exit 1
  fi

  if echo "$OUTPUT" | grep -q "Input must be provided either through stdin"; then
    echo ""
    echo "Error: Claude started with --print but received no prompt."
    echo "deCLAWd does not forward stdin. The prompt has to be an argument."
    exit 1
  fi

  if echo "$OUTPUT" | grep -q "YOLO flags voided\|YOLO stays off"; then
    echo ""
    echo "Error: deCLAWd dropped --yolo, so this iteration would stop on permission prompts."
    echo "Connect to the secure VPN and rerun."
    exit 1
  fi

  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "Ralph completed all stories at iteration $i of $MAX_ITERATIONS."
    exit 0
  fi

  if echo "$OUTPUT" | grep -q "<promise>BLOCKED</promise>"; then
    echo ""
    echo "Ralph stopped: the agent reported BLOCKED."
    echo "See $PROGRESS_FILE"
    exit 1
  fi

  PASSED_AFTER="$(jq '[.userStories[] | select(.passes == true)] | length' "$PRD_FILE")"
  echo "Stories passing: $PASSED_AFTER"
  if [[ "$PASSED_AFTER" -le "$PASSED_BEFORE" ]]; then
    STALLS=$((STALLS + 1))
  else
    STALLS=0
  fi
  PASSED_BEFORE="$PASSED_AFTER"
  if [[ "$STALLS" -ge 2 ]]; then
    echo ""
    echo "No story passed in $STALLS iterations. Stopping so this does not repeat until iteration $MAX_ITERATIONS."
    echo "See $PROGRESS_FILE"
    exit 1
  fi

  echo "Iteration $i finished. Continuing..."
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) with stories still open."
echo "Status:"
jq '.userStories[] | {id, title, passes}' "$PRD_FILE"
echo "See $PROGRESS_FILE"
exit 1
