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
Worker 把你的版本提交到仓库的 `docs/terminal/overrides.json`，「Deploy site」流程约 1–2 分钟后部署，所有人看得到。
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

## 更新 (2026-11)

重新部署最新的 `worker/ai-proxy.js` (Workers → 你的 Worker → Edit code → 贴上 → Deploy)，多了两样：
- **DeepSeek 模型自动切换**：旧名称 `deepseek-chat` 失效时，自动改用 DeepSeek 现在支持的名称 (从错误信息读出来，flash 优先)，并关掉思考模式。不用改任何设定
- **POST `/theme`**：终端版 AI 面板的 🎨「用一句话设计界面主题」。用同一个通行码 (`PASS`)，只回传主题的颜色 / 字号 / 圆角 / 玻璃感。没更新 Worker 的话，🎨 的预设照样能用，只是不能用一句话生成

## 👤 用 Google 登录 · 跨设备同步 (可选)

终端版右上角的「登录」：任何人都可以用 Google 账号 (Gmail) 登录，观察列表、主题、语言、K 线样式、自定义回测设定在各设备之间自动同步。
AI 密钥、通行码不会上传。同一个 Worker 负责验证登录和存资料 (Cloudflare KV)，**不用通行码** (`PASS` 只管 AI 问答)。
没设定的话网页上不会出现「登录」，其他功能照常。约 15 分钟，只做一次：

### 1. Google Cloud：建立 OAuth 用户端 ID
1. 打开 https://console.cloud.google.com → 上方选单 **New project** (例如 `bursa-bot`)
2. 左边 **APIs & Services → OAuth consent screen** (新版叫 **Google Auth Platform**)：
   - **Branding**：应用名称 (例如 Bursa Bot)、支持电邮；隐私权政策网址可以填 `https://cja231.github.io/Bursa-bot/terminal/legal.html#e14`
   - **Audience**：User type 选 **External** → 按 **Publish app** (状态变成 In production，任何 Google 账号都能登录；只用基本资料 (电邮、名字)，不需要 Google 审核)
   - **Data access**：不用加任何 scope
3. **Clients → Create client**：
   - Application type：**Web application**
   - **Authorized JavaScript origins**：`https://cja231.github.io` (只要网域，不要后面的 /Bursa-bot)
   - Authorized redirect URIs：留空
   - 建立后复制 **Client ID** (`xxxxxxxx.apps.googleusercontent.com`)。Client secret 用不到

### 2. Cloudflare：KV 储存 + Worker 设定
1. Cloudflare → **Storage & Databases → KV → Create namespace**，名字例如 `bursa-sync`
2. 你的 Worker → **Settings → Bindings → Add → KV namespace**：Variable name 填 **`SYNC`**，选 `bursa-sync`
3. **Settings → Variables and Secrets**，加：
   - `GOOGLE_CLIENT_ID` (Text)：上一步的 Client ID
   - `SESSION_SECRET` (Secret)：一串 32 个字以上的乱码 (例如密码管理器产生的长密码)。签登录凭证用；以后换掉 = 所有人要重新登录
   - (可选) `PRO_EMAILS` (Text)：付费用户的电邮，逗号分隔
   - (可选) `FREE_MAX_FOLDERS` / `FREE_MAX_STOCKS` / `PRO_MAX_FOLDERS` / `PRO_MAX_STOCKS`：同步上限，默认 3 / 30 / 50 / 2000
   - `ALLOW_ORIGIN` 维持 `https://cja231.github.io`
4. 把最新的 `worker/ai-proxy.js` 贴进 Worker → **Deploy**

### 3. 网站：填公开设定
GitHub 网页打开 [`docs/terminal/account.json`](../docs/terminal/account.json) → ✏️ 编辑：
- `google_client_id`：Client ID
- `worker`：Worker 网址 (`https://bursa-ai.xxx.workers.dev`)
- `upgrade` (可选)：「升级 Pro」按钮的链接 (付款页 `https://…` 或 `mailto:…`)，留空就不显示
- `plans`：只用来显示免费 / Pro 的数量，改了 Worker 的上限这里也跟着改

提交到 main → 「Deploy site」约 1–2 分钟后部署，终端版右上角出现「登录」。这些都是公开资料 (不是密钥)，放在网站上没关系。

### 免费 / Pro
- 免费版只同步前 3 个列表、共 30 只股票，多出来的留在原来的设备 (账号面板会提示)
- 升级一个人：在 KV `bursa-sync` 里 **Add entry**，key = `pro:电邮` (小写，例如 `pro:someone@gmail.com`)，value = 到期日 `2027-12-31` 或 `forever`，马上生效、不用重新部署；到期自动变回免费版。删掉那一笔 = 取消。或者把电邮加进 `PRO_EMAILS`
- 升级后，之前被截掉的股票会在下一次同步时自动送上去
- 收费方式 (付款页、订阅) 还没接上：现在是收到款后手动加 `pro:` 那一笔

### 资料、隐私、费用
- KV 里每个账号一笔 `d:<Google 账号 ID>`，内容是同步的资料 + 电邮 (电邮也放在那一笔的 metadata，key 列表里看得到)。用户在账号面板按「删除云端资料」就删掉；有人用电邮要求删除而不方便自己按时，在 KV 的 key 列表按 metadata 的电邮找到那一笔删掉 (或用 `npx wrangler kv key list --namespace-id <ID>` 列出全部)
- 使用条款第 14.3 条写了登录会收集什么、存在哪里、怎么删除 (PDPA 2010)
- 安全：Worker 用 Google 的公钥验证登录 (签名、发给你的 Client ID、有效期、电邮已验证)，之后发自己的登录凭证 (HMAC 签名，30 天)；同步的资料只收观察列表和界面设定这几个栏位，其他一律丢掉
- Cloudflare 免费额度：KV 每天 10 万次读取、1,000 次写入。终端版改动后等 2.5 秒才同步、没改动就不写，一般一个人一天几次到几十次。用户多了可以升级 Workers Paid (每月 5 美元，写入额度大很多)
- KV 不是即时一致 (各地区最多约 60 秒)：两台设备在同一分钟里都改了，网页那边会三方合并，不会丢资料
