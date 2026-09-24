# Bursa Bot 项目备忘 (bursa-bot.md)

> 这份文件是给「未来的我 / 未来的 AI 助手」看的项目交接笔记。
> 每次聊天窗口要满之前更新它，就不会丢上下文。
>
> 最后更新：2026-09-24

---

## 1. 这个项目是什么

马来西亚股市 (Bursa Malaysia) 的自动选股机器人。

- 每个交易日自动扫描**全马上市股票 (1070 支，Main + ACE 板)**
- 用固定的技术指标组合筛出信号股
- 生成一个**静态 HTML 报告**，用 GitHub Pages 发布
- 有信号时往手机推送通知

**报告地址**：https://cja231.github.io/Bursa-bot/
**仓库**：`CJA231/Bursa-bot`（**必须是 public**，否则免费版 GitHub Pages 不能用）

---

## 2. 仓库结构

```
Bursa-bot/
├── main.py                      # 主程序：抓数据 → 算指标 → 筛选 → 生成 HTML → 推送
├── exports.py                   # 导出下载文件 (CSV / Excel / PDF)，见第 4 节"下载报告"
├── requirements.txt
├── README.md                    # GitHub 仓库首页介绍 (功能、架构图、免责声明)
├── LICENSE                      # All Rights Reserved (见第 9 节)
├── bursa-bot.md                 # 本文件
├── Bursa.yml                    # ⚠️ 废弃文件，不是 workflow，用户选择保留，别删
├── data/
│   └── watchlist.json           # 全市场股票清单 (1070 条)，格式 {"symbol":"0453.KL","name":"EIPOWER"}
├── assets/screenshots/          # README 用的界面截图 (light/dark 各一张，用 <picture> 按 GitHub 主题切换)
├── docs/
│   ├── index.html               # 生成的报告，GitHub Pages 从这里发布
│   ├── report.js                # 报告页脚本 (卡片轮播/工具栏/K线图/指标库/模板/表格)，手写的，不是每次生成
│   ├── downloads/               # 最近 7 个交易日的下载文件 + 7 天合并文件 (自动生成、自动清理)
│   ├── charts/table.json        # "其余股票"每支的 6 个月日线 + 当天 5 分钟线 (每次运行重写，双击时才下载)
│   ├── stock/<代码>.json         # 每支股票的财报 + 2 年日线 + 10 年月线 (一周刷新一次)，见第 4 节"完整图表 + 财报"
│   └── vendor/
│       └── lightweight-charts.js  # TradingView 图表库 v5.2.1，Apache 2.0，自托管
├── scripts/
│   ├── fetch_watchlist.py       # 用 Yahoo screener 拉全市场清单 → data/watchlist.json
│   └── debug_stock.py           # 单股调试：看某支股票过去几天符不符合条件
└── .github/workflows/
    ├── daily.yml                # 主流程 (只有 workflow_dispatch，由外部定时器触发，见第 5 节)
    ├── update-watchlist.yml     # 更新股票清单 (手动)
    └── debug_stock.yml          # 单股调试 (手动)
```

### main.py 的结构 (按文件顺序)
1. 配置区域 (`VOLUME_TIERS`/`min_volume_for`、`FETCH_WORKERS` 等常量)
2. DeepSeek 客户端
3. `detect_t3_pattern` / `get_stock_data` / `CHART_SOURCES` + `get_chart_history` (信号股多周期K线) / `get_intraday` (日内收盘价给迷你走势 + 精简K线给完整图表) / `compact_bars` / `write_table_charts` / 个股资料 (`FIN_ROWS`、`fetch_detail`、`refresh_details`、`prune_details`) / `build_sparkline` / `fmt_volume`
4. `check_strategy` (筛选策略)
5. `DEEPSEEK_SYSTEM_PROMPT` + `ask_deepseek`
6. 报告页面的前端代码常量：`SETTINGS_CSS`、`TABLE_CSS`、`SETTINGS_PANEL_HTML`、`CARD_CSS`、`TEMPLATE_BAR_HTML`
   (**这几个是普通字符串，不是 f-string**，CSS 里的大括号不用写成 `{{ }}`)
   - CSS 常量现在是 `UI_CSS` (对话框/菜单)、`CARD_CSS` (筛选器轮播/工具栏/卡片/图例)、`TABLE_CSS`、`DOWNLOADS_CSS`；`build_screener_html()` 拼出股票标签 + 工具栏容器 + 轮播
   - JS 不在 main.py 里了，在 **`docs/report.js`** (手写文件，不是每次生成)；HTML 用 `report.js?v=<文件哈希>` 引用，改了脚本浏览器会自动拿新版
7. `build_html_report` (大 f-string 模板，把上面的常量用 `{SETTINGS_CSS}` 这样拼进去)
8. `send_notification` (ntfy)
9. `main()`

---

## 3. 筛选策略（当前版本）

**四个条件必须「同时」满足**（AND 逻辑，不是 OR）：

| # | 条件 | 代码位置 |
|---|------|---------|
| 1 | `SAR < 现价`（PSAR 多头） | `check_strategy()` |
| 2 | `EMA20 < 现价` | `check_strategy()` |
| 3 | **T3 形态** 突破 | `detect_t3_pattern()` |
| 4 | 成交量达到**按价格分级的门槛** (见下表) | `VOLUME_TIERS` / `min_volume_for()`，不达标直接忽略，不进报告 |

成交量门槛 (2026-09-23 用户定的)：

| 价格 | 最低成交量 |
|---|---|
| < 0.10 | 5,000,000 |
| 0.10 ≤ 价格 < 0.20 | 3,000,000 |
| 0.20 ≤ 价格 ≤ 0.50 | 1,000,000 (0.50 本身算这一档) |
| > 0.50 | 500,000 (`MIN_DAILY_VOLUME`，原来的门槛) |

价格先四舍五入到 3 位再分档 (避免 0.0999999 这种浮点误差把 0.10 分进 5M 档)。

命中时返回文案：`🎯 EMA20多头 + SAR多头 + T3形态突破`

**新上市 / 历史很短的股票** (9/24 用户要求："不足 90 天也不用紧，一样按照设定的成交量筛选")：
- 以前 `get_stock_data` 里 `len(df) < 50` 就当"数据不足"直接丢掉 (9/23 日志里的 0041、0468–0471、5356 就是这样被丢的)；现在**只要有 1 天数据就照样按成交量门槛筛选**
- 天数不够算的指标留 `None`，网页和 Excel/PDF 显示 "—"：RSI 要 15 天、EMA20 要 20 天、50日均线要 50 天、SAR 要 2 天；相对量不足 20 天就用现有那几天平均
- 策略照旧四个条件都要满足：EMA20 是 None 就不算命中，T3 至少要 26 天 → 新股通常先进"其余股票"表格，满 26 天左右才可能出信号
- 表格和卡片标题旁标 **"N天"** 小标签 (历史 < 90 个交易日时)，鼠标移上去有说明
- `history_days` = 这次下载到的交易日数 (6 个月上限约 123 天)；停牌很久的股票也可能被标上

### T3 形态的定义（用户自定义，很重要，别改错）

用户原话整理：

> T1 那天要有**比较大的成交量**（高于**前 20 天平均成交量**），形成一个 current high；
> 后面**两个交易日是回调**（不能突破 T1 的高点）；
> 到了 **T3 或 T4（第 3、4、5、6 天都算）** 收盘价**突破 T1 的高点**，形成 new high。

代码实现（`main.py` 里的 `detect_t3_pattern`）：

