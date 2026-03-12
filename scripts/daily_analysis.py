#!/usr/bin/env python3
"""
每日自选股分析脚本
用途：收盘后拉取财务/技术/资金数据，生成 watchlist.json + analysis.json
调度：每日 15:35 (cron: 35 15 * * 1-5)
路径：~/chenpitang/project/stock-monitor-web/scripts/daily_analysis.py
输出：~/chenpitang/project/stock-monitor-web/data/watchlist.json
      ~/chenpitang/project/stock-monitor-web/data/analysis.json
"""

import json
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path

import akshare as ak
import numpy as np
import pandas as pd

# ============================================================
# 配置
# ============================================================

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# 33 只自选股（来自 store.js _defaultStocks）
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

# 股票名称映射（静态，减少 API 调用）
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
    """把 '15.2%' / '-3.5%' / False / NaN 转成 float"""
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
    """把 '8862.82万' / '1.97亿' 转成 float（单位：万元）"""
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

    # 只取年报数据（12-31），最近 4 年
    annual = df[df["报告期"].astype(str).str.endswith("12-31")].copy()
    annual = annual.sort_values("报告期").tail(4)

    if annual.empty:
        return result

    # ROE（最新年报）
    latest = annual.iloc[-1]
    roe = parse_pct(latest.get("净资产收益率"))
    result["roe"] = roe

    # ROE 趋势（近 3 年）
    roe_list = [parse_pct(r.get("净资产收益率")) for _, r in annual.iterrows()]
    roe_list = [x for x in roe_list if x is not None]
    if len(roe_list) >= 2:
        if roe_list[-1] > roe_list[0]:
            result["roeTrend"] = "up"
        elif roe_list[-1] < roe_list[0]:
            result["roeTrend"] = "down"
        else:
            result["roeTrend"] = "flat"

    # 净利润增速（近 3 年年报）
    growth_list = []
    for _, r in annual.tail(3).iterrows():
        g = parse_pct(r.get("净利润同比增长率"))
        if g is not None:
            growth_list.append(round(g, 2))
    result["netProfitGrowth3y"] = growth_list

    # 经营现金流（最新年报）
    cf = latest.get("每股经营现金流")
    if cf is not None and cf is not False:
        try:
            cf_val = float(str(cf).replace(",", ""))
            result["cashFlowPositive"] = cf_val > 0
        except (ValueError, TypeError):
            pass

    # 评级
    roe_val = roe if roe is not None else 0
    all_growth_positive = all(g > 0 for g in growth_list) if growth_list else False
    any_decline = any(g < 0 for g in growth_list) if growth_list else True
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
    """计算 KDJ"""
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
    """日 K 线 + MA + KDJ"""
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

    # MA
    for n in [5, 10, 20, 60]:
        df[f"MA{n}"] = df["收盘"].rolling(window=n, min_periods=1).mean()

    last = df.iloc[-1]
    price = float(last["收盘"])
    ma5 = float(last["MA5"])
    ma10 = float(last["MA10"])
    ma20 = float(last["MA20"])
    ma60 = float(last["MA60"]) if len(df) >= 60 else None

    result["aboveMa20"] = price > ma20

    # 趋势判断
    if price > ma5 > ma10 > ma20:
        result["trend"] = "up"
    elif price < ma5 < ma10 < ma20:
        result["trend"] = "down"
    else:
        result["trend"] = "sideways"

    # KDJ
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

    # 支撑位/阻力位（近 20 日最低/最高）
    recent = df.tail(20)
    result["support"] = round(float(recent["最低"].min()), 2)
    result["resistance"] = round(float(recent["最高"].max()), 2)

    return result


# ============================================================
# 3. 资金流向分析
# ============================================================

