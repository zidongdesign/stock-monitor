/**
 * 模拟数据模块
 * 周末/非交易时间提供完整模拟数据以展示所有功能
 */
const MockData = {
  // 是否在交易时间
  isTradingTime() {
    const now = new Date();
    const day = now.getDay();
    if (day === 0 || day === 6) return false;
    const mins = now.getHours() * 60 + now.getMinutes();
    return (mins >= 555 && mins <= 905); // 9:15-15:05
  },

  // 是否应使用模拟数据
  shouldUseMock() {
    const settings = Store.getSettings();
    if (settings.mockMode === false) return false;
    if (settings.mockMode === true) return true;
    // 默认：auto - 非交易时间用模拟
    return !this.isTradingTime();
  },

  // ========== 20只模拟自选股 ==========
  getStockList() {
    return {
      focus: ['sz301265', 'sz300323', 'sz002927', 'sh688759', 'sz002063'],
      watch: ['sz301032', 'sh603158', 'sz000570', 'sz002227', 'sh603716'],
      ambush: ['sz002157', 'sz300491', 'sh603826', 'sz300143', 'sz002877',
               'sz000998', 'sh600519', 'sz000333', 'sh601318', 'sz000651']
    };
  },

  // 模拟实时行情数据
  getRealtimeData() {
    const stocks = [
      // 重点跟踪 - 混合信号
      { code: 'sz301265', name: '华新环保', price: 12.35, prevClose: 11.97, open: 12.05, high: 12.68, low: 11.95, volume: 18520000, amount: 228000000, changePercent: 3.17, change: 0.38, volumeRatio: 2.8, turnover: 8.5 },
      { code: 'sz300323', name: '华灿光电', price: 9.88, prevClose: 9.62, open: 9.70, high: 10.05, low: 9.55, volume: 32100000, amount: 316000000, changePercent: 2.70, change: 0.26, volumeRatio: 1.9, turnover: 5.2 },
      { code: 'sz002927', name: '泰永长征', price: 15.60, prevClose: 15.93, open: 15.80, high: 16.05, low: 15.42, volume: 8900000, amount: 139000000, changePercent: -2.07, change: -0.33, volumeRatio: 0.8, turnover: 3.1 },
      { code: 'sh688759', name: '梅花数据', price: 28.75, prevClose: 27.90, open: 28.10, high: 29.30, low: 27.80, volume: 5620000, amount: 162000000, changePercent: 3.05, change: 0.85, volumeRatio: 2.1, turnover: 4.8 },
      { code: 'sz002063', name: '远光软件', price: 8.72, prevClose: 8.59, open: 8.60, high: 8.85, low: 8.50, volume: 12300000, amount: 107000000, changePercent: 1.51, change: 0.13, volumeRatio: 1.2, turnover: 2.8 },
      // 观察 - 偏中性
      { code: 'sz301032', name: '新点软件', price: 22.40, prevClose: 22.15, open: 22.20, high: 22.80, low: 22.00, volume: 4560000, amount: 102000000, changePercent: 1.13, change: 0.25, volumeRatio: 1.1, turnover: 2.3 },
      { code: 'sh603158', name: '腾龙股份', price: 14.25, prevClose: 14.50, open: 14.40, high: 14.60, low: 14.10, volume: 6780000, amount: 97000000, changePercent: -1.72, change: -0.25, volumeRatio: 0.9, turnover: 1.8 },
      { code: 'sz000570', name: '苏常柴A', price: 7.85, prevClose: 7.82, open: 7.80, high: 7.95, low: 7.75, volume: 9100000, amount: 71000000, changePercent: 0.38, change: 0.03, volumeRatio: 1.0, turnover: 1.5 },
      { code: 'sz002227', name: '奥特迅', price: 11.30, prevClose: 11.45, open: 11.40, high: 11.55, low: 11.18, volume: 7800000, amount: 88000000, changePercent: -1.31, change: -0.15, volumeRatio: 0.7, turnover: 2.1 },
      { code: 'sh603716', name: '塞力医疗', price: 6.28, prevClose: 6.20, open: 6.22, high: 6.38, low: 6.15, volume: 15200000, amount: 95000000, changePercent: 1.29, change: 0.08, volumeRatio: 1.3, turnover: 3.5 },
      // 前瞻埋伏 - 混合
      { code: 'sz002157', name: '正邦科技', price: 5.42, prevClose: 5.55, open: 5.50, high: 5.58, low: 5.35, volume: 28500000, amount: 155000000, changePercent: -2.34, change: -0.13, volumeRatio: 1.5, turnover: 4.2 },
      { code: 'sz300491', name: '通合科技', price: 18.90, prevClose: 18.30, open: 18.50, high: 19.20, low: 18.25, volume: 11200000, amount: 212000000, changePercent: 3.28, change: 0.60, volumeRatio: 2.5, turnover: 6.1 },
      { code: 'sh603826', name: '坤彩科技', price: 31.50, prevClose: 31.20, open: 31.30, high: 32.00, low: 31.05, volume: 3450000, amount: 109000000, changePercent: 0.96, change: 0.30, volumeRatio: 0.9, turnover: 1.7 },
      { code: 'sz300143', name: '盈康生命', price: 7.15, prevClose: 7.25, open: 7.20, high: 7.30, low: 7.08, volume: 8900000, amount: 64000000, changePercent: -1.38, change: -0.10, volumeRatio: 0.8, turnover: 2.0 },
      { code: 'sz002877', name: '智能自控', price: 10.82, prevClose: 10.55, open: 10.60, high: 11.05, low: 10.50, volume: 16800000, amount: 182000000, changePercent: 2.56, change: 0.27, volumeRatio: 2.2, turnover: 5.8 },
      { code: 'sz000998', name: '隆平高科', price: 22.15, prevClose: 20.93, open: 21.20, high: 22.50, low: 21.00, volume: 42000000, amount: 930000000, changePercent: 5.83, change: 1.22, volumeRatio: 4.2, turnover: 12.5 },
      { code: 'sh600519', name: '贵州茅台', price: 1586.00, prevClose: 1580.00, open: 1582.00, high: 1592.00, low: 1575.00, volume: 3200000, amount: 5070000000, changePercent: 0.38, change: 6.00, volumeRatio: 0.9, turnover: 0.3 },
      { code: 'sz000333', name: '美的集团', price: 68.50, prevClose: 67.80, open: 68.00, high: 69.20, low: 67.50, volume: 18500000, amount: 1270000000, changePercent: 1.03, change: 0.70, volumeRatio: 1.1, turnover: 0.8 },
      { code: 'sh601318', name: '中国平安', price: 52.30, prevClose: 53.10, open: 52.80, high: 53.20, low: 51.90, volume: 25600000, amount: 1340000000, changePercent: -1.51, change: -0.80, volumeRatio: 1.0, turnover: 0.5 },
      { code: 'sz000651', name: '格力电器', price: 41.25, prevClose: 40.80, open: 40.90, high: 41.60, low: 40.70, volume: 21300000, amount: 878000000, changePercent: 1.10, change: 0.45, volumeRatio: 1.2, turnover: 0.7 }
    ];

    // 补充isFutures字段
    return stocks.map(s => ({ ...s, isFutures: false }));
  },

  // 模拟三大指数
  getIndexData() {
    return [
      { code: 'sh000001', name: '上证指数', price: 3256.78, prevClose: 3240.50, open: 3242.00, high: 3268.30, low: 3235.20, volume: 28500000000, amount: 358000000000, changePercent: 0.50, change: 16.28, volumeRatio: 1.1, turnover: 0, isFutures: false },
      { code: 'sz399001', name: '深证成指', price: 10328.45, prevClose: 10285.60, open: 10290.00, high: 10365.80, low: 10270.50, volume: 35200000000, amount: 452000000000, changePercent: 0.42, change: 42.85, volumeRatio: 1.0, turnover: 0, isFutures: false },
      { code: 'sz399006', name: '创业板指', price: 2058.32, prevClose: 2042.15, open: 2045.00, high: 2072.50, low: 2038.80, volume: 12800000000, amount: 168000000000, changePercent: 0.79, change: 16.17, volumeRatio: 1.2, turnover: 0, isFutures: false }
    ];
  },

  // 模拟期货数据
  getFuturesData() {
    return [
      { code: 'nf_MA0', name: '甲醇主连', displayCode: 'MA0', price: 2485.00, prevClose: 2468.00, open: 2472.00, high: 2498.00, low: 2460.00, volume: 856000, amount: 0, changePercent: 0.69, change: 17.00, volumeRatio: 0, turnover: 0, isFutures: true },
      { code: 'nf_SA0', name: '纯碱主连', displayCode: 'SA0', price: 1628.00, prevClose: 1645.00, open: 1640.00, high: 1650.00, low: 1620.00, volume: 1250000, amount: 0, changePercent: -1.03, change: -17.00, volumeRatio: 0, turnover: 0, isFutures: true },
      { code: 'nf_SC0', name: '原油主连', displayCode: 'SC0', price: 568.50, prevClose: 565.20, open: 566.00, high: 572.00, low: 563.80, volume: 320000, amount: 0, changePercent: 0.58, change: 3.30, volumeRatio: 0, turnover: 0, isFutures: true },
      { code: 'nf_RB0', name: '螺纹主连', displayCode: 'RB0', price: 3542.00, prevClose: 3558.00, open: 3550.00, high: 3560.00, low: 3530.00, volume: 2150000, amount: 0, changePercent: -0.45, change: -16.00, volumeRatio: 0, turnover: 0, isFutures: true },
      { code: 'nf_AU0', name: '黄金主连', displayCode: 'AU0', price: 582.60, prevClose: 578.50, open: 579.00, high: 584.20, low: 577.80, volume: 185000, amount: 0, changePercent: 0.71, change: 4.10, volumeRatio: 0, turnover: 0, isFutures: true },
      { code: 'nf_AG0', name: '白银主连', displayCode: 'AG0', price: 7568.00, prevClose: 7520.00, open: 7530.00, high: 7595.00, low: 7505.00, volume: 425000, amount: 0, changePercent: 0.64, change: 48.00, volumeRatio: 0, turnover: 0, isFutures: true },
      { code: 'nf_CU0', name: '铜主连', displayCode: 'CU0', price: 72850.00, prevClose: 72600.00, open: 72680.00, high: 73100.00, low: 72500.00, volume: 168000, amount: 0, changePercent: 0.34, change: 250.00, volumeRatio: 0, turnover: 0, isFutures: true }
    ];
  },

  // ========== 模拟资金流向 ==========
  getFundFlowData() {
    return {
      'sz301265': { mainNet: 3800, bigBuy: 8500, bigSell: 4700, trend: 'in', mainNetRaw: 38000000 },
      'sz300323': { mainNet: 1200, bigBuy: 5200, bigSell: 4000, trend: 'in', mainNetRaw: 12000000 },
      'sz002927': { mainNet: -2100, bigBuy: 3200, bigSell: 5300, trend: 'out', mainNetRaw: -21000000 },
      'sh688759': { mainNet: 2500, bigBuy: 6800, bigSell: 4300, trend: 'in', mainNetRaw: 25000000 },
      'sz002063': { mainNet: 500, bigBuy: 3100, bigSell: 2600, trend: 'neutral', mainNetRaw: 5000000 },
      'sz301032': { mainNet: 350, bigBuy: 2800, bigSell: 2450, trend: 'neutral', mainNetRaw: 3500000 },
      'sh603158': { mainNet: -800, bigBuy: 2100, bigSell: 2900, trend: 'out', mainNetRaw: -8000000 },
      'sz000570': { mainNet: 120, bigBuy: 1500, bigSell: 1380, trend: 'neutral', mainNetRaw: 1200000 },
      'sz002227': { mainNet: -1500, bigBuy: 1800, bigSell: 3300, trend: 'out', mainNetRaw: -15000000 },
      'sh603716': { mainNet: 680, bigBuy: 2200, bigSell: 1520, trend: 'in', mainNetRaw: 6800000 },
      'sz002157': { mainNet: -3200, bigBuy: 2800, bigSell: 6000, trend: 'out', mainNetRaw: -32000000 },
      'sz300491': { mainNet: 4200, bigBuy: 9500, bigSell: 5300, trend: 'in', mainNetRaw: 42000000 },
      'sh603826': { mainNet: 280, bigBuy: 3200, bigSell: 2920, trend: 'neutral', mainNetRaw: 2800000 },
      'sz300143': { mainNet: -950, bigBuy: 1600, bigSell: 2550, trend: 'out', mainNetRaw: -9500000 },
      'sz002877': { mainNet: 1800, bigBuy: 5600, bigSell: 3800, trend: 'in', mainNetRaw: 18000000 },
      'sz000998': { mainNet: 12000, bigBuy: 28000, bigSell: 16000, trend: 'in', mainNetRaw: 120000000 },
      'sh600519': { mainNet: 5200, bigBuy: 18000, bigSell: 12800, trend: 'in', mainNetRaw: 52000000 },
      'sz000333': { mainNet: 800, bigBuy: 8500, bigSell: 7700, trend: 'neutral', mainNetRaw: 8000000 },
      'sh601318': { mainNet: -4500, bigBuy: 12000, bigSell: 16500, trend: 'out', mainNetRaw: -45000000 },
      'sz000651': { mainNet: 1500, bigBuy: 6800, bigSell: 5300, trend: 'in', mainNetRaw: 15000000 }
    };
  },

  // ========== 模拟综合评分 ==========
  getComprehensiveSignals() {
    return {
      'sz301265': { level: 'buy', emoji: '🟢', label: '买入关注', score: 75, reason: '主力净流入+3800万，MACD即将金叉，缩量回踩MA10支撑' },
      'sz300323': { level: 'buy', emoji: '🟢', label: '买入关注', score: 68, reason: '量比1.9放量上涨，站上MA5/MA10，资金持续流入' },
      'sz002927': { level: 'sell', emoji: '🔴', label: '注意风险', score: 28, reason: '主力净流出-2100万，跌破MA10，MACD死叉形成' },
      'sh688759': { level: 'buy', emoji: '🟢', label: '买入关注', score: 72, reason: '放量突破前高，主力大幅净流入，KDJ金叉共振' },
      'sz002063': { level: 'hold', emoji: '🟡', label: '持有观察', score: 52, reason: '资金小幅流入，均线多头排列，等待放量确认' },
      'sz301032': { level: 'hold', emoji: '🟡', label: '持有观察', score: 55, reason: '窄幅震荡整理，量能平淡，等待方向选择' },
      'sh603158': { level: 'sell', emoji: '🔴', label: '注意风险', score: 32, reason: '资金流出，缩量下跌，MA5下穿MA10' },
      'sz000570': { level: 'hold', emoji: '🟡', label: '持有观察', score: 50, reason: '横盘整理，资金面平淡，无明显方向' },
      'sz002227': { level: 'sell', emoji: '🔴', label: '注意风险', score: 25, reason: '主力净流出-1500万，KDJ死叉，量价背离' },
      'sh603716': { level: 'hold', emoji: '🟡', label: '持有观察', score: 58, reason: '小幅反弹，资金小幅流入，观察能否站上MA20' },
      'sz002157': { level: 'sell', emoji: '🔴', label: '注意风险', score: 20, reason: '主力大幅净流出-3200万，破位下跌，远离均线系统' },
      'sz300491': { level: 'buy', emoji: '🟢', label: '买入关注', score: 78, reason: '主力净流入+4200万，放量涨停，MACD金叉，强势突破' },
      'sh603826': { level: 'hold', emoji: '🟡', label: '持有观察', score: 53, reason: '温和上涨，量能一般，MA均线粘合待突破' },
      'sz300143': { level: 'sell', emoji: '🔴', label: '注意风险', score: 30, reason: '资金流出加速，跌破MA20关键支撑' },
      'sz002877': { level: 'buy', emoji: '🟢', label: '买入关注', score: 70, reason: '放量突破，主力净流入+1800万，MACD红柱放大' },
      'sz000998': { level: 'buy', emoji: '🟢', label: '买入关注', score: 85, reason: '主力净流入+1.2亿，涨停板放量，多指标共振强烈看多' },
      'sh600519': { level: 'hold', emoji: '🟡', label: '持有观察', score: 56, reason: '大盘股稳健，资金小幅流入，均线支撑良好' },
      'sz000333': { level: 'hold', emoji: '🟡', label: '持有观察', score: 54, reason: '温和上涨，资金面中性，关注突破前高压力' },
      'sh601318': { level: 'sell', emoji: '🔴', label: '注意风险', score: 28, reason: '主力净流出-4500万，跌破MA5/MA10，保险板块承压' },
      'sz000651': { level: 'hold', emoji: '🟡', label: '持有观察', score: 57, reason: '资金小幅流入，站上MA5，等待量能配合' }
    };
  },

  // ========== 模拟板块异动 ==========
  getSectorData() {
    return [
      { name: '人工智能', code: 'BK0800', changePercent: 3.85, leader: '科大讯飞', leaderChange: 6.2, relatedCodes: ['sz002063', 'sh688759'] },
      { name: '新能源', code: 'BK0478', changePercent: 2.56, leader: '宁德时代', leaderChange: 3.8, relatedCodes: ['sz300491'] },
      { name: '半导体', code: 'BK0485', changePercent: 2.12, leader: '中芯国际', leaderChange: 4.5, relatedCodes: ['sz300323'] },
      { name: '农业种植', code: 'BK0477', changePercent: 4.28, leader: '隆平高科', leaderChange: 5.8, relatedCodes: ['sz000998'] },
      { name: '白酒', code: 'BK0437', changePercent: 0.68, leader: '贵州茅台', leaderChange: 0.4, relatedCodes: ['sh600519'] },
      { name: '保险', code: 'BK0474', changePercent: -2.35, leader: '中国平安', leaderChange: -1.5, relatedCodes: ['sh601318'] },
      { name: '环保', code: 'BK0730', changePercent: 3.12, leader: '华新环保', leaderChange: 3.2, relatedCodes: ['sz301265'] },
      { name: '家电', code: 'BK0438', changePercent: 1.05, leader: '美的集团', leaderChange: 1.0, relatedCodes: ['sz000333', 'sz000651'] },
      { name: '化工', code: 'BK0479', changePercent: -1.82, leader: '万华化学', leaderChange: -2.1, relatedCodes: [] },
      { name: '医药生物', code: 'BK0465', changePercent: -2.68, leader: '恒瑞医药', leaderChange: -3.2, relatedCodes: ['sz300143'] },
      { name: '军工', code: 'BK0481', changePercent: 1.95, leader: '中航沈飞', leaderChange: 3.5, relatedCodes: [] },
      { name: '房地产', code: 'BK0451', changePercent: -3.15, leader: '万科A', leaderChange: -4.2, relatedCodes: [] }
    ];
  },

  // 获取板块异动信号（涨跌>2%的板块）
  getSectorSignals() {
    const sectors = this.getSectorData();
    const allCodes = Store.getAllStockCodes();
    return sectors.filter(s => Math.abs(s.changePercent) >= 2).map(s => {
      const related = s.relatedCodes.filter(c => allCodes.includes(c));
      return {
        ...s,
        isAlert: true,
        hasRelated: related.length > 0,
        relatedNames: related
      };
    });
  },

  // ========== 模拟分时数据 ==========
  getMinuteData(code) {
    const stock = this.getRealtimeData().find(s => s.code === code);
    if (!stock) return [];
    const base = stock.prevClose;
    const target = stock.price;
    const data = [];
    // 生成240个点（9:30-15:00）
    for (let i = 0; i < 240; i++) {
      const progress = i / 239;
      const trend = base + (target - base) * progress;
      const noise = (Math.random() - 0.5) * base * 0.005;
      const price = +(trend + noise).toFixed(2);
      const h = Math.floor(i / 60) + 9;
      const m = (30 + i) % 60;
      const hour = h + Math.floor((30 + i) / 60);
      const minute = (30 + i) % 60;
      // skip 11:30-13:00 lunch break
      let realHour, realMin;
      if (i < 120) {
        realHour = 9 + Math.floor((30 + i) / 60);
        realMin = (30 + i) % 60;
      } else {
        const afterLunch = i - 120;
        realHour = 13 + Math.floor(afterLunch / 60);
        realMin = afterLunch % 60;
      }
      data.push({
        time: String(realHour).padStart(2, '0') + ':' + String(realMin).padStart(2, '0'),
        price: price,
        volume: Math.floor(Math.random() * 50000 + 10000)
      });
    }
    return data;
  },

  // ========== 模拟日K线数据 ==========
  getDailyKlineData(code, count) {
    count = count || 120;
    const stock = this.getRealtimeData().find(s => s.code === code);
    if (!stock) return [];
    
    const data = [];
    let close = stock.price * (0.7 + Math.random() * 0.2); // 从几个月前开始
    const now = new Date();
    
    for (let i = count; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      // skip weekends
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      
      const change = (Math.random() - 0.48) * close * 0.04; // slight upward bias
      const open = +(close + (Math.random() - 0.5) * close * 0.02).toFixed(2);
      close = +(close + change).toFixed(2);
      if (close < 1) close = 1;
      const high = +(Math.max(open, close) + Math.random() * close * 0.015).toFixed(2);
      const low = +(Math.min(open, close) - Math.random() * close * 0.015).toFixed(2);
      const volume = Math.floor(Math.random() * 20000000 + 5000000);
      
      data.push({
        date: date.toISOString().slice(0, 10),
        open, close, high, low, volume
      });
    }
    
    // 确保最后一根K线接近当前价格
    if (data.length > 0) {
      const last = data[data.length - 1];
      last.close = stock.price;
      last.high = Math.max(last.high, stock.price);
      last.low = Math.min(last.low, stock.price);
    }
    
    return data;
  },

  // 模拟周K线
  getWeeklyKlineData(code, count) {
    const daily = this.getDailyKlineData(code, (count || 60) * 5);
    if (daily.length === 0) return [];
    
    const weekly = [];
    let weekData = null;
    
    daily.forEach(d => {
      const date = new Date(d.date);
      const weekDay = date.getDay();
      
      if (!weekData || weekDay === 1) {
        if (weekData) weekly.push(weekData);
        weekData = { date: d.date, open: d.open, close: d.close, high: d.high, low: d.low, volume: d.volume };
      } else {
        weekData.close = d.close;
        weekData.high = Math.max(weekData.high, d.high);
        weekData.low = Math.min(weekData.low, d.low);
        weekData.volume += d.volume;
      }
    });
    if (weekData) weekly.push(weekData);
    
    return weekly.slice(-count);
  }
};
