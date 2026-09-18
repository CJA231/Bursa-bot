import os
import json
import yfinance as yf
import pandas as pd
import pandas_ta as ta
import requests
from openai import OpenAI
import time
from datetime import datetime
from zoneinfo import ZoneInfo

# === 1. 配置区域 ===
# 默认自选股列表 (马股代码记得加 .KL)：在 data/watchlist.json 还没生成之前使用
DEFAULT_WATCHLIST = [
    {"symbol": "1155.KL", "name": "Maybank 马银行"},
    {"symbol": "1023.KL", "name": "Public Bank 大众银行"},
    {"symbol": "5183.KL", "name": "Petronas Chemicals 国油化学"},
    {"symbol": "5296.KL", "name": "MR DIY"},
    {"symbol": "0083.KL", "name": "Press Metal 齐力工业"},
    {"symbol": "5168.KL", "name": "Hartalega 哈达维格"},
]

WATCHLIST_PATH = os.path.join("data", "watchlist.json")


def load_watchlist():
    # 优先用 scripts/fetch_watchlist.py 生成的全市场清单，
    # 还没跑过那个脚本时 (或文件为空) 就退回默认的 6 支股票，确保 bot 不会因此坏掉
    try:
        with open(WATCHLIST_PATH, encoding="utf-8") as f:
            watchlist = json.load(f)
        if watchlist:
            return watchlist
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return DEFAULT_WATCHLIST


WATCHLIST = load_watchlist()

REPORT_PATH = os.path.join("docs", "index.html")
REPORT_URL = "https://cja231.github.io/Bursa-bot/"
CHART_HISTORY_DAYS = 90  # 图表显示最近约 90 个交易日
MIN_DAILY_VOLUME = 500_000  # 流动性门槛：日成交量低于此值的股票不予展示
MYT = ZoneInfo("Asia/Kuala_Lumpur")

DEEPSEEK_KEY = os.environ.get("DEEPSEEK_KEY")
NTFY_TOPIC = os.environ.get("NTFY_TOPIC")  # 可选：手机推送通知 (ntfy.sh)，不设置则跳过推送
FORCE_RUN = os.environ.get("FORCE_RUN", "").lower() == "true"  # 手动测试用：跳过交易日检查

if not DEEPSEEK_KEY:
    raise SystemExit(
        "缺少环境变量: DEEPSEEK_KEY。"
        " 请在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加对应的 Secret。"
    )

# === 2. 初始化 DeepSeek 客户端 ===
# 关键修改点：base_url 必须是 deepseek 的地址
client = OpenAI(
    api_key=DEEPSEEK_KEY,               # 从 GitHub Secrets 读取密码
    base_url="https://api.deepseek.com" # 👈 这里指定连接 DeepSeek
)

# === T3 形态 ===
# 过去 2~5 天前某天放量(成交量 > 前20日均量)创出当天最高价 High1，
# 之后到今天为止每天最高价都低于 High1 (纯回调，没有提前破位)，
# 且今天收盘价突破 High1 → 判定命中
def detect_t3_pattern(df):
    if len(df) < 26:
        return False

    vol_avg20 = df["Volume"].rolling(20).mean().shift(1)
    today_close = df["Close"].iloc[-1]
    last_idx = len(df) - 1

    for offset in range(2, 6):  # T1 = 今天往前 2~5 天
        t1_idx = last_idx - offset
        if t1_idx < 20:
            continue

        t1_volume = df["Volume"].iloc[t1_idx]
        t1_vol_avg = vol_avg20.iloc[t1_idx]
        if pd.isna(t1_vol_avg) or t1_volume <= t1_vol_avg:
            continue

        high1 = df["High"].iloc[t1_idx]
        pullback_highs = df["High"].iloc[t1_idx + 1 : last_idx]
        if (pullback_highs >= high1).any():
            continue  # 中途已经提前破位，不算纯回调

        if today_close > high1:
            return True

    return False