def analyze_fund_flow(symbol: str) -> dict:
    """拉取个股资金流向（东方财富）"""
    pure = code_to_pure(symbol)
    market = code_to_market(symbol)  # "sz" or "sh"
    result = {
        "mainNet5d": 0, "mainDaysIn": 0, "trend": "unknown",
    }

    try:
        df = ak.stock_individual_fund_flow(stock=pure, market=market)
    except Exception as e:
        print(f"  [资金] {symbol} 拉取失败: {e}")
        return result

    if df is None or df.empty:
        return result

    # 取最近 10 天
    df = df.tail(10).copy()

    # 列名可能包含 "主力净流入-净额" 或类似
    main_col = None
    for col in df.columns:
        if "主力" in str(col) and "净" in str(col) and "额" in str(col):
            main_col = col
            break

    if main_col is None:
        # fallback: try column index
        print(f"  [资金] {symbol} 未找到主力净流入列，columns={df.columns.tolist()}")
        return result

    recent5 = df.tail(5)
    try:
        values = pd.to_numeric(recent5[main_col], errors="coerce").fillna(0)
        total = float(values.sum())
        days_in = int((values > 0).sum())
        result["mainNet5d"] = round(total / 10000, 2)  # 转万元
        result["mainDaysIn"] = days_in

        if days_in >= 4:
            result["trend"] = "in"
        elif days_in >= 2:
            result["trend"] = "mixed"
        else:
            result["trend"] = "out"
    except Exception as e:
        print(f"  [资金] {symbol} 数据解析失败: {e}")

    return result


# ============================================================
# 4. 综合评分
# ============================================================

def compute_score(fin: dict, tech: dict, fund: dict) -> int:
    """综合评分 0-100"""
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

    # ROE 加分
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

    # KDJ 加分
    kdj = tech.get("kdjSignal", "unknown")
    if kdj == "golden_cross":
        tech_score = min(30, tech_score + 5)
    elif kdj == "bullish":
        tech_score = min(30, tech_score + 3)
    elif kdj == "death_cross":
        tech_score = max(0, tech_score - 3)

    # 均线加分
    if tech.get("aboveMa20"):
        tech_score = min(30, tech_score + 3)

    # 资金分 (0-30)
    fund_trend = fund.get("trend", "unknown")
    if fund_trend == "in":
        fund_score = 26
    elif fund_trend == "mixed":
        fund_score = 18
    elif fund_trend == "out":
        fund_score = 8
    else:
        fund_score = 15  # unknown 给中间值

    days_in = fund.get("mainDaysIn", 0)
    if days_in >= 4:
        fund_score = min(30, fund_score + 4)
    elif days_in >= 3:
        fund_score = min(30, fund_score + 2)

    return fin_score + tech_score + fund_score


def determine_action(score: int, grade: str, trend: str) -> str:
    """根据评分和信号决定 action"""
    if score < 30 or grade == "D":
        return "eliminate"
    elif score >= 70 and trend == "up":
        return "buy"
    elif score >= 50:
        return "hold"
    else:
        return "reduce"


def generate_tags(fin: dict, tech: dict, fund: dict) -> list[str]:
    """生成前端展示标签"""
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

    return tags


def generate_reason(fin: dict, tech: dict, fund: dict, action: str) -> str:
    """生成简短原因"""
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

    fund_trend = fund.get("trend", "unknown")
    if fund_trend == "in":
        parts.append("主力持续流入")
    elif fund_trend == "out":
        parts.append("主力流出")

    return "，".join(parts) if parts else "数据不足"


# ============================================================
# 主流程
# ============================================================

