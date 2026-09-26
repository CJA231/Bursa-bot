"""
选股条件的公式引擎 —— docs/report.js 里 evalFormula / 各种序列函数 / 选股条件 (OPERANDS、ruleFormula) 的 Python 版。

后台信号 (strategy.json) 跟网页上的选股条件用同一种写法，所以两边要算出一模一样的结果：
这里每一个函数都照 report.js 逐行移植 (null 的传播、除以 0、四舍五入到 3 位的方式都一样)，
改任何一边都要两边一起改，改完跑一次 scratchpad 里的对齐测试 (网页引擎 vs 这里，每支股票每一根K线逐一比)。

序列一律是 Python list，缺的值是 None (对应 JS 的 null)；数字是 float (对应 JS 的 number)。
"""
import math
import re
from decimal import Decimal, ROUND_HALF_UP

INF = float("inf")


def _bad(v):
    """JS 的 v === null || v === undefined || isNaN(v)"""
    return v is None or (isinstance(v, float) and v != v)


def _num(v):
    return not _bad(v)


# ---- 基本运算 (JS 的 number 语义：除以 0 = Infinity / NaN，不会报错) ----
def _div(a, b):
    if b == 0:
        if a == 0 or a != a:
            return float("nan")
        return math.copysign(INF, a) * (math.copysign(1, b))
    return a / b


def _pow(a, b):
    try:
        r = math.pow(a, b)
    except (ValueError, OverflowError):
        return float("nan") if a < 0 else INF
    return r


def _mul(a, b):
    try:
        return a * b
    except OverflowError:
        return INF


OPS = {"+": lambda a, b: a + b, "-": lambda a, b: a - b, "*": _mul, "/": _div, "^": _pow}


def ew(a, b, fn):
    """两个操作数逐点运算：任一边是序列就逐点算 (数字自动广播)，None 一路传下去"""
    if isinstance(a, list) and isinstance(b, list):
        return [None if _bad(v) or _bad(w) else fn(v, w) for v, w in zip(a, b)]
    if isinstance(a, list):
        return [None if _bad(v) else fn(v, b) for v in a]
    if isinstance(b, list):
        return [None if _bad(w) else fn(a, w) for w in b]
    return fn(a, b)


def js_round(v, dp):
    """JS 的 Number(v.toFixed(dp))：正好一半时往绝对值大的那边 (Python round 是银行家舍入，不一样)"""
    if _bad(v):
        return None
    if v in (INF, -INF):
        return v
    q = Decimal(v).quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP)
    return float(q)


# ---- 序列函数 (照 report.js 同名函数) ----
def series_sma(arr, n):
    out = [None] * len(arr)
    for i in range(len(arr)):
        if i < n - 1:
            continue
        s, ok = 0.0, True
        for j in range(i - n + 1, i + 1):
            if _bad(arr[j]):
                ok = False
                break
            s += arr[j]
        out[i] = s / n if ok else None
    return out


def series_ema(arr, n):
    """pandas_ta 的 presma：先攒够 n 根，第 n 根 = 简单平均，之后按 EMA 递推；中途遇到空值重新攒"""
    k = 2 / (n + 1)
    out = [None] * len(arr)
    prev, seed = None, []
    for i, v in enumerate(arr):
        if _bad(v):
            prev, seed = None, []
            continue
        if prev is None:
            seed.append(v)
            if len(seed) < n:
                continue
            total = 0.0
            for x in seed:
                total += x
            prev = total / n
            seed = []
        else:
            prev = v * k + prev * (1 - k)
        out[i] = prev
    return out


def series_stdev(arr, n):
    sma = series_sma(arr, n)
    out = [None] * len(arr)
    for i in range(len(arr)):
        if sma[i] is None:
            continue
        sq, ok = 0.0, True
        for j in range(i - n + 1, i + 1):
            if _bad(arr[j]):
                ok = False
                break
            sq += (arr[j] - sma[i]) ** 2
        out[i] = math.sqrt(sq / n) if ok else None
    return out


