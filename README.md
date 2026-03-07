# 📈 A股+期货 实时监控

纯前端 SPA，部署在 GitHub Pages，无需后端。

## 功能

- **大盘总览**：三大指数实时 + 手动定性（绿/黄/红灯）
- **自选股监控**：A股 + 期货，分组管理，实时行情
- **K线图表**：分时/日K/周K + MA均线 + MACD/KDJ/CCI
- **异动信号**：实时检测 + 浏览器通知 + 声音提醒
- **信号中心**：信号流 + 历史归档 + 类型过滤
- **响应式**：支持手机和桌面

## 数据接口

| 数据 | 接口 | 方式 |
|------|------|------|
| A股实时 | `qt.gtimg.cn` | JSONP |
| A股K线 | `web.ifzq.gtimg.cn` | fetch |
| 期货实时 | `hq.sinajs.cn` | JSONP |
| 分时数据 | `data.gtimg.cn` | JSONP |

## 本地运行

```bash
python3 -m http.server 8765
# 打开 http://localhost:8765
```

## 部署

Push 到 `main` 分支自动部署到 GitHub Pages。

访问：https://zidongdesign.github.io/stock-monitor/
