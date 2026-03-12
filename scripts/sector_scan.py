#!/usr/bin/env python3
"""
热门板块扫描脚本
用途：收盘后扫描当日 TOP10 热门板块，筛选优质个股，推荐补入自选池
调度：每日 15:40 (cron: 40 15 * * 1-5)
路径：~/chenpitang/project/stock-monitor-web/scripts/sector_scan.py
输出：~/chenpitang/project/stock-monitor-web/data/sectors.json
"""

import json
import time
import traceback
from datetime import datetime
from pathlib import Path

import requests

# ============================================================
# 配置
# ============================================================

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://finance.sina.com.cn/",
}

# 从 daily_analysis.py 导入自选股列表（独立运行时使用备用列表）
try:
    import sys, os
    sys.path.insert(0, os.path.dirname(__file__))
    from daily_analysis import STOCK_GROUPS, STOCK_NAMES
except (ImportError, Exception):
    STOCK_GROUPS = {
        "focus": [
            "sz301265", "sz300323", "sz002927", "sh688759", "sz002063",
            "sz300491", "sh603826", "sz002157", "sz000510", "sz002877",
            "sh601669",
        ],
        "watch": [
            "sz301032", "sh603158", "sz000570", "sz002227", "sh603716",
            "sz300143", "sz002480", "sz002982", "sz300365", "sz300016",
            "sz002149",
        ],
        "ambush": [
            "sz300696", "sh603977", "sz300928", "sz002875", "sh600397",
            "sh600288", "sz002921", "sh600862", "sz300129", "sh600927",
            "sh600372",
        ],
    }
    STOCK_NAMES = {}

ALL_WATCHLIST_CODES = set()
for _codes in STOCK_GROUPS.values():
    ALL_WATCHLIST_CODES.update(_codes)


# ============================================================
# 1. 拉取板块排名
# ============================================================

def fetch_sector_ranking(top_n: int = 10) -> list[dict]:
    """
    新浪资金流向接口，按资金净流入取 TOP N 板块。
    返回: [{ name, category, netamount, avg_changeratio, ts_symbol, ts_name }, ...]
    """
    url = (
        "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        "MoneyFlow.ssl_bkzj_bk?page=1&num=20&sort=netamount&asc=0&fenlei=1"
    )
    print("[板块排名] 拉取新浪板块资金排名...")
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    data = json.loads(resp.text)
    print(f"[板块排名] 获取到 {len(data)} 个板块")

    result = []
    for item in data[:top_n]:
        result.append({
            "name": item.get("name", "").strip(),
            "category": item.get("category", ""),
            "netamount": float(item.get("netamount", 0)),
            "avg_changeratio": float(item.get("avg_changeratio", 0)),
            "ts_symbol": item.get("ts_symbol", ""),
            "ts_name": item.get("ts_name", ""),
        })
    return result


# ============================================================
# 2. 拉取板块成分股（新浪报价列表接口）
# ============================================================

def fetch_sector_stocks(category: str, max_stocks: int = 50) -> list[dict]:
    """
    用新浪 Market_Center.getHQNodeDataSimple 拉取板块内个股报价。
    返回: [{ code, name, change, changepercent, volume, amount }, ...]
    """
    url = (
        f"https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"Market_Center.getHQNodeDataSimple"
        f"?page=1&num={max_stocks}&sort=changepercent&asc=0"
        f"&node={category}&symbol=&_s_r_a=page"
    )
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    data = json.loads(resp.text)

    stocks = []
    for item in data:
        symbol = item.get("symbol", "")  # 已是 sz300690 格式
        change_pct = float(item.get("changepercent", 0))
        stocks.append({
            "code": symbol,
            "name": item.get("name", "").strip(),
            "change": round(change_pct, 2),
            "price": float(item.get("trade", 0)),
            "volume": int(item.get("volume", 0)),
            "amount": float(item.get("amount", 0)),
        })
    return stocks


# ============================================================
# 3. 拉取个股资金流向（新浪资金排名）
# ============================================================

