# Bursa Bot 项目备忘 (bursa-bot.md)

> 这份文件是给「未来的我 / 未来的 AI 助手」看的项目交接笔记。
> 每次聊天窗口要满之前更新它，就不会丢上下文。
>
> 最后更新：2026-09-18

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
├── bursa-bot.md                 # 本文件
├── Bursa.yml                    # ⚠️ 废弃文件，不是 workflow，用户选择保留，别删
├── data/
│   └── watchlist.json           # 全市场股票清单 (1070 条)，格式 {"symbol":"0453.KL","name":"EIPOWER"}
├── docs/
│   ├── index.html               # 生成的报告 (~224KB)，GitHub Pages 从这里发布
│   └── vendor/
│       └── lightweight-charts.js  # TradingView 图表库 v4.1.3，Apache 2.0，160KB，自托管
├── scripts/
│   ├── fetch_watchlist.py       # 用 Yahoo screener 拉全市场清单 → data/watchlist.json
│   └── debug_stock.py           # 单股调试：看某支股票过去几天符不符合条件
└── .github/workflows/
    ├── daily.yml                # 主流程 (定时 + 手动)
    ├── update-watchlist.yml     # 更新股票清单 (手动)
    └── debug_stock.yml          # 单股调试 (手动)
```

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

三段结构：

1. **命中信号的股票** → 每支一张卡片，带 K 线图
2. **没命中的股票** → 一张可排序表格（含 **涨跌%** 列）
3. **没数据的股票** → 只报个数量

### K 线图规格
- 库：TradingView Lightweight Charts v4.1.3，**自托管**在 `docs/vendor/`（不用 CDN，jsdelivr 在用户手机上被挡过）
- 日线级别，显示最近 90 个交易日 (`CHART_HISTORY_DAYS`)
- **空心蜡烛**：`upColor: 'rgba(0,0,0,0)'`（阳线透明=空心），阴线实心
- EMA20 叠加线，`lineWidth: 2`
- **下方有成交量柱状图**（`addHistogramSeries`，`priceScaleId: ''`，`scaleMargins {top:0.8, bottom:0}`）
- **鼠标/手指悬停显示十字光标 + 当日 开/高/低/收 + 成交量**
  - 坑：`param.time` 是 BusinessDay 对象不是字符串，**必须用 `param.seriesData.get(series)` 取值**，不能拿 time 去比对
- **懒加载**：`IntersectionObserver`，滚动到才渲染（否则页面太重手机打不开）
- 自适应：`ResizeObserver`
- 每行标题格式：`股票简称 + 4位股票代码`

### 配色（可自定义，在 `main.py` 约 292-320 行的 CSS `:root`）

```css
/* 亮色 */
--up:   #0ca30c;   /* 阳线边框+影线（空心） */
--down: #d03b3b;   /* 阴线实心 */
--ema:  #4a3aa7;   /* EMA20 均线 —— 用户明确说「不要蓝色」 */

