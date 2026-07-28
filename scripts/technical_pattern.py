#!/usr/bin/env python3
"""
技术形态识别 + 技术强弱排序模块
功能：拉取池内股票60日日K线，做形态/趋势/量价分析，输出技术强弱分(0-100)
路径：~/chenpitang/project/stock-monitor-web/scripts/technical_pattern.py
"""

import os
import time
import traceback
from datetime import datetime, timedelta

# --- 绕过 macOS 系统代理（networksetup 设置的 HTTP/HTTPS proxy） ---
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


# ============================================================
# 工具函数
# ============================================================

def _convert_symbol(code: str) -> str:
    """sz300014 → 300014, sh600584 → 600584"""
    code = code.strip().lower()
    if code.startswith(('sz', 'sh')):
        return code[2:]
    return code


def _find_local_extrema(series: np.ndarray, order: int = 5):
    """
    找局部极值点（手写zigzag方式，避免scipy依赖）
    order: 前后各order个点都比当前低/高才算极值
    返回: (maxima_indices, minima_indices)
    """
    n = len(series)
    maxima = []
    minima = []
    for i in range(order, n - order):
        # 局部最大
        if all(series[i] >= series[i - j] for j in range(1, order + 1)) and \
           all(series[i] >= series[i + j] for j in range(1, order + 1)):
            maxima.append(i)
        # 局部最小
        if all(series[i] <= series[i - j] for j in range(1, order + 1)) and \
           all(series[i] <= series[i + j] for j in range(1, order + 1)):
            minima.append(i)
    return np.array(maxima), np.array(minima)


def _calc_ema(series: np.ndarray, span: int) -> np.ndarray:
    """计算EMA"""
    alpha = 2 / (span + 1)
    ema = np.zeros_like(series, dtype=float)
    ema[0] = series[0]
    for i in range(1, len(series)):
        ema[i] = alpha * series[i] + (1 - alpha) * ema[i - 1]
    return ema


# ============================================================
# 形态识别（30分权重）
# ============================================================

