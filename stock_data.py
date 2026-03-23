"""
共用数据模块 - 马股 + 美股数据获取
"""
import yfinance as yf
import pandas as pd
import pandas_ta as ta

# ============================================================
# 默认自选股列表
# ============================================================

MY_WATCHLIST = {
    "1155.KL": "Maybank 马来亚银行",
    "1023.KL": "Public Bank 大众银行",
    "5183.KL": "Petronas Chemicals 国油化学",
    "5296.KL": "MR DIY",
    "0083.KL": "Press Metal 铝业",
    "5168.KL": "Hartalega 贺特佳",
    "3816.KL": "MISC",
    "4715.KL": "Genting 云顶",
    "5225.KL": "IHH Healthcare",
    "6888.KL": "Axiata",
}

US_WATCHLIST = {
    "AAPL": "Apple",
    "MSFT": "Microsoft",
    "NVDA": "NVIDIA",
    "AMZN": "Amazon",
    "GOOGL": "Alphabet (Google)",
    "META": "Meta",
    "TSLA": "Tesla",
    "SPY": "S&P 500 ETF",
    "QQQ": "Nasdaq 100 ETF",
}

INDICES = {
    "^KLSE": "富时马来西亚综合指数 (KLCI)",
    "^GSPC": "S&P 500",
    "^IXIC": "Nasdaq",
    "^DJI": "道琼斯",
}

# ============================================================
# 辅助函数
# ============================================================

def fmt_currency(val, currency="RM", decimals=3):
    if val is None:
        return "N/A"
    return f"{currency} {val:,.{decimals}f}"

def fmt_large(val):
    """格式化大数字 (亿/百万)"""
    if val is None:
        return "N/A"
    if val >= 1e12:
        return f"{val/1e12:.2f}T"
    if val >= 1e9:
        return f"{val/1e9:.2f}B"
    if val >= 1e6:
        return f"{val/1e6:.2f}M"
    return f"{val:,.0f}"

def fmt_pct(val):
    if val is None:
        return "N/A"
    return f"{val*100:.2f}%"

def symbol_to_tv(symbol: str) -> str:
    """Convert yfinance symbol to TradingView format."""
    if symbol.endswith(".KL"):
        return "MYX:" + symbol.replace(".KL", "")
    # Common US exchange prefixes
    us_nasdaq = {"AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA",
                 "AMD","INTC","QCOM","AVGO","ADBE","NFLX","PYPL","CSCO",
                 "COST","SBUX","CMCSA","HON","INTU","TXN","AMAT","MU","LRCX"}
    if symbol in us_nasdaq:
        return f"NASDAQ:{symbol}"
    return f"NYSE:{symbol}"

# ============================================================
# 数据获取
# ============================================================

