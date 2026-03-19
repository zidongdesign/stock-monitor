#!/usr/bin/env python3
"""
期货夜盘盘前分析推送
用途：每个交易日 20:30 推送夜盘盘前分析到飞书群
调度：cron 30 20 * * 1-5
路径：~/chenpitang/project/stock-monitor-web/scripts/futures_premarket.py
"""

import json
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

import requests

# ============================================================
# 配置
# ============================================================

GATEWAY_URL = "http://127.0.0.1:18789/tools/invoke"
FEISHU_CHAT_ID = "oc_e9281d7a230c0b8ece51dde29206fdc4"
SESSION_KEY = f"agent:chenpitang:feishu:group:{FEISHU_CHAT_ID}"

# 从 openclaw.json 读 token
def get_gateway_token():
    p = Path.home() / ".openclaw" / "openclaw.json"
    with open(p) as f:
        cfg = json.load(f)
    return cfg["gateway"]["auth"]["token"]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# 交易所 market 映射
EXCHANGE_MAP = {
    # 郑商所
    "MA": 115, "SA": 115, "TA": 115, "FG": 115,
    # 大商所
    "I": 114, "J": 114, "M": 114, "P": 114,
    # 上期所
    "RB": 113, "CU": 113, "AL": 113, "AU": 113, "AG": 113,
    # 上海能源
    "SC": 142,
}

# 监控品种分组
FUTURES_GROUPS = {
    "能化": [
        ("MA", "甲醇"), ("SA", "纯碱"), ("TA", "PTA"), ("FG", "玻璃"),
    ],
    "黑色": [
        ("RB", "螺纹"), ("I", "铁矿"), ("J", "焦炭"),
    ],
    "有色": [
        ("CU", "铜"), ("AL", "铝"),
    ],
    "贵金属": [
        ("AU", "黄金"), ("AG", "白银"),
    ],
    "能源": [
        ("SC", "原油"),
    ],
    "农产品": [
        ("M", "豆粕"), ("P", "棕榈油"),
    ],
}

ALL_FUTURES = []
for group_items in FUTURES_GROUPS.values():
    ALL_FUTURES.extend(group_items)

# 外盘品种
# 腾讯财经接口代码
QQ_SYMBOLS = {
    "道琼斯": "usDJI",
    "纳斯达克": "usNDX",
    "标普500": "usINX",
    "WTI原油": "fuCL",
    "COMEX黄金": "fuGC",
}
# 东财接口代码（腾讯没有的用东财历史K线补）
EASTMONEY_SYMBOLS = {
    "美元指数": "100.UDI",
}


# ============================================================
# 数据获取
# ============================================================

def fetch_futures_klines(prefix, days=60):
    """东财 push2his 接口获取期货主连日K线"""
    market = EXCHANGE_MAP.get(prefix)
    if not market:
        return None
    secid = f"{market}.{prefix}M"
    end = datetime.now().strftime("%Y%m%d")
    url = (
        f"https://push2his.eastmoney.com/api/qt/stock/kline/get"
        f"?secid={secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
        f"&klt=101&fqt=1&end={end}&lmt={days}"
    )
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        data = r.json()
        klines = data.get("data", {}).get("klines", [])
        if not klines:
            return None
        # 每行: 日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率
        rows = []
        for line in klines:
            parts = line.split(",")
            rows.append({
                "date": parts[0],
                "open": float(parts[1]),
                "close": float(parts[2]),
                "high": float(parts[3]),
                "low": float(parts[4]),
                "volume": float(parts[5]),
                "amount": float(parts[6]),
                "pct_chg": float(parts[8]) if parts[8] != "" else 0,
            })
        return rows
    except Exception as e:
        print(f"  ⚠️ 获取 {prefix} K线失败: {e}")
        return None


def fetch_global_quotes():
    """获取外盘行情（腾讯+东财混合）"""
    results = {}

    # 1. 腾讯财经
    codes = ",".join(QQ_SYMBOLS.values())
    url = f"http://qt.gtimg.cn/q={codes}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.encoding = "gbk"
        text = r.text.strip()
        name_map = {v: k for k, v in QQ_SYMBOLS.items()}
        for line in text.split("\n"):
            line = line.strip().rstrip(";")
            if not line or "=" not in line:
                continue
            var_part, val_part = line.split("=", 1)
            code = var_part.split("_")[-1]
            val_part = val_part.strip('"')
            fields = val_part.split("~")
            if len(fields) < 10:
                continue
            name = name_map.get(code, fields[1])
            try:
                price = float(fields[3]) if fields[3] else 0
                pct = float(fields[32]) if len(fields) > 32 and fields[32] else 0
            except (ValueError, IndexError):
                price, pct = 0, 0
            results[name] = {"price": price, "pct": pct}
    except Exception as e:
        print(f"  ⚠️ 腾讯外盘获取失败: {e}")

    # 2. 东财补充
    for name, secid in EASTMONEY_SYMBOLS.items():
        try:
            end = datetime.now().strftime("%Y%m%d")
            url = (
                f"https://push2his.eastmoney.com/api/qt/stock/kline/get"
                f"?secid={secid}&fields1=f1,f2,f3,f4,f5,f6"
                f"&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
                f"&klt=101&fqt=1&end={end}&lmt=2"
            )
            r = requests.get(url, headers=HEADERS, timeout=15)
            data = r.json()
            klines = data.get("data", {}).get("klines", [])
            if klines:
                parts = klines[-1].split(",")
                price = float(parts[2])
                pct = float(parts[8]) if parts[8] else 0
                results[name] = {"price": price, "pct": pct}
        except Exception as e:
            print(f"  ⚠️ 东财 {name} 获取失败: {e}")

    return results


