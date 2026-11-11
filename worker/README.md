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

## 另一种方式：用自己的 DeepSeek 密钥 (不用 Cloudflare)
「⚙ 设置」选「自己的密钥」，贴上 DeepSeek 密钥。密钥只存在这台手机的浏览器里，问问题时浏览器直接连 DeepSeek。
缺点：密钥在手机上；如果浏览器挡掉直接连线 (跨网域限制)，就只能用上面的 Worker 方式。

## 费用
每问一次大约用 2,000–6,000 tokens (附带的页面资料占大部分)。deepseek-chat 的价钱下，一般一次不到 RM0.01 (以 DeepSeek 后台为准)。
