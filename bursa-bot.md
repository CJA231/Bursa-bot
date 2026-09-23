# Bursa Bot 项目备忘 (bursa-bot.md)

> 这份文件是给「未来的我 / 未来的 AI 助手」看的项目交接笔记。
> 每次聊天窗口要满之前更新它，就不会丢上下文。
>
> 最后更新：2026-09-23

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
│   └── vendor/
│       └── lightweight-charts.js  # TradingView 图表库 v4.1.3，Apache 2.0，160KB，自托管
├── scripts/
│   ├── fetch_watchlist.py       # 用 Yahoo screener 拉全市场清单 → data/watchlist.json
│   └── debug_stock.py           # 单股调试：看某支股票过去几天符不符合条件
└── .github/workflows/
    ├── daily.yml                # 主流程 (只有 workflow_dispatch，由外部定时器触发，见第 5 节)
    ├── update-watchlist.yml     # 更新股票清单 (手动)
    └── debug_stock.yml          # 单股调试 (手动)
```

### main.py 的结构 (按文件顺序)
1. 配置区域 (`MIN_DAILY_VOLUME`、`FETCH_WORKERS` 等常量)
2. DeepSeek 客户端
3. `detect_t3_pattern` / `get_stock_data` / `get_intraday_closes` / `build_sparkline` / `fmt_volume`
4. `check_strategy` (筛选策略)
5. `DEEPSEEK_SYSTEM_PROMPT` + `ask_deepseek`
6. 报告页面的前端代码常量：`SETTINGS_CSS`、`TABLE_CSS`、`SETTINGS_PANEL_HTML`、`CHART_SCRIPT`
   (**这几个是普通字符串，不是 f-string**，JS/CSS 里的大括号不用写成 `{{ }}`)
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
| 4 | `成交量 > 500,000` | `MIN_DAILY_VOLUME`，在主循环里预筛，不达标直接 skip |

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
2. **⚙️ 图表设置** 按钮 (点开是设置面板，见下)
3. **🚨 信号** — 命中的股票，每支一张卡片，带 K 线图 + DeepSeek 点评
4. **📋 其余股票** — 仿 TradingView 选股器的紧凑表格
5. 数据不足的股票只报个数量
6. 版权页脚 (中英双语)

### K 线图 (信号卡片里)
- 库：TradingView Lightweight Charts v4.1.3，**自托管**在 `docs/vendor/`（不用 CDN，jsdelivr 在用户手机上被挡过）
- 日线级别，显示最近 90 个交易日 (`CHART_HISTORY_DAYS`)
- **空心蜡烛**：`upColor: 'rgba(0,0,0,0)'`（阳线透明=空心），阴线实心
- EMA20 叠加线；下方成交量柱 (`priceScaleId: ''`，`scaleMargins {top:0.8, bottom:0}`)
- 悬停显示当日 开/高/低/收 + 成交量
  - 坑：`param.time` 是 BusinessDay 对象不是字符串，**必须用 `param.seriesData.get(series)` 取值**
- 懒加载 (`IntersectionObserver`) + 自适应宽度 (`ResizeObserver`)
- 图高 260px，**CSS `.chart` 的高度必须跟 JS `createChart` 的 `height` 一致**，否则图会溢出盖住下面的图例

### 设置面板 (纯前端，存在浏览器 localStorage，不影响别人、不用重新部署)
- **颜色**：上涨/下跌/EMA20 三个取色器，即时生效 (localStorage key `bursa_colors_v1`)
- **技术指标**：横向滑动的分类导航 `趋势 / 动量 / 波动性 / 成交量 / 自定义公式`，
  18 个预设指标点一下就加到所有图上 (localStorage key `bursa_custom_indicators_v1`)：

  | 分类 | 预设 |
  |---|---|
  | 趋势 | SMA20、SMA50、EMA50、SAR、布林带上/中/下轨 |
  | 动量 | RSI(14)、MACD 线、MACD 信号线、Stochastic %K、CCI、Williams %R |
  | 波动性 | ATR(14)、布林带带宽 |
  | 成交量 | OBV、成交量均线(20)、滚动 VWAP(20) |

  - **SAR 是后台算好的整条序列** (`get_stock_data` 返回的 `psar`，经 `chart_payload` 传给前端)，跟策略判断用的是同一份，不是前端近似
  - 每个指标有坐标轴模式 `scale`：`price` 跟 K 线共用价格轴 (均线/布林/SAR/VWAP)；`own` 独立自动缩放 (RSI/MACD 等震荡指标，MACD 线和信号线用同一个 `scaleGroup` 共用一条轴)；`volume` 跟成交量柱共用
- **自定义公式**：前端自带一个小型公式引擎 (`evalFormula`)
  - 变量：`close open high low volume`
  - 函数：`sma ema stdev highest lowest sum rsi atr obv abs`
  - 运算：`+ - * / ^`、括号、负号 (优先级跟 Python 一样，`-2^2 = -4`)
  - RSI/ATR 用 Wilder 平滑，跟 pandas_ta 一致
  - 可勾"独立坐标轴"

### "其余股票" 表格
- 列：股票 (简称徽章 + 代码，手机横向滑动时固定在左边) | 走势 | 价格 | 涨跌% | 成交量 | 相对量 | RSI | SAR | EMA20
- **走势 = 迷你日内图**：服务端直接画成内嵌 SVG (不用 JS)
  - 数据来自 `get_intraday_closes` (yfinance `period="1d", interval="5m"`)，**只对会进表格的股票抓**，同样并发
  - 虚线 = 昨收；颜色 = 最新价相对昨收 (所以跟"涨跌%"颜色一致)
  - 拿不到日内数据的退回画近 30 日收盘价 (没有虚线，颜色按 30 日走势，可能跟当天涨跌不一致)；悬停提示会写是哪种
  - 颜色用 CSS 变量 `--up/--down`，设置面板改颜色也会生效
- 相对量 = 今天成交量 / 前 20 日均量 (≥2 加粗)
- 默认按成交量从高到低排；点表头可排序 (走势列不可排序)
- 顶部搜索框按代码/名称即时过滤
- 表格宽度跟内容走 (`width: auto`)，大屏不会被拉满
- 旧表格里的 SMA50 列已去掉 (信号卡片里还有)

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
- 9/23 实测准点触发的 run (都在整点后 8~14 秒内，很准)：**9:15、12:15、2:45pm**
  - 用户说建的是 9:15 / 12:15 / 3:45。2:45pm 那次准点 run 对不上 —— 可能另外有个 2:45 任务，也可能"3:45"那个任务的 Hours 勾成了 14。**要看 3:45pm 有没有触发才能确定**
  - 12:15 跟原计划的 12:25 不一样，用户还没说是故意改的还是手误
- **还没建的** (按用户说的已建 3 个推算)：9:45、10:15、10:45、11:30、2:45pm、4:30pm、5:30pm

### 怎么分辨 run 是怎么触发的
- `event: "schedule"` = GitHub 自带 cron (现在已经不会再出现)
- `event: "workflow_dispatch"` = 手动按钮 **或** cron-job.org (两者在 API 里分不出来，只能看时间是不是准点)
- 两者 UI 上都挂用户头像 (`actor: CJA231`)，光看头像分不出来

---

## 6. 其他机制

### 运行速度
- `get_stock_data` 用 `ThreadPoolExecutor(max_workers=FETCH_WORKERS)` 并发抓 (FETCH_WORKERS=16)，失败自动重试 1 次
- 实测 (run #207)：**"Run Stock Analysis" 51 秒** (改之前串行 188 秒)，整个 run 约 74 秒 (之前约 3 分 40 秒)
- daily.yml 用 `setup-python@v5` 的 `cache: 'pip'`
- 表格日内走势是**额外一轮**并发请求 (只抓进表格的股票)，会再多花一点时间，上线后还没实测

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
| 本地测试卡死 120s | 假数据让 1070 支全部命中，每次命中 `time.sleep(1)` → 测试时 patch 掉 sleep |
| 测试产物污染 git | mock 的 `main()` 覆盖了真的 `docs/index.html` → 测试时把 `main.REPORT_PATH` 指到 /tmp |
| **bursa-bot.md 丢过一次** | 9/22 把分支 reset 到 main 再 force-push，把只在分支上、还没合并的 bursa-bot.md commit 盖掉了 (9/23 从本地 reflog 找回)。**教训：reset/force-push 分支前先确认分支上有没有还没合并的 commit** |
| PR #16 只显示 2 个文件 | 前面的 LICENSE/删 cron 已经通过 PR #15 先合并了，不是漏了 |
| 手机上 GitHub 顶部看不到 Settings | 窗口窄被收进 **"More"** 里了。仓库 About (描述/Topics) 不在 Settings，在 Code 首页右侧栏的齿轮 ⚙️ |

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

### 另外一条线（已和 bot 开发分开）
用户问过「把报告做成 App + 订阅服务」会不会踩马来西亚 SC 法规。关键词备查：
CMSA 2007、SC Guidance Note **SC-GN/1-2020 (R2-2024)**、Digital Investment Management (DIM) framework、Bursa **ISLA** 数据授权。
用户明确说过：**「把服务订阅和更新 bursabot 分开两个内容」**，做 bot 的时候不要混进来。

---

## 10. 下一步 TODO

- [ ] 在 cron-job.org 建完剩下的时段 (见第 5 节"当前进度")，并确认 3:45pm 那个任务真的在 3:45 触发
- [ ] 确认 12:15 是故意的还是想要 12:25
- [ ] 表格日内走势上线后看一次真实运行：多花了多少时间、有多少支拿到日内数据
- [ ] 新表格第一次真实运行后，用真实报告截一张表格图补进 README "界面预览" (现在的两张截图是 9/23 真实的 BMGREEN 信号；表格当时还是旧版、没有历史价格，所以没截，也不要用假数据截)
- [ ] **2026-12-21 前**重新生成 PAT，更新 cron-job.org 所有任务的 Authorization header
- [ ] (可选) 仓库 About 描述 / Topics / Social preview 图
- [ ] (可选) `Bursa.yml` 清理 —— 用户已拒绝，别再提