def compute_ma(closes, n):
    """计算简单移动平均"""
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n


def compute_ema(values, n):
    """计算指数移动平均"""
    if len(values) < n:
        return [None] * len(values)
    ema = [None] * (n - 1)
    ema.append(sum(values[:n]) / n)
    k = 2 / (n + 1)
    for i in range(n, len(values)):
        ema.append(values[i] * k + ema[-1] * (1 - k))
    return ema


def compute_macd(closes):
    """计算 MACD (DIF, DEA, MACD柱)"""
    if len(closes) < 26:
        return None, None, None
    ema12 = compute_ema(closes, 12)
    ema26 = compute_ema(closes, 26)
    dif = []
    for i in range(len(closes)):
        if ema12[i] is not None and ema26[i] is not None:
            dif.append(ema12[i] - ema26[i])
        else:
            dif.append(None)
    dif_valid = [x for x in dif if x is not None]
    if len(dif_valid) < 9:
        return None, None, None
    dea = compute_ema(dif_valid, 9)
    last_dif = dif_valid[-1]
    last_dea = dea[-1] if dea else None
    if last_dif is not None and last_dea is not None:
        macd_bar = (last_dif - last_dea) * 2
        return last_dif, last_dea, macd_bar
    return None, None, None


def analyze_single(prefix, name, klines):
    """分析单个品种"""
    if not klines or len(klines) < 5:
        return None

    last = klines[-1]
    closes = [k["close"] for k in klines]
    highs = [k["high"] for k in klines]
    lows = [k["low"] for k in klines]

    price = last["close"]
    pct = last["pct_chg"]

    ma5 = compute_ma(closes, 5)
    ma10 = compute_ma(closes, 10)
    ma20 = compute_ma(closes, 20)

    dif, dea, macd_bar = compute_macd(closes)

    # 支撑阻力（近20日）
    recent_lows = lows[-20:] if len(lows) >= 20 else lows
    recent_highs = highs[-20:] if len(highs) >= 20 else highs
    support = min(recent_lows)
    resistance = max(recent_highs)

    # MACD方向
    macd_dir = "—"
    if macd_bar is not None:
        if macd_bar > 0:
            macd_dir = "多"
        elif macd_bar < 0:
            macd_dir = "空"

    # 均线排列
    trend = "震荡"
    if ma5 and ma10 and ma20:
        if price > ma5 > ma10 > ma20:
            trend = "多头排列"
        elif price < ma5 < ma10 < ma20:
            trend = "空头排列"

    # 判断关注等级
    highlight = False
    reason = []
    if ma5 and ma10 and ma20:
        # 多头排列且MACD向多 → 机会
        if trend == "多头排列" and macd_dir == "多":
            highlight = True
            reason.append("趋势强势")
        # 空头排列且MACD向空 → 风险
        elif trend == "空头排列" and macd_dir == "空":
            highlight = True
            reason.append("趋势走弱")
        # 均线粘合 → 变盘
        spread = abs(ma5 - ma20) / price * 100
        if spread < 1.0:
            highlight = True
            reason.append("均线粘合待变盘")

    # 大涨大跌关注
    if abs(pct) > 2.0:
        highlight = True
        reason.append(f"日内{'大涨' if pct > 0 else '大跌'}{pct:+.2f}%")

    return {
        "prefix": prefix,
        "name": name,
        "price": price,
        "pct": pct,
        "ma5": ma5,
        "ma10": ma10,
        "ma20": ma20,
        "macd_dir": macd_dir,
        "support": support,
        "resistance": resistance,
        "trend": trend,
        "highlight": highlight,
        "reason": reason,
    }


# ============================================================
# 消息生成
# ============================================================

def pct_icon(pct):
    if pct > 0:
        return "🔴"
    elif pct < 0:
        return "🟢"
    return "⚪"


def format_pct(pct):
    return f"{pct_icon(pct)} {pct:+.2f}%"


