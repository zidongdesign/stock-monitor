#!/usr/bin/env python3
"""
每日自选股分析脚本（含自动补入/淘汰）
用途：收盘后拉取财务/技术/资金数据，自动淘汰低分股 + 补入新股
调度：每日 15:35 (cron: 35 15 * * 1-5)
路径：~/chenpitang/project/stock-monitor-web/scripts/daily_analysis.py
输出：data/watchlist.json, data/analysis.json, data/history.json
"""

import json
import re
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path

import requests

import akshare as ak
import numpy as np
import pandas as pd

# ============================================================
# 配置
# ============================================================

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
STORE_JS = Path(__file__).resolve().parent.parent / "js" / "store.js"

# 原始 33 只自选股（供 init_pool.py 使用）
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

POOL_MAX = 50          # 池子上限
ELIMINATE_COUNT = 5    # 每次淘汰数量
ADD_COUNT = 5          # 每次补入数量
MATURE_DAYS = 10       # 池子运行天数 >= 此值才触发淘汰

# 静态股票名称映射（可被 watchlist.json 覆盖）
STOCK_NAMES = {
    "sz301265": "华新环保", "sz300323": "华灿光电", "sz002927": "泰永长征",
    "sh688759": "必贝特", "sz002063": "远光软件", "sz300491": "通合科技",
    "sh603826": "坤彩科技", "sz002157": "正邦科技", "sz000510": "新金路",
    "sz002877": "智能自控", "sh601669": "中国电建", "sz301032": "新柴股份",
    "sh603158": "腾龙股份", "sz000570": "苏常柴A", "sz002227": "奥特迅",
    "sh603716": "塞力医疗", "sz300143": "盈康生命", "sz002480": "新筑股份",
    "sz002982": "湘佳股份", "sz300365": "恒华科技", "sz300016": "北陆药业",
    "sz002149": "西部材料", "sz300696": "爱乐达", "sh603977": "国泰集团",
    "sz300928": "华安鑫创", "sz002875": "安奈儿", "sh600397": "江钨装备",
    "sh600288": "大恒科技", "sz002921": "联诚精密", "sh600862": "中航高科",
    "sz300129": "泰胜风能", "sh600927": "永安期货", "sh600372": "中航机载",
}


def code_to_pure(code: str) -> str:
    """sz301265 -> 301265"""
    return code[2:]


def code_to_market(code: str) -> str:
    """sz301265 -> sz"""
    return code[:2]


# ============================================================
# 1. 财务分析
# ============================================================

