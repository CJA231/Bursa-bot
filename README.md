# 📢 Bursa Bot

🇲🇾 马来西亚全市场自动选股机器人 — 技术指标策略筛选 + K线图 + AI点评 + 手机推送，GitHub Actions 全自动运行

[![License](https://img.shields.io/badge/license-All%20Rights%20Reserved-red.svg)](./LICENSE)
[![Powered by DeepSeek](https://img.shields.io/badge/AI-DeepSeek-blue.svg)](https://www.deepseek.com/)
[![Charts by TradingView](https://img.shields.io/badge/charts-Lightweight%20Charts-orange.svg)](https://github.com/tradingview/lightweight-charts)

**👉 [查看今日报告](https://cja231.github.io/Bursa-bot/)**

---

## 这是什么

Bursa Bot 每个交易日自动扫描 **马来西亚交易所全部上市股票**（Main + ACE 板，共 1070+ 支），用一套固定的技术指标策略筛选出可能值得关注的股票，生成一份带 K 线图的网页报告，并在有信号时推送到手机。

这是一个**个人自用的技术分析工具**，不提供投资建议，也不构成任何形式的证券服务（详见下方[免责声明](#免责声明)）。

## 界面预览

<table>
<tr>
<td width="58%" valign="top">

**信号卡片**：命中策略的股票会有一张卡片，包含 90 个交易日的 K 线图、EMA20、成交量，以及 AI 点评。下图叠加了布林带（在设置面板里一键添加）。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/signal-card-dark.png">
  <img src="assets/screenshots/signal-card-light.png" alt="信号卡片：BMGREEN 的 K 线图，叠加 EMA20、布林带和成交量，下方是 AI 点评">
</picture>

</td>
<td width="42%" valign="top">

**图表设置**：颜色和技术指标都能直接在网页上调整，指标按分类排好，点一下就加到图上。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/settings-panel-dark.png">
  <img src="assets/screenshots/settings-panel-light.png" alt="图表设置面板：颜色选择器，按趋势/动量/波动性/成交量分类的指标库，已添加 RSI 和 MACD">
</picture>

</td>
</tr>
</table>

**选股表格**：没有命中信号、但成交量达标的股票，每行一个当天的日内迷你走势图（虚线 = 昨收），默认按成交量排序，可搜索。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screenshots/table-dark.png">
  <img src="assets/screenshots/table-light.png" alt="选股表格：每行显示股票代码、日内迷你走势图、价格、涨跌%、成交量、相对成交量、RSI、SAR 多空和 EMA20，按成交量从高到低排序">
</picture>

<sub>截图均取自 2026-09-23 的真实运行结果（信号卡片为当天命中的 BMGREEN 0168；表格为 15:46 那次运行的前 8 行），仅用于展示界面，不构成任何买卖建议。</sub>

## 报告怎么看

报告从上到下分三部分：

### 🚨 信号
同时满足全部四个策略条件的股票。每张卡片包含：
- **现价 / RSI(14) / 50日均线**，以及手指或鼠标停在 K 线上时显示的当日 开/高/低/收/量
- **K 线图**：空心蜡烛 = 上涨，实心 = 下跌；紫色线是 EMA20；底部是成交量
- **AI 点评**：DeepSeek 根据数据给出的一句话技术面评价（只评价信号可靠性，不给买卖建议；仅供参考，可能出错）

### 📋 其余股票
没有命中信号、但成交量达标的股票，仿 TradingView 选股器的紧凑表格：

| 列 | 含义 |
|---|---|
| # | 序号，排序或搜索后自动重新从 1 编号 |
| 股票 | 简称 + 股票代码（手机上左右滑动时，序号和这一列固定不动） |
| 走势 | 当天的日内迷你走势图，虚线是昨收；拿不到日内数据时显示近 30 日走势 |
| 价格 / 涨跌% | 最新价，以及相对昨收的涨跌 |
| 成交量 / 相对量 | 今天成交量，以及它是过去 20 天平均的几倍（≥ 2 倍加粗） |
| RSI | 14 日 RSI |
| SAR | 抛物线指标当前是多头还是空头 |
| EMA20 | 20 日均线，绿色 = 价格在均线上方，红色 = 下方 |

默认按成交量从高到低排，点表头可以换排序，上方搜索框可以按代码或名称筛选。

### 📥 下载报告
页面上方「📥 下载报告」展开后，有一条**最近 7 个交易日**的日期选择条（手机上可以左右滑），点哪一天就下载哪一天：
- **每天一份**：选好日期后可以看到那天的更新时间、信号股和股票数量，再点 CSV / Excel / PDF 下载（同一天运行多次的话，保留的是当天最后一次的结果）
- **近 7 天合并**：一个 Excel（每天一个工作表）和一个 CSV（多一列日期）

Excel 里涨跌% 按涨跌上色、表头可以筛选；CSV 带 BOM，用 Excel 直接打开中文不会乱码；PDF 为横向 A4，适合打印或存档。超过 7 天的旧文件会自动删除。

### ⚙️ 图表设置
点页面上方的「⚙️ 图表设置」打开：
- **颜色**：上涨 / 下跌 / EMA20 的颜色
- **技术指标**：按 趋势 / 动量 / 波动性 / 成交量 分类，共 19 个常用指标（包括一目均衡表 Ichimoku Cloud），点一下叠加到所有图上
- **自定义公式**：自己写公式生成指标，例如 `sma(close,10)`、`ema(close,12)-ema(close,26)`

设置只保存在你自己的浏览器里，不影响其他人，报告每次自动更新后也会保留。

## 功能特色

- 🔍 **全市场扫描**：覆盖 Bursa Malaysia 全部上市股票，不只是自选股清单
- 🎯 **固定量化策略**：`SAR 多头` + `EMA20 < 现价` + `成交量达标` + `T3 形态突破` 四个条件同时满足才算命中。成交量门槛按价格分级，越便宜的股票要求越高：

  | 价格 (RM) | 最低日成交量 |
  |---|---|
  | 0.10 以下 | 500 万 |
  | 0.10 – 0.20 | 300 万 |
  | 0.20 – 0.50 | 100 万 |
  | 0.50 以上 | 50 万 |
- 📈 **可视化 K 线图**：空心蜡烛图 + EMA20 均线 + 成交量柱状图，悬停可看当日开高低收
- ⚙️ **网页端自定义**：内置 19 个常用指标（SAR、布林带、一目均衡表、RSI、MACD、KD、CCI、ATR、OBV、VWAP 等），也能自己输入公式；颜色可调
- 📊 **选股器式表格**：每支股票都有日内迷你走势图、相对成交量、多空标签，可排序可搜索
- 🤖 **AI 辅助点评**：命中信号的股票由 DeepSeek 给出简短的可靠性评价
- 📱 **手机推送**：通过 [ntfy.sh](https://ntfy.sh) 在发现信号时推送通知
- ⏰ **全自动运行**：每个交易日盘中按马来西亚时间自动更新（详见 [`bursa-bot.md`](./bursa-bot.md) 了解排程设计）
- 📥 **报告下载**：最近 7 个交易日的报告可以下载成 CSV / Excel / PDF，也有 7 天合并版
- 🌐 **静态网页发布**：报告通过 GitHub Pages 发布，随时用手机浏览器打开查看

## 怎么运作的

```
外部定时器 (cron-job.org, 马来西亚时间) → 调用 GitHub Actions
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
生成 docs/index.html (K线图 + 选股表格 + 日内走势)
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
├── exports.py                   # 导出 CSV / Excel / PDF 下载文件
├── data/watchlist.json          # 全市场股票清单 (1070+ 支)
├── docs/index.html              # 生成的报告，GitHub Pages 从这里发布
├── docs/downloads/              # 最近 7 个交易日的下载文件 (自动生成，自动清理)
├── assets/screenshots/          # README 用的界面截图
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