# === 3. 获取数据并计算指标 ===
def get_stock_data(symbol):
    print(f"正在分析: {symbol} ...")
    try:
        stock = yf.Ticker(symbol)
        # 获取过去 6 个月的数据以计算均线
        df = stock.history(period="6mo")

        if len(df) < 50:
            print(f"数据不足: {symbol}")
            return None

        # 计算技术指标 (RSI、均线、EMA20、MACD、Parabolic SAR)
        df.ta.rsi(length=14, append=True)
        df.ta.sma(length=50, append=True)
        df.ta.ema(length=20, append=True)
        df.ta.macd(append=True)
        df.ta.psar(append=True)

        # PSAR 在多头/空头趋势下分别写入不同的列，合并成单一数值方便比较
        psar_long_col = next(c for c in df.columns if c.startswith("PSARl"))
        psar_short_col = next(c for c in df.columns if c.startswith("PSARs"))
        df["PSAR"] = df[psar_long_col].combine_first(df[psar_short_col])

        #以此获取最新一天的数值
        latest = df.iloc[-1]
        prev = df.iloc[-2]

        # 供 K 线图使用的历史数据 (最近 CHART_HISTORY_DAYS 个交易日)
        chart_df = df.tail(CHART_HISTORY_DAYS)
        candles = [
            {
                "time": idx.strftime("%Y-%m-%d"),
                "open": round(row["Open"], 3),
                "high": round(row["High"], 3),
                "low": round(row["Low"], 3),
                "close": round(row["Close"], 3),
            }
            for idx, row in chart_df.iterrows()
        ]
        ema20 = [
            {"time": idx.strftime("%Y-%m-%d"), "value": round(row["EMA_20"], 3)}
            for idx, row in chart_df.iterrows()
            if pd.notna(row["EMA_20"])
        ]

        return {
            "symbol": symbol,
            "close": round(latest['Close'], 3),
            "rsi": round(latest['RSI_14'], 2),
            "sma50": round(latest['SMA_50'], 3),
            "prev_close": prev['Close'],
            "prev_sma50": prev['SMA_50'],
            "ema20_latest": round(latest['EMA_20'], 3),
            "sar_bullish_now": latest['Close'] > latest['PSAR'],
            "sar_bullish_prev": prev['Close'] > prev['PSAR'],
            "t3_pattern": detect_t3_pattern(df),
            "volume": int(latest['Volume']),
            "candles": candles,
            "ema20": ema20,
        }
    except Exception as e:
        print(f"获取失败 {symbol}: {e}")
        return None

# === 4. 筛选策略 ===
# 四个条件同时满足才算命中 (成交量 > 500k 已经在 main() 里作为门槛提前筛掉，这里不用重复判断):
#   - EMA20 < 现价 (价格站上 EMA20)
#   - SAR < 现价 (SAR 在价格下方，多头状态)
#   - T3 形态 (放量创高后回调，今天再次突破)
def check_strategy(data):
    """
    在这里修改你的筛选条件
    返回: (是否符合, 原因)
    """
    if not (data['close'] > data['ema20_latest']):
        return False, None

    if not data['sar_bullish_now']:
        return False, None

    if not data['t3_pattern']:
        return False, None

    return True, "🎯 EMA20多头 + SAR多头 + T3形态突破"

