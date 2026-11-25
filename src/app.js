
import { columns, demoData, mergeSeries, presets, readSeries, samples } from "./data.js";
import { csvFormat, csvParse } from "./math.js";
import { groups, models, objectives, runTool, strategies, tools } from "./tools.js";
import { compileFormula, excelWorkbook, matrixCsv, metadataCsv, portfolioCsv, readWorkspace, saveFile, validateWorkspace, writeWorkspace } from "./workspace.js";

const $ = id => document.getElementById(id);
const demo = demoData();
let workspace = readWorkspace();
let active = "market";
let result = null;
let lastConfig = null;
let revision = null;
let teamToken = "";
const colors = ["#1675d1","#178970","#b75b1d","#9b54c9","#c44465","#48735c","#6076c1","#87752e"];
const text = value => String(value ?? "").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const findGroup = id => groups.find(group=>group.tools.some(tool=>tool.id===id));
const data = () => workspace.data ?? demo;
const sourceLabel = () => workspace.source === "mixed" ? "Mixed sample and imported data" : workspace.source === "demo" || !workspace.data ? "Synthetic sample data" : "Imported monthly data";
const metadata = () => ({
  ...(workspace.data ? Object.fromEntries(columns(data()).filter(name=>!/^(CPI|GDP|OIL|PE10|UNEMPLOYMENT|FEDFUNDS|TREASURY10Y|MKT|SMB|HML|TERM|CREDIT|MOM|RMW|CMA|ME|IA|ROE|EG)$|_DIV$/.test(name))
    .map(name=>[name,{name,category:"Custom",type:"Series",fee:null}])) : samples),
  ...workspace.metadata
});
const settings = {
  weights:"Portfolio weights",benchmark:"Benchmark series",asset:"Target series",assets:"Series symbols",
  initial:"Starting balance",rebalance:"Rebalance every N months",years:"Years",trials:"Trials",mode:"Return model",
  inflation:"Annual inflation",monthlyCash:"Monthly cash flow",goal:"Target ending balance",method:"Objective",
  benchmarkSymbol:"Benchmark series",steps:"Frontier points",resamples:"Resamples",window:"Rolling months",
  tradeEvery:"Trade every N months",factors:"Factor symbols",factorModel:"Factor model",riskFree:"Risk-free series",
  minMonths:"Minimum history in months",maxFee:"Maximum expense ratio",category:"Fund category",type:"Fund type",
  rankBy:"Rank by",lags:"Lags",safe:"Defensive series",strategy:"Tactical rule",lookback:"Lookback months",
  hold:"Assets to hold",start:"Start month",end:"End month",monthlyLiability:"Monthly liability"
};
const selections = {
  mode:["Historical","Forecast","Statistical","Parameterized"],method:objectives,
  factorModel:Object.keys(models),rankBy:["Sharpe","Return","Volatility","Drawdown"],strategy:strategies
};
const advancedHints = {
  allocation:"Use compare for named weight maps. Set cashflow or cashflows, inflationAdjusted, rebalance, band, relativeBand, or leverage.",
  portfolio:"Use compare, cashflow, cashflows, inflationAdjusted, band, relativeBand, leverage, debtRate, reinvest, expenses, or feeFrequency. For fee inputs, see Workspace.",
  dynamic:"Set schedule to an object keyed by YYYY-MM. Each value is an allocation with decimal weights.",
  monte:"Use cashflows, withdrawal, withdrawalRate, age, lifeExpectancy, distribution, block, inflationMode, real, taxRate, sequenceRisk, expected, volatility, or correlation.",
  goals:"Use stages with from and to years and a monthly cashflow amount. Add inflation, taxes, or other simulation options.",
  liability:"Use liabilities for a monthly series, terminalLiability for an obligation stated in present-value terms, and discountRate and targetFundingRatio for funding analysis.",
  frontier:"Supply expected and volatility by ticker, a correlation matrix, bounds like EQ: [0.05,0.6], or groups with name, assets, min and max.",
  optimize:"Supply expected and volatility by ticker, a correlation matrix, bounds, groups, riskBudget, riskFree, or target.",
  black:"Enter views as objects with weights, an annual return, and optional uncertainty. A relative view can have positive and negative asset weights.",
  rolling:"Set window and tradeEvery in months. The optimizer accepts asset bounds, group constraints, and market assumptions.",
  tactical:"Set thresholds, outMonths, targetVol, signalLag, tradeEvery, or adaptiveMethod. A signal always uses data observed before its trade month.",
  factor:"Use assetWeights to regress a weighted portfolio instead of a single series. Custom uses the listed factor symbols.",
  factorAllocation:"Set targets as a factor-to-loading map.",
  factorMatch:"Use assetWeights to build the target return series from a weighted portfolio.",
  performance:"Enable showRegimes to compare positive and negative benchmark months."
};
function setStatus(message,isError=false,id="status") {
  const element=$(id);
  element.textContent=message;
  element.classList.toggle("error",isError);
}
function nav() {
  const search=$("tool-search").value.trim().toLowerCase();
  $("navigation").innerHTML=groups.map(group=>{
    const matches=group.tools.filter(tool=>(tool.name+" "+group.label).toLowerCase().includes(search));
    if (!matches.length) return "";
    return '<details class="nav-group" '+(search || group.tools.some(tool=>tool.id===active) ? "open" : "")+'><summary>'+text(group.label)+'</summary>'+
      matches.map(tool=>'<button type="button" class="tool" data-tool="'+tool.id+'" '+(tool.id===active?'aria-current="page"':'')+'>'+text(tool.name)+'</button>').join("")+'</details>';
  }).join("") || '<p class="muted">No tools match.</p>';
}
function layout(config) {
  const tool=tools[active];
  $("section").textContent=findGroup(active).label;
  $("heading").textContent=tool.name;
  $("description").textContent=tool.description;
  $("data-badge").textContent=sourceLabel();
  $("settings-panel").hidden=active==="market";
  const merged={...tool.defaults,...config};
  const fields=[...Object.keys(tool.defaults).filter(key=>Object.hasOwn(settings,key)),"start","end"];
  const unique=[...new Set(fields)];
  const available=columns(data());
  $("model-fields").innerHTML=unique.map(key=>{
    const value=merged[key] ?? "";
    const options=selections[key] || (key==="category" ? [...new Set(Object.values(metadata()).map(item=>item.category))] : key==="type" ? [...new Set(Object.values(metadata()).map(item=>item.type))] : null);
    let input;
    if (options) {
      input='<select name="'+key+'">'+(key==="category" || key==="type" ? '<option value="">All</option>' : '')+
        options.map(option=>'<option '+(option===value?"selected ":"")+'value="'+text(option)+'">'+text(option)+'</option>').join("")+'</select>';
    } else {
      const type=key==="start" || key==="end" ? "month" : typeof tool.defaults[key]==="number" ? "number" : "text";
      const list=["asset","benchmark","benchmarkSymbol","riskFree","safe"].includes(key) ? ' list="series-list"' : "";
      input='<input type="'+type+'" name="'+key+'" '+(type==="number"?'step="any"':'')+list+' value="'+text(typeof value==="object" ? Object.entries(value).map(([name,w])=>name+":"+w).join(",") : value)+'">';
    }
    return '<label>'+text(settings[key])+input+'</label>';
  }).join("")+'<datalist id="series-list">'+available.map(key=>'<option value="'+text(key)+'"></option>').join("")+'</datalist>'+
    (unique.includes("weights") ? '<label>Built-in model<select id="preset"><option value="">Choose a model</option>'+Object.keys(presets).map(name=>'<option>'+text(name)+'</option>').join("")+'</select></label>' : "");
  $("advanced").value=JSON.stringify(Object.fromEntries(Object.entries(merged).filter(([key])=>!unique.includes(key))),null,2);
  $("advanced-hint").textContent=advancedHints[active] || "Set tool-specific values or use the workspace settings.";
  nav();
}
function configFromForm() {
  const raw=JSON.parse($("advanced").value || "{}");
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) throw new Error("Advanced settings must be a JSON object.");
  return {...raw,...Object.fromEntries([...new FormData($("model-form"))].map(([key,value])=>[
    key, value==="" && typeof tools[active].defaults[key]==="number" ? null :
      typeof tools[active].defaults[key]==="number" ? Number(value) : value
  ]))};
}
function pct(value) { return (value*100).toLocaleString(undefined,{maximumFractionDigits:2})+"%"; }
function number(value) { return value.toLocaleString(undefined,{maximumFractionDigits:4}); }
function formatted(value,key) {
  if (value===null || value===undefined || (typeof value==="number" && !Number.isFinite(value))) return "—";
  if (typeof value!=="number") return String(value);
  if (/balance|fees|income|return contribution|^p(10|25|50|75|90)$/i.test(key)) return value.toLocaleString(undefined,{maximumFractionDigits:2});
  if (/annualized|^portfolio$|^benchmark$|annual return|total return|year-to-date return|money-weighted return|monthly 95%|^volatility|^return$|tracking error|positive months|drawdown|risk share|weight|success probability|average|^best$|^worst$|year$|expense ratio|variance explained|contribution/.test(key.toLowerCase()) && key!=="Year") return pct(value);
  return number(value);
}
function plot({title,dates,series,xValues}) {
  const values=series.flatMap(item=>item.values).filter(Number.isFinite);
  if (!values.length || !dates.length) return "";
  const width=850,height=268,left=75,top=12,right=24,bottom=36;
  const arrangement=dates.map((_,i)=>xValues?.[i] ?? i);
  const first=arrangement[0], last=arrangement.at(-1);
  let low=values[0], high=values[0];
  for (const value of values) { low=Math.min(low,value); high=Math.max(high,value); }
  const span=high-low || Math.abs(high)*.1 || 1;
  low-=span*.07; high+=span*.07;
  const x=i=>left+(width-left-right)*(last===first ? .5 : (arrangement[i]-first)/(last-first));
  const y=value=>top+(height-top-bottom)*(high-value)/(high-low);
  const percent=/return|drawdown|frontier|style comparison/i.test(title);
  const guides=Array.from({length:5},(_,i)=>{
    const value=high-(high-low)*i/4;
    return '<line class="grid" x1="'+left+'" x2="'+(width-right)+'" y1="'+y(value)+'" y2="'+y(value)+'"/><text x="'+(left-8)+'" y="'+(y(value)+4)+'" text-anchor="end">'+text(percent?pct(value):number(value))+'</text>';
  }).join("");
  const datesSvg=[...new Set(Array.from({length:Math.min(5,dates.length)},(_,i)=>Math.round(i*(dates.length-1)/Math.max(1,Math.min(5,dates.length)-1))))].map(i=>
    '<text x="'+x(i)+'" y="'+(height-9)+'" text-anchor="middle">'+text(dates[i])+'</text>').join("");
  const paths=series.map(({values},j)=>{
    let move=true;
    const path=values.flatMap((value,i)=>{
      if (!Number.isFinite(value)) { move=true; return []; }
      const point=(move?"M":"L")+x(i).toFixed(2)+" "+y(value).toFixed(2);
      move=false;
      return [point];
    }).join(" ");
    const dots=values.length<2 ? values.map((value,i)=>Number.isFinite(value)?'<circle cx="'+x(i)+'" cy="'+y(value)+'" r="4" fill="'+colors[j%colors.length]+'"/>':"").join(""):"";
    return '<path d="'+path+'" stroke="'+colors[j%colors.length]+'" stroke-width="2.4" fill="none" vector-effect="non-scaling-stroke"/>'+dots;
  }).join("");
  return '<section class="panel" data-section="'+text(title)+'"><h2>'+text(title)+'</h2><div class="chart"><svg role="img" aria-label="'+text(title)+'" viewBox="0 0 '+width+' '+height+'">'+guides+datesSvg+paths+'</svg></div><div class="legend">'+
    series.map((item,i)=>'<span><b style="background:'+colors[i%colors.length]+'"></b>'+text(item.name)+'</span>').join("")+'</div></section>';
}
function showTable({title,headers,rows}) {
  return '<section class="panel" data-section="'+text(title)+'"><h2>'+text(title)+'</h2>'+(rows.length
    ? '<div class="table-scroll" tabindex="0" aria-label="'+text(title)+' data"><table><thead><tr>'+headers.map(value=>'<th scope="col">'+text(value)+'</th>').join("")+
      '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((value,i)=>'<td>'+text(formatted(value,headers[i]))+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>'
    : '<p class="muted">No rows match the current inputs.</p>')+'</section>';
}
function resultTables() {
  return [...(result.stats?[{title:"Statistics",headers:["Metric","Value"],rows:Object.entries(result.stats)}]:[]),...(result.tables || [])];
}
function render() {
  const statBlock=Object.entries(result.stats || {}).filter(([,value])=>value!=null).map(([key,value])=>'<div class="metric"><span>'+text(key)+'</span><strong>'+text(formatted(value,key))+'</strong></div>').join("");
  const available=resultTables();
  const results=$("results");
  results.innerHTML=(statBlock?'<div class="metric-grid" data-section="Statistics">'+statBlock+'</div>':"")+
    '<div class="actions result-actions"><label>CSV table<select id="csv-table">'+available.map((table,i)=>'<option value="'+i+'">'+text(table.title)+'</option>').join("")+
    '</select></label><button class="button" data-action="csv">CSV</button><button class="button" data-action="excel">Excel</button><button class="button" data-action="print">Print / PDF</button>'+
    (result.series ? '<button class="button" data-action="series">Save as return series</button>' : '')+'</div>'+
    (result.note?'<p class="muted">'+text(result.note)+'</p>':"")+(result.charts || []).map(plot).join("")+
    (result.tables || []).map(showTable).join("");
}
function run() {
  try {
    const config=configFromForm();
    const assumptions=workspace.assumptions;
    lastConfig=config;
    result=runTool(active,{...workspace.fees,...assumptions,...config},data(),metadata(),presets);
    render();
    setStatus("");
  } catch (error) {
    result=null; $("results").replaceChildren();
    setStatus(error.message,true);
  }
}
function openTool(id,config={}) {
  if (!Object.hasOwn(tools,id)) return;
  active=id; location.hash=id;
  layout(config); run();
}
function commit(next,message) {
  writeWorkspace(next); workspace=next;
  $("data-badge").textContent=sourceLabel();
  if (message) setStatus(message,false,"workspace-status");
}
function safeSymbol(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name || "") || ["date","__proto__","prototype","constructor"].includes(name)) throw new Error("Use a series name containing letters, numbers, underscores, or dots.");
  if (columns(data()).includes(name)) throw new Error("That series name already exists.");
  return name;
}
function printReport() {
  const {title,logo,color,disclosure,sections,font}=workspace.report;
  const region=$("print-brand");
  const included=Array.isArray(sections) ? sections : [];
  const allowedLogo=typeof logo==="string" && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo);
  region.innerHTML=(allowedLogo?'<img alt="Report logo" src="'+text(logo)+'">':"")+'<h2>'+text(title)+'</h2>'+(disclosure?'<p>'+text(disclosure)+'</p>':"");
  region.style.setProperty("--report-color",/^#[a-f0-9]{6}$/i.test(color) ? color : "#155aa4");
  $("main").style.setProperty("--report-font",font==="Serif" ? "Georgia, serif" : font==="Mono" ? "Consolas, monospace" : "inherit");
  for (const element of $("results").querySelectorAll("[data-section]")) element.classList.toggle("print-excluded",included.length>0 && !included.includes(element.dataset.section));
  region.hidden=false;
  window.print();
  region.hidden=true;
}
$("navigation").addEventListener("click",event=>{const item=event.target.closest("[data-tool]"); if(item) openTool(item.dataset.tool);});
$("tool-search").addEventListener("input",nav);
$("model-form").addEventListener("submit",event=>{event.preventDefault(); run();});
$("model-fields").addEventListener("change",event=>{
  if(event.target.id==="preset" && event.target.value) $("model-form").elements.weights.value=Object.entries(presets[event.target.value]).map(([name,value])=>name+":"+value).join(",");
});
$("save-model").addEventListener("click",()=>{
  try {
    const config=configFromForm();
    const name=window.prompt("Model name",tools[active].name)?.trim();
    if(!name)return;
    commit({...workspace,models:[...workspace.models,{id:crypto.randomUUID(),name,tool:active,config} ]});
    setStatus("Saved model "+name+".");
  } catch(error) { setStatus(error.message,true); }
});
$("results").addEventListener("click",event=>{
  const action=event.target.closest("[data-action]")?.dataset.action;
  if(!action || !result)return;
  try {
    if(action==="csv") {
      const table=resultTables()[Number($("csv-table").value)];
      saveFile(active+".csv",csvFormat(table.headers,table.rows),"text/csv;charset=utf-8");
    }
    if(action==="excel")saveFile(active+".xml",excelWorkbook(resultTables()),"application/xml;charset=utf-8");
    if(action==="print")printReport();
    if(action==="series") {
      const input=window.prompt("Ticker for return series","MY_MODEL");
      if(input===null)return;
      const name=safeSymbol(input.trim());
      commit({...workspace,data:mergeSeries(data(),result.series.map(row=>({date:row.date,[name]:row.value}))),metadata:metadata()});
      setStatus("Saved "+name+" as a return series.");
    }
  } catch(error) { setStatus(error.message,true); }
});
function section(name,content) { return '<details class="workspace-block"><summary>'+name+'</summary>'+content+'</details>'; }
function form(id,content,button) { return '<form class="workspace-form" data-form="'+id+'">'+content+'<div><button class="button" type="submit">'+button+'</button></div></form>'; }
function file(name,label) { return '<label>'+label+'<input name="'+name+'" type="file" accept=".csv,.txt,.json,text/csv" required></label>'; }
function jsonField(name,value) { return '<label>'+name+'<textarea name="json" rows="6" spellcheck="false">'+text(JSON.stringify(value,null,2))+'</textarea></label>'; }
function workspaceView() {
  const saved=workspace.models.map(model=>'<li class="saved-model"><span>'+text(model.name)+' · '+text(tools[model.tool]?.name || model.tool)+'</span><div class="top-actions"><button class="button" data-model="'+text(model.id)+'">Open</button><button class="button" data-remove="'+text(model.id)+'">Delete</button></div></li>').join("");
  $("workspace-body").innerHTML=
    section("Saved models",saved?'<ul class="model-list">'+saved+'</ul>':'<p class="muted">Save a model from its analysis page to reopen it here.</p>')+
    section("Return series and metadata",
      form("returns",'<p class="muted">Monthly CSV with a date column and one column per return series. Use decimals or percentages.</p>'+file("file","Return series")+'<label>Import behavior<select name="mode"><option value="replace">Replace active dataset</option><option value="merge">Merge into active dataset</option></select></label>',"Import returns")+
      form("metadata",file("file","Metadata CSV with symbol, name, category, type, expense ratio"),"Import metadata")+
      '<button type="button" class="button" data-workspace="demo">Restore synthetic sample</button>')+
    section("Portfolio, tickers, cash flows and correlations",
      form("holdings",file("file","Holdings CSV with ticker and weight or balance"),"Load allocations")+
      form("tickers",file("file","Ticker list as CSV or one per line"),"Load tickers")+
      form("cashflows",file("file","Cash-flow CSV with one signed amount per line"),"Load cash flows")+
      form("correlation",file("file","Correlation CSV with a numeric square matrix"),"Load correlation matrix"))+
    section("Derived benchmarks and asset backfills",
      form("derive",'<label>New symbol<input name="symbol" required placeholder="BLEND"></label><label>Formula<input name="formula" required placeholder=".6*EQ+.4*BOND"></label>',"Create series")+
      form("backfill",'<label>Series to backfill<input name="symbol" required></label><label>Proxy series<input name="proxy" required></label>',"Backfill missing history"))+
    section("Capital market assumptions and fees",
      form("assumptions",'<p class="muted">Set expected returns and volatility by ticker, a correlation matrix, or taxRate as a decimal.</p>'+jsonField("Shared assumptions",workspace.assumptions),"Save assumptions")+
      form("fees",'<p class="muted">Use feeRate, fixedFee, feeFrequency, performanceFee, or feeTiers with minimum, rate and amount.</p>'+jsonField("Advisor fee settings",workspace.fees),"Save fees"))+
    section("Report template",form("report",'<p class="muted">Set title, color, disclosure, and sections by result heading. An empty sections list prints all results. Optional font values are Sans, Serif, and Mono.</p>'+jsonField("Report settings",Object.fromEntries(Object.entries(workspace.report).filter(([name])=>name!=="logo")))+'<label>Logo image<input name="logo" type="file" accept="image/png,image/jpeg,image/webp"></label>',"Save template"))+
    section("Team synchronization",
      '<p class="muted">Team workspaces share data, saved settings, and reports on a configured server. Pull first to load the current revision.</p><label>Team access token<input id="team-token" type="password" autocomplete="off"></label><div class="actions"><button class="button" data-workspace="pull">Pull workspace</button><button class="button" data-workspace="publish">Publish workspace</button></div>')+
    section("Workspace backup",'<button class="button" data-workspace="backup">Export workspace</button>'+form("restore",file("file","Saved workspace JSON"),"Restore workspace"));
}
async function team(action) {
  const supplied=$("team-token").value.trim();
  if(supplied && supplied!==teamToken) { teamToken=supplied;revision=null; }
  if(!teamToken)throw new Error("Enter a team access token.");
  if(action==="publish" && revision===null)throw new Error("Pull first to establish the current team revision.");
  const response=await fetch("/api/team",{method:action==="pull"?"GET":"PUT",headers:{Authorization:"Bearer "+teamToken,"Content-Type":"application/json"},
    ...(action==="publish"?{body:JSON.stringify({revision,workspace})}:{})});
  const payload=await response.json();
  if(!response.ok)throw new Error(payload.error || "Team synchronization failed.");
  if(payload.workspace && action==="pull") {
    commit(payload.workspace);
    openTool(active,lastConfig || {});
  }
  revision=payload.revision;
  return "Team workspace revision "+revision+(payload.modifiedBy?" · "+payload.modifiedBy:"");
}
$("workspace-toggle").addEventListener("click",()=>{
  workspaceView(); setStatus("",false,"workspace-status"); $("workspace").showModal();
});
$("close-workspace").addEventListener("click",()=>$("workspace").close());
$("workspace-body").addEventListener("click",async event=>{
  const button=event.target.closest("button");
  if(!button)return;
  const model=workspace.models.find(item=>item.id===button.dataset.model);
  if(model) { $("workspace").close(); openTool(model.tool,model.config); return; }
  try {
    if(button.dataset.remove && window.confirm("Delete this saved model?")) {
      commit({...workspace,models:workspace.models.filter(model=>model.id!==button.dataset.remove)});
      workspaceView();
    }
    const action=button.dataset.workspace;
    if(action==="demo" && window.confirm("Replace the imported data and metadata with the synthetic sample?")) {
      commit({...workspace,data:null,source:"demo",metadata:{}},"Restored the synthetic sample.");
      openTool(active);
    }
    if(action==="backup")saveFile("portfolio-workspace.json",JSON.stringify(workspace,null,2),"application/json");
    if(action==="pull" || action==="publish") {
      if(action==="pull" && !window.confirm("A team revision may replace your local workspace. Continue?"))return;
      setStatus(await team(action),false,"workspace-status");
    }
  } catch(error) {setStatus(error.message,true,"workspace-status");}
});
function getActiveField(name) {
  const input=$("model-form").elements[name];
  if(!input)throw new Error("Open a tool with a "+name+" field first.");
  return input;
}
const reportLogo = file => new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=()=>reject(new Error("Could not open the report logo."));
  reader.readAsDataURL(file);
});
$("workspace-body").addEventListener("submit",async event=>{
  event.preventDefault();
  const category=event.target.dataset.form;
  const entries=new FormData(event.target);
  const payload=entries.get("file");
  try {
    if(category==="returns") {
      const rows=readSeries(await payload.text());
      const merge=entries.get("mode")==="merge";
      commit({...workspace,data:merge?mergeSeries(data(),rows):rows,source:merge && workspace.source!=="imported"?"mixed":"imported",metadata:merge?metadata():{}});
      openTool(active,lastConfig || {});
    } else if(category==="metadata") {
      commit({...workspace,metadata:{...workspace.metadata,...metadataCsv(await payload.text())}});
      run();
    } else if(category==="holdings") {
      getActiveField("weights").value=portfolioCsv(await payload.text());
      run();
    } else if(category==="tickers") {
      const value=csvParse(await payload.text()).flat().filter(name=>!/^symbol$|^ticker$/i.test(name));
      getActiveField("assets").value=value.join(",");
      run();
    } else if(category==="cashflows" || category==="correlation") {
      const options=JSON.parse($("advanced").value || "{}");
      if(category==="cashflows") {
        const rows=csvParse(await payload.text());
        if(/^amount$|^cashflow$/i.test(rows[0]?.[0]))rows.shift();
        if(!rows.length || rows.some(row=>row.length!==1 || !row[0].trim() || !Number.isFinite(Number(row[0]))))throw new Error("Enter one numeric amount per row.");
        options.cashflows=rows.map(row=>Number(row[0]));
      } else options.correlation=matrixCsv(await payload.text());
      $("advanced").value=JSON.stringify(options,null,2);
      run();
    } else if(category==="derive" || category==="backfill") {
      const symbol=String(entries.get("symbol")).trim();
      let output;
      if(category==="derive") {
        safeSymbol(symbol);
        const evaluate=compileFormula(String(entries.get("formula")));
        output=data().map(row=>{const value=evaluate(row);return Number.isFinite(value)?{...row,[symbol]:value}:row;});
        if(!output.some(row=>Number.isFinite(row[symbol])))throw new Error("The formula produced no finite values.");
      } else {
        const proxy=String(entries.get("proxy")).trim();
        const available=columns(data());
        if(!available.includes(symbol) || !available.includes(proxy) || symbol===proxy)throw new Error("Choose two different existing series.");
        const first=data().find(row=>Number.isFinite(row[symbol]))?.date;
        output=data().map(row=>row.date<first && Number.isFinite(row[proxy])?{...row,[symbol]:row[proxy]}:row);
      }
      commit({...workspace,data:output,metadata:metadata()}); run();
    } else if(category==="report" || category==="fees" || category==="assumptions") {
      const value=JSON.parse(entries.get("json"));
      if(!value || typeof value!=="object" || Array.isArray(value))throw new Error("Settings must be a JSON object.");
      if(category==="report") {
        const file=entries.get("logo");
        if(file?.size>1024*1024)throw new Error("Choose a logo under 1 MB.");
        value.logo=file?.size ? await reportLogo(file) : workspace.report.logo;
      }
      commit({...workspace,[category]:value}); run();
    } else if(category==="restore") {
      const next=validateWorkspace(JSON.parse(await payload.text()));
      if(!window.confirm("Replace the current workspace with this backup?"))return;
      commit(next); openTool(active);
    }
    setStatus("Workspace updated.",false,"workspace-status");
  } catch(error){setStatus(error.message,true,"workspace-status");}
});
function theme(value) {
  document.documentElement.dataset.theme=value;
  $("theme").textContent=value==="dark"?"Light mode":"Dark mode";
  try {localStorage.setItem("portfolio-theme",value);} catch{}
}
try {theme(localStorage.getItem("portfolio-theme") || "light");} catch {theme("light");}
$("theme").addEventListener("click",()=>theme(document.documentElement.dataset.theme==="dark"?"light":"dark"));
window.addEventListener("hashchange",()=>{
  const id=location.hash.slice(1);
  if(id!==active && Object.hasOwn(tools,id))openTool(id);
});
openTool(Object.hasOwn(tools,location.hash.slice(1))?location.hash.slice(1):"market");