def _detect_patterns(df: pd.DataFrame) -> tuple:
    """
    形态识别，返回 (score_delta, signals)
    score_delta: -15 ~ +15
    """
    signals = []
    score = 0.0
    highs = df['最高'].values
    lows = df['最低'].values
    closes = df['收盘'].values
    volumes = df['成交量'].values

    if len(df) < 20:
        return 0, signals

    # 找高低点
    max_idx, min_idx = _find_local_extrema(highs, order=3)
    _, min_idx_low = _find_local_extrema(-lows, order=3)  # lows的极小值
    min_idx_low_actual, _ = _find_local_extrema(-lows, order=3)
    # 重新用lows找极小值
    _, lows_min_idx = _find_local_extrema(lows * -1, order=3)
    lows_min_idx = np.array([i for i in range(3, len(lows) - 3)
                             if all(lows[i] <= lows[i - j] for j in range(1, 4))
                             and all(lows[i] <= lows[i + j] for j in range(1, 4))])

    # --- 双底(W底) ---
    if len(lows_min_idx) >= 2:
        # 取最近两个低点
        last_two_lows = lows_min_idx[-2:]
        l1, l2 = lows[last_two_lows[0]], lows[last_two_lows[1]]
        # 两低点相差不超过3%，且间隔>=5天
        if abs(l1 - l2) / max(l1, l2) < 0.03 and (last_two_lows[1] - last_two_lows[0]) >= 5:
            # 两低点之间有明显高点
            between = highs[last_two_lows[0]:last_two_lows[1] + 1]
            neckline = np.max(between)
            # 当前价格突破颈线
            if closes[-1] > neckline * 0.98:
                score += 12
                signals.append("W底形成")
            elif closes[-1] > (l1 + l2) / 2:
                score += 6
                signals.append("双底雏形")

    # --- 双顶(M头) ---
    if len(max_idx) >= 2:
        last_two_highs = max_idx[-2:]
        h1, h2 = highs[last_two_highs[0]], highs[last_two_highs[1]]
        if abs(h1 - h2) / max(h1, h2) < 0.03 and (last_two_highs[1] - last_two_highs[0]) >= 5:
            between_lows = lows[last_two_highs[0]:last_two_highs[1] + 1]
            neckline = np.min(between_lows)
            if closes[-1] < neckline * 1.02:
                score -= 12
                signals.append("M头确认")
            elif closes[-1] < (h1 + h2) / 2:
                score -= 6
                signals.append("双顶雏形")

    # --- 头肩底 ---
    if len(lows_min_idx) >= 3:
        last_three = lows_min_idx[-3:]
        l_left, l_head, l_right = lows[last_three[0]], lows[last_three[1]], lows[last_three[2]]
        # 中间低点最低，两肩差不多高
        if l_head < l_left and l_head < l_right and abs(l_left - l_right) / max(l_left, l_right) < 0.05:
            score += 10
            signals.append("头肩底")

    # --- 头肩顶 ---
    if len(max_idx) >= 3:
        last_three = max_idx[-3:]
        h_left, h_head, h_right = highs[last_three[0]], highs[last_three[1]], highs[last_three[2]]
        if h_head > h_left and h_head > h_right and abs(h_left - h_right) / max(h_left, h_right) < 0.05:
            score -= 10
            signals.append("头肩顶")

    # --- 高位放量滞涨 ---
    if len(df) >= 10:
        recent_5 = df.iloc[-5:]
        prev_5 = df.iloc[-10:-5]
        avg_vol_prev = prev_5['成交量'].mean()
        avg_vol_recent = recent_5['成交量'].mean()
        price_change = (recent_5['收盘'].iloc[-1] - recent_5['收盘'].iloc[0]) / recent_5['收盘'].iloc[0]
        # 近5天均量>前5天1.5倍，但涨幅<2%
        if avg_vol_recent > avg_vol_prev * 1.5 and price_change < 0.02 and closes[-1] > np.percentile(closes, 75):
            score -= 8
            signals.append("高位放量滞涨")

    # --- 低位放量突破 ---
    if len(df) >= 10:
        recent_5 = df.iloc[-5:]
        prev_20 = df.iloc[-25:-5] if len(df) >= 25 else df.iloc[:-5]
        if len(prev_20) > 0:
            avg_vol_prev = prev_20['成交量'].mean()
            avg_vol_recent = recent_5['成交量'].mean()
            price_change = (recent_5['收盘'].iloc[-1] - recent_5['收盘'].iloc[0]) / recent_5['收盘'].iloc[0]
            if avg_vol_recent > avg_vol_prev * 1.5 and price_change > 0.05 and closes[-1] < np.percentile(closes, 40):
                score += 10
                signals.append("低位放量突破")

    # 限制范围
    score = max(-15, min(15, score))
    return score, signals


# ============================================================
# 趋势指标（40分权重）
# ============================================================

