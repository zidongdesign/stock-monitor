#!/bin/bash
# 自动部署自选股网页到 GitHub Pages
# 每日 stock-daily-pool cron 执行后调用

set -e

REPO_DIR="/Users/chenzidong/chenpitang/project/stock-monitor-web"
cd "$REPO_DIR"

# 检查是否有变更
if git diff --quiet && git diff --staged --quiet; then
    echo "无变更，跳过部署"
    exit 0
fi

# 提交并推送
TODAY=$(date +%Y-%m-%d)
STOCK_COUNT=$(python3 -c "import json; d=json.load(open('data/watchlist.json')); print(len(d.get('stocks',[])))" 2>/dev/null || echo "?")

git add -A
git commit -m "daily: ${TODAY} sync ${STOCK_COUNT} stocks"
git push origin main

echo "✅ 已部署 ${STOCK_COUNT} 只股到 GitHub Pages"
