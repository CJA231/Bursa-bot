"""公开展示站 (精简版)：给更多人看，但不暴露策略。

和完整报告 (docs/) 分开生成，写到 public_site/，再由 workflow 推到另一个公开仓库 (策略和代码留在私有仓库)。
这一份里只有：今日市场综述、强势股、今日机会 (价格 / 风险 / 报酬风险比)、其余股票、纯K线 + 成交量。
没有：指标 (SAR / EMA / RSI ...)、进场 / 离场规则、策略名称和触发理由、回测、筛选器、下载文件、AI 点评、名词解释。
数据文件里也只有价格、成交量、成交额这类事实，不含任何指标值 —— 查看网页源码也看不到策略。"""
import html
import json
import os
import shutil

PUBLIC_DIR = os.environ.get("PUBLIC_SITE_DIR") or "public_site"
BARS_DAYS = 90
MOVER_MIN_TURNOVER = 1_000_000   # 强势股 / 涨跌榜只看成交额够大的 (RM)，免得仙股跳一格占满
STRONG_MIN_CHG = 3.0             # 强势股：涨幅 ≥ 3% 且量比 ≥ 1.5 (不够 5 支就按涨幅补)
STRONG_MIN_RV = 1.5
PLAN_R = 2.0                     # 默认计划：目标 = 2 倍风险


def _f(v, d=3):
    return None if v is None else round(float(v), d)


def _plan(price, stop):
    """进场 = 收盘价，风险线 = stop，目标 = 2 倍风险。风险线不在价格下面就没有计划"""
    if stop is None or not (0 < stop < price):
        return None
    risk = (price - stop) / price * 100
    return {"entry": _f(price), "stop": _f(stop), "target": _f(price + PLAN_R * (price - stop)), "risk": _f(risk, 1), "rr": PLAN_R}


def build_stock_rows(stocks):
    rows = []
    for s in stocks:
        d = s.get("data")
        if not d:
            continue
        code = s["symbol"].split(".")[0]
        close, prev = float(d["close"]), d.get("prev_close")
        chg = (close / float(prev) - 1) * 100 if prev else 0.0
        row = {"c": code, "n": s["name"], "p": _f(close), "chg": _f(chg, 2), "v": int(d["volume"]), "t": int(d.get("turnover") or 0),
               "rv": _f(d.get("rel_volume"), 2), "sig": 1 if s["matched"] else 0, "d": d.get("last_date")}
        if s["matched"]:
            stop_ref = d.get("stop_ref")
            row["plan"] = _plan(close, stop_ref[0] if stop_ref else close * 0.92)
        rows.append(row)
    return rows


def build_bars(stocks):
    """每支股票最近 90 根日线，价格 × 1000 取整 (省体积)：[日期, 开, 高, 低, 收, 量]"""
    out = {}
    for s in stocks:
        d = s.get("data")
        if not d or not d.get("candles"):
            continue
        code = s["symbol"].split(".")[0]
        out[code] = [[c["time"], round(float(c["open"]) * 1000), round(float(c["high"]) * 1000), round(float(c["low"]) * 1000),
                      round(float(c["close"]) * 1000), int(c["volume"])] for c in d["candles"][-BARS_DAYS:]]
    return out


def strong_codes(rows):
    liquid = [r for r in rows if r["t"] >= MOVER_MIN_TURNOVER and r["chg"] > 0]
    strong = sorted((r for r in liquid if r["chg"] >= STRONG_MIN_CHG and (r["rv"] or 0) >= STRONG_MIN_RV), key=lambda r: -r["chg"])
    if len(strong) < 5:
        extra = sorted((r for r in liquid if r not in strong), key=lambda r: -r["chg"])
        strong += extra[:5 - len(strong)]
    return [r["c"] for r in strong[:10]]


def build_market(market, rows):
    market = market or {}
    out = {"indices": [{"label": ix["label"], "last": _f(ix["last"], 2), "chg": _f(ix["chg"], 2), "pct": _f(ix["chg_pct"], 2),
                        "spark": [_f(x, 2) for x in ix["spark"][-22:]]} for ix in market.get("indices") or []]}
    b = market.get("breadth")
    if b:
        out["breadth"] = {k: b[k] for k in ("up", "flat", "down", "total", "highs", "lows")}
        out["breadth"]["turnover"] = _f(b["turnover"], 0)
    liquid = [r for r in rows if r["t"] >= MOVER_MIN_TURNOVER]
    out["gainers"] = [r["c"] for r in sorted((r for r in liquid if r["chg"] > 0), key=lambda r: -r["chg"])[:3]]
    out["losers"] = [r["c"] for r in sorted((r for r in liquid if r["chg"] < 0), key=lambda r: r["chg"])[:3]]
    out["active"] = [r["c"] for r in sorted(rows, key=lambda r: -r["t"])[:3]]
    return out


def build(stocks, market, state, now_str, title, currency_symbol, vendor_src, out_dir=None):
    out_dir = out_dir or PUBLIC_DIR
    rows = build_stock_rows(stocks)
    if not rows:
        return None
    os.makedirs(out_dir, exist_ok=True)
    payload = {"updated": now_str, "state": state, "cur": currency_symbol, "title": title, "stocks": rows,
               "strong": strong_codes(rows), "market": build_market(market, rows)}
    with open(os.path.join(out_dir, "data.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, "bars.json"), "w", encoding="utf-8") as f:
        json.dump(build_bars(stocks), f, separators=(",", ":"))
    here = os.path.dirname(os.path.abspath(__file__))
    for name in ("public.js", "public.css"):
        shutil.copyfile(os.path.join(here, "public_assets", name), os.path.join(out_dir, name))
    os.makedirs(os.path.join(out_dir, "vendor"), exist_ok=True)
    shutil.copyfile(vendor_src, os.path.join(out_dir, "vendor", "lightweight-charts.js"))
    with open(os.path.join(here, "public_assets", "index.html"), encoding="utf-8") as f:
        page = f.read().replace("__TITLE__", html.escape(title))
    version = str(abs(hash(now_str)) % 10 ** 8)
    with open(os.path.join(out_dir, "index.html"), "w", encoding="utf-8") as f:
        f.write(page.replace("__V__", version))
    open(os.path.join(out_dir, ".nojekyll"), "w").close()
    return out_dir
