/**
 * 行情数据接口模块
 * A股: 腾讯 qt.gtimg.cn (JSONP)
 * A股K线: 腾讯 web.ifzq.gtimg.cn (fetch JSON)
 * 期货: 东方财富 push2.eastmoney.com / push2his.eastmoney.com
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

  // ====== 分时资金流向（返回每分钟主力/散户净流入） ======
  fetchFundFlowMinute(code) {
    const secid = this._toSecid(code);
    const url = 'https://push2.eastmoney.com/api/qt/stock/fflow/kline/get?lmt=0&klt=1&secid=' + secid + '&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63&ut=b2884a393a59ad64002292a3e90d46a5&cb=';

    return fetch(url)
      .then(r => r.json())
      .then(json => {
        const klines = json?.data?.klines;
        if (!klines || klines.length === 0) return null;
        // klines 每条格式: "HH:MM,主力净流入,小单净流入,中单净流入,大单净流入,超大单净流入,..."
        // parts[1] = 累计主力净流入(元), parts[2] = 累计小单净流入(元)
        return klines.map(line => {
          const parts = line.split(',');
          return {
            time: parts[0].length > 5 ? parts[0].substring(parts[0].length - 5) : parts[0],
            main: Math.round((parseFloat(parts[1]) || 0) / 10000),     // 万元
            retail: Math.round((parseFloat(parts[2]) || 0) / 10000)    // 万元（小单≈散户）
          };
        });
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

  // ====== 期货实时行情（东方财富 batch） ======
  fetchFuturesRealtime(futuresList) {
    if (!futuresList || futuresList.length === 0) return Promise.resolve([]);
    
    // 模拟模式
    if (MockData && MockData.shouldUseMock()) {
      const mockFutures = MockData.getFuturesData();
      return Promise.resolve(mockFutures.filter(f => futuresList.some(fl => fl.secid === f.code || fl.sina === f.code)));
    }

    const secids = futuresList.map(f => f.secid).filter(Boolean).join(',');
    if (!secids) return Promise.resolve([]);

    const url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?ut=fa5fd1943c7b386f172d6893dbfba10b&fltt=2&secids=' + secids + '&fields=f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18';
    return fetch(url)
      .then(r => r.json())
      .then(json => {
        const list = json?.data?.diff;
        if (!list || list.length === 0) return [];
        return list.map(item => this._parseFutures(futuresList, item)).filter(Boolean);
      })
      .catch(() => []);
  },

  // 东方财富期货: f2=最新价, f3=涨跌幅%, f4=涨跌额, f5=成交量, f6=成交额, f12=代码, f14=名称
  // f15=最高, f16=最低, f17=开盘, f18=昨结算
  _parseFutures(futuresList, item) {
    const price = item.f2;
    if (!price || price === '-') return null;
    // 通过 f12（如 MAM）匹配到 futuresList 中的配置
    const code12 = (item.f12 || '').toUpperCase();
    const cfg = futuresList.find(f => {
      if (!f.secid) return false;
      const secCode = f.secid.split('.')[1] || '';
      return secCode.toUpperCase() === code12;
    });
    const displayCode = cfg ? cfg.code : code12;
    const displayName = cfg ? cfg.name + '主连' : item.f14;
    const secid = cfg ? cfg.secid : '';

    const prevClose = item.f18 || 0;
    const change = item.f4 || 0;
    const changePct = item.f3 || 0;

    return {
      code: secid,
      name: displayName,
      displayCode: displayCode,
      price: price,
      prevClose: prevClose,
      open: item.f17 || price,
      high: item.f15 || price,
      low: item.f16 || price,
      volume: item.f5 || 0,
      amount: item.f6 || 0,
      change: parseFloat(change.toFixed ? change.toFixed(2) : change),
      changePercent: parseFloat(changePct.toFixed ? changePct.toFixed(2) : changePct),
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
    // 腾讯分时接口：格式 sh600519 → sh600519, sz000001 → sz000001
    const txCode = code; // 已经是 sh/sz 开头
    const url = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' + txCode;
    return fetch(url)
      .then(r => r.json())
      .then(json => {
        const dataArr = json?.data?.[txCode]?.data?.data;
        if (!dataArr || dataArr.length === 0) return [];
        return dataArr.map(item => {
          // 腾讯格式: "0930 12.52 5058 6332616.00"
          const parts = item.split(' ');
          return {
            time: parts[0].substring(0, 2) + ':' + parts[0].substring(2, 4),
            price: parseFloat(parts[1]),
            volume: parseInt(parts[2])
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

  // ====== 期货分钟K线（东方财富，支持多周期） ======
  // secid 来自 Store 的 futures 配置，如 '115.MAM'
  // 如果传入的是老格式 code（如 'MA0'），尝试自动转换
  _getFuturesSecid(symbol) {
    if (symbol.includes('.')) return symbol; // 已经是 secid
    // 从 Store 查找
    if (typeof Store !== 'undefined') {
      const futures = Store.getFutures();
      const found = futures.find(f => f.code === symbol);
      if (found && found.secid) return found.secid;
      // 尝试自动推断
      return Store._codeToSecid(symbol) || symbol;
    }
    return symbol;
  },

  // IEEE754 float32 解码：东财期货分钟K线白天数据有时返回 float32 整数表示
  _decodeFloat32(v) {
    if (v > 1e8) {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setUint32(0, v);
      return parseFloat(new DataView(buf).getFloat32(0).toFixed(2));
    }
    return v;
  },

  fetchFuturesMinKline(symbol, type) {
    type = type || 5;
    const secid = this._getFuturesSecid(symbol);
    // klt: 5=5分钟, 15=15分钟, 30=30分钟, 60=60分钟
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=' + type +
      '&fqt=0&end=20500101&lmt=200';
    return fetch(url)
      .then(r => r.json())
      .then(json => {
        const klines = json?.data?.klines;
        if (!klines || klines.length === 0) return [];
        return klines.map(line => {
          const p = line.split(',');
          return {
            date: p[0],
            time: p[0],
            open: this._decodeFloat32(+p[1]),
            close: this._decodeFloat32(+p[2]),
            high: this._decodeFloat32(+p[3]),
            low: this._decodeFloat32(+p[4]),
            volume: +p[5],
            openInterest: 0
          };
        }).filter(k => k.open > 0 && k.close > 0);
      })
      .catch(() => []);
  },

  // ====== 期货5分钟K线（兼容旧调用） ======
  fetchFutures5minKline(symbol) {
    return this.fetchFuturesMinKline(symbol, 5);
  },

  // ====== 期货日K线（东方财富） ======
  fetchFuturesDailyKline(symbol) {
    const secid = this._getFuturesSecid(symbol);
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=101&fqt=0&end=20500101&lmt=300';
    return fetch(url)
      .then(r => r.json())
      .then(json => {
        const klines = json?.data?.klines;
        if (!klines || klines.length === 0) return [];
        return klines.map(line => {
          const p = line.split(',');
          return {
            date: p[0],
            time: p[0],
            open: +p[1],
            close: +p[2],
            high: +p[3],
            low: +p[4],
            volume: +p[5],
            openInterest: 0
          };
        }).filter(k => k.open > 0 && k.close > 0 && k.close < 1e8 && k.open < 1e8);
      })
      .catch(() => []);
  },

  // ====== 期货周K线（东方财富） ======
  fetchFuturesWeeklyKline(symbol) {
    const secid = this._getFuturesSecid(symbol);
    const url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58&klt=102&fqt=0&end=20500101&lmt=100';
    return fetch(url)
      .then(r => r.json())
      .then(json => {
        const klines = json?.data?.klines;
        if (!klines || klines.length === 0) return [];
        return klines.map(line => {
          const p = line.split(',');
          return {
            date: p[0],
            time: p[0],
            open: +p[1],
            close: +p[2],
            high: +p[3],
            low: +p[4],
            volume: +p[5],
            openInterest: 0
          };
        }).filter(k => k.open > 0 && k.close > 0 && k.close < 1e8 && k.open < 1e8);
      })
      .catch(() => []);
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
