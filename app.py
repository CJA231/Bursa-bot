"""
马来西亚 & 美国股票追踪器
Bursa + Wall Street Dashboard
"""
import streamlit as st
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
from datetime import datetime
import time

from stock_data import (
    MY_WATCHLIST, US_WATCHLIST, INDICES,
    get_stock_info, get_price_history, get_news,
    get_financials, get_dividends, get_market_indices,
    scan_signals, symbol_to_tv, fmt_large, fmt_pct,
)

# ============================================================
# 页面配置
# ============================================================
st.set_page_config(
    page_title="Bursa & Wall Street Tracker",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ============================================================
# 自定义 CSS
# ============================================================
st.markdown("""
<style>
    .metric-card {
        background: #1e2130;
        border-radius: 8px;
        padding: 12px 16px;
        margin: 4px 0;
    }
    .up { color: #00e676; }
    .down { color: #ff5252; }
    .neutral { color: #90a4ae; }
    .section-header {
        font-size: 1.1rem;
        font-weight: 600;
        color: #e0e0e0;
        border-left: 3px solid #1565c0;
        padding-left: 10px;
        margin: 16px 0 8px 0;
    }
    .news-card {
        background: #1e2130;
        border-radius: 6px;
        padding: 10px 14px;
        margin: 6px 0;
        border-left: 3px solid #1565c0;
    }
    .signal-row {
        background: #1a1f2e;
        border-radius: 6px;
        padding: 8px 12px;
        margin: 4px 0;
    }
    div[data-testid="stMetric"] label { font-size: 0.78rem; color: #90a4ae; }
</style>
""", unsafe_allow_html=True)

# ============================================================
# Session State 初始化
# ============================================================
if "my_stocks" not in st.session_state:
    st.session_state.my_stocks = dict(MY_WATCHLIST)
if "us_stocks" not in st.session_state:
    st.session_state.us_stocks = dict(US_WATCHLIST)
if "selected_symbol" not in st.session_state:
    st.session_state.selected_symbol = "1155.KL"

# ============================================================
# 侧边栏
# ============================================================
with st.sidebar:
    st.title("📈 股票追踪器")
    st.caption("Bursa Malaysia · Wall Street")
    st.divider()

    # --- 市场选择 ---
    market = st.radio("市场", ["🇲🇾 马来西亚", "🇺🇸 美国", "🔍 信号扫描"], label_visibility="collapsed")
    st.divider()

    # --- 自选股列表 ---
    if "马来西亚" in market:
        active_list = st.session_state.my_stocks
        currency_label = "RM"
        placeholder_ex = "例如: 5318.KL"
    elif "美国" in market:
        active_list = st.session_state.us_stocks
        currency_label = "USD"
        placeholder_ex = "例如: TSLA"
    else:
        active_list = {}

    if active_list:
        st.markdown("**自选股**")
        for sym, name in active_list.items():
            short_name = name.split()[0] if name else sym
            if st.button(f"{sym}  {short_name}", key=f"btn_{sym}", use_container_width=True):
                st.session_state.selected_symbol = sym

    # --- 添加股票 ---
    if "扫描" not in market:
        st.divider()
        st.markdown("**添加股票**")
        new_sym = st.text_input("股票代码", placeholder=placeholder_ex, label_visibility="collapsed")
        col_add, col_rm = st.columns(2)
        with col_add:
            if st.button("添加", use_container_width=True) and new_sym:
                sym_clean = new_sym.strip().upper()
                info = get_stock_info(sym_clean)
                if "error" not in info:
                    if "马来西亚" in market:
                        st.session_state.my_stocks[sym_clean] = info.get("name", sym_clean)
                    else:
                        st.session_state.us_stocks[sym_clean] = info.get("name", sym_clean)
                    st.session_state.selected_symbol = sym_clean
                    st.rerun()
                else:
                    st.error("找不到该股票")
        with col_rm:
            if st.button("移除", use_container_width=True) and st.session_state.selected_symbol in active_list:
                del active_list[st.session_state.selected_symbol]
                st.rerun()

    st.divider()
    st.caption(f"数据来源: Yahoo Finance · 更新时间: {datetime.now().strftime('%H:%M')}")

# ============================================================
# 辅助：绘制蜡烛图 + 技术指标
# ============================================================
def plot_price_chart(df: pd.DataFrame, symbol: str, period: str):
    """主价格图 (蜡烛 + MA + 布林带)"""
    fig = make_subplots(
        rows=3, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.04,
        row_heights=[0.6, 0.2, 0.2],
        subplot_titles=["价格", "成交量", "RSI (14)"]
    )

    # --- 蜡烛图 ---
    fig.add_trace(go.Candlestick(
        x=df.index, open=df["Open"], high=df["High"],
        low=df["Low"],  close=df["Close"],
        name="价格", increasing_line_color="#00e676", decreasing_line_color="#ff5252",
        showlegend=False,
    ), row=1, col=1)

    # --- MA 均线 ---
    for col_name, label, color in [
        ("SMA_20", "MA20", "#42a5f5"),
        ("SMA_50", "MA50", "#ffca28"),
        ("SMA_200", "MA200", "#ef5350"),
    ]:
        if col_name in df.columns:
            fig.add_trace(go.Scatter(
                x=df.index, y=df[col_name], name=label,
                line=dict(color=color, width=1.2), opacity=0.85,
            ), row=1, col=1)

    # --- 布林带 ---
    for bb_col, bb_name in [("BBU_20_2.0", "BB上"), ("BBL_20_2.0", "BB下")]:
        if bb_col in df.columns:
            fig.add_trace(go.Scatter(
                x=df.index, y=df[bb_col], name=bb_name,
                line=dict(color="#b0bec5", width=1, dash="dot"), opacity=0.5,
            ), row=1, col=1)

    # --- 成交量 ---
    colors = ["#00e676" if c >= o else "#ff5252"
              for c, o in zip(df["Close"], df["Open"])]
    fig.add_trace(go.Bar(
        x=df.index, y=df["Volume"], name="成交量",
        marker_color=colors, showlegend=False,
    ), row=2, col=1)

    # --- RSI ---
    if "RSI_14" in df.columns:
        fig.add_trace(go.Scatter(
            x=df.index, y=df["RSI_14"], name="RSI",
            line=dict(color="#ce93d8", width=1.5), showlegend=False,
        ), row=3, col=1)
        for level, color, dash in [(70, "#ff5252", "dash"), (30, "#00e676", "dash"), (50, "#546e7a", "dot")]:
            fig.add_hline(y=level, line_color=color, line_dash=dash, line_width=1, row=3, col=1)

    fig.update_layout(
        template="plotly_dark",
        height=580,
        margin=dict(l=0, r=0, t=30, b=0),
        legend=dict(orientation="h", y=1.02, x=0),
        xaxis_rangeslider_visible=False,
    )
    fig.update_yaxes(gridcolor="#2a2f45")
    return fig


def plot_macd(df: pd.DataFrame):
    """MACD 图"""
    fig = go.Figure()
    if "MACD_12_26_9" not in df.columns:
        return None
    fig.add_trace(go.Scatter(x=df.index, y=df["MACD_12_26_9"],
                             name="MACD", line=dict(color="#42a5f5", width=1.5)))
    fig.add_trace(go.Scatter(x=df.index, y=df["MACDs_12_26_9"],
                             name="Signal", line=dict(color="#ffca28", width=1.5)))
    hist = df["MACDh_12_26_9"]
    fig.add_trace(go.Bar(
        x=df.index, y=hist, name="Histogram",
        marker_color=["#00e676" if v >= 0 else "#ff5252" for v in hist],
    ))
    fig.update_layout(template="plotly_dark", height=220,
                      margin=dict(l=0, r=0, t=25, b=0), title="MACD (12,26,9)")
    return fig


def tv_widget(symbol: str, height: int = 500) -> str:
    """TradingView 嵌入式高级图表 HTML"""
    tv_sym = symbol_to_tv(symbol)
    return f"""
    <div class="tradingview-widget-container" style="height:{height}px;">
      <div id="tv_chart_{symbol.replace('.','_')}" style="height:{height}px;"></div>
      <script type="text/javascript" src="https://s3.tradingview.com/tv.js"></script>
      <script type="text/javascript">
      new TradingView.widget({{
        "autosize": true,
        "symbol": "{tv_sym}",
        "interval": "D",
        "timezone": "Asia/Kuala_Lumpur",
        "theme": "dark",
        "style": "1",
        "locale": "zh_CN",
        "toolbar_bg": "#1e2130",
        "enable_publishing": false,
        "withdateranges": true,
        "allow_symbol_change": true,
        "studies": ["RSI@tv-basicstudies","MACD@tv-basicstudies","Volume@tv-basicstudies"],
        "container_id": "tv_chart_{symbol.replace('.','_')}"
      }});
      </script>
    </div>
    """


# ============================================================
# 格式化辅助
# ============================================================
def arrow(val):
    if val is None: return ""
    return "▲" if val > 0 else "▼"

def color_class(val):
    if val is None: return "neutral"
    return "up" if val > 0 else "down"


# ============================================================
# 主内容区域
# ============================================================

if "扫描" in market:
    # ========================================================
    # 信号扫描页
    # ========================================================
    st.title("🔍 技术信号扫描器")
    st.caption("扫描马股 + 美股自选列表中的技术信号")

    col_left, col_right = st.columns([1, 3])
    with col_left:
        scan_market = st.radio("扫描范围", ["马股", "美股", "两者"])
        run_scan = st.button("开始扫描", type="primary", use_container_width=True)

    if run_scan:
        symbols_to_scan = []
        if scan_market in ["马股", "两者"]:
            symbols_to_scan += list(st.session_state.my_stocks.keys())
        if scan_market in ["美股", "两者"]:
            symbols_to_scan += list(st.session_state.us_stocks.keys())

        with st.spinner(f"正在扫描 {len(symbols_to_scan)} 只股票..."):
            signals = scan_signals(symbols_to_scan)

        if signals:
            st.success(f"发现 {len(signals)} 只触发信号的股票")
            for row in signals:
                is_my = row["symbol"].endswith(".KL")
                currency = "RM" if is_my else "USD"
                rsi_str = f"RSI: {row['rsi']:.0f}" if row['rsi'] else ""
                st.markdown(f"""
                <div class="signal-row">
                    <b>{row['symbol']}</b> &nbsp;|&nbsp;
                    {currency} {row['price']:.3f} &nbsp;|&nbsp;
                    {rsi_str} &nbsp;|&nbsp; {row['signals']}
                </div>
                """, unsafe_allow_html=True)
        else:
            st.info("当前自选股中暂无明显技术信号")

else:
    # ========================================================
    # 股票详情页 (马股 / 美股)
    # ========================================================
    symbol = st.session_state.selected_symbol
    is_my = symbol.endswith(".KL")
    currency = "RM" if is_my else "USD"

    # --- 顶部：股票标题 + 实时价格 ---
    with st.spinner("加载数据..."):
        info = get_stock_info(symbol)

    if "error" in info:
        st.error(f"无法获取 {symbol} 数据: {info['error']}")
        st.stop()

    price = info.get("price") or 0
    change = info.get("change") or 0
    change_pct = info.get("change_pct") or 0
    c_cls = color_class(change)

    col_title, col_price, col_chg = st.columns([3, 1.5, 1.5])
    with col_title:
        st.markdown(f"### {info.get('name', symbol)}")
        st.caption(f"{symbol}  ·  {info.get('sector', '')}  ·  {info.get('industry', '')}")
    with col_price:
        st.metric("现价", f"{currency} {price:.3f}")
    with col_chg:
        st.metric("涨跌", f"{change:+.3f}", f"{change_pct:+.2f}%")

    st.divider()

    # --- 主区域 Tabs ---
    tab_overview, tab_tv, tab_chart, tab_fund, tab_news = st.tabs([
        "📊 概览", "📺 TradingView", "📉 技术分析", "💼 基本面", "📰 新闻"
    ])

    # --------------------------------------------------------
    # Tab 1: 概览
    # --------------------------------------------------------
    with tab_overview:
        # 指数行情
        st.markdown('<div class="section-header">主要指数</div>', unsafe_allow_html=True)
        idx_data = get_market_indices()
        idx_cols = st.columns(len(idx_data)) if idx_data else []
        for i, (name, d) in enumerate(idx_data.items()):
            with idx_cols[i]:
                st.metric(
                    name,
                    f"{d['price']:,.2f}",
                    f"{d['change_pct']:+.2f}%",
                    delta_color="normal",
                )

        st.divider()

        # 当前股票关键数据
        st.markdown('<div class="section-header">价格信息</div>', unsafe_allow_html=True)
        r1c1, r1c2, r1c3, r1c4, r1c5 = st.columns(5)
        r1c1.metric("今日开盘", f"{currency} {info.get('open', 0):.3f}" if info.get('open') else "N/A")
        r1c2.metric("今日最高", f"{currency} {info.get('day_high', 0):.3f}" if info.get('day_high') else "N/A")
        r1c3.metric("今日最低", f"{currency} {info.get('day_low', 0):.3f}" if info.get('day_low') else "N/A")
        r1c4.metric("52周最高", f"{currency} {info.get('week52_high', 0):.3f}" if info.get('week52_high') else "N/A")
        r1c5.metric("52周最低", f"{currency} {info.get('week52_low', 0):.3f}" if info.get('week52_low') else "N/A")

        r2c1, r2c2, r2c3, r2c4, r2c5 = st.columns(5)
        vol = info.get("volume")
        avg_vol = info.get("avg_volume")
        r2c1.metric("成交量", fmt_large(vol))
        r2c2.metric("均量(30日)", fmt_large(avg_vol))
        r2c3.metric("市值", fmt_large(info.get("market_cap")))
        r2c4.metric("Beta (β)", f"{info.get('beta', 0):.2f}" if info.get("beta") else "N/A")
        r2c5.metric("目标价", f"{currency} {info.get('target_price', 0):.3f}" if info.get("target_price") else "N/A")

        # 分析师评级
        rec = info.get("recommendation", "")
        num_ana = info.get("num_analysts")
        if rec:
            rec_map = {
                "strong_buy": ("强力买入", "🟢"),
                "buy": ("买入", "🟩"),
                "hold": ("持有", "🟡"),
                "underperform": ("弱于大市", "🟠"),
                "sell": ("卖出", "🔴"),
            }
            rec_label, rec_icon = rec_map.get(rec.lower(), (rec, "⚪"))
            ana_count = f"（{num_ana} 位分析师）" if num_ana else ""
            st.info(f"**分析师建议:** {rec_icon} {rec_label} {ana_count}")

        # 自选股对比表
        st.divider()
        st.markdown('<div class="section-header">自选股快览</div>', unsafe_allow_html=True)
        watchlist_symbols = (
            list(st.session_state.my_stocks.keys()) if is_my
            else list(st.session_state.us_stocks.keys())
        )
        overview_data = []
        with st.spinner("加载自选股数据..."):
            for sym in watchlist_symbols:
                d = get_stock_info(sym)
                if "error" not in d:
                    overview_data.append({
                        "代码": sym,
                        "名称": (d.get("name") or sym)[:18],
                        "现价": f"{d.get('currency','')}{d.get('price', 0):.3f}" if d.get("price") else "N/A",
                        "涨跌%": f"{d.get('change_pct', 0):+.2f}%" if d.get("change_pct") is not None else "N/A",
                        "市值": fmt_large(d.get("market_cap")),
                        "P/E": f"{d.get('pe_ttm', 0):.1f}" if d.get("pe_ttm") else "N/A",
                        "股息率": fmt_pct(d.get("div_yield")),
                    })
        if overview_data:
            df_ov = pd.DataFrame(overview_data)
            st.dataframe(df_ov, use_container_width=True, hide_index=True)

    # --------------------------------------------------------
    # Tab 2: TradingView 图表
    # --------------------------------------------------------
    with tab_tv:
        st.markdown(f'<div class="section-header">TradingView 图表 — {symbol}</div>', unsafe_allow_html=True)
        st.caption("支持切换时间周期、画线、多种指标，与 TradingView 网站功能一致")
        import streamlit.components.v1 as components
        components.html(tv_widget(symbol, height=560), height=570)

    # --------------------------------------------------------
    # Tab 3: 技术分析（Plotly 图表）
    # --------------------------------------------------------
    with tab_chart:
        period_map = {"1个月": "1mo", "3个月": "3mo", "6个月": "6mo", "1年": "1y", "2年": "2y"}
        col_period, col_refresh = st.columns([3, 1])
        with col_period:
            period_label = st.select_slider("时间范围", options=list(period_map.keys()), value="6个月")
        with col_refresh:
            st.write("")
            refresh = st.button("刷新数据", use_container_width=True)

        period = period_map[period_label]
        cache_key = f"df_{symbol}_{period}"
        if cache_key not in st.session_state or refresh:
            with st.spinner("加载价格历史..."):
                st.session_state[cache_key] = get_price_history(symbol, period)

        df = st.session_state[cache_key]
        if df is not None and len(df) > 0:
            fig_price = plot_price_chart(df, symbol, period)
            st.plotly_chart(fig_price, use_container_width=True)

            fig_macd = plot_macd(df)
            if fig_macd:
                st.plotly_chart(fig_macd, use_container_width=True)

            # 当前技术指标数值
            latest = df.iloc[-1]
            st.markdown('<div class="section-header">当前技术指标</div>', unsafe_allow_html=True)
            tc1, tc2, tc3, tc4, tc5, tc6 = st.columns(6)
            rsi_val = latest.get("RSI_14")
            rsi_str = f"{rsi_val:.1f}" if rsi_val else "N/A"
            tc1.metric("RSI (14)", rsi_str)
            tc2.metric("MA 20", f"{latest.get('SMA_20', 0):.3f}" if latest.get("SMA_20") else "N/A")
            tc3.metric("MA 50", f"{latest.get('SMA_50', 0):.3f}" if latest.get("SMA_50") else "N/A")
            tc4.metric("MA 200", f"{latest.get('SMA_200', 0):.3f}" if latest.get("SMA_200") else "N/A")
            tc5.metric("ATR (14)", f"{latest.get('ATRr_14', 0):.3f}" if latest.get("ATRr_14") else "N/A")
            macd_val = latest.get("MACD_12_26_9")
            tc6.metric("MACD", f"{macd_val:.4f}" if macd_val else "N/A")

            # Stochastic
            stoch_k = latest.get("STOCHk_14_3_3")
            stoch_d = latest.get("STOCHd_14_3_3")
            if stoch_k:
                st.caption(f"Stochastic %K: {stoch_k:.1f}  |  %D: {stoch_d:.1f}" if stoch_d else f"Stochastic %K: {stoch_k:.1f}")
        else:
            st.warning("暂无足够历史数据")

    # --------------------------------------------------------
    # Tab 4: 基本面
    # --------------------------------------------------------
    with tab_fund:
        # 估值
        st.markdown('<div class="section-header">估值指标</div>', unsafe_allow_html=True)
        f1, f2, f3, f4, f5 = st.columns(5)
        f1.metric("市盈率 P/E (TTM)", f"{info.get('pe_ttm', 0):.2f}" if info.get("pe_ttm") else "N/A")
        f2.metric("远期 P/E", f"{info.get('pe_fwd', 0):.2f}" if info.get("pe_fwd") else "N/A")
        f3.metric("市净率 P/B", f"{info.get('pb', 0):.2f}" if info.get("pb") else "N/A")
        f4.metric("EV/EBITDA", f"{info.get('ev_ebitda', 0):.2f}" if info.get("ev_ebitda") else "N/A")
        f5.metric("EPS (TTM)", f"{currency} {info.get('eps_ttm', 0):.4f}" if info.get("eps_ttm") else "N/A")

        # 盈利能力
        st.markdown('<div class="section-header">盈利能力</div>', unsafe_allow_html=True)
        p1, p2, p3, p4, p5 = st.columns(5)
        p1.metric("营收", fmt_large(info.get("revenue")))
        p2.metric("净利润", fmt_large(info.get("net_income")))
        p3.metric("净利润率", fmt_pct(info.get("profit_margin")))
        p4.metric("ROE", fmt_pct(info.get("roe")))
        p5.metric("ROA", fmt_pct(info.get("roa")))

        # 股息
        st.markdown('<div class="section-header">股息信息</div>', unsafe_allow_html=True)
        d1, d2, d3, d4 = st.columns(4)
        d1.metric("股息率", fmt_pct(info.get("div_yield")))
        d2.metric("每股股息", f"{currency} {info.get('div_rate', 0):.4f}" if info.get("div_rate") else "N/A")
        d3.metric("派息率", fmt_pct(info.get("payout_ratio")))
        d4.metric("自由现金流", fmt_large(info.get("fcf")))

        # 财务健康
        st.markdown('<div class="section-header">财务健康</div>', unsafe_allow_html=True)
        h1, h2, h3 = st.columns(3)
        h1.metric("负债/权益比", f"{info.get('debt_equity', 0):.2f}" if info.get("debt_equity") else "N/A")
        h2.metric("流动比率", f"{info.get('current_ratio', 0):.2f}" if info.get("current_ratio") else "N/A")
        h3.metric("Beta", f"{info.get('beta', 0):.2f}" if info.get("beta") else "N/A")

        # 股息历史图
        divs = get_dividends(symbol)
        if len(divs) > 0:
            st.markdown('<div class="section-header">派息历史</div>', unsafe_allow_html=True)
            fig_div = px.bar(
                x=divs.index, y=divs.values,
                labels={"x": "日期", "y": f"每股股息 ({currency})"},
                template="plotly_dark", color_discrete_sequence=["#42a5f5"],
            )
            fig_div.update_layout(height=250, margin=dict(l=0, r=0, t=10, b=0))
            st.plotly_chart(fig_div, use_container_width=True)

        # 财务报表
        with st.expander("查看财务报表（季报/年报）"):
            fins = get_financials(symbol)
            if fins.get("income_annual") is not None:
                st.markdown("**收入报表（年报）**")
                try:
                    st.dataframe(fins["income_annual"].head(8), use_container_width=True)
                except:
                    st.info("数据格式暂不支持显示")
            if fins.get("income_quarterly") is not None:
                st.markdown("**收入报表（季报）**")
                try:
                    st.dataframe(fins["income_quarterly"].head(8), use_container_width=True)
                except:
                    st.info("数据格式暂不支持显示")

    # --------------------------------------------------------
    # Tab 5: 新闻
    # --------------------------------------------------------
    with tab_news:
        st.markdown(f'<div class="section-header">最新资讯 — {info.get("name", symbol)}</div>',
                    unsafe_allow_html=True)
        st.caption("数据来源: Yahoo Finance（聚合 Bloomberg、Reuters、CNBC 等媒体）")

        with st.spinner("加载新闻..."):
            news_items = get_news(symbol, max_items=20)

        if news_items:
            for item in news_items:
                title = item.get("title", "")
                link  = item.get("link", "#")
                pub   = item.get("publisher", "")
                ts    = item.get("providerPublishTime", 0)
                dt_str = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else ""

                thumbnail = item.get("thumbnail", {})
                img_url = ""
                if thumbnail:
                    resolutions = thumbnail.get("resolutions", [])
                    if resolutions:
                        img_url = resolutions[0].get("url", "")

                col_img, col_text = st.columns([1, 5])
                with col_img:
                    if img_url:
                        st.image(img_url, width=80)
                with col_text:
                    st.markdown(f"""
                    <div class="news-card">
                        <a href="{link}" target="_blank" style="color:#90caf9; text-decoration:none; font-weight:600;">
                            {title}
                        </a><br>
                        <span style="color:#546e7a; font-size:0.78rem;">{pub} &nbsp;·&nbsp; {dt_str}</span>
                    </div>
                    """, unsafe_allow_html=True)
        else:
            st.info("暂无相关新闻")

        # TradingView News widget
        st.divider()
        st.markdown('<div class="section-header">TradingView 市场新闻</div>', unsafe_allow_html=True)
        import streamlit.components.v1 as components
        tv_news_html = f"""
        <div class="tradingview-widget-container">
          <div class="tradingview-widget-container__widget"></div>
          <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-timeline.js" async>
          {{
            "feedMode": "symbol",
            "symbol": "{symbol_to_tv(symbol)}",
            "colorTheme": "dark",
            "isTransparent": true,
            "displayMode": "regular",
            "width": "100%",
            "height": 450,
            "locale": "zh_CN"
          }}
          </script>
        </div>
        """
        components.html(tv_news_html, height=460)
