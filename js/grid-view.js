/**
 * 多股同列视图模块
 * 2列网格布局，懒加载迷你分时/日K图
 */
const GridView = {
  charts: [],
  observer: null,
  mode: 'minute',  // minute | daily
  container: null,
  _loadQueue: [],
  _loading: 0,
  _maxConcurrent: 4,

  render(stocks, stockData) {
    this.dispose();

    const wrapper = document.getElementById('grid-view-container');
    if (!wrapper) return;
    wrapper.innerHTML = '';
    wrapper.style.display = 'flex';

    // 模式切换栏
    const toolbar = document.createElement('div');
    toolbar.className = 'grid-mode-bar';
    toolbar.innerHTML =
      '<button class="grid-mode-btn' + (this.mode === 'minute' ? ' active' : '') + '" data-mode="minute">分时</button>' +
      '<button class="grid-mode-btn' + (this.mode === 'daily' ? ' active' : '') + '" data-mode="daily">日K</button>';
    toolbar.querySelectorAll('.grid-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === this.mode) return;
        this.mode = btn.dataset.mode;
        toolbar.querySelectorAll('.grid-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === this.mode));
        this.render(stocks, App.stockData);
      });
    });
    wrapper.appendChild(toolbar);

    // 网格容器
    const grid = document.createElement('div');
    grid.className = 'grid-view';
    wrapper.appendChild(grid);
    this.container = grid;

    if (!stocks || stocks.length === 0) {
      grid.innerHTML = '<div class="empty-hint" style="grid-column:1/-1">暂无股票</div>';
      return;
    }

    stocks.forEach(code => {
      const d = stockData[code];
      const cls = d ? (d.changePercent > 0 ? 'up' : d.changePercent < 0 ? 'down' : '') : '';
      const item = document.createElement('div');
      item.className = 'grid-item';
      item.dataset.code = code;
      item.innerHTML =
        '<div class="grid-header">' +
          '<span class="grid-name">' + (d?.name || code) + '</span>' +
          '<span class="grid-price ' + cls + '">' + (d && d.price ? d.price.toFixed(2) : '--') + '</span>' +
          '<span class="grid-change ' + cls + '">' + (d && !isNaN(d.changePercent) ? ((d.changePercent > 0 ? '+' : '') + d.changePercent.toFixed(2) + '%') : '--') + '</span>' +
        '</div>' +
        '<div class="grid-chart"></div>';

      item.addEventListener('click', () => {
        App.switchToListView(code);
      });

      grid.appendChild(item);
    });

    // 直接加载所有迷你图（不用 IntersectionObserver，避免手机上不触发）
    grid.querySelectorAll('.grid-item').forEach(item => {
      const code = item.dataset.code;
      this._enqueueLoad(item, code);
    });
  },

  _enqueueLoad(el, code) {
    this._loadQueue.push({ el, code });
    this._processQueue();
  },

  _processQueue() {
    while (this._loading < this._maxConcurrent && this._loadQueue.length > 0) {
      const task = this._loadQueue.shift();
      this._loading++;
      this._loadAndRender(task.el, task.code).finally(() => {
        this._loading--;
        this._processQueue();
      });
    }
  },

  async _loadAndRender(el, code) {
    const chartEl = el.querySelector('.grid-chart');
    if (!chartEl) return;

    try {
      if (this.mode === 'minute') {
        const data = await StockAPI.fetchMinute(code);
        const prevClose = App.stockData[code]?.prevClose;
        if (!data || data.length === 0) return;
        this.renderMiniMinute(chartEl, code, data, prevClose);
      } else {
        const klines = await StockAPI.fetchDailyKline(code, 30);
        if (!klines || klines.length === 0) return;
        this.renderMiniDaily(chartEl, code, klines);
      }
    } catch (e) {
      console.error('Grid chart error:', code, e);
    }
  },

  renderMiniMinute(container, code, data, prevClose) {
    if (!data || data.length === 0) return;

    const chart = echarts.init(container);
    this.charts.push(chart);

    prevClose = prevClose || data[0].price;

    // 生成完整交易时间轴 9:30-11:30 + 13:00-15:00（每分钟）
    const fullTimes = [];
    for (let h = 9; h <= 15; h++) {
      const mStart = (h === 9) ? 30 : 0;
      const mEnd = 59;
      for (let m = mStart; m <= mEnd; m++) {
        const t = (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
        // 跳过午休 11:31-12:59
        if (h === 11 && m > 30) continue;
        if (h === 12) continue;
        if (h === 15 && m > 0) continue;
        fullTimes.push(t);
      }
    }

    // 把数据映射到完整时间轴
    const dataMap = {};
    let totalAmt = 0, totalVol = 0;
    data.forEach(d => {
      dataMap[d.time] = d;
      totalAmt += d.price * d.volume;
      totalVol += d.volume;
      dataMap[d.time]._avg = totalVol > 0 ? +(totalAmt / totalVol).toFixed(2) : d.price;
    });

    const prices = fullTimes.map(t => dataMap[t] ? dataMap[t].price : null);
    const avgPrices = fullTimes.map(t => dataMap[t] ? dataMap[t]._avg : null);

    const validPrices = prices.filter(p => p !== null && p > 0 && isFinite(p));
    if (validPrices.length === 0) return;
    const minP = Math.min(...validPrices);
    const maxP = Math.max(...validPrices);
    const maxDiff = Math.max(Math.abs(maxP - prevClose), Math.abs(minP - prevClose), prevClose * 0.001);
    const yMin = +(prevClose - maxDiff * 1.2).toFixed(4);
    const yMax = +(prevClose + maxDiff * 1.2).toFixed(4);

    // 异动信号检测（放量 + 急拉急跌，不含资金流向）
    const signals = this._detectMiniSignals(data, dataMap, fullTimes, prevClose);
    // 只取最重要的 2 个
    const topSignals = signals.sort((a, b) => b.priority - a.priority).slice(0, 2);
    const buyPoints = topSignals.filter(s => s.type === 'buy').map(s => ({
      coord: [s.time, s.price],
      symbol: 'triangle', symbolSize: 8, symbolOffset: [0, 6],
      itemStyle: { color: '#ef5350' }, label: { show: false }
    }));
    const sellPoints = topSignals.filter(s => s.type === 'sell').map(s => ({
      coord: [s.time, s.price],
      symbol: 'triangle', symbolSize: 8, symbolRotate: 180, symbolOffset: [0, -6],
      itemStyle: { color: '#26a69a' }, label: { show: false }
    }));

    chart.setOption({
      animation: false,
      grid: { left: 0, right: 0, top: 0, bottom: 0 },
      xAxis: { type: 'category', show: false, data: fullTimes, boundaryGap: false },
      yAxis: { type: 'value', show: false, scale: true, min: yMin, max: yMax },
      series: [
        {
          type: 'line', data: prices,
          lineStyle: { width: 1, color: '#4e9fff' },
          showSymbol: false,
          connectNulls: false,
          areaStyle: { color: 'rgba(78,159,255,0.08)' },
          markPoint: (buyPoints.length + sellPoints.length > 0) ? { data: [...buyPoints, ...sellPoints] } : undefined
        },
        {
          type: 'line', data: avgPrices,
          lineStyle: { width: 1, color: '#E6A23C' },
          showSymbol: false,
          connectNulls: false
        },
        {
          // 昨收基准线（全天）
          type: 'line',
          data: fullTimes.map(() => prevClose),
          lineStyle: { width: 0.5, color: '#8b949e', type: 'dashed' },
          showSymbol: false,
          silent: true
        }
      ]
    }, true);
  },

  // 迷你分时图异动检测（不含资金流向）
  _detectMiniSignals(data, dataMap, fullTimes, prevClose) {
    const signals = [];
    const signalMap = {};

    const ordered = [];
    fullTimes.forEach(t => {
      if (dataMap[t]) ordered.push({ time: t, ...dataMap[t] });
    });

    for (let i = 1; i < ordered.length; i++) {
      const cur = ordered[i];
      const prev = ordered[i - 1];
      const t = cur.time;

      // 放量异动
      if (i >= 2) {
        const lookback = ordered.slice(Math.max(0, i - 10), i);
        const avgVol = lookback.reduce((s, d) => s + d.volume, 0) / lookback.length;
        if (avgVol > 0 && cur.volume > avgVol * 3) {
          const type = cur.price >= prev.price ? 'buy' : 'sell';
          if (!signalMap[t] || signalMap[t].priority < 2) {
            signalMap[t] = { time: t, type, priority: 2, reason: '放量', price: cur.price };
          }
        }
      }

      // 急拉/急跌
      if (prev.price > 0) {
        const chg = (cur.price - prev.price) / prev.price;
        if (Math.abs(chg) > 0.008) {
          const type = chg > 0 ? 'buy' : 'sell';
          if (!signalMap[t] || signalMap[t].priority < 3) {
            signalMap[t] = { time: t, type, priority: 3, reason: chg > 0 ? '急拉' : '急跌', price: cur.price };
          }
        }
      }
    }

    return Object.values(signalMap);
  },

  renderMiniDaily(container, code, klines) {
    if (!klines || klines.length === 0) return;

    const chart = echarts.init(container);
    this.charts.push(chart);

    const recent = klines.slice(-30);
    const dates = recent.map(k => k.date);
    const ohlc = recent.map(k => [k.open, k.close, k.low, k.high]);

    chart.setOption({
      animation: false,
      grid: { left: 0, right: 0, top: 0, bottom: 0 },
      xAxis: { type: 'category', show: false, data: dates },
      yAxis: { type: 'value', show: false, scale: true },
      series: [{
        type: 'candlestick',
        data: ohlc,
        itemStyle: {
          color: '#ef5350',
          color0: '#26a69a',
          borderColor: '#ef5350',
          borderColor0: '#26a69a'
        },
        barWidth: '60%'
      }]
    }, true);
  },

  dispose() {
    this.charts.forEach(c => {
      try { c.dispose(); } catch (e) { /* ignore */ }
    });
    this.charts = [];
    this._loadQueue = [];
    this._loading = 0;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    const wrapper = document.getElementById('grid-view-container');
    if (wrapper) {
      wrapper.innerHTML = '';
      wrapper.style.display = 'none';
    }
  }
};