def parse_pct(val) -> float | None:
    if val is False or val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    s = str(val).strip().replace("%", "").replace(",", "")
    if s in ("", "False", "nan", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_money(val) -> float | None:
    if val is False or val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    s = str(val).strip().replace(",", "")
    if s in ("", "False", "nan", "-"):
        return None
    try:
        if "亿" in s:
            return float(s.replace("亿", "")) * 10000
        elif "万" in s:
            return float(s.replace("万", ""))
        else:
            return float(s)
    except ValueError:
        return None


def analyze_financial(symbol: str) -> dict:
    """拉取同花顺财务摘要，分析 ROE/净利润增速/现金流"""
    pure = code_to_pure(symbol)
    result = {
        "roe": None, "roeTrend": "unknown",
        "netProfitGrowth3y": [], "cashFlowPositive": None,
        "grade": "C",
    }

    try:
        df = ak.stock_financial_abstract_ths(symbol=pure, indicator="按报告期")
    except Exception as e:
        print(f"  [财务] {symbol} 拉取失败: {e}")
        result["grade"] = "C"
        return result

    if df is None or df.empty:
        return result

    annual = df[df["报告期"].astype(str).str.endswith("12-31")].copy()
    annual = annual.sort_values("报告期").tail(4)

    if annual.empty:
        return result

    latest = annual.iloc[-1]
    roe = parse_pct(latest.get("净资产收益率"))
    result["roe"] = roe

    roe_list = [parse_pct(r.get("净资产收益率")) for _, r in annual.iterrows()]
    roe_list = [x for x in roe_list if x is not None]
    if len(roe_list) >= 2:
        if roe_list[-1] > roe_list[0]:
            result["roeTrend"] = "up"
        elif roe_list[-1] < roe_list[0]:
            result["roeTrend"] = "down"
        else:
            result["roeTrend"] = "flat"

    growth_list = []
    for _, r in annual.tail(3).iterrows():
        g = parse_pct(r.get("净利润同比增长率"))
        if g is not None:
            growth_list.append(round(g, 2))
    result["netProfitGrowth3y"] = growth_list

    cf = latest.get("每股经营现金流")
    if cf is not None and cf is not False:
        try:
            cf_val = float(str(cf).replace(",", ""))
            result["cashFlowPositive"] = cf_val > 0
        except (ValueError, TypeError):
            pass

    roe_val = roe if roe is not None else 0
    all_growth_positive = all(g > 0 for g in growth_list) if growth_list else False
    consecutive_decline = (
        len(growth_list) >= 2 and all(g < 0 for g in growth_list[-2:])
    )
    cf_positive = result["cashFlowPositive"] is True

    if roe_val > 15 and all_growth_positive and cf_positive:
        result["grade"] = "A"
    elif roe_val > 10 and not consecutive_decline:
        result["grade"] = "B"
    elif roe_val > 5 or (roe_val > 0 and not consecutive_decline):
        result["grade"] = "C"
    else:
        result["grade"] = "D"

    return result


# ============================================================
# 2. 技术面分析
# ============================================================

def compute_kdj(df: pd.DataFrame, n: int = 9, m1: int = 3, m2: int = 3) -> pd.DataFrame:
    low_min = df["最低"].rolling(window=n, min_periods=1).min()
    high_max = df["最高"].rolling(window=n, min_periods=1).max()
    rsv = (df["收盘"] - low_min) / (high_max - low_min + 1e-10) * 100

    k = pd.Series(50.0, index=df.index, dtype=float)
    d = pd.Series(50.0, index=df.index, dtype=float)
    for i in range(1, len(df)):
        k.iloc[i] = (2 / m1) * rsv.iloc[i] + (1 - 2 / m1) * k.iloc[i - 1]
        d.iloc[i] = (2 / m2) * k.iloc[i] + (1 - 2 / m2) * d.iloc[i - 1]
    j = 3 * k - 2 * d

    df = df.copy()
    df["K"] = k
    df["D"] = d
    df["J"] = j
    return df


def analyze_technical(symbol: str) -> dict:
    pure = code_to_pure(symbol)
    result = {
        "trend": "unknown", "aboveMa20": None,
        "kdjSignal": "unknown", "support": None, "resistance": None,
    }

    end_date = datetime.now().strftime("%Y%m%d")
    start_date = (datetime.now() - timedelta(days=200)).strftime("%Y%m%d")

    try:
        df = ak.stock_zh_a_hist(
            symbol=pure, period="daily",
            start_date=start_date, end_date=end_date, adjust="qfq"
        )
    except Exception as e:
        print(f"  [技术] {symbol} K线拉取失败: {e}")
        return result

    if df is None or len(df) < 20:
        return result

    df = df.sort_values("日期").reset_index(drop=True)

    for n in [5, 10, 20, 60]:
        df[f"MA{n}"] = df["收盘"].rolling(window=n, min_periods=1).mean()

    last = df.iloc[-1]
    price = float(last["收盘"])
    ma5 = float(last["MA5"])
    ma10 = float(last["MA10"])
    ma20 = float(last["MA20"])

    result["aboveMa20"] = price > ma20

    if price > ma5 > ma10 > ma20:
        result["trend"] = "up"
    elif price < ma5 < ma10 < ma20:
        result["trend"] = "down"
    else:
        result["trend"] = "sideways"

    df = compute_kdj(df)
    if len(df) >= 2:
        k_now, d_now = float(df["K"].iloc[-1]), float(df["D"].iloc[-1])
        k_prev, d_prev = float(df["K"].iloc[-2]), float(df["D"].iloc[-2])
        if k_prev <= d_prev and k_now > d_now:
            result["kdjSignal"] = "golden_cross"
        elif k_prev >= d_prev and k_now < d_now:
            result["kdjSignal"] = "death_cross"
        elif k_now > d_now:
            result["kdjSignal"] = "bullish"
        else:
            result["kdjSignal"] = "bearish"

    recent = df.tail(20)
    result["support"] = round(float(recent["最低"].min()), 2)
    result["resistance"] = round(float(recent["最高"].max()), 2)

    return result


def get_recent_5d_gain(symbol: str) -> float | None:
    """获取近 5 日累计涨幅（%）"""
    pure = code_to_pure(symbol)
    end_date = datetime.now().strftime("%Y%m%d")
    start_date = (datetime.now() - timedelta(days=15)).strftime("%Y%m%d")
    try:
        df = ak.stock_zh_a_hist(
            symbol=pure, period="daily",
            start_date=start_date, end_date=end_date, adjust="qfq"
        )
        if df is None or len(df) < 2:
            return None
        df = df.sort_values("日期").reset_index(drop=True)
        recent = df.tail(5)
        if len(recent) < 2:
            return None
        start_price = float(recent.iloc[0]["开盘"])
        end_price = float(recent.iloc[-1]["收盘"])
        if start_price <= 0:
            return None
        return round((end_price - start_price) / start_price * 100, 2)
    except Exception:
        return None


# ============================================================
# 3. 资金流向分析
# ============================================================

def fetch_fund_flow_sina() -> dict:
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
    results = {}

    for asc, label in [(0, "流入"), (1, "流出")]:
        url = (
            f'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php'
            f'/MoneyFlow.ssl_bkzj_ssggzj?page=1&num=500&sort=netamount&asc={asc}&bankuai=&shession=f'
        )
        try:
            r = requests.get(url, headers=headers, timeout=15)
            data = json.loads(r.text)
            for item in data:
                symbol = item.get('symbol', '')
                if symbol and symbol not in results:
                    results[symbol] = {
                        'mainNet5d': round(float(item.get('netamount', 0)) / 10000, 0),
                        'r0_net': round(float(item.get('r0_net', 0)) / 10000, 0),
                        'inAmount': round(float(item.get('inamount', 0)) / 10000, 0),
                        'outAmount': round(float(item.get('outamount', 0)) / 10000, 0),
                        'netRatio': float(item.get('ratioamount', 0)),
                    }
        except Exception as e:
            print(f'  ⚠️ 新浪资金排名({label})失败: {e}')

    return results


def analyze_fund_flow(symbol: str, sina_data: dict) -> dict:
    if symbol not in sina_data:
        return {"mainNet5d": 0, "r0Net": 0, "netRatio": 0, "trend": "neutral"}

    item = sina_data[symbol]
    net = item['mainNet5d']
    if net > 0:
        trend = "in"
    elif net < 0:
        trend = "out"
    else:
        trend = "neutral"

    return {
        "mainNet5d": net,
        "r0Net": item['r0_net'],
        "netRatio": item['netRatio'],
        "trend": trend,
    }


# ============================================================
# 4. 综合评分
# ============================================================

def compute_score(fin: dict, tech: dict, fund: dict) -> int:
    # 财务分 (0-40)
    grade = fin.get("grade", "C")
    if grade == "A":
        fin_score = 38
    elif grade == "B":
        fin_score = 28
    elif grade == "C":
        fin_score = 18
    else:
        fin_score = 8

    roe = fin.get("roe")
    if roe is not None:
        if roe > 20:
            fin_score = min(40, fin_score + 2)
        elif roe > 15:
            fin_score = min(40, fin_score + 1)

    # 技术分 (0-30)
    trend = tech.get("trend", "unknown")
    if trend == "up":
        tech_score = 22
    elif trend == "sideways":
        tech_score = 14
    elif trend == "down":
        tech_score = 5
    else:
        tech_score = 10

    kdj = tech.get("kdjSignal", "unknown")
    if kdj == "golden_cross":
        tech_score = min(30, tech_score + 5)
    elif kdj == "bullish":
        tech_score = min(30, tech_score + 3)
    elif kdj == "death_cross":
        tech_score = max(0, tech_score - 3)

    if tech.get("aboveMa20"):
        tech_score = min(30, tech_score + 3)

    # 资金分 (0-30)
    fund_trend = fund.get("trend", "neutral")
    net = fund.get("mainNet5d", 0)
    net_ratio = fund.get("netRatio", 0)

    if fund_trend == "neutral" and net == 0 and net_ratio == 0:
        fund_score = 10
    elif net > 0 and net_ratio > 0.1:
        fund_score = 25 + min(5, int(net_ratio * 10))
        fund_score = min(30, fund_score)
    elif net > 0:
        fund_score = 18 + min(6, int(net_ratio * 30))
        fund_score = min(24, fund_score)
    else:
        fund_score = max(0, 9 + min(0, int(net_ratio * 20)))

    return fin_score + tech_score + fund_score


def determine_action(score: int, grade: str, trend: str) -> str:
    if score < 30 or grade == "D":
        return "eliminate"
    elif score >= 70 and trend == "up":
        return "buy"
    elif score >= 50:
        return "hold"
    else:
        return "reduce"


def generate_tags(fin: dict, tech: dict, fund: dict) -> list[str]:
    tags = []
    roe = fin.get("roe")
    if roe is not None and roe > 15:
        tags.append("ROE健康")
    if fin.get("cashFlowPositive"):
        tags.append("现金流正")
    if fin.get("grade") == "D":
        tags.append("财务预警")

    growth = fin.get("netProfitGrowth3y", [])
    if growth and all(g > 0 for g in growth):
        tags.append("利润连增")
    elif growth and all(g < 0 for g in growth):
        tags.append("利润连降")

    if tech.get("trend") == "up":
        tags.append("均线多头")
    elif tech.get("trend") == "down":
        tags.append("均线空头")
    if tech.get("kdjSignal") == "golden_cross":
        tags.append("KDJ金叉")
    elif tech.get("kdjSignal") == "death_cross":
        tags.append("KDJ死叉")
    if tech.get("aboveMa20") is False:
        tags.append("破位MA20")

    if fund.get("trend") == "in":
        tags.append("主力流入")
    elif fund.get("trend") == "out":
        tags.append("主力流出")
    elif fund.get("trend") == "neutral" and fund.get("mainNet5d", 0) == 0:
        tags.append("资金平淡")

    return tags


def generate_reason(fin: dict, tech: dict, fund: dict, action: str) -> str:
    parts = []
    grade = fin.get("grade", "C")
    roe = fin.get("roe")

    if grade == "A":
        parts.append("财务优秀")
    elif grade == "B":
        parts.append("财务良好")
    elif grade == "D":
        parts.append("财务不佳")

    if roe is not None:
        parts.append(f"ROE={roe}%")

    trend = tech.get("trend", "unknown")
    if trend == "up":
        parts.append("上升趋势")
    elif trend == "down":
        parts.append("下降趋势")

    fund_trend = fund.get("trend", "neutral")
    if fund_trend == "in":
        parts.append("主力净流入")
    elif fund_trend == "out":
        parts.append("主力流出")
    elif fund_trend == "neutral" and fund.get("mainNet5d", 0) == 0:
        parts.append("资金不活跃")

    return "，".join(parts) if parts else "数据不足"


# ============================================================
# 5. 对单只股票评分（供外部调用）
# ============================================================

def score_single(symbol: str, name: str, sina_data: dict) -> dict:
    """评分单只股票，返回完整数据 dict"""
    try:
        fin = analyze_financial(symbol)
        time.sleep(0.5)
        tech = analyze_technical(symbol)
        time.sleep(0.5)
        fund = analyze_fund_flow(symbol, sina_data)

        score = compute_score(fin, tech, fund)
        action = determine_action(score, fin["grade"], tech["trend"])
        tags = generate_tags(fin, tech, fund)
        reason = generate_reason(fin, tech, fund, action)

        return {
            "name": name,
            "score": score,
            "financial": fin,
            "technical": tech,
            "fundFlow": fund,
            "action": action,
            "tags": tags,
            "reason": reason,
        }
    except Exception as e:
        print(f"  ❌ {symbol} 评分失败: {e}")
        traceback.print_exc()
        return {
            "name": name,
            "score": 0,
            "financial": {"roe": None, "roeTrend": "unknown", "netProfitGrowth3y": [], "cashFlowPositive": None, "grade": "C"},
            "technical": {"trend": "unknown", "aboveMa20": None, "kdjSignal": "unknown", "support": None, "resistance": None},
            "fundFlow": {"mainNet5d": 0, "r0Net": 0, "netRatio": 0, "trend": "neutral"},
            "action": "hold",
            "tags": ["数据异常"],
            "reason": f"分析失败: {str(e)[:50]}",
        }


# ============================================================
# 6. 补入候选：从板块扫描获取
# ============================================================

def get_candidates_from_sector_scan() -> list[dict]:
    """调用 sector_scan 逻辑获取推荐个股"""
    try:
        import sys, os
        sys.path.insert(0, os.path.dirname(__file__))
        from sector_scan import run_sector_scan
        result = run_sector_scan()
        return result.get("recommend", [])
    except Exception as e:
        print(f"  ⚠️ 板块扫描失败: {e}")
        traceback.print_exc()
        return []


def is_filtered_out(code: str, name: str) -> str | None:
    """检查是否被过滤，返回过滤原因或 None"""
    pure = code_to_pure(code)
    # 科创板
    if pure.startswith("688"):
        return "科创板"
    # 北交所
    if pure.startswith("8") and len(pure) == 6:
        return "北交所"
    # ST
    if "ST" in name.upper():
        return "ST股"
    return None


# ============================================================
# 7. 更新 store.js
# ============================================================

def update_store_js(stocks: list[dict], version: str):
    """更新 js/store.js 的 _defaultStocks 和 _STOCK_VERSION"""
    content = STORE_JS.read_text(encoding="utf-8")

    # 所有股票放 focus 组
    codes_str = ", ".join(f"'{s['code']}'" for s in stocks)
    names_comment = "、".join(s["name"] for s in stocks[:5])
    if len(stocks) > 5:
        names_comment += f" 等{len(stocks)}只"

    new_default = (
        f"_defaultStocks: {{\n"
        f"    focus: [\n"
        f"      {codes_str}\n"
        f"    // {names_comment}\n"
        f"    ]\n"
        f"  }}"
    )

    content = re.sub(
        r"_defaultStocks:\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}",
        new_default,
        content,
        flags=re.DOTALL,
    )

    content = re.sub(
        r"_STOCK_VERSION:\s*'[^']*'",
        f"_STOCK_VERSION: '{version}'",
        content,
    )

    STORE_JS.write_text(content, encoding="utf-8")
    print(f"  ✅ 更新 js/store.js: version={version}")


# ============================================================
# 主流程
# ============================================================

def load_watchlist() -> dict | None:
    path = DATA_DIR / "watchlist.json"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def load_history() -> dict:
    path = DATA_DIR / "history.json"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"removed": []}


