
export const sum = values => values.reduce((total, value) => total + value, 0);
export const mean = values => values.length ? sum(values) / values.length : 0;
export const dot = (a, b) => sum(a.map((value, i) => value * b[i]));
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const transpose = rows => rows[0].map((_, i) => rows.map(row => row[i]));
export const compound = values => values.reduce((level, value) => level * (1 + value), 1);
export function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(p, 0, 1) * (sorted.length - 1);
  const floor = Math.floor(index);
  return sorted[floor] + (index - floor) * (sorted[Math.ceil(index)] - sorted[floor]);
}
export function covariance(a, b) {
  const ma = mean(a), mb = mean(b);
  return sum(a.map((value, i) => (value - ma) * (b[i] - mb))) / Math.max(a.length - 1, 1);
}
export const deviation = values => Math.sqrt(Math.max(0, covariance(values, values)));
export const correlation = (a, b) => covariance(a, b) / (deviation(a) * deviation(b)) || 0;
export const covarianceMatrix = columns => columns.map(a => columns.map(b => covariance(a, b)));
export function solve(matrix, vector) {
  const n = vector.length;
  const rows = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let i = column + 1; i < n; i++) if (Math.abs(rows[i][column]) > Math.abs(rows[pivot][column])) pivot = i;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    if (Math.abs(divisor) < 1e-12) throw new Error("Inputs are singular. Use independent factors or a longer history.");
    rows[column] = rows[column].map(value => value / divisor);
    for (let i = 0; i < n; i++) {
      if (i === column) continue;
      const factor = rows[i][column];
      rows[i] = rows[i].map((value, j) => value - factor * rows[column][j]);
    }
  }
  return rows.map(row => row[n]);
}
export function regression(y, predictors) {
  if (y.length <= predictors.length + 1) throw new Error("The regression needs more observations than coefficients.");
  const columns = [y.map(() => 1), ...predictors];
  const coefficients = solve(columns.map(a => columns.map(b => dot(a, b))), columns.map(a => dot(a, y)));
  const predicted = y.map((_, i) => dot(coefficients, columns.map(column => column[i])));
  const residuals = y.map((value, i) => value - predicted[i]);
  const center = mean(y);
  const total = sum(y.map(value => (value - center) ** 2));
  return { coefficients, predicted, residuals, r2: total ? 1 - dot(residuals, residuals) / total : 0 };
}
export function cholesky(matrix) {
  const lower = matrix.map(row => row.map(() => 0));
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j <= i; j++) {
      let value = matrix[i][j];
      for (let k = 0; k < j; k++) value -= lower[i][k] * lower[j][k];
      if (i === j && value < -1e-9) throw new Error("Correlation matrix must be positive semidefinite.");
      lower[i][j] = i === j ? Math.sqrt(Math.max(value, 1e-12)) : value / lower[j][j];
    }
  }
  return lower;
}
export function random(seed = 23) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return (state + .5) / 4294967296;
  };
}
export const normal = rng => Math.sqrt(-2 * Math.log(rng())) * Math.cos(2 * Math.PI * rng());
export function drawdown(returns) {
  let level = 1, peak = 1;
  return returns.map(value => {
    level *= 1 + value;
    peak = Math.max(level, peak);
    return peak ? level / peak - 1 : -1;
  });
}
export function annualized(returns, periods = 12) {
  return compound(returns) ** (periods / returns.length) - 1;
}
export function csvParse(source) {
  const records = [];
  let row = [], value = "", quoted = false;
  source = source.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else if (quoted || !value) quoted = !quoted;
      else value += char;
    } else if (!quoted && char === ",") { row.push(value.trim()); value = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(value.trim());
      if (row.some(Boolean)) records.push(row);
      row = []; value = "";
    } else value += char;
  }
  if (quoted) throw new Error("A CSV field has an unmatched quote.");
  row.push(value.trim());
  if (row.some(Boolean)) records.push(row);
  return records;
}
export function csvFormat(headers, rows) {
  const cell = value => {
    let content = String(value ?? "");
    if (typeof value === "string" && /^[\t\r ]*[=+@-]/.test(content)) content = "'" + content;
    return /[",\r\n]/.test(content) ? '"' + content.replaceAll('"', '""') + '"' : content;
  };
  return [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