def _analyze_trend(df: pd.DataFrame) -> tuple:
    """
    趋势分析，返回 (score, signals)
    score: 0~40
    """
    signals = []
    score = 20.0  # 中性基准
    closes = df['收盘'].values

    if len(df) < 20:
        return 20, signals

    # --- 均线计算 ---
    ma5 = pd.Series(closes).rolling(5).mean().values
    ma10 = pd.Series(closes).rolling(10).mean().values
    ma20 = pd.Series(closes).rolling(20).mean().values

    # MA60需要足够数据
    has_ma60 = len(df) >= 60
    if has_ma60:
        ma60 = pd.Series(closes).rolling(60).mean().values
    else:
        ma60 = pd.Series(closes).rolling(min(len(df), 60)).mean().values

    # --- 均线多头排列 ---
    if not np.isnan(ma5[-1]) and not np.isnan(ma10[-1]) and not np.isnan(ma20[-1]):
        if ma5[-1] > ma10[-1] > ma20[-1]:
            score += 10
            signals.append("均线多头排列")
            if has_ma60 and not np.isnan(ma60[-1]) and ma20[-1] > ma60[-1]:
                score += 3
                signals.append("MA60上方运行")
        elif ma5[-1] < ma10[-1] < ma20[-1]:
            score -= 10
            signals.append("均线空头排列")
            if has_ma60 and not np.isnan(ma60[-1]) and ma20[-1] < ma60[-1]:
                score -= 3
                signals.append("MA60下方运行")

    # --- 价格相对MA20 ---
    if not np.isnan(ma20[-1]):
        price_vs_ma20 = (closes[-1] - ma20[-1]) / ma20[-1]
        if price_vs_ma20 > 0.05:
            score += 3
            signals.append("站稳MA20上方")
        elif price_vs_ma20 > 0:
            score += 1
            signals.append("MA20上方")
        elif price_vs_ma20 < -0.05:
            score -= 5
            signals.append("远离MA20下方")
        elif price_vs_ma20 < 0:
            score -= 2
            signals.append("破MA20")

        # MA20方向（近5日斜率）
        if len(ma20) >= 5 and not np.isnan(ma20[-5]):
            ma20_slope = (ma20[-1] - ma20[-5]) / ma20[-5]
            if ma20_slope > 0.01:
                score += 2
                signals.append("MA20上行")
            elif ma20_slope < -0.01:
                score -= 2
                signals.append("MA20下行")

    # --- MACD ---
    if len(closes) >= 26:
        ema12 = _calc_ema(closes, 12)
        ema26 = _calc_ema(closes, 26)
        dif = ema12 - ema26
        dea = _calc_ema(dif, 9)
        macd_bar = (dif - dea) * 2

        # MACD柱方向
        if len(macd_bar) >= 3:
            if macd_bar[-1] > macd_bar[-2] > macd_bar[-3]:
                score += 3
                signals.append("MACD柱放大")
            elif macd_bar[-1] < macd_bar[-2] < macd_bar[-3]:
                score -= 3
                signals.append("MACD柱缩小")

        # 金叉/死叉（最近5天内）
        for i in range(-5, -1):
            if i >= -len(dif) and i + 1 < 0:
                if dif[i] < dea[i] and dif[i + 1] >= dea[i + 1]:
                    score += 5
                    signals.append("MACD金叉")
                    break
                elif dif[i] > dea[i] and dif[i + 1] <= dea[i + 1]:
                    score -= 5
                    signals.append("MACD死叉")
                    break

    # 限制范围 0~40
    score = max(0, min(40, score))
    return score, signals


# ============================================================
# 量价关系（30分权重）
# ============================================================

def _analyze_volume_price(df: pd.DataFrame) -> tuple:
    """
    量价分析，返回 (score, signals)
    score: 0~30
    """
    signals = []
    score = 15.0  # 中性基准

    if len(df) < 10:
        return 15, signals

    closes = df['收盘'].values
    volumes = df['成交量'].values

    # 近5日
    vol_5 = volumes[-5:]
    close_5 = closes[-5:]
    # 前20日（排除最近5日）
    if len(df) >= 25:
        vol_prev = volumes[-25:-5]
    else:
        vol_prev = volumes[:-5]

    avg_vol_5 = np.mean(vol_5)
    avg_vol_prev = np.mean(vol_prev) if len(vol_prev) > 0 else avg_vol_5

    price_change_5 = (close_5[-1] - close_5[0]) / close_5[0] if close_5[0] > 0 else 0
    vol_ratio = avg_vol_5 / avg_vol_prev if avg_vol_prev > 0 else 1.0

    # --- 放量突破（量增价升） ---
    if vol_ratio > 1.5 and price_change_5 > 0.03:
        score += 8
        signals.append("放量突破")
    elif vol_ratio > 1.2 and price_change_5 > 0.02:
        score += 4
        signals.append("温和放量上涨")

    # --- 放量下跌 ---
    if vol_ratio > 1.5 and price_change_5 < -0.03:
        score -= 8
        signals.append("放量下跌")
    elif vol_ratio > 1.2 and price_change_5 < -0.02:
        score -= 4
        signals.append("放量阴跌")

    # --- 缩量回调（健康调整） ---
    if vol_ratio < 0.7 and -0.05 < price_change_5 < -0.01:
        # 判断前期是否上涨
        if len(df) >= 20:
            prior_change = (closes[-10] - closes[-20]) / closes[-20] if closes[-20] > 0 else 0
            if prior_change > 0.05:
                score += 5
                signals.append("缩量回调")

    # --- 缩量反弹（反弹无力） ---
    if vol_ratio < 0.7 and price_change_5 > 0.01:
        if len(df) >= 20:
            prior_change = (closes[-10] - closes[-20]) / closes[-20] if closes[-20] > 0 else 0
            if prior_change < -0.05:
                score -= 4
                signals.append("缩量反弹")

    # --- 量价背离 ---
    # 价创新高但量萎缩
    if len(df) >= 20:
        high_20 = np.max(closes[-20:])
        if closes[-1] >= high_20 * 0.98 and vol_ratio < 0.8:
            score -= 3
            signals.append("量价背离")

    # 限制范围 0~30
    score = max(0, min(30, score))
    return score, signals


