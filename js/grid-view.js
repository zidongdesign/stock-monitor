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

    // IntersectionObserver 懒加载
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const code = entry.target.dataset.code;
          this._enqueueLoad(entry.target, code);
          this.observer.unobserve(entry.target);
        }
      });
    }, { root: grid, rootMargin: '200px' });

    grid.querySelectorAll('.grid-item').forEach(item => {
      this.observer.observe(item);
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
        this.renderMiniMinute(chartEl, code, data, prevClose);
      } else {
        const klines = await StockAPI.fetchDailyKline(code, 30);
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
    const times = data.map(d => d.time);
    const prices = data.map(d => d.price);

    // 均价线
    const avgPrices = [];
    let totalAmt = 0, totalVol = 0;
    data.forEach(d => {
      totalAmt += d.price * d.volume;
      totalVol += d.volume;
      avgPrices.push(totalVol > 0 ? +(totalAmt / totalVol).toFixed(2) : d.price);
    });

    const validPrices = prices.filter(p => p > 0 && isFinite(p));
    if (validPrices.length === 0) return;
    const minP = Math.min(...validPrices);
    const maxP = Math.max(...validPrices);
    const maxDiff = Math.max(Math.abs(maxP - prevClose), Math.abs(minP - prevClose), prevClose * 0.001);
    const yMin = +(prevClose - maxDiff * 1.2).toFixed(4);
    const yMax = +(prevClose + maxDiff * 1.2).toFixed(4);

    chart.setOption({
      animation: false,
      grid: { left: 0, right: 0, top: 0, bottom: 0 },
      xAxis: { type: 'category', show: false, data: times, boundaryGap: false },
      yAxis: { type: 'value', show: false, scale: true, min: yMin, max: yMax },
      series: [
        {
          type: 'line', data: prices,
          lineStyle: { width: 1, color: '#4e9fff' },
          showSymbol: false,
          areaStyle: { color: 'rgba(78,159,255,0.08)' }
        },
        {
          type: 'line', data: avgPrices,
          lineStyle: { width: 1, color: '#E6A23C' },
          showSymbol: false
        }
      ],
      graphic: prevClose ? [{
        type: 'line',
        shape: {
          x1: 0,
          y1: chart.convertToPixel({ yAxisIndex: 0 }, prevClose) || 0,
          x2: container.clientWidth,
          y2: chart.convertToPixel({ yAxisIndex: 0 }, prevClose) || 0
        },
        style: { stroke: '#8b949e', lineDash: [3, 3], lineWidth: 0.5 },
        silent: true
      }] : []
    }, true);
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
