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
3. `detect_t3_pattern` / `get_stock_data` / `CHART_SOURCES` + `get_chart_history` (信号股多周期K线) / `get_intraday_closes` / `build_sparkline` / `fmt_volume`
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
5. 数据不足的股票只报个数量
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
  - 数据来自 `get_intraday_closes` (yfinance `period="1d", interval="5m"`)，**只对会进表格的股票抓**，同样并发
  - 虚线 = 昨收；线的最后一个点补上现价 (Yahoo 5 分钟线会慢一点)；颜色 = 现价相对昨收：涨绿、跌红、没变灰 (`spark-flat`)，跟"涨跌%"一致
  - 拿不到日内数据的退回画近 30 日收盘价 (没有虚线，颜色按 30 日走势，可能跟当天涨跌不一致)；悬停提示会写是哪种
  - 颜色用 CSS 变量 `--up/--down`，⚙ 图表设置里改颜色也会生效
- 相对量 = 今天成交量 / 前 20 日均量 (≥2 加粗)
- 默认按成交量从高到低排；点表头可排序 (走势列不可排序)
- 顶部搜索框按代码/名称即时过滤
- 旧表格里的 SMA50 列已去掉 (信号卡片里还有)

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
`⏱️ 耗时: 导入库 Xs | screener 预筛选 Xs | 抓取+指标+日内 Xs | 筛选+DeepSeek Xs | 生成报告 Xs | 推送 Xs | 总计 Xs`
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
- mock 掉 `get_stock_data` / `get_intraday_closes` / `ask_deepseek` 等，跑完整的 `main()`
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
- [ ] (看情况) 信号股很多时页面会变大 (真实数据约 75KB/支，12 支约 1MB)。要优化的话：每支股票的K线数据拆成 `docs/charts/<代码>.json`，翻到那张卡片才下载 (daily.yml 的 `git add` 要加上 `docs/charts`)
- [ ] (用户决定) 下载文件要不要改成 Actions 部署 Pages、不进 git (越早改越好，见第 4 节)
- [ ] (用户自己改) GitHub 仓库描述还写着 "analyzing TradingView screeners … best opportunities"，跟实际不符、又像推荐买卖，建议改成类似 "Personal technical-analysis screener for Bursa Malaysia (educational use, not investment advice)"
- [x] ~~README 补真实表格截图~~ (9/23 用 run #209 的真实报告前 8 行截的)
- [x] ~~README 截图重拍~~ (9/23 用 run #216 的真实页面，BMGREEN + 一目均衡表 + RSI + MACD)
- [x] ~~确认真实分钟数据~~ run #216：4 支信号股 6 种周期全部拿到；60 分钟线按整点对齐 (09:00 10:00 11:00 12:00 14:00 15:00 16:00，下午盘 14:30 开也标成 14:00)；午休没有空K线；成交少的股票 1 分钟线会缺没成交的分钟 (Yahoo 本来就这样)；页面 698KB；整体 30 秒
- [x] ~~一目均衡表图例名字太长~~ (#22 改成 "一目 9 26 52 26" 这种简称，名称也不会再被挤掉)
- [ ] **2026-12-21 前**重新生成 PAT，更新 cron-job.org 所有任务的 Authorization header
- [ ] (可选) 仓库 About 描述 / Topics / Social preview 图
- [ ] (可选) `Bursa.yml` 清理 —— 用户已拒绝，别再提
