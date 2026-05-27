#!/bin/bash
# KAIROS FX — Update Obsidian hot note
# Usage: ./scripts/update-obsidian.sh "summary text"
# Or pipe: echo "summary" | ./scripts/update-obsidian.sh

HOT="$HOME/Desktop/Vault/wiki/hot.md"
DATE=$(date -u +"%Y-%m-%d %H:%M UTC")

if [ -n "$1" ]; then
  SUMMARY="$1"
else
  SUMMARY=$(cat)
fi

# Prepend new entry to hot.md (keeps history, newest on top)
TMPFILE=$(mktemp)
echo "## Auto-update — $DATE" >> "$TMPFILE"
echo "" >> "$TMPFILE"
echo "$SUMMARY" >> "$TMPFILE"
echo "" >> "$TMPFILE"
echo "---" >> "$TMPFILE"
echo "" >> "$TMPFILE"
cat "$HOT" >> "$TMPFILE"
mv "$TMPFILE" "$HOT"

echo "✅ Obsidian hot.md updated — $DATE"