# ============================================================
# 主函数
# ============================================================

def _fetch_stock_data(code: str) -> pd.DataFrame | None:
    """用腾讯财经接口拉取日K线（稳定，不被东方财富封IP）
    code: sz300014 / sh600584 格式
    """
    try:
        # 构造腾讯格式 symbol
        c = code.strip().lower()
        if c.startswith(('sz', 'sh')):
            tc_symbol = c  # 已经是 sh/sz 格式
        elif c.startswith('6') or c.startswith('9'):
            tc_symbol = f'sh{c}'
        else:
            tc_symbol = f'sz{c}'

        end_d = datetime.now().strftime('%Y-%m-%d')
        start_d = (datetime.now() - timedelta(days=120)).strftime('%Y-%m-%d')
        url = (f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
               f"?_var=kline_dayqfq&param={tc_symbol},day,{start_d},{end_d},100,qfq")
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
        # 只保留最近60个交易日
        df = df.tail(60).reset_index(drop=True)
        return df
    except Exception as e:
        print(f"[technical_pattern] 拉取 {code} 数据失败: {e}")
        return None


def _analyze_single_stock(code: str, name: str) -> dict:
    """分析单只股票，返回 {code, name, score, signals}"""
    df = _fetch_stock_data(code)

    if df is None or len(df) < 10:
        return {"code": code, "name": name, "score": 50, "signals": ["数据不足"]}

    # 形态识别 (贡献 -15 ~ +15，映射到0~30)
    pattern_delta, pattern_signals = _detect_patterns(df)
    pattern_score = 15 + pattern_delta  # 0~30

    # 趋势指标 (0~40)
    trend_score, trend_signals = _analyze_trend(df)

    # 量价关系 (0~30)
    vol_score, vol_signals = _analyze_volume_price(df)

    # 综合得分
    total = pattern_score + trend_score + vol_score
    total = max(0, min(100, total))

    all_signals = pattern_signals + trend_signals + vol_signals

    return {
        "code": code,
        "name": name,
        "score": round(total),
        "signals": all_signals
    }


def analyze_pool_technical(stock_codes: list[dict]) -> dict:
    """
    主函数：分析股票池技术形态
    
    stock_codes: [{"code": "sz300014", "name": "亿纬锂能"}, ...]
    返回:
    {
        "top5": [{"code": "...", "name": "...", "score": 85, "signals": [...]}, ...],
        "bottom5": [{"code": "...", "name": "...", "score": 15, "signals": [...]}, ...],
        "all_scores": [{"code": "...", "name": "...", "score": ..., "signals": [...]}, ...],
    }
    """
    results = []

    for i, stock in enumerate(stock_codes):
        code = stock.get("code", "")
        name = stock.get("name", "未知")
        try:
            result = _analyze_single_stock(code, name)
            results.append(result)
        except Exception as e:
            print(f"[technical_pattern] 分析 {code} {name} 异常: {e}")
            traceback.print_exc()
            results.append({"code": code, "name": name, "score": 50, "signals": ["分析异常"]})

        # 避免频繁请求被封
        if i < len(stock_codes) - 1:
            time.sleep(0.5)

    # 按分数降序排列
    results.sort(key=lambda x: x["score"], reverse=True)

    return {
        "top5": results[:5],
        "bottom5": results[-5:][::-1] if len(results) >= 5 else results[::-1],
        "all_scores": results,
    }


# ============================================================
# 命令行测试
# ============================================================

if __name__ == "__main__":
    # 测试用例
    test_stocks = [
        {"code": "sz300014", "name": "亿纬锂能"},
        {"code": "sh600584", "name": "长电科技"},
        {"code": "sz002475", "name": "立讯精密"},
    ]
    result = analyze_pool_technical(test_stocks)
    print("\n=== 技术强弱排序 ===")
    print(f"\n最强 Top5:")
    for s in result["top5"]:
        print(f"  {s['name']}({s['code']}) - {s['score']}分 {s['signals']}")
    print(f"\n最弱 Bottom5:")
    for s in result["bottom5"]:
        print(f"  {s['name']}({s['code']}) - {s['score']}分 {s['signals']}")
