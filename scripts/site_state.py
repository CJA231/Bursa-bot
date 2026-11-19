"""
网站资料 (报告、个股资料、AI 资讯…) 存在 site-data 分支，不再提交到 main：main 只放程序和手写的文件，仓库不会越来越大。

- site-data 分支永远只有「一个提交」：每次保存都做一个没有父提交的新提交，再强制推送 (force-with-lease)，旧的那个就被丢掉
- 各个流程只换掉「自己负责的路径」(--role)，其余照抄 site-data 最新的版本；两个流程同时保存时，后推的会被拒，重新抓最新的再做一次
- 手写 / 管理员编辑的文件 (SOURCE：docs/report.js、docs/vendor/、docs/terminal/overrides.json…) 留在 main，永远不进 site-data。
  以后在 docs/ 加新的手写文件，要加进 SOURCE / SOURCE_PREFIX

用法 (在仓库根目录)：
  python3 scripts/site_state.py restore                     # 把 site-data 的资料放回 docs/ 和 data/ (跑报告 / 部署之前)
  python3 scripts/site_state.py save --role report -m "…"   # 只保存 report 负责的路径
  python3 scripts/site_state.py untrack                     # 一次性：main 不再追踪生成的文件 (迁移用)
role：report (马股报告：docs/ 里 us、intel、holders、filings、segments、esg 以外的全部 + data/ 的状态文件)、report-us (docs/us/)、
      intel (docs/intel、holders、filings、segments)、esg (docs/esg)、watchlist (data/watchlist*.json + docs/stock)、all
"""
import argparse
import io
import os
import subprocess
import sys
import tarfile
import time

BRANCH = "site-data"
REMOTE_REF = "refs/remotes/origin/" + BRANCH
STATE_FILES = ("data/ann_latency.json", "data/ipos.json", "data/watchlist.json", "data/watchlist_changes.json")
ROOTS = ("docs", "data")
SIDE = ("docs/us/", "docs/intel/", "docs/holders/", "docs/filings/", "docs/segments/", "docs/esg/")
INDEX = os.path.join(".git", "site-state.index")
BOT = {"GIT_AUTHOR_NAME": "github-actions[bot]", "GIT_AUTHOR_EMAIL": "github-actions[bot]@users.noreply.github.com",
       "GIT_COMMITTER_NAME": "github-actions[bot]", "GIT_COMMITTER_EMAIL": "github-actions[bot]@users.noreply.github.com"}


def git(*args, inp=None, env=None, check=True):
    e = dict(os.environ, **(env or {}))
    r = subprocess.run(["git", *args], input=inp, capture_output=True, env=e)
    if check and r.returncode:
        raise RuntimeError(f"git {' '.join(args[:3])}… failed: {r.stderr.decode(errors='replace').strip()[:400]}")
    return r


def out(*args, **kw):
    return git(*args, **kw).stdout.decode().strip()


# 留在 main 的手写文件 (其余 docs/ 都是每次运行生成的)
SOURCE = {"docs/report.js", "docs/i18n.js", "docs/i18n-gloss.js", "docs/fold.js", "docs/terminal/overrides.json", "docs/terminal/account.json"}
SOURCE_PREFIX = ("docs/vendor/", "docs/icons/")


def generated(path):
    """这个路径是不是「生成的网站资料」(属于 site-data)"""
    if path in SOURCE or path.startswith(SOURCE_PREFIX) or path.endswith((".pyc", ".DS_Store")) or "/__pycache__/" in path:
        return False
    return path.startswith("docs/") or path in STATE_FILES


def owns(role, path):
    if role == "all":
        return True
    if role == "report":
        return path in STATE_FILES or (path.startswith("docs/") and not path.startswith(SIDE))
    if role == "report-us":
        return path.startswith("docs/us/")
    if role == "intel":
        return path.startswith(("docs/intel/", "docs/holders/", "docs/filings/", "docs/segments/"))
    if role == "esg":
        return path.startswith("docs/esg/")
    if role == "watchlist":
        return path in ("data/watchlist.json", "data/watchlist_changes.json") or path.startswith("docs/stock/")
    raise SystemExit(f"不认识的 role: {role}")


def fetch():
    """抓 site-data 最新的提交；分支不存在返回 None"""
    r = git("fetch", "--quiet", "--depth=1", "origin", f"+refs/heads/{BRANCH}:{REMOTE_REF}", check=False)
    if r.returncode:
        err = r.stderr.decode(errors="replace")
        if "couldn't find remote ref" in err or "not found" in err.lower():
            return None
        raise RuntimeError("fetch site-data failed: " + err.strip()[:300])
    return out("rev-parse", REMOTE_REF)


def extract(rev, only=None):
    """把某个提交里「生成的」文件解开到工作目录 (手写的文件不碰)"""
    data = git("archive", "--format=tar", rev, *(only or [])).stdout
    n = 0
    with tarfile.open(fileobj=io.BytesIO(data)) as tf:
        for m in tf.getmembers():
            if not m.isfile() or not generated(m.name):
                continue
            os.makedirs(os.path.dirname(m.name) or ".", exist_ok=True)
            with tf.extractfile(m) as src, open(m.name, "wb") as dst:
                dst.write(src.read())
            n += 1
    return n