```python
def detect_t3_pattern(df):
    if len(df) < 26:
        return False
    vol_avg20 = df["Volume"].rolling(20).mean().shift(1)
    today_close = df["Close"].iloc[-1]
    last_idx = len(df) - 1
    for offset in range(2, 6):          # T1 = 今天往前 2~5 天
        t1_idx = last_idx - offset
        if t1_idx < 20:
            continue
        t1_volume  = df["Volume"].iloc[t1_idx]
        t1_vol_avg = vol_avg20.iloc[t1_idx]
        if pd.isna(t1_vol_avg) or t1_volume <= t1_vol_avg:
            continue                     # T1 成交量不够大
        high1 = df["High"].iloc[t1_idx]
        pullback_highs = df["High"].iloc[t1_idx + 1 : last_idx]
        if (pullback_highs >= high1).any():
            continue                     # 中间那几天已经破了 T1 高点，不算回调
        if today_close > high1:
            return True                  # 今天收盘突破 → 成立
    return False
```

**注意**：`vol_avg20` 用了 `.shift(1)`，即「前 20 天」不含 T1 当天本身。

---

## 4. 报告长什么样 (`build_html_report`)

从上到下：

1. **标题 + 更新时间**
2. **📥 下载报告** (折叠)
3. **筛选器** — 标题下面一行小字是当前指标模板名 → 股票标签 → 全局工具栏 → **卡片轮播** (一次一张)
4. **📋 其余股票** — 仿 TradingView 选股器的表格 (电脑撑满宽度，手机两行式)
5. 完全没数据 / 抓取失败的股票只报个数量 (历史短的新股不算，照样进表格)
6. 版权页脚 (中英双语 + TradingView 署名 + 数据来源说明)

### 筛选器 = 卡片轮播 (9/24 改版，参考 TradingView 的顶部工具栏和指标对话框)
- 用户原话要点 (9/24)：信号股图表做成**卡片左右翻阅** (堆 10 多支也不会让页面很长)；**图表类型照 TradingView 那样分组**；**指标模板照 TradingView「指标、衡量标准和策略」那样分类**；**图表设置换一种方式**；**点主图上的指标可以改参数**；表格在电脑/手机上都要 fit
- 之前 (9/23) 的要点仍然有效：标题叫"筛选器"、下面小字是模板名、图表下方只放数据 (quote) 不放说明文字、指标可放主图或副图、图例有删除和上下顺序
- **结构** (main.py `build_screener_html`)：`.sym-strip` 股票标签 (名称 + 现价 + 涨跌%，点了跳到那张) → `#chart-toolbar` (report.js 填) → `.carousel` > `#car-track` (横向 scroll-snap，每张卡片 `flex: 0 0 100%`) + 右上角 `‹ 1 / N ›`
  - 只画当前卡片和左右各一张 (`ensureRendered`)，其余等翻到才画；看不到的卡片设 `inert` (不然 Tab 聚焦进去会把轮播横向拖到一半)
  - 轮播区滚进屏幕才画第一张 (IntersectionObserver)；窗口大小变了停在同一张
- **全局工具栏** (对所有卡片生效)：周期 | 图表类型 ▾ | ƒx 指标 | 模板 | ⚙
  - 周期同以前 (1分…月)，记在 `bursa_timeframe_v1`；某支股票没有那个周期的数据时这张卡片退回日线并显示一行红字说明
  - **图表类型** (`CHART_TYPE_GROUPS`，记在 `bursa_chart_type_v1`)，分组照 TradingView：
    美国线 / K线图 / 空心K线图 (默认) / ~~成交量蜡烛~~ ｜ 线形图 / 带标记线 / 阶梯线 ｜ 面积图 / HLC区域 / 基准线 ｜ 柱状图 / 高-低 ｜ ~~成交量轨迹 / 时间价格机会 / 交易时段成交量分布图~~ ｜ 平均K线图 / ~~砖形图 / 新价线 / 卡吉图 / 点数图 / 范围图~~
    - 划掉的 = 灰色 "暂不支持" (要非时间轴图表或逐笔成交数据，Lightweight Charts 做不了)
    - HLC 区域 = 收盘线 + 高/低细线 + 两段填色 (`BandPrimitive`)；基准线的基准 = 收盘价中位数；高-低 = 开=高、收=低 的蜡烛；平均K线 = Heikin Ashi 前端计算
    - 换类型/换颜色时整张图 `chart.remove()` 重建 (`rerenderAll`)，比逐个改 series 简单可靠
  - **⚙ 图表设置**：对话框里改上涨/下跌/EMA20 颜色 (`bursa_colors_v1`)，原来页面顶部的「⚙️ 图表设置」大面板已经删掉
- **卡片**：名称 + 代码 | 现价 + 涨跌 → 筛选条件小字 → K 线图 (主图 + 副图) → quote (十字光标那根K线 + 日线数据格子)
  - 主图高：电脑 440px、手机 300px；每个副图 +140 / +110px
- **图表左上角图例**：EMA 20 (固定) + 每个指标：色块、**名称 (点一下 = 打开这个指标的设置)**、数值、👁 隐藏、⚙ 设置、↑ ↓、🗑
  - 电脑上鼠标移过去才出现按钮；**手机 (`hover: none`) 上点这一行 (不是名称) 展开按钮，展开时把数值藏起来**，不然名称会被挤成 0 宽度点不到 (9/24 测出来的坑)
  - 隐藏的指标：灰色 + 删除线，不画线、不占窗格
- **指标设置对话框** (`openIndicatorSettings`)：「输入」页 = 参数 (数字框，按定义的 min/max/step 清洗)；自定义公式则是名称/公式/坐标轴；「样式」页 = 每条线的颜色 (MACD 柱有正/负两色)、线宽、主图/副图、显示；恢复默认 / 取消 / 确定

### 指标库 (`INDICATOR_DEFS`，16 个，参数都能改)
- 每个定义：`inputs` (参数，含默认值和范围)、`plots` (画哪几条线、默认颜色、`type: dots/hist`)、`formulas` (带 `{length}` 这类占位符的公式，交给公式引擎算)、`scale` (price/own/volume)、`levels` (RSI 70/30 这种虚线)、`band` (布林带上下轨之间填色)
  | 分类 | 指标 (默认参数) |
  |---|---|
  | 趋势 | SMA 20、EMA 50、SAR 0.02/0.2、布林带 20/2 (中轨+上下轨+填色)、一目均衡表 9/26/52/26、Supertrend 10/3 |
  | 动量 | RSI 14、MACD 12/26/9 (线+信号线+柱，一个副图)、Stochastic 14/1/3、CCI 20、Williams %R 14 |
  | 波动性 | ATR 14、布林带带宽 20/2 |
  | 成交量 | 成交量均线 20、OBV、滚动 VWAP 20 |
  - 以前的 SMA20/SMA50 两个预设合成一个可调参数的 SMA；布林带三条线、MACD 两条线以前是分开的指标，现在各合成一个
  - 同一个指标可以加好几次 (例如 SMA 20 + SMA 50)
- **ƒx 对话框** (`openIndicatorsDialog`)，分类照 TradingView：
  - 个人：收藏 (`bursa_ind_favorites_v1`) / 我的脚本 (自定义公式库 `bursa_my_scripts_v1`，存了以后一点就加)
  - 模板：我的模板 (切换 / 另存当前 / 空白 / 删除) / 内置模板 (`BUILTIN_TEMPLATES`：趋势跟随、一目均衡表、动量组合、波动率、量价；套用 = 复制成新的我的模板)
  - 内置：技术指标 (全部) / 趋势 / 动量 / 波动性 / 成交量
  - 顶部搜索 (同时搜指标、脚本、模板) + "添加到：自动 / 主图 / 新副图"
  - 每行：☆ 收藏 | 名称 (点 = 添加) + "已加 N" | 分类 | `{ }` 展开说明和公式、＋
  - 手机上变成从底部弹出的全屏面板，左边分类变成上方一排可滑动的标签
- 工具栏的「模板」按钮 = 打开同一个对话框，直接停在「我的模板」