def series_extreme(arr, n, better):
    out = [None] * len(arr)
    for i in range(len(arr)):
        if i < n - 1:
            continue
        window = arr[i - n + 1:i + 1]
        if any(_bad(v) for v in window):
            continue
        out[i] = better(window)
    return out


def series_sum(arr, n):
    out = [None] * len(arr)
    for i in range(len(arr)):
        if i < n - 1:
            continue
        s, ok = 0.0, True
        for j in range(i - n + 1, i + 1):
            if _bad(arr[j]):
                ok = False
                break
            s += arr[j]
        out[i] = s if ok else None
    return out


def series_rsi(close, n):
    out = [None] * len(close)
    if len(close) <= n:
        return out
    gains, losses = [], []
    for i in range(1, len(close)):
        c0, c1 = close[i - 1], close[i]
        if _bad(c0) or _bad(c1):
            gains.append(None)
            losses.append(None)
            continue
        ch = c1 - c0
        gains.append(ch if ch > 0 else 0)
        losses.append(-ch if ch < 0 else 0)
    avg_g = avg_l = None
    for idx in range(len(gains)):
        bar = idx + 1
        if idx < n - 1:
            continue
        if idx == n - 1:
            sg = sl = 0.0
            ok = True
            for j in range(n):
                if gains[j] is None:
                    ok = False
                    break
                sg += gains[j]
                sl += losses[j]
            if not ok:
                continue
            avg_g, avg_l = sg / n, sl / n
        else:
            if gains[idx] is None or avg_g is None:
                avg_g = avg_l = None
                continue
            avg_g = (avg_g * (n - 1) + gains[idx]) / n
            avg_l = (avg_l * (n - 1) + losses[idx]) / n
        if avg_g is None:
            continue
        out[bar] = 100 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    return out


def series_atr(high, low, close, n):
    m = len(high)
    tr = [None] * m
    for i in range(m):
        if i == 0:
            tr[i] = high[i] - low[i]
            continue
        pc = close[i - 1]
        if _bad(pc):
            tr[i] = high[i] - low[i]
            continue
        tr[i] = max(high[i] - low[i], abs(high[i] - pc), abs(low[i] - pc))
    out = [None] * m
    avg = None
    for i in range(m):
        if i < n - 1:
            continue
        if i == n - 1:
            s = 0.0
            for j in range(i - n + 1, i + 1):
                s += tr[j]
            avg = s / n
        else:
            avg = (avg * (n - 1) + tr[i]) / n
        out[i] = avg
    return out


def series_obv(close, volume):
    out = [None] * len(close)
    cum = 0
    for i in range(len(close)):
        if i == 0:
            out[i] = 0
            continue
        if close[i] > close[i - 1]:
            cum += volume[i]
        elif close[i] < close[i - 1]:
            cum -= volume[i]
        out[i] = cum
    return out


def series_ref(arr, n):
    out = []
    for i in range(len(arr)):
        v = arr[i - n] if i - n >= 0 else None
        out.append(None if _bad(v) else v)
    return out


def series_cross(a, b, up):
    n = len(a) if isinstance(a, list) else len(b)

    def at(x, i):
        v = x[i] if isinstance(x, list) else x
        return None if _bad(v) else v
    out = [None] * n
    for i in range(1, n):
        a0, b0, a1, b1 = at(a, i - 1), at(b, i - 1), at(a, i), at(b, i)
        if a0 is None or b0 is None or a1 is None or b1 is None:
            continue
        out[i] = 1 if ((a1 > b1 and a0 <= b0) if up else (a1 < b1 and a0 >= b0)) else 0
    return out


def series_t3(high, close, vol):
    """T3 形态逐根版本，跟 main.py detect_t3_pattern / report.js seriesT3 同一个定义"""
    n = len(close)
    out = [None] * n
    for i in range(25, n):
        hit = 0
        for off in range(2, 6):
            if hit:
                break
            t1 = i - off
            if t1 < 20:
                continue
            s, ok = 0.0, _num(vol[t1])
            for j in range(t1 - 20, t1):
                if not ok:
                    break
                if _num(vol[j]):
                    s += vol[j]
                else:
                    ok = False
            if not ok or not (vol[t1] > s / 20):
                continue
            h1 = high[t1]
            broke = any(high[k] >= h1 for k in range(t1 + 1, i))
            if not broke and close[i] > h1:
                hit = 1
        out[i] = hit
    return out


