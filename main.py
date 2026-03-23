"""
Bursa Bot — 每日马股 & 美股技术信号 Telegram 推送
使用 stock_data.py 共用数据模块
"""
import os
import time
import requests
from openai import OpenAI

from stock_data import (
    MY_WATCHLIST, US_WATCHLIST,
    get_stock_info, get_price_history, get_news,
    scan_signals,
)

# ============================================================
# 配置
# ============================================================
WATCHLIST_MY = list(MY_WATCHLIST.keys())
WATCHLIST_US = list(US_WATCHLIST.keys())

# DeepSeek / OpenAI 兼容客户端
client = OpenAI(
    api_key=os.environ.get("DEEPSEEK_KEY"),
    base_url="https://api.deepseek.com",
)

TG_TOKEN   = os.environ.get("TG_TOKEN")
TG_CHAT_ID = os.environ.get("TG_CHAT_ID")

# ============================================================
# 发送 Telegram 消息
# ============================================================
def send_telegram(message: str, parse_mode: str = "Markdown"):
    if not TG_TOKEN or not TG_CHAT_ID:
        print("[TG] 未配置 Token / Chat ID，跳过发送")
        return
    url = f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage"
    payload = {"chat_id": TG_CHAT_ID, "text": message, "parse_mode": parse_mode}
    try:
        resp = requests.post(url, json=payload, timeout=10)
        resp.raise_for_status()
    except Exception as e:
        print(f"[TG] 发送失败: {e}")

# ============================================================
# DeepSeek AI 分析
# ============================================================
def ask_deepseek(symbol: str, signals: str, price: float, rsi: float | None,
                 currency: str = "RM") -> str:
    price_str = f"{currency} {price:.3f}"
    rsi_str   = f"{rsi:.1f}" if rsi else "N/A"
    prompt = f"""你是专业的股票分析师，同时熟悉马来西亚股市和美国股市。
股票代码: {symbol}
当前价格: {price_str}
RSI (14): {rsi_str}
触发信号: {signals}

请用中文（50字以内）：
1. 评价信号可靠性
2. 给出"买入 / 观望 / 卖出"建议
"""
    try:
        resp = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": "你是严谨的金融分析助手，回答简洁专业。"},
                {"role": "user",   "content": prompt},
            ],
            temperature=0.1,
            max_tokens=120,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        return f"AI 分析出错: {e}"

# ============================================================
# 主程序
# ============================================================
def main():
    print("=" * 50)
    print("Bursa Bot — 开始扫描...")
    print("=" * 50)

    # 扫描马股 + 美股
    all_symbols = WATCHLIST_MY + WATCHLIST_US
    signal_results = scan_signals(all_symbols)

    if not signal_results:
        print("今日无明显技术信号，不发送报告")
        # 仍发送一条简短日报
        today_msg = "📊 *今日市场扫描完成*\n今日马股 & 美股自选列表暂无明显技术信号。\n保持观望，耐心等待机会。"
        send_telegram(today_msg)
        return

    # 为每只触发信号的股票获取 AI 分析
    report_lines = ["📢 *今日股票信号报告*\n"]

    for row in signal_results:
        sym      = row["symbol"]
        price    = row["price"]
        rsi_val  = row.get("rsi")
        signals  = row["signals"]
        is_my    = sym.endswith(".KL")
        currency = "RM" if is_my else "USD"
        flag     = "🇲🇾" if is_my else "🇺🇸"

        print(f"[AI] 分析 {sym}: {signals}")
        ai_comment = ask_deepseek(sym, signals, price, rsi_val, currency)
        time.sleep(1)  # 避免 DeepSeek 限速

        block = (
            f"{flag} *{sym}*  {currency} {price:.3f}\n"
            f"📡 信号: {signals}\n"
            f"💡 {ai_comment}\n"
            f"{'─'*30}\n"
        )
        report_lines.append(block)

    # 附加当天最新马股新闻标题
    report_lines.append("\n📰 *马股最新资讯*")
    for sym in WATCHLIST_MY[:3]:
        news_list = get_news(sym, max_items=2)
        for n in news_list:
            title = n.get("title", "")
            link  = n.get("link", "")
            if title:
                report_lines.append(f"• [{title[:60]}...]({link})")

    full_report = "\n".join(report_lines)
    send_telegram(full_report)
    print(f"[TG] 报告已发送，共 {len(signal_results)} 只股票触发信号")


if __name__ == "__main__":
    main()
