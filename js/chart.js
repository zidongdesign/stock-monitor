/**
 * 图表渲染模块 - ECharts 封装
 */
const ChartManager = {
  chart: null,

  init(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    this.chart = echarts.init(el);
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    if (this.chart) this.chart.resize();
  },

  dispose() {
    if (this.chart) { this.chart.dispose(); this.chart = null; }
  },

  // ====== 分时图 ======
  renderMinute(data, prevClose) {
    if (!this.chart) return;
    if (!data || data.length === 0) {
      this.chart.setOption({ title: { text: '暂无分时数据', left: 'center', top: 'center', textStyle: { color: '#8b949e', fontSize: 14 } }, xAxis: [], yAxis: [], series: [] }, true);
      return;
    }

    prevClose = prevClose || data[0].price;
    const times = data.map(d => d.time);
    const prices = data.map(d => d.price);
    const volumes = data.map(d => d.volume);

    // 成交量红绿柱（与上一分钟比）
    const volColors = volumes.map((v, i) => {
      if (i === 0) return prices[i] >= prevClose ? '#ef5350' : '#26a69a';
      return prices[i] >= prices[i - 1] ? '#ef5350' : '#26a69a';
    });

    // 均价线
    const avgPrices = [];
    let totalAmt = 0, totalVol = 0;
    data.forEach(d => {
      totalAmt += d.price * d.volume;
      totalVol += d.volume;
      avgPrices.push(totalVol > 0 ? +(totalAmt / totalVol).toFixed(2) : d.price);
    });

    // 分时KDJ（用滑动窗口9分钟的高低价）
    const n = 9;
    const kdjData = [];
    let prevK = 50, prevD = 50;
    for (let i = 0; i < prices.length; i++) {
      const start = Math.max(0, i - n + 1);
      let high = -Infinity, low = Infinity;
      for (let j = start; j <= i; j++) {
        if (prices[j] > high) high = prices[j];
        if (prices[j] < low) low = prices[j];
      }
      const rsv = high === low ? 50 : (prices[i] - low) / (high - low) * 100;
      const k = 2 / 3 * prevK + 1 / 3 * rsv;
      const d = 2 / 3 * prevD + 1 / 3 * k;
      const j2 = 3 * k - 2 * d;
      kdjData.push({ k: +k.toFixed(2), d: +d.toFixed(2), j: +j2.toFixed(2) });
      prevK = k;
      prevD = d;
    }

    const validPrices = prices.filter(p => p > 0 && isFinite(p));
    if (validPrices.length === 0) return;
    const minP = Math.min(...validPrices);
    const maxP = Math.max(...validPrices);
    const maxDiff = Math.max(Math.abs(maxP - prevClose), Math.abs(minP - prevClose), prevClose * 0.001);
    const yMin = +(prevClose - maxDiff * 1.2).toFixed(2);
    const yMax = +(prevClose + maxDiff * 1.2).toFixed(2);

    const opt = {
      animation: false,
      grid: [
        { left: 60, right: 20, top: 30, height: '40%' },
        { left: 60, right: 20, top: '52%', height: '15%' },
        { left: 60, right: 20, top: '72%', height: '18%' }
      ],
      xAxis: [
        { type: 'category', data: times, gridIndex: 0, axisLabel: { fontSize: 10 }, boundaryGap: false },
        { type: 'category', data: times, gridIndex: 1, axisLabel: { show: false }, boundaryGap: false },
        { type: 'category', data: times, gridIndex: 2, axisLabel: { fontSize: 10 }, boundaryGap: false }
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, scale: true, min: yMin, max: yMax, splitNumber: 4, splitLine: { lineStyle: { color: '#1a2a3a' } }, axisLabel: { fontSize: 10, formatter: v => v.toFixed(2) } },
        { type: 'value', gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false } },
        { type: 'value', gridIndex: 2, scale: true, splitLine: { show: false }, axisLabel: { fontSize: 9 } }
      ],
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      series: [
        {
          name: '价格', type: 'line', data: prices, xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { color: '#409EFF', width: 1.5 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(64,158,255,0.3)' },
            { offset: 1, color: 'rgba(64,158,255,0.05)' }
          ])},
          symbol: 'none'
        },
        {
          name: '均价', type: 'line', data: avgPrices, xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { color: '#E6A23C', width: 1 }, symbol: 'none'
        },
        {
          name: '成交量', type: 'bar',
          data: volumes.map((v, i) => ({ value: v, itemStyle: { color: volColors[i], opacity: 0.6 } })),
          xAxisIndex: 1, yAxisIndex: 1
        },
        {
          name: 'K', type: 'line', data: kdjData.map(k => k.k), xAxisIndex: 2, yAxisIndex: 2,
          lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none'
        },
        {
          name: 'D', type: 'line', data: kdjData.map(k => k.d), xAxisIndex: 2, yAxisIndex: 2,
          lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none'
        },
        {
          name: 'J', type: 'line', data: kdjData.map(k => k.j), xAxisIndex: 2, yAxisIndex: 2,
          lineStyle: { width: 1, color: '#F56C6C' }, symbol: 'none'
        }
      ],
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1, 2] }]
    };

    this.chart.setOption(opt, true);
  },

  // ====== 期货5分钟K线图（旧版，保留兼容） ======
  renderFutures5min(klines, signals) {
    if (!this.chart) return;
    if (!klines || klines.length === 0) {
      this.chart.setOption({ title: { text: '暂无5分钟K线数据', left: 'center', top: 'center', textStyle: { color: '#8b949e', fontSize: 14 } }, xAxis: [], yAxis: [], series: [] }, true);
      return;
    }

    // 最多显示最近48根（4小时）
    const data = klines.slice(-48);
    // 重新映射 signal index
    const offset = klines.length - data.length;
    const mappedSignals = (signals || []).filter(s => s.index >= offset).map(s => ({ ...s, index: s.index - offset }));

    const times = data.map(k => k.time.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').substring(0, 5));
    const ohlc = data.map(k => [k.open, k.close, k.low, k.high]);
    const volumes = data.map(k => k.volume);
    const volColors = data.map(k => k.close >= k.open ? '#ef5350' : '#26a69a');

    // MA5 / MA10
    const ma5 = SignalDetector.calcMA(data, 5);
    const ma10 = SignalDetector.calcMA(data, 10);

    // 买卖信号 markPoint
    const buyPts = mappedSignals.filter(s => s.type === 'buy').map(s => ({
      coord: [times[s.index], data[s.index].low],
      value: s.reason
    }));
    const sellPts = mappedSignals.filter(s => s.type === 'sell').map(s => ({
      coord: [times[s.index], data[s.index].high],
      value: s.reason
    }));

    const opt = {
      animation: false,
      grid: [
        { left: 60, right: 20, top: 30, height: '55%' },
        { left: 60, right: 20, top: '72%', height: '18%' }
      ],
      xAxis: [
        { type: 'category', data: times, gridIndex: 0, axisLabel: { fontSize: 10 }, boundaryGap: true },
        { type: 'category', data: times, gridIndex: 1, axisLabel: { fontSize: 10 }, boundaryGap: true }
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, scale: true, splitLine: { lineStyle: { color: '#1a2a3a' } }, axisLabel: { fontSize: 10 } },
        { type: 'value', gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false } }
      ],
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      series: [
        {
          name: 'K线', type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
          itemStyle: { color: '#ef5350', color0: '#26a69a', borderColor: '#ef5350', borderColor0: '#26a69a' },
          markPoint: {
            data: [
              ...buyPts.map(p => ({
                ...p, symbol: 'triangle', symbolSize: 12,
                itemStyle: { color: '#ef5350' },
                label: { show: true, position: 'bottom', formatter: p.value, fontSize: 8, color: '#ef5350' }
              })),
              ...sellPts.map(p => ({
                ...p, symbol: 'triangle', symbolSize: 12, symbolRotate: 180,
                itemStyle: { color: '#26a69a' },
                label: { show: true, position: 'top', formatter: p.value, fontSize: 8, color: '#26a69a' }
              }))
            ]
          }
        },
        { name: 'MA5', type: 'line', data: ma5, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none', smooth: true },
        { name: 'MA10', type: 'line', data: ma10, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none', smooth: true },
        {
          name: '成交量', type: 'bar',
          data: volumes.map((v, i) => ({ value: v, itemStyle: { color: volColors[i] } })),
          xAxisIndex: 1, yAxisIndex: 1
        }
      ],
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }]
    };

    this.chart.setOption(opt, true);
  },

  // ====== 期货多周期K线图（完整布局：K线+MA + 成交量 + KDJ + MACD + 信号） ======
  renderFuturesKline(containerId, klines, signals, periodLabel, reversalSignal) {
    const el = document.getElementById(containerId);
    if (!el) return;
    let chart = echarts.getInstanceByDom(el);
    if (!chart) chart = echarts.init(el);

    if (!klines || klines.length === 0) {
      chart.setOption({
        title: { text: '暂无K线数据', left: 'center', top: 'center', textStyle: { color: '#8b949e', fontSize: 14 } },
        xAxis: [], yAxis: [], series: []
      }, true);
      return chart;
    }

    const dates = klines.map(k => k.date || k.time);
    const ohlc = klines.map(k => [k.open, k.close, k.low, k.high]);
    const volumes = klines.map(k => k.volume);
    const volColors = klines.map(k => k.close >= k.open ? '#ef5350' : '#26a69a');

    const ma5 = SignalDetector.calcMA(klines, 5);
    const ma10 = SignalDetector.calcMA(klines, 10);
    const ma20 = SignalDetector.calcMA(klines, 20);

    // KDJ & MACD
    const kdj = SignalDetector.calcKDJ(klines);
    const macd = SignalDetector.calcMACD(klines);

    // 信号去噪：最多10个，间隔>=3根K线，只显示箭头
    const filteredSignals = this._denoiseSignals(signals, klines);

    const buyPts = filteredSignals.filter(s => s.type === 'buy').map(s => ({
      coord: [dates[s.index], klines[s.index].low],
      value: s.reason
    }));
    const sellPts = filteredSignals.filter(s => s.type === 'sell').map(s => ({
      coord: [dates[s.index], klines[s.index].high],
      value: s.reason
    }));

    chart.setOption({
      animation: false,
      grid: [
        { left: 60, right: 20, top: 30, height: '40%' },   // K线主图
        { left: 60, right: 20, top: '50%', height: '8%' },  // 成交量
        { left: 60, right: 20, top: '61%', height: '14%' }, // KDJ
        { left: 60, right: 20, top: '78%', height: '14%' }  // MACD
      ],
      xAxis: [
        { type: 'category', data: dates, gridIndex: 0, axisLabel: { show: false }, boundaryGap: true },
        { type: 'category', data: dates, gridIndex: 1, axisLabel: { show: false }, boundaryGap: true },
        { type: 'category', data: dates, gridIndex: 2, axisLabel: { show: false }, boundaryGap: true },
        { type: 'category', data: dates, gridIndex: 3, axisLabel: { fontSize: 10 }, boundaryGap: true }
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, scale: true, splitLine: { lineStyle: { color: '#1a2a3a' } }, axisLabel: { fontSize: 10 } },
        { type: 'value', gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false } },
        { type: 'value', gridIndex: 2, min: 0, max: 100, splitLine: { show: false }, axisLabel: { fontSize: 9 } },
        { type: 'value', gridIndex: 3, scale: true, splitLine: { show: false }, axisLabel: { fontSize: 9 } }
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: function(params) {
          if (!params || params.length === 0) return '';
          let tip = params[0].axisValue + '<br/>';
          params.forEach(p => {
            if (p.seriesName === 'K线' && p.data) {
              tip += '开: ' + p.data[0] + ' 收: ' + p.data[1] + '<br/>低: ' + p.data[2] + ' 高: ' + p.data[3] + '<br/>';
            } else if (p.seriesName && p.value != null) {
              tip += p.marker + ' ' + p.seriesName + ': ' + (typeof p.value === 'object' ? p.value.value : p.value) + '<br/>';
            }
          });
          // Show signal info at this index
          const idx = params[0].dataIndex;
          const sig = filteredSignals.find(s => s.index === idx);
          if (sig) {
            tip += '<br/><b style="color:' + (sig.type === 'buy' ? '#ef5350' : '#26a69a') + '">' +
              (sig.type === 'buy' ? '🔺买入' : '🔻卖出') + ': ' + sig.reason + '</b>';
          }
          return tip;
        }
      },
      legend: {
        data: ['MA5', 'MA10', 'MA20'],
        top: 4, right: 20,
        textStyle: { color: '#8b949e', fontSize: 10 },
        itemWidth: 14, itemHeight: 2
      },
      series: [
        // K线主图
        {
          name: 'K线', type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
          itemStyle: { color: '#ef5350', color0: '#26a69a', borderColor: '#ef5350', borderColor0: '#26a69a' },
          markPoint: {
            data: [
              ...buyPts.map(p => ({
                ...p, symbol: 'triangle', symbolSize: 12,
                itemStyle: { color: '#ef5350' },
                label: { show: false }  // 不显示文字，hover时tooltip显示
              })),
              ...sellPts.map(p => ({
                ...p, symbol: 'triangle', symbolSize: 12, symbolRotate: 180,
                itemStyle: { color: '#26a69a' },
                label: { show: false }
              }))
            ],
            tooltip: {
              formatter: function(param) {
                return param.value || '';
              }
            }
          }
        },
        { name: 'MA5', type: 'line', data: ma5, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none', smooth: true },
        { name: 'MA10', type: 'line', data: ma10, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none', smooth: true },
        { name: 'MA20', type: 'line', data: ma20, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#F56C6C' }, symbol: 'none', smooth: true },
        // 成交量
        {
          name: '成交量', type: 'bar',
          data: volumes.map((v, i) => ({ value: v, itemStyle: { color: volColors[i] } })),
          xAxisIndex: 1, yAxisIndex: 1
        },
        // KDJ
        {
          name: 'K', type: 'line', data: kdj.map(k => k.k), xAxisIndex: 2, yAxisIndex: 2,
          lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none'
        },
        {
          name: 'D', type: 'line', data: kdj.map(k => k.d), xAxisIndex: 2, yAxisIndex: 2,
          lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none',
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { type: 'dashed', color: '#333', width: 1 },
            data: [{ yAxis: 20 }, { yAxis: 80 }],
            label: { show: false }
          }
        },
        {
          name: 'J', type: 'line', data: kdj.map(k => k.j), xAxisIndex: 2, yAxisIndex: 2,
          lineStyle: { width: 1, color: '#ab47bc' }, symbol: 'none'
        },
        // MACD
        {
          name: 'DIF', type: 'line', data: macd.map(m => m.dif), xAxisIndex: 3, yAxisIndex: 3,
          lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none'
        },
        {
          name: 'DEA', type: 'line', data: macd.map(m => m.dea), xAxisIndex: 3, yAxisIndex: 3,
          lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none',
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { type: 'dashed', color: '#333', width: 1 },
            data: [{ yAxis: 0 }],
            label: { show: false }
          }
        },
        {
          name: 'MACD', type: 'bar',
          data: macd.map(m => ({ value: m.hist, itemStyle: { color: m.hist >= 0 ? '#ef5350' : '#26a69a' } })),
          xAxisIndex: 3, yAxisIndex: 3
        }
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1, 2, 3], start: Math.max(0, (klines.length - 30) / klines.length * 100), end: 100 }
      ]
    }, true);

    return chart;
  },

  // ====== 信号去噪：最多10个、间隔>=3根K线 ======
  _denoiseSignals(signals, klines) {
    if (!signals || signals.length === 0) return [];
    // Sort by index descending (latest first)
    const sorted = signals.slice().sort((a, b) => b.index - a.index);
    const result = [];
    let lastIdx = Infinity;

    for (const s of sorted) {
      if (result.length >= 10) break;
      // Ensure at least 3 K-lines gap from last kept signal
      if (Math.abs(lastIdx - s.index) < 3) continue;
      result.push(s);
      lastIdx = s.index;
    }
    return result;
  },

  // ====== 迷你分时图（极简） ======
  renderMiniMinute(containerId, data, prevClose) {
    const el = document.getElementById(containerId);
    if (!el || !data || data.length === 0) return;
    let chart = echarts.getInstanceByDom(el);
    if (!chart) chart = echarts.init(el);
    
    prevClose = prevClose || data[0].price;
    const prices = data.map(d => d.price);
    const lineColor = prices[prices.length - 1] >= prevClose ? '#ef5350' : '#26a69a';
    const areaColor = prices[prices.length - 1] >= prevClose
      ? 'rgba(239,83,80,0.15)' : 'rgba(38,166,154,0.15)';

    chart.setOption({
      animation: false,
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: 'category', show: false, data: data.map(d => d.time) },
      yAxis: { type: 'value', show: false, scale: true },
      tooltip: { show: false },
      series: [{
        type: 'line', data: prices, symbol: 'none',
        lineStyle: { color: lineColor, width: 1.5 },
        areaStyle: { color: areaColor }
      }]
    }, true);
  },

  // ====== 指数K线图（含MA均线 + KDJ + MACD） ======
  renderIndexKline(containerId, klines, period) {
    const el = document.getElementById(containerId);
    if (!el) return;
    let chart = echarts.getInstanceByDom(el);
    if (!chart) chart = echarts.init(el);

    if (!klines || klines.length === 0) {
      chart.setOption({
        title: { text: '暂无K线数据', left: 'center', top: 'center', textStyle: { color: '#8b949e', fontSize: 14 } },
        xAxis: [], yAxis: [], series: []
      }, true);
      return chart;
    }

    const dates = klines.map(k => k.date);
    const ohlc = klines.map(k => [k.open, k.close, k.low, k.high]);
    const volumes = klines.map(k => k.volume);
    const volColors = klines.map(k => k.close >= k.open ? '#ef5350' : '#26a69a');

    const ma5 = SignalDetector.calcMA(klines, 5);
    const ma10 = SignalDetector.calcMA(klines, 10);
    const ma20 = SignalDetector.calcMA(klines, 20);

    // KDJ 计算
    const kdj = SignalDetector.calcKDJ(klines);
    // MACD 计算
    const macd = SignalDetector.calcMACD(klines);

    // 布局：K线50% + 成交量10% + KDJ 15% + MACD 15% + 间距10%
    chart.setOption({
      animation: false,
      grid: [
        { left: 60, right: 20, top: 30, height: '48%' },   // grid0: K线主图
        { left: 60, right: 20, top: '56%', height: '8%' },  // grid1: 成交量
        { left: 60, right: 20, top: '67%', height: '14%' }, // grid2: KDJ
        { left: 60, right: 20, top: '84%', height: '14%' }  // grid3: MACD
      ],
      xAxis: [
        { type: 'category', data: dates, gridIndex: 0, axisLabel: { show: false }, boundaryGap: true },
        { type: 'category', data: dates, gridIndex: 1, axisLabel: { show: false }, boundaryGap: true },
        { type: 'category', data: dates, gridIndex: 2, axisLabel: { show: false }, boundaryGap: true },
        { type: 'category', data: dates, gridIndex: 3, axisLabel: { fontSize: 10 }, boundaryGap: true }
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, scale: true, splitLine: { lineStyle: { color: '#1a2a3a' } }, axisLabel: { fontSize: 10 } },
        { type: 'value', gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false } },
        { type: 'value', gridIndex: 2, min: 0, max: 100, splitLine: { show: false }, axisLabel: { fontSize: 9 } },
        { type: 'value', gridIndex: 3, scale: true, splitLine: { show: false }, axisLabel: { fontSize: 9 } }
      ],
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: {
        data: ['MA5', 'MA10', 'MA20'],
        top: 4, right: 20,
        textStyle: { color: '#8b949e', fontSize: 10 },
        itemWidth: 14, itemHeight: 2
      },
      series: [
        // K线主图
        {
          name: 'K线', type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
          itemStyle: { color: '#ef5350', color0: '#26a69a', borderColor: '#ef5350', borderColor0: '#26a69a' }
        },
        { name: 'MA5', type: 'line', data: ma5, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none', smooth: true },
        { name: 'MA10', type: 'line', data: ma10, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none', smooth: true },
        { name: 'MA20', type: 'line', data: ma20, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#F56C6C' }, symbol: 'none', smooth: true },
        // 成交量
        {
          name: '成交量', type: 'bar',
          data: volumes.map((v, i) => ({ value: v, itemStyle: { color: volColors[i] } })),
          xAxisIndex: 1, yAxisIndex: 1
        },
        // KDJ
        {
          name: 'K', type: 'line', data: kdj.map(k => k.k), xAxisIndex: 2, yAxisIndex: 2,
          lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none'
        },
        {
          name: 'D', type: 'line', data: kdj.map(k => k.d), xAxisIndex: 2, yAxisIndex: 2,
          lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none',
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { type: 'dashed', color: '#333', width: 1 },
            data: [{ yAxis: 20 }, { yAxis: 80 }],
            label: { show: false }
          }
        },
        {
          name: 'J', type: 'line', data: kdj.map(k => k.j), xAxisIndex: 2, yAxisIndex: 2,
          lineStyle: { width: 1, color: '#ab47bc' }, symbol: 'none'
        },
        // MACD
        {
          name: 'DIF', type: 'line', data: macd.map(m => m.dif), xAxisIndex: 3, yAxisIndex: 3,
          lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none'
        },
        {
          name: 'DEA', type: 'line', data: macd.map(m => m.dea), xAxisIndex: 3, yAxisIndex: 3,
          lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none',
          markLine: {
            silent: true, symbol: 'none',
            lineStyle: { type: 'dashed', color: '#333', width: 1 },
            data: [{ yAxis: 0 }],
            label: { show: false }
          }
        },
        {
          name: 'MACD', type: 'bar',
          data: macd.map(m => ({ value: m.hist, itemStyle: { color: m.hist >= 0 ? '#ef5350' : '#26a69a' } })),
          xAxisIndex: 3, yAxisIndex: 3
        }
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1, 2, 3], start: 50, end: 100 }
      ]
    }, true);

    return chart;
  },

  // ====== K线图 ======
  renderKline(klines, klineSignals, settings) {
    if (!this.chart) return;
    if (!klines || klines.length === 0) {
      this.chart.setOption({ title: { text: '暂无K线数据', left: 'center', top: 'center', textStyle: { color: '#8b949e', fontSize: 14 } }, xAxis: [], yAxis: [], series: [] }, true);
      return;
    }

    settings = settings || {};
    const dates = klines.map(k => k.date);
    const ohlc = klines.map(k => [k.open, k.close, k.low, k.high]);
    const volumes = klines.map(k => k.volume);
    const volColors = klines.map(k => k.close >= k.open ? '#ef5350' : '#26a69a');

    const ma5 = SignalDetector.calcMA(klines, 5);
    const ma10 = SignalDetector.calcMA(klines, 10);
    const ma20 = SignalDetector.calcMA(klines, 20);

    // 信号标记
    const buyPts = (klineSignals || []).filter(s => s.type === 'buy').map(s => ({
      coord: [s.date, klines[s.index].low],
      value: s.reason
    }));
    const sellPts = (klineSignals || []).filter(s => s.type === 'sell' || s.type === 'warn').map(s => ({
      coord: [s.date, klines[s.index].high],
      value: s.reason
    }));

    // 计算子图数量
    const subCharts = [];
    let gridCount = 2; // 主图 + 成交量
    const gridSpecs = [
      { left: 60, right: 20, top: 30, height: '45%' },
      { left: 60, right: 20, top: '58%', height: '12%' }
    ];

    const series = [
      {
        name: 'K线', type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
        itemStyle: { color: '#ef5350', color0: '#26a69a', borderColor: '#ef5350', borderColor0: '#26a69a' },
        markPoint: {
          data: [
            ...buyPts.map(p => ({ ...p, symbol: 'arrow', symbolSize: 10, itemStyle: { color: '#ef5350' }, label: { show: true, position: 'bottom', formatter: p.value, fontSize: 8, color: '#ef5350' } })),
            ...sellPts.map(p => ({ ...p, symbol: 'arrow', symbolSize: 10, symbolRotate: 180, itemStyle: { color: '#26a69a' }, label: { show: true, position: 'top', formatter: p.value, fontSize: 8, color: '#26a69a' } }))
          ]
        }
      },
      { name: 'MA5', type: 'line', data: ma5, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none', smooth: true },
      { name: 'MA10', type: 'line', data: ma10, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none', smooth: true },
      { name: 'MA20', type: 'line', data: ma20, xAxisIndex: 0, yAxisIndex: 0, lineStyle: { width: 1, color: '#F56C6C' }, symbol: 'none', smooth: true },
      {
        name: '成交量', type: 'bar',
        data: volumes.map((v, i) => ({ value: v, itemStyle: { color: volColors[i] } })),
        xAxisIndex: 1, yAxisIndex: 1
      }
    ];

    const xAxes = [
      { type: 'category', data: dates, gridIndex: 0, axisLabel: { fontSize: 10 }, boundaryGap: true },
      { type: 'category', data: dates, gridIndex: 1, axisLabel: { fontSize: 10 }, boundaryGap: true }
    ];
    const yAxes = [
      { type: 'value', gridIndex: 0, scale: true, splitLine: { lineStyle: { color: '#1a2a3a' } }, axisLabel: { fontSize: 10 } },
      { type: 'value', gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false } }
    ];

    // MACD 子图
    if (settings.macd) {
      const macd = SignalDetector.calcMACD(klines);
      const gi = gridCount;
      gridSpecs.push({ left: 60, right: 20, top: (72 + (gi - 2) * 14) + '%', height: '10%' });
      xAxes.push({ type: 'category', data: dates, gridIndex: gi, axisLabel: { show: false }, boundaryGap: true });
      yAxes.push({ type: 'value', gridIndex: gi, scale: true, splitLine: { show: false }, axisLabel: { show: false } });
      series.push(
        { name: 'DIF', type: 'line', data: macd.map(m => m.dif), xAxisIndex: gi, yAxisIndex: gi, lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none' },
        { name: 'DEA', type: 'line', data: macd.map(m => m.dea), xAxisIndex: gi, yAxisIndex: gi, lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none' },
        { name: 'MACD', type: 'bar', data: macd.map(m => ({ value: m.hist, itemStyle: { color: m.hist >= 0 ? '#ef5350' : '#26a69a' } })), xAxisIndex: gi, yAxisIndex: gi }
      );
      gridCount++;
    }

    // KDJ 子图
    if (settings.kdj) {
      const kdj = SignalDetector.calcKDJ(klines);
      const gi = gridCount;
      gridSpecs.push({ left: 60, right: 20, top: (72 + (gi - 2) * 14) + '%', height: '10%' });
      xAxes.push({ type: 'category', data: dates, gridIndex: gi, axisLabel: { show: false }, boundaryGap: true });
      yAxes.push({ type: 'value', gridIndex: gi, scale: true, splitLine: { show: false }, axisLabel: { show: false } });
      series.push(
        { name: 'K', type: 'line', data: kdj.map(k => k.k), xAxisIndex: gi, yAxisIndex: gi, lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none' },
        { name: 'D', type: 'line', data: kdj.map(k => k.d), xAxisIndex: gi, yAxisIndex: gi, lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none' },
        { name: 'J', type: 'line', data: kdj.map(k => k.j), xAxisIndex: gi, yAxisIndex: gi, lineStyle: { width: 1, color: '#F56C6C' }, symbol: 'none' }
      );
      gridCount++;
    }

    // 动态调整主图高度
    const mainHeight = 45 - (gridCount - 2) * 5;
    gridSpecs[0].height = mainHeight + '%';

    const allXAxisIdx = [];
    for (let i = 0; i < gridCount; i++) allXAxisIdx.push(i);

    this.chart.setOption({
      animation: false,
      grid: gridSpecs,
      xAxis: xAxes,
      yAxis: yAxes,
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      series,
      dataZoom: [
        { type: 'inside', xAxisIndex: allXAxisIdx, start: 60, end: 100 },
        { type: 'slider', xAxisIndex: allXAxisIdx, start: 60, end: 100, height: 20, bottom: 5 }
      ]
    }, true);
  }
};