def series_psar(high, low, close, af0=0.02, max_af=0.2):
    """pandas_ta psar 逐行移植 (df.ta.psar() 不传 close，第一根 SAR 用最低价 / 最高价)"""
    m = len(high)
    out = [None] * m
    if m < 2:
        return out
    up, dn = high[1] - high[0], low[0] - low[1]
    falling = dn > up and dn > 0
    af = af0
    ep = low[0] if falling else high[0]
    sar = high[0] if falling else low[0]
    for i in range(1, m):
        sar = sar + af * (ep - sar)
        if falling:
            reverse = high[i] > sar
            if low[i] < ep:
                ep = low[i]
                af = min(af + af0, max_af)
            sar = max(high[i - 1], sar)
        else:
            reverse = low[i] < sar
            if high[i] > ep:
                ep = high[i]
                af = min(af + af0, max_af)
            sar = min(low[i - 1], sar)
        if reverse:
            sar = ep
            af = af0
            falling = not falling
            ep = low[i] if falling else high[i]
        out[i] = sar
    return out


def series_supertrend(high, low, close, factor=3, atr_period=10):
    n = len(close)
    atr = series_atr(high, low, close, atr_period)
    value = [None] * n
    prev_upper = prev_lower = prev_st = None
    for i in range(n):
        if atr[i] is None:
            continue
        src = (high[i] + low[i]) / 2
        upper, lower = src + factor * atr[i], src - factor * atr[i]
        pu = 0 if prev_upper is None else prev_upper
        pl = 0 if prev_lower is None else prev_lower
        prev_close = close[i - 1] if i > 0 else None
        lower = lower if (lower > pl or (prev_close is not None and prev_close < pl)) else pl
        upper = upper if (upper < pu or (prev_close is not None and prev_close > pu)) else pu
        if i == 0 or atr[i - 1] is None:
            d = 1
        elif prev_st == prev_upper:
            d = -1 if close[i] > upper else 1
        else:
            d = 1 if close[i] < lower else -1
        value[i] = lower if d == -1 else upper
        prev_upper, prev_lower, prev_st = upper, lower, value[i]
    return value


# ---- 条件运算：结果是逐根的 1 / 0，数据不够是 None ----
def truth_of(v):
    return None if _bad(v) else v != 0


def logic_op(a, b, is_and):
    def one(x, y):
        p, q = truth_of(x), truth_of(y)
        if is_and:
            return 0 if (p is False or q is False) else None if (p is None or q is None) else 1
        return 1 if (p is True or q is True) else None if (p is None or q is None) else 0
    if not isinstance(a, list) and not isinstance(b, list):
        return one(a, b)
    n = len(a) if isinstance(a, list) else len(b)
    return [one(a[i] if isinstance(a, list) else a, b[i] if isinstance(b, list) else b) for i in range(n)]


def logic_not(a):
    def one(x):
        p = truth_of(x)
        return None if p is None else 0 if p else 1
    return [one(x) for x in a] if isinstance(a, list) else one(a)


COMPARE = {">": lambda a, b: 1 if a > b else 0, "<": lambda a, b: 1 if a < b else 0,
           ">=": lambda a, b: 1 if a >= b else 0, "<=": lambda a, b: 1 if a <= b else 0,
           "==": lambda a, b: 1 if a == b else 0, "!=": lambda a, b: 1 if a != b else 0}
FORMULA_VARS = "close open high low volume"
FORMULA_FUNCS = "sma ema stdev highest lowest sum rsi atr obv abs ref max min round crossup crossdown psar supertrend t3"


class FormulaError(ValueError):
    pass


