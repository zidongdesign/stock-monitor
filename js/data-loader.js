/**
 * 数据加载器 - 从 data/ 目录加载服务端分析数据
 * 支持自动补入/淘汰系统：检测 watchlist 版本变化自动替换本地股票列表
 */
const DataLoader = {
  async loadAnalysis() {
    try {
      const resp = await fetch('data/analysis.json?t=' + Date.now());
      if (!resp.ok) return null;
      return await resp.json();
    } catch { return null; }
  },

  async loadWatchlist() {
    try {
      const resp = await fetch('data/watchlist.json?t=' + Date.now());
      if (!resp.ok) return null;
      return await resp.json();
    } catch { return null; }
  },

  async loadSectors() {
    try {
      const resp = await fetch('data/sectors.json?t=' + Date.now());
      if (!resp.ok) return null;
      return await resp.json();
    } catch { return null; }
  },

  async loadHistory() {
    try {
      const resp = await fetch('data/history.json?t=' + Date.now());
      if (!resp.ok) return null;
      return await resp.json();
    } catch { return null; }
  },

  // 检查是否需要更新自选股列表
  shouldUpdateStocks(remoteVersion) {
    const localVer = Store._STOCK_VERSION;
    return remoteVersion && remoteVersion > localVer;
  },

  /**
   * 同步自选池：从 watchlist.json 同步到本地 Store
   * 返回 { updated, added, removed } 或 null
   */
  async syncPool() {
    const wl = await this.loadWatchlist();
    if (!wl || !wl.version) return null;

    if (!this.shouldUpdateStocks(wl.version)) return null;

    // 从 watchlist.json 构建股票列表（全部放 focus 组）
    const newStocks = { focus: [] };
    if (wl.stocks && Array.isArray(wl.stocks)) {
      for (const s of wl.stocks) {
        const group = s.group || 'focus';
        if (!newStocks[group]) newStocks[group] = [];
        newStocks[group].push(s.code);
      }
    }

    // 更新 Store
    Store.setStocks(newStocks);
    Store._STOCK_VERSION = wl.version;
    Store._set('sm_stocks_ver', wl.version);

    console.log(`[DataLoader] 自选池已同步: v${wl.version}, ${wl.stocks?.length || 0}只`);

    return {
      updated: true,
      version: wl.version,
      added: wl.todayAdded || [],
      removed: wl.todayRemoved || [],
      dayCount: wl.dayCount || 0,
    };
  },

  /**
   * 渲染今日变动标记
   * @param {HTMLElement} container - 容器元素
   * @param {Object} syncResult - syncPool() 的返回值
   */
  renderPoolChanges(container, syncResult) {
    if (!syncResult || !container) return;

    const { added, removed, dayCount, version } = syncResult;
    if ((!added || !added.length) && (!removed || !removed.length)) return;

    const div = document.createElement('div');
    div.className = 'pool-changes';
    div.style.cssText = 'padding:8px 12px;margin:8px 0;border-radius:6px;background:#f8f9fa;font-size:13px;';

    let html = `<div style="color:#666;margin-bottom:4px;">📊 自选池 v${version} · 第${dayCount}天</div>`;

    if (added && added.length) {
      html += `<div style="color:#16a34a;">➕ 今日新增: ${added.join(', ')}</div>`;
    }
    if (removed && removed.length) {
      html += `<div style="color:#9ca3af;">❌ 今日淘汰: ${removed.join(', ')}</div>`;
    }

    div.innerHTML = html;
    container.prepend(div);
  }
};