def main():
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    updated = now.strftime("%Y-%m-%dT%H:%M:%S+08:00")

    # 加载当前自选池
    wl = load_watchlist()
    if wl is None or "stocks" not in wl:
        print("❌ watchlist.json 不存在或格式不对，请先运行 init_pool.py")
        return

    pool_stocks = wl["stocks"]
    start_date = wl.get("startDate", today)
    day_count = (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(start_date, "%Y-%m-%d")).days + 1

    pool_codes = set(s["code"] for s in pool_stocks)
    pool_size = len(pool_stocks)

    print(f"📊 当前池子: {pool_size} 只 | 起始日期: {start_date} | 第 {day_count} 天")
    print("=" * 60)

    # 一次性拉取资金数据
    print("💰 拉取新浪全市场资金流向...")
    sina_data = fetch_fund_flow_sina()
    print(f"  ✅ 获取 {len(sina_data)} 条资金数据")

    # ---- 对池内股票评分 ----
    print(f"\n📊 评分 {pool_size} 只自选股...")
    stocks_data = {}
    for i, stock in enumerate(pool_stocks, 1):
        symbol = stock["code"]
        name = stock.get("name", STOCK_NAMES.get(symbol, symbol))
        print(f"  [{i}/{pool_size}] {symbol} {name}")

        data = score_single(symbol, name, sina_data)
        stocks_data[symbol] = data
        # 更新 STOCK_NAMES 缓存
        STOCK_NAMES[symbol] = name

    # 按评分排序
    scored_pool = sorted(
        [(s["code"], stocks_data[s["code"]]["score"]) for s in pool_stocks],
        key=lambda x: x[1],
    )

    print(f"\n📊 评分完成。最低: {scored_pool[0][0]}={scored_pool[0][1]}分  最高: {scored_pool[-1][0]}={scored_pool[-1][1]}分")

    # ---- 自动淘汰 ----
    today_removed = []
    history = load_history()

    if day_count >= MATURE_DAYS:
        eliminate_count = min(ELIMINATE_COUNT, len(scored_pool))
        to_remove = scored_pool[:eliminate_count]

        print(f"\n🗑️ 淘汰 {eliminate_count} 只（池子已运行 {day_count} 天 >= {MATURE_DAYS}）:")
        for code, score in to_remove:
            name = STOCK_NAMES.get(code, code)
            print(f"  ❌ {code} {name}: {score}分")
            today_removed.append({
                "code": code,
                "name": name,
                "date": today,
                "score": score,
                "reason": "评分最低淘汰",
            })
            pool_codes.discard(code)

        # 更新 history.json
        history["removed"].extend(today_removed)
    else:
        print(f"\n⏳ 池子运行 {day_count} 天 < {MATURE_DAYS} 天，暂不淘汰")

    # 如果池子超上限，额外淘汰
    current_pool = [s for s in pool_stocks if s["code"] in pool_codes]
    while len(current_pool) > POOL_MAX:
        # 找分最低的
        worst = min(current_pool, key=lambda s: stocks_data[s["code"]]["score"])
        code = worst["code"]
        name = worst.get("name", code)
        score = stocks_data[code]["score"]
        print(f"  ❌ 超上限淘汰: {code} {name}: {score}分")
        today_removed.append({
            "code": code,
            "name": name,
            "date": today,
            "score": score,
            "reason": "超上限淘汰",
        })
        pool_codes.discard(code)
        current_pool = [s for s in current_pool if s["code"] != code]
        history["removed"].append(today_removed[-1])

    # ---- 自动补入 ----
    today_added = []
    spots_available = POOL_MAX - len(current_pool)
    add_target = min(ADD_COUNT, spots_available)

    if add_target > 0:
        print(f"\n🔍 扫描板块，寻找 {add_target} 只补入候选...")
        candidates = get_candidates_from_sector_scan()
        print(f"  板块扫描返回 {len(candidates)} 只候选")

        filtered_candidates = []
        for cand in candidates:
            code = cand["code"]
            name = cand.get("name", "")

            # 已在池中
            if code in pool_codes:
                continue

            # 基础过滤
            filter_reason = is_filtered_out(code, name)
            if filter_reason:
                print(f"  ⛔ {code} {name}: {filter_reason}")
                continue

            # 评分
            print(f"  📊 评分候选: {code} {name}")
            data = score_single(code, name, sina_data)
            stocks_data[code] = data

            # 财务 D 级过滤
            if data["financial"].get("grade") == "D":
                print(f"  ⛔ {code} {name}: 财务D级")
                continue

            # 近 5 日涨幅 > 30%
            gain_5d = get_recent_5d_gain(code)
            time.sleep(0.5)
            if gain_5d is not None and gain_5d > 30:
                print(f"  ⛔ {code} {name}: 近5日涨幅{gain_5d}%>30%")
                continue

            filtered_candidates.append({
                "code": code,
                "name": name,
                "score": data["score"],
                "sector": cand.get("sector", ""),
            })

        # 按评分排序取 TOP N
        filtered_candidates.sort(key=lambda x: -x["score"])
        to_add = filtered_candidates[:add_target]

        print(f"\n✅ 补入 {len(to_add)} 只:")
        for cand in to_add:
            print(f"  ➕ {cand['code']} {cand['name']}: {cand['score']}分 [{cand['sector']}]")
            current_pool.append({
                "code": cand["code"],
                "name": cand["name"],
                "group": "focus",
                "addedDate": today,
                "source": f"sector:{cand['sector']}",
            })
            pool_codes.add(cand["code"])
            STOCK_NAMES[cand["code"]] = cand["name"]
            today_added.append({
                "code": cand["code"],
                "name": cand["name"],
                "score": cand["score"],
                "sector": cand["sector"],
            })
    else:
        print(f"\n⚠️ 池子已满 ({len(current_pool)}/{POOL_MAX})，无法补入")

    # ---- 生成版本号 ----
    # 格式: YYYYMMDDx, x = a/b/c...
    base_ver = now.strftime("%Y%m%d")
    old_ver = wl.get("version", "")
    if old_ver.startswith(base_ver) and len(old_ver) > len(base_ver):
        suffix = old_ver[len(base_ver):]
        next_suffix = chr(ord(suffix[0]) + 1) if suffix else "b"
    else:
        next_suffix = "a"
    new_version = base_ver + next_suffix

    # ---- 写 watchlist.json ----
    new_watchlist = {
        "version": new_version,
        "startDate": start_date,
        "dayCount": day_count,
        "stocks": current_pool,
        "todayAdded": [a["code"] for a in today_added],
        "todayRemoved": [r["code"] for r in today_removed],
    }

    wl_path = DATA_DIR / "watchlist.json"
    with open(wl_path, "w", encoding="utf-8") as f:
        json.dump(new_watchlist, f, ensure_ascii=False, indent=2)
    print(f"\n✅ 写入 {wl_path} (v{new_version}, {len(current_pool)}只)")

    # ---- 写 analysis.json ----
    analysis = {
        "updated": updated,
        "stocks": stocks_data,
        "todayAdded": today_added,
        "todayRemoved": today_removed,
        "eliminate": [
            {"code": r["code"], "name": r["name"], "reason": r["reason"]}
            for r in today_removed
        ],
        "recommend": [],
    }

    analysis_path = DATA_DIR / "analysis.json"
    with open(analysis_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)
    print(f"✅ 写入 {analysis_path}")

    # ---- 写 history.json ----
    history_path = DATA_DIR / "history.json"
    with open(history_path, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    print(f"✅ 写入 {history_path}")

    # ---- 更新 store.js ----
    update_store_js(current_pool, new_version)

    # ---- 汇总 ----
    print(f"\n{'=' * 60}")
    print(f"📊 汇总:")
    print(f"  池子: {pool_size} → {len(current_pool)} 只")
    print(f"  淘汰: {len(today_removed)} 只")
    print(f"  补入: {len(today_added)} 只")
    print(f"  版本: {new_version}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
