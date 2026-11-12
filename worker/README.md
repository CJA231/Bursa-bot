# AI 问答中转 (Cloudflare Worker)

终端版每一页右下角的「✦ AI」按钮可以问 DeepSeek 问题。网页是公开的静态网站，不能把 API 密钥放在网页里 (谁都看得到、谁都能用你的额度)，
所以用一个免费的 Cloudflare Worker 当中转：密钥存在 Cloudflare 的 Secret，网页只知道 Worker 的网址，还要输入你自己定的通行码。

## 设置 (约 5 分钟，只做一次)
1. 到 https://dash.cloudflare.com 注册 / 登录 → **Workers & Pages** → **Create** → **Create Worker**，名字例如 `bursa-ai` → Deploy。
2. 打开这个 Worker → **Edit code**，把 `worker/ai-proxy.js` 整个内容贴上去 → **Deploy**。
3. **Settings → Variables and Secrets**，加三个：
   - `DEEPSEEK_KEY` (类型 Secret)：DeepSeek API 密钥。建议在 DeepSeek 后台另外开一个新密钥给它用，并设好用量上限。
   - `PASS` (类型 Secret)：你自己定的通行码 (一串不容易猜的字)。
   - `ALLOW_ORIGIN` (类型 Text)：`https://cja231.github.io`
4. 复制 Worker 的网址 (像 `https://bursa-ai.<你的名字>.workers.dev`)。
5. 打开终端版 → 右下角「✦ AI」→「⚙ 设置」→ 选「Worker」，贴上网址和通行码 → 保存。

网址和通行码只存在你这台手机的浏览器里。

## 在网页上编辑内容 (owner，可选)

同一个 Worker 也让你 (网站管理员) 在终端版网页上修改 **AI 资讯、公司简介、日历事件、IPO 超额认购 / 上市日**，可以叫 AI 按你的指令改写，确认后发布：
Worker 把你的版本提交到仓库的 `docs/terminal/overrides.json`，GitHub Pages 约 1–2 分钟后所有人看得到。
之后 `company_intel.yml` 重新整理那家公司时，AI 新版本和你的版本会对照公告 / 新闻 / 财报核对、合并：跟资料矛盾的按资料改、找不到根据的保留，两种都列给你看 (只有你看得到)。

1. GitHub → 右上角头像 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**：
   - Repository access：**Only select repositories** → 只选 `CJA231/Bursa-bot`
   - Permissions：**Contents = Read and write** (其他都不要开)；有效期按你习惯 (到期要换新的)
2. Cloudflare 这个 Worker → **Settings → Variables and Secrets**，再加：
   - `EDIT_PASS` (Secret)：编辑通行码，**跟 `PASS` 不一样** (问答通行码可以给朋友用，编辑通行码只有你知道)
   - `GH_TOKEN` (Secret)：上一步的 token
   - `GH_REPO` (Text)：`CJA231/Bursa-bot`
   - `GH_BRANCH` (Text)：`main`
3. 把最新的 `worker/ai-proxy.js` 贴进 Worker → **Deploy**。
4. 终端版 → ✦ AI → ⚙ 设置 → 「编辑通行码」填 `EDIT_PASS` → 保存。之后各模块旁边会出现 ✎。

安全：GitHub token 只在 Cloudflare，网页上看不到；编辑要通行码 + 编辑通行码都对才会提交；token 只能改这个仓库的文件。
保存前 Worker 会检查字眼：「利好、目标价、止损」这类评价 / 建议一律不能用；「卖出、持有、建议」有时是在陈述事实 (例如「大股东卖出 500 万股」「董事会建议派息」)，要你确认才保存。
「参考资料」不会显示在页面上，但会存进公开的 `overrides.json`，不要贴私人资料或整篇付费文章。

## 另一种方式：用自己的 DeepSeek 密钥 (不用 Cloudflare)
「⚙ 设置」选「自己的密钥」，贴上 DeepSeek 密钥。密钥只存在这台手机的浏览器里，问问题时浏览器直接连 DeepSeek。
缺点：密钥在手机上；如果浏览器挡掉直接连线 (跨网域限制)，就只能用上面的 Worker 方式。

## 费用
每问一次大约用 2,000–6,000 tokens (附带的页面资料占大部分)。deepseek-chat 的价钱下，一般一次不到 RM0.01 (以 DeepSeek 后台为准)。
