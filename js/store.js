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
      { id: 'focus', name: '热门' },
      { id: 'watch', name: '投机' },
      { id: 'ambush', name: '投资' }
    ]);
  },

  setGroups(groups) { this._set('sm_groups', groups); },

  // ---- 股票列表（按分组） ----
  // v20260307b: 33只自选股（戈叔确认）
  _defaultStocks: {
    focus: [
      'sz002056', 'sh600096', 'sz002487', 'sh601991', 'sh605090', 'sz300308', 'sz002594', 'sh600519', 'sz300661', 'sz002938', 'sh601318', 'sz300059', 'sh601988', 'sz300304', 'sz300394', 'sz002837', 'sh600186', 'sh601857', 'sh605117', 'sz300274', 'sh603259', 'sz002475', 'sz002371', 'sh600309', 'sz002192', 'sh603601', 'sh600988', 'sz002310', 'sh600276', 'sz300054', 'sz000155', 'sh601600', 'sh600602', 'sh600598', 'sh600487', 'sz300548'
    // 横店东磁、云天化、大金重工、大唐发电、九丰能源 等36只
    ]
  },

  _STOCK_VERSION: '20260330a',

  getStocks(groupId) {
    // 版本检查：如果版本不对，强制用新默认值
    const ver = this._get('sm_stocks_ver', null);
    if (ver !== this._STOCK_VERSION) {
      this._set('sm_stocks', this._defaultStocks);
      this._set('sm_stocks_ver', this._STOCK_VERSION);
    }
    const all = this._get('sm_stocks', this._defaultStocks);
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
  // 交易所 → 东方财富 market 映射
  _FUTURES_EXCHANGE: {
    // 郑商所 ZCE
    MA: 115, SA: 115, TA: 115, SR: 115, CF: 115, FG: 115, RM: 115,
    OI: 115, AP: 115, CJ: 115, PF: 115, PK: 115, SF: 115, SM: 115,
    UR: 115, ZC: 115, CY: 115, PX: 115, SH: 115,
    // 大商所 DCE
    C: 114, CS: 114, M: 114, Y: 114, P: 114, PP: 114, V: 114,
    L: 114, EB: 114, EG: 114, PG: 114, J: 114, JM: 114, I: 114,
    JD: 114, RR: 114, A: 114, B: 114, BB: 114, FB: 114, LH: 114,
    // 上期所 SHFE
    RB: 113, HC: 113, CU: 113, AL: 113, ZN: 113, NI: 113, SN: 113,
    AU: 113, AG: 113, SS: 113, BU: 113, RU: 113, SP: 113, FU: 113,
    PB: 113, WR: 113, AO: 113, BR: 113,
    // 上海能源 INE
    SC: 142, LU: 142, NR: 142, BC: 142, EC: 142,
    // 中金所 CFFEX
    IF: 8, IC: 8, IH: 8, IM: 8, T: 8, TF: 8, TS: 8, TL: 8
  },

  // code (如 'MA0') → 东方财富 secid (如 '115.MAM')
  _codeToSecid(code) {
    // 去掉尾部数字得到品种前缀: MA0→MA, RB0→RB, SC0→SC
    const prefix = code.replace(/\d+$/, '');
    const market = this._FUTURES_EXCHANGE[prefix];
    if (!market) return null;
    // 主连格式: 品种+M (如 MAM, RBM, AUM)
    return market + '.' + prefix + 'M';
  },

  _FUTURES_VERSION: '20260313a',

  getFutures() {
    const ver = this._get('sm_futures_ver', null);
    const defaults = [
      { code: 'MA0', name: '甲醇', secid: '115.MAM' },
      { code: 'SA0', name: '纯碱', secid: '115.SAM' },
      { code: 'SC0', name: '原油', secid: '142.SCM' },
      { code: 'RB0', name: '螺纹', secid: '113.RBM' },
      { code: 'AU0', name: '黄金', secid: '113.AUM' },
      { code: 'AG0', name: '白银', secid: '113.AGM' },
      { code: 'CU0', name: '铜', secid: '113.CUM' },
      { code: 'C0', name: '玉米', secid: '114.CM' },
      { code: 'TA0', name: 'PTA', secid: '115.TAM' },
      { code: 'V0', name: 'PVC', secid: '114.VM' }
    ];
    if (ver !== this._FUTURES_VERSION) {
      this._set('sm_futures', defaults);
      this._set('sm_futures_ver', this._FUTURES_VERSION);
      return defaults;
    }
    // 自动为旧数据补 secid（兼容 localStorage 中只有 sina 的记录）
    const list = this._get('sm_futures', defaults);
    let changed = false;
    list.forEach(f => {
      if (!f.secid) {
        f.secid = this._codeToSecid(f.code);
        changed = true;
      }
    });
    if (changed) this._set('sm_futures', list);
    return list;
  },

  setFutures(list) { this._set('sm_futures', list); },

  addFutures(code, name) {
    const list = this.getFutures();
    if (list.find(f => f.code === code)) return false;
    const secid = this._codeToSecid(code);
    if (!secid) return false; // 未知品种
    list.push({ code, name, secid });
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
      kdj: true,
      cci: false,
      notification: true,
      sound: true,
      mockMode: 'auto'  // true=强制模拟, false=强制实时, 'auto'=自动
    });
  },

  setSettings(s) { this._set('sm_settings', s); },

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
    ['sm_groups', 'sm_stocks', 'sm_futures', 'sm_settings', 'sm_signals'].forEach(key => {
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
    ['sm_groups', 'sm_stocks', 'sm_futures', 'sm_settings', 'sm_signals', 'sm_cooldown'].forEach(key => {
      localStorage.removeItem(key);
    });
  }
};