/* 暗色 (prefers-color-scheme: dark) */
--up:   #0ca30c;
--down: #e66767;
--ema:  #9085e9;
```

JS 端用 `getPropertyValue('--up')` 读回来，所以**改 CSS 就等于改图表颜色**，不用动 JS。

### 涨跌% 列
- 上涨 → `.change-up`（绿）
- 下跌 → `.change-down`（红）
- 持平 → `.change-neutral`（灰）

---

## 5. 排程（❗最大的未解难题）

### 用户想要的时间（马来西亚时间 UTC+8，只在交易日）
9:15、9:45、10:15、10:45、11:30、12:25、2:45pm、3:45pm、4:30pm、5:30pm —— **一天 10 次**

时间点故意错开整点/半点，是为了**避开 DeepSeek API 高峰时段定价**。

### 现在 daily.yml 里的 cron（UTC，GitHub 只认 UTC，不支持时区）

```yaml
- cron: '15 1 * * 1-5'  # 9:15am  MYT
- cron: '45 1 * * 1-5'  # 9:45am
- cron: '15 2 * * 1-5'  # 10:15am
- cron: '45 2 * * 1-5'  # 10:45am
- cron: '30 3 * * 1-5'  # 11:30am
- cron: '25 4 * * 1-5'  # 12:25pm
- cron: '45 6 * * 1-5'  # 2:45pm
- cron: '45 7 * * 1-5'  # 3:45pm
- cron: '30 8 * * 1-5'  # 4:30pm
- cron: '30 9 * * 1-5'  # 5:30pm
```

### ❌ 问题：定时任务根本不准时，现在干脆一次都不跑

**已排除的原因**（全部核对过 API）：
- workflow `state: active` ✅
- 在 `default_branch: main` 上 ✅
- 仓库 public、没 archived、Actions 没被禁用 ✅
- YAML 语法有效 ✅
- Secrets 都在 ✅
- 手动 disable / re-enable 试过，无效 ❌

**真正的原因（2026-09-18 查证）**：

1. **GitHub 的 cron 对这个仓库一直是迟到的。**
   历史 cron 一直是 `30 9 * * 1-5`（09:30 UTC），核对过 `b994b59` 和 `e08210a` 两个 commit 都一样。
   但 15 次 `event: schedule` 的实际开跑时间（#144–#158，2026-08-27 ~ 09-16）：

   ```
   平均迟到 5.7 小时 | 最短 4.2h | 最长 11.5h
   #158 09-16 迟 3h47m   #157 09-15 迟 4h54m   #156 09-14 迟 6h28m
   #151 09-07 迟 5h39m   #146 08-31 迟 7h41m   #145 08-28 迟 11h28m
   ```

2. **改成 10 个密集时段之后，变成一次都不触发。**
   9/17 13:06 UTC 改完 cron 至今，`event: schedule` 的 run 数量 = **0**。
   9/18 当天有 3 个时段本该有效（3:45pm / 4:30pm / 5:30pm），一个都没跑。

3. GitHub 官方文档写明 schedule 是 **best-effort**：所有免费仓库共用一个队列，高负载时**延迟甚至整个丢弃**，并明确警告不要用密集 cron。

**结论：这不是配置写错了，是 GitHub 自带 cron 本身做不到盘中级别的精确排程。**

### 怎么分辨「定时 run」和「手动 run」（用户曾经搞混）

- API：`event: "schedule"` vs `event: "workflow_dispatch"`
- UI：定时的显示 **"Scheduled"**；手动的显示 **"Manually run by CJA231"**
- ⚠️ 两者都会挂用户头像（`actor: CJA231`），所以光看头像分不出来
- 分界线：**#144–#158 = 定时**（全部失败，是当初缺 DEEPSEEK_KEY 那批）；**#159 以后 = 手动**

### 待决定的出路（用户还没选）

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A（推荐）** | 外部定时器（如 cron-job.org，免费不用信用卡）按马来时间打 GitHub `workflow_dispatch` REST API | 误差几十秒，workflow 一行都不用改 | 要在外部站点存一个 fine-grained PAT |
| B | 留在 GitHub cron，砍到 2–3 个时段 | 零额外设置 | 几点跑不确定，失去盘中时效 |
| C | 自己的常开机器跑 cron | 完全可控 | 要有一台 24h 开机的电脑 |

⚠️ 注意：**GITHUB_TOKEN 不能触发 workflow_dispatch**（GitHub 防递归机制），方案 A 必须用 PAT。

---

## 6. 其他机制

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
- API key 在 secret `DEEPSEEK_KEY`
- `main.py` 开头会 fail-fast：没有 key 直接 `SystemExit` 并给出可读提示

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
| 报告跑完没变化 | ①过了马来午夜，当天还没数据 → 加 `FORCE_RUN`；②4.5MB 页面手机加载不完 → 收紧筛选 + 只给信号股画图，降到 ~224KB |
| 图表手机上不显示 | CDN (jsdelivr) 被挡 → **把库 vendor 进仓库** + 懒加载 |
| 页面加载不完 | 页面太重 → T3 过滤收紧后 4.5MB → 2.4MB → 146KB |
| 悬停取不到当天数据 | `param.time` 是 BusinessDay 对象 → 改用 `param.seriesData.get(series)` |
| 本地测试卡死 120s | 假数据让 1070 支全部命中，每次命中 `time.sleep(1)` → 测试时 patch 掉 sleep |
| 测试产物污染 git | mock 的 `main()` 覆盖了真的 `docs/index.html` → commit 前 `git checkout -- docs/index.html` |

### 协作规矩（重要）
- **PR 由用户自己 merge**，我不要擅自 merge（曾经擅自 merge 了 PR #6，已认错）
- **AskUserQuestion 里用户没选的选项就是不要做**（曾经擅自删了 `Bursa.yml`，已回滚；用户明确说保留）
- 用户要求：**聊天窗口快满之前就提醒存档**，不要等压缩之后

---

## 8. 开发环境限制（给 AI 助手看）

这个沙箱的出口代理**几乎挡掉所有网站**：
- ❌ sc.com.my、bursamalaysia.com、cja231.github.io、cdn.jsdelivr.net、finance.yahoo.com
- ✅ WebSearch、npm/pypi、raw.githubusercontent.com、GitHub API

所以**本地跑不了 yfinance**，要验证只能推到 GitHub Actions 上跑（runner 网络是通的）。

---

## 9. 另外一条线（已和 bot 开发分开）

用户问过「把报告做成 App + 订阅服务」会不会踩马来西亚 SC 法规。相关关键词备查：
- CMSA 2007
- SC Guidance Note **SC-GN/1-2020 (R2-2024)**
- Digital Investment Management (DIM) framework
- Bursa **ISLA** 数据授权（实时行情要付费）

用户明确说过：**「把服务订阅和更新 bursabot 分开两个内容」**，所以做 bot 的时候不要混进来。

---

## 10. 下一步 TODO

- [ ] **决定排程方案（A/B/C）并实施** ← 当前最优先
- [ ] 排程修好之后，确认 10 个时段真的准时跑
- [ ] （可选）`Bursa.yml` 清理 —— 用户已拒绝，别再提
