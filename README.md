# 📢 Bursa Bot

**自动扫描马来西亚全市场上市股票，用技术指标策略筛选信号，生成可视化报告的个人选股机器人。**

[![License](https://img.shields.io/badge/license-All%20Rights%20Reserved-red.svg)](./LICENSE)
[![Powered by DeepSeek](https://img.shields.io/badge/AI-DeepSeek-blue.svg)](https://www.deepseek.com/)
[![Charts by TradingView](https://img.shields.io/badge/charts-Lightweight%20Charts-orange.svg)](https://github.com/tradingview/lightweight-charts)

**👉 [查看今日报告](https://cja231.github.io/Bursa-bot/)**

---

## 这是什么

Bursa Bot 每个交易日自动扫描 **马来西亚交易所全部上市股票**（Main + ACE 板，共 1070+ 支），用一套固定的技术指标策略筛选出可能值得关注的股票，生成一份带 K 线图的网页报告，并在有信号时推送到手机。

这是一个**个人自用的技术分析工具**，不提供投资建议，也不构成任何形式的证券服务（详见下方[免责声明](#免责声明)）。

## 功能特色

- 🔍 **全市场扫描**：覆盖 Bursa Malaysia 全部上市股票，不只是自选股清单
- 🎯 **固定量化策略**：`SAR 多头` + `EMA20 < 现价` + `成交量 > 50万` + `T3 形态突破` 四个条件同时满足才算命中
- 📈 **可视化 K 线图**：空心蜡烛图 + EMA20 均线 + 成交量柱状图，悬停可看当日开高低收
- ⚙️ **网页端自定义**：图表颜色可以直接在报告页面上调整；还能自己输入公式（如 `sma(close,10)`、`ema(close,12)-ema(close,26)`）叠加自定义技术指标，全部即时生效、存在你自己的浏览器里
- 🤖 **AI 辅助点评**：命中信号的股票由 DeepSeek 给出简短的可靠性评价
- 📱 **手机推送**：通过 [ntfy.sh](https://ntfy.sh) 在发现信号时推送通知
- ⏰ **全自动运行**：每个交易日盘中自动更新（详见 [`bursa-bot.md`](./bursa-bot.md) 了解排程设计）
- 🌐 **静态网页发布**：报告通过 GitHub Pages 发布，随时用手机浏览器打开查看

## 怎么运作的

```
GitHub Actions (定时/手动触发)
        │
        ▼
yfinance 并发抓取全市场行情 (~1070 支, 16 线程并发)
        │
        ▼
pandas-ta 计算指标 (RSI / SMA50 / EMA20 / PSAR)
        │
        ▼
四条件策略筛选 → 命中的股票交给 DeepSeek 做简短点评
        │
        ▼
生成 docs/index.html (K线图 + 数据表格)
        │
        ▼
提交到仓库 → GitHub Pages 自动发布 → (有信号时) 推送到手机
```

## 技术栈

| 用途 | 技术 |
|---|---|
| 行情数据 | [yfinance](https://github.com/ranaroussi/yfinance) |
| 技术指标 | [pandas-ta](https://github.com/twopirllc/pandas-ta) |
| AI 点评 | [DeepSeek](https://www.deepseek.com/) API |
| K 线图 | [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts)（Apache 2.0，已自托管在 `docs/vendor/`） |
| 手机推送 | [ntfy.sh](https://ntfy.sh) |
| 自动化 | GitHub Actions + 外部定时器 |
| 发布 | GitHub Pages |

## 项目结构

```
Bursa-bot/
├── main.py                      # 主程序：抓数据 → 算指标 → 筛选 → 生成报告 → 推送
├── data/watchlist.json          # 全市场股票清单 (1070+ 支)
├── docs/index.html              # 生成的报告，GitHub Pages 从这里发布
├── scripts/
│   ├── fetch_watchlist.py       # 更新全市场股票清单
│   └── debug_stock.py           # 调试工具：查看某支股票过去几天是否符合条件
└── .github/workflows/           # 自动化流程
```

更完整的设计笔记（策略细节、历史踩坑、排程调试过程）见 [`bursa-bot.md`](./bursa-bot.md)。

## 免责声明

本项目及其生成的报告：

- **不构成任何投资建议**，仅供个人技术分析学习与参考
- 所有信号均由固定的技术指标公式自动计算，**不涉及人工投资判断，也不保证准确性或盈利**
- AI 点评内容为模型生成，可能存在错误，不应作为买卖依据
- 使用本项目产生的任何投资决策及后果，由使用者自行承担

## License

本仓库为 **All Rights Reserved**，详见 [`LICENSE`](./LICENSE)。仓库保持公开是为了使用免费版 GitHub Pages，并不代表开放授权使用；vendor 引入的第三方组件（TradingView Lightweight Charts）保留其原有的 Apache 2.0 授权。
