# data/ 数据规范

Python 脚本每天收盘后生成以下 JSON 文件，前端启动时 fetch 读取。

## data/watchlist.json — 自选股名单

```json
{
  "version": "20260312",
  "updated": "2026-03-12T15:35:00+08:00",
  "groups": {
    "focus": ["sz301265", "sz300323"],
    "watch": ["sz301032", "sh603158"],
    "ambush": ["sz300696", "sh603977"]
  }
}
```

前端逻辑：如果 version > 本地 _STOCK_VERSION，自动替换股票列表。

## data/analysis.json — 每日分析结果

```json
{
  "updated": "2026-03-12T15:35:00+08:00",
  "stocks": {
    "sz301265": {
      "name": "华新环保",
      "score": 75,
      "financial": {
        "roe": 12.5,
        "roeTrend": "up",
        "netProfitGrowth3y": [15.2, 8.3, 22.1],
        "cashFlowPositive": true,
        "grade": "A"
      },
      "technical": {
        "trend": "up",
        "aboveMa20": true,
        "kdjSignal": "golden_cross",
        "support": 20.5,
        "resistance": 24.0
      },
      "fundFlow": {
        "mainNet5d": 1500,
        "mainDaysIn": 3,
        "trend": "in"
      },
      "action": "hold",
      "tags": ["ROE健康", "主力流入"],
      "reason": "ROE健康，主力持续流入，短期均线多头"
    }
  },
  "eliminate": [
    {
      "code": "sz002157",
      "name": "正邦科技",
      "reason": "净利润连续3年下滑，ROE<5%",
      "fromGroup": "focus"
    }
  ],
  "recommend": [
    {
      "code": "sh600519",
      "name": "贵州茅台",
      "score": 88,
      "reason": "ROE>20%，主力持续加仓",
      "suggestGroup": "watch"
    }
  ]
}
```

## 字段说明

### score (0-100)
综合评分 = 财务(40%) + 技术(30%) + 资金(30%)

### financial.grade
- A: ROE>15% + 净利润连增3年 + 现金流正
- B: ROE>10% + 净利润未连降
- C: ROE>5% 但有瑕疵
- D: ROE<5% 或净利润连降 → 淘汰候选

### action
- buy: 建议关注/买入
- hold: 继续持有
- reduce: 建议减仓
- eliminate: 建议淘汰

### tags
前端直接显示的标签，如：["ROE健康", "主力流入", "破位风险"]
