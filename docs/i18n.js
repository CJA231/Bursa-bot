// 中文 / English 切换：页面右上角的 EN / 中 按钮。选 EN 时，整个页面 (含之后弹出的对话框、图表标签、提示) 的中文文字在浏览器里换成英文量化术语；
// 切回中文 = 重新载入页面，原文一个字没动。没有词条的文字保持中文，不会显示成空白。
// 词条分三层：EXACT (整段文字完全一样) → PATTERNS (带数字的句型) → PHRASES (词组，长的先换)。
// 在 EN 模式下，浏览器控制台 BursaI18n.missing() 会列出还没有翻译的中文。
(function () {
  'use strict';
  var KEY = 'bursa_lang', lang = 'zh';
  try {
    var q = /[?&]lang=(en|zh)\b/.exec(location.search);
    if (q) localStorage.setItem(KEY, q[1]);
    lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'zh';
  } catch (e) { /* 隐私模式：用中文 */ }
  window.__bursaLang = lang;

  var ZH = /[㐀-鿿]/;
  var MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- 1. 整段一样 ----------
  var EXACT = {
    // 页面框架
    '马股自动分析报告': 'Bursa Malaysia · Auto Report', '美股自动分析报告': 'US Market · Auto Report', 'Bursa Bot 收纳版样板': 'Bursa Bot',
    '盘中': 'Live', '开市前': 'Pre-open', '已收盘': 'Closed',
    '今天': 'Today', '市场': 'Market', '筛选器': 'Screener', '信号': 'Signals', '回测': 'Backtest', '公告': 'Filings', '股票': 'Stocks',
    '全部展开': 'Expand all', '全部收起': 'Collapse all', '展开 ▾': 'Expand ▾', '收起 ▴': 'Collapse ▴', '跳到': 'Jump to',
    '今天关注': "Today's Focus", '新增信号': 'New signals', '持续符合': 'Still valid', '条件失效': 'Invalidated', '接近风险线': 'Near risk line', '我的计划': 'My plans',
    '今日市场': 'Market Today', '策略回测': 'Strategy Backtest', '公司公告': 'Company Filings', '其余股票': 'Other Stocks', '后台信号': 'Strategy Signals',
    '概览': 'Overview', '报告内股票': 'Stocks in report', '条件命中': 'Rule matches', '更新时间': 'Updated', '工具': 'Tools', '股票计算器': 'Position calculator', '名词解释': 'Glossary',
    '自选': 'Watchlist', '★ 自选': '★ Watchlist', '☆ 加自选': '☆ Watch', '★ 已自选': '★ Watching', '导航': 'Menu', '马股': 'Bursa MY', '美股': 'US',
    '筛选器种类': 'Screeners', '我的模板': 'My templates', '＋ 新建筛选器': '+ New screener', '管理模板': 'Manage templates', '内置策略': 'Built-in strategies',
    '下载报告 (近 7 个交易日)': 'Download reports (last 7 sessions)', '下载报告': 'Download reports', '选择日期': 'Pick a date', '● 信号': '● signal',
    'Excel (每天一个工作表)': 'Excel (one sheet per day)', '近 6 天合并：': 'Last 6 days combined:', '关闭导航': 'Close menu', '关闭': 'Close',
    '周一': 'Mon', '周二': 'Tue', '周三': 'Wed', '周四': 'Thu', '周五': 'Fri', '周六': 'Sat', '周日': 'Sun',
    '需要开启 JavaScript 才能看到自选股。': 'Enable JavaScript to see your watchlist.', '还没有自选 (在股票详情按 ☆)': 'No watchlist yet (tap ☆ in a stock view)',
    // 今日市场
    '涨 / 跌': 'Adv / Dec', '成交额': 'Turnover', '涨幅榜': 'Top gainers', '跌幅榜': 'Top losers', '富时综合指数 KLCI': 'FTSE Bursa Malaysia KLCI', '近一个月': '1M', '今日市场说明': 'About market data',
    // 筛选器 / 信号卡
    '模板': 'Template', '点开改条件、看命中的股票': 'Tap to edit rules and see matches', '✓ 已自动保存': '✓ Auto-saved', '选股条件': 'Screen rules', '＋ 添加条件': '+ Add rule',
    '今天命中': 'Matches today', '分时': 'Intraday', '1分': '1m', '5分': '5m', '15分': '15m', '30分': '30m', '1小时': '1h', '4小时': '4h', '天': 'D', '周': 'W', '月': 'M', '年': 'Y',
    '空心K线图': 'Hollow candles', 'K线图': 'Candles', '指标': 'Indicators', '完整图表 · 财报 ›': 'Full chart · Financials ›', '开': 'O', '高': 'H', '低': 'L', '收': 'C', '涨跌': 'Chg', '量': 'Vol',
    '相对量': 'Rel. volume', '50日均线': 'SMA50', '多头': 'Bull', '空头': 'Bear', '风险': 'Risk', '风险报酬比': 'R:R', '损': 'Stop', '标': 'Target', '进': 'Entry',
    '· 损': '· Stop', '· 标': '· Target', '上一支': 'Previous', '下一支': 'Next', '进场计划': 'Trade plan', '搜索股票': 'Search stocks', '搜索结果': 'Search results',
    '搜股票名称或代码，例如 CYPARK / 5184': 'Search name or code, e.g. CYPARK / 5184', '收起指标': 'Hide indicators', '点一下改长度 / 颜色 / 线型': 'Tap to edit length / color / style',
    '左右滑动切换股票': 'Swipe to switch stocks', '图表设置': 'Chart settings', '图表类型': 'Chart type', '指标模板': 'Indicator template', 'K线周期': 'Timeframe', '分钟 / 小时周期': 'Minute / hour timeframes',
    '股票标签向左滚动': 'Scroll tickers left', '股票标签向右滚动': 'Scroll tickers right', '筛选器图表': 'Screener charts',
    // 回测 KPI / 表
    '胜率': 'Win rate', '期望值': 'Expectancy', '合计': 'Net P/L', '回撤': 'Max DD', '模拟账户': 'Paper Account', '买进': 'Buys', '持有中': 'Open', '已卖出合计': 'Closed P/L', '持有浮动': 'Open P/L',
    '进场': 'Entry', '进场价': 'Entry px', '现价 / 卖出': 'Last / Exit', '卖出 / 现价': 'Exit / Last', '收益': 'Return', '状态': 'Status', '详细数据': 'Details', '信号笔数': 'Trades', '合计盈亏': 'Net P/L',
    '盈亏比': 'Payoff ratio', '获利因子': 'Profit factor', '最大回撤': 'Max drawdown', '持有中浮动': 'Open P/L', '策略整体': 'Strategy overall', '每个信号都买，不受仓位限制': 'every signal taken, no position cap',
    '10 日平均': '10d avg', '基准 Benchmark': 'Benchmark', '超额 Excess': 'Excess', '全部': 'All', '平均持有': 'Avg hold', '系统品质': 'System quality', '最多连亏': 'Max losing streak', '月度表现': 'Monthly',
    '月份': 'Month', '笔数': 'Trades', '固定天数涨跌': 'Fixed-horizon returns', '持有': 'Hold', '信号平均': 'Signal avg', '基准': 'Benchmark', '超额': 'Excess', '风险与报酬': 'Risk & Reward',
    '初始风险': 'Initial risk', '最大涨幅': 'MFE', '最大跌幅': 'MAE', '平均 R': 'Avg R', '最好 / 最差': 'Best / worst', '离场原因': 'Exit reasons', '收益分布': 'Return distribution', '最近信号': 'Recent signals',
    '信号日': 'Signal date', '计入价': 'Entry px', '现价 / 结算': 'Last / Settled', '自定义回测 ›': 'Custom backtest ›', '自定义回测 Backtest': 'Custom Backtest', '设为后台信号 ›': 'Set as strategy ›',
    '总览': 'Summary', '分类': 'Group', '追溯': 'Trades', '图表': 'Charts', '累计盈亏': 'Cumulative P/L', '每月期望值': 'Monthly expectancy', 'RM / 笔': 'RM / trade', '⤓ 图片': '⤓ Image',
    '赚': 'Win', '亏': 'Loss', '离场': 'Exit', '原因': 'Reason', '只看': 'Filter', '命中条件': 'Rules hit', '持有天数': 'Holding days', '合计 RM': 'Net RM', '分类方式': 'Group by',
    '已结算': 'Closed', '回测结果': 'Results', '当前设定': 'Current setup', '总览 ': 'Summary',
    '趋势转坏': 'Trend health exit', '止盈': 'Take profit', '止损': 'Stop loss', '跌破 EMA 确认': 'EMA break', '跌破回调低点': 'Trailing stop', '回调红K': 'Pullback red candle', 'SAR 转空': 'SAR flip', 'EMA 死叉': 'EMA cross-down',
    '历史高点': 'Prior high', '近期阻力': 'Resistance', '满期': 'Time stop', '我的停损': 'My stop', '我的目标': 'My target',
    // 自定义回测设定
    '进场条件': 'Entry rules', '离场规则': 'Exit rules', '改名': 'Rename', '且': 'AND', '✎ 修改条件 / 换指标': '✎ Edit rules / indicators', '信号当天收盘价进场': 'Enter at signal-day close',
    '入场风险上限': 'Max entry risk', '暴涨日放宽': 'Surge-day relax', '涨 ≥': 'Up ≥', '% 时': '% →', '趋势健康检查': 'Trend health check', '按顺序检查，坏掉几个就离场': 'Checked in order — exit when this many fail',
    '坏': 'Fail', '个': '', '跌破 Supertrend': 'Close < Supertrend', 'SAR 转空 (不再是绿)': 'SAR flips bearish', '跌破最新更高低点 (支撑)': 'Close < latest higher low (support)',
    '放量抛售：收跌、量 ≥': 'Heavy-volume selling: down close, vol ≥', '倍': '×', 'EMA 快 < 慢': 'EMA fast < slow', '收盘 < EMA': 'Close < EMA', '跌破 EMA 确认离场': 'EMA break exit (confirmed)', '连续': 'for',
    'Supertrend 在价格下面就继续拿': 'Hold while Supertrend is below price', '固定止损': 'Fixed stop', '跌破回调低点 (浮动)': 'Trailing stop (pullback low)', '回调后收涨确认': 'Confirmed by up-close after pullback',
    '左右 N 根确认': 'N bars each side', '根': 'bars', '跌破只提醒，不离场': 'Alert only, no exit', '回调红K 低点': 'Pullback red-candle low', '固定止盈': 'Fixed take-profit',
    '到了先不卖：之后趋势坏 1 个才止盈': 'Lock profit: take profit once 1 check fails', '趋势 · 时间': 'Trend · Time', '下穿 EMA': 'crosses below EMA', '最多持有': 'Max hold', '成本 · 金额': 'Cost · Size',
    '来回成本': 'Round-trip cost', '最多同时': 'Max concurrent', '每笔金额': 'Size per trade', '恢复后台设定': 'Reset to backend', '进场条件从哪里来': 'Entry rule source',
    '信号日收盘价进场 ': 'Enter at signal-day close', '离场规则说明': 'About exit rules', '回测说明': 'About this backtest', '进场价到最近回调低点超过几 % 就不进，0 = 不限': 'Skip if entry-to-pullback-low risk exceeds this %, 0 = no limit',
    '信号日涨几 % 算暴涨': 'Signal-day gain that counts as a surge (%)', '暴涨日风险上限，0 = 不放宽': 'Surge-day risk cap, 0 = no relaxation', '坏掉几个就离场': 'Exit when this many fail', 'Supertrend 跌破': 'Close < Supertrend',
    'Supertrend ATR 长度': 'Supertrend ATR length', 'Supertrend 倍数': 'Supertrend multiplier', '跌破支撑': 'Close < support', '放量抛售': 'Heavy-volume selling', '成交量是 20 天平均的几倍': 'Volume vs 20-day average (×)',
    'EMA 快线跌到慢线下面': 'EMA fast below slow', '快线长度': 'Fast length', '慢线长度': 'Slow length', '收盘跌破 EMA': 'Close < EMA', 'EMA 长度': 'EMA length', '连续几天收盘在 EMA 下面': 'Consecutive closes below EMA',
    'Supertrend 护航': 'Supertrend hold', '止损百分比': 'Stop %', '回调低点怎么确认': 'How the pullback low is confirmed', '选「左右 N 根确认」时，左右各几根': 'Bars each side when using "N bars each side"',
    '跌破回调低点只提醒': 'Pullback-low break: alert only', '止盈百分比': 'Take-profit %', '到了先不卖，锁利润': 'Lock profit first', '最多持有天数': 'Max holding days', '最多持有几天': 'Max holding days',
    '来回交易成本百分比': 'Round-trip cost %', '最多同时持有几笔，0 = 不限': 'Max concurrent positions, 0 = no limit', '每笔投入多少令吉': 'RM per trade',
    '模拟账户 · 轮仓': 'Paper Account · Rotation', 'Paper Trading · 自己选开始日 / 自己买哪几只': 'choose start date and your own buys', '从': 'From', '开始': 'start', '本月初': 'Month start',
    '上个月初': 'Last month start', '3 个月前': '3 months ago', '最早': 'Earliest', '自己买一只': 'Add a position', '买入日': 'Buy date', '买入价': 'Buy price', '目标 / 止盈': 'Target', '怎么卖': 'Exit mode',
    '策略离场规则 + 我的停损 / 目标': 'Strategy exits + my stop / target', '只看我的停损 / 目标': 'My stop / target only', '进场备注：为什么买、怎么进': 'Entry note: why and how', '出场备注：什么情况卖': 'Exit note: when to sell',
    '加一支自己买的股票': 'Add a position', '代码或名称': 'Code or name', '拿掉': 'Remove', '自选 ': 'Custom', '按条件满足方式看': 'By match rule', '左右滑动 · 点股票看图': 'Swipe · tap a stock for chart',
    '全部满足': 'All rules', '任一满足': 'Any rule', '只要有一条成立': 'Any single rule true', '① ② ③ ④ ⑤ ⑥ 同时成立': 'All six true', '条件满足方式': 'Match mode',
    // 详情
    '计算器': 'Calculator', '分享': 'Share', '今日成交额': 'Turnover today', '市值': 'Mkt cap', '市盈率': 'P/E', '股息率': 'Div yield', '52 周区间': '52w range', '20 日平均成交额': '20d avg turnover', 'ATR(14) 波动': 'ATR(14)',
    '策略计划': 'Strategy plan', '触发理由': 'Trigger', '入场计划': 'Entry plan', '失效条件': 'Invalidation', '后续变化': 'What changed', '保存计划': 'Save plan', '调整': 'Adjust', '删除计划': 'Delete plan',
    '后台离场规则': 'Backend exit rules', '财务报表': 'Financials', '近 4 季': 'Last 4 quarters', '近 2 年 (年报)': 'Last 2 years (annual)', '财报还没抓到': 'Financials not fetched yet', '年报 ↗': 'Annual report ↗',
    '公告还没抓到 ·': 'Filings not fetched yet ·', '全部公告 ↗': 'All filings ↗', '最近新闻': 'Recent News', '新闻还没抓到': 'News not fetched yet', '这次没有抓到公告': 'No filings fetched this run',
    '这次没有抓到公告 ·': 'No filings fetched this run ·', 'Bursa 官网 ↗': 'Bursa website ↗', '图表载入中…': 'Loading chart…', '财报载入中…': 'Loading financials…', '公告载入中…': 'Loading filings…', '新闻载入中…': 'Loading news…',
    '载入中…': 'Loading…', '回测中…': 'Running backtest…', '计算中…': 'Calculating…',
    // 指标面板
    '指标、模板和脚本': 'Indicators, templates & scripts', '添加到': 'Add to', '自动': 'Auto', '主图': 'Main pane', '新副图': 'New pane', '个人': 'Personal', '收藏': 'Favorites', '我的脚本': 'My scripts', '内置模板': 'Built-in templates',
    '内置': 'Built-in', '技术指标': 'Technical', '趋势': 'Trend', '动量': 'Momentum', '波动性': 'Volatility', '搜索': 'Search', '搜索指标、脚本或模板': 'Search indicators, scripts or templates', '新指标放在哪里': 'Where new indicators go',
    '说明': 'Info', '添加': 'Add',
    // 页脚
    '版权与免责声明': 'Copyright & disclaimer', '成交量 ↓': 'Volume ↓', '成交量 ↑': 'Volume ↑', '涨跌% ↓': 'Change % ↓', '涨跌% ↑': 'Change % ↑', '相对量 ↓': 'Rel. volume ↓', '价格 ↓': 'Price ↓', '价格 ↑': 'Price ↑',
    '名称 A→Z': 'Name A→Z', '走势': 'Trend', '价格': 'Price', '涨跌%': 'Chg %', '成交量': 'Volume', '排序': 'Sort', '快速筛选': 'Quick filters', 'SAR 多头': 'SAR bullish', '放量 ≥ 2×': 'Vol ≥ 2×',
    '排除 RM0.10 以下': 'Exclude < RM0.10', '排除 $5 以下': 'Exclude < $5', '点开筛选 / 排序 / 自选': 'Tap to filter / sort / watch', '上市 1 天': 'Listed 1d',
    // 详情 / 计划里的固定句子
    '已到目标': 'Target hit', '已跌破止损': 'Stop breached', '进行中': 'In progress', '你的计划': 'Your plan', '默认': 'Default'
  };


  Object.assign(EXACT, {
    '笔': 'trades', '触发': 'Trigger', '计划': 'Plan', '失效': 'Invalid', '后续': 'Since', '规则': 'Rules', '保存': 'Save', '删除': 'Delete', '是不是靠运气 Robustness': 'Robustness', '是不是靠运气': 'Is it luck?', '只算已平仓': 'Closed trades only', '净收益 (占本金)': 'Net return (% of capital)', '月度收益': 'Monthly return', '逐笔净收益分布': 'Trade return distribution', '账户权益 · 含每日持仓浮盈亏': 'Account equity · marked to market daily', '净收益 (扣成本，含持仓浮盈亏)': 'Net return (after costs, incl. open P/L)', '最大回撤 (每日权益)': 'Max drawdown (daily equity)', '已平仓 · 持有中': 'Closed · Open', '每笔期望值 / 中位数': 'Expectancy / median per trade', '样本少 (< 30 笔)': 'Small sample (< 30 trades)', '策略': 'Strategy', '基准：报告内全部股票等权持有': 'Benchmark: equal-weight all stocks in report', '去掉最赚 1 笔': 'Without the best trade', '去掉最赚 3 笔': 'Without the best 3 trades', '详情 ↗': 'Details ↗', '编辑': 'Edit', '筛选　排序　☆': 'Filter · Sort · ☆', '股票池': 'Universe', '计划 R/R': 'Plan R/R', '命中': 'Matches', '停损': 'Stop', '全部名词解释 ›': 'Full glossary ›', '合计': 'Total', '指标': 'Indicators', '我的筛选器': 'My screener', '点一下改名，自动保存': 'Tap to rename; auto-saved', '选股条件说明': 'About screen rules', '后台信号说明': 'About strategy signals',
    '策略回测说明': 'About the strategy backtest', '公司公告说明': 'About company filings', '其余股票说明': 'About other stocks', '今日走势 (虚线=昨收)': "Today's move (dashed = prev close)",
    '累计盈亏说明': 'About cumulative P/L', '月度表现说明': 'About monthly performance', '版权与免责声明': 'Copyright & disclaimer', '图表类型': 'Chart type',
    '导航：市场、概览、工具、自选、筛选器种类、下载': 'Menu: market, overview, tools, watchlist, screeners, downloads', '盘中信号：用的是还没收完的日线，收盘前可能消失': 'Intraday signal: uses the unfinished daily bar — may disappear before the close',
    'Bursa 全部上市股票 (Main + ACE)，成交量达标的才进报告': 'All Bursa-listed stocks (Main + ACE); only those meeting the volume floor enter the report', '当前模板的选股条件在报告里命中几支': 'How many stocks in the report match the current template',
    '默认：现价 / 最近离场线 / 2R (点一下调整)': 'Default: last price / nearest exit line / 2R (tap to adjust)', '1.4% / 天': '1.4% / day',
    '市值 ≥ $10B': 'Mkt cap ≥ $10B', '中文': '中文', '切换到中文': '切换到中文',
    // 指标说明
    'Parabolic SAR；逐行照 pandas_ta 移植，跟策略判断"SAR多头"用的是同一种算法。': 'Parabolic SAR — ported line by line from pandas_ta; the same algorithm the strategy uses for "SAR bullish".',
    '中轨 = N 日均线，上下轨 = 中轨 ± 倍数 × 标准差，上下轨之间填色。': 'Middle band = N-day MA; upper/lower = middle ± multiplier × stdev; the band is shaded.',
    '按 TradingView 内置 Pine 脚本的算法；先行带往未来多画 (位移 − 1) 根，A 在 B 上方云是绿色。': "Follows TradingView's built-in Pine script; the leading spans extend (shift − 1) bars into the future; the cloud is green when A is above B.",
    '按 TradingView 内置脚本 (ta.supertrend)；多头绿线在K线下方，空头红线在上方。': "Follows TradingView's ta.supertrend; the bullish green line sits below the candles, the bearish red line above.",
    'Wilder 平滑，跟后台策略用的 RSI 一致；虚线是 70 / 30。': "Wilder smoothing, identical to the RSI the backend strategy uses; dashed lines at 70 / 30.",
    'MACD 线 = 快 EMA − 慢 EMA；信号线 = MACD 线的 EMA；柱 = 两者之差。': 'MACD line = fast EMA − slow EMA; signal line = EMA of the MACD line; histogram = the difference.',
    '默认参数：快线长度 12，慢线长度 26，信号线长度 9': 'Defaults: fast 12, slow 26, signal 9',
    '%K = N 日内收盘价的相对位置 (平滑后)，%D = %K 的均线；虚线是 80 / 20。': '%K = close position within the N-day range (smoothed); %D = MA of %K; dashed lines at 80 / 20.',
    '默认参数：%K 长度 14，%K 平滑 1，%D 平滑 3': 'Defaults: %K length 14, %K smoothing 1, %D smoothing 3',
    '价格偏离均价的程度；虚线是 +100 / −100。': 'How far price deviates from its average; dashed lines at +100 / −100.',
    '收盘价在 N 日高低区间里的位置 (0 到 −100)；虚线是 −20 / −80。': 'Close position within the N-day high-low range (0 to −100); dashed lines at −20 / −80.',
    '真实波幅的 Wilder 平滑，衡量波动大小。': 'Wilder-smoothed true range — a measure of volatility.', '(上轨 − 下轨) ÷ 中轨，数值越小代表越收敛。': '(upper − lower) ÷ middle; the smaller, the tighter the squeeze.',
    'N 日成交量平均，跟成交量柱共用坐标轴。': 'N-day average volume, sharing the axis with the volume bars.', '上涨日加成交量、下跌日减成交量的累计值。': 'Running total: add volume on up days, subtract on down days.',
    '最近 N 根K线的成交量加权平均价。': 'Volume-weighted average price over the last N bars.', '默认参数：转换线长度 9，基准线长度 26，先行带B长度 52，位移 26': 'Defaults: conversion 9, base 26, span B 52, shift 26',
    '默认参数：加速因子 0.02，最大值 0.2': 'Defaults: acceleration 0.02, max 0.2', '默认参数：长度 20，标准差倍数 2': 'Defaults: length 20, stdev multiplier 2', '默认参数：ATR 长度 10，倍数 3': 'Defaults: ATR length 10, multiplier 3',
    '默认参数：长度 20': 'Defaults: length 20', '最近 N 根K线收盘价的简单平均。': 'Simple average of the last N closes.', '越近的K线权重越大的平均线。': 'Moving average that weights recent bars more.',
    '移动平均线 SMA': 'Simple Moving Average (SMA)', '指数移动平均 EMA': 'Exponential Moving Average (EMA)', '抛物线转向 SAR': 'Parabolic SAR', '布林带 Bollinger Bands': 'Bollinger Bands',
    '一目均衡表 Ichimoku Cloud': 'Ichimoku Cloud', 'Supertrend 超级趋势': 'Supertrend', '相对强弱指数 RSI': 'Relative Strength Index (RSI)', '随机指标 Stochastic': 'Stochastic', '顺势指标 CCI': 'Commodity Channel Index (CCI)',
    '威廉指标 Williams %R': 'Williams %R', '平均真实波幅 ATR': 'Average True Range (ATR)', '布林带带宽': 'Bollinger Bandwidth', '成交量均线': 'Volume MA', '能量潮 OBV': 'On-Balance Volume (OBV)', '滚动 VWAP': 'Rolling VWAP'
  });


  Object.assign(EXACT, {
    '机会': 'Setups', '日期': 'Date', '主力位': 'Key level', '达标': 'Rules met', '我的持仓 ›': 'My holdings ›', '页面': 'Pages', '没有月线的数据': 'No monthly data', '近 30 日走势': 'Last 30 days',
    '图表载入失败：这次运行没有生成完整图表数据': 'Chart failed to load: full chart data was not generated this run',
    // 财报
    '营业收入': 'Revenue', '净利润': 'Net income', '净利率': 'Net margin', '经营现金流': 'Operating cash flow', '项目': 'Item', '毛利': 'Gross profit', '营业利润': 'Operating income', '每股盈利 (EPS)': 'EPS', '每股Profit (EPS)': 'EPS',
    '总资产': 'Total assets', '总负债': 'Total liabilities', '股东权益': "Shareholders' equity", '现金及等价物': 'Cash & equivalents', '总债务': 'Total debt', '自由现金流': 'Free cash flow',
    '财报说明': 'About financials', '新闻说明': 'About news', '自设': 'Custom', '现价': 'Last', '转盈': 'turned profitable', '转正': 'turned positive',
    // 计算器
    '交易成本 · 保本价': 'Costs · Break-even', '按风险算股数': 'Size by risk', '买入价 (RM)': 'Buy price (RM)', '卖出价 (RM)': 'Sell price (RM)', '数量': 'Quantity', '手': 'Lots', '股': 'Shares', '股数': 'Shares',
    '买入金额': 'Buy amount', '买入费用': 'Buy fees', '买入总成本': 'Total buy cost', '保本卖价': 'Break-even sell price', '卖出金额': 'Sell amount', '卖出费用': 'Sell fees', '净赚': 'Net profit', '来回费用合计': 'Total round-trip fees',
    '收费标准': 'Fee schedule', '佣金 (%)': 'Brokerage (%)', '最低佣金 (RM)': 'Min brokerage (RM)', '佣金服务税 SST (%)': 'Brokerage SST (%)', '结算费 (%)': 'Clearing fee (%)', '结算费上限 (RM)': 'Clearing fee cap (RM)',
    '印花税 (每 RM1,000，RM)': 'Stamp duty (per RM1,000, RM)', '印花税上限 (RM)': 'Stamp duty cap (RM)', '每笔其他费用 (RM)': 'Other fees per trade (RM)', '这一笔最多亏 (RM)': 'Max loss on this trade (RM)',
    '风险价': 'Risk price', '预期卖价': 'Target sell price', '可以买': 'Can buy', '需要本金': 'Capital needed', '跌到风险价': 'If it falls to the risk price', '到预期卖价': 'At the target price',
    '用这个股数算交易成本 ›': 'Use this size in the cost calculator ›', '数量单位': 'Quantity unit', '收费标准说明': 'About fees', '按风险算股数说明': 'About sizing by risk', '填上买入价和数量': 'Enter the buy price and quantity',
    '填上进场价、风险价和最多亏多少': 'Enter the entry price, risk price and max loss', '资本 (RM)': 'Capital (RM)', '本金 (RM)': 'Capital (RM)',
    // 指标数字
    '20 日均额': '20d avg turnover', '50 日均线': 'SMA50', '支撑距离': 'Support distance', '支撑': 'Support',
    '今天成交额 = 价格 × 成交量；越大越容易进出': "Today's turnover = price × volume; the larger, the easier to enter / exit", '前 20 个交易日平均每天的成交额': 'Average daily turnover over the previous 20 sessions',
    '今天成交量 ÷ 前 20 天平均': "Today's volume ÷ the previous 20-day average", '旁边 = 现价比它高 / 低多少': 'Next to it = how far price is above / below it', '旁边 = 现价比它高 / 低多少 (%)': 'Next to it = how far price is above / below it',
    'SAR 在现价下面：这个价位 = 跟踪止损线，收盘跌破就转空': 'SAR is below price: this level is the trailing stop; a close below it flips SAR bearish', 'SAR 在现价上面：收盘涨过它就转多': 'SAR is above price: a close above it flips SAR bullish',
    '70 以上偏热、30 以下偏冷': 'Above 70 = hot, below 30 = cold', '平均每天的波动幅度 (价格)；旁边 = 占现价 %': 'Average daily range (in price); next to it = % of price', '现价到最近支撑有几个 ATR；小于 1 = 正常波动就可能碰到': 'How many ATRs from price to the nearest support; below 1 = normal volatility can reach it',
    '回测里同类信号的历史统计，不是这份计划': 'Historical statistics of similar backtested signals — not this plan',
    // 计划滚轮 / 设置
    '止损用': 'Stop at', '回调低点': 'Pullback low', '进场': 'Entry', '上涨': 'Up', '下跌': 'Down', 'EMA 20 / 线形图': 'EMA 20 / line chart', '网格': 'Grid', '横线': 'Horizontal lines', '竖线': 'Vertical lines', '线型': 'Line style', '实线': 'Solid', '点线': 'Dotted', '虚线': 'Dashed',
    '背景浅色 / 深色跟着系统；只存在这个浏览器里': 'Light / dark background follows the system; stored only in this browser', '完成': 'Done', '只存在这个浏览器里': 'Stored only in this browser', '恢复默认': 'Reset',
    // 模板 / 条件编辑
    '＋ 当前模板另存一份': '+ Save a copy of this template', '＋ 空白模板': '+ Blank template', '⤓ 导出备份': '⤓ Export backup', '⤒ 导入备份': '⤒ Import backup', '模板说明': 'About templates',
    '至少 N 条': 'At least N rules', '至少满足': 'At least', '条': 'rules', '还没有条件，点下面的「＋ 添加条件」。': 'No rules yet — tap "+ Add rule" below.', '公式条件': 'Formula rule', '怎么看、怎么写': 'How to read and write rules',
    '每支股票只看': 'Each stock is checked on', '最新一根日线': 'its latest daily bar', '日': 'd', '等': 'etc.', '例子:': 'Examples:', '怎样算命中': 'What counts as a match', '至少满足几条': 'How many rules must hold',
    '= 报告更新时的最新成交价 (跟表格"价格"一样，收盘后就是收盘价)；「今日」= 最新这一根，「昨日收盘」= 前一根': '= last traded price when the report was generated (same as "Price" in the table; after the close it is the closing price); "Today" = the latest bar, "Yesterday close" = the previous bar',
    '= 这一根刚穿过去 (前一根还在另一边)；': '= it just crossed on this bar (the previous bar was still on the other side); ', '= 用几根日线算，例如 EMA 20 日': '= how many daily bars are used, e.g. EMA 20 days', ': 比较': ': compare', ', 组合': ', combine', '; 变量': '; variables', '; 函数': '; functions',
    '(突破昨天高点，而且放量)': '(breaks yesterday\'s high with heavy volume)',
    '昨日收盘': 'Yesterday close', '今日开盘': 'Today open', '今日最高': 'Today high', '今日最低': 'Today low', '前 N 日最高': 'Highest of prior N days', '前 N 日最低': 'Lowest of prior N days', 'SAR 抛物线': 'Parabolic SAR', 'MACD 线': 'MACD line', 'T3 形态突破': 'T3 breakout', '固定数字': 'Fixed number',
    '删除这条条件': 'Delete this rule', '比较': 'Compare', '加速': 'Acceleration', '最大': 'Max', 'SAR 抛物线 加速': 'Parabolic SAR acceleration', 'SAR 抛物线 最大': 'Parabolic SAR max', 'SMA 均线 用几日计算': 'SMA length (days)', 'EMA 均线 用几日计算': 'EMA length (days)',
    '成交量 (百万股)': 'Volume (millions of shares)', '例如 close > sma(close,50) and rsi(close,14) < 70': 'e.g. close > sma(close,50) and rsi(close,14) < 70', '✎ 编辑条件': '✎ Edit rules', '回测这组条件 ›': 'Backtest these rules ›', '今天没有股票符合': 'No stocks match today', '没有符合的股票': 'No matching stocks',
    '近 6 个月没有出现过': 'Not triggered in the last 6 months', '近 6 个月没有出现过这组条件': 'These rules did not trigger in the last 6 months',
    '「当前设定」那页用后台固定账本；其他页用今天报告里的股票重算，只作对比。': 'The "Current setup" page uses the backend\'s frozen ledger; the other pages recompute with the stocks in today\'s report and are for comparison only.',
    '自选的股票按你填的日子和价钱先买，碰到你的停损 / 目标就卖，其余照后台离场规则；空出来的仓位按新信号换进': 'Your own picks are bought first at your date / price and sold at your stop / target; everything else follows the backend exit rules; freed slots rotate into new signals',
    '没有足够的逐日价格，只能看下面的已实现盈亏曲线。': 'Not enough daily prices — only the realized P/L curve below is available.', '已实现盈亏曲线 (只在结算日入账，不含持仓浮盈亏) · 每月期望值': 'Realized P/L curve (booked on settlement day only, excluding open P/L) · Monthly expectancy',
    '已复制 strategy.json 内容': 'strategy.json content copied', '内容已复制': 'Content copied', '打开 GitHub 编辑 strategy.json ›': 'Open GitHub to edit strategy.json ›', '全部换成复制的内容 →': 'Replace everything with the copied content →', '再复制一次': 'Copy again', '设为后台信号说明': 'About setting as strategy',
    'strategy.json 内容': 'strategy.json content', '复制不了，请长按内容全选复制': 'Copy failed — long-press the text, select all and copy',
    // 我的持仓
    '我的持仓 vs 信号': 'My holdings vs signals', '加入': 'Add', '我': 'Me', '我的持仓': 'My holdings', '收益率': 'Return', '买入': 'Buy', '自己找的': 'Self-picked', '持仓': 'Positions', '卖出日': 'Sell date', '卖出价': 'Sell price', '买入日': 'Buy date', '买入价': 'Buy price',
    '股票代码或名称': 'Stock code or name', '没卖就空着': 'Leave empty if unsold', '年化，对基准回归的超额收益': 'Annualized excess return from regression on the benchmark', '对基准的敏感度': 'Sensitivity to the benchmark', '年化，无风险利率 0': 'Annualized, risk-free rate 0',
    '，α / β / Sharpe 参考价值很低。α、Sharpe 年化；基准 = 报告内股票等权持有。': ', so α / β / Sharpe are of little value. α and Sharpe are annualized; benchmark = equal-weight of the stocks in the report.',
    '已满 3 仓': 'Full (3 slots)', '开启': 'On', '关闭': 'Off'
  });

  // ---------- 2. 带数字的句型 (按顺序全部套用) ----------
  var PATTERNS = [
    [/^信号筛选 ▾ · (\d+)$/, 'Signal filter ▾ · $1'], [/^信号筛选 ▴ · (\d+)$/, 'Signal filter ▴ · $1'],
    [/^报告里没有「(.*)」$/, 'No "$1" in the report'],

    [/^报告里找不到「(.*)」，试试股票代码或简称$/, 'Cannot find "$1" in the report; try the stock code or short name'],

    [/(^|\s)转盈$/, '$1turned profit'], [/(^|\s)转亏$/, '$1turned loss'], [/(^|\s)转正$/, '$1turned positive'], [/(^|\s)转负$/, '$1turned negative'],

    [/^成本：来回 ([\d.]+)% · 每笔 RM\s?([\d,]+)$/, 'Cost: round-trip $1% · RM $2 per trade'],
    [/^仓位：最多同时 (\d+) 笔，满了新信号跳过 \((\d+) 个信号，满仓跳过 (\d+) 个\)；同一天先买相对量高的$/, 'Positions: max $1 at once, new signals skipped when full ($2 signals, $3 skipped); same-day ties buy higher relative volume first'],

    [/^(QoQ|YoY|vs prior year) (转盈|转亏|转正|转负)$/, function (m, a, b) { return a + ' ' + ({ '转盈': 'turned profit', '转亏': 'turned loss', '转正': 'turned positive', '转负': 'turned negative' })[b]; }],
    [/^(\d+\/\d+) 起 · 最多 (\d+) 笔$/, 'From $1 · up to $2 trades'],
    [/^我的模板 · (.+?)( \(当前\))?$/, function (m, n, c) { return 'My template · ' + n + (c ? ' (current)' : ''); }],

    // --- 整句 / 句首 (先套用) ---
    // --- 补充：整句 (放最前面，先于通用句型) ---
    [/(\d\d\/\d\d) 以后出现的信号才会买进 \(最多同时 (\d+) 笔\)，现在还没有交易。/, 'Only signals after $1 are bought (max $2 concurrent); no trades yet.'],
    [/最近 (\d+) 个交易日没有信号/, 'No signals in the last $1 sessions'], [/近 (\d+) 天没有新闻/, 'No news in the last $1 days'], [/近 (\d+) 个月没有出现过(这组条件)?/, 'Not triggered in the last $1 months'],
    [/默认计划：目标 = 2 倍风险/, 'Default plan: target = 2× risk'], [/策略目标 \+?([\d.]+)% ÷ 到最近更高低点的风险 ([\d.]+)%/, 'Strategy target +$1% ÷ risk to the latest higher low $2%'], [/策略没有设目标/, 'No strategy target'],
    [/历史参考 \(回测同类信号期间最大涨幅中位数 ([^)]*)\) = 1 : ([\d.]+)，不是计划/, 'Historical reference (median MFE of similar backtested signals $1) = 1 : $2 — not the plan'],
    [/^默认计划：进场 ([\d.]+) · 止损 ([\d.]+) · 目标 ([\d.]+) · R\/R = \(目标 − 进场\) ÷ \(进场 − 止损\)/, 'Default plan: entry $1 · stop $2 · target $3 · R/R = (target − entry) ÷ (entry − stop)'],
    [/^按你的计划：进场 ([\d.]+) · 止损 ([\d.]+) · 目标 ([\d.]+) · R\/R = \(目标 − 进场\) ÷ \(进场 − 止损\)/, 'Your plan: entry $1 · stop $2 · target $3 · R/R = (target − entry) ÷ (entry − stop)'],
    [/历史 最大涨幅中位数 ([+\-\d.]+%)( · 1 : ([\d.]+))?/, 'History: median MFE $1$2'], [/(\d+) 天前存/g, 'saved $1d ago'], [/今天存/g, 'saved today'], [/(\d+) 小时前/g, '$1h ago'], [/(\d+) 分钟前/g, '$1 min ago'],
    [/^(.+?)各期数值，详见下方表格$/, '$1 by period — see the table below'], [/报告期结束：/, 'Period ended: '], [/ · 单位 令吉/, ' · unit: MYR'], [/较上年/, 'vs prior year'], [/环比/g, 'QoQ'], [/同比/g, 'YoY'], [/(-?[\d.]+) 个百分点/g, '$1 pp'],
    [/佣金 ([\d.,]+) · 结算费 ([\d.,]+) · 印花税 ([\d.,]+)/, 'Brokerage $1 · Clearing $2 · Stamp duty $3'], [/占买入金额 ([\d.]+)%/, '$1% of the buy amount'], [/买入价 \+([\d.]+)%/, 'Buy price +$1%'], [/每股 ([+\-−\d.]+) \((.+?)\)/, 'Per share $1 ($2)'],
    [/扣费用后 1 : ([\d.]+)/, 'After fees 1 : $1'], [/按一手 (\d+) 股往下取整/, 'Rounded down to lots of $1 shares'],
    [/已加入自选：(.+?) \(☰ → 自选\)/, 'Added to watchlist: $1 (☰ → Watchlist)'], [/从自选移除 (.+)/, 'Removed from watchlist: $1'],
    [/^颜色 \(浅色背景\)$/, 'Color (light background)'], [/^颜色 \(深色背景\)$/, 'Color (dark background)'], [/选股条件：(.+)/, 'Screen rules: $1'], [/打开 (.+?) 的完整图表/, 'Open the full chart of $1'], [/删除第 (\d+) 条条件/, 'Delete rule $1'],
    [/第 (\d+) 条条件的左边/, 'Left side of rule $1'], [/第 (\d+) 条条件的右边/, 'Right side of rule $1'], [/第 (\d+) 条条件的公式/, 'Formula of rule $1'], [/(\d+) 个条件 · (\d+) 个指标 · 使用中/, '$1 rules · $2 indicators · in use'], [/(\d+) 个条件 · (\d+) 个指标/, '$1 rules · $2 indicators'],
    [/(\d+) 支没有K线 \((.+?)\)/, '$1 without candles ($2)'], [/这次运行没有生成完整图表数据/, 'full chart data was not generated this run'], [/我的模板 · (.+?) \(当前\)/, 'My template · $1 (current)'],
    [/后台会扫描 (\d+) 套：(.+)/, 'The backend will scan $1 set(s): $2'], [/我的持仓从 (\d\d\/\d\d) 开始 · 到 (\d\d\/\d\d)/, 'My holdings since $1 · to $2'], [/信号 \((\d+) 仓\)/, 'Signals ($1 slots)'], [/样本只有 (\d+) 个交易日/, 'Only $1 trading days of data'],
    [/进行中 · 现价 /, 'In progress · price '], [/离止损 /g, 'to stop '], [/离目标 /g, 'to target '],
    [/^全部 (\d+) 笔$/, 'All $1 trades'], [/^成本 ([\d.]+)% \(\+([\d.]+)\)$/, 'Cost $1% (+$2)'], [/^向前模拟 \((\S+) 起\)$/, 'Forward sim (from $1)'], [/^向前模拟$/, 'Forward sim'],
    [/本金 (RM\s?[\d,]+) \((\d+) 仓 × (RM\s?[\d,]+)\) · 来回成本 ([\d.]+)% · 收盘价进场/, 'capital $1 ($2 slots × $3) · round-trip cost $4% · enter at close'], [/最长没恢复 (\d+) 天(，还没恢复)?/, function (m, d, x) { return 'Longest underwater ' + d + 'd' + (x ? ' (not recovered)' : ''); }],
    [/(\d+) 笔 · (\d+) 笔/, '$1 closed · $2 open'], [/95% 区间/, '95% CI'], [/占本金/g, 'of capital'], [/(\d+) 天恢复|\((\d+) 天\)/g, function (m, a, b) { return '(' + (a || b) + 'd)'; }],
    [/最深回撤 (-?[\d.]+%)：(\S+) 高点 → (\S+) 谷底 → (?:(\S+) 恢复|还没恢复)/, function (m, dd, a, b, c) { return 'Deepest drawdown ' + dd + ': peak ' + a + ' → trough ' + b + ' → ' + (c ? 'recovered ' + c : 'not recovered'); }],
    [/最赚 3 笔占全部盈利的 (\S+)。低价股的实际滑点常比 0.5% 大，看成本那几行。/, 'The best 3 trades make up $1 of all profit. Slippage on low-priced stocks is often larger than 0.5% — see the cost rows.'],
    [/中位数 (\S+) \(虚线\) · n = (\d+)/, 'Median $1 (dashed) · n = $2'], [/(\d+) 笔没有逐日价格，只在结算日计入。/, '$1 trades have no daily prices and are counted on their settlement day only.'],
    [/最近 (\d+) 天内触发了离场规则/, 'Exit rule triggered in the last $1 days'],
    [/^默认计划：/, 'Default plan: '], [/^按你的计划：/, 'Your plan: '], [/R\/R = \(目标 − 进场\) ÷ \(进场 − 止损\)/, 'R/R = (target − entry) ÷ (entry − stop)'],
    [/默认计划：目标 = 2 倍风险。历史参考 \(回测同类信号期间最大涨幅中位数 ([^)]*)\) = 1 : ([\d.]+)，不是计划/, 'Default plan: target = 2× risk. Historical reference (median MFE of similar backtested signals $1) = 1 : $2 — not the plan'],
    [/现价在 52 周区间的 (\d+)% 位置/, 'Price at $1% of the 52w range'], [/跳一格 (\d+)%/, 'One tick = $1%'], [/最小跳动 ([\d.]+)，跳一格就是 (\d+)%/, 'Min tick $1 — one tick = $2%'],
    [/标 = 2 倍风险/, 'Target = 2R'], [/损 = /, 'Stop = '], [/(\d+) 支没有K线/, '$1 without candles'], [/^信号 (\d+ \/ \d+)$/, 'Signals $1'], [/^(新增信号|持续符合|条件失效|接近风险线|我的计划) (\d+ \/ \d+)$/, function (m, g, n) { return EXACT[g] + ' ' + n; }],
    [/(^|[\s·(])量 ([\d.]+)×/g, '$1Vol $2×'],
    [/上个月 (\d+) 月/, function (m, a) { return 'Last month · ' + (MON[+a] || a); }], [/本月至今 (\d+) 月/, function (m, a) { return 'MTD · ' + (MON[+a] || a); }],
    [/仓位：最多同时 (\d+) 笔，满了新信号跳过 \(这段期间 (\d+) 个信号，满仓跳过 (\d+) 个\)；同一天先买相对量高的/, 'Slots: max $1 concurrent; new signals are skipped while full ($2 signals in this period, $3 skipped); on the same day the higher relative volume is bought first'],
    [/成本：来回 ([\d.]+)% · 每笔 (RM\s?[\d,]+) · (.+?) · (\d+) 支/, 'Cost: $1% round trip · $2 per trade · $3 · $4 stocks'],
    [/进场：「(.+?)」：/, 'Entry: "$1": '], [/\(全部满足\)/, '(all rules must hold)'],
    [/6 条里\(.*\)/, 'Any 5 of 6 rules true (the pages below split out which 5)'],
    [/^(\d+) 条里任意 (\d+) 条成立 \(下面几页拆开看是哪 (\d+) 条\)$/, 'Any $2 of $1 rules true (the pages below split out which $3)'],
    [/周([一二三四五六日])/g, function (m, d) { return { '一': 'Mon', '二': 'Tue', '三': 'Wed', '四': 'Thu', '五': 'Fri', '六': 'Sat', '日': 'Sun' }[d]; }],
    [/^(\d+)分$/, '$1m'], [/^(\d+)小时$/, '$1h'], [/^(\d+)天$/, '$1D'], [/· 天$/, '· D'], [/\/ 天$/, '/ day'],
    [/全市场 (\d+) 支：涨 (\d+) · 平 (\d+) · 跌 (\d+)/, 'Whole market $1 stocks: Adv $2 · Unch $3 · Dec $4'],
    [/报告里 (\d+) 支股票今天的成交额是前 (\d+) 天平均的 ([\d.]+) 倍/, 'Turnover of the $1 stocks in this report today is $3× their prior $2-day average'],
    [/涨跌榜只看成交额 ≥ (RM\s?[\d.,]+[A-Za-z]*|\$[\d.,]+[A-Za-z]*) 的股票/, 'Movers only include stocks with turnover ≥ $1'],
    [/上涨 (\d+) 家，平盘 (\d+) 家，下跌 (\d+) 家/, 'Advancers $1, unchanged $2, decliners $3'],
    [/在今天报告里的 (\d+) 支股票里筛/, 'Screening the $1 stocks in today\'s report'],
    [/信号用的是还没收完的日线，收盘前可能变化(；报价约延迟 (\d+) 分钟)?/, function (m, a, d) { return 'Signals use the unfinished daily bar and may change before the close' + (d ? '; quotes delayed ~' + d + ' min' : ''); }],
    [/盘中信号：用的是还没收完的日线，收盘前可能消失/, 'Intraday signal: uses the unfinished daily bar — may disappear before the close'],
    [/新上市：只有 (\d+) 个交易日的数据，天数不够的指标显示 —/, 'New listing: only $1 session(s) of data; indicators needing more history show —'],
    [/相对量 ([\d.]+) 倍：平时成交很少，倍数容易虚高/, 'Rel. volume $1×: normally thinly traded, so the multiple is easily inflated'],
    [/报酬参考 \(回测同类信号期间最大涨幅中位数\)：/, 'Reward reference (median MFE of similar backtested signals): '],
    [/最近的离场线：/, 'Nearest exit line: '], [/回测样本不够/, 'Not enough backtest samples'], [/现价下方没有离场线/, 'No exit line below price'],
    [/报告里的股票最近 (\d+) 天的公告 \(Bursa 官网\)/, 'Filings from the last $1 days for stocks in the report (Bursa website)'],
    [/图表类型：/, 'Chart type: '], [/改名「(.+?)」/, 'Rename "$1"'], [/删除「(.+?)」/, 'Delete "$1"'],
    [/筛选器名称 \(当前模板 = 选股条件 \+ 图表指标，改名自动保存\)/, 'Screener name (current template = rules + chart indicators; renames auto-save)'],
    [/(\d+) 个指标/, '$1 indicators'], [/没有条件/, 'No rules'], [/使用中/, 'in use'],
    [/成交量 > ([\d.]+) 万/, function (m, n) { return 'Volume > ' + (+n / 100) + 'M'; }], [/价格 ([\d.]+) ~ ([\d.]+)/, 'price $1 – $2'],
    [/每笔投入 (RM\s?[\d,]+)，同时最多持有 (\d+) 笔 → 本金 (RM\s?[\d,]+)。回撤 % = 本金加上已赚的，从最高点往下掉了多少。/, 'Size per trade $1, max $2 concurrent → capital $3. Drawdown % = drop from the peak of capital plus realized profit.'],
    [/(\d\d\/\d\d) 收盘起按信号买：自选的股票照自己填的日子和价钱先买 \(占着仓位\)，碰到自己的停损 \/ 目标就卖，其余照后台离场规则；空出来的仓位按新信号换进 \(最多同时 (\d+) 笔(，满仓跳过 (\d+) 个信号)?\)。用今天报告里的股票算。/,
      function (m, d, n, x, k) { return 'From the ' + d + ' close, buy on signals. Your own picks are bought first at your date / price (occupying slots) and sold at your stop / target; everything else follows the backend exit rules. Freed slots rotate into new signals (max ' + n + ' concurrent' + (k ? ', ' + k + ' signals skipped while full' : '') + '). Uses stocks in today\'s report.'; }],
    [/任意 (\d+) 条成立 \(下面几页拆开看是哪 (\d+) 条\)/, '(the pages below split out which $2)'], [/(\d+) 条里任意 (\d+) 条成立/, 'Any $2 of $1 rules true'],
    [/同时成立 \(其他条不管\)/, 'all true (other rules ignored)'],
    // --- 回测里的离场规则句子 (main.py / report.js exit_labels)：去掉重复的英文括号 ---
    [/收盘跌破最近回调低点 \(收盘价，(.+?)，只往上移\) \(Trailing Stop\)(：只提醒不离场 \(Alert only\))?/, function (m, how, al) { return 'Trailing stop: close below the latest pullback low (' + how + ', only ratchets up)' + (al ? ' — alert only, no exit' : ''); }],
    [/回调后第一根收涨确认/, 'confirmed by the first up-close after the pullback'], [/左右 (\d+) 根确认/, '$1 bars each side to confirm'],
    [/趋势健康检查：(.+?)，坏掉 (\d+) 个就离场 \(Trend Health Exit\)/, 'Trend health exit: exit when $2 of these fail — $1'],
    [/收盘连续 (\d+) 天 < EMA(\d+) 全部离场 \(第一天只提醒，隔天收回就继续拿\) \(EMA Break\)/, 'EMA break: exit all after $1 straight closes < EMA$2 (day 1 alert only; recovering the next day keeps the trade)'],
    [/Supertrend\(([\d.,]+)\) 在价格下面就继续持有 \(Supertrend Hold\)/, 'Supertrend hold: keep holding while Supertrend($1) is below price'],
    [/入场风险 > ([\d.]+)% 不进 \(当天涨 ≥ ([\d.]+)% 放宽到 ([\d.]+)%\) \(Max Entry Risk\)/, 'Max entry risk: skip if > $1% (relaxed to $3% when the signal day is up ≥ $2%)'], [/入场风险 > ([\d.]+)% 不进 \(Max Entry Risk\)/, 'Max entry risk: skip if > $1%'],
    [/涨到 \+([\d.]+)% 开始锁利润：之后趋势坏掉任何 1 个就止盈 \(Trailing Take Profit\)/, 'Trailing take-profit: after +$1%, take profit as soon as any 1 trend check fails'],
    [/止盈 \+([\d.]+)% \(Take Profit\)/, 'Take profit +$1%'], [/止损 -([\d.]+)% \(Stop Loss\)/, 'Stop loss -$1%'], [/最多持有 (\d+) 天 \(Time Stop\)/, 'Time stop: max $1 days'],
    [/跌破回调红K低点 \(Pullback Red Candle\)/, 'Pullback red-candle low'], [/涨到历史高点 \(Prior High\)/, 'Prior high reached'], [/涨到近期阻力 \(Resistance\)/, 'Resistance reached'],
    [/SAR 转空 \(SAR Flip\)/, 'SAR flip (bearish)'], [/EMA(\d+) 下穿 EMA(\d+) \(EMA Cross-down\)/, 'EMA$1 crosses below EMA$2'], [/不限持有天数 \(?(No Max Hold)?\)?/, 'No max holding period'],
    [/收盘跌破 Supertrend\(([\d.,]+)\)/g, 'close < Supertrend($1)'], [/收盘跌破支撑 \(最近更高低点\)/g, 'close < support (latest higher low)'], [/放量抛售 \(收跌、量 ≥ ([\d.]+) 倍均量\)/g, 'heavy-volume selling (down close, vol ≥ $1× avg)'],
    [/收盘 < EMA(\d+)( 连续 (\d+) 天)?/g, function (m, n, x, d) { return 'close < EMA' + n + (d ? ' for ' + d + ' days' : ''); }], [/(\d+) 倍均量/g, '$1× avg vol'],
    // --- 一般数字句型 ---
    [/最多同时 (\d+) 笔/g, 'max $1 concurrent'], [/同时最多持有 (\d+) 笔/g, 'max $1 concurrent'], [/同时最多 (\d+) 笔/g, 'max $1 concurrent'],
    [/^(\d+)月$/, function (m, a) { return MON[+a] || m; }],
    [/(\d+)\s?月 (\d+)\s?日/g, function (m, a, b) { return (MON[+a] || a) + ' ' + b; }],
    [/上个月 (\d+) 月/, function (m, a) { return 'Last month · ' + (MON[+a] || a); }],
    [/本月至今 (\d+) 月/, function (m, a) { return 'MTD · ' + (MON[+a] || a); }],
    [/更新时间 /, 'Updated '], [/(\d+):(\d+) 更新 · 信号 (\d+) 支/, '$1:$2 updated · $3 signals'], [/共 (\d+) 支/, 'total $1'],
    [/(\d\d)\/(\d\d) 收盘$/, '$1/$2 close'], [/(\d\d)\/(\d\d) 盘中$/, '$1/$2 intraday'],
    [/触发 (\d\d\/\d\d) · 收盘确认/, 'Triggered $1 · close-confirmed'], [/触发 (\d\d\/\d\d) · /, 'Triggered $1 · '], [/触发 (\d\d\/\d\d) /, 'Triggered $1 '],
    [/盘中，收盘前可能消失/, 'intraday — may disappear before the close'],
    [/(\d\d\/\d\d) 信号 · 进 /g, '$1 signal · entry '], [/(\d\d\/\d\d) 离场 /g, '$1 exit '], [/第 (\d+) 天/g, 'day $1'], [/(\d+) 天前存的/g, 'saved $1d ago'], [/今天存的/g, 'saved today'],
    [/(\d+) 天前/g, '$1d ago'], [/(\d+)\s?天内/g, 'within $1d'], [/(\d+)\s?个交易日/g, '$1 sessions'], [/近 (\d+) 个交易日/g, 'last $1 sessions'], [/(\d+)\s?天/g, '$1d'],
    [/(\d+)\s?笔/g, '$1 trades'], [/(\d+)\s?支/g, '$1 stocks'], [/(\d+)\s?根/g, '$1 bars'], [/(\d+)\s?条/g, '$1 rules'], [/(\d+)\s?个仓位/g, '$1 slots'], [/(\d+)\s?倍/g, '$1×'], [/(\d+)\s?家/g, '$1'],
    [/Paper Account · 从 (\S+) 开始/, 'since $1'], [/^持有 (\d+)$/, 'open $1'], [/从 (\d\d\/\d\d) 开始/, 'since $1'], [/(\d+) 季/g, '$1Q'], [/(\d+) 周/g, '$1w'], [/(\d+) 手/g, '$1 lot'], [/一手 (\d+) 股/, 'Lot = $1 sh'],
    [/(\d[\d,]*) 股/g, '$1 sh'], [/(\d+) 年/g, '$1y'], [/满仓跳过 (\d+)/, 'skipped (full) $1'], [/(\d+) 支没有K线/, '$1 without candles'],
    [/新高 (\d+) · 新低 (\d+)/, '52w highs $1 · lows $2'], [/涨 (\d+)/, 'Adv $1'], [/平 (\d+)/, 'Unch $1'], [/跌 (\d+)/, 'Dec $1'],
    [/^成交额 (RM|\$)/, 'Turnover $1'], [/每笔 (RM\s?[+\-−]?[\d,]+) · 中位 /, 'Per trade $1 · median '], [/每笔投入 (RM\s?[\d,]+)/, 'Size per trade $1'], [/同时最多 (\d+) 笔/, 'max $1 concurrent'],
    [/最多同时 (\d+) 笔/, 'max $1 concurrent'], [/已结算 (\d+) trades/, 'Closed $1 trades'], [/回测里还拿着 /, 'Open in backtest '], [/显示全部 (\d+) stocks/, 'Show all $1'],
    [/至少满足 (\d+) rules/, 'At least $1 rules true'], [/(\d+) rules里任意 (\d+) rules成立/, 'Any $2 of $1 rules true'], [/上市 (\d+)d/, 'Listed $1d'],
    [/(\d+) 倍：/, '$1×: '], [/进 (\d[\d.]*)，点一下调整/, 'Entry $1 — tap to adjust'], [/损 (\d[\d.]*)，点一下调整/, 'Stop $1 — tap to adjust'], [/标 (\d[\d.]*)，点一下调整/, 'Target $1 — tap to adjust'],
    [/进 (\d[\d.]*)/g, 'Entry $1'], [/回撤 (-?[\d.]+%)/, 'Drawdown $1'], [/期望值 ([+\-]?[\d.]+%) = 每笔 (RM\s?[+\-−]?[\d,]+)，(\d+) trades已结算/, 'Expectancy $1 = $2 per trade, $3 trades closed'],
    [/([\d.]+)% ~ ([\d.]+)%/, '$1% – $2%'], [/现价在 52 周区间的 (\d+)% 位置/, 'Price at $1% of 52w range'], [/跳一格 (\d+)%/, 'One tick = $1%'], [/最小跳动 ([\d.]+)，跳一格就是 (\d+)%/, 'Min tick $1 — one tick = $2%'],
    [/离止损 /g, 'to stop '], [/离目标 /g, 'to target '], [/离现价 /g, 'from price '], [/止损线 /g, 'stop line '], [/现在的止损线/g, 'current stop line']
  ];

  // ---------- 3. 词组 (子串，长的先换) ----------
  var PHRASES = {
    // 条件标签 (engine.rule_label)
    '当前价格': 'Price', '下穿': ' crosses below ', '上穿': ' crosses above ', '成交量': 'Volume', '价格': 'Price', ' 或 ': ' or ', '前 20 日最高': 'prior 20d high', '而且': 'and', '同时成立': 'all true', '其他条不管': 'other rules ignored',
    '相对量': 'Rel. volume', '收盘价': 'close', '收盘': 'close', '开盘': 'open', '最高': 'high', '最低': 'low', '成交额': 'turnover', '均线': 'MA', '金叉': 'golden cross', '死叉': 'dead cross',
    '转多': 'turns bullish', '转空': 'turns bearish', '超卖回升': 'Oversold rebound', '放量突破': 'Volume breakout', '信号线': 'signal line',
    // 策略 / 离场
    '策略': 'Strategy', '进场': 'Entry', '入场': 'Entry', '离场': 'Exit', '止损线': 'Stop line', '止损': 'Stop', '止盈': 'Take profit', '目标': 'Target', '计划': 'Plan', '风险线': 'Risk line', '风险报酬比': 'R:R', '报酬风险比': 'R:R',
    '风险': 'Risk', '报酬': 'Reward', '收益': 'Return', '亏损': 'Loss', '盈利': 'Profit', '趋势健康检查': 'Trend health check', '趋势健康': 'Trend health', '坏掉': 'fail', '就离场': ' to exit', '同时满足': 'all true:',
    '收盘跌破': 'Close < ', '跌破': 'break below ', '最近回调低点': 'latest pullback low', '最近更高低点': 'latest higher low', '更高低点': 'higher low', '回调低点': 'pullback low', '只往上移': 'only ratchets up',
    '左右': 'each side ', '确认': 'confirmed', '只提醒不离场': 'alert only, no exit', '只提醒': 'alert only', '放量抛售': 'heavy-volume selling', '收跌': 'down close', '量 ≥': 'vol ≥', '均量': 'avg vol',
    '第一天只提醒，隔天收回就继续拿': 'day 1 alert only — hold if it recovers next day', '全部离场': 'exit all', '继续持有': 'keep holding', '继续拿': 'keep holding', '在价格下面': 'below price',
    '开始锁利润': 'start locking profit', '之后趋势坏掉任何 1 个就止盈': 'then take profit when any 1 trend check fails', '涨到': 'Reaches ', '最多持有': 'Max hold ', '不限持有天数': 'No max holding period',
    '入场风险': 'Entry risk', '不进': ' → skip', '当天涨': 'signal-day gain', '放宽到': 'relaxed to', '暴涨': 'surge', '锁利润': 'lock profit', '浮动': 'trailing', '固定': 'fixed',
    '支撑': 'support', '阻力': 'resistance', '历史高点': 'prior high', '趋势': 'trend', '动量': 'momentum', '波动': 'volatility', '空头': 'bearish', '多头': 'bullish',
    // 回测 / 账户
    '胜率': 'win rate', '期望值': 'expectancy', '中位': 'median', '平均': 'avg', '合计': 'total', '每笔': 'per trade', '同时最多': 'max concurrent', '满仓': 'full', '仓位': 'slot', '账户': 'account', '本金': 'capital', '回撤': 'drawdown',
    '最大涨幅中位数': 'median MFE', '期间': 'over the trade', '历史统计': 'History', '回测里同类信号': 'backtested similar signals', '不是这份计划': 'not this plan', '对上现在的风险': 'vs current risk',
    '回测': 'backtest', '账本': 'ledger', '基准': 'benchmark', '超额': 'excess', '已结算': 'closed', '持有中': 'open', '持有': 'hold', '结算': 'settle', '离场原因': 'exit reason',
    '默认：现价进场': 'Default: enter at last price', '标 = 2 倍风险': 'Target = 2R', '损 = ': 'Stop = ', '自设计划': 'Custom plan', '默认：现价 / 最近离场线 / 2R (点一下调整)': 'Default: last price / nearest exit line / 2R (tap to adjust)',
    '策略「': 'Strategy "', '」': '" ', '期间最大涨幅中位数': 'median MFE over the trade', '计划就失效': 'invalidates the plan', '收盘价跌破': 'A close below', '「': '"', '收盘确认': 'close-confirmed', '触发': 'Triggered', '出现信号': 'signal', '进场后': 'since entry',
    '计划就失效': 'the plan is invalid', '收盘价跌破': 'A close below', '策略止损线': 'Strategy stop line', '收盘跌破 + 趋势检查坏掉才离场': 'exits on close below + a failed trend check',
    '今天刚出现。明天回来这里会写：有没有碰到止损 / 目标、趋势有没有变坏。': 'New today. Come back tomorrow: this panel will show whether stop / target was touched and whether the trend deteriorated.',
    '这笔是后台策略的进场价；止损线是最近的更高低点，会往上移。': 'Entry is the strategy fill; the stop line is the latest higher low and ratchets up.',
    '这支股票现在没有计划可以存。': 'No plan available to save for this stock.', '没有后台信号 — 这是你自己设的计划': 'No strategy signal — this is your own plan',
    '今天收盘新出现的策略信号': 'Signals that triggered at today\'s close', '最近出现过信号、趋势还健康、离止损线还远': 'Recent signals with healthy trend and room above the stop', '最近 3 天内触发了离场规则': 'Exit rule triggered in the last 3 days',
    '离止损线不到 3%，或已经有趋势检查坏掉': 'Within 3% of the stop line, or a trend check has already failed', '你存的进场计划，用今天收盘价对照': 'Your saved plans, compared with today\'s close',
    '今天没有新信号。': 'No new signals today.', '最近没有还在走的信号。': 'No signals still running.', '最近没有刚离场的信号。': 'No recently exited signals.', '没有股票接近止损线。': 'No stocks near their stop line.',
    '已坏：': 'failed: ', '还没有止损线': 'no stop line yet', '进场': 'entry',
    // 页面文字
    '计算器': 'Calculator', '自选股': 'watchlist', '公告': 'filings', '新闻': 'news', '财报': 'financials', '年报': 'annual report', '成交': 'trading', 
    '更新': 'updated', '下载': 'download', '保存': 'Save', '取消': 'Cancel', '删除': 'Delete', '恢复默认': 'Reset', '恢复': 'Reset', '确定': 'OK', '关闭': 'Close', '搜索': 'Search', '添加': 'Add', '新建': 'New', '改名': 'Rename', '管理': 'Manage',
    '点一下': 'tap to ', '点开': 'Tap to open ', '自动保存': 'auto-saved', '已复制': 'copied', '复制': 'Copy',
    '股票': 'stocks', '信号': 'signal', '条件': 'rules', '指标': 'indicators', '模板': 'template', '名称': 'Name', '代码': 'Code',
    '仅供研究参考，不构成投资建议': 'For research only — not investment advice', '数据': 'Data', '行情数据来自公开渠道 (Yahoo Finance)，可能有延迟或错误，仅供个人研究参考，不构成投资建议。': 'Market data comes from public sources (Yahoo Finance) and may be delayed or wrong. For personal research only — not investment advice.',
    '本报告及其筛选策略、代码与分析方法版权所有': 'This report, its screening strategies, code and methods are copyright', '保留一切权利。未经书面授权，禁止复制、转载、二次分发或用于商业用途。': 'All rights reserved. No copying, republishing, redistribution or commercial use without written permission.',
    // 指标 / 图表
    '移动平均线': 'Moving Average', '指数移动平均': 'Exponential Moving Average', '抛物线转向': 'Parabolic SAR', '布林带带宽': 'Bollinger Bandwidth', '布林带': 'Bollinger Bands', '一目均衡表': 'Ichimoku Cloud',
    '超级趋势': '', '相对强弱指数': 'Relative Strength Index', '随机指标': 'Stochastic', '顺势指标': 'CCI', '威廉指标': 'Williams %R', '平均真实波幅': 'ATR', '成交量均线': 'Volume MA', '能量潮': 'On-Balance Volume', '滚动': 'Rolling ',
    '默认参数：': 'Defaults: ', '长度': 'length', '加速因子': 'accel', '最大值': 'max', '标准差倍数': 'stdev mult', '倍数': 'multiplier', '转换线': 'conversion', '基准线': 'base', '先行带': 'span', '位移': 'shift',
    '最近 N 根K线收盘价的简单平均。': 'Simple average of the last N closes.', '越近的K线权重越大的平均线。': 'Moving average that weights recent bars more.'
    ,'根K线': ' bars', 'K线': 'candles'
  };

  Object.assign(EXACT, {
    '转盈': 'turned profit', '转亏': 'turned loss', '转正': 'turned positive', '转负': 'turned negative', '需要资金': 'Capital needed',
    '：比较': ': compare', '，组合': ', combine', '；变量': '; variables', '；函数': '; functions', '： 比较': ': compare', '， 组合': ', combine', '； 变量': '; variables', '； 函数': '; functions', '例子：': 'Example:', ': 比较': ': compare', ', 组合': ', combine', '; 变量': '; variables', '; 函数': '; functions', '例子:': 'Example:', '还没有条件': 'No rules yet', '条件都有错，暂时算不了': 'Some rules have errors; cannot compute yet', '(当前)': '(current)'
  });
  Object.assign(EXACT, {
    '股票名称或代码，例如 PENTECH / 0457': 'Stock name or code, e.g. PENTECH / 0457', '先填股票名称或代码': 'Enter a stock name or code first'
  });
  Object.assign(EXACT, {
    '信号筛选 ▾': 'Signal filter ▾', '信号筛选 ▴': 'Signal filter ▴', '出现在': 'Within', '今天': 'Today', '3 天内': '3 days', '5 天内': '5 days', '选了几个': 'Match', '全部满足': 'All', '任一满足': 'Any',
    '多头信号': 'Bullish', '空头信号': 'Bearish', '多头': 'Bull', '空头': 'Bear', '范围': 'Range', 'SAR 转多': 'SAR flips bullish', 'Supertrend 转多': 'Supertrend flips bullish', '突破布林上轨': 'Breaks above Bollinger upper', 'EMA5 上穿 EMA20': 'EMA5 crosses above EMA20',
    '站上 EMA50': 'Closes above EMA50', 'MACD 金叉': 'MACD golden cross', 'RSI 上穿 30': 'RSI crosses above 30', '创 20 日新高': '20-day high', 'SAR 转空': 'SAR flips bearish', 'Supertrend 转空': 'Supertrend flips bearish',
    '跌破布林下轨': 'Breaks below Bollinger lower', 'EMA5 下穿 EMA20': 'EMA5 crosses below EMA20', '跌破 EMA50': 'Closes below EMA50', 'MACD 死叉': 'MACD death cross', 'RSI 下穿 70': 'RSI crosses below 70', '创 20 日新低': '20-day low', '计算中…': 'Calculating…'
  });
  Object.assign(PHRASES, {
    '市值': 'Mkt cap', '没有': 'no ', '标 = ': 'Target = ', '全部满足': 'all must hold', '进场：': 'Entry: ', '「SAR 转多」': '"SAR turns bullish"', 'K 线图': 'Candles', '空心K线图': 'Hollow candles', 'K线图': 'Candles', '均线金叉': 'MA golden cross', 'RSI 超卖回升': 'RSI oversold rebound', 'MACD 线上穿信号线': 'MACD line crosses above signal line',
    '内置策略': 'Built-in strategy', '后台信号': 'Strategy signal', '我的筛选器': 'My screener', '当前价格上穿': 'Price crosses above', '前 20 日最高': 'prior 20d high', '筛选器': 'Screener',
    '离场线': 'exit line', '不进': 'skip', '加起来': 'total', '回调后': 'after pullback', '收盘价进场': 'enter at close', '信号日': 'signal day', '信号当天': 'signal day',
    '自选的股票': 'your picks', '仓位': 'slots', '账户': 'account', '成交量': 'volume', '资金': 'capital'
  });

  Object.assign(PHRASES, {
    '达标': 'Met', '现价': 'Last', '进行中': 'In progress', '自设': 'Custom', '每股': 'per share ', '扣费用后': 'After fees', '单位': 'unit', '令吉': 'MYR', '营业收入': 'Revenue', '净利润': 'Net income', '净利率': 'Net margin', '经营现金流': 'Operating cash flow',
    '佣金': 'Brokerage', '结算费': 'Clearing fee', '印花税': 'Stamp duty', '买入价': 'Buy price', '卖出价': 'Sell price', '最低': 'Min ', '总成本': 'Total cost', '收益率': 'Return', '我的持仓': 'My holdings', '信号': 'Signals', '自己找的': 'self-picked',
    '股票代码或名称': 'Stock code or name', '股票': 'stocks', '代码或名称': 'code or name'
  });
  // 词组按长度从长到短，避免「价格」先吃掉「当前价格」
  var PHRASE_KEYS = Object.keys(PHRASES).sort(function (a, b) { return b.length - a.length; });

  function punct(s) {
    return s.replace(/，/g, ', ').replace(/。/g, '. ').replace(/：/g, ': ').replace(/；/g, '; ').replace(/、/g, ', ').replace(/（/g, ' (').replace(/）/g, ') ')
      .replace(/[「」]/g, '"').replace(/《|》/g, '"').replace(/？/g, '? ').replace(/！/g, '! ').replace(/＋/g, '+').replace(/  +/g, ' ');
  }
  function translate(str) {
    if (str.indexOf('\n') >= 0) return str.split('\n').map(translate).join('\n'); // 多行的提示：一行一行翻
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(str), lead = m[1], core = m[2].replace(/[\u00a0\u202f]/g, ' '), tail = m[3];
    if (!core) return str;
    if (Object.prototype.hasOwnProperty.call(EXACT, core)) return lead + EXACT[core] + tail;
    var out = core, i;
    for (i = 0; i < PATTERNS.length; i++) out = out.replace(PATTERNS[i][0], PATTERNS[i][1]);
    if (!ZH.test(out)) return lead + punct(out).trim() + tail;
    for (i = 0; i < PHRASE_KEYS.length; i++) if (out.indexOf(PHRASE_KEYS[i]) >= 0) out = out.split(PHRASE_KEYS[i]).join(PHRASES[PHRASE_KEYS[i]]);
    if ((out.match(/[\u3400-\u9fff]/g) || []).length >= 3) return str; // 没翻完的长句：保持中文原文 (不显示中英混杂)
    out = out.replace(/\s*\((Trailing Stop|Alert only|Trend Health Exit|EMA Break|Supertrend Hold|Max Entry Risk|Trailing Take Profit|Take Profit|Stop Loss|Prior High|Resistance|SAR Flip|EMA Cross-down|Time Stop|Pullback Red Candle)\)/g, '');
    return lead + punct(out).replace(/\s+([,.;])/g, '$1').trim() + tail;
  }
  // 「中文 <i>English</i>」这种中英并排的：英文模式只留英文那一半
  function pairedEnglish(n) {
    var sib = n.nextSibling;
    var up = n, hops = 0;
    while (!sib && up.parentNode && up.parentNode.childNodes.length === 1 && hops++ < 3) up = up.parentNode; // <span class="tip"><span class="tl">中文</span></span> <i>English</i>
    if (!sib && up !== n) {
      sib = up.parentNode && up.nextSibling;
      if (sib && sib.nodeType === 3 && !sib.nodeValue.trim()) sib = sib.nextSibling;
      if (sib && sib.nodeType === 1 && /^(I|SMALL)$/.test(sib.tagName) && !ZH.test(sib.textContent) && /[A-Za-z]{3,}/.test(sib.textContent)) { sib.style.display = 'none'; return false; }
      return false;
    }
    return !!(sib && sib.nodeType === 1 && /^(I|SMALL)$/.test(sib.tagName) && !ZH.test(sib.textContent) && /[A-Za-z]{3,}/.test(sib.textContent));
  }
  // 小标签里的单字 (图表上的进 / 损 / 标)：位置太窄，用缩写
  var CTX = [['.pt-row > i', { '进': 'IN', '损': 'SL', '标': 'TP' }], ['th', { '指标': 'Metric' }], ['.fold-kv > i', { '合计': 'Net P/L', '回撤': 'Max DD' }]];

  var written = typeof WeakMap === 'function' ? new WeakMap() : null;
  var ATTRS = ['title', 'aria-label', 'placeholder', 'data-tip', 'alt'];
  function textNode(n) {
    var v = n.nodeValue;
    if (!v || !ZH.test(v) || (written && written.get(n) === v)) return;
    var p = n.parentNode;
    if (!p || /^(SCRIPT|STYLE|TEXTAREA|PRE|CODE)$/.test(p.tagName) || (p.closest && p.closest('[data-keep]'))) return; // 语言按钮、strategy.json 的内容 (要贴进文件的) 不翻
    var out = null, i;
    for (i = 0; i < CTX.length && out === null; i++) if (p.matches && p.matches(CTX[i][0]) && CTX[i][1][v.trim()]) out = CTX[i][1][v.trim()];
    if (out === null) out = pairedEnglish(n) ? ' ' : translate(v);
    if (out !== v) { n.nodeValue = out; if (written) written.set(n, out); }
  }
  function attrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute && !el.hasAttribute('data-keep') && el.getAttribute(ATTRS[i]);
      if (v && ZH.test(v)) { var t = translate(v); if (t !== v) el.setAttribute(ATTRS[i], t); }
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (/^(SCRIPT|STYLE)$/.test(root.tagName)) return; attrs(root); }
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) textNode(n); else if (!/^(SCRIPT|STYLE)$/.test(n.tagName)) attrs(n); }
  }

  function missing() {
    var out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) if (ZH.test(n.nodeValue) && !/^(SCRIPT|STYLE|PRE|CODE)$/.test(n.parentNode.tagName) && !(n.parentNode.closest && n.parentNode.closest('[data-keep]'))) out.push(n.nodeValue.trim());
    document.querySelectorAll('[title],[aria-label],[placeholder],[data-tip]').forEach(function (el) { if (el.hasAttribute('data-keep')) return; ATTRS.forEach(function (a) { var v = el.getAttribute(a); if (v && ZH.test(v)) out.push(v); }); });
    return out.filter(function (x, i) { return out.indexOf(x) === i; });
  }


  // ---- 字体：中文 = 黑体 (苹方)；英文 = Times New Roman + 等宽数字 (见下面的 CSS)；英文 / 数字一直用等宽字 ----
  if (lang !== 'en') document.documentElement.style.setProperty('--font', 'ui-monospace, "SF Mono", "JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, "PingFang SC", "HarmonyOS Sans SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif, monospace');
  function button() {
    var bar = document.querySelector('.topbar');
    if (!bar || document.getElementById('lang-btn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'lang-btn'; b.className = 'lang-btn'; b.setAttribute('data-keep', '1');
    b.textContent = lang === 'en' ? '中文' : 'EN';
    b.setAttribute('aria-label', lang === 'en' ? '切换到中文' : 'Switch to English');
    b.addEventListener('click', function () {
      try { localStorage.setItem(KEY, lang === 'en' ? 'zh' : 'en'); } catch (e) { /* 存不了就只换这一次 */ }
      var u = location.search.replace(/([?&])lang=(en|zh)&?/, '$1').replace(/[?&]$/, '');
      location.replace(location.pathname + u + location.hash); // 重新载入：中文 = 原文，英文 = 重新翻译
    });
    bar.appendChild(b);
  }
  var st = document.createElement('style');
  st.textContent = '.lang-btn{flex:none;white-space:nowrap;font:inherit;font-size:var(--fs-sm);font-weight:600;padding:0.25rem 0.6rem;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--text-secondary);cursor:pointer}' +
    '.lang-btn:hover{color:var(--text-primary)}' +
    '@font-face{font-family:"Bursa Num";src:local("SF Mono"),local("Menlo"),local("Consolas"),local("DejaVu Sans Mono"),local("Courier New");unicode-range:U+0025,U+002B,U+0030-0039,U+003A}' +
    'html[data-lang="en"]{--font:"Bursa Num","Times New Roman",Times,"Liberation Serif","Noto Serif",serif}' +
    '#lang-btn{margin-left:auto}' +
    // 英文模式：中英并排的标签里，英文那一半原本是灰色小字，现在是主文字
    'html[data-lang="en"] :is(h4,h5,.cbt-x,.cbt-xh,.bt-head,.section,.subsection,.dash-h) > :is(i,small){font-style:normal;color:inherit;font-size:inherit;margin-left:0}' +
    'html[data-lang="en"] .cbt-x > span > i, html[data-lang="en"] .cbt-xh > i{font-style:normal;color:inherit;font-size:inherit;margin-left:0}';
  document.head.appendChild(st);

  function start() {
    button();
    if (lang !== 'en') return;
    document.documentElement.setAttribute('lang', 'en');
    document.documentElement.setAttribute('data-lang', 'en');
    document.title = translate(document.title);
    walk(document.body);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'childList') m.addedNodes.forEach(walk);
        else if (m.type === 'characterData') textNode(m.target);
        else if (m.type === 'attributes') attrs(m.target);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  // report.js 的「名词解释」：英文模式换成 i18n-gloss.js 里的英文条目 (整段，不是逐字翻)
  function glossary(list) {
    var en = window.__glossEn;
    if (lang !== 'en' || !en) return list;
    return list.map(function (g) { return en[g[0]] ? [g[0], en[g[0]][0], en[g[0]][1]] : g; });
  }
  window.BursaI18n = { lang: lang, translate: translate, missing: missing, walk: walk, glossary: glossary };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
