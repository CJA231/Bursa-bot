"""
查看单支股票在"今天"和过去几天，是否符合 main.py 里的筛选条件
(EMA20 < 现价、SAR < 现价、T3形态)，逐天列出细节，方便对照验证。

用法:
    python scripts/debug_stock.py 0453.KL
    python scripts/debug_stock.py 0453.KL --days-back 3   # 额外往前多看几天
"""
import argparse
import os
import sys

import pandas as pd
import yfinance as yf

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from main import detect_t3_pattern  # noqa: E402


def compute_for_cutoff(full_df, cutoff_offset):
    """把 full_df 截到只剩 (今天 - cutoff_offset) 为止，重新算一遍指标。"""
    end = len(full_df) - cutoff_offset
    if end < 50:
        return None
    df = full_df.iloc[:end].copy()

    df.ta.rsi(length=14, append=True)
    df.ta.sma(length=50, append=True)
    df.ta.ema(length=20, append=True)
    df.ta.psar(append=True)

    psar_long_col = next(c for c in df.columns if c.startswith("PSARl"))
    psar_short_col = next(c for c in df.columns if c.startswith("PSARs"))
    df["PSAR"] = df[psar_long_col].combine_first(df[psar_short_col])

    latest = df.iloc[-1]
    ema20_ok = latest["Close"] > latest["EMA_20"]
    sar_bullish = latest["Close"] > latest["PSAR"]
    t3 = detect_t3_pattern(df)

    return {
        "date": df.index[-1].strftime("%Y-%m-%d"),
        "close": round(latest["Close"], 3),
        "ema20": round(latest["EMA_20"], 3),
        "ema20_ok": ema20_ok,
        "sar": round(latest["PSAR"], 3),
        "sar_bullish": sar_bullish,
        "t3_pattern": t3,
        "all_match": bool(ema20_ok and sar_bullish and t3),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("symbol")
    parser.add_argument("--days-back", type=int, default=1, help="额外往前看几天 (默认只看今天+昨天)")
    args = parser.parse_args()

    print(f"抓取 {args.symbol} 的历史数据...")
    full_df = yf.Ticker(args.symbol).history(period="6mo")
    if len(full_df) < 50:
        print("数据不足，无法分析。")
        return

    for offset in range(0, args.days_back + 1):
        label = "今天" if offset == 0 else f"往前第 {offset} 天"
        result = compute_for_cutoff(full_df, offset)
        if result is None:
            print(f"{label}: 数据不足")
            continue
        print(f"\n=== {label} ({result['date']}) ===")
        print(f"  现价: {result['close']}")
        print(f"  EMA20: {result['ema20']} -> {'✅ 达标' if result['ema20_ok'] else '❌ 未达标'}")
        print(f"  SAR: {result['sar']} ({'多头' if result['sar_bullish'] else '空头'}) -> {'✅ 达标' if result['sar_bullish'] else '❌ 未达标'}")
        print(f"  T3形态: {'✅ 达标' if result['t3_pattern'] else '❌ 未达标'}")
        print(f"  >>> 三条件全部满足: {'✅ 是' if result['all_match'] else '❌ 否'}")


if __name__ == "__main__":
    main()
