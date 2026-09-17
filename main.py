import os
import yfinance as yf
import pandas_ta as ta
import requests
from openai import OpenAI
import time

# === 1. 配置区域 ===
# 你的自选股列表 (马股代码记得加 .KL)
WATCHLIST = [
    "1155.KL",  # Maybank
    "1023.KL",  # Public Bank
    "5183.KL",  # Petronas Chemicals
    "5296.KL",  # MR DIY
    "0083.KL",  # Press Metal
    "5168.KL"   # Hartalega
]

DEEPSEEK_KEY = os.environ.get("DEEPSEEK_KEY")
TG_TOKEN = os.environ.get("TG_TOKEN")
TG_CHAT_ID = os.environ.get("TG_CHAT_ID")

missing = [name for name, value in [
    ("DEEPSEEK_KEY", DEEPSEEK_KEY),
    ("TG_TOKEN", TG_TOKEN),
    ("TG_CHAT_ID", TG_CHAT_ID),
] if not value]
if missing:
    raise SystemExit(
        f"缺少环境变量: {', '.join(missing)}。"
        " 请在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加对应的 Secret。"
    )

# === 2. 初始化 DeepSeek 客户端 ===
# 关键修改点：base_url 必须是 deepseek 的地址
client = OpenAI(
    api_key=DEEPSEEK_KEY,               # 从 GitHub Secrets 读取密码
    base_url="https://api.deepseek.com" # 👈 这里指定连接 DeepSeek
)

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

        # 计算技术指标 (RSI 和 均线)
        df.ta.rsi(length=14, append=True)
        df.ta.sma(length=50, append=True)
        df.ta.macd(append=True)
        
        #以此获取最新一天的数值
        latest = df.iloc[-1]
        prev = df.iloc[-2]
        
        return {
            "symbol": symbol,
            "close": round(latest['Close'], 3),
            "rsi": round(latest['RSI_14'], 2),
            "sma50": round(latest['SMA_50'], 3),
            "prev_close": prev['Close'],
            "prev_sma50": prev['SMA_50']
        }
    except Exception as e:
        print(f"获取失败 {symbol}: {e}")
        return None

# === 4. 简单的筛选策略 ===
def check_strategy(data):
    """
    在这里修改你的筛选条件
    返回: (是否符合, 原因)
    """
    # 策略 A: RSI 超卖 (小于35) -> 可能是反弹机会
    if data['rsi'] < 35:
        return True, "📉 RSI 超卖 (数值低于35)"
    
    # 策略 B: 黄金交叉 (价格站上 50日均线)
    # 今天价格 > 50均线 且 昨天价格 < 50均线
    if data['close'] > data['sma50'] and data['prev_close'] < data['prev_sma50']:
        return True, "🚀 突破 50日均线 (趋势转强)"
        
    # 策略 C: 强制包含第一只股票 (为了让你测试时一定能收到消息)
    # 测试完成后，可以删除下面这 2 行
    if data['symbol'] == WATCHLIST[0]:
        return True, "⚠️ 测试信号 (由系统强制发送)"
        
    return False, None

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

# === 6. 发送 Telegram ===
def send_telegram(message):
    url = f"https://api.telegram.org/bot{TG_TOKEN}/sendMessage"
    payload = {
        "chat_id": TG_CHAT_ID,
        "text": message,
        "parse_mode": "Markdown"
    }
    requests.post(url, json=payload)

# === 主程序 ===
def main():
    report_content = ""
    stock_found = False
    
    print("开始扫描...")
    for symbol in WATCHLIST:
        data = get_stock_data(symbol)
        if not data: continue
        
        is_match, reason = check_strategy(data)
        
        if is_match:
            stock_found = True
            # 调用 AI 分析
            ai_comment = ask_deepseek(data, reason)
            
            # 拼凑消息
            msg = (
                f"🚨 **{symbol} 触发信号**\n"
                f"原因: {reason}\n"
                f"📊 现价: {data['close']} | RSI: {data['rsi']}\n"
                f"💡 **DeepSeek:** {ai_comment}\n"
                f"-------------------\n"
            )
            report_content += msg
            print(f"✅ 找到机会: {symbol}")
            # 为了防止 DeepSeek 限制频率，稍微停顿 1 秒
            time.sleep(1) 
            
    if stock_found:
        header = "📢 **今日马股自动分析报告**\n\n"
        send_telegram(header + report_content)
        print("报告已发送到 Telegram")
    else:
        print("今日无符合条件的股票")

if __name__ == "__main__":
    main()
