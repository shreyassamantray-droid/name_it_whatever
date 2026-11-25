
import { annualized, compound, correlation, deviation, drawdown, mean, random } from "./math.js";
import { aligned, backtest, factorFit, factorMatch, optimize, summary, weightsFrom } from "./portfolio.js";
import { autocorrelation, cointegration, correlations, fundRows, marketReturns, pca, simulate, tactical } from "./research.js";

const metrics = stats => ({ title: "Statistics", headers: ["Metric","Value"], rows: Object.entries(stats) });
const table = (title, headers, rows) => ({ title, headers, rows });
const chart = (title, dates, series) => ({ title, dates, series });
const named = (name, values) => ({ name, values });
const openReturns = (rows, name) => rows.filter(row => Number.isFinite(row[name])).map(row => row[name]);
const base = { weights:"EQ:42%,INTL:18%,BOND:40%", benchmark:"EQ", initial:100000, rebalance:12 };
export const objectives = ["Maximum Sharpe","Minimum variance","Maximum return","Mean-variance utility","CVaR","Risk parity","Tracking error","Information ratio","Kelly","Sortino","Omega","Maximum drawdown"];
export const strategies = ["Valuation","Seasonal","Moving average","Portfolio moving averages","Relative strength","Dual momentum","Adaptive allocation","Target volatility"];
export const models = {
  "CAPM":["MKT"],
  "Fama–French 3":["MKT","SMB","HML"],
  "Carhart 4":["MKT","SMB","HML","MOM"],
  "Fama–French 5":["MKT","SMB","HML","RMW","CMA"],
  "q-factor":["MKT","ME","IA","ROE","EG"],
  "Term and credit":["TERM","CREDIT"],
  "Custom":[]
};
const simulation = { ...base, years:25, trials:500, mode:"Historical", inflation:.025, inflationAdjusted:true, monthlyCash:-250, real:true, seed:43, block:12 };
const optimizeDefault = { assets:"EQ,INTL,BOND,GOLD", method:"Maximum Sharpe", benchmarkSymbol:"EQ" };
const factor = { asset:"EQ", factors:"MKT,SMB,HML,MOM", factorModel:"Custom", riskFree:"CASH" };
const catalog = [
  ["Market overview", [
    ["market","Market dashboard","Examine trailing returns, market indicators, style spreads, and model portfolio performance.",{}]
  ]],
  ["Backtesting", [
    ["allocation","Asset class backtest","Compare asset-class allocations through historical periods.",{...base, compare:{ "Growth":{EQ:.7,INTL:.2,BOND:.1} }}],
    ["portfolio","Portfolio backtest","Measure portfolio growth, benchmark behavior, and holding-level contributions.",base],
    ["dynamic","Dynamic allocation backtest","Replay dated allocation changes.",{...base,schedule:{"2012-01":{EQ:.65,BOND:.35},"2019-01":{EQ:.5,GOLD:.15,BOND:.35}}}],
    ["manager","Manager performance","Compare a manager return series with a benchmark.",{asset:"INTL",benchmark:"EQ",initial:100000}]
  ]],
  ["Planning", [
    ["monte","Monte Carlo simulation","Project balances and test whether withdrawals are sustainable.",simulation],
    ["goals","Financial goals","Set cash flow stages and a target balance.",{...simulation,goal:180000,stages:[{from:1,to:12,cashflow:350},{from:13,to:25,cashflow:-450}]}],
    ["liability","Asset liability modeling","Model future contributions, obligations, and target funding.",{...simulation,monthlyCash:250,monthlyLiability:100,terminalLiability:120000,discountRate:.035,targetFundingRatio:1}]
  ]],
  ["Optimization", [
    ["frontier","Efficient frontier","Explore the trade-off between expected returns and volatility.",{...optimizeDefault,steps:15,resamples:0}],
    ["optimize","Portfolio optimization","Find allocations under an objective and weight constraints.",optimizeDefault],
    ["black","Black–Litterman","Express absolute or relative return views and blend them with equilibrium returns.",{...optimizeDefault,views:[{weights:{EQ:1,BOND:-1},return:.04}],aversion:2.5}],
    ["rolling","Rolling optimization","Re-estimate portfolio weights on a trailing window.",{...optimizeDefault,window:36,tradeEvery:12,initial:100000}]
  ]],
  ["Factor analysis", [
    ["factor","Factor regression","Estimate loadings, alpha and fit against a chosen factor model.",factor],
    ["factorAllocation","Risk factor allocation","Find a mix of assets that targets specified factor loadings.",{...factor,assets:"EQ,INTL,SMALL,BOND",targets:{MKT:.65,SMB:.15,HML:.12,MOM:0}}],
    ["factorMatch","Match factor exposures","Find assets that approximate the exposures of a target asset or portfolio.",{...factor,asset:"REIT",assets:"EQ,INTL,SMALL,BOND"}],
    ["pca","Principal component analysis","Identify the leading sources of covariance in a set of return series.",{assets:"EQ,INTL,SMALL,BOND,GOLD"}],
    ["factorStats","Factor statistics","Compare factor return, volatility, and correlations.",{assets:"MKT,SMB,HML,MOM,RMW,CMA,TERM,CREDIT"}],
    ["fundFactor","Fund factor regressions","Compare factor exposures across multiple funds.",{...factor,assets:"EQ,INTL,SMALL,BOND"}],
    ["attribution","Factor performance attribution","Break average excess returns into factor contributions and alpha.",factor]
  ]],
  ["Asset research", [
    ["screener","Fund screener","Filter a fund universe by category, type, history, and expense ratio.",{benchmark:"EQ",minMonths:36,maxFee:.01,category:"",type:""}],
    ["ranking","Fund rankings","Rank funds by return, risk-adjusted return, volatility, or drawdown.",{minMonths:36,category:"",rankBy:"Sharpe"}],
    ["performance","Fund performance","Compare a fund with its benchmark and selected peers.",{asset:"INTL",benchmark:"EQ",assets:"EQ,SMALL",showRegimes:true}],
    ["correlation","Asset correlations","Compare individual securities and visualize rolling relationships.",{assets:"EQ,INTL,BOND,GOLD",window:36}],
    ["classCorrelation","Asset class correlations","Compare return correlations for broad asset-class proxies.",{assets:"EQ,INTL,SMALL,BOND,TREASURY,GOLD,REIT"}],
    ["auto","Asset autocorrelation","Measure return persistence across time lags.",{asset:"EQ",lags:18}],
    ["cointegration","Asset cointegration","Evaluate whether two log-price paths have a mean-reverting spread.",{asset:"EQ",benchmark:"INTL"}]
  ]],
  ["Tactical allocation", [
    ["tactical","Tactical models","Evaluate rule-based strategies and inspect their next model allocation.",{...base,assets:"EQ,INTL,BOND,GOLD",safe:"CASH",strategy:"Dual momentum",lookback:10,hold:2}]
  ]]
];
export const groups = catalog.map(([label, entries]) => ({label, tools:entries.map(([id,name,description,defaults]) => ({id,name,description,defaults}))}));
export const tools = Object.fromEntries(groups.flatMap(group => group.tools.map(tool => [tool.id, tool])));
const symbols = value => {
  const result = [...new Set((Array.isArray(value) ? value : String(value || "").split(",")).map(key => String(key).trim()).filter(Boolean))];
  if (!result.length || result.length > 150) throw new Error("Enter between one and 150 unique series symbols.");
  return result;
};
function portfolioResults(results) {
  const [name, a] = results[0];
  const curves = results.map(([label, run]) => named(label, a.dates.map(date => run.balances[run.dates.indexOf(date)] ?? null)));
  if (a.benchmarkBalances.length) curves.push(named("Benchmark",a.benchmarkBalances));
  const years = [...new Set(a.dates.map(date => date.slice(0,4)))];
  const latest = a.drift.at(-1);
  const drawdowns = drawdown(a.returns);
  return { stats: a.stats,
    charts:[chart("Portfolio value",a.dates,curves),chart("Drawdown",a.dates,[named(name,drawdowns)])],
    tables:[
      table("Portfolio comparison",["Portfolio",...Object.keys(a.stats)],results.map(([label, run]) => [label,...Object.keys(a.stats).map(key => run.stats[key] ?? null)])),
      table("Return and risk attribution",["Asset","Return contribution","Risk share","Latest weight"],Object.keys(a.contributions).map(key => [key,a.contributions[key],a.risk[key],latest[key] || 0])),
      table("Annual returns",["Year","Portfolio","Benchmark"],years.map(year => {
        const indices = a.dates.map((date,i) => date.startsWith(year) ? i : -1).filter(i => i >= 0);
        return [year,compound(indices.map(i => a.returns[i]))-1,a.benchmark.length ? compound(indices.map(i => a.benchmark[i]))-1 : null];
      })),
      table("Rolling returns",["Years","Average","Best","Worst"],[1,3,5,10].filter(year => a.returns.length >= year*12).map(year => {
        const windows = a.returns.slice(year*12-1).map((_, i) => annualized(a.returns.slice(i,i+year*12)));
        return [year,mean(windows),Math.max(...windows),Math.min(...windows)];
      })),
      table("Allocation drift",["Month",...Object.keys(a.contributions)],a.dates.map((date,i) => [date,...Object.keys(a.contributions).map(key => a.drift[i][key] || 0)])),
      table("Monthly history",["Month","Balance","Return","Dividend income","Fees","Drawdown"],a.dates.map((date,i) => [date,a.balances[i],a.returns[i],a.income[i],a.fees[i],drawdowns[i]]))
    ], series:a.dates.map((date,i) => ({date,value:a.returns[i]})) };
}
function simulationResults(rows, config) {
  const output = simulate(rows,config);
  return { stats:{"Success probability":output.success,"Simulation trials":output.trials,"Median ending balance":output.years.at(-1)[3],"Median funding ratio":output.funding}, charts:[
    chart(config.real ? "Projected balance in today's money" : "Projected balance",output.years.map(row => "Year "+row[0]),[named("10th percentile",output.years.map(row => row[1])),named("Median",output.years.map(row => row[3])),named("90th percentile",output.years.map(row => row[5]))])
  ], tables:[table("Balance percentiles",["Year","P10","P25","P50","P75","P90"],output.years)] };
}
function optimizationResults(rows, config, id) {
  const assets = symbols(config.assets);
  if (id === "rolling") {
    const data = aligned(rows, [...assets,...(config.benchmarkSymbol ? [config.benchmarkSymbol] : [])]);
    const window = Math.max(3,Math.trunc(config.window || 36));
    const interval = Math.max(1,Math.trunc(config.tradeEvery || 12));
    if (data.length < window + 3) throw new Error("The rolling window leaves too little out-of-sample data.");
    const schedule = {};
    for (let i = window; i < data.length; i += interval) schedule[data[i].date] = optimize(data.slice(i-window,i),assets,config).weights;
    const first = Object.values(schedule)[0];
    const report = portfolioResults([["Rolling allocation",backtest(data.slice(window),{...config,benchmark:config.benchmarkSymbol,weights:first,schedule,rebalance:0})]]);
    report.tables.unshift(table("Rebalance history",["Month",...assets],Object.entries(schedule).map(([date, weights]) => [date,...assets.map(key => weights[key])])));
    return report;
  }
  if (id === "frontier") {
    const low = optimize(rows,assets,{...config,method:"Minimum variance"}).expected;
    const high = optimize(rows,assets,{...config,method:"Maximum return"}).expected;
    const steps = Math.min(30,Math.max(3,Math.trunc(config.steps || 15)));
    const rng = random(config.seed || 61);
    const data = aligned(rows,[...assets,...(config.benchmarkSymbol ? [config.benchmarkSymbol] : [])]);
    const samples = Array.from({length: Math.min(30,Math.max(0,Math.trunc(config.resamples || 0)))}, () => data.map(() => data[Math.floor(rng()*data.length)]));
    const points = Array.from({length:steps},(_, i) => {
      const options = {...config,method:"Efficient frontier",target:low+(high-low)*i/(steps-1)};
      const estimate = optimize(data,assets,options);
      if (samples.length) {
        const estimates = samples.map(sample => optimize(sample,assets,options).weights);
        estimate.weights = Object.fromEntries(assets.map(key => [key,mean(estimates.map(weights => weights[key]))]));
        const history = data.map(row => assets.reduce((total,key) => total+row[key]*estimate.weights[key],0));
        estimate.expected = assets.reduce((total,key) => total + estimate.weights[key]*(config.expected?.[key] ?? mean(data.map(row => row[key]))*12),0);
        estimate.volatility = deviation(history)*Math.sqrt(12);
      }
      return estimate;
    }).sort((a,b) => a.volatility-b.volatility);
    return {stats:{"Frontier points":points.length,"Minimum volatility":points[0].volatility},charts:[
      {...chart("Efficient frontier",points.map(point => (point.volatility*100).toFixed(1)+"%"),[named("Expected return",points.map(point => point.expected))]),xValues:points.map(point => point.volatility)}
    ],tables:[table("Frontier allocations",["Expected return","Volatility",...assets],points.map(point => [point.expected,point.volatility,...assets.map(key => point.weights[key])]))]};
  }
  const result = optimize(rows,assets,config);
  return {stats:{"Expected annual return":result.expected,"Expected annual volatility":result.volatility,"Objective value":result.objective},
    tables:[table("Optimized weights",["Asset","Weight"],Object.entries(result.weights))]};
}
function factorsFor(config) { return symbols(models[config.factorModel]?.length ? models[config.factorModel] : config.factors); }
function factorResults(rows, config, id) {
  const factors = factorsFor(config);
  if (["factorAllocation","factorMatch"].includes(id)) {
    const exposures = id === "factorMatch" ? factorFit(rows,config.asset,factors).exposures : config.targets;
    const result = factorMatch(rows,symbols(config.assets),factors,exposures);
    return {stats:{"Exposure error":result.error},tables:[
      table("Matched weights",["Asset","Weight"],Object.entries(result.weights)),
      table("Factor targets",["Factor","Target","Achieved"],factors.map(key => [key,exposures[key] ?? 0,result.exposures[key]]))
    ]};
  }
  const assets = id === "fundFactor" ? symbols(config.assets) : [config.asset];
  const fits = assets.map(asset => factorFit(rows,asset,factors,config.riskFree));
  const fit = fits[0];
  const annualAlpha = fit.coefficients[0]*12;
  return {stats:{"Annualized alpha":annualAlpha,"R squared":fit.r2,"Observations":fit.y.length},charts:[
    chart("Observed and fitted monthly excess returns",fit.dates,[named("Observed",fit.y),named("Fitted",fit.predicted)])
  ],tables:[
    table("Factor loadings",["Asset","Annualized alpha","R squared",...factors],fits.map((item,i) => [assets[i],item.coefficients[0]*12,item.r2,...factors.map(key => item.exposures[key])])),
    table("Factor return attribution",["Factor","Contribution"],[...Object.entries(fit.attribution),["Alpha",annualAlpha]])
  ]};
}
export function runTool(id, input, allRows, metadata, presets) {
  const instance = tools[id];
  if (!instance) throw new Error("Choose an analysis tool.");
  const config = {...instance.defaults,...input};
  const rows = allRows.filter(row => (!config.start || row.date >= config.start) && (!config.end || row.date <= config.end));
  if (rows.length < 3) throw new Error("The selected dates need at least three monthly records.");
  if (config.assetWeights) {
    const weights = weightsFrom(config.assetWeights);
    const result = backtest(rows,{weights,rebalance:config.rebalance ?? 12});
    const byDate = new Map(result.dates.map((date,i) => [date,result.returns[i]]));
    for (let i = 0; i < rows.length; i++) if (byDate.has(rows[i].date)) rows[i] = {...rows[i],PORTFOLIO:byDate.get(rows[i].date)};
    config.asset = "PORTFOLIO";
  }
  if (id === "market") {
    const found = Object.keys(metadata).filter(key => rows.some(row => Number.isFinite(row[key])));
    const dates = rows.map(row => row.date);
    const indicators = ["GDP","CPI","UNEMPLOYMENT","FEDFUNDS","TREASURY10Y","OIL","PE10"].filter(key => rows.some(row => Number.isFinite(row[key])));
    const use = found.filter(key => metadata[key].type !== "Country").slice(0,4);
    const countries = found.filter(key => metadata[key].type === "Country");
    const assetClasses = found.filter(key => metadata[key].type !== "Country");
    const modelRows = Object.entries(presets).flatMap(([name,weights]) => {
      if (!Object.keys(weights).every(key => found.includes(key))) return [];
      const test = backtest(rows,{weights,rebalance:12});
      return [[name,...[12,36,60].map(n => test.returns.length < n ? null : annualized(test.returns.slice(-n)))]];
    });
    const spreads = [["SMALL","EQ","Small vs. broad equity"],["VALUE","GROWTH","Value vs. growth"]];
    const style = spreads.flatMap(([a,b,label]) => {
      if (!rows.some(row => Number.isFinite(row[a]) && Number.isFinite(row[b]))) return [];
      let level = 1;
      return [named(label,rows.map(row => Number.isFinite(row[a]) && Number.isFinite(row[b]) ? (level *= (1+row[a])/(1+row[b]))-1 : null))];
    });
    return {stats:{"Series":found.length,"First month":dates[0],"Latest month":dates.at(-1),"Model portfolios":modelRows.length},
      charts:[...(use.length ? [chart("Growth of 100",dates,use.map(key => {
        let balance = 100; return named(key,rows.map(row => Number.isFinite(row[key]) ? balance *= 1+row[key] : null));
      }))] : []),...(style.length ? [chart("Style comparisons",dates,style)] : [])],
      tables:[...(countries.length ? [table("Global markets",["Market","1 year","3 years","5 years"],marketReturns(rows,countries).map(([key,...values]) => [metadata[key].name,...values]))] : []),
        table("Trailing asset returns",["Series","1 year","3 years","5 years"],marketReturns(rows,assetClasses)),
        table("Model portfolios",["Model","1 year","3 years","5 years"],modelRows),
        table("Economic indicators",["Series","Latest value"],indicators.map(key => [key,openReturns(rows,key).at(-1)]))]};
  }
  if (["allocation","portfolio","dynamic"].includes(id)) {
    const main = backtest(rows,config);
    const others = Object.entries(config.compare || {}).map(([name, weights]) => [name,backtest(rows,{...config,weights,schedule:undefined})]);
    return portfolioResults([["Portfolio",main],...others]);
  }
  if (["manager","performance"].includes(id)) {
    const comparisons = id === "performance" && config.assets ? symbols(config.assets).filter(key => key !== config.asset) : [];
    const use = [config.asset,...comparisons];
    const common = aligned(rows,[...use,...(config.benchmark ? [config.benchmark] : [])]);
    const report = portfolioResults(use.map(key => [key,backtest(common,{...config,weights:{[key]:1}})]));
    if (config.showRegimes && config.benchmark) {
      report.tables.push(table("Benchmark regimes",["Asset","Up-market average","Down-market average"],use.map(key => [key,
        mean(common.filter(row => row[config.benchmark] >= 0).map(row => row[key])),
        mean(common.filter(row => row[config.benchmark] < 0).map(row => row[key]))])));
    }
    if (id === "manager" && config.benchmark) {
      const fit = factorFit(common,config.asset,[config.benchmark]);
      report.tables.push(metrics({"Benchmark beta":fit.coefficients[1],"Annualized alpha":fit.coefficients[0]*12,"R squared":fit.r2}));
    }
    return report;
  }
  if (["monte","goals","liability"].includes(id)) return simulationResults(rows,config);
  if (["frontier","optimize","black","rolling"].includes(id)) return optimizationResults(rows,config,id);
  if (["factor","factorAllocation","factorMatch","fundFactor","attribution"].includes(id)) return factorResults(rows,config,id);
  if (id === "pca") {
    const assets = symbols(config.assets);
    return {tables:[table("Principal components",["Component","Variance explained",...assets],pca(rows,assets))]};
  }
  if (["correlation","classCorrelation","factorStats"].includes(id)) {
    const assets = symbols(config.assets);
    const result = correlations(rows,assets);
    const charts = [];
    if (id === "correlation" && assets.length > 1) {
      const span = Math.min(result.dates.length,Math.max(3,Math.trunc(config.window || 36)));
      const data = aligned(rows,assets);
      charts.push(chart("Rolling correlation with "+assets[0],result.dates.slice(span-1),assets.slice(1).map(key => named(key,data.slice(span-1).map((_,i) => {
        const window = data.slice(i,i+span);
        return correlation(window.map(row => row[assets[0]]),window.map(row => row[key]));
      })))));
    }
    return {stats:{"Common observations":result.dates.length},charts,tables:[table("Correlation matrix",["Series",...assets],result.values.map((row,i) => [assets[i],...row])),
      table("Return statistics",["Series","Annualized return","Volatility"],assets.map((key,i) => [key,result.annualized[i],result.volatility[i]]))]};
  }
  if (id === "auto") {
    const values = autocorrelation(rows,config.asset,config.lags);
    return {charts:[chart("Autocorrelation",values.map(row => "Lag "+row[0]),[named(config.asset,values.map(row => row[1]))])],tables:[table("Lag statistics",["Lag","Correlation"],values)]};
  }
  if (id === "cointegration") {
    const result = cointegration(rows,config.asset,config.benchmark);
    return {stats:{"Hedge ratio":result.hedgeRatio,"Residual unit-root statistic":result.statistic,"Estimated half-life in months":result.halfLife},
      note:"This zero-lag residual test reports a statistic and does not supply a significance decision or p-value.",
      charts:[chart("Log-price residual",result.dates,[named("Residual",result.residual)])],
      tables:[table("Residual history",["Month","Residual"],result.dates.map((date,i) => [date,result.residual[i]]))]};
  }
  if (id === "screener" || id === "ranking") {
    const rankIndex = {"Return":6,"Volatility":7,"Sharpe":8,"Drawdown":9}[config.rankBy] ?? 8;
    const data = fundRows(rows,metadata,{...config,rankIndex});
    if (config.rankBy === "Volatility") data.reverse();
    return {stats:{"Matches":data.length},tables:[table("Matching funds",["Symbol","Name","Category","Type","Expense ratio","Months","Annualized return","Volatility","Sharpe","Drawdown"],data)]};
  }
  if (id === "tactical") {
    const result = tactical(rows,symbols(config.assets),config);
    const report = portfolioResults([[config.strategy,result],["Buy and hold comparison",result.baseline]]);
    const months = Object.keys(result.schedule);
    const assets = [...new Set([...Object.keys(result.future || {}),...months.flatMap(month => Object.keys(result.schedule[month]))])];
    report.tables.unshift(table(result.future ? "Next allocation for "+result.nextDate : "No scheduled rebalance for "+result.nextDate,["Asset","Weight"],Object.entries(result.future || {})),
      table("Historical signal allocations",["Month",...assets],months.map(date => [date,...assets.map(key => result.schedule[date][key] || 0)])));
    return report;
  }
  throw new Error("Analysis unavailable.");
}