def get_stock_info(symbol: str) -> dict:
    """获取股票综合信息（基本面 + 价格）"""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        is_my = symbol.endswith(".KL")
        currency = "RM" if is_my else "USD"
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        prev  = info.get("previousClose") or info.get("regularMarketPreviousClose")
        change     = (price - prev) if (price and prev) else None
        change_pct = (change / prev * 100) if (change and prev) else None
        return {
            "symbol": symbol,
            "name": info.get("longName") or info.get("shortName", symbol),
            "currency": currency,
            "price": price,
            "prev_close": prev,
            "change": change,
            "change_pct": change_pct,
            "open": info.get("open") or info.get("regularMarketOpen"),
            "day_high": info.get("dayHigh") or info.get("regularMarketDayHigh"),
            "day_low": info.get("dayLow") or info.get("regularMarketDayLow"),
            "volume": info.get("volume") or info.get("regularMarketVolume"),
            "avg_volume": info.get("averageVolume"),
            "market_cap": info.get("marketCap"),
            "week52_high": info.get("fiftyTwoWeekHigh"),
            "week52_low": info.get("fiftyTwoWeekLow"),
            # 基本面
            "pe_ttm": info.get("trailingPE"),
            "pe_fwd": info.get("forwardPE"),
            "pb": info.get("priceToBook"),
            "eps_ttm": info.get("trailingEps"),
            "eps_fwd": info.get("forwardEps"),
            "div_yield": info.get("dividendYield"),
            "div_rate": info.get("dividendRate"),
            "payout_ratio": info.get("payoutRatio"),
            "revenue": info.get("totalRevenue"),
            "net_income": info.get("netIncomeToCommon"),
            "profit_margin": info.get("profitMargins"),
            "roe": info.get("returnOnEquity"),
            "roa": info.get("returnOnAssets"),
            "debt_equity": info.get("debtToEquity"),
            "current_ratio": info.get("currentRatio"),
            "fcf": info.get("freeCashflow"),
            "ev_ebitda": info.get("enterpriseToEbitda"),
            "beta": info.get("beta"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            # 分析师
            "target_price": info.get("targetMeanPrice"),
            "target_high": info.get("targetHighPrice"),
            "target_low": info.get("targetLowPrice"),
            "recommendation": info.get("recommendationKey"),
            "num_analysts": info.get("numberOfAnalystOpinions"),
        }
    except Exception as e:
        return {"symbol": symbol, "name": symbol, "error": str(e)}


def get_price_history(symbol: str, period: str = "6mo") -> pd.DataFrame | None:
    """获取历史价格 + 技术指标"""
    try:
        df = yf.Ticker(symbol).history(period=period)
        if len(df) < 20:
            return None
        df.ta.rsi(length=14, append=True)
        df.ta.sma(length=20, append=True)
        df.ta.sma(length=50, append=True)
        if len(df) >= 200:
            df.ta.sma(length=200, append=True)
        df.ta.ema(length=12, append=True)
        df.ta.ema(length=26, append=True)
        df.ta.macd(fast=12, slow=26, signal=9, append=True)
        df.ta.bbands(length=20, append=True)
        df.ta.atr(length=14, append=True)
        df.ta.stoch(append=True)
        return df
    except Exception as e:
        return None


def get_news(symbol: str, max_items: int = 15) -> list:
    """获取股票相关新闻"""
    try:
        news = yf.Ticker(symbol).news
        return (news or [])[:max_items]
    except:
        return []


def get_financials(symbol: str) -> dict:
    """获取财务报表"""
    try:
        t = yf.Ticker(symbol)
        return {
            "income_annual": t.income_stmt,
            "income_quarterly": t.quarterly_income_stmt,
            "balance_annual": t.balance_sheet,
            "cashflow_annual": t.cashflow,
        }
    except:
        return {}


def get_dividends(symbol: str) -> pd.Series:
    """获取派息历史"""
    try:
        divs = yf.Ticker(symbol).dividends
        return divs.tail(20) if len(divs) > 0 else pd.Series(dtype=float)
    except:
        return pd.Series(dtype=float)


def get_market_indices() -> dict:
    """获取主要指数实时数据"""
    results = {}
    for sym, name in INDICES.items():
        try:
            info = yf.Ticker(sym).info
            price = info.get("regularMarketPrice") or info.get("currentPrice")
            prev  = info.get("regularMarketPreviousClose") or info.get("previousClose")
            if price and prev:
                change = price - prev
                results[name] = {
                    "price": price,
                    "change": change,
                    "change_pct": change / prev * 100,
                }
        except:
            pass
    return results


def scan_signals(symbols: list) -> list:
    """扫描股票信号（RSI / 均线 / 成交量）"""
    results = []
    for sym in symbols:
        try:
            df = get_price_history(sym, "3mo")
            if df is None or len(df) < 20:
                continue
            latest = df.iloc[-1]
            prev   = df.iloc[-2]
            signals = []
            rsi = latest.get("RSI_14")
            if rsi:
                if rsi < 30:
                    signals.append(f"🔴 严重超卖 RSI {rsi:.0f}")
                elif rsi < 40:
                    signals.append(f"🟠 RSI超卖 {rsi:.0f}")
                elif rsi > 70:
                    signals.append(f"🟡 RSI超买 {rsi:.0f}")
            close, prev_close = latest["Close"], prev["Close"]
            sma50, prev_sma50 = latest.get("SMA_50"), prev.get("SMA_50")
            sma200 = latest.get("SMA_200")
            if sma50 and prev_sma50:
                if close > sma50 and prev_close <= prev_sma50:
                    signals.append("🟢 突破50日均线")
                elif close < sma50 and prev_close >= prev_sma50:
                    signals.append("🔴 跌破50日均线")
            if sma200:
                if close > sma200 and prev_close <= df.iloc[-2].get("SMA_200", sma200):
                    signals.append("🌟 突破200日均线")
            vol = latest.get("Volume", 0)
            avg_vol = df["Volume"].rolling(20).mean().iloc[-1]
            if avg_vol and vol > avg_vol * 2:
                signals.append(f"📊 成交量爆量 {vol/avg_vol:.1f}x")
            if signals:
                results.append({
                    "symbol": sym,
                    "price": close,
                    "rsi": rsi,
                    "signals": " | ".join(signals),
                })
        except:
            continue
    return results
