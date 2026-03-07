/**
 * 行情数据接口模块
 * A股: 腾讯 qt.gtimg.cn (JSONP)
 * A股K线: 腾讯 web.ifzq.gtimg.cn (fetch JSON)
 * 期货: 新浪 hq.sinajs.cn (JSONP)
 * 分时: 腾讯 data.gtimg.cn
 */
const StockAPI = {
  // ====== A股实时行情（腾讯 JSONP） ======
  fetchRealtime(codes) {
    if (!codes || codes.length === 0) return Promise.resolve([]);

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

  // ====== 分时数据（腾讯） ======
  fetchMinute(code) {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => { script.remove(); resolve([]); }, 8000);

      script.src = 'https://data.gtimg.cn/flashdata/hushen/minute/' + code + '.js?r=' + Date.now();
      script.onerror = () => { clearTimeout(timeout); script.remove(); resolve([]); };
      script.onload = () => {
        clearTimeout(timeout);
        script.remove();

        const raw = window.min_data;
        if (!raw) { resolve([]); return; }

        const lines = raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('date:'));
        const data = [];
        lines.forEach(line => {
          const parts = line.trim().split(' ');
          if (parts.length >= 3 && /^\d{4}$/.test(parts[0])) {
            const price = parseFloat(parts[1]);
            const volume = parseFloat(parts[2]);
            if (price > 0 && isFinite(price)) {
              data.push({
                time: parts[0].substring(0, 2) + ':' + parts[0].substring(2),
                price,
                volume
              });
            }
          }
        });
        resolve(data);
      };
      document.head.appendChild(script);
    });
  },

  // ====== 日K线（腾讯） ======
  fetchDailyKline(code, count) {
    count = count || 120;
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

  // ====== 周K线（腾讯） ======
  fetchWeeklyKline(code, count) {
    count = count || 60;
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
