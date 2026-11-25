
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoData, presets, readSeries, samples } from "./src/data.js";
import { csvFormat, csvParse } from "./src/math.js";
import { backtest, factorFit, optimize } from "./src/portfolio.js";
import { simulate, tactical } from "./src/research.js";
import { runTool, strategies, tools } from "./src/tools.js";
import { compileFormula, emptyWorkspace, excelWorkbook, portfolioCsv } from "./src/workspace.js";
import { server } from "./server.mjs";

const fixture = demoData();
const dates = ["2020-01","2020-02","2020-03","2020-04","2020-05","2020-06"];
const close=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,actual+" differs from "+expected);

test("All tool defaults and tactical strategies produce finite results",()=>{
  for (const [name, tool] of Object.entries(tools)) {
    const report=runTool(name,tool.defaults,fixture,samples,presets);
    assert.ok(report.stats || report.tables, name+" has no results");
    for (const value of Object.values(report.stats || {})) if (typeof value==="number") assert.ok(Number.isFinite(value),name);
  }
  for (const strategy of strategies) {
    const report=runTool("tactical",{strategy},fixture,samples,presets);
    assert.ok(report.tables.some(item=>item.title.includes("signal")),strategy);
  }
});
test("Backtesting applies weights, dated transitions, cash flow, and fees",()=>{
  const data=dates.map(date=>({date,A:.1,B:0}));
  const baseline=backtest(data,{weights:{A:1},initial:100});
  close(baseline.balances.at(-1),100*1.1**6);
  const transition=backtest(data,{weights:{A:1},schedule:{"2020-03":{B:1}},initial:100,cashflow:10,rebalance:0});
  close(transition.balances.at(-1),182);
  const fees=backtest(data,{weights:{B:1},initial:100,fixedFee:12,feeFrequency:1});
  close(fees.balances.at(-1),94);
});
test("Optimization returns feasible weights and respects group constraints",()=>{
  const fit=optimize(fixture,["EQ","BOND","GOLD"],{method:"Maximum Sharpe",bounds:{EQ:[.1,.5]},groups:[{name:"Safe",assets:["BOND"],min:.35,max:.7}]});
  close(Object.values(fit.weights).reduce((a,b)=>a+b,0),1);
  assert.ok(fit.weights.EQ>=.1-1e-9 && fit.weights.EQ<=.5+1e-9);
  assert.ok(fit.weights.BOND>=.35-1e-9 && fit.weights.BOND<=.7+1e-9);
});
test("Regression recovers a constructed intercept and loading",()=>{
  const fit=factorFit(dates.map((date,i)=>({date,F:i*.01,A:.002+i*.02})),"A",["F"]);
  close(fit.coefficients[0],.002);
  close(fit.exposures.F,2);
  close(fit.r2,1);
});
test("Historical simulation reproduces a constant return and discounts terminal funding",()=>{
  const rows=dates.map(date=>({date,A:.01}));
  const outcome=simulate(rows,{weights:{A:1},years:1,trials:30,initial:100,terminalLiability:100,discountRate:.1});
  close(outcome.years.at(-1)[3],100*1.01**12);
  close(outcome.funding,1.01**12/1.1);
  assert.equal(outcome.success,1);
});
test("Momentum uses only data preceding the traded month",()=>{
  const rows=dates.map((date,i)=>({date,A:i===2 ? -.8 : .05,B:i===2 ? .8 : 0,CASH:0}));
  const result=tactical(rows,["A","B"],{strategy:"Relative strength",lookback:2,safe:"CASH"});
  assert.deepEqual(result.schedule["2020-03"],{A:1});
  assert.deepEqual(result.schedule["2020-04"],{B:1});
});
test("CSV, Excel, formula, and portfolio imports handle representative inputs",()=>{
  const rows=readSeries("date,EQ,BOND\n2020-01,1%,0.01\n2020-02,-2%,\n2020-03,3%,0.02");
  assert.equal(rows[1].EQ,-.02);
  assert.ok(!Object.hasOwn(rows[1],"BOND"));
  assert.equal(portfolioCsv("ticker,amount\nA,50\nB,150"),"A:0.2500000000,B:0.7500000000");
  assert.deepEqual(csvParse(csvFormat(["Name","Value"],[["a,b",3],["=unsafe",5]])),[["Name","Value"],["a,b","3"],["'=unsafe","5"]]);
  assert.match(excelWorkbook([{title:"Example",headers:["Asset"],rows:[["A&B"]]}]),/A&amp;B/);
  const evaluate=compileFormula("IF(EQ>BOND,.6*EQ+.4*BOND,MAX(EQ,BOND))");
  close(evaluate(rows[0]),.01);
  close(evaluate(rows[2]),.026);
  assert.ok(Number.isNaN(evaluate(rows[1])));
});
test("Local server serves app and rejects unknown files and unconfigured team requests",async ()=>{
  server.listen(0,"127.0.0.1");
  try {
    await once(server,"listening");
    const origin="http://127.0.0.1:"+server.address().port;
    const page=await fetch(origin);
    assert.equal(page.status,200);
    assert.match(await page.text(),/Portfolio Research Lab/);
    for (const asset of ["/src/app.js","/styles.css"]) {
      const response=await fetch(origin+asset);
      assert.equal(response.status,200);
      await response.arrayBuffer();
    }
    assert.equal((await fetch(origin+"/package.json")).status,404);
    assert.equal((await fetch(origin+"/api/team")).status,503);
  } finally { server.close(); }
});
test("Team accounts share versioned snapshots and reject concurrent stale writes", async ()=>{
  const work=await mkdtemp(join(tmpdir(),"portfolio-team-"));
  const tokens={Alice:"sample-test-account-token-alice",Bob:"sample-test-account-token-bob"};
  process.env.PORTFOLIO_TEAM_ACCOUNTS=JSON.stringify(tokens);
  process.env.PORTFOLIO_TEAM_DATA_DIR=work;
  const {server: teamServer}=await import("./server.mjs?team-check");
  delete process.env.PORTFOLIO_TEAM_ACCOUNTS;
  delete process.env.PORTFOLIO_TEAM_DATA_DIR;
  teamServer.listen(0,"127.0.0.1");
  try {
    await once(teamServer,"listening");
    const endpoint="http://127.0.0.1:"+teamServer.address().port+"/api/team";
    const request=(token, config={})=>fetch(endpoint,{...config,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"}});
    assert.equal((await request("invalid")).status,401);
    const empty=await (await request(tokens.Alice)).json();
    assert.equal(empty.revision,0);
    const setup={method:"PUT",body:JSON.stringify({revision:0,workspace:emptyWorkspace()})};
    const results=await Promise.all([request(tokens.Alice,setup),request(tokens.Bob,setup)]);
    assert.deepEqual(results.map(response=>response.status).sort(),[200,409]);
    for(const response of results) await response.json();
    const shared=await (await request(tokens.Bob)).json();
    assert.equal(shared.revision,1);
    assert.ok(Object.hasOwn(tokens,shared.modifiedBy));
    const next=await request(tokens.Alice,{method:"PUT",body:JSON.stringify({revision:1,workspace:emptyWorkspace()})});
    assert.equal(next.status,200);
    assert.equal((await next.json()).revision,2);
  } finally {
    await new Promise(resolve=>teamServer.close(resolve));
    await unlink(join(work,"shared.json")).catch(error=>{if(error.code!=="ENOENT")throw error;});
    await rmdir(work);
  }
});
