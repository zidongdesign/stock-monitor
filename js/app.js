/**
 * A股+期货实时监控 - 主应用 V2
 * 新增: 资金流向/综合评分/决策面板/板块异动/模拟模式
 */
const App = {
  // 状态
  stockData: {},        // code → 实时数据
  fundFlowData: {},     // code → 资金流向
  compSignals: {},      // code → 综合信号
  sectorData: [],       // 板块数据
  currentTab: 'overview',
  currentGroup: null,
  currentStock: null,
  currentView: 'minute',
  viewMode: 'list',     // list | grid
  refreshTimer: null,
  futuresKlineTimer: null,  // 期货K线刷新定时器
  currentFutures: null,     // 当前选中的期货品种 code (如 'MA0')

  // ====== 初始化 ======
  init() {
    // 信号逻辑版本号：更新后自动清空旧信号重算
    const SIGNAL_VERSION = 2;
    if (Store._get('sm_signal_ver', 0) < SIGNAL_VERSION) {
      Store.clearSignals();
      Store._set('sm_signal_ver', SIGNAL_VERSION);
      console.log('[信号] 逻辑更新，已清空旧信号，将自动重算');
    }

    ChartManager.init('chart-container');
    this.bindTabNav();
    this.bindOverview();
    this.bindWatchlist();
    this.bindSignals();
    this.bindSettings();
    this.bindModal();

    // 加载设置到UI
    this.loadSettingsUI();
    this.loadAssessmentUI();
    this.loadFuturesUI();
    this.loadMockModeUI();

    // 初始化分组
    const groups = Store.getGroups();
    this.currentGroup = groups[0] ? groups[0].id : null;
    this.renderGroupTabs();
    this.renderStockList();

    // 加载服务端分析数据
    DataLoader.loadAnalysis().then(analysis => {
      if (analysis) {
        this._analysisData = analysis;
        // 更新数据时间提示
        const timeEl = document.getElementById('data-update-time');
        if (timeEl && analysis.updated) {
          const d = new Date(analysis.updated);
          timeEl.textContent = '📊 分析数据更新于 ' + d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
        }
        // 更新UI显示分析标签
        this.renderStockList();
        this.renderDecisionPanel();
      }
    });

    DataLoader.loadWatchlist().then(wl => {
      if (wl && DataLoader.shouldUpdateStocks(wl.version)) {
        Store._defaultStocks = wl.groups;
        Store._STOCK_VERSION = wl.version;
        Store._set('sm_stocks', wl.groups);
        Store._set('sm_stocks_ver', wl.version);
        this.renderGroupTabs();
        this.renderStockList();
      }
    });

    // 加载板块扫描数据
    DataLoader.loadSectors().then(sectors => {
      if (sectors) {
        this._sectorsData = sectors;
        this.renderSectorScanResults();
        this.renderSectorRecommend();
      }
    });

    // 首次刷新
    this.refreshAll();
    this.startAutoRefresh();

    // 请求通知权限
    if (Store.getSettings().notification && 'Notification' in window) {
      Notification.requestPermission();
    }

    // 模拟模式指示器
    this.updateMockIndicator();
  },

  isMobile() { return window.innerWidth <= 768; },

  formatMarketCap(val) {
    if (!val && val !== 0) return '--';
    if (val >= 100000000) return (val / 100000000).toFixed(1) + '亿';
    if (val >= 10000) return (val / 10000).toFixed(0) + '万';
    return val.toString();
  },

  // ====== Tab 导航 ======
  bindTabNav() {
    document.querySelectorAll('.tab-item').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.switchTab(target);
      });
    });
  },

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + tab));

    // 切走时退出全屏并隐藏浮动按钮
    if (tab !== 'watchlist') {
      document.body.classList.remove('chart-fullscreen');
      document.getElementById('float-fullscreen').style.display='none';
      // 退出网格视图
      if (this.viewMode === 'grid') {
        this.viewMode = 'list';
        GridView.dispose();
        document.getElementById('stock-list').style.display = '';
        document.getElementById('detail-view').style.display = '';
        document.getElementById('btn-grid-view').classList.remove('grid-active');
      }
    } else if (this.currentStock) {
      document.getElementById('float-fullscreen').style.display='flex';
    }

    if (tab === 'watchlist') {
      setTimeout(() => ChartManager.resize(), 100);
    }
    if (tab === 'signals') {
      this.renderSignalStream();
      if (this._sectorsData) {
        this.renderSectorScanResults();
        this.renderSectorRecommend();
      } else {
        this.renderSectorAlerts();
      }
    }
  },

  // ====== 📊 大盘总览 ======
  bindOverview() {
    // 定性按钮
    document.querySelectorAll('.assess-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const level = btn.dataset.level;
        document.querySelectorAll('.assess-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const note = document.getElementById('assess-note').value;
        Store.setAssessment({ level, note });
        this.loadAssessmentUI();
      });
    });

    document.getElementById('assess-note').addEventListener('change', () => {
      const a = Store.getAssessment();
      if (a.level) {
        a.note = document.getElementById('assess-note').value;
        Store.setAssessment(a);
        this.loadAssessmentUI();
      }
    });
  },

  loadAssessmentUI() {
    const a = Store.getAssessment();
    document.querySelectorAll('.assess-btn').forEach(b => b.classList.toggle('active', b.dataset.level === a.level));
    document.getElementById('assess-note').value = a.note || '';
    const levelMap = { green: '🟢 绿灯（看多）', yellow: '🟡 黄灯（观望）', red: '🔴 红灯（看空）' };
    const statusEl = document.getElementById('assess-status');
    if (a.level && a.date) {
      statusEl.textContent = (levelMap[a.level] || '未知') + ' · ' + a.time + (a.note ? ' · ' + a.note : '');
    } else {
      statusEl.textContent = '未设定';
    }
  },

  updateIndexCards(data) {
    const cards = document.querySelectorAll('.index-card');
    cards.forEach(card => {
      const code = card.dataset.code;
      const d = data.find(s => s.code === code);
      if (!d) return;
      const cls = d.changePercent > 0 ? 'up' : d.changePercent < 0 ? 'down' : '';
      card.querySelector('.index-price').textContent = d.price.toFixed(2);
      card.querySelector('.index-price').className = 'index-price ' + cls;
      card.querySelector('.index-change').textContent = (d.changePercent > 0 ? '+' : '') + d.changePercent.toFixed(2) + '%';
      card.querySelector('.index-change').className = 'index-change ' + cls;
    });
  },

  renderOverviewSignals() {
    const signals = Store.getSignals();
    const today = new Date().toISOString().slice(0, 10);
    const todaySignals = signals.filter(s => s.date === today);
    const container = document.getElementById('overview-signals');

    if (todaySignals.length === 0) {
      container.innerHTML = '<div class="empty-hint">今日暂无信号</div>';
      return;
    }

    container.innerHTML = todaySignals.slice(0, 20).map(s =>
      '<div class="signal-item">' +
        '<div class="signal-time">' + s.time + '</div>' +
        '<div class="signal-content">' +
          '<div class="signal-stock-name">' + (s.name || s.code) + '</div>' +
          '<div class="signal-reason"><span class="signal-badge ' + s.type + '">' + s.reason + '</span></div>' +
        '</div>' +
      '</div>'
    ).join('');
  },

  // ====== 决策面板 ======
  renderDecisionPanel() {
    const panel = document.getElementById('decision-panel');
    if (!panel) return;

    const allCodes = Store.getAllStockCodes();
    if (allCodes.length === 0) {
      panel.innerHTML = '<div class="empty-hint">请先添加自选股</div>';
      return;
    }

    // 按信号级别分组
    const urgent = [];   // 🔴
    const attention = []; // 🟡 with notable signals
    const normal = [];    // 🟢 正常持有

    allCodes.forEach(code => {
      const stock = this.stockData[code];
      if (!stock) return;
      const sig = this.compSignals[code];
      const flow = this.fundFlowData[code];
      
      const item = { code, stock, sig, flow };
      
      if (sig && sig.level === 'sell') {
        urgent.push(item);
      } else if (sig && sig.level === 'buy') {
        attention.push(item);
      } else {
        normal.push(item);
      }
    });

    // Sort by score
    urgent.sort((a, b) => (a.sig?.score || 50) - (b.sig?.score || 50));
    attention.sort((a, b) => (b.sig?.score || 50) - (a.sig?.score || 50));

    let html = '';

    // 🔴 紧急决策
    if (urgent.length > 0) {
      html += '<div class="decision-group"><div class="decision-group-header sell">🔴 紧急决策 (' + urgent.length + ')</div>';
      urgent.forEach(item => { html += this._renderDecisionItem(item); });
      html += '</div>';
    }

    // 🟢 买入关注（值得关注）
    if (attention.length > 0) {
      html += '<div class="decision-group"><div class="decision-group-header buy">🟢 买入关注 (' + attention.length + ')</div>';
      attention.forEach(item => { html += this._renderDecisionItem(item); });
      html += '</div>';
    }

    // 🟡 正常持有（默认折叠）
    if (normal.length > 0) {
      html += '<div class="decision-group collapsed">' +
        '<div class="decision-group-header hold collapsible" onclick="this.parentElement.classList.toggle(\'collapsed\')">' +
          '🟡 正常持有 (' + normal.length + ') <span class="collapse-arrow">▼</span>' +
        '</div>' +
        '<div class="decision-group-body">';
      normal.forEach(item => { html += this._renderDecisionItem(item); });
      html += '</div></div>';
    }

    if (!html) {
      html = '<div class="empty-hint">暂无决策数据</div>';
    }

    panel.innerHTML = html;
  },

  _renderDecisionItem(item) {
    const { stock, sig, flow } = item;
    const cls = stock.changePercent > 0 ? 'up' : stock.changePercent < 0 ? 'down' : '';
    const flowHtml = flow ? this._renderFlowTag(flow) : '';
    const sigHtml = sig ? '<span class="comp-signal-badge ' + sig.level + '">' + sig.emoji + ' ' + sig.label + '</span>' : '';
    
    return '<div class="decision-item">' +
      '<div class="decision-item-left">' +
        '<span class="decision-name">' + stock.name + '</span>' +
        sigHtml +
      '</div>' +
      '<div class="decision-item-mid">' +
        '<span class="decision-price ' + cls + '">' + stock.price.toFixed(2) + '</span>' +
        '<span class="decision-change ' + cls + '">' + (stock.changePercent > 0 ? '+' : '') + stock.changePercent.toFixed(2) + '%</span>' +
        flowHtml +
      '</div>' +
      '<div class="decision-item-reason">' + (sig ? sig.reason : '') + '</div>' +
    '</div>';
  },

  _renderFlowTag(flow) {
    if (!flow) return '';
    const cls = flow.mainNet > 0 ? 'flow-in' : flow.mainNet < 0 ? 'flow-out' : 'flow-neutral';
    let text;
    if (Math.abs(flow.mainNet) >= 10000) {
      text = (flow.mainNet > 0 ? '+' : '') + (flow.mainNet / 10000).toFixed(1) + '亿';
    } else {
      text = (flow.mainNet > 0 ? '+' : '') + flow.mainNet + '万';
    }
    return '<span class="flow-tag ' + cls + '">' + text + '</span>';
  },

  // ====== 📈 自选股 ======
  bindWatchlist() {
    document.getElementById('btn-add-stock').addEventListener('click', () => this.showAddStockModal());
    document.getElementById('btn-manage-groups').addEventListener('click', () => this.showGroupManageModal());
    document.getElementById('btn-grid-view').addEventListener('click', () => this.toggleGridView());
    document.getElementById('btn-back').addEventListener('click', () => {
      document.body.classList.remove('chart-fullscreen');
      document.getElementById('page-watchlist').classList.remove('show-detail');
      document.getElementById('float-fullscreen').style.display='none';
    });

    // 视图切换
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        this.currentView = e.target.dataset.view;
        if (this.currentStock) this.loadChart(this.currentStock);
      });
    });

    window.addEventListener('resize', () => {
      if (!this.isMobile()) {
        document.getElementById('page-watchlist').classList.remove('show-detail');
      }
      ChartManager.resize();
    });

    // 横屏切换时重新resize图表
    if (screen.orientation) {
      screen.orientation.addEventListener('change', () => {
        setTimeout(() => ChartManager.resize(), 300);
      });
    }
    window.addEventListener('orientationchange', () => {
      setTimeout(() => ChartManager.resize(), 300);
    });

    // 全屏按钮
    document.getElementById('btn-fullscreen').addEventListener('click', () => {
      this.toggleChartFullscreen();
    });
  },

  toggleChartFullscreen() {
    const isFS = document.body.classList.toggle('chart-fullscreen');
    const floatBtn = document.getElementById('float-fullscreen');
    floatBtn.textContent = isFS ? '✕' : '⛶';
    // toolbar里的按钮
    const toolbarBtn = document.getElementById('btn-fullscreen');
    if (toolbarBtn) {
      if (isFS) {
        toolbarBtn.innerHTML = '✕';
        toolbarBtn.title = '退出全屏';
      } else {
        toolbarBtn.innerHTML = '⛶ <span class="fs-label">全屏</span>';
        toolbarBtn.title = '全屏图表';
      }
    }
    setTimeout(() => ChartManager.resize(), 150);
  },

  renderGroupTabs() {
    const groups = Store.getGroups();
    const allStocks = Store.getStocks();
    const container = document.getElementById('group-tabs');

    // 添加"期货"固定分组
    const futuresCount = Store.getFutures().length;

    let html = groups.map(g => {
      const count = (allStocks[g.id] || []).length;
      return '<div class="group-tab' + (g.id === this.currentGroup ? ' active' : '') + '" data-group="' + g.id + '">' +
        g.name + '<span class="group-count">' + count + '</span></div>';
    }).join('');

    html += '<div class="group-tab' + (this.currentGroup === '__futures__' ? ' active' : '') + '" data-group="__futures__">' +
      '期货<span class="group-count">' + futuresCount + '</span></div>';

    container.innerHTML = html;

    container.querySelectorAll('.group-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.currentGroup = tab.dataset.group;
        this.renderGroupTabs();
        this.renderStockList();
        // 网格模式下切分组要重新渲染
        if (this.viewMode === 'grid') {
          const codes = this.currentGroup === '__futures__'
            ? Store.getFutures().map(f => f.sina)
            : (Store.getStocks(this.currentGroup) || []);
          GridView.render(codes, this.stockData);
        }
      });
    });
  },

  renderStockList() {
    const container = document.getElementById('stock-list');
    const settings = Store.getSettings();
    const detailView = document.getElementById('detail-view');

    // 期货模式下隐藏右侧详情面板，非期货模式恢复
    if (this.currentGroup === '__futures__') {
      if (detailView) detailView.style.display = 'none';
    } else {
      if (detailView) detailView.style.display = '';
      // 清理期货 K 线资源
      if (this._futuresChart) { this._futuresChart.dispose(); this._futuresChart = null; }
      if (this.futuresKlineTimer) { clearInterval(this.futuresKlineTimer); this.futuresKlineTimer = null; }
    }

    if (this.currentGroup === '__futures__') {
      // ====== 期货独立页面：Tab + K线 + 行情 ======
      const futures = Store.getFutures();
      if (futures.length === 0) {
        container.innerHTML = '<div class="empty-hint">暂无期货品种，请在设置中添加</div>';
        return;
      }
      // 默认选中第一个
      if (!this.currentFutures || !futures.find(f => f.code === this.currentFutures)) {
        this.currentFutures = futures[0].code;
      }

      // 品种横向 Tab
      let html = '<div class="futures-tabs">';
      futures.forEach(f => {
        const d = this.stockData[f.sina];
        const cls = d ? (d.changePercent > 0 ? 'up' : d.changePercent < 0 ? 'down' : '') : '';
        const active = f.code === this.currentFutures ? ' active' : '';
        html += '<div class="futures-tab-item' + active + ' ' + cls + '" data-fcode="' + f.code + '">' +
          '<span class="ftab-name">' + f.name + '</span>' +
          (d ? '<span class="ftab-pct ' + cls + '">' + (d.changePercent > 0 ? '+' : '') + d.changePercent.toFixed(2) + '%</span>' : '') +
        '</div>';
      });
      html += '</div>';

      // K线图容器
      html += '<div class="futures-kline-wrap"><div id="futures-kline-chart"></div></div>';

      // 实时行情信息
      const sel = futures.find(f => f.code === this.currentFutures);
      const d = sel ? this.stockData[sel.sina] : null;
      if (d) {
        const cls = d.changePercent > 0 ? 'up' : d.changePercent < 0 ? 'down' : '';
        html += '<div class="futures-realtime-info">' +
          '<div class="fri-header">' +
            '<span class="fri-name">' + d.name + '</span>' +
            '<span class="fri-code">' + sel.code + '</span>' +
          '</div>' +
          '<div class="fri-body">' +
            '<div class="fri-price ' + cls + '">' + d.price.toFixed(2) + '</div>' +
            '<div class="fri-details">' +
              '<span class="fri-item ' + cls + '">涨跌 ' + (d.change > 0 ? '+' : '') + d.change.toFixed(2) + ' (' + (d.changePercent > 0 ? '+' : '') + d.changePercent.toFixed(2) + '%)</span>' +
              '<span class="fri-item">开盘 ' + d.open.toFixed(2) + '</span>' +
              '<span class="fri-item">最高 ' + d.high.toFixed(2) + '</span>' +
              '<span class="fri-item">最低 ' + d.low.toFixed(2) + '</span>' +
              '<span class="fri-item">成交量 ' + (d.volume || 0) + '</span>' +
              '<span class="fri-item">昨结算 ' + d.prevClose.toFixed(2) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      } else {
        html += '<div class="futures-realtime-info"><div class="empty-hint">加载中...</div></div>';
      }

      container.innerHTML = html;

      // 绑定 Tab 点击
      container.querySelectorAll('.futures-tab-item').forEach(tab => {
        tab.addEventListener('click', () => {
          this.currentFutures = tab.dataset.fcode;
          this.renderStockList();
          this.loadFuturesKline();
        });
      });

      // 初始化 K 线图表并加载数据
      setTimeout(() => {
        const el = document.getElementById('futures-kline-chart');
        if (el) {
          if (this._futuresChart) this._futuresChart.dispose();
          this._futuresChart = echarts.init(el);
          window.addEventListener('resize', () => { if (this._futuresChart) this._futuresChart.resize(); });
          this.loadFuturesKline();
          this.startFuturesKlineRefresh();
        }
      }, 50);
      return;
    } else {
      const codes = Store.getStocks(this.currentGroup) || [];
      if (codes.length === 0) {
        container.innerHTML = '<div class="empty-hint">暂无股票，点击＋添加</div>';
        return;
      }
      container.innerHTML = codes.map(code => {
        const d = this.stockData[code];
        const isActive = this.currentStock === code;
        const signals = d ? SignalDetector.detectRealtime(d, settings) : [];
        const cls = d ? (d.changePercent > 0 ? 'up' : d.changePercent < 0 ? 'down' : '') : '';
        const flow = this.fundFlowData[code];
        const compSig = this.compSignals[code];
        const flowHtml = flow ? this._renderFlowTag(flow) : '';
        const compHtml = compSig ? '<span class="comp-signal-badge ' + compSig.level + '">' + compSig.emoji + ' ' + compSig.label + '</span>' : '';
        
        return '<div class="stock-item' + (isActive ? ' active' : '') + (signals.length ? ' has-signal' : '') + '" data-code="' + code + '" data-group="' + this.currentGroup + '">' +
          '<div class="stock-item-header">' +
            '<span class="stock-name">' + (d?.name || code) + '<span class="stock-code">' + code + '</span></span>' +
            '<span class="stock-remove" data-remove="' + code + '">×</span>' +
          '</div>' +
          '<div class="stock-item-body">' +
            '<span class="stock-price ' + cls + '">' + (d && d.price ? d.price.toFixed(2) : '--') + '</span>' +
            '<span class="stock-change ' + cls + '">' + (d && !isNaN(d.changePercent) ? ((d.changePercent > 0 ? '+' : '') + d.changePercent.toFixed(2) + '%') : '--') + '</span>' +
            '<span class="stock-meta">' + (d ? '量比' + (d.volumeRatio || 0).toFixed(1) + ' 换手' + (d.turnover || 0).toFixed(1) + '%' : '') + '</span>' +
          '</div>' +
          '<div class="stock-item-tags">' + flowHtml + compHtml + (() => {
            const analysis = this._analysisData?.stocks?.[code];
            let aHtml = '';
            if (analysis) {
              const scoreClass = analysis.score >= 70 ? 'score-high' : analysis.score >= 40 ? 'score-mid' : 'score-low';
              aHtml += '<span class="analysis-score ' + scoreClass + '">' + analysis.score + '分</span>';
              if (analysis.financial && analysis.financial.grade) {
                aHtml += '<span class="analysis-grade grade-' + analysis.financial.grade.toLowerCase() + '">财务' + analysis.financial.grade + '</span>';
              }
              const actionMap = { buy: '🟢买入', hold: '🟡持有', reduce: '🟠减仓', eliminate: '🔴淘汰' };
              if (analysis.action && analysis.action !== 'hold') {
                aHtml += '<span class="analysis-action action-' + analysis.action + '">' + (actionMap[analysis.action] || '') + '</span>';
              }
              (analysis.tags || []).forEach(tag => {
                aHtml += '<span class="analysis-tag">' + tag + '</span>';
              });
            }
            return aHtml;
          })() + '</div>' +
          (signals.length ? '<div class="stock-signals">' + signals.map(s => '<span class="signal-badge ' + s.type + '">' + s.reason + '</span>').join('') + '</div>' : '') +
        '</div>';
      }).join('');
    }

    // 绑定点击事件
    container.querySelectorAll('.stock-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('stock-remove')) return;
        this.selectStock(item.dataset.code);
      });
    });

    container.querySelectorAll('.stock-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = btn.dataset.remove;
        Store.removeStock(this.currentGroup, code);
        this.renderGroupTabs();
        this.renderStockList();
      });
    });
  },

  toggleGridView() {
    if (this.viewMode === 'grid') {
      this.viewMode = 'list';
      GridView.dispose();
      document.getElementById('stock-list').style.display = '';
      document.getElementById('detail-view').style.display = '';
      document.getElementById('btn-grid-view').classList.remove('grid-active');
    } else {
      this.viewMode = 'grid';
      document.getElementById('stock-list').style.display = 'none';
      document.getElementById('page-watchlist').classList.remove('show-detail');
      document.getElementById('float-fullscreen').style.display = 'none';
      document.getElementById('btn-grid-view').classList.add('grid-active');

      // 隐藏详情视图（桌面端）
      if (!this.isMobile()) {
        document.getElementById('detail-view').style.display = 'none';
      }

      const codes = this.currentGroup === '__futures__'
        ? Store.getFutures().map(f => f.sina)
        : (Store.getStocks(this.currentGroup) || []);
      GridView.render(codes, this.stockData);
    }
  },

  switchToListView(code) {
    this.viewMode = 'list';
    GridView.dispose();
    document.getElementById('stock-list').style.display = '';
    document.getElementById('detail-view').style.display = '';
    document.getElementById('btn-grid-view').classList.remove('grid-active');
    this.selectStock(code);
  },

  // ====== 期货 K 线加载与刷新 ======
  async loadFuturesKline() {
    if (!this.currentFutures || !this._futuresChart) return;
    try {
      const klines = await StockAPI.fetchFutures5minKline(this.currentFutures);
      const signals = SignalDetector.detectFutures5min(klines);
      // 用 _futuresChart 渲染
      this._renderFutures5minChart(klines, signals);
    } catch (e) {
      console.error('Futures kline error:', e);
    }
  },

  _renderFutures5minChart(klines, signals) {
    const chart = this._futuresChart;
    if (!chart) return;
    if (!klines || klines.length === 0) {
      chart.setOption({ title: { text: '暂无5分钟K线数据', left: 'center', top: 'center', textStyle: { color: '#8b949e', fontSize: 14 } }, xAxis: [], yAxis: [], series: [] }, true);
      return;
    }
    const data = klines.slice(-48);
    const offset = klines.length - data.length;
    const mappedSignals = (signals || []).filter(s => s.index >= offset).map(s => ({ ...s, index: s.index - offset }));

    const times = data.map(k => k.time.replace(/^\d{4}-\d{2}-\d{2}\s*/, '').substring(0, 5));
    const ohlc = data.map(k => [k.open, k.close, k.low, k.high]);
    const volumes = data.map(k => k.volume);
    const volColors = data.map(k => k.close >= k.open ? '#ef5350' : '#26a69a');

    const ma5 = SignalDetector.calcMA(data, 5);
    const ma10 = SignalDetector.calcMA(data, 10);

    const buyPts = mappedSignals.filter(s => s.type === 'buy').map(s => ({
      coord: [times[s.index], data[s.index].low], value: s.reason
    }));
    const sellPts = mappedSignals.filter(s => s.type === 'sell').map(s => ({
      coord: [times[s.index], data[s.index].high], value: s.reason
    }));

    chart.setOption({
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
    }, true);
  },

  startFuturesKlineRefresh() {
    if (this.futuresKlineTimer) clearInterval(this.futuresKlineTimer);
    this.futuresKlineTimer = setInterval(() => {
      if (this.currentGroup !== '__futures__') return;
      const now = new Date();
      const h = now.getHours(), m = now.getMinutes(), day = now.getDay();
      if (day === 0 || day === 6) return;
      const mins = h * 60 + m;
      // 期货交易时间 9:00-15:00, 21:00-23:30
      if ((mins >= 540 && mins <= 900) || (mins >= 1260 && mins <= 1410)) {
        this.loadFuturesKline();
      }
    }, 5 * 60 * 1000); // 5分钟
  },

  selectStock(code) {
    this.currentStock = code;
    this.renderStockList();
    this.updateStockInfo(code);

    if (this.isMobile()) {
      document.getElementById('page-watchlist').classList.add('show-detail');
    }

    // 显示浮动全屏按钮
    document.getElementById('float-fullscreen').style.display='flex';

    setTimeout(() => {
      ChartManager.resize();
      this.loadChart(code);
    }, 120);
  },

  updateStockInfo(code) {
    const d = this.stockData[code];
    const info = document.getElementById('stock-info');
    if (!d) {
      info.innerHTML = '<p class="hint-text">加载中...</p>';
      return;
    }

    const cls = d.changePercent > 0 ? 'up' : d.changePercent < 0 ? 'down' : '';
    const compSig = this.compSignals[code];

    info.innerHTML =
      '<div class="info-compact">' +
        '<div class="info-compact-left">' +
          '<span class="stock-name-compact">' + d.name + '</span>' +
          '<span class="stock-code-compact">' + (d.displayCode || code) + '</span>' +
        '</div>' +
        '<div class="info-compact-right">' +
          '<span class="compact-tag">换手 ' + (d.turnover || 0).toFixed(1) + '%</span>' +
          '<span class="compact-tag">PE ' + (d.pe || '--') + '</span>' +
          '<span class="compact-tag">流通 ' + this.formatMarketCap(d.floatShares) + '</span>' +
          '<span class="compact-tag">市值 ' + this.formatMarketCap(d.floatMarketCap) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="info-price-row">' +
        '<span class="big-price ' + cls + '">' + d.price.toFixed(2) + '</span>' +
        '<span class="price-change ' + cls + '">' + (d.changePercent > 0 ? '+' : '') + d.changePercent.toFixed(2) + '%</span>' +
        '<span class="price-change ' + cls + '">' + (d.change > 0 ? '+' : '') + d.change.toFixed(2) + '</span>' +
        (compSig ? '<span class="comp-signal-mini ' + compSig.level + '">' + compSig.emoji + ' ' + compSig.label + '</span>' : '') +
      '</div>';
  },

  async loadChart(code) {
    const statusEl = document.getElementById('chart-status');
    statusEl.textContent = '加载中...';
    const settings = Store.getSettings();

    try {
      if (this.currentView === 'minute') {
        // 期货暂无分时（腾讯接口不支持期货分时）
        if (code.startsWith('nf_')) {
          ChartManager.chart.setOption({ title: { text: '期货暂不支持分时图', left: 'center', top: 'center', textStyle: { color: '#8b949e', fontSize: 14 } }, xAxis: [], yAxis: [], series: [] }, true);
        } else {
          const data = await StockAPI.fetchMinute(code);
          const prevClose = this.stockData[code]?.prevClose;
          ChartManager.renderMinute(data, prevClose);
        }
      } else {
        // K线（期货也不支持腾讯K线，显示提示）
        if (code.startsWith('nf_')) {
          ChartManager.chart.setOption({ title: { text: '期货K线暂不支持', left: 'center', top: 'center', textStyle: { color: '#8b949e', fontSize: 14 } }, xAxis: [], yAxis: [], series: [] }, true);
        } else {
          const klines = this.currentView === 'weekly'
            ? await StockAPI.fetchWeeklyKline(code, 60)
            : await StockAPI.fetchDailyKline(code, 120);
          const kSignals = SignalDetector.detectKlineSignals(klines, settings);
          ChartManager.renderKline(klines, kSignals, settings);
        }
      }
      statusEl.textContent = new Date().toLocaleTimeString('zh-CN');
    } catch (e) {
      statusEl.textContent = '加载失败';
      console.error('Chart error:', e);
    }
  },

  // ====== 📡 信号中心 ======
  bindSignals() {
    document.getElementById('signal-filter').addEventListener('change', () => this.renderSignalStream());
    document.getElementById('signal-day-filter').addEventListener('change', () => this.renderSignalStream());
    document.getElementById('btn-clear-signals').addEventListener('click', () => {
      if (confirm('确定清空所有信号记录？')) {
        Store.clearSignals();
        this.renderSignalStream();
        this.renderOverviewSignals();
      }
    });
  },

  // ====== 板块扫描结果渲染（来自 sectors.json） ======
  renderSectorScanResults() {
    const container = document.getElementById('sector-alerts');
    if (!container) return;
    const data = this._sectorsData;
    if (!data || !data.sectors || data.sectors.length === 0) return;

    const allCodes = Store.getAllStockCodes();
    let html = '';

    // 更新时间
    if (data.updated) {
      const d = new Date(data.updated);
      html += '<div class="sector-scan-time">📊 板块扫描更新于 ' +
        d.toLocaleDateString('zh-CN') + ' ' +
        d.toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}) + '</div>';
    }

    data.sectors.forEach(s => {
      const cls = s.avgChange > 0 ? 'up' : s.avgChange < 0 ? 'down' : '';
      const netAmountStr = s.netAmount >= 100000000
        ? (s.netAmount / 100000000).toFixed(1) + '亿'
        : (s.netAmount / 10000).toFixed(0) + '万';

      html += '<div class="sector-alert-item">' +
        '<div class="sector-alert-header">' +
          '<span class="sector-name">' + s.name + '</span>' +
          '<span class="sector-change ' + cls + '">' +
            (s.avgChange > 0 ? '+' : '') + s.avgChange.toFixed(2) + '% · 净流入 ' + netAmountStr +
          '</span>' +
        '</div>' +
        '<div class="sector-alert-body">';

      if (s.leader && s.leader.name) {
        html += '<span class="sector-leader">龙头: ' + s.leader.name +
          (s.leader.change ? ' ' + (s.leader.change > 0 ? '+' : '') + s.leader.change.toFixed(1) + '%' : '') +
          '</span>';
      }

      // 热门个股展示
      if (s.hotStocks && s.hotStocks.length > 0) {
        html += '<div class="sector-hot-stocks">';
        s.hotStocks.slice(0, 3).forEach(st => {
          const stCls = st.change > 0 ? 'up' : st.change < 0 ? 'down' : '';
          const inWatchlist = allCodes.includes(st.code);
          html += '<span class="sector-hot-tag ' + stCls + '">' +
            (inWatchlist ? '📌' : '') + st.name + ' ' +
            (st.change > 0 ? '+' : '') + st.change + '%' +
          '</span>';
        });
        html += '</div>';
      }

      html += '</div></div>';
    });

    container.innerHTML = html;
  },

  renderSectorRecommend() {
    const data = this._sectorsData;
    if (!data || !data.recommend || data.recommend.length === 0) return;

    // 找到或创建推荐区域
    let section = document.getElementById('sector-recommend');
    if (!section) {
      const container = document.getElementById('sector-alerts');
      if (!container) return;
      section = document.createElement('div');
      section.id = 'sector-recommend';
      section.className = 'recommend-section';
      container.parentNode.insertBefore(section, container.nextSibling);
    }

    let html = '<div class="recommend-title">🎯 板块热股推荐</div>';
    data.recommend.forEach(r => {
      const scoreClass = r.score >= 70 ? 'high' : r.score >= 50 ? 'mid' : '';
      html += '<div class="recommend-item">' +
        '<div class="recommend-info">' +
          '<span class="recommend-name">' + r.name + '</span>' +
          '<span class="recommend-sector">' + r.sector + '</span>' +
          '<div class="recommend-reason">' + r.reason + '</div>' +
        '</div>' +
        '<span class="recommend-score ' + scoreClass + '">' + r.score + '分</span>' +
        '<button class="btn-add-recommend" data-code="' + r.code + '" data-group="' + (r.suggestGroup || 'watch') + '">+ 加自选</button>' +
      '</div>';
    });

    section.innerHTML = html;

    // 绑定添加按钮
    section.querySelectorAll('.btn-add-recommend').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = btn.dataset.code;
        const group = btn.dataset.group;
        if (Store.addStock(group, code)) {
          btn.textContent = '✓ 已添加';
          btn.disabled = true;
          btn.style.background = '#6e7681';
          this.renderGroupTabs();
          this.renderStockList();
        } else {
          btn.textContent = '已在自选';
          btn.disabled = true;
          btn.style.background = '#6e7681';
        }
      });
    });
  },

  // ====== 板块异动渲染 ======
  renderSectorAlerts() {
    const container = document.getElementById('sector-alerts');
    if (!container) return;

    const sectors = this.sectorData;
    const allCodes = Store.getAllStockCodes();
    
    // 筛选异动板块（涨跌>2%）
    const alerts = sectors.filter(s => Math.abs(s.changePercent) >= 2);
    
    if (alerts.length === 0) {
      container.innerHTML = '<div class="empty-hint">暂无板块异动（涨跌>2%触发）</div>';
      return;
    }

    // 按涨跌幅绝对值排序
    alerts.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

    container.innerHTML = alerts.map(s => {
      const cls = s.changePercent > 0 ? 'up' : 'down';
      const related = (s.relatedCodes || []).filter(c => allCodes.includes(c));
      const relatedNames = related.map(c => {
        const d = this.stockData[c];
        return d ? d.name : c;
      });
      
      return '<div class="sector-alert-item">' +
        '<div class="sector-alert-header">' +
          '<span class="sector-name">' + s.name + '</span>' +
          '<span class="sector-change ' + cls + '">' + (s.changePercent > 0 ? '+' : '') + s.changePercent.toFixed(2) + '%</span>' +
        '</div>' +
        '<div class="sector-alert-body">' +
          '<span class="sector-leader">龙头: ' + s.leader + ' ' + (s.leaderChange > 0 ? '+' : '') + (s.leaderChange || 0).toFixed(1) + '%</span>' +
          (relatedNames.length > 0
            ? '<span class="sector-related">📌 自选关联: ' + relatedNames.join(', ') + '</span>'
            : '<span class="sector-no-related">无自选关联</span>') +
        '</div>' +
      '</div>';
    }).join('');

    // 也展示全部板块（小列表）
    const otherSectors = sectors.filter(s => Math.abs(s.changePercent) < 2).slice(0, 10);
    if (otherSectors.length > 0) {
      container.innerHTML += '<div class="sector-others-title" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">其他板块 ▼</div>';
      container.innerHTML += '<div class="sector-others hidden">' + otherSectors.map(s => {
        const cls = s.changePercent > 0 ? 'up' : s.changePercent < 0 ? 'down' : '';
        return '<div class="sector-other-item"><span>' + s.name + '</span><span class="' + cls + '">' + (s.changePercent > 0 ? '+' : '') + s.changePercent.toFixed(2) + '%</span></div>';
      }).join('') + '</div>';
    }
  },

  renderSignalStream() {
    const signals = Store.getSignals();
    const typeFilter = document.getElementById('signal-filter').value;
    const dayFilter = document.getElementById('signal-day-filter').value;
    const today = new Date().toISOString().slice(0, 10);

    let filtered = signals;
    if (typeFilter !== 'all') filtered = filtered.filter(s => s.type === typeFilter);
    if (dayFilter === 'today') filtered = filtered.filter(s => s.date === today);

    const container = document.getElementById('signal-stream');
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-hint">暂无信号记录</div>';
      return;
    }

    // 按天分组
    const grouped = {};
    filtered.forEach(s => {
      if (!grouped[s.date]) grouped[s.date] = [];
      grouped[s.date].push(s);
    });

    let html = '';
    Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0])).forEach(([date, items]) => {
      html += '<div class="signal-date-header">' + date + ' (' + items.length + '条)</div>';
      items.forEach(s => {
        html += '<div class="signal-item">' +
          '<div class="signal-time">' + s.time + '</div>' +
          '<div class="signal-content">' +
            '<div class="signal-stock-name">' + (s.name || s.code) + '</div>' +
            '<div class="signal-reason"><span class="signal-badge ' + s.type + '">' + s.reason + '</span></div>' +
          '</div>' +
        '</div>';
      });
    });

    container.innerHTML = html;
  },

  // ====== ⚙️ 设置 ======
  bindSettings() {
    const s = Store.getSettings();

    // 模拟模式
    document.getElementById('setting-mock-mode').addEventListener('change', (e) => {
      const settings = Store.getSettings();
      const val = e.target.value;
      settings.mockMode = val === 'true' ? true : val === 'false' ? false : 'auto';
      Store.setSettings(settings);
      this.updateMockIndicator();
      // 立即刷新
      this.refreshAll();
    });

    // 刷新频率
    document.getElementById('setting-refresh-interval').addEventListener('change', (e) => {
      const settings = Store.getSettings();
      settings.refreshInterval = parseInt(e.target.value);
      Store.setSettings(settings);
      this.startAutoRefresh();
    });

    // 滑块
    const bindSlider = (id, labelId, key, suffix) => {
      const el = document.getElementById(id);
      const label = document.getElementById(labelId);
      el.addEventListener('input', () => {
        label.textContent = el.value + (suffix || '');
        const settings = Store.getSettings();
        settings[key] = parseFloat(el.value);
        Store.setSettings(settings);
      });
    };

    bindSlider('setting-volume-ratio', 'label-volume-ratio', 'volumeRatioThreshold', '');
    bindSlider('setting-change-pct', 'label-change-pct', 'changePctThreshold', '%');
    bindSlider('setting-turnover', 'label-turnover', 'turnoverThreshold', '%');

    // 开关
    const bindToggle = (id, key) => {
      document.getElementById(id).addEventListener('change', (e) => {
        const settings = Store.getSettings();
        settings[key] = e.target.checked;
        Store.setSettings(settings);
      });
    };

    bindToggle('setting-macd', 'macd');
    bindToggle('setting-kdj', 'kdj');
    bindToggle('setting-cci', 'cci');
    bindToggle('setting-notification', 'notification');
    bindToggle('setting-sound', 'sound');

    // 期货管理
    document.getElementById('btn-add-futures').addEventListener('click', () => {
      const code = document.getElementById('futures-add-code').value.trim().toUpperCase();
      const name = document.getElementById('futures-add-name').value.trim();
      if (!code || !name) { alert('请填写代码和名称'); return; }
      if (Store.addFutures(code, name)) {
        document.getElementById('futures-add-code').value = '';
        document.getElementById('futures-add-name').value = '';
        this.loadFuturesUI();
        this.renderGroupTabs();
      } else {
        alert('品种已存在');
      }
    });

    // 导出
    document.getElementById('btn-export').addEventListener('click', () => {
      const data = Store.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'stock-monitor-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
    });

    // 导入
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          Store.importAll(data);
          alert('导入成功！页面即将刷新');
          location.reload();
        } catch { alert('导入失败：文件格式错误'); }
      };
      reader.readAsText(file);
    });

    // 清空
    document.getElementById('btn-clear-all').addEventListener('click', () => {
      if (confirm('确定清空所有数据？此操作不可恢复！')) {
        Store.clearAll();
        alert('已清空，页面即将刷新');
        location.reload();
      }
    });
  },

  loadSettingsUI() {
    const s = Store.getSettings();
    document.getElementById('setting-refresh-interval').value = s.refreshInterval;
    document.getElementById('setting-volume-ratio').value = s.volumeRatioThreshold;
    document.getElementById('label-volume-ratio').textContent = s.volumeRatioThreshold;
    document.getElementById('setting-change-pct').value = s.changePctThreshold;
    document.getElementById('label-change-pct').textContent = s.changePctThreshold + '%';
    document.getElementById('setting-turnover').value = s.turnoverThreshold;
    document.getElementById('label-turnover').textContent = s.turnoverThreshold + '%';
    document.getElementById('setting-macd').checked = s.macd;
    document.getElementById('setting-kdj').checked = s.kdj;
    document.getElementById('setting-cci').checked = s.cci;
    document.getElementById('setting-notification').checked = s.notification;
    document.getElementById('setting-sound').checked = s.sound;
  },

  loadFuturesUI() {
    const list = Store.getFutures();
    const container = document.getElementById('futures-list');
    container.innerHTML = list.map(f =>
      '<div class="futures-item">' +
        '<span>' + f.code + ' (' + f.name + ') — ' + f.sina + '</span>' +
        '<span class="futures-remove" data-code="' + f.code + '">×</span>' +
      '</div>'
    ).join('');

    container.querySelectorAll('.futures-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        Store.removeFutures(btn.dataset.code);
        this.loadFuturesUI();
        this.renderGroupTabs();
      });
    });
  },

  loadMockModeUI() {
    const s = Store.getSettings();
    const el = document.getElementById('setting-mock-mode');
    if (el) {
      el.value = s.mockMode === true ? 'true' : s.mockMode === false ? 'false' : 'auto';
    }
    this.updateMockIndicator();
  },

  updateMockIndicator() {
    const isMock = MockData && MockData.shouldUseMock();
    const statusEl = document.getElementById('mock-status');
    if (statusEl) {
      statusEl.innerHTML = isMock
        ? '<span class="mock-badge active">📊 当前: 模拟数据</span>'
        : '<span class="mock-badge real">🔴 当前: 实时数据</span>';
    }
    // 更新导航栏指示
    const nav = document.getElementById('tab-nav');
    if (isMock) {
      nav.classList.add('mock-mode');
    } else {
      nav.classList.remove('mock-mode');
    }
  },

  // ====== 模态框 ======
  bindModal() {
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === document.getElementById('modal-overlay')) this.closeModal();
    });
  },

  showModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').classList.add('show');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.remove('show');
  },

  showAddStockModal() {
    const groups = Store.getGroups();
    const groupOptions = groups.map(g => '<option value="' + g.id + '"' + (g.id === this.currentGroup ? ' selected' : '') + '>' + g.name + '</option>').join('');
    const html =
      '<div class="modal-hint">输入股票代码（如 sz000009 / sh600519）</div>' +
      '<input type="text" id="modal-stock-code" placeholder="股票代码" autofocus>' +
      '<select id="modal-stock-group" style="width:100%;padding:10px 12px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:14px;margin-bottom:12px;outline:none;">' + groupOptions + '</select>' +
      '<button class="btn-primary" id="modal-add-confirm">添加</button>';

    this.showModal('添加股票', html);

    document.getElementById('modal-add-confirm').addEventListener('click', () => {
      const code = document.getElementById('modal-stock-code').value.trim().toLowerCase();
      const group = document.getElementById('modal-stock-group').value;

      if (!/^(sz|sh)\d{6}$/.test(code)) {
        alert('格式错误！请输入 sz/sh + 6位数字');
        return;
      }

      if (Store.addStock(group, code)) {
        this.closeModal();
        this.renderGroupTabs();
        this.renderStockList();
        this.refreshAll();
      } else {
        alert('已在该分组中');
      }
    });

    // 回车确认
    document.getElementById('modal-stock-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('modal-add-confirm').click();
    });
  },

  showGroupManageModal() {
    const groups = Store.getGroups();
    let html = '<div class="modal-hint">管理分组（拖拽排序暂不支持）</div>';
    html += groups.map((g, i) =>
      '<div class="group-manage-item">' +
        '<input type="text" value="' + g.name + '" data-idx="' + i + '" class="group-name-input">' +
        '<button data-del="' + i + '" title="删除">🗑️</button>' +
      '</div>'
    ).join('');
    html += '<div style="margin-top:12px;">' +
      '<input type="text" id="modal-new-group" placeholder="新分组名称">' +
      '<button class="btn-primary" id="modal-add-group" style="margin-top:8px;">添加分组</button>' +
    '</div>';

    this.showModal('分组管理', html);

    // 修改组名
    document.querySelectorAll('.group-name-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        const groups = Store.getGroups();
        groups[idx].name = input.value;
        Store.setGroups(groups);
        this.renderGroupTabs();
      });
    });

    // 删除分组
    document.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.del);
        const groups = Store.getGroups();
        const allStocks = Store.getStocks();
        const removedId = groups[idx].id;
        delete allStocks[removedId];
        groups.splice(idx, 1);
        Store.setGroups(groups);
        Store.setStocks(allStocks);
        if (this.currentGroup === removedId) {
          this.currentGroup = groups[0] ? groups[0].id : null;
        }
        this.closeModal();
        this.renderGroupTabs();
        this.renderStockList();
      });
    });

    // 添加分组
    document.getElementById('modal-add-group').addEventListener('click', () => {
      const name = document.getElementById('modal-new-group').value.trim();
      if (!name) return;
      const groups = Store.getGroups();
      const id = 'g_' + Date.now();
      groups.push({ id, name });
      Store.setGroups(groups);
      this.closeModal();
      this.renderGroupTabs();
    });
  },

  // ====== 数据刷新 ======
  async refreshAll() {
    const statusEl = document.getElementById('watchlist-refresh-status');
    statusEl.textContent = '刷新中...';

    try {
      // 更新模拟模式指示
      this.updateMockIndicator();

      // A股（自选 + 指数）
      const stockCodes = Store.getAllStockCodes();
      const indexCodes = ['sh000001', 'sz399001', 'sz399006'];
      const allCodes = [...new Set([...indexCodes, ...stockCodes])];

      const [stockResults, futuresResults, fundFlowResults, sectorResults] = await Promise.all([
        StockAPI.fetchRealtime(allCodes),
        StockAPI.fetchFuturesRealtime(Store.getFutures()),
        StockAPI.fetchFundFlowBatch(stockCodes.filter(c => !c.startsWith('nf_'))),
        StockAPI.fetchSectorList()
      ]);

      // 更新数据缓存
      stockResults.forEach(d => { this.stockData[d.code] = d; });
      futuresResults.forEach(d => { this.stockData[d.code] = d; });
      this.fundFlowData = fundFlowResults || {};
      this.sectorData = sectorResults || [];

      // 计算综合信号（模拟模式下直接用mock数据）
      if (MockData && MockData.shouldUseMock()) {
        const mockSignals = MockData.getComprehensiveSignals();
        this.compSignals = mockSignals;
      } else {
        // 实时模式：对每只股票计算综合信号
        for (const code of stockCodes) {
          const stock = this.stockData[code];
          if (!stock || stock.isFutures) continue;
          try {
            const klines = await StockAPI.fetchDailyKline(code, 30);
            const flow = this.fundFlowData[code];
            this.compSignals[code] = SignalDetector.calcComprehensiveSignal(stock, klines, flow);
          } catch { /* skip */ }
        }
      }

      // 更新UI
      this.updateIndexCards(stockResults);
      this.renderStockList();
      if (this.currentStock) this.updateStockInfo(this.currentStock);
      this.renderOverviewSignals();
      this.renderDecisionPanel();
      this.renderSectorAlerts();

      // 信号检测
      this.checkSignals([...stockResults, ...futuresResults]);

      const now = new Date();
      statusEl.textContent = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');
    } catch (e) {
      statusEl.textContent = '刷新失败';
      console.error('Refresh error:', e);
    }
  },

  checkSignals(allData) {
    const settings = Store.getSettings();
    const indexCodes = ['sh000001', 'sz399001', 'sz399006'];

    allData.forEach(d => {
      if (indexCodes.includes(d.code)) return; // 跳过指数
      const signals = SignalDetector.detectRealtime(d, settings);
      signals.forEach(sig => {
        if (!Store.checkCooldown(d.code, sig.type)) {
          Store.setCooldown(d.code, sig.type);
          const saved = Store.addSignal({
            code: d.code,
            name: d.name,
            type: sig.type,
            reason: sig.reason,
            price: d.price,
            changePercent: d.changePercent
          });

          // 浏览器通知
          if (settings.notification && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('📡 ' + d.name + ' 异动', {
              body: sig.reason + ' | ' + d.price.toFixed(2) + ' (' + (d.changePercent > 0 ? '+' : '') + d.changePercent.toFixed(2) + '%)',
              icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📈</text></svg>'
            });
          }

          // 声音提醒
          if (settings.sound) {
            this.playAlert();
          }
        }
      });
    });
  },

  playAlert() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) { /* ignore audio errors */ }
  },

  startAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    const settings = Store.getSettings();
    const interval = (settings.refreshInterval || 15) * 1000;

    this.refreshTimer = setInterval(() => {
      // 模拟模式下不需要频繁刷新（数据不变），但首次会刷
      if (MockData && MockData.shouldUseMock()) return;

      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const day = now.getDay();

      // 周末不刷新
      if (day === 0 || day === 6) return;

      // 交易时间 9:15 - 15:05（包含期货交易时间）
      const mins = h * 60 + m;
      // A股 9:15-15:05, 期货 9:00-15:00 + 21:00-23:30
      if ((mins >= 540 && mins <= 905) || (mins >= 1260 && mins <= 1410)) {
        this.refreshAll();
      }
    }, interval);
  }
};

// 启动
document.addEventListener('DOMContentLoaded', () => App.init());