def fetch_stock_fund_flow_for_sector(category: str, max_stocks: int = 50) -> dict[str, float]:
    """
    拉取特定板块内个股的资金净流入数据。
    返回: { code: netamount, ... }
    """
    url = (
        f"https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        f"MoneyFlow.ssl_bkzj_zjlrqs?page=1&num={max_stocks}&sort=netamount&asc=0"
        f"&bankuai={category}&shession=0"
    )
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = json.loads(resp.text)
        # 这个接口返回的是聚合数据，不是个股数据
        # 所以我们使用全局资金排名来匹配
        return {}
    except Exception:
        return {}


# ============================================================
# 4. 拉取全局个股资金排名（作为资金过滤依据）
# ============================================================

def fetch_global_fund_flow(pages: int = 5) -> dict[str, float]:
    """
    拉取全市场个股资金排名 TOP 500，返回 { code: netamount } 映射。
    用于快速查询某只股票的资金净流入。
    """
    code_to_net = {}
    for page in range(1, pages + 1):
        url = (
            f"https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
            f"MoneyFlow.ssl_bkzj_zjlrqs?page={page}&num=100&sort=netamount&asc=0"
            f"&bankuai=&shession="
        )
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            data = json.loads(resp.text)
            for item in data:
                symbol = item.get("symbol", "")
                if not symbol:
                    continue
                # 统一为 sz/sh 格式
                if symbol.startswith(("0", "3")):
                    code = "sz" + symbol
                elif symbol.startswith("6"):
                    code = "sh" + symbol
                else:
                    code = symbol
                code_to_net[code] = float(item.get("netamount", 0))
            time.sleep(0.3)
        except Exception as e:
            print(f"  [资金排名] 第 {page} 页失败: {e}")
    print(f"[资金排名] 共获取 {len(code_to_net)} 只个股资金数据")
    return code_to_net


# ============================================================
# 5. 筛选热门个股
# ============================================================

def filter_hot_stocks(
    sector_stocks: list[dict],
    fund_flow_map: dict[str, float],
    max_stocks: int = 5,
) -> list[dict]:
    """
    从板块成分股中筛选：涨幅 > 0 且资金净流入 > 0，按资金排序取 top N。
    sector_stocks: [{ code, name, change, price, volume, amount }, ...]
    fund_flow_map: { code: netamount }
    """
    candidates = []
    for st in sector_stocks:
        code = st["code"]
        change = st["change"]
        net = fund_flow_map.get(code, None)

        # 筛选：跟涨 + 有资金数据 + 资金净流入
        if change <= 0:
            continue
        if net is None or net <= 0:
            # 资金数据不在 TOP500，但仍涨幅 > 3% 可保留
            if change < 3:
                continue
            net = 0  # 无资金数据

        # 生成推荐理由
        reasons = []
        if change >= 9.9:
            reasons.append("涨停")
        elif change >= 7:
            reasons.append("强势拉升")
        elif change >= 3:
            reasons.append("显著上涨")

        if net >= 1_0000_0000:
            reasons.append(f"净流入{net / 1_0000_0000:.1f}亿")
        elif net >= 1000_0000:
            reasons.append(f"净流入{net / 100:.0f}万")
        elif net > 0:
            reasons.append("资金净流入")

        candidates.append({
            "code": code,
            "name": st["name"],
            "change": change,
            "netAmount": net,
            "reason": "+".join(reasons) if reasons else "跟涨",
        })

    # 按资金净流入排序（无资金数据的按涨幅）
    candidates.sort(key=lambda x: (x["netAmount"], x["change"]), reverse=True)
    return candidates[:max_stocks]


# ============================================================
# 6. 生成推荐列表
# ============================================================

