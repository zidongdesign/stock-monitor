#!/bin/bash
# 期货夜盘盘前分析 cron 包装
# cron: 30 20 * * 1-5
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$SCRIPT_DIR/futures_premarket_cron.log"

echo "===== $(date '+%Y-%m-%d %H:%M:%S') =====" >> "$LOG"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

python3 "$SCRIPT_DIR/futures_premarket.py" >> "$LOG" 2>&1

echo "Done." >> "$LOG"