def main():
    now = datetime.now()
    updated = now.strftime("%Y-%m-%dT%H:%M:%S+08:00")
    version = now.strftime("%Y%m%d")

    all_codes = []
    code_to_group = {}
    for group, codes in STOCK_GROUPS.items():
        for c in codes:
            all_codes.append(c)
            code_to_group[c] = group

    total = len(all_codes)
    print(f"📊 开始分析 {total} 只自选股 ({updated})")
    print("=" * 60)

    stocks_data = {}
    eliminate_list = []

    for i, symbol in enumerate(all_codes, 1):
        name = STOCK_NAMES.get(symbol, symbol)
        print(f"\n[{i}/{total}] {symbol} {name}")

        try:
            # 1. 财务
            print(f"  📑 拉取财务数据...")
            fin = analyze_financial(symbol)
            print(f"     ROE={fin['roe']}  Grade={fin['grade']}  增速={fin['netProfitGrowth3y']}")
            time.sleep(0.5)

            # 2. 技术
            print(f"  📈 拉取K线数据...")
            tech = analyze_technical(symbol)
            print(f"     趋势={tech['trend']}  MA20上方={tech['aboveMa20']}  KDJ={tech['kdjSignal']}")
            time.sleep(0.5)

            # 3. 资金
            print(f"  💰 拉取资金流向...")
            fund = analyze_fund_flow(symbol)
            print(f"     5日净流入={fund['mainNet5d']}万  流入天数={fund['mainDaysIn']}  趋势={fund['trend']}")
            time.sleep(0.5)

            # 4. 评分
            score = compute_score(fin, tech, fund)
            action = determine_action(score, fin["grade"], tech["trend"])
            tags = generate_tags(fin, tech, fund)
            reason = generate_reason(fin, tech, fund, action)

            print(f"  ⭐ 评分={score}  建议={action}  标签={tags}")

            stocks_data[symbol] = {
                "name": name,
                "score": score,
                "financial": fin,
                "technical": tech,
                "fundFlow": fund,
                "action": action,
                "tags": tags,
                "reason": reason,
            }

            if action == "eliminate":
                eliminate_list.append({
                    "code": symbol,
                    "name": name,
                    "reason": reason,
                    "fromGroup": code_to_group.get(symbol, "unknown"),
                })

        except Exception as e:
            print(f"  ❌ {symbol} 分析失败: {e}")
            traceback.print_exc()
            stocks_data[symbol] = {
                "name": name,
                "score": 0,
                "financial": {"roe": None, "roeTrend": "unknown", "netProfitGrowth3y": [], "cashFlowPositive": None, "grade": "C"},
                "technical": {"trend": "unknown", "aboveMa20": None, "kdjSignal": "unknown", "support": None, "resistance": None},
                "fundFlow": {"mainNet5d": 0, "mainDaysIn": 0, "trend": "unknown"},
                "action": "hold",
                "tags": ["数据异常"],
                "reason": f"分析失败: {str(e)[:50]}",
            }

    # ============================================================
    # 生成 JSON
    # ============================================================

    print("\n" + "=" * 60)
    print("📝 生成 JSON 文件...")

    # watchlist.json
    watchlist = {
        "version": version,
        "updated": updated,
        "groups": {g: codes for g, codes in STOCK_GROUPS.items()},
    }
    watchlist_path = DATA_DIR / "watchlist.json"
    with open(watchlist_path, "w", encoding="utf-8") as f:
        json.dump(watchlist, f, ensure_ascii=False, indent=2)
    print(f"  ✅ {watchlist_path}")

    # analysis.json
    analysis = {
        "updated": updated,
        "stocks": stocks_data,
        "eliminate": eliminate_list,
        "recommend": [],  # 推荐功能待后续实现
    }
    analysis_path = DATA_DIR / "analysis.json"
    with open(analysis_path, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=2)
    print(f"  ✅ {analysis_path}")

    # 汇总
    print("\n" + "=" * 60)
    print("📊 分析汇总:")
    scores = [(s, d["score"], d["action"]) for s, d in stocks_data.items()]
    scores.sort(key=lambda x: -x[1])

    print(f"\n  🏆 TOP 5:")
    for s, sc, act in scores[:5]:
        print(f"     {s} {STOCK_NAMES.get(s, '')}: {sc}分 [{act}]")

    print(f"\n  ⚠️  淘汰候选 ({len(eliminate_list)}):")
    for e in eliminate_list:
        print(f"     {e['code']} {e['name']}: {e['reason']}")

    grade_counts = {"A": 0, "B": 0, "C": 0, "D": 0}
    for d in stocks_data.values():
        g = d["financial"].get("grade", "C")
        grade_counts[g] = grade_counts.get(g, 0) + 1
    print(f"\n  📑 财务评级分布: A={grade_counts['A']} B={grade_counts['B']} C={grade_counts['C']} D={grade_counts['D']}")

    print(f"\n✅ 完成！共分析 {total} 只股票")


if __name__ == "__main__":
    main()
