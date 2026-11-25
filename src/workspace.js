
import { csvParse } from "./math.js";
const key = "portfolio-research-lab-v1";
export function emptyWorkspace() {
  return { data:null, source:"demo", metadata:{}, models:[], assumptions:{}, report:{title:"Portfolio Research Lab",color:"#1b65ba",disclosure:"",sections:[]}, fees:{} };
}
export function validateWorkspace(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.models) || (value.data !== null && !Array.isArray(value.data)) ||
      !value.metadata || typeof value.metadata !== "object" || !value.assumptions || !value.report || !value.fees) throw new Error("Invalid workspace format.");
  return value;
}
export function readWorkspace() {
  try { return validateWorkspace(JSON.parse(localStorage.getItem(key))); } catch { return emptyWorkspace(); }
}
export function writeWorkspace(value) { localStorage.setItem(key,JSON.stringify(validateWorkspace(value))); }
export function portfolioCsv(text) {
  let rows = csvParse(text);
  if (/^(symbol|ticker|asset)$/i.test(rows[0]?.[0])) rows = rows.slice(1);
  if (!rows.length || new Set(rows.map(row => row[0])).size !== rows.length) throw new Error("Provide unique ticker rows.");
  const weights = rows.map(([symbol, raw]) => [symbol, raw?.endsWith("%") ? Number(raw.slice(0,-1))/100 : Number(raw)]);
  if (weights.some(([symbol,value]) => !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(symbol) || !Number.isFinite(value))) throw new Error("Holdings need a ticker followed by a number.");
  const total = weights.reduce((sum,[,value]) => sum+value,0);
  if (total <= 0) throw new Error("Holdings must have a positive total.");
  return weights.map(([symbol,value]) => symbol+":"+(value/total).toFixed(10)).join(",");
}
export function matrixCsv(text) {
  const rows = csvParse(text).map(row => row.map(value => value.trim() === "" ? NaN : Number(value)));
  if (!rows.length || rows.some(row => row.length !== rows.length || row.some(value => !Number.isFinite(value)))) throw new Error("Provide a square numeric matrix without headers.");
  return rows;
}
export function metadataCsv(text) {
  let rows = csvParse(text);
  if (/^(symbol|ticker)$/i.test(rows[0]?.[0])) rows = rows.slice(1);
  return Object.fromEntries(rows.map(([symbol,name,category,type,fee]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(symbol) || !name || !category || !type) throw new Error("Metadata fields are symbol, name, category, type, expense ratio.");
    const value = fee ? Number(fee.replace(/%$/,""))/(fee.endsWith("%") ? 100 : 1) : null;
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new Error("Expense ratio must be a non-negative number.");
    return [symbol,{name,category,type,fee:value}];
  }));
}
export function compileFormula(source) {
  const terms = source.match(/\s*(?:>=|<=|==|!=|[()+\-*/,<>]|\d+(?:\.\d*)?|\.\d+|[A-Za-z_][A-Za-z0-9_.]*)/g) || [];
  if (terms.join("").trim() !== source.trim() || terms.length > 160) throw new Error("Unsupported formula syntax.");
  const tokens = terms.map(term => term.trim());
  let i = 0;
  const read = () => {
    const token = tokens[i++];
    if (token === "(") {
      const inner = compare();
      if (tokens[i++] !== ")") throw new Error("Expected a closing parenthesis.");
      return inner;
    }
    if (token === "-") { const x = read(); return row => -x(row); }
    if (token && Number.isFinite(Number(token))) return () => Number(token);
    if (token && /^[A-Za-z_]/.test(token)) {
      if (tokens[i] !== "(") return row => Object.hasOwn(row,token) ? row[token] : NaN;
      i++;
      const args = [compare()];
      while (tokens[i] === ",") { i++; args.push(compare()); }
      if (tokens[i++] !== ")") throw new Error("Expected a closing parenthesis.");
      if (token === "IF" && args.length === 3) return row => {
        const condition = args[0](row);
        return Number.isFinite(condition) ? (condition ? args[1](row) : args[2](row)) : NaN;
      };
      if (token === "MIN" || token === "MAX") return row => Math[token.toLowerCase()](...args.map(arg => arg(row)));
      throw new Error("Supported functions are IF, MIN, and MAX.");
    }
    throw new Error("Expected a number or series symbol.");
  };
  const combine = (next, operators) => {
    let first = next();
    while (Object.hasOwn(operators,tokens[i])) {
      const operation = operators[tokens[i++]];
      const left = first, right = next();
      first = row => {
        const a = left(row), b = right(row);
        return Number.isFinite(a) && Number.isFinite(b) ? operation(a,b) : NaN;
      };
    }
    return first;
  };
  const product = () => combine(read,{"*":(a,b)=>a*b,"/":(a,b)=>a/b});
  const add = () => combine(product,{"+":(a,b)=>a+b,"-":(a,b)=>a-b});
  const compare = () => combine(add,{">":(a,b)=>Number(a>b),"<":(a,b)=>Number(a<b),">=":(a,b)=>Number(a>=b),"<=":(a,b)=>Number(a<=b),"==":(a,b)=>Number(a===b),"!=":(a,b)=>Number(a!==b)});
  const formula = compare();
  if (i !== tokens.length) throw new Error("Unexpected token in formula.");
  return formula;
}
export function saveFile(name, body, type) {
  const url = URL.createObjectURL(new Blob([body],{type}));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
const xml = value => String(value ?? "").replace(/[<>&"']/g,char=>({"<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;"}[char]));
export function excelWorkbook(tables) {
  const content = tables.map(({title,headers,rows},i) => {
    const label = (String(i+1)+" "+title.replace(/[\[\]:*?/\\]/g," ")).slice(0,31);
    return '<Worksheet ss:Name="'+xml(label)+'"><Table>'+
      [headers,...rows].map(row=>"<Row>"+row.map(value => '<Cell><Data ss:Type="'+(typeof value === "number" && Number.isFinite(value) ? "Number" : "String")+'">'+xml(value)+"</Data></Cell>").join("")+"</Row>").join("")+
      "</Table></Worksheet>";
  }).join("");
  return '<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>'+
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'+content+"</Workbook>";
}