### 指标模板 = "筛选器名称" (标题下方那行小字)
- localStorage **`bursa_templates_v2`** = `{active, list: [{id, name, indicators: [...]}]}`；指标实例 = `{id, def, params, colors, width, pane, hidden}` (自定义公式多 `name/formula/scale`)
- **迁移**：没有 v2 时读 v1 (`bursa_templates_v1`) 或更早的 `bursa_custom_indicators_v1`，按 `LEGACY_PRESETS` 把旧预设 id 换成新指标 + 参数 (布林带/MACD 多条合成一个、去重)；v1 不删，万一要回退还在
- 名称可以直接点着改；加/删/调顺序/改参数/切主副图 **每次改动立刻保存**，旁边闪一下 "✓ 已自动保存"
- 模板只存指标，不存颜色、周期、图表类型 (这三个是全局的)

### 公式引擎 (自定义公式 + 大部分内置指标都靠它算)
- 变量：`close open high low volume`；函数：`sma ema stdev highest lowest sum rsi atr obv abs`
- 运算：`+ - * / ^`、括号、负号 (优先级跟 Python 一样，`-2^2 = -4`)；RSI/ATR 用 Wilder 平滑，跟 pandas_ta 一致
- 加之前先用假数据试算一次，公式有错当场提示

### "其余股票" 表格
- 第一列是序号 (CSS 计数器生成，排序/搜索后自动从 1 重新编号)
- 列：股票 (简称徽章 + 代码) | 走势 | 价格 | 涨跌% | 成交量 | 相对量 | RSI | SAR | EMA20
- **电脑**：表格撑满页面宽度 (`width: 100%`)，走势图跟着列宽拉长 (SVG `preserveAspectRatio="none"` + `vector-effect: non-scaling-stroke`)
- **手机 (≤ 640px)**：不再横向滑动，每行用 CSS grid 排成两层 —— 第一层 `# 股票 走势 价格`，第二层 `量 相对量 RSI SAR EMA20 涨跌%` (每格上面一行小字标签，来自 `data-label`)；表头藏起来，改用搜索框旁边的「排序」下拉框 (`#table-sort`，值是 `列号:asc/desc`)
- **走势 = 迷你日内图**：服务端直接画成内嵌 SVG (不用 JS)
  - 数据来自 `get_intraday` (yfinance `period="1d", interval="5m"`)，**只对会进表格的股票抓**，同样并发；同一份 5 分钟线也存进 `table.json` 给完整图表用
  - 虚线 = 昨收；线的最后一个点补上现价 (Yahoo 5 分钟线会慢一点)；颜色 = 现价相对昨收：涨绿、跌红、没变灰 (`spark-flat`)，跟"涨跌%"一致
  - 拿不到日内数据的退回画近 30 日收盘价 (没有虚线，颜色按 30 日走势，可能跟当天涨跌不一致)；悬停提示会写是哪种
  - 颜色用 CSS 变量 `--up/--down`，⚙ 图表设置里改颜色也会生效
- 相对量 = 今天成交量 / 前 20 日均量 (≥2 加粗)
- 默认按成交量从高到低排；点表头可排序 (走势列不可排序)
- 顶部搜索框按代码/名称即时过滤
- 旧表格里的 SMA50 列已去掉 (信号卡片里还有)

### 🔍 完整图表 + 财报 (9/24，PR #23)
用户要求：搜索其他股票时可以点开看完整走势图，双击表格一行打开，附上近 4 季财报和近 2 年年报的可视化。
- **怎么打开**：电脑双击"其余股票"的一行、手机点一下 (手机双击会被当成放大页面)、键盘选中行按 Enter；筛选器卡片标题下方也有「完整图表 · 财报 ›」按钮。表格上方有一行提示
- **对话框** (`openStockModal`，`docs/report.js` 的"完整图表 + 财报"那一段)：周期按钮 + ƒx 指标 + 图表 + 开高低收 + 财报。图表就是卡片那套 `renderChart`，所以图表类型、指标、模板全部通用 (改了指标所有图表一起变)；关掉时 `destroyChart` + 删掉 `data[id]`
- **K 线从哪来**：
  - 筛选器卡片：直接用卡片自己的数据 (2 年日线 + 10 年月线 + 1/5/15/60 分钟线)
  - 表格股票：`docs/charts/table.json` (6 个月日线 `d` + 当天 5 分钟线 `i`，每次运行都重写) **接上** `docs/stock/<代码>.json` 里更早的日线 / 月线 (`basesFromTable`)：
    - 日线 = 个股资料里早于 table.json 第一天的部分 + table.json 的 6 个月
    - 月线 = 日线第一个月 (可能不完整) 以及更早的月份用 10 年月线，之后的月份用日线合成
    - 15 分 / 1 小时由 5 分钟线按 9:00 开市对齐合成；**表格股票没有 1 分钟线** (1分按钮灰色)
    - 个股资料还没抓到时只有 6 个月日线，对话框里会写"后台还在补"
  - 精简格式 (`compact_bars`)：价格 ×1000 存整数 (Bursa 最小跳动 0.005)，时间只存第一根 `t0` + 每根间隔 `dt` (单位 `u` 秒)，比卡片用的格式小一半以上
- **个股资料 `docs/stock/<代码>.json`** (`refresh_details`)：`{"v":1, symbol, fetched_at, fin: {quarterly, annual, currency} | null, bars: {d, m}}`
  - 每次运行按"信号在前、其余按成交量从高到低"挑**没有文件或过期**的，最多补 `DETAIL_PER_RUN = 30` 支 (8 线程)；250 支表格股票大约 9 次运行 (1 天) 补齐，之后每天只需要刷新 1/7
  - 有财报的 7 天后刷新；**Yahoo 没给财报的 2 天后再试** (yfinance 抓财报出错时不会报错，只会给空表格，分不出"本来没有"还是"被限流"，所以不想一错就等一周)
  - **日线都拿不到 = 这次请求失败**，不写文件，下次运行再试 (上市公司不可能没有 K 线)
  - 超过 30 天没更新、这次也不在报告里的文件自动删除 (`prune_details`)；读不了的坏文件也删
  - 财报科目 (`FIN_ROWS`)：每个输出键列了几个 Yahoo 可能用的科目名称，按顺序取第一个有的；报告期以利润表为准，资产负债表 / 现金流量表同一天的数字对上去
  - `currency` 来自 `Ticker.info["financialCurrency"]` (只在有财报时才多这一个请求)；网页上 MYR 写"令吉 (RM)"，其他货币直接写出来并注明"不是令吉"，拿不到写"公司报告货币"
- **财报图表** (照 dataviz 规范)：营业收入 / 净利润 / 净利率 / 经营现金流**一张图一个指标，不用双坐标轴**；柱子最宽 24px、数据那头 4px 圆角、贴基线那头直角；只标最新一期的数值 (负数标在基线上方，不会压到季度文字)，其余看悬停提示 (SVG `<title>`) 和下面的完整表格；营收用单一颜色 (`--ema`)，盈亏类用 `--up/--down`；标题右边写"较上季 / 较上年"变化，正负号变了直接写"转盈 / 转亏"(现金流"转正 / 转负")，净利率写"个百分点"
  - ⚠️ 红绿配色对红绿色弱不友好 (验色脚本 deutan ΔE 4.1，不及格)，但正负同时还靠柱子方向 (基线上 / 下) 和数字的负号表达，所以保留跟全站一致的涨跌色
  - 手机 (≤ 640px)：图表两栏，SVG 会缩到约 0.7 倍，所以手机上 SVG 字号写大 (13/14px，实际显示约 9–10px)；表格藏掉日期小字，四季刚好放得下不用横向滑；周期按钮排两行
