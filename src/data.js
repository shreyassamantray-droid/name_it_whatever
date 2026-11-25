
import { csvParse, normal, random } from "./math.js";

export const samples = {
  EQ: { name: "Domestic equity", category: "Equity", fee: .0005, type: "ETF" },
  INTL: { name: "International equity", category: "Equity", fee: .001, type: "ETF" },
  SMALL: { name: "Small-company equity", category: "Equity", fee: .0015, type: "ETF" },
  BOND: { name: "Core aggregate bonds", category: "Fixed income", fee: .0006, type: "ETF" },
  TREASURY: { name: "Intermediate government bonds", category: "Fixed income", fee: .0007, type: "Fund" },
  GOLD: { name: "Gold", category: "Real assets", fee: .0025, type: "ETF" },
  REIT: { name: "Listed real estate", category: "Real assets", fee: .0012, type: "Fund" },
  CASH: { name: "Cash proxy", category: "Cash", fee: 0, type: "Index" },
  US: { name: "United States", category: "Global markets", fee: null, type: "Country" },
  CANADA: { name: "Canada", category: "Global markets", fee: null, type: "Country" },
  JAPAN: { name: "Japan", category: "Global markets", fee: null, type: "Country" },
  UK: { name: "United Kingdom", category: "Global markets", fee: null, type: "Country" }
};
export const factors = ["MKT", "SMB", "HML", "MOM", "RMW", "CMA", "TERM", "CREDIT"];
export const presets = {
  Balanced: { EQ: .42, INTL: .18, BOND: .4 },
  Growth: { EQ: .55, INTL: .2, SMALL: .15, BOND: .1 },
  Defensive: { EQ: .25, INTL: .15, TREASURY: .4, GOLD: .1, CASH: .1 },
  "Three fund": { EQ: .5, INTL: .25, BOND: .25 },
  "Four fund": { EQ: .4, INTL: .2, BOND: .3, REIT: .1 },
  "60/40": { EQ: .6, BOND: .4 },
  Permanent: { EQ: .25, TREASURY: .25, GOLD: .25, CASH: .25 }
};
export function demoData() {
  const rng = random(202607);
  return Array.from({ length: 240 }, (_, i) => {
    const noise = () => normal(rng);
    const MKT = .005 + noise() * .036 - ([98, 99, 169].includes(i) ? .115 : 0);
    const SMB = noise() * .022, HML = noise() * .019, MOM = noise() * .023;
    const RMW = noise() * .018, CMA = noise() * .017, TERM = .001 + noise() * .017, CREDIT = .001 + noise() * .015;
    const CASH = .002 + noise() * .0004;
    return {
      date: String(2006 + Math.floor(i / 12)) + "-" + String(i % 12 + 1).padStart(2, "0"),
      EQ: CASH + MKT + noise() * .006, INTL: CASH + .85 * MKT + .3 * HML + noise() * .019,
      SMALL: CASH + 1.12 * MKT + .8 * SMB + noise() * .01, BOND: CASH + .55 * TERM + .32 * CREDIT + noise() * .004,
      TREASURY: CASH + .83 * TERM + noise() * .004, GOLD: .003 + noise() * .038,
      REIT: CASH + .75 * MKT + .4 * TERM + noise() * .022, CASH, MKT, SMB, HML, MOM, RMW, CMA, TERM, CREDIT,
      VALUE: CASH + .95 * MKT + .65 * HML, GROWTH: CASH + 1.07 * MKT - .65 * HML,
      US: CASH + MKT, CANADA: CASH + .82 * MKT + noise() * .019, JAPAN: CASH + .73 * MKT + noise() * .022,
      UK: CASH + .77 * MKT + noise() * .02, PE10: 23 + Math.sin(i / 21) * 6 + i / 35, CPI: .0022 + noise() * .002,
      GDP: .006 + noise() * .005, UNEMPLOYMENT: .055 + Math.sin(i / 18) * .013,
      FEDFUNDS: CASH * 12, TREASURY10Y: CASH * 12 + .012, OIL: 65 + Math.sin(i / 15) * 22 + noise() * 5
    };
  });
}
export function columns(rows) {
  return [...new Set(rows.flatMap(row => Object.keys(row)))].filter(key => key !== "date");
}
export function readSeries(source) {
  const [header, ...records] = csvParse(source);
  if (!header?.length || header[0].toLowerCase() !== "date" || header.length < 2) throw new Error("The first CSV column must be date, followed by one or more series.");
  const names = header.slice(1);
  if (new Set(names).size !== names.length || names.some(name => !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) || ["constructor", "prototype", "__proto__", "date"].includes(name))) throw new Error("Series names must be unique and use letters, numbers, underscores, dots, or hyphens.");
  const byMonth = new Map();
  for (const record of records) {
    if (record.length !== header.length || !/^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.test(record[0])) throw new Error("Every row needs a valid YYYY-MM date and the same number of columns as the header.");
    const date = record[0].slice(0, 7);
    if (byMonth.has(date)) throw new Error("Provide one row per month.");
    const row = { date };
    names.forEach((name, i) => {
      const raw = record[i + 1];
      if (!raw) return;
      const value = Number(raw.replace(/%$/, "")) / (raw.endsWith("%") ? 100 : 1);
      if (!Number.isFinite(value)) throw new Error("Invalid value for " + name + " in " + date + ".");
      row[name] = value;
    });
    byMonth.set(date, row);
  }
  if (byMonth.size < 3) throw new Error("Provide at least three monthly observations.");
  return [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function mergeSeries(current, added) {
  const combined = new Map(current.map(row => [row.date, row]));
  for (const row of added) combined.set(row.date, { ...combined.get(row.date), ...row });
  return [...combined.values()].sort((a, b) => a.date.localeCompare(b.date));
}
