#!/usr/bin/env python3
"""
涨停股建仓跟踪模块
对池内标记 limitUp=True 的股票，每日跟踪建仓时机判断
"""

import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

# --- 绕过 macOS 系统代理 ---
for _k in ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy']:
    os.environ.pop(_k, None)
os.environ['no_proxy'] = '*'
os.environ['NO_PROXY'] = '*'

import requests
_orig_session_init = requests.Session.__init__
def _patched_session_init(self, *a, **kw):
    _orig_session_init(self, *a, **kw)
    self.trust_env = False
requests.Session.__init__ = _patched_session_init
# --- 代理绕过结束 ---

import json as _json
import numpy as np
import pandas as pd


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
WATCHLIST_PATH = DATA_DIR / "watchlist.json"


def _fetch_kline(code: str, days: int = 30) -> pd.DataFrame | None:
    """腾讯财经接口拉日K"""
    c = code.strip().lower()
    if c.startswith(('sz', 'sh')):
        tc_symbol = c
    elif c.startswith('6') or c.startswith('9'):
        tc_symbol = f'sh{c}'
    else:
        tc_symbol = f'sz{c}'

    end_d = datetime.now().strftime('%Y-%m-%d')
    start_d = (datetime.now() - timedelta(days=days + 30)).strftime('%Y-%m-%d')
    url = (f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
           f"?_var=kline_dayqfq&param={tc_symbol},day,{start_d},{end_d},{days},qfq")
    try:
        resp = requests.get(url, timeout=15)
        text = resp.text
        json_start = text.find('{')
        if json_start < 0:
            return None
        data = _json.loads(text[json_start:])
        klines = data.get('data', {}).get(tc_symbol, {})
        rows = klines.get('qfqday') or klines.get('day')
        if not rows:
            return None
        records = []
        for row in rows:
            if len(row) < 6:
                continue
            records.append({
                '日期': row[0],
                '开盘': float(row[1]),
                '收盘': float(row[2]),
                '最高': float(row[3]),
                '最低': float(row[4]),
                '成交量': float(row[5]) if row[5] else 0,
            })
        if not records:
            return None
        df = pd.DataFrame(records)
        df['日期'] = pd.to_datetime(df['日期'])
        df = df.sort_values('日期').reset_index(drop=True)
        return df
    except Exception as e:
        print(f"[limit_up_tracker] 拉取 {code} 失败: {e}")
        return None