- **完整年报 PDF**：只放了 Bursa 公司资料页链接 `bursamalaysia.com/trade/trading_resources/listing_directory/company-profile?stock_code=<代码>` (沙箱打不开 bursamalaysia.com，但 WebSearch 查到 Bursa 官网自己的页面就是这个网址格式，例如 `?stock_code=1818`、`?stock_code=5014`；年报在页面里的公司公告)
- **大小**：table.json 约 5KB/支 (250 支约 1.2MB，gzip 后约 0.4MB，第一次双击才下载)；个股资料约 16KB/支 (250 支约 4MB)。每次运行都会提交 table.json，git 用 delta 压缩，实际增长比文件大小小很多，但仓库会慢慢变大 (如果以后改用 Actions 部署 Pages，这两个都可以不进 git)
- `daily.yml` 的 `git add -A` 加上了 `docs/charts docs/stock`；两个目录里各放了一个空的 `.gitkeep`，因为 `git add` 碰到**不存在的路径会直接报错** (`fatal: pathspec ... did not match any files`)，非交易日 main.py 提前返回、目录还没生成时整个发布步骤就会失败

### 📰 个股新闻 + 对话框改版 + 手机防误触 (9/24 第二轮)
用户要求：手机上图表太靠右，滑页面一直误触；电脑上完整图表不用硬塞满一屏，左边正方形图表、右边财报、下面新闻。
- **误触的真正原因** (Playwright 用 CDP 发真实触摸事件验证过)：Lightweight Charts 默认 `handleScroll.vertTouchDrag: true`，手指在图表上**上下滑会被图表吃掉，页面完全不动 (0px)**；右边价格轴默认可以拖动缩放。改成没有鼠标的设备 (`TOUCH_ONLY` = `(hover: none)`) 上 `vertTouchDrag: false` + `axisPressedMouseMove.price: false` 后，同样的手势页面滑了 280px
- 手机 / 平板上 `.chart-wrap` 右边留 26px、表格右边留 22px 的空白 + 一条细线提示，给拇指滑页面
- 表格：页面滑动停下 400ms 内的点击不算 (惯性滑动时按一下是想停，不是想打开)
- **对话框版面**：≥ 900px 两栏 (`.sv-grid`)，左边K线主图是正方形 (`data-square`，`mainHeightOf()`：高 = 宽，限制 260–720px，副图另外加高；宽度变了 `layoutPanes()` 重算)，右边财报 (小图固定两栏)；新闻整排在下面。对话框加宽到 1280px。手机上从上到下排
- **新闻** `docs/news/<代码>.json` (`refresh_news`)：`{v, symbol, fetched_at (ISO, 马来西亚时间), query, source, items: [{title, source, link, time}]}`
  - 主要来源 Google News RSS (`news.google.com/rss/search?q="<公司全名>" when:90d&hl=en-MY&gl=MY&ceid=MY:en`)，全名去掉 Berhad/Bhd；Google 拿不到才用 yfinance `Ticker.news` (Yahoo 对马股小公司常给无关的大盘新闻，所以不当主要来源)
  - 公司全名来自个股资料的 `long_name` (`Ticker.info["longName"]`)；**旧格式的个股资料没有 `long_name`，`read_detail_date` 当成过期重抓** (约一天补齐)，补齐前用"简称 + Bursa"搜
  - 12 小时刷新一次，每次最多 40 支 (8 线程)；两个来源都出错 = 不写文件下次再试；搜到 0 条也写 (items 空)；只留 90 天内最新 8 条，同标题去重；30 天没更新、不在报告里的删掉
  - 只存标题 + 来源 + 链接 (不转载内文)；Google News RSS 条款是个人、非商业使用，跟 Yahoo 数据一样，**商业化前要换来源**
  - ⚠️ 沙箱连不上 news.google.com，只用假数据测过；第一次真实运行后看日志 `📰 个股新闻` 那行
- `daily.yml` 的 `git add` 加上 `docs/news` (目录里放了 `.gitkeep`)
- 指标设置窗口左下角加了「🗑 删除」(点图例名称打开的就是它)
- **底部搜索栏** (`report.js` 最后一段，`.dock`)：固定在页面最下方，打开对话框时藏起来。只搜今天报告里的股票 (信号卡片 + 表格)，排序 = 代码或名称完全一样 > 代码开头 > 名称开头 > 名称包含 > 代码包含，同分信号股在前；最多 8 条，↑↓ 选、Enter 打开、Esc 关；电脑上按 `/` 跳进搜索框。选中信号股 = 点那张卡片的「完整图表 · 财报」，表格股票 = `openTableRow(tr)`。输入框字号 16px (iPhone 小于 16px 会自动放大页面)；`body` 底部多留 5.5rem、toast 往上移，不会被挡住

### ☁️ 一目均衡表 (Ichimoku Cloud，9/23 按用户给的 TradingView Pine 脚本加入)
- 指标库「趋势」里的「一目均衡表」，一次加 5 条线 + 云 (4 个参数、5 种颜色都能改)：转换线 `#2962FF`、基准线 `#B71C1C`、延迟线 `#43A047`、先行带A `#A5D6A7`、先行带B `#EF9A9A`；A 在 B 上方云是绿色，下方是红色 (颜色跟 TradingView 一样)
- 算法跟 Pine 完全一样：`donchian(n) = (n日最高 + n日最低)/2`，先行带 `offset = displacement - 1 = 25`，延迟线 `offset = -25`
- 一开始在后台算 (`compute_ichimoku`)，加了多周期后改到前端 `ichimokuSeries()`，每个周期各算各的；日线用 2 年数据，整张图都有云
- 云是 **series primitive** (`attachPrimitive`) 直接在画布上画的 (库本身没有"两条线之间填色")；两条线交叉的那一段按交点切成两个三角形，颜色在交叉点准确切换
- 只有信号卡片的K线图能加，表格里的迷你走势图不受影响

### 📈 Supertrend (9/24 按用户给的 TradingView Pine 脚本加入)
- 指标库「趋势」里的「Supertrend 超级趋势」：ATR 10、倍数 3 (都能改)；多头时绿线 `#4CAF50` 在K线下方，空头时红线 `#FF5252` 在上方；线和K线实体中点 (open+close)/2 之间有 10% 透明度的填色
- `seriesSupertrend()` 逐句照 Pine `ta.supertrend` 的参考实现：ATR 用 Wilder 平滑 (跟 `seriesATR` 共用)，中线 hl2，上下轨只能往有利方向收紧 (`nz(band[1])`、`close[1]` 的判断都照搬)
  - 跟逐句翻译的 Python 版对过：5 组 × 400 根，**0 差异** (含 47 次方向翻转)；跟 pandas_ta 比大部分一致，只有开头热身期几根不同 (pandas_ta 起算方式不一样)，以 Pine 为准
- ⚠️ 坑：**Lightweight Charts v5 的折线遇到空白点 (whitespace) 不会断开，会直接连过去** (实测)。Pine 的 `plot.style_linebr` 要"方向一变线就断"，所以线和填色都由 `SupertrendPrimitive` 自己画 (填色在K线下面、线在K线上面)；两条 `lineVisible: false` 的隐形折线只用来撑价格坐标轴范围、给图例取数值
- 图例只显示当前方向那条线的数值 (`optional` 的部分没值就不显示)
- 按当前周期计算 (Pine 的 `timeframe=""` 就是跟随图表周期)

