/**
 * 异动信号检测模块
 */

const SignalDetector = {
  /**
   * 检测实时行情信号
   */
  detectRealtime(stock) {
    const signals = [];
    
    // 量比 > 3 且涨幅 > 2% → 放量异动
    if (stock.volumeRatio > 3 && stock.changePercent > 2) {
      signals.push({
        type: 'buy',
        level: 'high',
        reason: `放量拉升 量比${stock.volumeRatio.toFixed(1)}`
      });
    }
    
    // 量比 > 5 → 巨量
    if (stock.volumeRatio > 5) {
      signals.push({
        type: 'warn',
        level: 'high',
        reason: `巨量 量比${stock.volumeRatio.toFixed(1)}`
      });
    }
    
    // 涨幅 > 5% → 急拉
    if (stock.changePercent > 5) {
      signals.push({
        type: 'warn',
        level: 'high',
        reason: `急拉 ${stock.changePercent.toFixed(1)}%`
      });
    }
    
    // 涨幅 > 9.5% → 涨停
    if (stock.changePercent > 9.5) {
      signals.push({
        type: 'limit_up',
        level: 'critical',
        reason: '涨停！'
      });
    }
    
    // 跌幅 > 5% → 急跌
    if (stock.changePercent < -5) {
      signals.push({
        type: 'sell',
        level: 'high',
        reason: `急跌 ${stock.changePercent.toFixed(1)}%`
      });
    }
    
    // 跌幅 > 9.5% → 跌停
    if (stock.changePercent < -9.5) {
      signals.push({
        type: 'limit_down',
        level: 'critical',
        reason: '跌停！'
      });
    }
    
    // 换手率 > 10% → 活跃
    if (stock.turnover > 10) {
      signals.push({
        type: 'info',
        level: 'medium',
        reason: `高换手 ${stock.turnover.toFixed(1)}%`
      });
    }
    
    return signals;
  },

  /**
   * 检测K线形态信号
   */
  detectKlineSignals(klines) {
    if (!klines || klines.length < 5) return [];
    const signals = [];
    const len = klines.length;
    
    for (let i = 2; i < len; i++) {
      const curr = klines[i];
      const prev = klines[i - 1];
      const prev2 = klines[i - 2];
      
      // 放量阳线（量比前一天 > 2倍，且收阳）
      if (curr.volume > prev.volume * 2 && curr.close > curr.open) {
        signals.push({
          index: i,
          date: curr.date,
          type: 'buy',
          reason: '放量阳线'
        });
      }
      
      // 三连阳
      if (curr.close > curr.open && prev.close > prev.open && prev2.close > prev2.open) {
        signals.push({
          index: i,
          date: curr.date,
          type: 'buy',
          reason: '三连阳'
        });
      }
      
      // 三连阴
      if (curr.close < curr.open && prev.close < prev.open && prev2.close < prev2.open) {
        signals.push({
          index: i,
          date: curr.date,
          type: 'sell',
          reason: '三连阴'
        });
      }
      
      // 长下影线（下影线 > 实体2倍）→ 看涨
      const body = Math.abs(curr.close - curr.open);
      const lowerShadow = Math.min(curr.open, curr.close) - curr.low;
      if (lowerShadow > body * 2 && body > 0) {
        signals.push({
          index: i,
          date: curr.date,
          type: 'buy',
          reason: '长下影线'
        });
      }
    }
    
    return signals;
  },

  /**
   * 计算MA均线
   */
  calcMA(klines, period) {
    const result = [];
    for (let i = 0; i < klines.length; i++) {
      if (i < period - 1) {
        result.push(null);
      } else {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += klines[i - j].close;
        }
        result.push(parseFloat((sum / period).toFixed(2)));
      }
    }
    return result;
  }
};
