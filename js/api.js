/**
 * A股数据获取模块
 * 使用腾讯财经 JSONP 接口
 */

const StockAPI = {
  // JSONP 请求封装
  jsonp(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => {
        script.remove();
        reject(new Error('JSONP timeout'));
      }, 8000);
      
      script.src = url;
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        reject(new Error('JSONP load error'));
      };
      script.onload = () => {
        clearTimeout(timeout);
        script.remove();
      };
      document.head.appendChild(script);
      
      // 腾讯接口会设置全局变量，onload 后解析
      setTimeout(() => {
        clearTimeout(timeout);
        resolve();
      }, 500);
    });
  },

  /**
   * 获取实时行情
   * 腾讯接口返回: v_sz000009="1~中国宝安~000009~7.15~7.10~..."
   * 字段按~分割
   */
  async fetchRealtime(codes) {
    if (!codes || codes.length === 0) return [];

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => {
        script.remove();
        resolve([]);
      }, 8000);

      // 先清除旧的全局变量
      codes.forEach(code => {
        delete window[`v_${code}`];
      });

      script.src = `https://qt.gtimg.cn/q=${codes.join(',')}`;
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        // 尝试备用接口
        this._fetchRealtimeSina(codes).then(resolve).catch(() => resolve([]));
      };
      script.onload = () => {
        clearTimeout(timeout);
        script.remove();
        
        const results = [];
        codes.forEach(code => {
          const raw = window[`v_${code}`];
          if (raw) {
            const parsed = this._parseRealtimeQQ(code, raw);
            if (parsed) results.push(parsed);
          }
        });
        
        if (results.length > 0) {
          resolve(results);
        } else {
          // QQ 接口无数据，尝试新浪
          this._fetchRealtimeSina(codes).then(resolve).catch(() => resolve([]));
        }
      };
      document.head.appendChild(script);
    });
  },

  _parseRealtimeQQ(code, raw) {
    const fields = raw.split('~');
    if (fields.length < 45) return null;
    
    const price = parseFloat(fields[3]);
    const prevClose = parseFloat(fields[4]);
    const open = parseFloat(fields[5]);
    const volume = parseFloat(fields[6]);
    const high = parseFloat(fields[33]) || price;
    const low = parseFloat(fields[34]) || price;
    const changePercent = parseFloat(fields[32]);
    const change = parseFloat(fields[31]);
    const volumeRatio = parseFloat(fields[49]) || 0;
    const turnover = parseFloat(fields[38]);
    const amount = parseFloat(fields[37]);
    
    return {
      code,
      name: fields[1],
      price,
      prevClose,
      open,
      high,
      low,
      volume,
      amount,
      change,
      changePercent,
      volumeRatio,
      turnover,
      time: fields[30],
      raw: fields
    };
  },

  // 新浪备用接口
  async _fetchRealtimeSina(codes) {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => {
        script.remove();
        resolve([]);
      }, 8000);
      
      // 清除旧变量
      codes.forEach(code => {
        delete window[`hq_str_${code}`];
      });

      script.src = `https://hq.sinajs.cn/list=${codes.join(',')}`;
      script.charset = 'gb2312';
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        resolve([]);
      };
      script.onload = () => {
        clearTimeout(timeout);
        script.remove();
        
        const results = [];
        codes.forEach(code => {
          const raw = window[`hq_str_${code}`];
          if (raw && raw.length > 0) {
            const parsed = this._parseRealtimeSina(code, raw);
            if (parsed) results.push(parsed);
          }
        });
        resolve(results);
      };
      document.head.appendChild(script);
    });
  },

  _parseRealtimeSina(code, raw) {
    const fields = raw.split(',');
    if (fields.length < 30) return null;
    
    const price = parseFloat(fields[3]);
    const prevClose = parseFloat(fields[2]);
    const open = parseFloat(fields[1]);
    const high = parseFloat(fields[4]);
    const low = parseFloat(fields[5]);
    const volume = parseFloat(fields[8]);
    const amount = parseFloat(fields[9]);
    const change = price - prevClose;
    const changePercent = prevClose > 0 ? ((change / prevClose) * 100) : 0;
    
    return {
      code,
      name: fields[0],
      price,
      prevClose,
      open,
      high,
      low,
      volume,
      amount,
      change,
      changePercent: parseFloat(changePercent.toFixed(2)),
      volumeRatio: 0, // 新浪接口没有量比
      turnover: 0,
      time: fields[31],
      raw: fields
    };
  },

  /**
   * 获取分时数据
   */
  async fetchMinute(code) {
    return new Promise((resolve) => {
      const varName = `minute_data_${code.replace(/[^a-z0-9]/g, '_')}`;
      const script = document.createElement('script');
      const timeout = setTimeout(() => {
        script.remove();
        resolve([]);
      }, 8000);

      script.src = `https://data.gtimg.cn/flashdata/hushen/minute/${code}.js`;
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        resolve([]);
      };
      script.onload = () => {
        clearTimeout(timeout);
        script.remove();
        
        // 腾讯分时数据存在 window.min_data
        const raw = window.min_data;
        if (!raw) { resolve([]); return; }
        
        const lines = raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('date:'));
        const data = [];
        lines.forEach(line => {
          const parts = line.trim().split(' ');
          if (parts.length >= 3 && /^\d{4}$/.test(parts[0])) {
            data.push({
              time: parts[0].substring(0, 2) + ':' + parts[0].substring(2),
              price: parseFloat(parts[1]),
              volume: parseFloat(parts[2])
            });
          }
        });
        resolve(data);
      };
      document.head.appendChild(script);
    });
  },

  /**
   * 获取日K线数据
   */
  async fetchDailyKline(code, count = 120) {
    return new Promise((resolve) => {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},day,,,${count},qfq`;
      
      fetch(url)
        .then(res => res.json())
        .then(json => {
          const key = code;
          const dayData = json?.data?.[key]?.day || json?.data?.[key]?.qfqday || [];
          
          const klines = dayData.map(d => ({
            date: d[0],
            open: parseFloat(d[1]),
            close: parseFloat(d[2]),
            high: parseFloat(d[3]),
            low: parseFloat(d[4]),
            volume: parseFloat(d[5] || 0)
          }));
          resolve(klines);
        })
        .catch(() => resolve([]));
    });
  },

  /**
   * 获取周K线数据
   */
  async fetchWeeklyKline(code, count = 60) {
    return new Promise((resolve) => {
      const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${code},week,,,${count},qfq`;
      
      fetch(url)
        .then(res => res.json())
        .then(json => {
          const key = code;
          const weekData = json?.data?.[key]?.week || json?.data?.[key]?.qfqweek || [];
          
          const klines = weekData.map(d => ({
            date: d[0],
            open: parseFloat(d[1]),
            close: parseFloat(d[2]),
            high: parseFloat(d[3]),
            low: parseFloat(d[4]),
            volume: parseFloat(d[5] || 0)
          }));
          resolve(klines);
        })
        .catch(() => resolve([]));
    });
  }
};
