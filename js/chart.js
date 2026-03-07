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
