/**
 * A股实时监控 - 主逻辑
 */

const App = {
  // 状态
  stocks: [],           // 监控的股票代码列表
  stockData: {},        // 实时数据 { code: {...} }
  currentStock: null,   // 当前查看的股票
  currentView: 'daily', // daily | minute | weekly
  chart: null,          // ECharts 实例
  refreshTimer: null,
  alertStocks: [],      // 有异动信号的股票

  // 默认监控列表
  defaultStocks: ['sz000009', 'sh603659', 'sh600519', 'sz000858', 'sz300750'],

  init() {
    // 从 localStorage 恢复
    const saved = localStorage.getItem('stock_monitor_list');
    this.stocks = saved ? JSON.parse(saved) : [...this.defaultStocks];
    
    this.chart = echarts.init(document.getElementById('chart-container'));
    window.addEventListener('resize', () => this.chart.resize());
    
    this.bindEvents();
    this.renderStockList();
    this.refresh();
    this.startAutoRefresh();
    
    // 默认选中第一只
    if (this.stocks.length > 0) {
      this.selectStock(this.stocks[0]);
    }
  },

  bindEvents() {
    // 添加股票
    document.getElementById('btn-add').addEventListener('click', () => {
      this.showAddDialog();
    });

    // 视图切换
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.currentView = e.target.dataset.view;
        if (this.currentStock) {
          this.loadChart(this.currentStock);
        }
      });
    });

    // 手动刷新
    document.getElementById('btn-refresh').addEventListener('click', () => {
      this.refresh();
    });
  },

  // 保存股票列表
  saveStocks() {
    localStorage.setItem('stock_monitor_list', JSON.stringify(this.stocks));
  },

  // 添加股票
  showAddDialog() {
    const input = prompt('输入股票代码（如 sz000009 或 sh600519）：');
    if (!input) return;
    
    const code = input.trim().toLowerCase();
    if (!/^(sz|sh)\d{6}$/.test(code)) {
      alert('格式错误！请输入 sz 或 sh + 6位数字');
      return;
    }
    
    if (this.stocks.includes(code)) {
      alert('已在监控列表中');
      return;
    }
    
    this.stocks.push(code);
    this.saveStocks();
    this.renderStockList();
    this.refresh();
  },

  // 删除股票
  removeStock(code) {
    this.stocks = this.stocks.filter(c => c !== code);
    this.saveStocks();
    if (this.currentStock === code) {
      this.currentStock = this.stocks[0] || null;
    }
    this.renderStockList();
    if (this.currentStock) {
      this.loadChart(this.currentStock);
    }
  },

  // 渲染股票列表
  renderStockList() {
    const list = document.getElementById('stock-list');
    list.innerHTML = '';
    
    this.stocks.forEach(code => {
      const data = this.stockData[code];
      const signals = data ? SignalDetector.detectRealtime(data) : [];
      const hasSignal = signals.length > 0;
      const isActive = code === this.currentStock;
      
      const item = document.createElement('div');
      item.className = `stock-item ${isActive ? 'active' : ''} ${hasSignal ? 'has-signal' : ''}`;
      item.onclick = () => this.selectStock(code);
      
      const changeClass = data ? (data.changePercent > 0 ? 'up' : data.changePercent < 0 ? 'down' : '') : '';
      
      item.innerHTML = `
        <div class="stock-item-header">
          <span class="stock-name">${data?.name || code}</span>
          <span class="stock-remove" onclick="event.stopPropagation(); App.removeStock('${code}')">×</span>
        </div>
        <div class="stock-item-body">
          <span class="stock-price ${changeClass}">${data ? data.price.toFixed(2) : '--'}</span>
          <span class="stock-change ${changeClass}">${data ? (data.changePercent > 0 ? '+' : '') + data.changePercent.toFixed(2) + '%' : '--'}</span>
        </div>
        ${hasSignal ? `<div class="stock-signals">${signals.map(s => `<span class="signal signal-${s.type}">${s.reason}</span>`).join('')}</div>` : ''}
      `;
      
      list.appendChild(item);
    });
  },

  // 渲染异动栏
  renderAlertBar() {
    const bar = document.getElementById('alert-bar');
    const alerts = [];
    
    this.stocks.forEach(code => {
      const data = this.stockData[code];
      if (!data) return;
      const signals = SignalDetector.detectRealtime(data);
      if (signals.length > 0) {
        alerts.push({ code, name: data.name, signals });
      }
    });
    
    if (alerts.length === 0) {
      bar.innerHTML = '<span class="alert-none">暂无异动</span>';
      return;
    }
    
    bar.innerHTML = alerts.map(a => 
      `<span class="alert-item" onclick="App.selectStock('${a.code}')">
        🔴 ${a.name} ${a.signals.map(s => s.reason).join(' ')}
      </span>`
    ).join(' | ');
  },

  // 选择股票
  selectStock(code) {
    this.currentStock = code;
    this.renderStockList();
    this.loadChart(code);
    this.updateStockInfo(code);
  },

  // 更新右侧股票信息
  updateStockInfo(code) {
    const data = this.stockData[code];
    const info = document.getElementById('stock-info');
    if (!data) {
      info.innerHTML = '<p>加载中...</p>';
      return;
    }
    
    const changeClass = data.changePercent > 0 ? 'up' : data.changePercent < 0 ? 'down' : '';
    
    info.innerHTML = `
      <div class="info-header">
        <h2>${data.name} <small>${code}</small></h2>
        <div class="info-price ${changeClass}">
          <span class="big-price">${data.price.toFixed(2)}</span>
          <span>${data.changePercent > 0 ? '+' : ''}${data.changePercent.toFixed(2)}%</span>
          <span>${data.change > 0 ? '+' : ''}${data.change.toFixed(2)}</span>
        </div>
      </div>
      <div class="info-grid">
        <div class="info-item"><label>今开</label><span>${data.open.toFixed(2)}</span></div>
        <div class="info-item"><label>昨收</label><span>${data.prevClose.toFixed(2)}</span></div>
        <div class="info-item"><label>最高</label><span class="up">${data.high.toFixed(2)}</span></div>
        <div class="info-item"><label>最低</label><span class="down">${data.low.toFixed(2)}</span></div>
        <div class="info-item"><label>量比</label><span>${data.volumeRatio.toFixed(2)}</span></div>
        <div class="info-item"><label>换手</label><span>${data.turnover.toFixed(2)}%</span></div>
        <div class="info-item"><label>成交量</label><span>${(data.volume / 10000).toFixed(0)}万手</span></div>
        <div class="info-item"><label>成交额</label><span>${(data.amount / 100000000).toFixed(2)}亿</span></div>
      </div>
    `;
  },

  // 加载图表
  async loadChart(code) {
    document.getElementById('chart-container').classList.add('loading');
    
    try {
      if (this.currentView === 'minute') {
        await this.loadMinuteChart(code);
      } else if (this.currentView === 'weekly') {
        await this.loadKlineChart(code, 'weekly');
      } else {
        await this.loadKlineChart(code, 'daily');
      }
    } catch (e) {
      console.error('Chart load error:', e);
    }
    
    document.getElementById('chart-container').classList.remove('loading');
  },

  // 分时图
  async loadMinuteChart(code) {
    const data = await StockAPI.fetchMinute(code);
    if (!data || data.length === 0) {
      this.chart.setOption({ title: { text: '暂无分时数据' }, series: [] });
      return;
    }
    
    const stockInfo = this.stockData[code];
    const prevClose = stockInfo?.prevClose || data[0].price;
    
    const times = data.map(d => d.time);
    const prices = data.map(d => d.price);
    const volumes = data.map(d => d.volume);
    
    // 计算均价线
    const avgPrices = [];
    let totalAmount = 0, totalVol = 0;
    data.forEach(d => {
      totalAmount += d.price * d.volume;
      totalVol += d.volume;
      avgPrices.push(totalVol > 0 ? parseFloat((totalAmount / totalVol).toFixed(2)) : d.price);
    });

    // 计算Y轴范围
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const maxDiff = Math.max(Math.abs(maxPrice - prevClose), Math.abs(minPrice - prevClose), 0.01);
    const yMin = parseFloat((prevClose - maxDiff * 1.1).toFixed(2));
    const yMax = parseFloat((prevClose + maxDiff * 1.1).toFixed(2));

    const option = {
      animation: false,
      grid: [
        { left: 60, right: 20, top: 30, height: '55%' },
        { left: 60, right: 20, top: '72%', height: '20%' }
      ],
      xAxis: [
        { type: 'category', data: times, gridIndex: 0, axisLabel: { fontSize: 10 }, boundaryGap: false },
        { type: 'category', data: times, gridIndex: 1, axisLabel: { fontSize: 10 }, boundaryGap: false }
      ],
      yAxis: [
        { 
          type: 'value', gridIndex: 0, 
          min: yMin,
          max: yMax,
          splitLine: { lineStyle: { color: '#1a2a3a' } },
          axisLabel: { fontSize: 10 }
        },
        { type: 'value', gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false } }
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter(params) {
          if (!params[0]) return '';
          let s = `${params[0].axisValue}<br>`;
          params.forEach(p => {
            s += `${p.seriesName}: ${typeof p.value === 'number' ? p.value.toFixed(2) : p.value}<br>`;
          });
          return s;
        }
      },
      series: [
        {
          name: '价格', type: 'line', data: prices, xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { color: '#409EFF', width: 1.5 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(64,158,255,0.3)' },
            { offset: 1, color: 'rgba(64,158,255,0.05)' }
          ])},
          symbol: 'none', smooth: false
        },
        {
          name: '均价', type: 'line', data: avgPrices, xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { color: '#E6A23C', width: 1 },
          symbol: 'none', smooth: false
        },
        {
          name: '成交量', type: 'bar', data: volumes, xAxisIndex: 1, yAxisIndex: 1,
          itemStyle: { color: '#409EFF', opacity: 0.5 }
        }
      ],
      dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }]
    };
    
    this.chart.setOption(option, true);
  },

  // K线图
  async loadKlineChart(code, type) {
    let klines;
    if (type === 'weekly') {
      klines = await StockAPI.fetchWeeklyKline(code, 60);
    } else {
      klines = await StockAPI.fetchDailyKline(code, 120);
    }
    
    if (!klines || klines.length === 0) {
      this.chart.setOption({ title: { text: '暂无K线数据' }, series: [] });
      return;
    }

    const dates = klines.map(k => k.date);
    const ohlc = klines.map(k => [k.open, k.close, k.low, k.high]);
    const volumes = klines.map(k => k.volume);
    const volumeColors = klines.map(k => k.close >= k.open ? '#ef5350' : '#26a69a');
    
    // MA 均线
    const ma5 = SignalDetector.calcMA(klines, 5);
    const ma10 = SignalDetector.calcMA(klines, 10);
    const ma20 = SignalDetector.calcMA(klines, 20);
    
    // K线形态信号
    const kSignals = SignalDetector.detectKlineSignals(klines);
    const buyPoints = kSignals.filter(s => s.type === 'buy').map(s => ({
      coord: [s.date, klines[s.index].low],
      value: s.reason,
    }));
    const sellPoints = kSignals.filter(s => s.type === 'sell').map(s => ({
      coord: [s.date, klines[s.index].high],
      value: s.reason,
    }));

    const option = {
      animation: false,
      grid: [
        { left: 60, right: 20, top: 30, height: '55%' },
        { left: 60, right: 20, top: '72%', height: '20%' }
      ],
      xAxis: [
        { type: 'category', data: dates, gridIndex: 0, axisLabel: { fontSize: 10 }, boundaryGap: true },
        { type: 'category', data: dates, gridIndex: 1, axisLabel: { fontSize: 10 }, boundaryGap: true }
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, scale: true, splitLine: { lineStyle: { color: '#1a2a3a' } }, axisLabel: { fontSize: 10 } },
        { type: 'value', gridIndex: 1, splitLine: { show: false }, axisLabel: { show: false } }
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' }
      },
      series: [
        {
          name: 'K线', type: 'candlestick', data: ohlc, xAxisIndex: 0, yAxisIndex: 0,
          itemStyle: {
            color: '#ef5350', color0: '#26a69a',
            borderColor: '#ef5350', borderColor0: '#26a69a'
          },
          markPoint: {
            data: [
              ...buyPoints.map(p => ({
                ...p,
                symbol: 'arrow',
                symbolSize: 12,
                symbolRotate: 0,
                itemStyle: { color: '#ef5350' },
                label: { show: true, position: 'bottom', formatter: p.value, fontSize: 9, color: '#ef5350' }
              })),
              ...sellPoints.map(p => ({
                ...p,
                symbol: 'arrow',
                symbolSize: 12,
                symbolRotate: 180,
                itemStyle: { color: '#26a69a' },
                label: { show: true, position: 'top', formatter: p.value, fontSize: 9, color: '#26a69a' }
              }))
            ]
          }
        },
        {
          name: 'MA5', type: 'line', data: ma5, xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { width: 1, color: '#E6A23C' }, symbol: 'none', smooth: true
        },
        {
          name: 'MA10', type: 'line', data: ma10, xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { width: 1, color: '#409EFF' }, symbol: 'none', smooth: true
        },
        {
          name: 'MA20', type: 'line', data: ma20, xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { width: 1, color: '#F56C6C' }, symbol: 'none', smooth: true
        },
        {
          name: '成交量', type: 'bar', data: volumes.map((v, i) => ({
            value: v,
            itemStyle: { color: volumeColors[i] }
          })),
          xAxisIndex: 1, yAxisIndex: 1
        }
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 50, end: 100 },
        { type: 'slider', xAxisIndex: [0, 1], start: 50, end: 100, height: 20, bottom: 5 }
      ]
    };
    
    this.chart.setOption(option, true);
  },

  // 刷新数据
  async refresh() {
    const statusEl = document.getElementById('refresh-status');
    statusEl.textContent = '刷新中...';
    
    try {
      const data = await StockAPI.fetchRealtime(this.stocks);
      data.forEach(d => {
        this.stockData[d.code] = d;
      });
      
      this.renderStockList();
      this.renderAlertBar();
      
      if (this.currentStock) {
        this.updateStockInfo(this.currentStock);
      }
      
      const now = new Date();
      statusEl.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')} 更新`;
    } catch (e) {
      statusEl.textContent = '刷新失败';
      console.error('Refresh error:', e);
    }
  },

  // 自动刷新（交易时间30s，非交易时间60s）
  startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    
    const tick = () => {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const dayOfWeek = now.getDay();
      
      // 周末不刷新
      if (dayOfWeek === 0 || dayOfWeek === 6) return;
      
      // 交易时间 9:15 - 15:05
      const minutes = h * 60 + m;
      if (minutes >= 555 && minutes <= 905) { // 9:15 - 15:05
        this.refresh();
      }
    };
    
    this.refreshTimer = setInterval(tick, 30000);
  },

  // 判断是否交易时间
  isTradingTime() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const dayOfWeek = now.getDay();
    
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;
    
    const minutes = h * 60 + m;
    return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
  }
};

// 启动
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
