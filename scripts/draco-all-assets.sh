#!/bin/bash
# Sweep every Assets/*.glb > 1MB through Draco compression.
# Backs up original to BACKUP/draco-originals/<filename>.original.glb
# Skips files that are already small (≤1MB).
# Skips files that fail (logs to stderr, continues to next).
#
# Output: scripts/draco-sweep.log with one JSON line per file.

set -o pipefail
cd "$(dirname "$0")/.."

LOG="scripts/draco-sweep.log"
BACKUP="BACKUP/draco-originals"
mkdir -p "$BACKUP"

> "$LOG"
echo "[$(date '+%H:%M:%S')] Draco sweep starting…" | tee -a "$LOG"

# Collect candidates >1MB (macOS bash 3.2 compatible, no mapfile)
CAND_LIST=$(find Assets -name "*.glb" -size +1M | sort)
CAND_COUNT=$(echo "$CAND_LIST" | grep -c '^.')
echo "[$(date '+%H:%M:%S')] $CAND_COUNT candidates" | tee -a "$LOG"

TOTAL_IN=0
TOTAL_OUT=0
PROCESSED=0
SKIPPED=0
FAILED=0

while IFS= read -r in_path; do
  [ -z "$in_path" ] && continue
  fname=$(basename "$in_path")
  backup_path="$BACKUP/${fname}.original.glb"

  in_bytes=$(stat -f%z "$in_path" 2>/dev/null || stat -c%s "$in_path")

  # Back up original (only if no backup yet)
  if [ ! -f "$backup_path" ]; then
    cp "$in_path" "$backup_path" || { echo "  ✗ backup failed: $in_path" | tee -a "$LOG"; FAILED=$((FAILED+1)); continue; }
  fi

  # Compress to a temp file then atomically swap
  tmp_path="${in_path}.draco.tmp"
  if node scripts/draco-compress.mjs "$in_path" "$tmp_path" >>"$LOG" 2>&1; then
    out_bytes=$(stat -f%z "$tmp_path" 2>/dev/null || stat -c%s "$tmp_path")
    # Only swap if compression actually saved space (>10% smaller)
    if [ "$out_bytes" -lt "$((in_bytes * 90 / 100))" ]; then
      mv "$tmp_path" "$in_path"
      pct=$(( 100 - out_bytes * 100 / in_bytes ))
      echo "  ✓ $fname  $((in_bytes/1024/1024))MB → $((out_bytes/1024/1024))MB  (-${pct}%)" | tee -a "$LOG"
      TOTAL_IN=$((TOTAL_IN + in_bytes))
      TOTAL_OUT=$((TOTAL_OUT + out_bytes))
      PROCESSED=$((PROCESSED+1))
    else
      rm -f "$tmp_path"
      echo "  ~ $fname  already efficient, skipping swap" | tee -a "$LOG"
      SKIPPED=$((SKIPPED+1))
    fi
  else
    rm -f "$tmp_path"
    echo "  ✗ $fname  Draco failed (see log above)" | tee -a "$LOG"
    FAILED=$((FAILED+1))
  fi
done <<< "$CAND_LIST"

if [ "$TOTAL_IN" -gt 0 ]; then
  saved_mb=$(( (TOTAL_IN - TOTAL_OUT) / 1024 / 1024 ))
  saved_pct=$(( 100 - TOTAL_OUT * 100 / TOTAL_IN ))
  echo "" | tee -a "$LOG"
  echo "[$(date '+%H:%M:%S')] DONE  processed=$PROCESSED  skipped=$SKIPPED  failed=$FAILED  saved=${saved_mb}MB (-${saved_pct}%)" | tee -a "$LOG"
else
  echo "" | tee -a "$LOG"
  echo "[$(date '+%H:%M:%S')] DONE  processed=$PROCESSED  skipped=$SKIPPED  failed=$FAILED" | tee -a "$LOG"
fi
