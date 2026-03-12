/**
 * 数据加载器 - 从 data/ 目录加载服务端分析数据
 * 优雅降级：fetch 失败时返回 null，不影响正常运行
 */
const DataLoader = {
  // 加载远程分析数据
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

  // 检查是否需要更新自选股列表
  shouldUpdateStocks(remoteVersion) {
    const localVer = Store._STOCK_VERSION;
    return remoteVersion && remoteVersion > localVer;
  }
};