def _judge_position_signal(df: pd.DataFrame, limit_up_price: float, limit_up_date: str) -> dict:
    """
    判断涨停股的建仓信号
    返回: {"signal": "buy"|"wait"|"abandon", "reason": "..."}
    """
    if df is None or len(df) < 5:
        return {"signal": "wait", "reason": "数据不足"}

    # 涨停日之后的数据
    lu_date = pd.to_datetime(limit_up_date)
    after_lu = df[df['日期'] > lu_date]
    
    if len(after_lu) < 1:
        return {"signal": "wait", "reason": "涨停后第1天，观察中"}

    days_after = len(after_lu)
    latest = after_lu.iloc[-1]
    latest_close = latest['收盘']
    latest_vol = latest['成交量']
    
    # 涨停日的量
    lu_row = df[df['日期'] == lu_date]
    if len(lu_row) == 0:
        # 找最接近的日期
        lu_row = df[df['日期'] <= lu_date].tail(1)
    lu_vol = lu_row.iloc[0]['成交量'] if len(lu_row) > 0 else latest_vol

    # 涨停前的平台价（涨停前5日均价）
    before_lu = df[df['日期'] < lu_date]
    platform_price = before_lu.tail(5)['收盘'].mean() if len(before_lu) >= 5 else limit_up_price * 0.9

    # MA5
    ma5 = after_lu.tail(5)['收盘'].mean() if len(after_lu) >= 5 else latest_close
    
    # 最近3日平均量
    recent_vol = after_lu.tail(3)['成交量'].mean()
    vol_ratio = recent_vol / lu_vol if lu_vol > 0 else 1

    # ---- 判断逻辑 ----

    # ❌ 破涨停前平台 → 主力出货，放弃
    if latest_close < platform_price * 0.97:
        return {"signal": "abandon", "reason": f"破涨停前平台({platform_price:.2f})，主力出货"}

    # ❌ 涨停后连续5天以上高位放量滞涨
    if days_after >= 5:
        high_after = after_lu['最高'].max()
        if latest_close < high_after * 0.97 and vol_ratio > 0.8:
            return {"signal": "abandon", "reason": f"高位放量滞涨{days_after}天，建仓窗口已过"}

    # ❌ 超过10天没有明确方向
    if days_after > 10:
        price_range = (after_lu['最高'].max() - after_lu['最低'].min()) / limit_up_price
        if price_range < 0.05:
            return {"signal": "wait", "reason": f"横盘{days_after}天振幅小，继续观察"}
        elif latest_close < limit_up_price * 0.95:
            return {"signal": "abandon", "reason": f"涨停后{days_after}天回落超5%，放弃"}

    # ✅ 缩量回踩（量缩到涨停日1/3以下），企稳MA5
    if vol_ratio < 0.35 and latest_close >= ma5 * 0.99:
        return {"signal": "buy", "reason": f"缩量回踩企稳(量比{vol_ratio:.0%})，可建仓"}

    # ✅ 横盘3-5天消化后放量突破涨停价
    if days_after >= 3 and latest_close > limit_up_price * 1.01 and latest_vol > lu_vol * 0.6:
        return {"signal": "buy", "reason": f"横盘{days_after}天后放量突破涨停价，可建仓"}

    # ✅ 回踩MA5不破+缩量
    if latest_close >= ma5 * 0.98 and vol_ratio < 0.5:
        if days_after >= 2:
            return {"signal": "buy", "reason": f"回踩MA5企稳+缩量(量比{vol_ratio:.0%})，可建仓"}

    # 继续观察
    return {"signal": "wait", "reason": f"涨停后第{days_after}天，量比{vol_ratio:.0%}，观察中"}


def track_limit_up_stocks() -> list[dict]:
    """
    扫描池内涨停入池的股票，返回建仓跟踪报告
    返回: [{"code", "name", "days_after", "signal", "reason"}, ...]
    """
    with open(WATCHLIST_PATH) as f:
        wl = json.load(f)
    stocks = wl.get("stocks", [])

    # 找出标记了 limitUp 的
    limit_up_stocks = [s for s in stocks if s.get("limitUp")]
    
    if not limit_up_stocks:
        return []

    results = []
    for stock in limit_up_stocks:
        code = stock["code"]
        name = stock.get("name", code)
        lu_price = stock.get("limitUpPrice", 0)
        lu_date = stock.get("limitUpDate", stock.get("addedDate", ""))

        df = _fetch_kline(code, days=20)
        time.sleep(0.3)

        judgment = _judge_position_signal(df, lu_price, lu_date)

        # 计算入池天数
        try:
            days_after = (datetime.now() - datetime.strptime(lu_date, "%Y-%m-%d")).days
        except:
            days_after = 0

        results.append({
            "code": code,
            "name": name,
            "days_after": days_after,
            "signal": judgment["signal"],
            "reason": judgment["reason"],
            "limitUpPrice": lu_price,
        })

    return results


if __name__ == "__main__":
    results = track_limit_up_stocks()
    if not results:
        print("池内无涨停入池股票")
    else:
        print(f"📌 涨停股建仓跟踪（{len(results)}只）：")
        for r in results:
            emoji = {"buy": "✅", "wait": "⏳", "abandon": "❌"}[r["signal"]]
            print(f"  {emoji} {r['name']}({r['code']}): 入池第{r['days_after']}天 | {r['reason']}")