# === 5. 呼叫 DeepSeek 进行分析 ===
def ask_deepseek(data, reason):
    prompt = f"""
    你是专业的马来西亚股市分析师。
    股票代码: {data['symbol']}
    触发信号: {reason}

    基本数据:
    - 现价: RM {data['close']}
    - RSI (14): {data['rsi']}
    - 50日均线: RM {data['sma50']}

    请用简短的中文 (50字以内)：
    1. 评价这个信号的可靠性。
    2. 给出“买入/观望/卖出”建议。
    """

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",  # 👈 指定使用 DeepSeek V3 模型
            messages=[
                {"role": "system", "content": "你是一个严谨的金融助手。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1, # 让回答更稳定
            max_tokens=100
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"DeepSeek 分析出错: {e}"

# === 6. 生成 HTML 报告 (只有命中信号的股票画 K 线图，其余用表格) ===
def build_html_report(stocks):
    now = datetime.now(MYT).strftime("%Y-%m-%d %H:%M")

    cards = []
    chart_payload = {}
    table_rows = []
    no_data_count = 0

    for s in stocks:
        code = s["symbol"].split(".")[0]
        data = s["data"]

        if data is None:
            no_data_count += 1
            continue

        if not s["matched"]:
            sar_label = "多头" if data["sar_bullish_now"] else "空头"
            table_rows.append(f"""<tr>
                <td>{code}</td>
                <td>{s['name']}</td>
                <td data-value="{data['close']}">{data['close']}</td>
                <td data-value="{data['rsi']}">{data['rsi']}</td>
                <td data-value="{data['ema20_latest']}">{data['ema20_latest']}</td>
                <td data-value="{data['sma50']}">{data['sma50']}</td>
                <td>{sar_label}</td>
                <td data-value="{data['volume']}">{data['volume']:,}</td>
            </tr>""")
            continue

        chart_id = f"chart-{code}"
        chart_payload[chart_id] = {"candles": data["candles"], "ema20": data["ema20"]}

        cards.append(f"""<section class="card">
            <div class="card-head">
                <h2>{s['name']} <span class="code">{code}</span></h2>
                <div class="stats">
                    <span>现价 <b>{data['close']}</b></span>
                    <span>RSI(14) <b>{data['rsi']}</b></span>
                    <span>50日均线 <b>{data['sma50']}</b></span>
                </div>
            </div>
            <div id="{chart_id}" class="chart"></div>
            <div class="legend">
                <span class="dot up"></span>上涨
                <span class="dot down"></span>下跌
                <span class="dot ema"></span>EMA20
            </div>
            <div class="signal">
                <strong>🚨 {s['reason']}</strong>
                <p>{s['ai_comment']}</p>
            </div>
        </section>""")

    no_data_note = f"<p class='no-data'>另有 {no_data_count} 支股票数据不足，未列入。</p>" if no_data_count else ""

    return f"""<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>马股自动分析报告</title>
<script src="vendor/lightweight-charts.js"></script>
<style>
  /* 🎨 图表配色：想换颜色直接改这里的 hex 值即可 (--up / --down / --ema) */
  :root {{
    color-scheme: light;
    --page: #f9f9f7;
    --surface: #fcfcfb;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --muted: #898781;
    --gridline: #e1e0d9;
    --border: rgba(11,11,11,0.10);
    --up: #0ca30c;      /* 阳线(上涨) 边框+影线颜色，空心 */
    --down: #d03b3b;    /* 阴线(下跌) 实心颜色 */
    --ema: #4a3aa7;     /* EMA20 均线颜色 */
  }}
  @media (prefers-color-scheme: dark) {{
    :root {{
      color-scheme: dark;
      --page: #0d0d0d;
      --surface: #1a1a19;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --muted: #898781;
      --gridline: #2c2c2a;
      --border: rgba(255,255,255,0.10);
      --up: #0ca30c;
      --down: #e66767;
      --ema: #9085e9;
    }}
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0;
    padding: 1.5rem;
    background: var(--page);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }}
  h1 {{ margin: 0 0 0.25rem; font-size: 1.5rem; }}
  .updated {{ color: var(--text-secondary); margin: 0 0 1.5rem; }}
  .grid {{
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 1rem;
  }}
  .card {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }}
  .card-head {{
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }}
  h2 {{ margin: 0; font-size: 1.05rem; }}
  .code {{ color: var(--muted); font-weight: normal; font-size: 0.9rem; }}
  .stats {{ display: flex; gap: 0.75rem; color: var(--text-secondary); font-size: 0.85rem; flex-wrap: wrap; }}
  .stats b {{ color: var(--text-primary); }}
  .chart {{ width: 100%; height: 220px; }}
  .legend {{ display: flex; gap: 1rem; align-items: center; color: var(--text-secondary); font-size: 0.8rem; margin-top: 0.5rem; }}
  .dot {{ display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 0.25rem; vertical-align: middle; }}
  .dot.up {{ background: transparent; border: 2px solid var(--up); }}
  .dot.down {{ background: var(--down); }}
  .dot.ema {{ background: var(--ema); }}
  .signal {{
    margin-top: 0.75rem;
    padding: 0.6rem 0.75rem;
    border-left: 3px solid var(--ema);
    background: color-mix(in srgb, var(--ema) 10%, transparent);
    border-radius: 4px;
    font-size: 0.9rem;
  }}
  .signal p {{ margin: 0.35rem 0 0; color: var(--text-secondary); }}
  .no-data {{ color: var(--muted); }}
  h2.section {{ font-size: 1.1rem; margin: 2rem 0 1rem; }}
  .table-wrap {{ overflow-x: auto; }}
  table.data-table {{
    width: 100%;
    border-collapse: collapse;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.85rem;
  }}
  table.data-table th, table.data-table td {{
    padding: 0.5rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }}
  table.data-table th {{
    cursor: pointer;
    color: var(--text-secondary);
    user-select: none;
  }}
  table.data-table th:hover {{ color: var(--text-primary); }}
  table.data-table .arrow {{ display: inline-block; width: 0.9em; color: var(--text-primary); }}
  table.data-table tbody tr:hover {{ background: var(--page); }}
</style>
</head>
<body>
<h1>📢 马股自动分析报告</h1>
<p class="updated">更新时间: {now} (MYT)</p>

<h2 class="section">🚨 信号 ({len(cards)})</h2>
<div class="grid">
{''.join(cards) if cards else "<p class='no-data'>今日无符合条件的股票。</p>"}
</div>

<h2 class="section">📋 其余股票 ({len(table_rows)})</h2>
<div class="table-wrap">
<table class="data-table" id="watchlist-table">
  <thead>
    <tr>
      <th data-type="text">代码 <span class="arrow"></span></th>
      <th data-type="text">名称 <span class="arrow"></span></th>
      <th data-type="num">现价 <span class="arrow"></span></th>
      <th data-type="num">RSI <span class="arrow"></span></th>
      <th data-type="num">EMA20 <span class="arrow"></span></th>
      <th data-type="num">50日均线 <span class="arrow"></span></th>
      <th data-type="text">SAR <span class="arrow"></span></th>
      <th data-type="num">成交量 <span class="arrow"></span></th>
    </tr>
  </thead>
  <tbody>
{''.join(table_rows)}
  </tbody>
</table>
</div>
{no_data_note}
<script id="chart-data" type="application/json">{json.dumps(chart_payload)}</script>
<script>
(function () {{
  var data = JSON.parse(document.getElementById('chart-data').textContent);
  var styles = getComputedStyle(document.documentElement);
  var colors = {{
    text: styles.getPropertyValue('--text-secondary').trim(),
    grid: styles.getPropertyValue('--gridline').trim(),
    up: styles.getPropertyValue('--up').trim(),
    down: styles.getPropertyValue('--down').trim(),
    ema: styles.getPropertyValue('--ema').trim()
  }};

  function renderChart(chartId) {{
    var el = document.getElementById(chartId);
    if (!el || !window.LightweightCharts || el.dataset.rendered) return;
    el.dataset.rendered = '1';

    var chart = LightweightCharts.createChart(el, {{
      width: el.clientWidth,
      height: 220,
      layout: {{ background: {{ color: 'transparent' }}, textColor: colors.text }},
      grid: {{
        vertLines: {{ color: colors.grid }},
        horzLines: {{ color: colors.grid }}
      }},
      rightPriceScale: {{ borderColor: colors.grid }},
      timeScale: {{ borderColor: colors.grid }},
      crosshair: {{ mode: LightweightCharts.CrosshairMode.Normal }}
    }});

    // 空心K线: 上涨只描边(空心)，下跌实心填满
    var candleSeries = chart.addCandlestickSeries({{
      upColor: 'rgba(0, 0, 0, 0)',
      downColor: colors.down,
      borderUpColor: colors.up,
      borderDownColor: colors.down,
      wickUpColor: colors.up,
      wickDownColor: colors.down,
      borderVisible: true
    }});
    candleSeries.setData(data[chartId].candles);

    var emaSeries = chart.addLineSeries({{
      color: colors.ema,
      lineWidth: 2,
      priceLineVisible: false
    }});
    emaSeries.setData(data[chartId].ema20);

    chart.timeScale().fitContent();

    new ResizeObserver(function (entries) {{
      chart.applyOptions({{ width: entries[0].contentRect.width }});
    }}).observe(el);
  }}

  // 懒加载: 图表滚动到快进入可视范围才真正渲染，避免一次性创建几百个图表卡住页面
  var lazyObserver = new IntersectionObserver(function (entries) {{
    entries.forEach(function (entry) {{
      if (entry.isIntersecting) {{
        renderChart(entry.target.id);
        lazyObserver.unobserve(entry.target);
      }}
    }});
  }}, {{ rootMargin: '200px 0px' }});

  Object.keys(data).forEach(function (chartId) {{
    var el = document.getElementById(chartId);
    if (el) lazyObserver.observe(el);
  }});

  // 点表头排序 (带升/降序箭头)
  var table = document.getElementById('watchlist-table');
  if (table) {{
    var tbody = table.querySelector('tbody');
    var ths = Array.from(table.querySelectorAll('th'));
    ths.forEach(function (th, idx) {{
      var asc = true;
      th.addEventListener('click', function () {{
        var rows = Array.from(tbody.querySelectorAll('tr'));
        var type = th.dataset.type;
        rows.sort(function (a, b) {{
          var ac = a.children[idx], bc = b.children[idx];
          var av = ac.dataset.value !== undefined ? ac.dataset.value : ac.textContent;
          var bv = bc.dataset.value !== undefined ? bc.dataset.value : bc.textContent;
          if (type === 'num') {{ av = parseFloat(av); bv = parseFloat(bv); }}
          if (av < bv) return asc ? -1 : 1;
          if (av > bv) return asc ? 1 : -1;
          return 0;
        }});
        rows.forEach(function (r) {{ tbody.appendChild(r); }});
        ths.forEach(function (other) {{
          var arrow = other.querySelector('.arrow');
          if (arrow) arrow.textContent = '';
        }});
        var currentArrow = th.querySelector('.arrow');
        if (currentArrow) currentArrow.textContent = asc ? '▲' : '▼';
        asc = !asc;
      }});
    }});
  }}
}})();
</script>
</body>
</html>"""

# === 6.5 手机推送通知 (ntfy.sh) ===
def send_notification(hits):
    if not NTFY_TOPIC:
        print("未设置 NTFY_TOPIC，跳过手机推送通知。")
        return

    message = f"发现 {hits} 个信号，点击查看完整报告" if hits else "今日扫描完成，暂无符合条件的股票"
    try:
        requests.post(
            "https://ntfy.sh/",
            json={
                "topic": NTFY_TOPIC,
                "title": "📢 马股报告已更新",
                "message": message,
                "click": REPORT_URL,
                "tags": ["chart_with_upwards_trend"],
            },
            timeout=10,
        )
    except Exception as e:
        print(f"推送通知失败: {e}")

# 判断今天是否为交易日的参考股：固定用流动性极佳的蓝筹股，跟 WATCHLIST 具体内容无关
# (非交易日/公共假期时 yfinance 不会有当天的数据)
TRADING_DAY_REFERENCE = "1155.KL"


def is_trading_day(today_myt):
    ref_data = get_stock_data(TRADING_DAY_REFERENCE)
    return bool(ref_data and ref_data["candles"] and ref_data["candles"][-1]["time"] == today_myt)

# === 主程序 ===
def main():
    today_myt = datetime.now(MYT).strftime("%Y-%m-%d")
    print(f"开始扫描 ({today_myt})...")

    if FORCE_RUN:
        print("⚠️ FORCE_RUN 模式：跳过交易日检查，直接用最新可用数据扫描 (用于测试)。")
    elif not is_trading_day(today_myt):
        print(f"今天 ({today_myt}) 非交易日或数据尚未更新，跳过本次扫描。")
        return

    stocks = []
    for item in WATCHLIST:
        symbol = item["symbol"]
        data = get_stock_data(symbol)

        # 流动性门槛: 成交量太低的股票直接跳过，不放进报告
        if data and data["volume"] < MIN_DAILY_VOLUME:
            print(f"⏭️ 成交量不足 ({data['volume']:,} < {MIN_DAILY_VOLUME:,}): {symbol}")
            continue

        matched, reason, ai_comment = False, None, None
        if data:
            matched, reason = check_strategy(data)
            if matched:
                ai_comment = ask_deepseek(data, reason)
                print(f"✅ 找到机会: {symbol}")
                # 为了防止 DeepSeek 限制频率，稍微停顿 1 秒
                time.sleep(1)

        stocks.append({
            "symbol": symbol,
            "name": item["name"],
            "data": data,
            "matched": matched,
            "reason": reason,
            "ai_comment": ai_comment,
        })

    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(build_html_report(stocks))

    hits = sum(1 for s in stocks if s["matched"])
    if hits:
        print(f"报告已生成，共 {hits} 个信号")
    else:
        print("今日无符合条件的股票，报告已更新")

    send_notification(hits)

if __name__ == "__main__":
    main()
