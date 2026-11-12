# Third-party notices · 第三方组件与资料来源

Bursa Bot itself is proprietary (see [LICENSE](./LICENSE)). It uses the third-party software, fonts, data and services below, each under its own terms. Nothing in LICENSE changes those terms.

## Bundled with the published site

| Component | Where | License |
|---|---|---|
| TradingView Lightweight Charts™ v5.2.1, © 2025 TradingView, Inc. | `docs/vendor/lightweight-charts.js` | Apache License 2.0 ([copy](./docs/vendor/LICENSE-lightweight-charts), [NOTICE](./docs/vendor/NOTICE)). The attribution and link must stay visible on pages that show the charts (the report footer does this). |
| JetBrains Mono 2.305 (Regular, Medium, Bold), © 2020 The JetBrains Mono Project Authors | `terminal_assets/fonts/` → `docs/terminal/fonts/` | SIL Open Font License 1.1 ([copy](./terminal_assets/fonts/OFL.txt)). Unmodified official web fonts; the licence file is published next to them. |

## Python libraries (installed in GitHub Actions, not redistributed)

| Library | License |
|---|---|
| yfinance | Apache License 2.0 |
| pandas | BSD 3-Clause |
| pandas_ta | MIT |
| openai (Python SDK, used for the DeepSeek API) | Apache License 2.0 |
| requests | Apache License 2.0 |
| openpyxl | MIT |
| reportlab | BSD |

## Data sources and services

These are third-party services with their own terms of use. They are used here for **personal, non-commercial research**. Before offering Bursa Bot to other users, or commercially, check each provider's terms and obtain the licences they require.

| Source | Used for | Note |
|---|---|---|
| Yahoo Finance (via yfinance) | Prices, financial statements, company profiles, stock list | Yahoo's terms restrict redistribution and commercial use of its data. yfinance is not affiliated with Yahoo. |
| KLSE Screener | Bursa Malaysia announcements (titles and text), IPO calendar and oversubscription headlines | Third-party site; check its terms before any commercial or large-scale use. |
| Bursa Malaysia | Original source of announcements and market data | Redistributing Bursa market data commercially requires a data licence from Bursa Malaysia. |
| FTSE Russell | FTSE Bursa Malaysia KLCI index values | Index names and data are FTSE Russell trademarks / property. |
| Google News RSS | News headlines and links | Only headlines and links are stored, not article text. |
| DeepSeek API | AI summaries, calendar extraction, company descriptions, Ask AI | DeepSeek terms of service and usage policies apply. |
| Cloudflare Workers (optional) | Relay for Ask AI | Cloudflare terms apply to the user's own Worker. |

All trademarks belong to their owners. Bursa Bot is not affiliated with or endorsed by any of the companies above.