class Ctx:
    """一支股票的日线 (list of dict: open high low close volume)；算过的函数结果缓存起来 (同一个公式里常常重复)"""

    def __init__(self, bars):
        self.bars = bars
        self.series = {k: [b[k] for b in bars] for k in ("close", "open", "high", "low", "volume")}


def eval_formula(formula, ctx):
    s = formula
    pos = 0

    def skip():
        nonlocal pos
        while pos < len(s) and s[pos].isspace():
            pos += 1

    def ch(i=0):
        return s[pos + i] if pos + i < len(s) else None

    def consume(c):
        nonlocal pos
        skip()
        if ch() != c:
            raise FormulaError(f'语法错误，期望 "{c}"，但看到 "{ch() or "(末尾)"}"')
        pos += 1

    def peek_word(w):
        skip()
        if s[pos:pos + len(w)].lower() != w:
            return False
        nxt = s[pos + len(w)] if pos + len(w) < len(s) else None
        return nxt is None or not re.match(r"[a-zA-Z_0-9]", nxt)

    def parse_number():
        nonlocal pos
        skip()
        start = pos
        while pos < len(s) and re.match(r"[0-9.]", s[pos]):
            pos += 1
        if pos == start:
            raise FormulaError("无效的数字")
        m = re.match(r"[0-9]*\.?[0-9]*(?:[eE][+-]?[0-9]+)?", s[start:pos])  # JS parseFloat 只认开头那一段
        txt = m.group(0) if m else ""
        try:
            return float(txt)
        except ValueError:
            raise FormulaError("无效的数字: " + s[start:pos])

    def parse_ident():
        nonlocal pos
        skip()
        start = pos
        while pos < len(s) and re.match(r"[a-zA-Z_0-9]", s[pos]):
            pos += 1
        if pos == start:
            raise FormulaError("无效的名称")
        return s[start:pos]

    def lookup(name):
        key = name.lower()
        if key in ctx.series:
            return ctx.series[key]
        raise FormulaError(f"未知变量: {name} (可用: {FORMULA_VARS})")

    def need(name, args, count):
        if len(args) != count:
            raise FormulaError(f"{name}() 需要 {count} 个参数，实际给了 {len(args)} 个")

    def array_arg(v, label):
        if not isinstance(v, list):
            raise FormulaError(label + " 必须是一条时间序列 (例如 close)，不能是单个数字")
        return v

    def period_arg(v, label):
        if isinstance(v, list):
            raise FormulaError(label + " 必须是一个数字")
        if not isinstance(v, (int, float)) or v != v or v <= 0:
            raise FormulaError(label + " 必须是大于 0 的数字")
        return int(math.floor(v + 0.5))  # JS Math.round

    def number_arg(v, label):
        if isinstance(v, list) or not isinstance(v, (int, float)) or v != v or v <= 0:
            raise FormulaError(label + " 必须是大于 0 的数字")
        return v

    def call(name, args):
        se = ctx.series
        if name == "sma":
            need("sma", args, 2)
            return series_sma(array_arg(args[0], "sma 的第一个参数"), period_arg(args[1], "sma 的周期"))
        if name == "ema":
            need("ema", args, 2)
            return series_ema(array_arg(args[0], "ema 的第一个参数"), period_arg(args[1], "ema 的周期"))
        if name == "stdev":
            need("stdev", args, 2)
            return series_stdev(array_arg(args[0], "stdev 的第一个参数"), period_arg(args[1], "stdev 的周期"))
        if name == "highest":
            need("highest", args, 2)
            return series_extreme(array_arg(args[0], "highest 的第一个参数"), period_arg(args[1], "highest 的周期"), max)
        if name == "lowest":
            need("lowest", args, 2)
            return series_extreme(array_arg(args[0], "lowest 的第一个参数"), period_arg(args[1], "lowest 的周期"), min)
        if name == "sum":
            need("sum", args, 2)
            return series_sum(array_arg(args[0], "sum 的第一个参数"), period_arg(args[1], "sum 的周期"))
        if name == "rsi":
            need("rsi", args, 2)
            return series_rsi(array_arg(args[0], "rsi 的第一个参数"), period_arg(args[1], "rsi 的周期"))
        if name == "atr":
            need("atr", args, 1)
            return series_atr(se["high"], se["low"], se["close"], period_arg(args[0], "atr 的周期"))
        if name == "obv":
            need("obv", args, 0)
            return series_obv(se["close"], se["volume"])
        if name == "abs":
            need("abs", args, 1)
            a = args[0]
            return [None if _bad(v) else abs(v) for v in a] if isinstance(a, list) else abs(a)
        if name == "ref":
            need("ref", args, 2)
            return series_ref(array_arg(args[0], "ref 的第一个参数"), period_arg(args[1], "ref 往前几根"))
        if name in ("max", "min"):
            need(name, args, 2)
            return ew(args[0], args[1], max if name == "max" else min)
        if name in ("crossup", "crossdown"):
            need(name, args, 2)
            if not isinstance(args[0], list) and not isinstance(args[1], list):
                raise FormulaError(name + "() 至少有一边要是时间序列")
            return series_cross(args[0], args[1], name == "crossup")
        if name == "psar":
            if len(args) not in (0, 2):
                raise FormulaError("psar() 不带参数 (0.02, 0.2)，或者 psar(加速因子, 最大值)")
            return series_psar(se["high"], se["low"], se["close"],
                               number_arg(args[0], "psar 的加速因子") if args else 0.02,
                               number_arg(args[1], "psar 的最大值") if args else 0.2)
        if name == "supertrend":
            if len(args) not in (0, 2):
                raise FormulaError("supertrend() 不带参数 (10, 3)，或者 supertrend(ATR长度, 倍数)")
            return series_supertrend(se["high"], se["low"], se["close"],
                                     number_arg(args[1], "supertrend 的倍数") if args else 3,
                                     period_arg(args[0], "supertrend 的 ATR 长度") if args else 10)
        if name == "t3":
            need("t3", args, 0)
            return series_t3(se["high"], se["close"], se["volume"])
        if name == "round":
            if len(args) not in (1, 2):
                raise FormulaError("round() 要 1 或 2 个参数：round(x) 或 round(x, 小数位)")
            dp = args[1] if len(args) == 2 else 0
            if isinstance(dp, list) or not (0 <= dp <= 10) or dp != math.floor(dp):
                raise FormulaError("round 的小数位必须是 0 到 10 的整数")
            dp = int(dp)
            a = args[0]
            return [js_round(v, dp) for v in a] if isinstance(a, list) else js_round(a, dp)
        raise FormulaError(f"未知函数: {name}() (可用: {FORMULA_FUNCS})")

    def parse_primary():
        nonlocal pos
        skip()
        c = ch()
        if c == "(":
            pos += 1
            v = parse_expr()
            consume(")")
            return v
        if c is not None and re.match(r"[0-9.]", c):
            return parse_number()
        if c is not None and re.match(r"[a-zA-Z_]", c):
            name = parse_ident()
            if re.fullmatch(r"(and|or|not)", name, re.I):
                raise FormulaError(f"「{name}」前后要有条件")
            skip()
            if ch() == "(":
                pos += 1
                args = []
                skip()
                if ch() != ")":
                    args.append(parse_expr())
                    skip()
                    while ch() == ",":
                        pos += 1
                        args.append(parse_expr())
                        skip()
                consume(")")
                return call(name.lower(), args)
            return lookup(name)
        raise FormulaError('公式无法解析，看不懂这里: "' + ("(末尾)" if c is None else s[pos:]) + '"')

    def parse_unary():
        nonlocal pos
        skip()
        if ch() == "-":
            pos += 1
            return ew(parse_unary(), -1, _mul)
        return parse_power()

    def parse_power():
        nonlocal pos
        base = parse_primary()
        skip()
        if ch() == "^":
            pos += 1
            return ew(base, parse_unary(), _pow)
        return base

    def parse_term():
        nonlocal pos
        v = parse_unary()
        skip()
        while ch() in ("*", "/"):
            op = ch()
            pos += 1
            v = ew(v, parse_unary(), OPS[op])
            skip()
        return v

    def parse_sum():
        nonlocal pos
        v = parse_term()
        skip()
        while ch() in ("+", "-"):
            op = ch()
            pos += 1
            v = ew(v, parse_term(), OPS[op])
            skip()
        return v

    def parse_compare():
        nonlocal pos
        v = parse_sum()
        skip()
        m = re.match(r"(>=|<=|==|!=|>|<)", s[pos:pos + 2])
        if not m:
            if ch() == "=":
                raise FormulaError("比较是否相等要写两个等号 ==")
            return v
        pos += len(m.group(1))
        return ew(v, parse_sum(), COMPARE[m.group(1)])

    def parse_not():
        nonlocal pos
        skip()
        if peek_word("not"):
            pos += 3
            return logic_not(parse_not())
        if ch() == "!" and ch(1) != "=":
            pos += 1
            return logic_not(parse_not())
        return parse_compare()

    def parse_and():
        nonlocal pos
        v = parse_not()
        while True:
            skip()
            if peek_word("and"):
                pos += 3
            elif s[pos:pos + 2] == "&&":
                pos += 2
            else:
                return v
            v = logic_op(v, parse_not(), True)

    def parse_expr():
        nonlocal pos
        v = parse_and()
        while True:
            skip()
            if peek_word("or"):
                pos += 2
            elif s[pos:pos + 2] == "||":
                pos += 2
            else:
                return v
            v = logic_op(v, parse_and(), False)

    result = parse_expr()
    skip()
    if pos != len(s):
        raise FormulaError('公式末尾有多余内容: "' + s[pos:] + '"')
    return result


