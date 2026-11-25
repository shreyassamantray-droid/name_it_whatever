
# Portfolio Research Lab

A standalone investment analytics web app for monthly return series. It starts with a synthetic, deterministic sample dataset. Use your own market history and fund metadata through Workspace.

## Run locally

Requires Node.js 20 or later. External packages are unnecessary.

~~~sh
npm start
~~~

Open http://127.0.0.1:4173. Run the analytics and HTTP checks with npm run check.

## Analytics

| Area | Tools |
| --- | --- |
| Market overview | Trailing market and asset-class returns, model portfolio comparisons, economic indicators, and style spreads where the data is available |
| Backtesting | Asset class, ticker, and dated dynamic allocations, plus manager comparison. Benchmarking, cash flows, rebalancing bands, leverage, dividends, allocation drift, drawdowns, and attribution |
| Planning | Historical, statistical, forecasted, and parameterized Monte Carlo. Multi-stage financial goals and asset liability modeling |
| Optimization | Efficient frontier with optional resampling, Black–Litterman, rolling allocation, and portfolio optimization with per-asset and group bounds |
| Factors | Regression, target allocation, exposure matching, principal components, statistics, multi-fund regression, and return attribution |
| Asset research | Screener, rankings, peer and regime performance, security and class correlations, autocorrelation, and residual cointegration statistics |
| Tactical allocation | Valuation, seasonality, two types of moving-average rules, relative strength, dual momentum, adaptive allocation, and volatility targeting |

The models are independent implementations with documented assumptions. The optimizer uses a constrained search and its solutions are approximate. The cointegration screen reports a zero-lag residual test statistic. The finance models use monthly data, and their results are for research and education.

## Data and model settings

- Return history CSV uses a header such as date,EQ,BOND and one row per month. Enter 0.02 or 2% for a 2% monthly return. Leave missing observations blank. Optional columns such as PE10, GDP, CPI, CASH, and supplied factor returns enable associated tools. CPI represents a monthly inflation rate. Yearly balance targets and starting capital are in the units of your imported model.
- Fund metadata CSV columns are symbol,name,category,type,fee. Define Country or Asset class as the type to identify entries in the Market Dashboard. Import VALUE and GROWTH series to view that style comparison. Dividend cash yields can be supplied through a per-symbol column such as EQ_DIV. Input security returns should include distributions.
- Upload portfolio holdings, ticker lists, cash flows, and correlation matrices under Workspace. Portfolio CSV accepts decimal or percent weights or market values and normalizes the total. Settings marked Advanced accept JSON with contextual hints.
- Tactical signals use observations preceding the trade month. An imported dataset without complete monthly history skips unavailable observations rather than fabricating returns. Review alignment before comparing results.
- Save individual models locally, save model returns for reuse as benchmarks, build formula-based series, and backfill short histories with proxy returns. Workspace backups include datasets, templates, and assumptions.
- The app exports a chosen table as CSV, all result tables as an Excel-readable SpreadsheetML workbook, and a branded print view through the browser’s PDF destination. Report templates support a logo, font, color, disclosure, and selected sections.

## Optional team workspace

The app stores the user's personal workspace in their browser. An operator can configure team members by setting PORTFOLIO_TEAM_ACCOUNTS to a JSON object mapping account names to distinct random tokens of at least 24 characters before starting the server. Members pull or publish the shared revision from Workspace. The server rejects stale updates. Team credentials belong in environment configuration and must be kept out of Git.

The server binds to 127.0.0.1 by default. If you make it reachable to other team members, use a TLS reverse proxy with appropriate access controls. By default, shared snapshots are stored in the ignored .team directory. Set PORTFOLIO_TEAM_DATA_DIR to keep them in a different directory. The repository includes no live-data subscription service or billing system.
