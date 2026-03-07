/**
 * 异动信号检测模块（增强版）
 * 实时信号 + K线形态 + 技术指标
 */
const SignalDetector = {
  // ====== 实时信号检测 ======
  detectRealtime(stock, settings) {
    const signals = [];
    if (!stock || !stock.price) return signals;

    const vrThresh = (settings && settings.volumeRatioThreshold) || 3;
    const turnThresh = (settings && settings.turnoverThreshold) || 10;

    // 量比>阈值且涨>2% → 放量拉升
    if (stock.volumeRatio > vrThresh && stock.changePercent > 2) {
      signals.push({ type: 'buy', level: 'high', reason: '放量拉升 量比' + stock.volumeRatio.toFixed(1) });
    }

    // 量比>5 → 巨量
    if (stock.volumeRatio > 5) {
      signals.push({ type: 'warn', level: 'high', reason: '巨量 量比' + stock.volumeRatio.toFixed(1) });
    }

    // 涨>5% → 急拉
    if (stock.changePercent > 5) {
      signals.push({ type: 'warn', level: 'high', reason: '急拉 ' + stock.changePercent.toFixed(1) + '%' });
    }

    // 涨停（A股 10%/20%，期货 ~5%）
    if (!stock.isFutures && stock.changePercent > 9.5) {
      signals.push({ type: 'limit_up', level: 'critical', reason: '涨停！' });
    }
    if (stock.isFutures && stock.changePercent > 4.5) {
      signals.push({ type: 'limit_up', level: 'critical', reason: '期货涨停！' });
    }

    // 跌>5% → 急跌
    if (stock.changePercent < -5) {
      signals.push({ type: 'sell', level: 'high', reason: '急跌 ' + stock.changePercent.toFixed(1) + '%' });
    }

    // 跌停
    if (!stock.isFutures && stock.changePercent < -9.5) {
      signals.push({ type: 'limit_down', level: 'critical', reason: '跌停！' });
    }
    if (stock.isFutures && stock.changePercent < -4.5) {
      signals.push({ type: 'limit_down', level: 'critical', reason: '期货跌停！' });
    }

    // 换手率 > 阈值
    if (stock.turnover > turnThresh) {
      signals.push({ type: 'info', level: 'medium', reason: '高换手 ' + stock.turnover.toFixed(1) + '%' });
    }

    return signals;
  },

  // ====== K线形态信号 ======
  detectKlineSignals(klines, settings) {
    if (!klines || klines.length < 5) return [];
    const signals = [];
    const len = klines.length;

    for (let i = 2; i < len; i++) {
      const c = klines[i], p = klines[i - 1], p2 = klines[i - 2];

      // 放量阳线
      if (c.volume > p.volume * 2 && c.close > c.open) {
        signals.push({ index: i, date: c.date, type: 'buy', reason: '放量阳线' });
      }

      // 三连阳
      if (c.close > c.open && p.close > p.open && p2.close > p2.open) {
        signals.push({ index: i, date: c.date, type: 'buy', reason: '三连阳' });
      }

      // 三连阴
      if (c.close < c.open && p.close < p.open && p2.close < p2.open) {
        signals.push({ index: i, date: c.date, type: 'sell', reason: '三连阴' });
      }

      // 长下影线
      const body = Math.abs(c.close - c.open);
      const lowerShadow = Math.min(c.open, c.close) - c.low;
      if (lowerShadow > body * 2 && body > 0) {
        signals.push({ index: i, date: c.date, type: 'buy', reason: '长下影线' });
      }
    }

    // MA 金叉/死叉
    const ma5 = this.calcMA(klines, 5);
    const ma10 = this.calcMA(klines, 10);
    for (let i = 1; i < len; i++) {
      if (ma5[i] && ma10[i] && ma5[i - 1] && ma10[i - 1]) {
        if (ma5[i - 1] < ma10[i - 1] && ma5[i] >= ma10[i]) {
          signals.push({ index: i, date: klines[i].date, type: 'buy', reason: 'MA金叉(5/10)' });
        }
        if (ma5[i - 1] > ma10[i - 1] && ma5[i] <= ma10[i]) {
          signals.push({ index: i, date: klines[i].date, type: 'sell', reason: 'MA死叉(5/10)' });
        }
      }
    }

    // MACD 金叉/死叉
    if (settings && settings.macd) {
      const macd = this.calcMACD(klines);
      for (let i = 1; i < macd.length; i++) {
        if (macd[i - 1].hist < 0 && macd[i].hist >= 0) {
          signals.push({ index: i, date: klines[i].date, type: 'buy', reason: 'MACD金叉' });
        }
        if (macd[i - 1].hist > 0 && macd[i].hist <= 0) {
          signals.push({ index: i, date: klines[i].date, type: 'sell', reason: 'MACD死叉' });
        }
      }
    }

    // KDJ 金叉/死叉
    if (settings && settings.kdj) {
      const kdj = this.calcKDJ(klines);
      for (let i = 1; i < kdj.length; i++) {
        if (kdj[i - 1].j < kdj[i - 1].d && kdj[i].j >= kdj[i].d && kdj[i].j < 30) {
          signals.push({ index: i, date: klines[i].date, type: 'buy', reason: 'KDJ金叉' });
        }
        if (kdj[i - 1].j > kdj[i - 1].d && kdj[i].j <= kdj[i].d && kdj[i].j > 70) {
          signals.push({ index: i, date: klines[i].date, type: 'sell', reason: 'KDJ死叉' });
        }
      }
    }

    // CCI 超买超卖
    if (settings && settings.cci) {
      const cci = this.calcCCI(klines);
      for (let i = 1; i < cci.length; i++) {
        if (cci[i - 1] < 100 && cci[i] >= 100) {
          signals.push({ index: i, date: klines[i].date, type: 'warn', reason: 'CCI超买(>100)' });
        }
        if (cci[i - 1] > -100 && cci[i] <= -100) {
          signals.push({ index: i, date: klines[i].date, type: 'buy', reason: 'CCI超卖(<-100)' });
        }
      }
    }

    return signals;
  },

  // ====== 技术指标计算 ======
  calcMA(klines, period) {
    const result = [];
    for (let i = 0; i < klines.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      let sum = 0;
      for (let j = 0; j < period; j++) sum += klines[i - j].close;
      result.push(parseFloat((sum / period).toFixed(2)));
    }
    return result;
  },

  calcEMA(data, period) {
    const result = [];
    const k = 2 / (period + 1);
    for (let i = 0; i < data.length; i++) {
      if (i === 0) { result.push(data[0]); }
      else { result.push(data[i] * k + result[i - 1] * (1 - k)); }
    }
    return result;
  },

  calcMACD(klines) {
    const closes = klines.map(k => k.close);
    const ema12 = this.calcEMA(closes, 12);
    const ema26 = this.calcEMA(closes, 26);
    const dif = ema12.map((v, i) => v - ema26[i]);
    const dea = this.calcEMA(dif, 9);
    return dif.map((d, i) => ({
      dif: parseFloat(d.toFixed(4)),
      dea: parseFloat(dea[i].toFixed(4)),
      hist: parseFloat(((d - dea[i]) * 2).toFixed(4))
    }));
  },

  calcKDJ(klines, n) {
    n = n || 9;
    const result = [];
    let prevK = 50, prevD = 50;
    for (let i = 0; i < klines.length; i++) {
      const start = Math.max(0, i - n + 1);
      let high = -Infinity, low = Infinity;
      for (let j = start; j <= i; j++) {
        if (klines[j].high > high) high = klines[j].high;
        if (klines[j].low < low) low = klines[j].low;
      }
      const rsv = high === low ? 50 : (klines[i].close - low) / (high - low) * 100;
      const k = 2 / 3 * prevK + 1 / 3 * rsv;
      const d = 2 / 3 * prevD + 1 / 3 * k;
      const j = 3 * k - 2 * d;
      result.push({ k: +k.toFixed(2), d: +d.toFixed(2), j: +j.toFixed(2) });
      prevK = k;
      prevD = d;
    }
    return result;
  },

  calcCCI(klines, n) {
    n = n || 14;
    const result = [];
    for (let i = 0; i < klines.length; i++) {
      if (i < n - 1) { result.push(0); continue; }
      let sum = 0;
      const tps = [];
      for (let j = i - n + 1; j <= i; j++) {
        const tp = (klines[j].high + klines[j].low + klines[j].close) / 3;
        tps.push(tp);
        sum += tp;
      }
      const avg = sum / n;
      let md = 0;
      tps.forEach(tp => md += Math.abs(tp - avg));
      md /= n;
      const cci = md === 0 ? 0 : (tps[tps.length - 1] - avg) / (0.015 * md);
      result.push(+cci.toFixed(2));
    }
    return result;
  },

  // ====== 综合技术指标评分 ======
  // 基于 MACD/KDJ/量价/MA位置 综合判断
  // 返回: { level: 'buy'|'hold'|'sell', emoji, label, score, reason }
  calcComprehensiveSignal(stock, klines, fundFlow) {
    // 模拟模式直接返回预设数据
    if (MockData && MockData.shouldUseMock()) {
      const mockSignals = MockData.getComprehensiveSignals();
      if (mockSignals[stock.code]) return mockSignals[stock.code];
    }

    if (!klines || klines.length < 26) {
      return { level: 'hold', emoji: '🟡', label: '持有观察', score: 50, reason: 'K线数据不足，无法综合判断' };
    }

    let score = 50; // 基准分 50
    const reasons = [];
    const len = klines.length;
    const last = klines[len - 1];

    // 1. MACD 状态（±15分）
    const macd = this.calcMACD(klines);
    if (macd.length >= 2) {
      const curr = macd[macd.length - 1];
      const prev = macd[macd.length - 2];
      if (prev.hist < 0 && curr.hist >= 0) {
        score += 15; reasons.push('MACD金叉');
      } else if (prev.hist > 0 && curr.hist <= 0) {
        score -= 15; reasons.push('MACD死叉');
      } else if (curr.hist > 0 && curr.hist > prev.hist) {
        score += 8; reasons.push('MACD红柱放大');
      } else if (curr.hist < 0 && curr.hist < prev.hist) {
        score -= 8; reasons.push('MACD绿柱放大');
      } else if (curr.dif > 0 && curr.dea > 0) {
        score += 5;
      } else if (curr.dif < 0 && curr.dea < 0) {
        score -= 5;
      }
    }

    // 2. KDJ 状态（±12分）
    const kdj = this.calcKDJ(klines);
    if (kdj.length >= 2) {
      const curr = kdj[kdj.length - 1];
      const prev = kdj[kdj.length - 2];
      if (curr.k > 80 && curr.d > 80) {
        score -= 10; reasons.push('KDJ超买(>80)');
      } else if (curr.k < 20 && curr.d < 20) {
        score += 10; reasons.push('KDJ超卖(<20)');
      }
      if (prev.j < prev.d && curr.j >= curr.d && curr.j < 50) {
        score += 12; reasons.push('KDJ金叉');
      } else if (prev.j > prev.d && curr.j <= curr.d && curr.j > 50) {
        score -= 12; reasons.push('KDJ死叉');
      }
    }

    // 3. 量价关系（±10分）
    if (stock.volumeRatio > 2 && stock.changePercent > 1) {
      score += 10; reasons.push('放量上涨(量比' + stock.volumeRatio.toFixed(1) + ')');
    } else if (stock.volumeRatio > 2 && stock.changePercent < -1) {
      score -= 10; reasons.push('放量下跌(量比' + stock.volumeRatio.toFixed(1) + ')');
    } else if (stock.volumeRatio < 0.8 && stock.changePercent > 0) {
      score += 3; reasons.push('缩量上涨');
    } else if (stock.volumeRatio < 0.8 && stock.changePercent < -1) {
      score -= 5; reasons.push('缩量阴跌');
    }

    // 4. MA 位置关系（±10分）
    const ma5 = this.calcMA(klines, 5);
    const ma10 = this.calcMA(klines, 10);
    const ma20 = this.calcMA(klines, 20);
    const price = last.close;
    let maAbove = 0;
    if (ma5[len - 1] && price > ma5[len - 1]) maAbove++;
    if (ma10[len - 1] && price > ma10[len - 1]) maAbove++;
    if (ma20[len - 1] && price > ma20[len - 1]) maAbove++;

    if (maAbove === 3) {
      score += 10; reasons.push('站上MA5/10/20');
    } else if (maAbove === 2) {
      score += 5;
    } else if (maAbove === 0) {
      score -= 10; reasons.push('跌破所有均线');
    } else if (maAbove === 1) {
      score -= 3;
    }

    // MA5/MA10 排列
    if (ma5[len - 1] && ma10[len - 1]) {
      if (ma5[len - 2] < ma10[len - 2] && ma5[len - 1] >= ma10[len - 1]) {
        score += 5; reasons.push('MA5上穿MA10');
      } else if (ma5[len - 2] > ma10[len - 2] && ma5[len - 1] <= ma10[len - 1]) {
        score -= 5; reasons.push('MA5下穿MA10');
      }
    }

    // 5. 资金流向加分（±10分）
    if (fundFlow) {
      if (fundFlow.mainNet > 2000) {
        score += 10; reasons.push('主力净流入+' + this._formatMoney(fundFlow.mainNet));
      } else if (fundFlow.mainNet > 500) {
        score += 5; reasons.push('主力小幅流入');
      } else if (fundFlow.mainNet < -2000) {
        score -= 10; reasons.push('主力净流出' + this._formatMoney(fundFlow.mainNet));
      } else if (fundFlow.mainNet < -500) {
        score -= 5; reasons.push('主力小幅流出');
      }
      
      if (fundFlow.trend === 'in') {
        score += 3;
      } else if (fundFlow.trend === 'out') {
        score -= 3;
      }
    }

    // 限制分数在 0-100
    score = Math.max(0, Math.min(100, score));

    // 生成信号级别
    let level, emoji, label;
    if (score >= 65) {
      level = 'buy'; emoji = '🟢'; label = '买入关注';
    } else if (score >= 40) {
      level = 'hold'; emoji = '🟡'; label = '持有观察';
    } else {
      level = 'sell'; emoji = '🔴'; label = '注意风险';
    }

    // 组合理由（取前3个最重要的）
    const reason = reasons.slice(0, 3).join('，') || '指标中性';

    return { level, emoji, label, score, reason };
  },

  _formatMoney(val) {
    if (Math.abs(val) >= 10000) return (val / 10000).toFixed(1) + '亿';
    return val + '万';
  }
};
