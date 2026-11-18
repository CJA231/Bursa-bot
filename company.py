"""网站署名的公司资料 (data/company.json)：使用条款、版权声明、页脚、PDF 下载都从这里拿，改一个文件就全部更新。"""
import html
import json
import os
from datetime import datetime

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "company.json")
DEFAULT = {"name": "[COMPANY NAME] SDN. BHD.", "registration_no": "[202X01XXXXXX (XXXXXXX-X)]", "address": "[Registered address], Malaysia",
           "email": "[legal@yourdomain.com]", "city": "Kuala Lumpur", "brand": "Bursa Bot"}


def load():
    try:
        with open(PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    return {k: str(data.get(k) or v) for k, v in DEFAULT.items()}


def fill(text, year=None):
    """把页面里的 __CO_NAME__ / __CO_REG__ / __CO_ADDR__ / __CO_EMAIL__ / __CO_CITY__ / __CO_BRAND__ / __YEAR__ 换成公司资料 (HTML 转义)"""
    c = load()
    for token, key in (("__CO_NAME__", "name"), ("__CO_REG__", "registration_no"), ("__CO_ADDR__", "address"),
                       ("__CO_EMAIL__", "email"), ("__CO_CITY__", "city"), ("__CO_BRAND__", "brand")):
        text = text.replace(token, html.escape(c[key]))
    return text.replace("__YEAR__", str(year or datetime.now().year))
