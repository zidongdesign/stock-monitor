/**
 * 期货K线技术分析模块
 */
const FuturesAnalysis = {
  // 日K数据缓存: { symbol: { data, timestamp } }
  _dailyCache: {},
  CACHE_TTL: 5 * 60 * 1000, // 5分钟缓存

  // 获取日K数据（带缓存）
  async fetchDailyWithCache(symbol) {
    const cached = this._dailyCache[symbol];
    if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
      return cached.data;
    }
    const data = await StockAPI.fetchFuturesDailyKline(symbol);
    this._dailyCache[symbol] = { data, timestamp: Date.now() };
    return data;
  },

  // 计算MA
  calcMA(klines, period) {
    const result = [];
    for (let i = 0; i < klines.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += klines[j].close;
      result.push(+(sum / period).toFixed(2));
    }
    return result;
  },

  // 计算MACD
  calcMACD(klines) {
    const closes = klines.map(k => k.close);
    let ema12 = closes[0], ema26 = closes[0];
    const difs = [], deas = [], hists = [];
    let dea = 0;
    for (let i = 0; i < closes.length; i++) {
      ema12 = (2 / 13) * closes[i] + (11 / 13) * ema12;
      ema26 = (2 / 27) * closes[i] + (25 / 27) * ema26;
      const dif = ema12 - ema26;
      dea = (2 / 10) * dif + (8 / 10) * dea;
      difs.push(+dif.toFixed(2));
      deas.push(+dea.toFixed(2));
      hists.push(+((dif - dea) * 2).toFixed(2));
    }
    return { difs, deas, hists };
  },

  // ====== 3a. 日线大方向判断 ======
  analyzeDailyTrend(dailyKlines) {
    if (!dailyKlines || dailyKlines.length < 20) {
      return { trend: '震荡', maLine: '数据不足', macdDir: '数据不足', ma5: 0, ma10: 0, ma20: 0 };
    }
    const recent = dailyKlines.slice(-30);
    const ma5Arr = this.calcMA(recent, 5);
    const ma10Arr = this.calcMA(recent, 10);
    const ma20Arr = this.calcMA(recent, 20);
    const last = recent.length - 1;
    const ma5 = ma5Arr[last];
    const ma10 = ma10Arr[last];
    const ma20 = ma20Arr[last];

    // MA排列
    let maLine = '', maTrend = '震荡';
    if (ma5 && ma10 && ma20) {
      if (ma5 > ma10 && ma10 > ma20) {
        maLine = 'MA5(' + ma5 + ')>MA10(' + ma10 + ')>MA20(' + ma20 + ')，多头排列';
        maTrend = '多头';
      } else if (ma5 < ma10 && ma10 < ma20) {
        maLine = 'MA5(' + ma5 + ')<MA10(' + ma10 + ')<MA20(' + ma20 + ')，空头排列';
        maTrend = '空头';
      } else {
        maLine = 'MA5(' + ma5 + ') MA10(' + ma10 + ') MA20(' + ma20 + ')，交叉震荡';
        maTrend = '震荡';
      }
    }

    // MACD
    const macd = this.calcMACD(recent);
    const lastDif = macd.difs[macd.difs.length - 1];
    const lastDea = macd.deas[macd.deas.length - 1];
    const lastHist = macd.hists[macd.hists.length - 1];
    const prevHist = macd.hists.length >= 2 ? macd.hists[macd.hists.length - 2] : 0;
    let macdDir = '', macdTrend = '中性';

    if (lastDif > lastDea) {
      if (lastHist > prevHist) {
        macdDir = 'MACD红柱扩大，多头动能增强';
        macdTrend = '偏多';
      } else {
        macdDir = 'MACD红柱缩小，多头动能减弱';
        macdTrend = '偏多弱';
      }
    } else {
      if (lastHist < prevHist) {
        macdDir = 'MACD绿柱扩大，空头动能增强';
        macdTrend = '偏空';
      } else {
        macdDir = 'MACD绿柱缩小，空头动能减弱';
        macdTrend = '偏空弱';
      }
    }

    // 综合
    let trend = '震荡';
    if (maTrend === '多头' && (macdTrend === '偏多' || macdTrend === '偏多弱')) trend = '偏多';
    else if (maTrend === '空头' && (macdTrend === '偏空' || macdTrend === '偏空弱')) trend = '偏空';
    else if (maTrend === '多头') trend = '偏多';
    else if (maTrend === '空头') trend = '偏空';

    return { trend, maLine, macdDir, ma5, ma10, ma20 };
  },

  // ====== 3b. 近5根K线分析 ======
  analyzeRecent5(klines) {
    if (!klines || klines.length < 5) {
      return { pattern: '数据不足', volume: '', lastBar: '', bullish: 0 };
    }
    const last5 = klines.slice(-5);
    let yangCount = 0, yinCount = 0, dojiCount = 0;
    const types = [];

    last5.forEach(k => {
      const body = Math.abs(k.close - k.open);
      const range = k.high - k.low;
      if (range > 0 && body < range * 0.1) {
        dojiCount++; types.push('十字星');
      } else if (k.close > k.open) {
        yangCount++; types.push('阳');
      } else {
        yinCount++; types.push('阴');
      }
    });

    let pattern = '';
    if (yangCount > 0) pattern += yangCount + '阳';
    if (yinCount > 0) pattern += yinCount + '阴';
    if (dojiCount > 0) pattern += dojiCount + '十字星';

    // 量能趋势
    const vols = last5.map(k => k.volume);
    let volume = '量能不规则';
    let increasing = true, decreasing = true;
    for (let i = 1; i < vols.length; i++) {
      if (vols[i] <= vols[i - 1]) increasing = false;
      if (vols[i] >= vols[i - 1]) decreasing = false;
    }
    if (increasing) volume = '量能递增';
    else if (decreasing) volume = '量能递减';

    // 形态识别
    let lastBar = '';
    const lastK = last5[last5.length - 1];
    const lastBody = Math.abs(lastK.close - lastK.open);
    const lastRange = lastK.high - lastK.low;
    const upperShadow = lastK.high - Math.max(lastK.open, lastK.close);
    const lowerShadow = Math.min(lastK.open, lastK.close) - lastK.low;

    // 连阳/连阴
    let consYang = 0, consYin = 0;
    for (let i = last5.length - 1; i >= 0; i--) {
      if (last5[i].close > last5[i].open) consYang++;
      else break;
    }
    for (let i = last5.length - 1; i >= 0; i--) {
      if (last5[i].close < last5[i].open) consYin++;
      else break;
    }

    if (consYang >= 3) lastBar = '连阳上攻，多头强势';
    else if (consYin >= 3) lastBar = '连阴下跌，空头强势';
    else if (lastRange > 0 && upperShadow > lastBody * 2 && upperShadow > lastRange * 0.4) lastBar = '长上影线，上方有压力';
    else if (lastRange > 0 && lowerShadow > lastBody * 2 && lowerShadow > lastRange * 0.4) lastBar = '长下影线，下方有支撑';
    else if (lastRange > 0 && lastBody < lastRange * 0.1) lastBar = '十字星，多空分歧';
    else if (lastK.close > lastK.open) lastBar = '收阳，多方占优';
    else lastBar = '收阴，空方占优';

    // 多空评分 -2 ~ +2
    let bullish = 0;
    if (yangCount >= 3) bullish += 1;
    if (yinCount >= 3) bullish -= 1;
    if (consYang >= 3) bullish += 1;
    if (consYin >= 3) bullish -= 1;
    if (increasing && yangCount > yinCount) bullish += 1;
    if (increasing && yinCount > yangCount) bullish -= 1;

    return { pattern, volume, lastBar, bullish };
  },

  // ====== 6. 支撑位和压力位 ======
  calcSupportResistance(klines) {
    if (!klines || klines.length < 5) return { support: 0, resistance: 0 };
    const recent20 = klines.slice(-20);
    const support = Math.min(...recent20.map(k => k.low));
    const resistance = Math.max(...recent20.map(k => k.high));
    return { support: +support.toFixed(2), resistance: +resistance.toFixed(2) };
  },

  // ====== 3c. 综合预判 ======
  generatePrediction(dailyTrend, recent5, sr) {
    const trend = dailyTrend.trend;
    const bull = recent5.bullish;
    let mainText = '', subText = '';

    if (trend === '偏多' && bull > 0) {
      mainText = '趋势延续，多头优势明显';
      subText = '关注支撑' + sr.support + '，不破可持多';
    } else if (trend === '偏多' && bull <= 0) {
      mainText = '短线回调，大方向偏多未变';
      subText = '回调至' + sr.support + '附近可关注接多';
    } else if (trend === '偏空' && bull > 0) {
      mainText = '反弹而非反转，谨慎追多';
      subText = '关注压力' + sr.resistance + '，不破偏空';
    } else if (trend === '偏空' && bull <= 0) {
      mainText = '趋势延续，空头优势明显';
      subText = '关注压力' + sr.resistance + '，反弹做空';
    } else {
      mainText = '区间震荡，高抛低吸';
      subText = '支撑' + sr.support + ' 压力' + sr.resistance;
    }

    return { mainText, subText, trend };
  },

  // ====== 主入口：完整分析 ======
  async analyze(symbol, currentKlines) {
    const dailyKlines = await this.fetchDailyWithCache(symbol);
    const dailyTrend = this.analyzeDailyTrend(dailyKlines);
    const recent5 = this.analyzeRecent5(currentKlines);
    const sr = this.calcSupportResistance(currentKlines);
    const prediction = this.generatePrediction(dailyTrend, recent5, sr);
    return { dailyTrend, recent5, prediction, sr };
  },

  // ====== 分段分析（每5根K线一组）======
  analyzeBySegments(klines, segmentSize) {
    segmentSize = segmentSize || 5;
    if (!klines || klines.length < 5) return [];

    const segments = [];
    const maxSegments = 4; // 最多4段
    let end = klines.length;

    while (end > 0 && segments.length < maxSegments) {
      const start = Math.max(0, end - segmentSize);
      const chunk = klines.slice(start, end);
      if (chunk.length < 2) break; // 太短没意义

      // 用 analyzeRecent5 的逻辑（传入 chunk，内部取 slice(-5)）
      // 为了让 analyzeRecent5 对不足5根的也能工作，手动实现
      const result = this._analyzeSegment(chunk);
      result.timeStart = chunk[0].time || chunk[0].datetime || '';
      result.timeEnd = chunk[chunk.length - 1].time || chunk[chunk.length - 1].datetime || '';
      result.klineCount = chunk.length;
      segments.push(result);

      end = start;
    }

    return segments; // 已经是最新在前（从尾部开始分的）
  },

  // 分析单个分段（复用 analyzeRecent5 逻辑，但支持不足5根）
  _analyzeSegment(chunk) {
    let yangCount = 0, yinCount = 0, dojiCount = 0;
    const types = [];

    chunk.forEach(k => {
      const body = Math.abs(k.close - k.open);
      const range = k.high - k.low;
      if (range > 0 && body < range * 0.1) {
        dojiCount++; types.push('十字星');
      } else if (k.close > k.open) {
        yangCount++; types.push('阳');
      } else {
        yinCount++; types.push('阴');
      }
    });

    let pattern = types.join('');

    // 量能趋势
    const vols = chunk.map(k => k.volume);
    let volume = '量能不规则';
    let increasing = true, decreasing = true;
    for (let i = 1; i < vols.length; i++) {
      if (vols[i] <= vols[i - 1]) increasing = false;
      if (vols[i] >= vols[i - 1]) decreasing = false;
    }
    if (increasing) volume = '📈 量能递增';
    else if (decreasing) volume = '📉 量能递减';
    else volume = '📊 量能不规则';

    // 形态
    let lastBar = '';
    const lastK = chunk[chunk.length - 1];
    const lastBody = Math.abs(lastK.close - lastK.open);
    const lastRange = lastK.high - lastK.low;
    const upperShadow = lastK.high - Math.max(lastK.open, lastK.close);
    const lowerShadow = Math.min(lastK.open, lastK.close) - lastK.low;

    let consYang = 0, consYin = 0;
    for (let i = chunk.length - 1; i >= 0; i--) {
      if (chunk[i].close > chunk[i].open) consYang++;
      else break;
    }
    for (let i = chunk.length - 1; i >= 0; i--) {
      if (chunk[i].close < chunk[i].open) consYin++;
      else break;
    }

    if (consYang >= 3) lastBar = '连阳上攻';
    else if (consYin >= 3) lastBar = '连阴下跌';
    else if (lastRange > 0 && upperShadow > lastBody * 2 && upperShadow > lastRange * 0.4) lastBar = '长上影线';
    else if (lastRange > 0 && lowerShadow > lastBody * 2 && lowerShadow > lastRange * 0.4) lastBar = '长下影线';
    else if (lastRange > 0 && lastBody < lastRange * 0.1) lastBar = '十字星';
    else if (lastK.close > lastK.open) lastBar = '收阳';
    else lastBar = '收阴';

    // 多空评分 -2 ~ +2
    let bullish = 0;
    if (yangCount >= 3) bullish += 1;
    if (yinCount >= 3) bullish -= 1;
    if (consYang >= 3) bullish += 1;
    if (consYin >= 3) bullish -= 1;
    if (increasing && yangCount > yinCount) bullish += 1;
    if (increasing && yinCount > yangCount) bullish -= 1;

    // 涨跌幅
    const changeP = chunk[0].open > 0 ? ((chunk[chunk.length - 1].close - chunk[0].open) / chunk[0].open * 100).toFixed(2) : '0.00';

    return { pattern, volume, lastBar, bullish, yangCount, yinCount, dojiCount, changeP };
  },

  // ====== 异动检测 ======
  detectAnomalies(klines) {
    if (!klines || klines.length < 6) return [];

    const anomalies = [];
    const len = klines.length;

    // 辅助：取时间标签
    const timeLabel = (k) => {
      const t = k.time || k.datetime || '';
      // 如果是分钟K线格式 "2025-03-13 14:35"，只取时间部分
      if (t.includes(' ')) return t.split(' ')[1] || t;
      return t;
    };

    // 1. 放量异动：当前K线量 > 前5根均量 * 2
    for (let i = Math.max(5, len - 5); i < len; i++) {
      let sumVol = 0;
      for (let j = i - 5; j < i; j++) sumVol += klines[j].volume;
      const avgVol = sumVol / 5;
      if (avgVol > 0 && klines[i].volume > avgVol * 2) {
        const ratio = (klines[i].volume / avgVol).toFixed(1);
        const change = klines[i].open > 0 ? ((klines[i].close - klines[i].open) / klines[i].open * 100).toFixed(1) : '0';
        const dir = klines[i].close >= klines[i].open ? '阳' : '阴';
        anomalies.push({
          time: timeLabel(klines[i]),
          type: 'volume',
          label: '放量大' + dir + '线',
          detail: '量比' + ratio + 'x，' + (change >= 0 ? '涨' : '跌') + change + '%',
          severity: ratio >= 3 ? 'high' : 'medium'
        });
      }
    }

    // 2. 大阳/大阴线：实体 > 近10根平均实体 * 2
    if (len >= 11) {
      for (let i = Math.max(10, len - 5); i < len; i++) {
        let sumBody = 0;
        for (let j = i - 10; j < i; j++) sumBody += Math.abs(klines[j].close - klines[j].open);
        const avgBody = sumBody / 10;
        const curBody = Math.abs(klines[i].close - klines[i].open);
        if (avgBody > 0 && curBody > avgBody * 2) {
          const ratio = (curBody / avgBody).toFixed(1);
          const dir = klines[i].close >= klines[i].open ? '大阳线' : '大阴线';
          const change = klines[i].open > 0 ? ((klines[i].close - klines[i].open) / klines[i].open * 100).toFixed(1) : '0';
          // 避免和放量重复
          const alreadyHas = anomalies.some(a => a.time === timeLabel(klines[i]) && a.type === 'volume');
          if (alreadyHas) {
            // 合并到放量里
            const existing = anomalies.find(a => a.time === timeLabel(klines[i]) && a.type === 'volume');
            if (existing) existing.label = '放量' + dir;
          } else {
            anomalies.push({
              time: timeLabel(klines[i]),
              type: 'bigbar',
              label: dir,
              detail: '实体' + ratio + '倍于均值，' + (change >= 0 ? '涨' : '跌') + change + '%',
              severity: ratio >= 3 ? 'high' : 'medium'
            });
          }
        }
      }
    }

    // 3. 连续同向：连续3根以上
    let streak = 1;
    let streakDir = klines[len - 1].close >= klines[len - 1].open ? 'yang' : 'yin';
    for (let i = len - 2; i >= Math.max(0, len - 8); i--) {
      const dir = klines[i].close >= klines[i].open ? 'yang' : 'yin';
      if (dir === streakDir) streak++;
      else break;
    }
    if (streak >= 3) {
      anomalies.push({
        time: timeLabel(klines[len - 1]),
        type: 'streak',
        label: '连续' + streak + (streakDir === 'yang' ? '阳' : '阴'),
        detail: streakDir === 'yang' ? '多头持续发力' : '空头持续打压',
        severity: streak >= 5 ? 'high' : 'medium'
      });
    }

    // 4. 跳空缺口
    for (let i = Math.max(1, len - 5); i < len; i++) {
      const prev = klines[i - 1];
      const cur = klines[i];
      if (cur.open > prev.high) {
        anomalies.push({
          time: timeLabel(cur),
          type: 'gap',
          label: '跳空高开',
          detail: '缺口 ' + prev.high.toFixed(0) + '-' + cur.open.toFixed(0),
          severity: 'high'
        });
      } else if (cur.open < prev.low) {
        anomalies.push({
          time: timeLabel(cur),
          type: 'gap',
          label: '跳空低开',
          detail: '缺口 ' + cur.open.toFixed(0) + '-' + prev.low.toFixed(0),
          severity: 'high'
        });
      }
    }

    // 5. 急速拉升/下跌：最近3根累计涨跌幅 > 2%
    if (len >= 3) {
      const last3Start = klines[len - 3].open;
      const last3End = klines[len - 1].close;
      if (last3Start > 0) {
        const changeP = ((last3End - last3Start) / last3Start * 100);
        if (Math.abs(changeP) > 2) {
          anomalies.push({
            time: timeLabel(klines[len - 3]) + '~' + timeLabel(klines[len - 1]),
            type: 'rapid',
            label: changeP > 0 ? '急速拉升' : '急速下跌',
            detail: '3根累计' + (changeP > 0 ? '+' : '') + changeP.toFixed(1) + '%',
            severity: Math.abs(changeP) > 3 ? 'high' : 'medium'
          });
        }
      }
    }

    // 6. 尾盘异动：最后3根波动 > 之前同数量的2倍
    if (len >= 10) {
      const last3Range = klines.slice(-3).reduce((s, k) => s + (k.high - k.low), 0) / 3;
      const prev7Range = klines.slice(-10, -3).reduce((s, k) => s + (k.high - k.low), 0) / 7;
      if (prev7Range > 0 && last3Range > prev7Range * 2) {
        const ratio = (last3Range / prev7Range).toFixed(1);
        anomalies.push({
          time: timeLabel(klines[len - 3]) + '~' + timeLabel(klines[len - 1]),
          type: 'late_move',
          label: '尾盘异动',
          detail: '波幅' + ratio + '倍于前段',
          severity: ratio >= 3 ? 'high' : 'medium'
        });
      }
    }

    // 按时间倒序，去重
    const seen = new Set();
    return anomalies.filter(a => {
      const key = a.time + a.type;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => (b.time > a.time ? 1 : -1));
  },

  // ====== 渲染分段分析HTML ======
  renderSegmentsHTML(segments) {
    if (!segments || segments.length === 0) return '';

    let html = '<div class="fa-segments">';
    html += '<div class="fa-label">📊 分段K线分析</div>';

    segments.forEach((seg, idx) => {
      const bullClass = seg.bullish > 0 ? 'bullish' : seg.bullish < 0 ? 'bearish' : 'neutral';
      const bullLabel = seg.bullish > 0 ? '偏多' : seg.bullish < 0 ? '偏空' : '中性';
      const changeClass = parseFloat(seg.changeP) >= 0 ? 'bullish' : 'bearish';
      const changeSign = parseFloat(seg.changeP) >= 0 ? '+' : '';
      const isLast = idx === segments.length - 1;
      const connector = isLast ? '└' : '├';

      html += '<div class="fa-segment-card">' +
        '<div class="fa-seg-header">' +
          '<span class="fa-seg-time">' + connector + ' ' + (seg.timeStart || '') + ' ~ ' + (seg.timeEnd || '') + '</span>' +
          '<span class="fa-seg-badge fa-' + bullClass + '">' + bullLabel + '</span>' +
          '<span class="fa-seg-change fa-' + changeClass + '">' + changeSign + seg.changeP + '%</span>' +
        '</div>' +
        '<div class="fa-seg-body">' +
          '<span class="fa-seg-pattern">' + seg.pattern + '</span>' +
          '<span class="fa-seg-sep">｜</span>' +
          '<span class="fa-seg-vol">' + seg.volume + '</span>' +
          '<span class="fa-seg-sep">｜</span>' +
          '<span class="fa-seg-form">' + seg.lastBar + '</span>' +
        '</div>' +
      '</div>';
    });

    html += '</div>';
    return html;
  },

  // ====== 渲染异动提醒HTML ======
  renderAnomaliesHTML(anomalies) {
    if (!anomalies || anomalies.length === 0) return '';

    let html = '<div class="fa-anomalies">' +
      '<div class="fa-anomaly-title">🔥 异动提醒</div>';

    anomalies.forEach((a, idx) => {
      const isLast = idx === anomalies.length - 1;
      const connector = isLast ? '└' : '├';
      const severityClass = a.severity === 'high' ? 'fa-anomaly-high' : 'fa-anomaly-med';

      html += '<div class="fa-anomaly-item ' + severityClass + '">' +
        '<span class="fa-anomaly-connector">' + connector + '</span>' +
        '<span class="fa-anomaly-time">' + a.time + '</span> ' +
        '<span class="fa-anomaly-label">' + a.label + '</span>' +
        '<span class="fa-anomaly-detail">（' + a.detail + '）</span>' +
      '</div>';
    });

    html += '</div>';
    return html;
  },

  // ====== 渲染分析面板HTML ======
  renderHTML(analysis) {
    if (!analysis) return '';
    const { dailyTrend, recent5, prediction, sr } = analysis;

    const trendClass = dailyTrend.trend === '偏多' ? 'bullish' : dailyTrend.trend === '偏空' ? 'bearish' : 'neutral';
    const predClass = prediction.trend === '偏多' ? 'bullish' : prediction.trend === '偏空' ? 'bearish' : 'neutral';

    return '<div class="futures-analysis">' +
      '<div class="fa-title">📊 技术分析</div>' +
      '<div class="fa-divider"></div>' +
      '<div class="fa-direction">' +
        '<div class="fa-label">📈 日线大方向：<span class="fa-' + trendClass + '">' + dailyTrend.trend + '</span></div>' +
        '<div class="fa-detail">' + dailyTrend.maLine + '</div>' +
        '<div class="fa-detail">' + dailyTrend.macdDir + '</div>' +
      '</div>' +
      '<div class="fa-recent">' +
        '<div class="fa-label">📊 近5根K线：<span class="fa-text">' + recent5.pattern + '</span></div>' +
        '<div class="fa-detail">' + recent5.volume + (recent5.volume ? '，' : '') + (recent5.lastBar || '') + '</div>' +
      '</div>' +
      '<div class="fa-prediction">' +
        '<div class="fa-label">💡 综合预判：<span class="fa-' + predClass + '">' + prediction.mainText + '</span></div>' +
        '<div class="fa-detail">' + prediction.subText + '</div>' +
      '</div>' +
    '</div>';
  },

  // ====== 计算KDJ ======
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

  // ====== 趋势转折检测 ======
  detectTrendReversal(symbol, klines, dailyKlines) {
    const result = { hasReversal: false, type: null, strength: null, conditions: [], dailyContext: '', summary: '', klineIndex: -1 };
    if (!klines || klines.length < 15) return result;

    const len = klines.length;
    const last = len - 1;
    const prev = len - 2;

    // 计算指标
    const ma5 = this.calcMA(klines, 5);
    const ma10 = this.calcMA(klines, 10);
    const macd = this.calcMACD(klines);
    const kdj = this.calcKDJ(klines);

    // ====== 检测各条件 ======
    const bearishConditions = [];
    const bullishConditions = [];

    // 1. MA5 下穿/上穿 MA10
    if (ma5[last] !== null && ma10[last] !== null && ma5[prev] !== null && ma10[prev] !== null) {
      if (ma5[prev] > ma10[prev] && ma5[last] <= ma10[last]) {
        bearishConditions.push('MA5下穿MA10');
      }
      if (ma5[prev] < ma10[prev] && ma5[last] >= ma10[last]) {
        bullishConditions.push('MA5上穿MA10');
      }
    }

    // 2. MACD 死叉/金叉 或 红柱转绿柱/绿柱转红柱
    if (macd.hists.length >= 2) {
      const currHist = macd.hists[last];
      const prevHist = macd.hists[prev];
      const currDif = macd.difs[last];
      const prevDif = macd.difs[prev];
      const currDea = macd.deas[last];
      const prevDea = macd.deas[prev];

      // 死叉：DIF从上方穿过DEA
      if (prevDif > prevDea && currDif <= currDea) {
        bearishConditions.push('MACD死叉');
      } else if (prevHist > 0 && currHist <= 0) {
        bearishConditions.push('MACD红柱转绿');
      }

      // 金叉：DIF从下方穿过DEA
      if (prevDif < prevDea && currDif >= currDea) {
        bullishConditions.push('MACD金叉');
      } else if (prevHist < 0 && currHist >= 0) {
        bullishConditions.push('MACD绿柱转红');
      }
    }

    // 3. 放量阴线/阳线
    if (len >= 2) {
      const c = klines[last];
      const p = klines[prev];
      if (c.volume > p.volume * 1.5 && c.close < c.open) {
        bearishConditions.push('放量阴线');
      }
      if (c.volume > p.volume * 1.5 && c.close > c.open) {
        bullishConditions.push('放量阳线');
      }
    }

    // 4. KDJ 高位死叉/低位金叉
    if (kdj.length >= 2) {
      const currK = kdj[last].k;
      const prevK = kdj[prev].k;
      const currD = kdj[last].d;
      const prevD = kdj[prev].d;

      if (prevK > 80 && prevK > prevD && currK <= currD) {
        bearishConditions.push('KDJ高位死叉');
      }
      if (prevK < 20 && prevK < prevD && currK >= currD) {
        bullishConditions.push('KDJ低位金叉');
      }
    }

    // ====== 至少2个条件才触发 ======
    let type = null, conditions = [];
    if (bearishConditions.length >= 2) {
      type = 'bearish_reversal';
      conditions = bearishConditions;
    } else if (bullishConditions.length >= 2) {
      type = 'bullish_reversal';
      conditions = bullishConditions;
    }

    if (!type) return result;

    // ====== 日线大方向验证 ======
    const dailyTrend = this.analyzeDailyTrend(dailyKlines);
    const dailyContext = '日线' + dailyTrend.trend;
    let contextNote = '';

    if (type === 'bearish_reversal') {
      if (dailyTrend.trend === '偏多') {
        contextNote = '短线回调风险，大方向仍偏多';
      } else if (dailyTrend.trend === '偏空') {
        contextNote = '趋势共振，转折信号更强';
      } else {
        contextNote = '震荡格局中出现空头信号';
      }
    } else {
      if (dailyTrend.trend === '偏空') {
        contextNote = '短线反弹，但大方向偏空，谨慎';
      } else if (dailyTrend.trend === '偏多') {
        contextNote = '趋势共振，转折信号更强';
      } else {
        contextNote = '震荡格局中出现多头信号';
      }
    }

    // 信号强度
    let strength = 'weak';
    if (conditions.length >= 4) strength = 'strong';
    else if (conditions.length >= 3) strength = 'medium';

    // 查品种名
    const nameMap = {};
    const futures = (typeof Store !== 'undefined') ? Store.getFutures() : [];
    futures.forEach(f => { nameMap[f.code] = f.name; });
    const displayName = nameMap[symbol] || symbol;

    const typeLabel = type === 'bearish_reversal' ? '多转空' : '空转多';
    const emoji = type === 'bearish_reversal' ? '🟢▼' : '🔴▲';
    const sr = this.calcSupportResistance(klines);
    const keyLevel = type === 'bearish_reversal' ? '支撑位' + sr.support : '压力位' + sr.resistance;

    const summary = '⚠️ ' + displayName + '：' + conditions.join('+') + '，' + typeLabel + '，' + contextNote;

    return {
      hasReversal: true,
      type,
      strength,
      conditions,
      dailyContext,
      contextNote,
      summary,
      klineIndex: last,
      sr
    };
  }
};
