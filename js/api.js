/**
 * 行情数据接口模块
 * A股: 腾讯 qt.gtimg.cn (JSONP)
 * A股K线: 腾讯 web.ifzq.gtimg.cn (fetch JSON)
 * 期货: 新浪 hq.sinajs.cn (JSONP)
 * 分时: 东方财富 push2his.eastmoney.com
 * 资金流向: 东方财富 push2.eastmoney.com
 */
const StockAPI = {

  // ====== 股票代码 → 东方财富 secid 转换 ======
  _toSecid(code) {
    // sz000001 → 0.000001, sh600519 → 1.600519
    if (code.startsWith('sz')) return '0.' + code.slice(2);
    if (code.startsWith('sh')) return '1.' + code.slice(2);
    return code;
  },

  // ====== 资金流向（东方财富实时资金流） ======
  fetchFundFlow(code) {
    if (MockData && MockData.shouldUseMock()) {
      const flowData = MockData.getFundFlowData();
      return Promise.resolve(flowData[code] || null);
    }

    const secid = this._toSecid(code);
    const url = 'https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?lmt=0&klt=1&secid=' + secid + '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63&ut=b2884a393a59ad64002292a3e90d46a5&cb=';
    
    return fetch(url)
      .then(r => r.json())
      .then(json => {
        const klines = json?.data?.klines;
        if (!klines || klines.length === 0) return null;
        
        // 累计今日资金流
        let mainNet = 0, bigBuy = 0, bigSell = 0;
        klines.forEach(line => {
          const parts = line.split(',');
          // f52=主力净流入, f53=小单净流入, f54=中单净流入, f55=大单净流入, f56=超大单净流入
          mainNet = parseFloat(parts[1]) || 0; // 累计主力净流入
        });
        
        const last = klines[klines.length - 1].split(',');
        mainNet = parseFloat(last[1]) || 0;
        
        // 判断趋势
        let trend = 'neutral';
        if (klines.length >= 3) {
          const recent = klines.slice(-3).map(l => parseFloat(l.split(',')[1]) || 0);
          const increasing = recent[2] > recent[1] && recent[1] > recent[0];
          const decreasing = recent[2] < recent[1] && recent[1] < recent[0];
          if (increasing && mainNet > 0) trend = 'in';
          else if (decreasing && mainNet < 0) trend = 'out';
        } else {
          trend = mainNet > 5000000 ? 'in' : mainNet < -5000000 ? 'out' : 'neutral';
        }

        return {
          mainNet: Math.round(mainNet / 10000), // 万元
          mainNetRaw: mainNet,
          bigBuy: 0,
          bigSell: 0,
          trend
        };
      })
      .catch(() => null);
  },

  // 批量获取资金流向
  fetchFundFlowBatch(codes) {
    if (!codes || codes.length === 0) return Promise.resolve({});
    if (MockData && MockData.shouldUseMock()) {
      return Promise.resolve(MockData.getFundFlowData());
    }
    // 逐个请求（东方财富无批量接口），限制并发
    const results = {};
    const tasks = codes.map(code =>
      this.fetchFundFlow(code).then(data => { if (data) results[code] = data; })
    );
    return Promise.all(tasks).then(() => results);
  },

  // ====== 板块实时排名（东方财富） ======
  fetchSectorList() {
    if (MockData && MockData.shouldUseMock()) {
      return Promise.resolve(MockData.getSectorData());
    }

    const url = 'https://push2.eastmoney.com/api/qt/clist/get?fid=f3&po=1&pz=30&np=1&fs=m:90+t:2&fields=f2,f3,f4,f12,f14,f128,f140,f136&ut=b2884a393a59ad64002292a3e90d46a5&cb=';
    
    return fetch(url)
      .then(r => r.json())
      .then(json => {
        const list = json?.data?.diff;
        if (!list) return [];
        return Object.values(list).map(item => ({
          name: item.f14,
          code: item.f12,
          changePercent: item.f3 / 100 || 0,
          leader: item.f140 || item.f128 || '--',
          leaderChange: item.f136 / 100 || 0,
          relatedCodes: []
        }));
      })
      .catch(() => []);
  },
  // ====== A股实时行情（腾讯 JSONP） ======
  fetchRealtime(codes) {
    if (!codes || codes.length === 0) return Promise.resolve([]);
    
    // 模拟模式
    if (MockData && MockData.shouldUseMock()) {
      const allMock = [...MockData.getIndexData(), ...MockData.getRealtimeData()];
      return Promise.resolve(allMock.filter(s => codes.includes(s.code)));
    }

    return new Promise((resolve) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => { script.remove(); resolve([]); }, 8000);

      // 清除旧全局变量
      codes.forEach(code => { delete window['v_' + code]; });

      script.src = 'https://qt.gtimg.cn/q=' + codes.join(',') + '&r=' + Date.now();
      script.onerror = () => { clearTimeout(timeout); script.remove(); resolve([]); };
      script.onload = () => {
        clearTimeout(timeout);
        script.remove();

        const results = [];
        codes.forEach(code => {
          const raw = window['v_' + code];
          if (raw) {
            const parsed = this._parseQQ(code, raw);
            if (parsed) results.push(parsed);
          }
        });
        resolve(results);
      };
      document.head.appendChild(script);
    });
  },

  _parseQQ(code, raw) {
    const f = raw.split('~');
    if (f.length < 45) return null;
    const price = parseFloat(f[3]);
    if (!price || price === 0) return null;
    const prevClose = parseFloat(f[4]);
    return {
      code,
      name: f[1],
      price,
      prevClose,
      open: parseFloat(f[5]),
      high: parseFloat(f[33]) || price,
      low: parseFloat(f[34]) || price,
      volume: parseFloat(f[6]),
      amount: parseFloat(f[37]) || 0,
      change: parseFloat(f[31]) || 0,
      changePercent: parseFloat(f[32]) || 0,
      volumeRatio: parseFloat(f[49]) || 0,
      turnover: parseFloat(f[38]) || 0,
      isFutures: false
    };
  },

  // ====== 期货实时行情（新浪 JSONP） ======
  fetchFuturesRealtime(futuresList) {
    if (!futuresList || futuresList.length === 0) return Promise.resolve([]);
    
    // 模拟模式
    if (MockData && MockData.shouldUseMock()) {
      const mockFutures = MockData.getFuturesData();
      return Promise.resolve(mockFutures.filter(f => futuresList.some(fl => fl.sina === f.code)));
    }

    const sinaCodes = futuresList.map(f => f.sina);

    return new Promise((resolve) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => { script.remove(); resolve([]); }, 8000);

      sinaCodes.forEach(sc => { delete window['hq_str_' + sc]; });

      script.src = 'https://hq.sinajs.cn/list=' + sinaCodes.join(',') + '&r=' + Date.now();
      // 新浪期货接口返回 utf-8
      script.onerror = () => { clearTimeout(timeout); script.remove(); resolve([]); };
      script.onload = () => {
        clearTimeout(timeout);
        script.remove();

        const results = [];
        futuresList.forEach(f => {
          const raw = window['hq_str_' + f.sina];
          if (raw && raw.length > 5) {
            const parsed = this._parseFutures(f, raw);
            if (parsed) results.push(parsed);
          }
        });
        resolve(results);
      };
      document.head.appendChild(script);
    });
  },

  // 新浪期货格式: 0:名称,1:~不确定/时间~,2:开盘,3:最高,4:最低,5:昨收,6:买价,7:卖价,8:最新价,9:结算价,10:昨结算,11:买量,12:卖量,13:持仓量,14:成交量
  _parseFutures(futuresCfg, raw) {
    const f = raw.split(',');
    if (f.length < 14) return null;
    const price = parseFloat(f[8]);
    const prevSettlement = parseFloat(f[10]) || parseFloat(f[5]);
    if (!price || price === 0) return null;
    const change = price - prevSettlement;
    const changePct = prevSettlement > 0 ? (change / prevSettlement * 100) : 0;
    return {
      code: futuresCfg.sina,
      name: futuresCfg.name + '主连',
      displayCode: futuresCfg.code,
      price,
      prevClose: prevSettlement,
      open: parseFloat(f[2]) || price,
      high: parseFloat(f[3]) || price,
      low: parseFloat(f[4]) || price,
      volume: parseFloat(f[14]) || 0,
      amount: 0,
      change: parseFloat(change.toFixed(2)),
      changePercent: parseFloat(changePct.toFixed(2)),
      volumeRatio: 0,
      turnover: 0,
      isFutures: true
    };
  },

  // ====== 分时数据（东方财富） ======
  fetchMinute(code) {
    // 模拟模式
    if (MockData && MockData.shouldUseMock()) {
      return Promise.resolve(MockData.getMinuteData(code));
    }
    const secid = this._toSecid(code);
    const url = 'https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=' + secid + '&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&iscr=0&ndays=1';
    return fetch(url)
      .then(r => r.json())
      .then(json => {
        const trends = json?.data?.trends;
        if (!trends || trends.length === 0) return [];
        return trends.map(item => {
          const parts = item.split(',');
          return {
            time: parts[0].split(' ')[1].substring(0, 5),
            price: parseFloat(parts[2]),
            volume: parseInt(parts[5])
          };
        }).filter(d => d.price > 0 && isFinite(d.price));
      })
      .catch(() => []);
  },

  // ====== 日K线（腾讯） ======
  fetchDailyKline(code, count) {
    count = count || 120;
    // 模拟模式
    if (MockData && MockData.shouldUseMock()) {
      return Promise.resolve(MockData.getDailyKlineData(code, count));
    }
    return fetch('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + code + ',day,,,' + count + ',qfq')
      .then(r => r.json())
      .then(json => {
        const d = json?.data?.[code];
        const dayData = d?.day || d?.qfqday || [];
        return dayData.map(k => ({
          date: k[0], open: +k[1], close: +k[2], high: +k[3], low: +k[4], volume: +(k[5] || 0)
        }));
      })
      .catch(() => []);
  },

  // ====== 期货分钟K线（新浪，支持多周期） ======
  fetchFuturesMinKline(symbol, type) {
    // symbol: e.g. 'MA0'; type: 5/15/30/60
    type = type || 5;
    return new Promise((resolve) => {
      const cbVar = '_' + symbol + '_' + type;
      const script = document.createElement('script');
      const timeout = setTimeout(() => { script.remove(); resolve([]); }, 10000);
      delete window[cbVar];

      const url = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20' + cbVar + '=/InnerFuturesNewService.getFewMinLine?symbol=' + symbol + '&type=' + type + '&r=' + Date.now();
      script.src = url;
      script.onerror = () => { clearTimeout(timeout); script.remove(); resolve([]); };
      script.onload = () => {
        clearTimeout(timeout);
        script.remove();

        const raw = window[cbVar];
        if (!raw || !Array.isArray(raw)) { resolve([]); return; }

        const klines = raw.map(item => ({
          date: item.d,
          time: item.d,
          open: parseFloat(item.o),
          high: parseFloat(item.h),
          low: parseFloat(item.l),
          close: parseFloat(item.c),
          volume: parseInt(item.v) || 0,
          openInterest: parseInt(item.p) || 0
        })).filter(k => k.open > 0 && k.close > 0);

        resolve(klines);
      };
      document.head.appendChild(script);
    });
  },

  // ====== 期货5分钟K线（兼容旧调用） ======
  fetchFutures5minKline(symbol) {
    return this.fetchFuturesMinKline(symbol, 5);
  },

  // ====== 期货日K线（新浪） ======
  fetchFuturesDailyKline(symbol) {
    return new Promise((resolve) => {
      const cbVar = '_daily_' + symbol;
      const script = document.createElement('script');
      const timeout = setTimeout(() => { script.remove(); resolve([]); }, 15000);
      delete window[cbVar];

      const url = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20' + cbVar + '=/InnerFuturesNewService.getDailyKLine?symbol=' + symbol + '&r=' + Date.now();
      script.src = url;
      script.onerror = () => { clearTimeout(timeout); script.remove(); resolve([]); };
      script.onload = () => {
        clearTimeout(timeout);
        script.remove();

        const raw = window[cbVar];
        if (!raw || !Array.isArray(raw)) { resolve([]); return; }

        const klines = raw.map(item => ({
          date: item.d,
          time: item.d,
          open: parseFloat(item.o),
          high: parseFloat(item.h),
          low: parseFloat(item.l),
          close: parseFloat(item.c),
          volume: parseInt(item.v) || 0,
          openInterest: parseInt(item.p) || 0
        })).filter(k => k.open > 0 && k.close > 0);

        resolve(klines);
      };
      document.head.appendChild(script);
    });
  },

  // ====== 期货周K线（基于日K聚合） ======
  fetchFuturesWeeklyKline(symbol) {
    return this.fetchFuturesDailyKline(symbol).then(dailyKlines => {
      if (!dailyKlines || dailyKlines.length === 0) return [];
      const weeks = [];
      let currentWeek = null;

      dailyKlines.forEach(k => {
        const d = new Date(k.date);
        // Get Monday of that week (ISO week)
        const day = d.getDay() || 7; // Sunday = 7
        const monday = new Date(d);
        monday.setDate(d.getDate() - day + 1);
        const weekKey = monday.toISOString().substring(0, 10);

        if (!currentWeek || currentWeek._key !== weekKey) {
          if (currentWeek) weeks.push(currentWeek);
          currentWeek = {
            _key: weekKey,
            date: k.date,  // Use Friday/last trading day as display date
            time: k.date,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume,
            openInterest: k.openInterest
          };
        } else {
          currentWeek.date = k.date;
          currentWeek.time = k.date;
          currentWeek.high = Math.max(currentWeek.high, k.high);
          currentWeek.low = Math.min(currentWeek.low, k.low);
          currentWeek.close = k.close;
          currentWeek.volume += k.volume;
          currentWeek.openInterest = k.openInterest;
        }
      });
      if (currentWeek) weeks.push(currentWeek);
      return weeks;
    });
  },

  // ====== 指数K线（东方财富） ======
  fetchIndexKline(secid, klt, limit) {
    limit = limit || 120;
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=' + klt +
      '&fqt=1&end=20500101&lmt=' + limit;
    return fetch(url)
      .then(r => r.json())
      .then(json => {
        const klines = json?.data?.klines;
        if (!klines || klines.length === 0) return [];
        return klines.map(line => {
          const p = line.split(',');
          return {
            date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4],
            volume: +p[5], amount: +p[6]
          };
        });
      })
      .catch(() => []);
  },

  // ====== 周K线（腾讯） ======
  fetchWeeklyKline(code, count) {
    count = count || 60;
    // 模拟模式
    if (MockData && MockData.shouldUseMock()) {
      return Promise.resolve(MockData.getWeeklyKlineData(code, count));
    }
    return fetch('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + code + ',week,,,' + count + ',qfq')
      .then(r => r.json())
      .then(json => {
        const d = json?.data?.[code];
        const weekData = d?.week || d?.qfqweek || [];
        return weekData.map(k => ({
          date: k[0], open: +k[1], close: +k[2], high: +k[3], low: +k[4], volume: +(k[5] || 0)
        }));
      })
      .catch(() => []);
  }
};