def build_message(global_quotes, analyses):
    """构建飞书 markdown 消息"""
    now = datetime.now()
    lines = []
    lines.append(f"**📊 期货夜盘盘前分析 {now.strftime('%m/%d %H:%M')}**\n")

    # 1. 外盘速览
    lines.append("**🌍 外盘速览**")
    for name in ["道琼斯", "标普500", "纳斯达克"]:
        q = global_quotes.get(name)
        if q:
            lines.append(f"  {name}: {q['price']:.1f} {format_pct(q['pct'])}")
    for name in ["美元指数"]:
        q = global_quotes.get(name)
        if q:
            lines.append(f"  {name}: {q['price']:.2f} {format_pct(q['pct'])}")
    for name in ["WTI原油", "COMEX黄金"]:
        q = global_quotes.get(name)
        if q:
            lines.append(f"  {name}: {q['price']:.2f} {format_pct(q['pct'])}")
    lines.append("")

    # 2. 日盘收盘回顾 - 涨跌幅排名
    lines.append("**📈 日盘收盘回顾**")
    sorted_analyses = sorted(
        [a for a in analyses if a is not None],
        key=lambda x: x["pct"],
        reverse=True,
    )
    for a in sorted_analyses:
        icon = "🔥" if a["highlight"] else ""
        lines.append(f"  {pct_icon(a['pct'])} {a['name']}({a['prefix']}): {a['price']:.0f} {a['pct']:+.2f}% {icon}")
    lines.append("")

    # 3. 重点品种技术面简析
    focus_items = [a for a in sorted_analyses if a["highlight"]]
    if focus_items:
        lines.append("**🔍 重点品种技术面**")
        for a in focus_items:
            ma_str = ""
            if a["ma5"] and a["ma10"] and a["ma20"]:
                ma_str = f"MA5={a['ma5']:.0f} MA10={a['ma10']:.0f} MA20={a['ma20']:.0f}"
            lines.append(
                f"  🔥 **{a['name']}** {a['trend']} | MACD={a['macd_dir']}"
            )
            if ma_str:
                lines.append(f"    {ma_str}")
            lines.append(
                f"    支撑={a['support']:.0f} 阻力={a['resistance']:.0f}"
            )
            if a["reason"]:
                lines.append(f"    → {'，'.join(a['reason'])}")
        lines.append("")

    # 4. 今晚关注要点
    opportunities = [a for a in focus_items if a["trend"] == "多头排列" or (a["pct"] > 2.0)]
    risks = [a for a in focus_items if a["trend"] == "空头排列" or (a["pct"] < -2.0)]
    # 去重：同时在两边的按当日涨跌决定
    opp_set = set(a["prefix"] for a in opportunities)
    risk_set = set(a["prefix"] for a in risks)
    overlap = opp_set & risk_set
    if overlap:
        opportunities = [a for a in opportunities if a["prefix"] not in overlap or a["pct"] > 0]
        risks = [a for a in risks if a["prefix"] not in overlap or a["pct"] <= 0]

    lines.append("**🎯 今晚关注**")
    if opportunities:
        names = "、".join(f"{a['name']}" for a in opportunities[:5])
        lines.append(f"  🔴 偏多关注: {names}")
    if risks:
        names = "、".join(f"{a['name']}" for a in risks[:5])
        lines.append(f"  🟢 偏空/风险: {names}")
    if not opportunities and not risks:
        lines.append("  整体波动不大，观望为主")

    return "\n".join(lines)


# ============================================================
# 推送
# ============================================================

def send_to_feishu(message):
    token = get_gateway_token()
    payload = {
        "tool": "message",
        "args": {
            "action": "send",
            "channel": "feishu",
            "target": f"chat:{FEISHU_CHAT_ID}",
            "message": message,
        },
        "sessionKey": SESSION_KEY,
    }
    try:
        r = requests.post(
            GATEWAY_URL,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            timeout=30,
        )
        print(f"  飞书推送: {r.status_code} {r.text[:200]}")
        return r.status_code == 200
    except Exception as e:
        print(f"  ❌ 飞书推送失败: {e}")
        return False


# ============================================================
# 主流程
# ============================================================

def main():
    now = datetime.now()
    print(f"🚀 期货夜盘盘前分析 {now.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)

    # 1. 外盘行情
    print("🌍 获取外盘行情...")
    global_quotes = fetch_global_quotes()
    for name, q in global_quotes.items():
        print(f"  {name}: {q['price']} {q['pct']:+.2f}%")

    # 2. 国内期货K线
    print("\n📊 获取国内期货K线...")
    analyses = []
    for prefix, name in ALL_FUTURES:
        print(f"  {prefix} {name}...", end=" ")
        klines = fetch_futures_klines(prefix, days=60)
        if klines:
            result = analyze_single(prefix, name, klines)
            analyses.append(result)
            if result:
                print(f"{result['price']:.0f} {result['pct']:+.2f}% {'🔥' if result['highlight'] else ''}")
            else:
                print("分析失败")
        else:
            print("K线获取失败")
            analyses.append(None)

    # 3. 构建消息
    print("\n📝 构建消息...")
    message = build_message(global_quotes, analyses)
    print(message)

    # 4. 推送
    print("\n📤 推送飞书...")
    ok = send_to_feishu(message)
    if ok:
        print("✅ 推送成功")
    else:
        print("❌ 推送失败")

    # 打印 crontab 行
    script_path = Path(__file__).resolve()
    cron_path = script_path.parent / "futures_premarket_cron.sh"
    print(f"\n📌 crontab 行：")
    print(f"30 20 * * 1-5 {cron_path}")


if __name__ == "__main__":
    main()
