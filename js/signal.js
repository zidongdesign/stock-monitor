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
  }
};