def generate_recommendations(
    sectors_result: list[dict],
    max_recommend: int = 10,
) -> list[dict]:
    """排除自选池个股，评分后取 TOP N 推荐。"""
    all_candidates = []
    for idx, sector in enumerate(sectors_result):
        for stock in sector.get("hotStocks", []):
            code = stock["code"]
            if code in ALL_WATCHLIST_CODES:
                continue

            net = stock["netAmount"]
            change = stock["change"]

            score = 50
            if net >= 5_0000_0000:
                score += 30
            elif net >= 1_0000_0000:
                score += 20
            elif net >= 5000_0000:
                score += 12
            elif net > 0:
                score += 5

            if 3 <= change < 7:
                score += 15
            elif 1 <= change < 3:
                score += 8
            elif 7 <= change < 9.9:
                score += 5
            elif change >= 9.9:
                score += 8  # 涨停也算

            # 板块排名加分
            score += max(0, 10 - idx * 2)
            score = min(score, 99)

            all_candidates.append({
                "code": code,
                "name": stock["name"],
                "sector": sector["name"],
                "score": score,
                "reason": f"[{sector['name']}]{stock['reason']}",
                "suggestGroup": "watch",
                "_net": net,
            })

    # 去重
    seen = set()
    unique = []
    for c in all_candidates:
        if c["code"] not in seen:
            seen.add(c["code"])
            unique.append(c)

    unique.sort(key=lambda x: (x["score"], x["_net"]), reverse=True)

    return [
        {k: v for k, v in c.items() if k != "_net"}
        for c in unique[:max_recommend]
    ]


# ============================================================
# 主流程
# ============================================================

def run_sector_scan() -> dict:
    """执行板块扫描，输出 data/sectors.json，返回结果 dict。"""
    print("=" * 60)
    print(f"[板块扫描] 开始 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 1. 拉取板块排名
    try:
        raw_sectors = fetch_sector_ranking(top_n=10)
    except Exception as e:
        print(f"[板块扫描] 拉取板块排名失败: {e}")
        traceback.print_exc()
        return {"updated": datetime.now().isoformat(), "sectors": [], "recommend": []}

    if not raw_sectors:
        print("[板块扫描] 无板块数据，退出")
        return {"updated": datetime.now().isoformat(), "sectors": [], "recommend": []}

    # 2. 拉取全局个股资金排名（用于过滤）
    print("\n[资金排名] 拉取全市场个股资金排名...")
    fund_flow_map = fetch_global_fund_flow(pages=5)

    # 3. 对每个板块拉取成分股并筛选
    sectors_result = []
    for sector in raw_sectors:
        name = sector["name"]
        category = sector["category"]
        print(f"\n--- 板块: {name} ({category}) 净流入: {sector['netamount'] / 1_0000_0000:.2f}亿 ---")

        try:
            sector_stocks = fetch_sector_stocks(category, max_stocks=50)
            print(f"  成分股: {len(sector_stocks)} 只")

            hot_stocks = filter_hot_stocks(sector_stocks, fund_flow_map, max_stocks=5)
            print(f"  热门个股: {len(hot_stocks)} 只")

            # 龙头信息
            ts = sector["ts_symbol"]
            if ts.startswith(("0", "3")):
                leader_code = "sz" + ts
            elif ts.startswith("6"):
                leader_code = "sh" + ts
            else:
                leader_code = ts

            # 找龙头在成分股里的涨幅
            leader_change = 0
            for st in sector_stocks:
                if st["code"] == leader_code:
                    leader_change = st["change"]
                    break

            sectors_result.append({
                "name": name,
                "netAmount": sector["netamount"],
                "avgChange": round(sector["avg_changeratio"] * 100, 2),
                "leader": {
                    "code": leader_code,
                    "name": sector["ts_name"],
                    "change": round(leader_change, 2),
                },
                "hotStocks": hot_stocks,
            })

        except Exception as e:
            print(f"  [错误] 板块 {name} 处理失败: {e}")
            traceback.print_exc()
            # 单个板块失败不影响其他
            sectors_result.append({
                "name": name,
                "netAmount": sector["netamount"],
                "avgChange": round(sector["avg_changeratio"] * 100, 2),
                "leader": {"code": "", "name": sector["ts_name"], "change": 0},
                "hotStocks": [],
            })

        time.sleep(0.4)

    # 4. 生成推荐
    recommendations = generate_recommendations(sectors_result)

    # 5. 写入文件
    result = {
        "updated": datetime.now().astimezone().isoformat(),
        "sectors": sectors_result,
        "recommend": recommendations,
    }

    output_path = DATA_DIR / "sectors.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n{'=' * 60}")
    print(f"[板块扫描] 完成！板块: {len(sectors_result)}  推荐: {len(recommendations)}")
    print(f"  输出: {output_path}")
    print(f"{'=' * 60}")

    return result


if __name__ == "__main__":
    run_sector_scan()
