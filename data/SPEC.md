# data/ 数据规范

Python 脚本每天收盘后生成以下 JSON 文件，前端启动时 fetch 读取。

## data/watchlist.json — 自选股名单（自动补入/淘汰）

```json
{
  "version": "20260312a",
  "startDate": "2026-03-12",
  "dayCount": 1,
  "stocks": [
    {
      "code": "sz301265",
      "name": "华新环保",
      "group": "focus",
      "addedDate": "2026-03-12",
      "source": "initial"
    }
  ],
  "todayAdded": ["sz301265"],
  "todayRemoved": []
}
```

- `version`: 格式 YYYYMMDDx（a/b/c...），前端通过版本比较自动同步
- `startDate`: 池子初始化日期
- `dayCount`: 池子运行天数（>= 10 天才触发自动淘汰）
- `stocks`: 当前池内股票列表
- `todayAdded` / `todayRemoved`: 今日变动的代码列表

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
        "r0Net": 500,
        "netRatio": 0.05,
        "trend": "in"
      },
      "action": "hold",
      "tags": ["ROE健康", "主力流入"],
      "reason": "ROE健康，主力持续流入，短期均线多头"
    }
  },
  "todayAdded": [
    { "code": "sh600519", "name": "贵州茅台", "score": 88, "sector": "白酒" }
  ],
  "todayRemoved": [
    { "code": "sz002157", "name": "正邦科技", "date": "2026-03-22", "score": 25, "reason": "评分最低淘汰" }
  ],
  "eliminate": [],
  "recommend": []
}
```

## data/history.json — 淘汰历史记录

```json
{
  "removed": [
    {
      "code": "sz002063",
      "name": "远光软件",
      "date": "2026-03-22",
      "score": 25,
      "reason": "评分最低淘汰"
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

### 自动淘汰规则
- 池子运行天数 >= 10 天才触发
- 每次淘汰评分最低的 5 只
- 池子上限 50 只

### 自动补入过滤
- ❌ 科创板（688开头）
- ❌ 北交所（8开头6位数）
- ❌ ST股
- ❌ 近5日涨幅>30%
- ❌ 财务D级
- ❌ 已在池中