def bootstrap_rev():
    """site-data 还不存在 (第一次)：用 main 历史里最后一份网站资料。工作目录里就有 → 不用做；已经 untrack → 找删掉之前的那个提交"""
    if git("cat-file", "-e", "HEAD:docs/index.html", check=False).returncode == 0:
        return None
    if os.path.exists(os.path.join(".git", "shallow")):
        git("fetch", "--quiet", "--unshallow", "origin")
    rev = out("rev-list", "-1", "HEAD", "--", "docs/index.html")
    return rev + "^" if rev else None


def cmd_restore(a):
    tip = fetch()
    if tip:
        n = extract(tip)
        # 工作目录跟 site-data 完全一致：site-data 里已经没有的生成文件 (过期的下载、下市的股票…) 也删掉，不然下次保存又被加回去
        keep = set(out("ls-tree", "-r", "--name-only", "-z", tip).split("\0"))
        gone = [p for p in workspace_files() if p not in keep]
        for p in gone:
            os.remove(p)
        print(f"site-data {tip[:8]} → 放回 {n} 个文件" + (f"，删掉 {len(gone)} 个旧文件" if gone else ""))
        return
    rev = bootstrap_rev()
    if rev:
        n = extract(rev, ["docs", "data"])
        print(f"site-data 还不存在：从 main 历史 {out('rev-parse', '--short', rev)} 放回 {n} 个文件")
    else:
        print("site-data 还不存在：用 main 里现有的文件 (第一次保存时会建立 site-data)")


def workspace_files():
    files = []
    for root in ROOTS:
        for d, _, names in os.walk(root):
            for nm in names:
                p = os.path.join(d, nm).replace(os.sep, "/")
                if generated(p):
                    files.append(p)
    return sorted(files)


def build_tree(tip, role):
    """site-data 最新版本 + 把 role 负责的路径换成工作目录里的版本 → tree sha"""
    env = {"GIT_INDEX_FILE": INDEX}
    if os.path.exists(INDEX):
        os.remove(INDEX)
    if tip:
        git("read-tree", tip, env=env)
        # 分支第一次是用 role=all 建的；之后每个 role 只动自己的路径
        old = [p for p in out("ls-files", "-z", env=env).split("\0") if p and (owns(role, p) or not generated(p))]
        if old:
            git("update-index", "--force-remove", "-z", "--stdin", inp=("\0".join(old) + "\0").encode(), env=env)
    else:
        git("read-tree", "--empty", env=env)
        role = "all"  # 第一次建立：工作目录里全部生成的文件都放进去，不然部署时会少东西
    mine = [p for p in workspace_files() if owns(role, p)]
    if mine:
        shas = out("hash-object", "-w", "--stdin-paths", inp=("\n".join(mine) + "\n").encode()).split("\n")
        info = "".join(f"100644 {s}\t{p}\n" for s, p in zip(shas, mine))
        git("update-index", "--index-info", inp=info.encode(), env=env)
    tree = out("write-tree", env=env)
    os.remove(INDEX)
    return tree, len(mine)


def cmd_save(a):
    for attempt in range(1, 7):
        tip = fetch()
        tree, n = build_tree(tip, a.role)
        if tip and out("rev-parse", tip + "^{tree}") == tree:
            print(f"site-data 没有变化 ({a.role})")
            return
        commit = out("commit-tree", tree, "-m", a.message, env=BOT)
        lease = f"--force-with-lease=refs/heads/{BRANCH}:{tip or ''}"
        r = git("push", "--quiet", lease, "origin", f"{commit}:refs/heads/{BRANCH}", check=False)
        if r.returncode == 0:
            print(f"site-data ← {commit[:8]} ({a.role}，{n} 个文件；{'取代 ' + tip[:8] if tip else '第一次建立'})")
            return
        print(f"推送被拒 (第 {attempt} 次，别的流程刚保存过)，重新抓最新的再做：{r.stderr.decode(errors='replace').strip()[:160]}")
        time.sleep(min(30, 4 * attempt))
    raise SystemExit("site-data 保存失败 (重试 6 次)")


def cmd_untrack(a):
    """一次性迁移：生成的文件不再由 main 追踪 (文件留在工作目录)"""
    files = [p for p in out("ls-files", "-z", "--", *ROOTS).split("\0") if p]
    drop = [p for p in files if generated(p)]
    if not drop:
        print("main 已经没有追踪生成的文件")
        return
    git("rm", "-r", "--cached", "--quiet", "--pathspec-from-file=-", "--pathspec-file-nul", inp=("\0".join(drop) + "\0").encode())
    print(f"main 不再追踪 {len(drop)} 个生成的文件 (留下手写 / 设定文件 {len(files) - len(drop)} 个)")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("restore")
    s = sub.add_parser("save")
    s.add_argument("--role", required=True, choices=["report", "report-us", "intel", "esg", "watchlist", "all"])
    s.add_argument("-m", "--message", default="Update site data")
    sub.add_parser("untrack")
    a = ap.parse_args()
    {"restore": cmd_restore, "save": cmd_save, "untrack": cmd_untrack}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
