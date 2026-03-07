/**
 * 数据存储模块 - localStorage 管理
 */
const Store = {
  _cache: {},

  _get(key, def) {
    if (key in this._cache) return this._cache[key];
    try {
      const raw = localStorage.getItem(key);
      const val = raw !== null ? JSON.parse(raw) : def;
      this._cache[key] = val;
      return val;
    } catch { return def; }
  },

  _set(key, val) {
    this._cache[key] = val;
    localStorage.setItem(key, JSON.stringify(val));
  },

  // ---- 分组管理 ----
  getGroups() {
    return this._get('sm_groups', [
      { id: 'focus', name: '重点跟踪' },
      { id: 'watch', name: '观察' },
      { id: 'ambush', name: '前瞻埋伏' }
    ]);
  },

  setGroups(groups) { this._set('sm_groups', groups); },

  // ---- 股票列表（按分组） ----
  getStocks(groupId) {
    const all = this._get('sm_stocks', {
      focus: ['sz301265', 'sz300323', 'sz002927', 'sh688759', 'sz002063'],
      watch: ['sz301032', 'sh603158', 'sz000570', 'sz002227', 'sh603716'],
      ambush: ['sz002157', 'sz300491', 'sh603826', 'sz300143', 'sz002877']
    });
    return groupId ? (all[groupId] || []) : all;
  },

  setStocks(allStocks) { this._set('sm_stocks', allStocks); },

  addStock(groupId, code) {
    const all = this.getStocks();
    if (!all[groupId]) all[groupId] = [];
    if (all[groupId].includes(code)) return false;
    all[groupId].push(code);
    this.setStocks(all);
    return true;
  },

  removeStock(groupId, code) {
    const all = this.getStocks();
    if (!all[groupId]) return;
    all[groupId] = all[groupId].filter(c => c !== code);
    this.setStocks(all);
  },

  getAllStockCodes() {
    const all = this.getStocks();
    const codes = new Set();
    Object.values(all).forEach(arr => arr.forEach(c => codes.add(c)));
    return [...codes];
  },

  // ---- 期货品种 ----
  getFutures() {
    return this._get('sm_futures', [
      { code: 'MA0', name: '甲醇', sina: 'nf_MA0' },
      { code: 'SA0', name: '纯碱', sina: 'nf_SA0' },
      { code: 'SC0', name: '原油', sina: 'nf_SC0' },
      { code: 'RB0', name: '螺纹', sina: 'nf_RB0' },
      { code: 'AU0', name: '黄金', sina: 'nf_AU0' },
      { code: 'AG0', name: '白银', sina: 'nf_AG0' },
      { code: 'CU0', name: '铜', sina: 'nf_CU0' }
    ]);
  },

  setFutures(list) { this._set('sm_futures', list); },

  addFutures(code, name) {
    const list = this.getFutures();
    if (list.find(f => f.code === code)) return false;
    list.push({ code, name, sina: 'nf_' + code });
    this.setFutures(list);
    return true;
  },

  removeFutures(code) {
    const list = this.getFutures().filter(f => f.code !== code);
    this.setFutures(list);
  },

  // ---- 设置 ----
  getSettings() {
    return this._get('sm_settings', {
      refreshInterval: 15,
      volumeRatioThreshold: 3,
      changePctThreshold: 1,
      turnoverThreshold: 10,
      macd: true,
      kdj: false,
      cci: false,
      notification: true,
      sound: true,
      mockMode: 'auto'  // true=强制模拟, false=强制实时, 'auto'=自动
    });
  },

  setSettings(s) { this._set('sm_settings', s); },

  // ---- 大盘定性 ----
  getAssessment() {
    return this._get('sm_assessment', { level: null, note: '', time: null, date: null });
  },

  setAssessment(a) {
    a.time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    a.date = new Date().toISOString().slice(0, 10);
    this._set('sm_assessment', a);
  },

  // ---- 信号历史 ----
  getSignals() {
    return this._get('sm_signals', []);
  },

  addSignal(signal) {
    const signals = this.getSignals();
    signal.id = Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    signal.time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    signal.date = new Date().toISOString().slice(0, 10);
    signals.unshift(signal);
    // 保留最近 500 条
    if (signals.length > 500) signals.length = 500;
    this._set('sm_signals', signals);
    return signal;
  },

  clearSignals() { this._set('sm_signals', []); },

  // ---- 信号冷却（同股同天同类型只触发一次） ----
  getSignalCooldown() {
    const data = this._get('sm_cooldown', { date: null, keys: {} });
    const today = new Date().toISOString().slice(0, 10);
    if (data.date !== today) return { date: today, keys: {} };
    return data;
  },

  checkCooldown(code, type) {
    const cd = this.getSignalCooldown();
    const key = `${code}_${type}`;
    return !!cd.keys[key];
  },

  setCooldown(code, type) {
    const cd = this.getSignalCooldown();
    const key = `${code}_${type}`;
    cd.keys[key] = true;
    this._set('sm_cooldown', cd);
  },

  // ---- 资金流向缓存 ----
  getFundFlowCache() {
    return this._get('sm_fundflow', {});
  },

  setFundFlowCache(data) {
    this._set('sm_fundflow', data);
  },

  // ---- 综合信号缓存 ----
  getCompSignalCache() {
    return this._get('sm_compsignal', {});
  },

  setCompSignalCache(data) {
    this._set('sm_compsignal', data);
  },

  // ---- 导出/导入 ----
  exportAll() {
    const data = {};
    ['sm_groups', 'sm_stocks', 'sm_futures', 'sm_settings', 'sm_assessment', 'sm_signals'].forEach(key => {
      const raw = localStorage.getItem(key);
      if (raw) data[key] = JSON.parse(raw);
    });
    return data;
  },

  importAll(data) {
    this._cache = {};
    Object.entries(data).forEach(([key, val]) => {
      localStorage.setItem(key, JSON.stringify(val));
    });
  },

  clearAll() {
    this._cache = {};
    ['sm_groups', 'sm_stocks', 'sm_futures', 'sm_settings', 'sm_assessment', 'sm_signals', 'sm_cooldown'].forEach(key => {
      localStorage.removeItem(key);
    });
  }
};
