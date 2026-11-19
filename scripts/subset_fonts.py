"""
把 JetBrains Mono 缩成网站实际会用到的字符 (subset)，手机第一次打开少下载约 200KB。
- 原版完整字体在 terminal_assets/fonts-src/ (不发布)；精简版写到 terminal_assets/fonts/ (terminal_site.py 发布这个文件夹)
- 字符 = 扫描 terminal_assets/ 里所有页面 / 脚本 / 样式用到的字 + 资料里可能出现的范围 (英文名称、标点、箭头、框线、方块…)；
  中文 JetBrains Mono 本来就没有，浏览器会用系统字体，不受影响
- 保留连字 (calt / liga，例如 -> 显示成箭头) 和 tnum，外观跟原版一样
- 授权：SIL Open Font License 1.1，没有保留字体名称；精简版同样以 OFL 发布 (OFL.txt 跟着字体)
改了页面、用到新的符号以后跑一次：python scripts/subset_fonts.py  (需要 pip install fonttools brotli)
"""
import glob
import os
import shutil

from fontTools import subset

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "terminal_assets", "fonts-src")
OUT = os.path.join(ROOT, "terminal_assets", "fonts")
# 资料里会出现、但页面原稿里不一定有的字：ASCII、西欧字母 (公司名 / 公告标题)、标点、货币、箭头、数学、框线、方块、几何图形、符号
RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x100, 0x17F), (0x2010, 0x2044), (0x20A0, 0x20C0), (0x2122, 0x2122),
          (0x2190, 0x21FF), (0x2200, 0x22FF), (0x2300, 0x23FF), (0x2500, 0x259F), (0x25A0, 0x25FF), (0x2600, 0x26FF), (0x2700, 0x27BF)]


def used_chars():
    chars = set()
    for lo, hi in RANGES:
        chars.update(range(lo, hi + 1))
    for pat in ("*.js", "*.html", "*.css", "*.webmanifest"):
        for f in glob.glob(os.path.join(ROOT, "terminal_assets", pat)):
            with open(f, encoding="utf-8") as fh:
                chars.update(ord(c) for c in fh.read() if ord(c) >= 0x20)
    return chars


def main():
    os.makedirs(OUT, exist_ok=True)
    chars = used_chars()
    total_in = total_out = 0
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".woff2"):
            continue
        src, dst = os.path.join(SRC, name), os.path.join(OUT, name)
        opt = subset.Options()
        opt.flavor = "woff2"
        opt.layout_features = ["calt", "liga", "kern", "tnum", "ccmp", "locl", "mark", "mkmk", "rvrn"]
        opt.name_IDs = ["*"]          # 保留字体名称 / 版权 / 授权资讯
        opt.name_languages = ["*"]
        opt.notdef_outline = True
        opt.hinting = False           # 网页上不需要 hinting，省下不少
        opt.desubroutinize = True
        font = subset.load_font(src, opt)
        sub = subset.Subsetter(opt)
        sub.populate(unicodes=chars)
        sub.subset(font)
        subset.save_font(font, dst, opt)
        a, b = os.path.getsize(src), os.path.getsize(dst)
        total_in += a
        total_out += b
        print(f"{name}: {a // 1024} KB → {b // 1024} KB, {len(font.getGlyphOrder())} glyphs")
    shutil.copyfile(os.path.join(SRC, "OFL.txt"), os.path.join(OUT, "OFL.txt"))
    print(f"合计 {total_in // 1024} KB → {total_out // 1024} KB ({len(chars)} 个字符)")


if __name__ == "__main__":
    main()
