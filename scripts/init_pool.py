#!/usr/bin/env python3
"""
初始化自选池：从现有 33 只清洗为 TOP 5
用法：python3 scripts/init_pool.py
"""

import json
import re
import time
import traceback
from datetime import datetime
from pathlib import Path

# 复用 daily_analysis 的评分逻辑
from daily_analysis import (
    STOCK_GROUPS,
    STOCK_NAMES,
    analyze_financial,
    analyze_technical,
    compute_score,
    fetch_fund_flow_sina,
    analyze_fund_flow,
    generate_tags,
    generate_reason,
    determine_action,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
STORE_JS = Path(__file__).resolve().parent.parent / "js" / "store.js"

TODAY = datetime.now().strftime("%Y-%m-%d")
VERSION = datetime.now().strftime("%Y%m%d") + "a"


def score_all_stocks() -> list[dict]:
    """对 33 只股票评分，返回排序后的列表"""
    all_codes = []
    for group, codes in STOCK_GROUPS.items():
        for c in codes:
            all_codes.append(c)

    total = len(all_codes)
    print(f"📊 开始评分 {total} 只股票...")

    # 一次性拉取资金数据
    print("💰 拉取新浪全市场资金流向...")
    sina_data = fetch_fund_flow_sina()
    print(f"  ✅ 获取 {len(sina_data)} 条资金数据")

    results = []
    for i, symbol in enumerate(all_codes, 1):
        name = STOCK_NAMES.get(symbol, symbol)
        print(f"\n[{i}/{total}] {symbol} {name}")

        try:
            fin = analyze_financial(symbol)
            print(f"  财务: ROE={fin['roe']} Grade={fin['grade']}")
            time.sleep(0.5)

            tech = analyze_technical(symbol)
            print(f"  技术: 趋势={tech['trend']} KDJ={tech['kdjSignal']}")
            time.sleep(0.5)

            fund = analyze_fund_flow(symbol, sina_data)
            print(f"  资金: 净流入={fund['mainNet5d']}万 趋势={fund['trend']}")

            score = compute_score(fin, tech, fund)
            action = determine_action(score, fin["grade"], tech["trend"])
            tags = generate_tags(fin, tech, fund)
            reason = generate_reason(fin, tech, fund, action)

            print(f"  ⭐ 评分={score}")

            results.append({
                "code": symbol,
                "name": name,
                "score": score,
                "financial": fin,
                "technical": tech,
                "fundFlow": fund,
                "action": action,
                "tags": tags,
                "reason": reason,
            })
        except Exception as e:
            print(f"  ❌ 失败: {e}")
            traceback.print_exc()
            results.append({
                "code": symbol,
                "name": name,
                "score": 0,
                "financial": {"roe": None, "roeTrend": "unknown", "netProfitGrowth3y": [], "cashFlowPositive": None, "grade": "C"},
                "technical": {"trend": "unknown", "aboveMa20": None, "kdjSignal": "unknown", "support": None, "resistance": None},
                "fundFlow": {"mainNet5d": 0, "r0Net": 0, "netRatio": 0, "trend": "neutral"},
                "action": "hold",
                "tags": ["数据异常"],
                "reason": f"分析失败: {str(e)[:50]}",
            })

    results.sort(key=lambda x: -x["score"])
    return results


def update_store_js(top5: list[dict], version: str):
    """更新 js/store.js 的 _defaultStocks 和 _STOCK_VERSION"""
    content = STORE_JS.read_text(encoding="utf-8")

    # 构建新的 focus 数组字符串
    codes_str = ", ".join(f"'{s['code']}'" for s in top5)
    # 名称注释
    names_str = "  // " + "、".join(s["name"] for s in top5)

    # 替换 _defaultStocks
    new_default = (
        f"_defaultStocks: {{\n"
        f"    focus: [\n"
        f"      {codes_str}\n"
        f"    {names_str}\n"
        f"    ]\n"
        f"  }}"
    )

    # 用正则替换 _defaultStocks: { ... }
    content = re.sub(
        r"_defaultStocks:\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}",
        new_default,
        content,
        flags=re.DOTALL,
    )

    # 替换 _STOCK_VERSION
    content = re.sub(
        r"_STOCK_VERSION:\s*'[^']*'",
        f"_STOCK_VERSION: '{version}'",
        content,
    )

    STORE_JS.write_text(content, encoding="utf-8")
    print(f"  ✅ 更新 js/store.js: version={version}, {len(top5)} 只股票")


def main():
    print("=" * 60)
    print(f"🔄 初始化自选池 {TODAY}")
    print("=" * 60)

    # 1. 评分所有 33 只
    scored = score_all_stocks()

    # 2. 取 TOP 5
    top5 = scored[:5]

    print("\n" + "=" * 60)
    print("🏆 TOP 5:")
    for i, s in enumerate(top5, 1):
        print(f"  {i}. {s['code']} {s['name']}: {s['score']}分")

    print("\n❌ 淘汰 (28只):")
    for s in scored[5:]:
        print(f"  {s['code']} {s['name']}: {s['score']}分")

    # 3. 写 watchlist.json
    watchlist = {
        "version": VERSION,
        "startDate": TODAY,
        "dayCount": 1,
        "stocks": [
            {
                "code": s["code"],
                "name": s["name"],
                "group": "focus",
                "addedDate": TODAY,
                "source": "initial",
            }
            for s in top5
        ],
        "todayAdded": [s["code"] for s in top5],
        "todayRemoved": [],
    }

    watchlist_path = DATA_DIR / "watchlist.json"
    with open(watchlist_path, "w", encoding="utf-8") as f:
        json.dump(watchlist, f, ensure_ascii=False, indent=2)
    print(f"\n✅ 写入 {watchlist_path}")

    # 4. 写 analysis.json
    stocks_data = {}
    for s in scored:
        stocks_data[s["code"]] = {
            "name": s["name"],
            "score": s["score"],
            "financial": s["financial"],
            "technical": s["technical"],
            "fundFlow": s["fundFlow"],
            "action": s["action"],
            "tags": s["tags"],
            "reason": s["reason"],
        }

    analysis = {
        "updated": datetime.now().strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "stocks": stocks_data,
        "todayAdded": [{"code": s["code"], "name": s["name"], "score": s["score"]} for s in top5],
        "todayRemoved": [],
        "eliminate": [],
        "recommend": [],
    }

    analysis_path = DATA_DIR / "analysis.json"
    with open(analysis_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)
    print(f"✅ 写入 {analysis_path}")

    # 5. 写 history.json（初始化，把淘汰的 28 只记录）
    history = {
        "removed": [
            {
                "code": s["code"],
                "name": s["name"],
                "date": TODAY,
                "score": s["score"],
                "reason": "初始清洗淘汰",
            }
            for s in scored[5:]
        ]
    }

    history_path = DATA_DIR / "history.json"
    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(f"✅ 写入 {history_path}")

    # 6. 更新 store.js
    update_store_js(top5, VERSION)

    print(f"\n{'=' * 60}")
    print(f"✅ 初始化完成！33 → {len(top5)} 只")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