### 📥 下载报告 (`exports.py`)
- 页面上方的 `<details>` 区块 (默认折叠)，最近 `KEEP_REPORT_DAYS = 7` 个**报告日** (只有交易日才有报告，所以约一周半)
- 区块里是一条**日期选择条** (左旧右新，手机上左右滑)：每个日期显示 月/日 + 星期 + (有信号时) "● 信号"；点哪天，下方就显示那天的更新时间、信号股名字、共几支，CSV / Excel / PDF 三个按钮跟着换成那天的文件。默认选中最新一天，展开时自动滚到最右；键盘 ←/→/Home/End 可切换。没开 JS 也能下载最新一天 (按钮的默认链接就是最新一天)
- `export_downloads()` 返回的每一天带 `count` (共几支) 和 `signals` (信号股名字)，从各天的 data.json 读出来
- 每次运行 `main()` 在生成网页**之前**调用 `export_downloads()`，写到 `docs/downloads/<日期>/`：
  `bursa-report-<日期>.csv / .xlsx / .pdf` + `data.json` (合并文件的数据来源)
- 同一天跑多次 → 覆盖，保留当天最后一次；超过 7 个日期的文件夹自动删掉 (只删名字是日期的文件夹)
- 另外生成 `bursa-report-last7.xlsx` (每天一个工作表) 和 `bursa-report-last7.csv` (多一列"日期")
- 文件夹日期取**行情数据最新一根日线的日期**，不是系统时间 (FORCE_RUN 周末跑不会生成"周六"的文件)
- 导出失败**不会**拖垮主流程：打印 ⚠️，报告照常生成，只是这次没有下载区块
- daily.yml 发布步骤用 `git add -A docs/index.html docs/downloads`，`-A` 才会把删掉的旧文件夹一起提交
- 格式细节：CSV 用 utf-8-sig (带 BOM，Excel 打开中文不乱码)；Excel 涨跌% 存成小数+百分比格式并上色、表头冻结+筛选；PDF 横向 A4，用 reportlab 自带的中文 CID 字体 `STSong-Light` (不用往仓库放字体文件)
- 依赖：`openpyxl`、`reportlab` (requirements.txt)
- 耗时：真实规模 (330 行 + 7 天合并) 约 1 秒，⏱️ 耗时行里的"导出下载"
- ⚠️ **仓库体积**：每次运行提交约 190KB (当天文件夹) + 400KB (两个合并文件)，Excel/PDF 本身是压缩格式，git 没法按差异存。一天 10 次约多 3MB 历史、一年约 1GB。以后如果嫌大，可以改成"用 GitHub Actions 部署 Pages"(下载文件不进 git，只保留 data.json)

---

## 5. 排程 (✅ 已解决：外部定时器)

### 用户想要的时间（马来西亚时间 UTC+8，只在交易日）
9:15、9:45、10:15、10:45、11:30、12:25、2:45pm、3:45pm、4:30pm、5:30pm —— **一天 10 次**

时间点故意错开整点/半点，是为了**避开 DeepSeek API 高峰时段定价**。

