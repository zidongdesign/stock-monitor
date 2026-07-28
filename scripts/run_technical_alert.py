#!/usr/bin/env python3
"""
每日收盘技术形态预警
从自选股池中选出技术面最强5只和最弱5只
"""
import json
import sys
from pathlib import Path

# 添加当前目录到路径
sys.path.insert(0, str(Path(__file__).resolve().parent))
from technical_pattern import analyze_pool_technical
from limit_up_tracker import track_limit_up_stocks

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
WATCHLIST_PATH = DATA_DIR / "watchlist.json"


def main():
    # 加载股池
    with open(WATCHLIST_PATH) as f:
        wl = json.load(f)
    stocks = wl.get("stocks", [])
    
    if not stocks:
        print("⚠️ 股池为空")
        return
    
    stock_list = [{"code": s["code"], "name": s.get("name", s["code"])} for s in stocks]
    print(f"📊 开始技术形态分析，共 {len(stock_list)} 只...")
    
    result = analyze_pool_technical(stock_list)
    
    # 格式化输出
    print("\n===REPORT_START===")
    print("📈 **每日技术强弱榜**")
    print("")
    print("🟢 **最强5只（底部构建/多头形态）：**")
    for i, s in enumerate(result["top5"], 1):
        signals_str = "、".join(s["signals"][:3]) if s["signals"] else "趋势较好"
        print(f"{i}. {s['name']}({s['code']}) — {s['score']}分 | {signals_str}")
    
    print("")
    print("🔴 **最弱5只（头部构建/空头形态）：**")
    for i, s in enumerate(result["bottom5"], 1):
        signals_str = "、".join(s["signals"][:3]) if s["signals"] else "趋势较弱"
        print(f"{i}. {s['name']}({s['code']}) — {s['score']}分 | {signals_str}")
    
    print("")
    pool_avg = sum(s["score"] for s in result["all_scores"]) / len(result["all_scores"])
    print(f"📊 池内平均技术分：{pool_avg:.0f}/100")
    
    # 涨停股建仓跟踪
    limit_results = track_limit_up_stocks()
    if limit_results:
        print("")
        print("📌 **涨停股建仓跟踪：**")
        for r in limit_results:
            emoji = {"✅": "buy", "⏳": "wait", "❌": "abandon"}
            e = {"buy": "✅", "wait": "⏳", "abandon": "❌"}[r["signal"]]
            print(f"{e} {r['name']}({r['code']})：入池第{r['days_after']}天 | {r['reason']}")
    
    print("===REPORT_END===")


if __name__ == "__main__":
    main()
