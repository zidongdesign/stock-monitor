#!/bin/bash
# 每日收盘自动分析 + push
# cron: 35 15 * * 1-5
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG="$SCRIPT_DIR/daily_cron.log"

echo "===== $(date '+%Y-%m-%d %H:%M:%S') =====" >> "$LOG"

# 激活 Python 环境（如有 venv）
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

cd "$PROJECT_DIR"

# 1. 每日分析（评分 + 补入淘汰）
echo "[1/3] Running daily_analysis.py..." >> "$LOG"
python3 scripts/daily_analysis.py >> "$LOG" 2>&1

# 2. 热门板块扫描（延迟5分钟让接口缓冲）
echo "[2/3] Running sector_scan.py..." >> "$LOG"
python3 scripts/sector_scan.py >> "$LOG" 2>&1

# 3. Git commit + push
echo "[3/3] Git push..." >> "$LOG"
cd "$PROJECT_DIR"
git add data/
INDEX_HTML_CHANGED=$(git diff --cached --name-only | grep index.html || true)
git add -A
git commit -m "daily: $(date '+%Y-%m-%d') 收盘分析更新" >> "$LOG" 2>&1 || echo "Nothing to commit" >> "$LOG"
git push >> "$LOG" 2>&1 || echo "Push failed" >> "$LOG"

echo "Done." >> "$LOG"