# ---- 选股条件 (跟 report.js 的 OPERANDS / ruleFormula / validRule 一样) ----
# (键, 单位, 默认长度, 公式模板, 短名称) —— 公式模板里的 {n} 换成长度
OPERANDS = {
    "close": ("price", None, "close", "当前价格"),
    "pclose": ("price", None, "ref(close,1)", "昨日收盘"),
    "open": ("price", None, "open", "今日开盘"),
    "high": ("price", None, "high", "今日最高"),
    "low": ("price", None, "low", "今日最低"),
    "hh": ("price", 20, "ref(highest(high,{n}),1)", "前{n}日最高"),
    "ll": ("price", 20, "ref(lowest(low,{n}),1)", "前{n}日最低"),
    "sma": ("price", 20, "sma(close,{n})", "SMA({n})"),
    "ema": ("price", 20, "ema(close,{n})", "EMA({n})"),
    "sar": ("price", None, "psar()", "SAR"),
    "st": ("price", None, "supertrend()", "Supertrend(10,3)"),
    "rsi": ("osc", 14, "rsi(close,{n})", "RSI({n})"),
    "macd": ("osc", None, "ema(close,12)-ema(close,26)", "MACD线"),
    "macds": ("osc", None, "ema(ema(close,12)-ema(close,26),9)", "MACD信号线"),
    "chg": ("pct", None, "(close/ref(close,1)-1)*100", "涨跌%"),
    "atrp": ("pct", 14, "atr({n})/close*100", "ATR%({n})"),
    "vol": ("vol", None, "volume", "成交量"),
    "vma": ("vol", 20, "sma(volume,{n})", "量均线({n})"),
    "rvol": ("ratio", 20, "volume/ref(sma(volume,{n}),1)", "相对量({n})"),
    "t3": ("bool", None, "t3()", "T3 形态突破"),
}
# 可以调参数的指标 (report.js OPERANDS 的 params)：(键, 默认值, 最小, 最大, 是否整数)。跟默认值一样的参数不存进规则，
# 公式 / 名称也跟以前一样 (例如 {"k": "st"} = supertrend() = "Supertrend(10,3)"；{"k": "st", "n": 3, "m": 1.4} = supertrend(3,1.4))
OPERAND_PARAMS = {
    "sar": (("af", 0.02, 0.001, 1, False), ("mx", 0.2, 0.01, 1, False)),
    "st": (("n", 10, 1, 200, True), ("m", 3, 0.1, 20, False)),
    "macd": (("f", 12, 1, 200, True), ("s", 26, 1, 300, True)),
    "macds": (("f", 12, 1, 200, True), ("s", 26, 1, 300, True), ("g", 9, 1, 100, True)),
}
NUM_TEXT = re.compile(r"^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$")
RULE_OPS = {">": ">", "<": "<", ">=": "≥", "<=": "≤", "crossup": "上穿", "crossdown": "下穿"}
MAX_LEN = 500
PRICE_ROUND = 3


