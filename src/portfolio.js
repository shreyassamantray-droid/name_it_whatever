
import { annualized, compound, correlation, covarianceMatrix, deviation, dot, drawdown, mean, quantile, regression, solve, sum, transpose } from "./math.js";

export function weightsFrom(input) {
  const weights = typeof input === "string" ? Object.fromEntries(input.split(",").map(pair => {
    const [name, raw] = pair.trim().split(":");
    return [name, raw?.trim().endsWith("%") ? Number(raw.trim().slice(0, -1)) / 100 : Number(raw)];
  })) : { ...input };
  const values = Object.values(weights);
  if (!values.length || Object.keys(weights).some(key => !key) || values.some(value => !Number.isFinite(value)) || Math.abs(sum(values) - 1) > .00001) throw new Error("Weights must be numbers totaling 1 (or 100%).");
  return weights;
}
export function aligned(rows, symbols) {
  const data = rows.filter(row => symbols.every(key => Number.isFinite(row[key])));
  if (data.length < 3) throw new Error("At least three overlapping monthly observations are required for " + symbols.join(", ") + ".");
  return data;
}
export function summary(returns, benchmark = null, riskFree = 0) {
  const volatility = deviation(returns) * Math.sqrt(12);
  const excess = returns.map(value => value - riskFree);
  const downside = Math.sqrt(mean(excess.map(value => Math.min(value, 0) ** 2))) * Math.sqrt(12);
  const stats = {
    "Total return": compound(returns) - 1,
    "Annualized return": annualized(returns),
    "Annualized volatility": volatility,
    "Maximum drawdown": Math.min(...drawdown(returns)),
    "Sharpe ratio": volatility ? mean(excess) * 12 / volatility : null,
    "Sortino ratio": downside ? mean(excess) * 12 / downside : null,
    "Monthly 95% VaR": -quantile(returns, .05),
    "Positive months": mean(returns.map(value => Number(value > 0)))
  };
  if (benchmark) {
    const active = returns.map((value, i) => value - benchmark[i]);
    const tracking = deviation(active) * Math.sqrt(12);
    Object.assign(stats, {
      "Benchmark correlation": correlation(returns, benchmark),
      "Tracking error": tracking,
      "Information ratio": tracking ? mean(active) * 12 / tracking : null
    });
  }
  return stats;
}
function annualFee(config, balance) {
  const direct = (config.feeRate || 0) * Math.max(0, balance) + (config.fixedFee || 0);
  const tier = [...(config.feeTiers || [])].sort((a,b) => b.minimum - a.minimum).find(item => balance >= item.minimum);
  return direct + (tier ? balance * (tier.rate || 0) + (tier.amount || 0) : 0);
}
function moneyWeighted(flows) {
  const npv = rate => sum(flows.map((cash, i) => cash / (1 + rate) ** i));
  let low = -.99, high = 1;
  while (npv(low) * npv(high) > 0 && high < 128) high *= 2;
  if (Math.sign(npv(low)) === Math.sign(npv(high))) return null;
  for (let i = 0; i < 75; i++) {
    const mid = (low + high) / 2;
    if (Math.sign(npv(mid)) === Math.sign(npv(low))) low = mid;
    else high = mid;
  }
  return (1 + (low + high) / 2) ** 12 - 1;
}
export function backtest(rows, config) {
  const initial = config.initial ?? 100000;
  if (!(initial > 0)) throw new Error("Initial balance must be positive.");
  const original = weightsFrom(config.weights);
  let target = original;
  let live = { ...target };
  const schedule = Object.entries(config.schedule || {}).sort(([a], [b]) => a.localeCompare(b)).map(([date, model]) => [date, weightsFrom(model)]);
  const symbols = [...new Set([...Object.keys(target), ...schedule.flatMap(([, model]) => Object.keys(model))])];
  const data = rows.filter(row => (!config.start || row.date >= config.start) && (!config.end || row.date <= config.end));
  const dates = [], returns = [], balances = [], income = [], fees = [], drift = [], cashflows = [-initial];
  const assets = Object.fromEntries(symbols.map(key => [key, []]));
  const contributions = Object.fromEntries(symbols.map(key => [key, 0]));
  let balance = initial, benchmarkLevel = initial, inflationIndex = 1, scheduleIndex = 0;
  const benchmark = [], benchmarkBalances = [];
  for (const row of data) {
    const allocationDate = schedule[scheduleIndex]?.[0];
    if (allocationDate && row.date >= allocationDate) {
      while (schedule[scheduleIndex] && row.date >= schedule[scheduleIndex][0]) {
        target = schedule[scheduleIndex][1];
        scheduleIndex++;
      }
      live = { ...target };
    }
    if (Object.keys(target).some(key => !Number.isFinite(row[key])) || (config.benchmark && !Number.isFinite(row[config.benchmark]))) continue;
    const month = Number(row.date.slice(5, 7));
    const i = returns.length;
    const frequency = config.rebalance ?? 12;
    const bands = Object.keys(target).some(key => (config.band != null && Math.abs((live[key] || 0) - target[key]) >= config.band) || (config.relativeBand != null && target[key] && Math.abs((live[key] || 0) / target[key] - 1) >= config.relativeBand));
    if ((frequency > 0 && (month - 1) % frequency === 0) || bands) live = { ...target };
    const keys = Object.keys(live);
    const assetReturns = keys.map(key => {
      const distribution = row[key + "_DIV"] || 0;
      return row[key] - (config.reinvest === false ? distribution : 0) - (config.expenses?.[key] || 0) / 12;
    });
    const heldWeights = keys.map(key => live[key]);
    const unlevered = dot(assetReturns, heldWeights);
    const leverage = config.leverage ?? 1;
    const returnBeforeFees = Math.max(-1, unlevered * leverage - Math.max(0, leverage - 1) * (config.debtRate || 0) / 12);
    inflationIndex *= 1 + (row.CPI || 0);
    const cashSetting = config.cashflows?.[i] ?? config.cashflow ?? 0;
    const cash = cashSetting * (config.inflationAdjusted ? inflationIndex : 1) - Math.max(0, balance) * (config.withdrawalRate || 0) / 12;
    const billing = Math.max(1, Math.min(12, Math.trunc(config.feeFrequency ?? 12)));
    const fee = (month - 1) % billing === billing - 1 && balance > 0 ? Math.min(balance * (1 + returnBeforeFees), (annualFee(config, balance) + Math.max(0, returnBeforeFees) * balance * (config.performanceFee || 0) * billing / 12) * billing / 12) : 0;
    const net = balance > 0 ? returnBeforeFees - fee / balance : returnBeforeFees;
    const dividend = balance * dot(keys.map(key => row[key + "_DIV"] || 0), heldWeights);
    keys.forEach((key, j) => { contributions[key] += live[key] * assetReturns[j] * balance; });
    for (const key of symbols) assets[key].push((live[key] || 0) * (assetReturns[keys.indexOf(key)] || 0));
    balance = Math.max(0, balance * (1 + net) + cash);
    const divisor = 1 + unlevered;
    live = divisor > 0 ? Object.fromEntries(keys.map((key, j) => [key, live[key] * (1 + assetReturns[j]) / divisor])) : { ...target };
    dates.push(row.date); returns.push(net); balances.push(balance); income.push(dividend); fees.push(fee); drift.push({ ...live }); cashflows.push(-cash);
    if (config.benchmark) {
      benchmark.push(row[config.benchmark]);
      benchmarkLevel *= 1 + row[config.benchmark];
      benchmarkBalances.push(benchmarkLevel);
    }
  }
  if (returns.length < 3) throw new Error("The backtest needs at least three overlapping months.");
  cashflows[cashflows.length - 1] += balance;
  const latestYear = dates.at(-1).slice(0,4);
  const ytd = returns.filter((_, i) => dates[i].startsWith(latestYear));
  const stats = { "Start balance": initial, "End balance": balance, ...summary(returns, benchmark.length ? benchmark : null, (config.riskFree || 0) / 12), "Year-to-date return": compound(ytd) - 1, "Money-weighted return": moneyWeighted(cashflows) };
  return { dates, returns, balances, fees, income, drift, benchmark, benchmarkBalances, stats, contributions,
    risk: Object.fromEntries(symbols.map(key => [key, deviation(returns) ? correlation(assets[key], returns) * deviation(assets[key]) / deviation(returns) : 0])) };
}
function objective(name, weights, means, covariance, rows, options) {
  const expected = dot(means, weights);
  const variance = Math.max(0, dot(weights, covariance.map(row => dot(row, weights))));
  const risk = Math.sqrt(variance);
  const hurdle = (options.target || 0) / 12;
  if (name === "Minimum variance") return -variance;
  if (name === "Maximum return") return expected;
  if (name === "Mean-variance utility") return expected - (options.aversion || 6) * variance / 2;
  if (name === "Efficient frontier") return -variance - 50 * (expected - hurdle) ** 2;
  if (name === "Risk parity") {
    const contributions = covariance.map((row, i) => weights[i] * dot(row, weights) / (variance || 1));
    return -sum(contributions.map((x, i) => (x - (options.riskBudget?.[i] ?? 1 / weights.length)) ** 2));
  }
  if (name === "Maximum Sharpe") return (expected - (options.riskFree || 0) / 12) / Math.max(1e-8, risk);
  const returns = rows.map(row => dot(row, weights));
  const excess = returns.map(value => value - hurdle);
  if (name === "CVaR") {
    const cutoff = quantile(returns, .05);
    return mean(returns.filter(value => value <= cutoff));
  }
  if (name === "Tracking error" || name === "Information ratio") {
    if (!options.benchmark) throw new Error("Set a benchmark for this objective.");
    const active = returns.map((value, i) => value - options.benchmark[i]);
    const volatility = deviation(active);
    return name === "Tracking error" ? -volatility : mean(active) / Math.max(1e-8, volatility);
  }
  if (name === "Kelly") return mean(returns.map(value => Math.log(Math.max(1e-8, 1 + value))));
  if (name === "Sortino") return mean(excess) / Math.max(1e-8, Math.sqrt(mean(excess.map(value => Math.min(value, 0) ** 2))));
  if (name === "Omega") return sum(excess.map(value => Math.max(value, 0))) / Math.max(1e-8, -sum(excess.map(value => Math.min(value, 0))));
  if (name === "Maximum drawdown") return Math.min(...drawdown(returns)) - Math.max(0, hurdle - expected) * 12;
  throw new Error("Unknown optimization objective.");
}
function feasibleStart(symbols, options) {
  const bounds = symbols.map(key => options.bounds?.[key] || [0, 1]);
  const groups = (options.groups || []).map(group => ({
    indices: group.assets.map(key => {
      const index = symbols.indexOf(key);
      if (index < 0) throw new Error("Unknown group asset " + key + ".");
      return index;
    }), low: group.min ?? 0, high: group.max ?? 1, name: group.name
  }));
  const assigned = groups.flatMap(group => group.indices);
  if (new Set(assigned).size !== assigned.length) throw new Error("Each asset can belong to at most one group.");
  const free = symbols.map((_, i) => i).filter(i => !assigned.includes(i));
  if (free.length) groups.push({ indices: free, low: 0, high: 1, name: "Ungrouped" });
  if (bounds.some(([low, high]) => !Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 1 || low > high)) throw new Error("Invalid per-asset bounds.");
  const w = bounds.map(([low]) => low);
  const add = (indices, amount) => {
    for (const i of indices) {
      const increment = Math.min(amount, bounds[i][1] - w[i]);
      w[i] += increment; amount -= increment;
    }
    return amount;
  };
  for (const group of groups) {
    const base = sum(group.indices.map(i => w[i]));
    if (base > group.high + 1e-8 || group.low > group.high || add(group.indices, Math.max(0, group.low - base)) > 1e-8) throw new Error("Infeasible bounds for " + group.name + ".");
  }
  if (sum(w) > 1 + 1e-8) throw new Error("Minimum weights exceed 100%.");
  for (const group of groups) {
    const available = Math.max(0, group.high - sum(group.indices.map(i => w[i])));
    add(group.indices, Math.min(available, Math.max(0, 1 - sum(w))));
  }
  if (sum(w) < 1 - 1e-8) throw new Error("Maximum constraints leave unallocated weight.");
  const valid = weights => weights.every((value, i) => value >= bounds[i][0] - 1e-9 && value <= bounds[i][1] + 1e-9) && groups.every(group => {
    const total = sum(group.indices.map(i => weights[i]));
    return total >= group.low - 1e-9 && total <= group.high + 1e-9;
  });
  return { w, valid };
}
export function optimize(rows, symbols, options = {}) {
  const data = aligned(rows, [...symbols, ...(options.benchmarkSymbol ? [options.benchmarkSymbol] : [])]);
  const matrix = data.map(row => symbols.map(key => row[key]));
  const history = transpose(matrix);
  const means = symbols.map((key, i) => (options.expected?.[key] != null ? options.expected[key] / 12 : mean(history[i])));
  let covariance = covarianceMatrix(history);
  if (options.volatility) {
    covariance = covariance.map((row, i) => row.map((value, j) => {
      const vi = deviation(history[i]), vj = deviation(history[j]);
      const ci = options.volatility[symbols[i]] != null ? options.volatility[symbols[i]] / Math.sqrt(12) : vi;
      const cj = options.volatility[symbols[j]] != null ? options.volatility[symbols[j]] / Math.sqrt(12) : vj;
      return i === j ? ci ** 2 : vi && vj ? value / (vi * vj) * ci * cj : 0;
    }));
  }
  if (options.correlation) {
    const n = symbols.length, correlations = options.correlation;
    if (correlations.length !== n || correlations.some((row, i) => row.length !== n || row.some((value, j) => !Number.isFinite(value) || Math.abs(value) > 1 || Math.abs(value - correlations[j]?.[i]) > 1e-8) || Math.abs(row[i] - 1) > 1e-8)) throw new Error("Supply a symmetric correlation matrix with a diagonal of 1.");
    const vol = covariance.map((row, i) => Math.sqrt(row[i]));
    covariance = covariance.map((row, i) => row.map((_, j) => correlations[i][j] * vol[i] * vol[j]));
  }
  if (options.views) {
    const prior = covariance.map(row => dot(row, options.marketWeights || symbols.map(() => 1 / symbols.length)) * (options.aversion || 2.5));
    const tau = options.tau || .05;
    const picks = options.views.map(view => symbols.map(key => view.weights[key] || 0));
    const errors = options.views.map((view, i) => view.uncertainty ?? Math.max(1e-10, tau * dot(picks[i], covariance.map(row => dot(row, picks[i])))));
    const covPick = covariance.map(row => picks.map(pick => tau * dot(row, pick)));
    const blended = solve(picks.map((pick, i) => picks.map((_, j) => dot(pick, covPick.map(row => row[j])) + (i === j ? errors[i] : 0))),
      options.views.map((view, i) => view.return / 12 - dot(picks[i], prior)));
    prior.forEach((value, i) => { means[i] = value + dot(covPick[i], blended); });
  }
  const opts = { ...options, benchmark: options.benchmarkSymbol ? data.map(row => row[options.benchmarkSymbol]) : null };
  const name = options.method || "Maximum Sharpe";
  const { w, valid } = feasibleStart(symbols, options);
  const equal = symbols.map(() => 1 / symbols.length);
  if (valid(equal)) w.splice(0, w.length, ...equal);
  let best = objective(name, w, means, covariance, matrix, opts);
  for (const step of [.15, .075, .025, .01, .0025, .0005]) {
    for (let pass = 0; pass < 16; pass++) {
      let improved = false;
      for (let from = 0; from < w.length; from++) {
        for (let to = 0; to < w.length; to++) {
          if (from === to || w[from] < step - 1e-9) continue;
          const next = [...w];
          next[from] -= step; next[to] += step;
          if (!valid(next)) continue;
          const result = objective(name, next, means, covariance, matrix, opts);
          if (result <= best + 1e-12) continue;
          w.splice(0, w.length, ...next); best = result; improved = true;
        }
      }
      if (!improved) break;
    }
  }
  return { weights: Object.fromEntries(symbols.map((key, i) => [key, Math.abs(w[i]) < 1e-9 ? 0 : w[i]])), expected: dot(w, means) * 12,
    volatility: Math.sqrt(Math.max(0, 12 * dot(w, covariance.map(row => dot(row, w))))), objective: best };
}
export function factorFit(rows, target, factors, riskFree) {
  const data = aligned(rows, [target, ...factors, ...(riskFree ? [riskFree] : [])]);
  const predictors = factors.map(name => data.map(row => row[name]));
  const y = data.map(row => row[target] - (riskFree ? row[riskFree] : 0));
  const fit = regression(y, predictors);
  return { dates: data.map(row => row.date), y, ...fit, exposures: Object.fromEntries(factors.map((name, i) => [name, fit.coefficients[i + 1]])),
    attribution: Object.fromEntries(factors.map((name, i) => [name, mean(predictors[i]) * fit.coefficients[i + 1] * 12])) };
}
export function factorMatch(rows, candidates, factors, target) {
  const fits = candidates.map(key => factorFit(rows, key, factors));
  const vector = factors.map(key => target[key] ?? 0);
  const score = weights => sum(factors.map((key, i) => (dot(weights, fits.map(fit => fit.exposures[key])) - vector[i]) ** 2));
  let best = candidates.map(() => 1 / candidates.length);
  let loss = score(best);
  for (const step of [.2, .05, .01, .002]) {
    for (let n = 0; n < 50; n++) {
      let improved = false;
      for (let i = 0; i < candidates.length; i++) for (let j = 0; j < candidates.length; j++) {
        if (i === j || best[i] < step) continue;
        const w = [...best]; w[i] -= step; w[j] += step;
        const error = score(w);
        if (error + 1e-12 < loss) { best = w; loss = error; improved = true; }
      }
      if (!improved) break;
    }
  }
  return { weights: Object.fromEntries(candidates.map((key, i) => [key, best[i]])),
    exposures: Object.fromEntries(factors.map(key => [key, dot(best, fits.map(fit => fit.exposures[key]))])), error: Math.sqrt(loss) };
}