### 为什么不用 GitHub 自带的 cron
- 历史 cron `30 9 * * 1-5` 的 15 次定时 run (#144–#158) **平均迟到 5.7 小时**，最长 11.5 小时
- 改成 10 个密集时段后，GitHub 把 10 个触发攒着，**从下午 2 点一直陆续放到快午夜才跑完** (9/21 实测)
- 官方文档：schedule 是 best-effort，高负载时会延迟甚至丢弃，不适合盘中精确排程
- **所以 daily.yml 里的 `schedule:` 已经整段删掉** (PR #15)，只留 `workflow_dispatch`

### 现在的做法：cron-job.org 定时调用 GitHub API
每个时段在 cron-job.org 建一个任务：

| 字段 | 值 |
|---|---|
| URL | `https://api.github.com/repos/CJA231/Bursa-bot/actions/workflows/daily.yml/dispatches` |
| Method | `POST` |
| Header | `Accept: application/vnd.github+json` |
| Header | `Authorization: Bearer <fine-grained PAT>` |
| Header | `Content-Type: application/json` |
| Body | `{"ref":"main","inputs":{"force":"false"}}` |
| Time zone | `Asia/Kuala_Lumpur` |
| Schedule | **Advanced** 标签 → Custom，只勾一个小时 + 一个分钟 + 周一到周五 (例如 9:15 = `15 9 * * 1-5`) |

- **PAT**：fine-grained，只授权 `CJA231/Bursa-bot` 这一个仓库，权限只开 **Actions: Read and write**
- **PAT 到期日：2026-12-21** (从 GitHub API 响应头 `github-authentication-token-expiration` 看到的)。到期前要重新生成，并把 cron-job.org 里每个任务的 Authorization header 都换掉，否则会全部 401
- 成功时 cron-job.org 测试显示 **204 No Content**
- ⚠️ **GITHUB_TOKEN 不能触发 workflow_dispatch**（GitHub 防递归），所以必须用 PAT
- 一个任务里**不要**勾多个小时/多个分钟，会变成所有组合都触发

### 当前进度 (2026-09-23)
- 9/23 实测准点触发的 run (都在整点后 8~15 秒内，很准)：**9:15、12:15、2:45pm、3:45pm** (3:45 那次是 15:45:15 触发的 run #209，所以 2:45 和 3:45 两个任务都在)
  - 12:15 跟原计划的 12:25 不一样，用户还没说是故意改的还是手误
- **还没建的** (按实际触发推算)：9:45、10:15、10:45、11:30、4:30pm、5:30pm

### 怎么分辨 run 是怎么触发的
- `event: "schedule"` = GitHub 自带 cron (现在已经不会再出现)
- `event: "workflow_dispatch"` = 手动按钮 **或** cron-job.org (两者在 API 里分不出来，只能看时间是不是准点)
- 两者 UI 上都挂用户头像 (`actor: CJA231`)，光看头像分不出来

---

## 6. 其他机制

### 运行速度

**现在的抓取流程** (`main()`)：
1. `prefetch_quotes()`：Yahoo screener 约 5 个请求 (每页 250 支) 拿全市场现价+成交量，**不够门槛的直接忽略，不下载历史**
2. 剩下的 (+ screener 里没有的) 用 `ThreadPoolExecutor(FETCH_WORKERS=24)` 并发跑 `fetch_stock`：下载 6 个月历史 → 再检查一次成交量 (不够就在算指标**之前**返回) → 算指标 → 会进表格的顺便抓日内走势 (同一个线程里，不再是第二轮)
3. screener 出错会自动退回"全部逐支下载"，结果一样只是慢一点

**日志里的耗时行**：每次运行最后会打印
`⏱️ 耗时: 导入库 Xs | screener 预筛选 Xs | 抓取+指标+日内 Xs | 筛选+DeepSeek Xs | 导出下载 Xs | 图表+财报 Xs | 生成报告 Xs | 推送 Xs | 总计 Xs`
("图表+财报" = 写 table.json + 补个股资料；补 30 支大约 9 个请求/支 ÷ 8 线程，估计 10–20 秒，补齐之后每次只剩几支)
超过 1 分钟时先看这一行。daily.yml 设了 `PYTHONUNBUFFERED=1`，日志每行的时间戳是真实的 (以前 Python 输出被缓冲，所有行都挤在结束那一秒，看不出慢在哪)。

**实测记录**：

| Run | 代码 | 分析步骤 | 整个 run | 备注 |
|---|---|---|---|---|
| (旧) | 串行 | 188s | ~3m40s | |
| #207 | 16 线程并发 | 49.5s | 74s | 安装依赖 18s (真正安装 14.4s，主要是 pandas_ta 带进来的 numba/llvmlite) |
| #208 | + 日内走势第二轮 | **10m55s** | 11m37s | **异常**：同样代码 15 分钟后的 #209 只要 63s，包版本完全一样、0 抓取失败、日内那一轮只花 ~6s → 推断是那段时间 Yahoo 响应变慢 (日志被缓冲，无法精确证明) |
| #209 | 同 #208 | 63s | ~89s | 比 #207 多的 ~13s 是日内走势那一轮 |

**run #209 详细检查** (新表格第一次真实跑)：成功；2 个信号 (0168 BMGREEN、5073)；表格 327 支；日内走势 **317/327 (97%)** 拿到数据，剩下 10 支是当天没交易的 (yfinance 报 "possibly delisted")，走 30 日走势 fallback；0 抓取失败；报告 496KB (旧版 174KB，多出来的主要是 327 个内嵌 SVG 走势图)。
- DeepSeek prompt cache 两次都是 **命中 0 / 未命中 155**：第二次调用只隔 2 秒，缓存可能还没建好，而且整个 prompt 才 155 tokens，就算命中也省不了多少。**这个优化实际上没效果，但也不值得再折腾**

**9/23 这一轮优化 (还没实测)**：screener 预筛选、成交量检查挪到算指标之前、日线+日内合成一轮、并发 16→24、交易日判断改成只抓 5 天、DeepSeek 最后一次调用后不再 sleep、缓存整套已安装的 Python 包 (key 带 ISO 周数，每周重装一次，yfinance 不会一直停在旧版本)、job 加 `timeout-minutes: 20`

- ⚠️ 如果 FETCH_WORKERS=24 之后日志里"数据不足/抓取失败"明显变多，说明被 Yahoo 限流了，调回 16
- 还可以再省的：`pandas_ta` 拉进来的 numba/llvmlite 占了大部分安装时间和导入时间。RSI/SMA/EMA 自己写很简单，但 **PSAR 的算法要跟 pandas_ta 完全一致**，否则策略结果会变，所以暂时没动

### 交易日判断
```python
TRADING_DAY_REFERENCE = "1155.KL"   # 马银行，流动性最好，用它判断今天有没有开市
def is_trading_day(today_myt): ...
```
> 踩过的坑：以前用 `WATCHLIST[0]`，换成 1070 支动态清单后 index 0 变成冷门小票，判断就废了。

`FORCE_RUN=true` 可以绕过交易日检查（`workflow_dispatch` 的 `force` boolean input），测试用。

### 手机推送
- 用 **ntfy.sh**，topic 存在 secret `NTFY_TOPIC`
- **必须用 JSON body 的 publish API**，不能用 HTTP header 传中文（header 不支持 UTF-8）
- payload: `{topic, title, message, click, tags}`，`click` 指向报告 URL

### DeepSeek
- 用 `openai` SDK，`base_url="https://api.deepseek.com"`，model `deepseek-chat`
- API key 在 secret `DEEPSEEK_KEY`；`main.py` 开头 fail-fast，没有 key 直接 `SystemExit`
- **Prompt cache**：固定说明全部放在 `DEEPSEEK_SYSTEM_PROMPT` (纯静态常量，不能拼时间戳/随机数)，每支股票的数据只放 user message。DeepSeek 按"从头逐字节匹配的最长公共前缀"打折，同一次运行命中多支股票时，第二支起能吃到缓存价
- 每次调用会打印 `prompt_cache_hit_tokens / prompt_cache_miss_tokens`，在 Action 日志里看命中率
- **不给买卖建议** (9/23 用户要求"图表下方不要出现买卖建议")：以前 prompt 要求给"买入/观望/卖出"建议，BMGREEN 的点评就出现了"建议观望，待站稳1.73再买入"。现在 prompt 只让它从技术面评价信号可靠性，并明确禁止买入/卖出/观望/持有/加减仓/止损/止盈/目标价等字眼
- 模型不一定每次都听话，所以还有第二道保险 `strip_trade_advice()`：按标点切成分句，含 `TRADE_ADVICE_RE` 里任何字眼的分句整句删掉；全删光就不显示点评。网页卡片、Excel、PDF 都用过滤后的结果。注意"超买"这种技术名词不会被误删 (正则里没有单独的"买"字)

### 全市场清单怎么来的
`scripts/fetch_watchlist.py`：
```python
yf.screen(EquityQuery('eq', ['region', 'my']))   # → 筛 quoteType == "EQUITY" → 1070 支
```
（Bursa 官网下载 Excel 要付费 Pro 版，所以走 Yahoo。）

**新上市的股票不用等清单更新** (9/24)：每次运行的预筛选本来就用同一个 screener 拿到全马股票报价，
`build_scan_list()` 会把 screener 里有、`watchlist.json` 里没有的普通股一起扫描 (日志印 "🆕 screener 里有 N 支清单里没有的股票")；
清单里名称还是代码的 (刚上市时 Yahoo 还没名字，例如 `0468.KL`) 也顺便换成 screener 的新名称。
screener 出错时就只扫清单里的股票 (跟以前一样)。清单文件本身不会被自动改写，想更新还是手动跑 `update-watchlist.yml`。

---

## 7. 已知的坑 / 历史教训

| 坑 | 原因 & 解法 |
|---|---|
| 158 次 run 全失败 | `DEEPSEEK_KEY` secret 没填 → 用户在 Settings→Secrets 加上；已加 fail-fast 提示 |
| Pages 没有选项只有 domain | 用户当时在**账号级** Settings，不是**仓库级**；后来又因为仓库 private 被挡，**改成 public 才解决** |
| 报告跑完没变化 | ①过了马来午夜，当天还没数据 → 加 `FORCE_RUN`；②4.5MB 页面手机加载不完 → 收紧筛选 + 只给信号股画图 |
| 图表手机上不显示 | CDN (jsdelivr) 被挡 → **把库 vendor 进仓库** + 懒加载 |
| 悬停取不到当天数据 | `param.time` 是 BusinessDay 对象 → 改用 `param.seriesData.get(series)` |
| 定时任务不准/不跑 | GitHub cron best-effort → 改用 cron-job.org (第 5 节) |
| cron-job.org 测试 400 Bad Request | **手机输入法把直引号 `"` 自动换成了弯引号**，JSON 解析失败 → 关掉"智能标点"重新输入 |
| cron-job.org Authorization 写成 `Bearer github_pat_github_pat_...` | 复制的 token 本身就带 `github_pat_` 前缀，又手打了一次 |
| 设置面板关不掉 / 元素 hidden 不生效 | class 里写了 `display: flex` 会盖掉浏览器默认的 `[hidden]{display:none}` → CSS 里加了 `[hidden] { display: none !important; }` |
| K 线图盖住下面的图例 | CSS 容器 220px、JS 画 260px → 统一成 260px |
| 日内走势颜色跟涨跌% 相反 (run #209 的 HEGROUP：+0.94% 但走势红色) | Yahoo 5 分钟线比最新成交价慢一点，最后一根还在昨收下面 → 走势线最后补上现价，终点=现价 |
| 价格没变却显示红色 "-0.00%" (MMAG 0.025) | 现价四舍五入到 3 位、昨收没有，浮点尾数算出极小的负数 → 昨收也四舍五入再算；没变的走势图用灰色 (`spark-flat`) |
| 表格/PDF 里 RSI 显示 "nan" (EAH 0.005) | 价格 14 天完全没动，RSI 的涨跌平均都是 0，0/0 = NaN → 网页显示 "—" (排序值 -1)；导出时 NaN 一律变成空白 (NaN 写进 xlsx 会让 Excel 报文件损坏) |
| PDF 里 © 不显示 | 内置中文字体 STSong-Light 没有 © → 写成"版权所有"；emoji 也会被去掉 |
| 本地测试时 `pkill -f "http.server ..."` 把自己的 shell 杀掉了 | pkill 的匹配串也出现在自己的命令行里，别在同一条命令里用 pkill 匹配自己的参数 |
| 本地测试卡死 120s | 假数据让 1070 支全部命中，每次命中 `time.sleep(1)` → 测试时 patch 掉 sleep |
| 测试产物污染 git | mock 的 `main()` 覆盖了真的 `docs/index.html` → 测试时把 `main.REPORT_PATH` 指到 /tmp |
| **bursa-bot.md 丢过一次** | 9/22 把分支 reset 到 main 再 force-push，把只在分支上、还没合并的 bursa-bot.md commit 盖掉了 (9/23 从本地 reflog 找回)。**教训：reset/force-push 分支前先确认分支上有没有还没合并的 commit** |
| PR #16 只显示 2 个文件 | 前面的 LICENSE/删 cron 已经通过 PR #15 先合并了，不是漏了 |
| 手机上 GitHub 顶部看不到 Settings | 窗口窄被收进 **"More"** 里了。仓库 About (描述/Topics) 不在 Settings，在 Code 首页右侧栏的齿轮 ⚙️ |

- **9/24 改版踩到的坑**：
  - Lightweight Charts v5 的折线遇到空白点不会断开 (Supertrend 要自己画线)
  - Playwright 的 `element.screenshot()` 会自己把元素滚进来，轮播里对非当前卡片截图会把轮播拖到一半；截图要截整个 `#screener`
  - 对话框里的通用按钮样式用了一串 `:not(...)`，优先级很高，会盖掉 "选中" 样式，选中态要加 `!important`
  - 手机上图例一行塞不下 名称+数值+5 个按钮，名称会被挤到 0 宽度 → 改成点一下这一行才展开按钮
  - **iPhone Safari 的 `vh` 比看得到的高度大** (按底部网址栏收起来算)：底部对齐的对话框用 `94vh` 时，顶部会跑到屏幕外 → 对话框高度一律 `vh` 后面再写一个 `dvh`
- **9/24 完整图表 + 财报踩到的坑**：
  - `git add -A <路径>` 路径不存在会 fatal → 新目录先放 `.gitkeep` (见第 4 节)
  - SVG 的字号跟着 viewBox 缩放，同一张图在手机两栏里字会变成 6px → 手机上 CSS 把 SVG 字号写大
  - 最新一期是最低的负数时，数值标签会压到下面的季度文字 → 负数的标签改标在基线上方
  - yfinance 抓财报失败不会报错 (内部吞掉，给空表格) → 空财报 2 天后重试；K 线抓不到才算真正失败
  - 模拟测试时 `history(period=...)` 要按 period 返回不同长度，不然测不到"长期 K 线接 6 个月"的拼接

### 9/23 – 9/24 对话记录 (按时间顺序，给接手的人快速了解)
| 用户要求 | 结果 | PR |
|---|---|---|
| 近 7 天报告下载 CSV / Excel / PDF | `exports.py` + 页面下载区块 | #19 |
| 下载用日期选择条；问"下载文件不进仓库"的坏处 | 日期选择条已做；Pages 改 Actions 部署**没做** (用户没决定)，利弊见第 4 节下载报告 | #19 |
| 图表下方不要买卖建议 | 改 DeepSeek prompt + `strip_trade_advice()` 过滤 | #19 |
| 加 Ichimoku Cloud (给了 Pine 脚本) | 一目均衡表 | #20 (#19 合并时漏掉，补开) |
| 信号卡片改成 TradingView 那样：多周期、主/副图、模板、图例 | 筛选器卡片第一版 | #20 |
| 合规检查、能不能转 private | TradingView 署名补齐 + 合规记录 (第 9 节) | #21 |
| 收费化要哪些牌照/成本/宣传/流程，整理成 Word | 已发 Word 给用户 (`Bursa-Bot-收费化评估报告.docx`)，**没放仓库** (仓库公开，内容是商业计划)。结论：卖"信号"要 SC 牌照 (CMSL + CMSRL，数字投资建议缴足资本 RM20 万)；卖"用户自设条件的工具"一般不用但要律师确认，且必须换有商业授权的行情数据 (EODHD 商用约 $399/月起或 Bursa ISLA)；建议先免费 + 律师意见 | — |
| 加 Supertrend (给了 Pine 脚本) | Supertrend | #22 |
| 卡片轮播、图表类型分组、指标库/模板照 TradingView 分类、点图例改参数、表格 fit 手机/电脑 | 第 4 节"筛选器 = 卡片轮播" | #22 |
| 新股不足 90 天也照样按成交量筛选 | 历史短的股票不再丢掉 (指标算不出来显示 —，标 "N天")；screener 里的新上市股票自动加入扫描 | #23 |
| 搜索其他股票时能看完整走势图 (双击表格一行)，附近 4 季财报 + 近 2 年年报的可视化，开 PR | 第 4 节"完整图表 + 财报"；为了"完整"，表格股票也补上 2 年日线 + 10 年月线 (跟卡片一样长) | #23 |
| 合并 #23 后看运行结果；新加的指标点了删不掉 | 自动测试里 🗑 其实能删，但点指标名称打开的是设置窗口、里面没有删除，手机上 🗑 又要先点这一行才出现 → 设置窗口左下角加「🗑 删除」(按钮里的图标也要能点：footer 改用 `closest('button[data-act]')`) | #24 |
| 手机上图表太靠右、滑页面一直误触；完整图表改成左边正方形图、右边财报、下面新闻 | 见第 4 节"个股新闻 + 对话框改版 + 手机防误触" | #24 |
| 页面下方做一个固定的搜索栏，滑到哪里都能打股票名称 / 代码 | 底部搜索栏，选中直接打开完整图表 | #24 |
| 手机上双击股票往下滑看财报时，看不到股票名称和代码 | iPhone Safari 的 `vh` 按网址栏收起来算，网址栏还在时对话框比屏幕高，顶部标题被挤出屏幕 → 对话框高度改用 `dvh` (前面留 `vh` 给旧浏览器)；价格 / 涨跌也搬进标题那一行 (标题不跟内容滚动) | 已推分支，未开 PR |

### 9/24 运行记录 (PR #23 合并后)
- **#225** (17:12 MYT)：共 51 秒 ✅；分析 36.2 秒 = 预筛选 0.7 + 抓取 22.9 + 筛选 & DeepSeek 1.2 + 导出 0.7 + **图表+财报 8.7**
- screener 找到 28 支清单里没有的新股，一起扫描；1 支信号 (0326)，表格 273 支，日内走势 273/273
- 个股资料：抓 30 支、写入 30 支，**29 支 Yahoo 有财报** (28 支 MYR，1 支拿不到货币)，马股财报覆盖率没问题；最新一季大多是 2026-06-30，少数财年不按日历的是 4 月 / 5 月结束
- table.json 1.3MB (273 支)，个股资料平均 15.7KB/支；新股 0041 只有 1 天、0468 只有 8 天 K 线 (正常)

### 9/23 运行记录 (PR #19 合并后)
- **#212** (16:34，合并后第一次)：共 3 分 37 秒。requirements.txt 变了 → 缓存没命中，重装依赖 32 秒；分析 25 秒；报告 16:35:08 就推送了 (触发后 64 秒)；剩下 2.5 分钟是报告推送之后才保存 205MB 的依赖缓存 (这次压缩特别慢，上次同样大小只要 44 秒)。每周第一次运行、或者 requirements.txt 变了才会这样
- **#213** (19:05)：共 55 秒 ✅ 缓存命中 (恢复 8 秒、跳过安装)；分析 34.2 秒 = 预筛选 0.8 + 抓取 24.3 + 筛选 & DeepSeek 6.7 (4 支信号) + 导出 0.7
- 线上结果：4 支信号 (BMGREEN、OXB、NAIM、GIIB)，AI 点评**已经没有买卖建议**；表格 280 支；页面 519KB；下载区块出现，CSV/Excel/PDF 都能正常打开 (PDF 9 页)
- ⚠️ **教训**：用户 16:33 合并 #19 的时候，一目均衡表和筛选器改版这两个 commit 还没推上去 → 没进 main。已 rebase 到最新 main 另开 **PR #20**。以后往一个已经开着的 PR 继续推之前，先确认它还没合并；推完要跟用户说清楚"PR 里多了什么"

### 协作规矩（重要）
- **PR 由用户自己 merge**，我不要擅自 merge（曾经擅自 merge 了 PR #6，已认错）
- **AskUserQuestion 里用户没选的选项就是不要做**（曾经擅自删了 `Bursa.yml`，已回滚；用户明确说保留）
- 用户要求：**聊天窗口快满之前就提醒存档**，不要等压缩之后
- 没被要求就不要开 PR
- 用户主要用手机操作 GitHub / cron-job.org，给操作步骤时要考虑手机界面

---

## 8. 开发环境限制（给 AI 助手看）

这个沙箱的出口代理**几乎挡掉所有网站**：
- ❌ sc.com.my、bursamalaysia.com、cja231.github.io、cdn.jsdelivr.net、finance.yahoo.com、cron-job.org
- ✅ WebSearch、npm/pypi、raw.githubusercontent.com、GitHub API

所以**本地跑不了 yfinance**，要验证真实数据只能推到 GitHub Actions 上跑（runner 网络是通的）。

本地可以做的验证：
- mock 掉 `get_stock_data` / `get_intraday` / `yf.Ticker` (财报用) / `ask_deepseek` 等，跑完整的 `main()`
- 用 Playwright + `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` 打开生成的报告，测交互、截图 (手机尺寸 390×844)
- 生成的报告需要 `vendor/lightweight-charts.js` 在同目录，用 `python3 -m http.server` 起一个本地服务

---

## 9. License / 对外

- 仓库为 **All Rights Reserved** (`LICENSE`)：public 只是为了免费 Pages，不代表授权使用；禁止未授权复制/分发/商用。vendor 的 TradingView 图表库保留它自己的 Apache 2.0
- 报告页面底部有中英双语版权声明，年份自动取当年
- README 里有免责声明 (不构成投资建议、信号纯技术计算、AI 点评可能出错)
- 仓库 About 描述还是很早的模板文字，建议用户手动改成 (GitHub API 工具改不了这个)：
  - Description: `🇲🇾 马来西亚全市场自动选股机器人 — 技术指标策略筛选 + K线图 + AI点评 + 手机推送，GitHub Actions 全自动运行`
  - Website: `https://cja231.github.io/Bursa-bot/`
  - Topics: `stock-screener trading-bot bursa-malaysia technical-analysis python github-actions deepseek candlestick-chart fintech`

### 合规检查 (9/23，非法律意见)
- **图表库署名**：Lightweight Charts 的 Apache 2.0 + NOTICE 要求在用户看得到的页面上放 NOTICE 里的署名 + tradingview.com 链接。
  v4 时代的页面完全没有 → 已补：页脚写上 NOTICE 原文 + 链接，`docs/vendor/NOTICE` 和 `docs/vendor/LICENSE-lightweight-charts` 也放进仓库
- **行情数据**：yfinance 抓的是 Yahoo Finance 数据，Yahoo 条款只允许个人使用；Bursa 行情对外转发 (实时/延迟/收盘) 原则上要 Bursa 的 ISLA 信息服务许可。
  现在个人、免费、公开网页 + 下载文件 → 风险低，但严格来说超出 Yahoo 条款；**收费/商业化前必须换成有授权的数据源**
- **投资建议 (SC Malaysia / CMSA 2007)**：已经去掉买卖建议 + 有免责声明；但 SC 明说"免责声明不能免除牌照要求"。关键在于有没有收费/收佣金/拿回报 → 如果以后要收费提供信号，要先问马来西亚律师或 SC (可能需要 CMSRL 投资顾问牌照，或者跟持牌机构合作)
- **GitHub Pages**：条款禁止拿来做网上生意/收费服务/SaaS
- **改成 private 的后果**：免费账号 private 仓库不能用 Pages → 报告网站会下线 (要 GitHub Pro 才能保留，而且 Pro 的 Pages 网站本身还是公开的)；stars (目前 1 个) 会永久清零；目前 0 个 fork；Actions 在 private 仓库按分钟计费，免费账号每月 2000 分钟，我们大约每月 250–400 分钟，够用；cron-job.org 的 PAT 照常能用
- 仓库描述 ("analyzing TradingView screeners … best opportunities") 跟实际不符 (数据来自 Yahoo、跟 TradingView 无关)，而且像在推荐买卖，建议用户自己改掉

### 另外一条线（已和 bot 开发分开）
用户问过「把报告做成 App + 订阅服务」会不会踩马来西亚 SC 法规。关键词备查：
CMSA 2007、SC Guidance Note **SC-GN/1-2020 (R2-2024)**、Digital Investment Management (DIM) framework、Bursa **ISLA** 数据授权。
用户明确说过：**「把服务订阅和更新 bursabot 分开两个内容」**，做 bot 的时候不要混进来。

---

## 10. 下一步 TODO

- [ ] 在 cron-job.org 建完剩下的时段 (见第 5 节"当前进度")
- [ ] 确认 12:15 是故意的还是想要 12:25
- [x] ~~9/23 性能优化合并后看一次真实运行的 ⏱️ 耗时行~~ (#210 起：预筛选跳过约 770 支，分析 30 秒左右，缓存命中时整个 run 约 45–55 秒)
- [ ] **PR #22 (卡片轮播 + Supertrend) 合并后**看第一次真实运行：卡片翻页、图表类型、指标库在真实数据上正常；用户浏览器里旧模板有没有正确迁移 (`bursa_templates_v1` → `v2`)
- [ ] **PR #23 合并后**看第一次真实运行：
  - ~~日志的 `📊 个股资料` 那行、table.json 大小、耗时~~ (#225：29/30 有财报，1.3MB，8.7 秒)
  - 双击几支股票：2 年日线有没有接上、月线正常、财报数字跟 Bursa 公告对得上 (单位、季度)
  - 用真实数据截完整图表 + 财报的图放进 README (现在的 README 截图都是真实数据，不要放模拟数据的图)
- [ ] 新闻功能合并后看第一次真实运行：日志 `📰 个股新闻` 那行有几支有新闻、Google News 有没有被挡 (如果全部 0 条，考虑换来源)；点开几支看新闻是不是同一家公司
- [ ] (看情况) 信号股很多时页面会变大 (真实数据约 75KB/支，12 支约 1MB)。要优化的话：每支信号股的K线数据也拆成 `docs/charts/<代码>.json`，翻到那张卡片才下载 (`docs/charts` 目录和 `git add` 已经有了)
- [ ] (用户决定) 下载文件要不要改成 Actions 部署 Pages、不进 git (越早改越好，见第 4 节)
- [ ] (用户自己改) GitHub 仓库描述还写着 "analyzing TradingView screeners … best opportunities"，跟实际不符、又像推荐买卖，建议改成类似 "Personal technical-analysis screener for Bursa Malaysia (educational use, not investment advice)"
- [x] ~~README 补真实表格截图~~ (9/23 用 run #209 的真实报告前 8 行截的)
- [x] ~~README 截图重拍~~ (9/23 用 run #216 的真实页面，BMGREEN + 一目均衡表 + RSI + MACD)
- [x] ~~确认真实分钟数据~~ run #216：4 支信号股 6 种周期全部拿到；60 分钟线按整点对齐 (09:00 10:00 11:00 12:00 14:00 15:00 16:00，下午盘 14:30 开也标成 14:00)；午休没有空K线；成交少的股票 1 分钟线会缺没成交的分钟 (Yahoo 本来就这样)；页面 698KB；整体 30 秒
- [x] ~~一目均衡表图例名字太长~~ (#22 改成 "一目 9 26 52 26" 这种简称，名称也不会再被挤掉)
- [ ] **2026-12-21 前**重新生成 PAT，更新 cron-job.org 所有任务的 Authorization header
- [ ] (可选) 仓库 About 描述 / Topics / Social preview 图
- [ ] (可选) `Bursa.yml` 清理 —— 用户已拒绝，别再提