def clamp_len(v, default):
    try:
        n = math.floor(float(v) + 0.5)
    except (TypeError, ValueError):
        return default
    if n != n or n in (INF, -INF):
        return default
    return int(min(MAX_LEN, max(1, n)))


def num_literal(v):
    q = Decimal(float(v)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    txt = re.sub(r"\.?0+$", "", format(q, "f"), count=1)
    return "0" if txt in ("-0", "") else txt


def clean_param(v, spec):
    """跟 report.js cleanParam 一样：只认数字 (或写成数字的字符串)，夹在范围内，整数参数四舍五入 (JS Math.round)，小数取 4 位 (JS toFixed)"""
    _, default, lo, hi, is_int = spec
    if isinstance(v, bool) or not (isinstance(v, (int, float)) or (isinstance(v, str) and NUM_TEXT.match(v))):
        return default
    x = float(v)
    if x != x or x in (INF, -INF):
        return default
    x = max(lo, min(hi, x))
    return int(math.floor(x + 0.5)) if is_int else js_round(x, 4)


def ref_params(ref):
    return {spec[0]: clean_param(ref.get(spec[0]), spec) for spec in OPERAND_PARAMS[ref["k"]]}


def is_default_params(k, p):
    return all(p[spec[0]] == spec[1] for spec in OPERAND_PARAMS[k])


def _param_formula(k, p, dflt):
    if k == "sar":
        return "psar()" if dflt else f"psar({num_literal(p['af'])},{num_literal(p['mx'])})"
    if k == "st":
        return "supertrend()" if dflt else f"supertrend({p['n']},{num_literal(p['m'])})"
    if k == "macd":
        return f"ema(close,{p['f']})-ema(close,{p['s']})"
    return f"ema(ema(close,{p['f']})-ema(close,{p['s']}),{p['g']})"  # macds


def _param_label(k, p, dflt):
    if k == "sar":
        return "SAR" if dflt else f"SAR({num_literal(p['af'])},{num_literal(p['mx'])})"
    if k == "st":
        return f"Supertrend({p['n']},{num_literal(p['m'])})"
    if k == "macd":
        return "MACD线" if dflt else f"MACD线({p['f']},{p['s']})"
    return "MACD信号线" if dflt else f"MACD信号线({p['f']},{p['s']},{p['g']})"


def is_bool_operand(ref):
    return bool(ref and ref.get("k") in OPERANDS and OPERANDS[ref["k"]][0] == "bool")


def operand_formula(ref):
    if ref["k"] == "num":
        return num_literal(ref["v"])
    unit, default, tpl, _ = OPERANDS[ref["k"]]
    if ref["k"] in OPERAND_PARAMS:
        p = ref_params(ref)
        f = _param_formula(ref["k"], p, is_default_params(ref["k"], p))
    else:
        f = tpl.replace("{n}", str(clamp_len(ref.get("n"), default))) if default else tpl
    return f"round({f},{PRICE_ROUND})" if unit == "price" else f


def operand_label(ref):
    if ref["k"] == "num":
        return num_literal(ref["v"])
    unit, default, _, short = OPERANDS[ref["k"]]
    if ref["k"] in OPERAND_PARAMS:
        p = ref_params(ref)
        return _param_label(ref["k"], p, is_default_params(ref["k"], p))
    return short.replace("{n}", str(clamp_len(ref.get("n"), default))) if default else short


def rule_formula(r):
    if "formula" in r:
        return r["formula"]
    a = operand_formula(r["a"])
    if is_bool_operand(r["a"]):
        return "not " + a if r.get("op") == "not" else a
    b = operand_formula(r["b"])
    if r["op"] in ("crossup", "crossdown"):
        return f"{r['op']}({a},{b})"
    return f"{a} {r['op']} {b}"


def rule_label(r):
    if "formula" in r:
        return "公式：" + (r["formula"].strip() or "(空)")
    a = operand_label(r["a"])
    if is_bool_operand(r["a"]):
        return a + " 不成立" if r.get("op") == "not" else a
    return f"{a} {RULE_OPS[r['op']]} {operand_label(r['b'])}"


def clean_ref(ref, allow_num):
    if not isinstance(ref, dict):
        return None
    if ref.get("k") == "num":
        if not allow_num:
            return None
        try:
            v = float(ref.get("v"))
        except (TypeError, ValueError):
            v = 0.0
        if v != v or v in (INF, -INF):
            v = 0.0
        return {"k": "num", "v": max(-1e12, min(1e12, v))}
    d = OPERANDS.get(ref.get("k"))
    if not d:
        return None
    if ref["k"] in OPERAND_PARAMS:  # 跟默认值不一样的参数才存
        p = ref_params(ref)
        out = {"k": ref["k"]}
        out.update({spec[0]: p[spec[0]] for spec in OPERAND_PARAMS[ref["k"]] if p[spec[0]] != spec[1]})
        return out
    return {"k": ref["k"], "n": clamp_len(ref.get("n"), d[1])} if d[1] else {"k": ref["k"]}


def clean_rule(r):
    """跟 report.js validRule 一样：认不得的返回 None，缺的补默认值"""
    if not isinstance(r, dict):
        return None
    if "formula" in r:
        if not isinstance(r["formula"], str):
            return None
        return {"formula": r["formula"][:300]}
    a = clean_ref(r.get("a"), False)
    if not a:
        return None
    if is_bool_operand(a):
        return {"a": a, "op": "not" if r.get("op") == "not" else "is"}
    op = r.get("op") if r.get("op") in RULE_OPS else ">"
    b = clean_ref(r.get("b"), True)
    return {"a": a, "op": op, "b": b if b and not is_bool_operand(b) else {"k": "num", "v": 0.0}}


TEST_BARS = [{"open": v, "high": v + 1, "low": v - 1, "close": v, "volume": 100} for v in (1, 2, 3, 4, 5)]


def compile_rules(rules):
    """跟 report.js compileRules 一样：每条条件先换成公式，用 5 根假K线试算一次 (结果要是一条序列)。
    返回 [(规则, 公式, 错误信息或 None)]；有错的条件不参与筛选 (网页上也是标红、不参与)"""
    out = []
    for r in rules:
        try:
            f = rule_formula(r)
            if not f.strip():
                raise FormulaError("公式是空的")
            if not isinstance(eval_formula(f, Ctx(TEST_BARS)), list):
                raise FormulaError("公式结果必须是一条随时间变化的序列，不能只是一个固定数字")
            out.append((r, f, None))
        except (FormulaError, ZeroDivisionError, OverflowError, TypeError, ValueError, KeyError) as e:
            out.append((r, "", str(e) or type(e).__name__))
    return out


def rules_truth(bars, compiled, match="all", ctx=None):
    """一组 (已经 compile_rules 过的) 条件在每一根K线上成不成立 → list of True / False。
    数据不够 (None) 算不成立；某支股票算的时候出错，那一条就当不成立 —— 都跟网页 evaluateRules 一样。"""
    ctx = ctx or Ctx(bars)
    n = len(bars)
    arrays = []
    for _, f, err in compiled:
        if err:
            continue
        try:
            v = eval_formula(f, ctx)
            arrays.append(v if isinstance(v, list) else [v] * n)
        except (FormulaError, ZeroDivisionError, OverflowError, TypeError, ValueError):
            arrays.append(None)
    if not arrays:
        return [False] * n
    out = []
    for i in range(n):
        oks = [a is not None and truth_of(a[i]) is True for a in arrays]
        out.append(any(oks) if match == "any" else all(oks))
    return out
