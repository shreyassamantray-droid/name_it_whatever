
import { annualized, cholesky, clamp, compound, correlation, covarianceMatrix, deviation, dot, mean, normal, quantile, random, regression, sum, transpose } from "./math.js";
import { aligned, backtest, optimize, summary, weightsFrom } from "./portfolio.js";

export function correlations(rows, symbols) {
  const data = aligned(rows, symbols);
  const series = symbols.map(key => data.map(row => row[key]));
  return { dates: data.map(row => row.date), values: series.map(a => series.map(b => correlation(a, b))),
    annualized: series.map(values => annualized(values)), volatility: series.map(values => deviation(values) * Math.sqrt(12)) };
}
export function autocorrelation(rows, symbol, lagCount = 12) {
  const values = aligned(rows, [symbol]).map(row => row[symbol]);
  return Array.from({length: Math.min(Math.max(1, Math.trunc(lagCount)), values.length - 2)}, (_, i) => {
    const lag = i + 1;
    return [lag, correlation(values.slice(lag), values.slice(0, -lag))];
  });
}
export function cointegration(rows, a, b) {
  const data = aligned(rows, [a, b]);
  const cumulative = name => {
    let level = 0;
    return data.map(row => {
      if (row[name] <= -1) throw new Error("Log prices require returns above -100%.");
      level += Math.log(1 + row[name]);
      return level;
    });
  };
  const fit = regression(cumulative(a), [cumulative(b)]);
  const residual = fit.residuals;
  const prior = residual.slice(0, -1);
  const changes = residual.slice(1).map((value, i) => value - prior[i]);
  const adf = regression(changes, [prior]);
  const variance = sum(adf.residuals.map(value => value ** 2)) / (changes.length - 2);
  const centered = sum(prior.map(value => (value - mean(prior)) ** 2));
  const phi = adf.coefficients[1] + 1;
  return { dates: data.map(row => row.date), residual, hedgeRatio: fit.coefficients[1],
    statistic: adf.coefficients[1] / Math.sqrt(variance / centered),
    halfLife: phi > 0 && phi < 1 ? Math.log(.5) / Math.log(phi) : null };
}
export function pca(rows, symbols) {
  const columns = transpose(aligned(rows, symbols).map(row => symbols.map(key => row[key])));
  let covariance = covarianceMatrix(columns);
  const total = sum(covariance.map((row, i) => row[i]));
  if (total <= 0) throw new Error("Principal components require variable inputs.");
  return symbols.map((_, component) => {
    let v = symbols.map((_, j) => Math.sin((component + 1) * (j + 1)) + .3);
    for (let i = 0; i < 120; i++) {
      const projected = covariance.map(row => dot(row, v));
      const size = Math.sqrt(dot(projected, projected));
      if (size < 1e-14) break;
      v = projected.map(value => value / size);
    }
    const eigenvalue = Math.max(0, dot(v, covariance.map(row => dot(row, v))));
    covariance = covariance.map((row, i) => row.map((value, j) => value - eigenvalue * v[i] * v[j]));
    return [component + 1, eigenvalue / total, ...v];
  });
}
export function simulate(rows, config) {
  const { weights: weightInput, mode = "Historical", seed = 43 } = config;
  const weights = weightsFrom(weightInput);
  const symbols = Object.keys(weights);
  const vector = Object.values(weights);
  const data = aligned(rows, symbols);
  const matrix = data.map(row => symbols.map(key => row[key]));
  const byAsset = transpose(matrix);
  const rng = random(seed);
  const months = clamp(Math.trunc(config.years || 25) * 12, 12, 720);
  const count = clamp(Math.trunc(config.trials || 500), 25, 5000);
  const block = clamp(Math.trunc(config.block || 12), 1, matrix.length);
  const means = symbols.map((key, i) => mode === "Forecast" && config.expected?.[key] != null ? (1 + config.expected[key]) ** (1 / 12) - 1 : mean(byAsset[i]));
  const vol = symbols.map((key, i) => mode === "Forecast" && config.volatility?.[key] != null ? config.volatility[key] / Math.sqrt(12) : deviation(byAsset[i]));
  const corr = config.correlation || byAsset.map((a, i) => byAsset.map((b, j) => i === j ? 1 : correlation(a, b)));
  if (corr.length !== vector.length || corr.some((row, i) => row.length !== vector.length || Math.abs((row[i] ?? 0) - 1) > 1e-8 || row.some((value, j) => !Number.isFinite(value) || Math.abs(value) > 1 || Math.abs(value - corr[j]?.[i]) > 1e-8))) throw new Error("Supply a symmetric correlation matrix matching the portfolio.");
  const lower = cholesky(corr);
  const snapshots = Array.from({length: months / 12 + 1}, () => []);
  let successes = 0;
  const starting = config.initial ?? 100000;
  const period = config.rebalance ?? 12;
  const stages = (config.stages || []).filter(stage => stage.from > 0);
  const discountRate = (1 + (config.discountRate ?? .035)) ** (1 / 12) - 1;
  const tier = config.taxRate || 0;
  const funding = [];
  for (let trial = 0; trial < count; trial++) {
    let level = starting, priceLevel = 1, successful = true, pointer = 0;
    let current = [...vector];
    let initialReturns = [];
    if (config.sequenceRisk && mode === "Historical") {
      initialReturns = matrix.map((values, i) => ({ values, i })).sort((a, b) => dot(a.values, vector) - dot(b.values, vector)).slice(0, 12);
    }
    snapshots[0].push(starting);
    for (let m = 0; m < months; m++) {
      if (period > 0 && m % period === 0) current = [...vector];
      let selected, historicInflation = 0;
      if (mode === "Historical") {
        if (m % block === 0) pointer = Math.floor(rng() * matrix.length);
        const idx = initialReturns[m]?.i ?? pointer;
        selected = matrix[idx];
        historicInflation = data[idx].CPI || 0;
        pointer = (pointer + 1) % matrix.length;
      } else if (mode === "Parameterized") {
        const spread = (config.volatilityRate ?? .12) / Math.sqrt(12);
        const z = config.distribution === "Student t" ? normal(rng) * Math.sqrt(5 / sum(Array.from({length:5}, () => normal(rng) ** 2))) * Math.sqrt(.6) : normal(rng);
        selected = vector.map(() => (config.returnRate ?? .06) / 12 + spread * z);
      } else {
        const noise = vector.map(() => normal(rng));
        selected = means.map((value, i) => value + vol[i] * dot(lower[i], noise));
      }
      const clipped = selected.map(value => Math.max(-.9999, value));
      const monthly = dot(current, clipped);
      const net = monthly - Math.max(0, monthly) * tier;
      const year = Math.floor(m / 12) + 1;
      const stage = stages.filter(item => year >= item.from && year <= (item.to ?? 100)).at(-1);
      const inflation = config.inflationMode === "Historical" && mode === "Historical" ? historicInflation :
        (config.inflation || 0) / 12 + (config.inflationVol || 0) / Math.sqrt(12) * normal(rng);
      priceLevel *= 1 + Math.max(inflation, -.99);
      let cash = config.cashflows?.[m] ?? ((stage?.cashflow ?? config.monthlyCash ?? 0) * (config.inflationAdjusted ? priceLevel : 1));
      if (config.withdrawal === "Percentage") cash -= level * (config.withdrawalRate || .04) / 12;
      if (config.withdrawal === "Life expectancy") cash -= level / Math.max(1, (config.lifeExpectancy || 95) - (config.age || 65) - year + 1) / 12;
      const liability = (config.liabilities?.[m] ?? config.monthlyLiability ?? 0) * (config.inflationAdjusted ? priceLevel : 1);
      level = level * (1 + net) + cash - liability;
      if (level < 0) { successful = false; level = 0; }
      current = 1 + monthly > 0 ? current.map((weight, i) => weight * (1 + clipped[i]) / (1 + monthly)) : [...vector];
      if ((m + 1) % 12 === 0) snapshots[(m + 1) / 12].push(config.real ? level / priceLevel : level);
    }
    const fundingRatio = config.terminalLiability ? (level / (1 + discountRate) ** months) / config.terminalLiability : null;
    if (fundingRatio !== null) funding.push(fundingRatio);
    if (successful && level >= (config.goal || 0) && (fundingRatio === null || fundingRatio >= (config.targetFundingRatio || 1))) successes++;
  }
  return { success: successes / count, trials: count,
    funding: funding.length ? quantile(funding, .5) : null,
    years: snapshots.map((values, i) => [i, ...[.1, .25, .5, .75, .9].map(p => quantile(values, p))]) };
}
export function tactical(rows, symbols, options) {
  const mode = options.strategy;
  const use = [...new Set([...symbols, options.safe || "CASH", ...(mode === "Valuation" ? [options.valuation || "PE10"] : [])])];
  const data = aligned(rows, use);
  const lookback = clamp(Math.trunc(options.lookback || 10), 2, 120);
  if (data.length < lookback + 4) throw new Error("The tactical model needs a longer history.");
  const safe = options.safe || "CASH";
  const count = clamp(Math.trunc(options.hold || 1), 1, symbols.length);
  const base = options.weights ? weightsFrom(options.weights) : Object.fromEntries(symbols.map(key => [key, 1 / symbols.length]));
  if (Object.keys(base).some(key => !symbols.includes(key))) throw new Error("The base portfolio weights must use symbols in the tactical universe.");
  const allCash = { [safe]: 1 };
  const choose = (history, tradeDate) => {
    const last = history.at(-1);
    const series = key => history.slice(-lookback).map(row => row[key]);
    const growth = key => compound(series(key)) - 1;
    if (mode === "Valuation") {
      const [low, high] = options.thresholds || [18, 27];
      const value = last[options.valuation || "PE10"];
      const equity = value > high ? .4 : value < low ? .8 : .6;
      return { [symbols[0]]: equity, [symbols[1] || safe]: 1 - equity };
    }
    if (mode === "Seasonal") return (options.outMonths || [5,6,7,8,9,10]).includes(Number(tradeDate.slice(5,7))) ? allCash : base;
    if (mode === "Moving average" || mode === "Portfolio moving averages") {
      const passes = key => {
        let price = 1;
        const levels = series(key).map(value => price *= 1 + value);
        return levels.at(-1) >= mean(levels);
      };
      if (mode === "Moving average") return passes(symbols[0]) ? base : allCash;
      const result = { [safe]: 0 };
      for (const [key, weight] of Object.entries(base)) {
        const chosen = passes(key) ? key : safe;
        result[chosen] = (result[chosen] || 0) + weight;
      }
      return result;
    }
    if (mode === "Target volatility") {
      const predicted = deviation(history.slice(-lookback).map(row => sum(Object.entries(base).map(([key, weight]) => row[key] * weight)))) * Math.sqrt(12);
      const risky = predicted ? Math.min(1, (options.targetVol || .1) / predicted) : 1;
      const result = Object.fromEntries(Object.entries(base).map(([key, weight]) => [key, weight * risky]));
      result[safe] = (result[safe] || 0) + 1 - risky;
      return result;
    }
    const ranked = [...symbols].sort((a,b) => growth(b) - growth(a)).slice(0, count);
    if (mode === "Dual momentum") {
      const selected = ranked.filter(key => growth(key) > growth(safe));
      const result = Object.fromEntries(selected.map(key => [key, 1 / count]));
      if (selected.length < count) result[safe] = (result[safe] || 0) + 1 - selected.length / count;
      return result;
    }
    if (mode === "Adaptive allocation") {
      if (options.adaptiveMethod === "Minimum variance") return optimize(history.slice(-lookback), ranked, {method:"Minimum variance"}).weights;
      const inverse = ranked.map(key => 1 / Math.max(1e-5, deviation(series(key))));
      return Object.fromEntries(ranked.map((key, i) => [key, inverse[i] / sum(inverse)]));
    }
    return Object.fromEntries(ranked.map(key => [key, 1 / ranked.length]));
  };
  const schedule = {};
  const delay = clamp(Math.trunc(options.signalLag ?? 0), 0, 12);
  const rebalance = clamp(Math.trunc(options.tradeEvery || (mode === "Valuation" ? 12 : 1)), 1, 12);
  const start = lookback + delay;
  for (let i = start; i < data.length; i += rebalance) schedule[data[i].date] = choose(data.slice(0, i - delay), data[i].date);
  if (!data[start]) throw new Error("The trading lag leaves no backtest history.");
  const last = data.at(-1).date;
  const [year, month] = last.split("-").map(Number);
  const nextDate = (year + Number(month === 12)) + "-" + String(month % 12 + 1).padStart(2, "0");
  const isTrade = (data.length - start) % rebalance === 0;
  const future = isTrade ? choose(data.slice(0, data.length - delay), nextDate) : null;
  const result = backtest(data.slice(start), { ...options, weights: base, schedule, rebalance: 0 });
  return { ...result, schedule, future, nextDate, baseline: backtest(data.slice(start), { ...options, weights: base, rebalance: 12 }) };
}
export function marketReturns(rows, symbols, windows = [12,36,60]) {
  return symbols.map(name => {
    const values = rows.filter(row => Number.isFinite(row[name])).map(row => row[name]);
    return [name, ...windows.map(window => values.length < window ? null : annualized(values.slice(-window)))];
  });
}
export function fundRows(rows, metadata, filters) {
  const target = filters.benchmark;
  return Object.entries(metadata).flatMap(([symbol, entry]) => {
    if (entry.type === "Country" || entry.type === "Index" || entry.type === "Asset class") return [];
    if (filters.category && filters.category !== entry.category) return [];
    if (filters.type && filters.type !== entry.type) return [];
    if (filters.maxFee != null && (!Number.isFinite(entry.fee) || entry.fee > filters.maxFee)) return [];
    const data = rows.filter(row => Number.isFinite(row[symbol]) && (!target || Number.isFinite(row[target])));
    if (data.length < Math.max(3, filters.minMonths || 3)) return [];
    const values = data.map(row => row[symbol]);
    const stats = summary(values, target ? data.map(row => row[target]) : null);
    return [[symbol, entry.name, entry.category, entry.type, entry.fee, data.length, stats["Annualized return"], stats["Annualized volatility"], stats["Sharpe ratio"], stats["Maximum drawdown"]]];
  }).sort((a,b) => (b[filters.rankIndex ?? 8] ?? -Infinity) - (a[filters.rankIndex ?? 8] ?? -Infinity));
}
