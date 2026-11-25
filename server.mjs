
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { validateWorkspace } from "./src/workspace.js";

const root = new URL("./",import.meta.url);
const staticFiles = new Map([
  ["/", ["index.html","text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css","text/css; charset=utf-8"]],
  ...["app","math","data","portfolio","research","tools","workspace"].map(name=>["/src/"+name+".js",["src/"+name+".js","text/javascript; charset=utf-8"]])
]);
const secret = value => createHash("sha256").update(value).digest();
const accountConfig = JSON.parse(process.env.PORTFOLIO_TEAM_ACCOUNTS || "{}");
const accounts = Object.entries(accountConfig).map(([account,token]) => {
  if (typeof token !== "string" || token.length < 24) throw new Error("Each team token must have at least 24 characters.");
  return [account,secret(token)];
});
const directory = process.env.PORTFOLIO_TEAM_DATA_DIR ? resolve(process.env.PORTFOLIO_TEAM_DATA_DIR) : fileURLToPath(new URL(".team/",root));
const state = join(directory,"shared.json");
const temp = join(directory,"shared.tmp");
let writes = Promise.resolve();
function json(response,status,value) {
  response.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  response.end(JSON.stringify(value));
}
async function current() {
  try { return JSON.parse(await readFile(state,"utf8")); }
  catch (error) { if (error.code === "ENOENT") return {revision:0,workspace:null,modifiedBy:null}; throw error; }
}
async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8*1024*1024) return null;
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export const server = createServer(async (request,response)=>{
  try {
    const pathname = new URL(request.url,"http://localhost").pathname;
    if (pathname === "/api/team") {
      if (!accounts.length) return json(response,503,{error:"Team synchronization is disabled on this server."});
      const authHeader = request.headers.authorization || "";
      const supplied = secret(authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "");
      const account = accounts.find(([,digest])=>timingSafeEqual(digest,supplied))?.[0];
      if (!account) return json(response,401,{error:"Invalid team credentials."});
      if (request.method === "GET") return json(response,200,await current());
      if (request.method !== "PUT") return json(response,405,{error:"Unsupported request method."});
      let input;
      try {
        input = await body(request);
        if (!input || !Number.isInteger(input.revision)) throw new Error("A valid workspace revision is required.");
        validateWorkspace(input.workspace);
      } catch (error) { return json(response,400,{error:error.message}); }
      const operation = writes.then(async ()=>{
        const existing = await current();
        if (existing.revision !== input.revision) return json(response,409,{error:"Team workspace changed. Pull the latest revision before publishing."});
        const next={revision:existing.revision+1,workspace:input.workspace,modifiedBy:account};
        await mkdir(directory,{recursive:true});
        await writeFile(temp,JSON.stringify(next),{flag:"w",mode:0o600});
        await rename(temp,state);
        return json(response,200,{revision:next.revision,modifiedBy:account});
      });
      writes = operation.catch(()=>{});
      return await operation;
    }
    const file=staticFiles.get(pathname);
    if (!file || (request.method !== "GET" && request.method !== "HEAD")) return json(response,404,{error:"Page not found."});
    const content=await readFile(new URL(file[0],root));
    response.writeHead(200,{"Content-Type":file[1],"X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    if (!response.headersSent && !response.destroyed) json(response,500,{error:"The server could not process the request."});
  }
});
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || "127.0.0.1";
  server.listen(port,host,()=>console.log("Portfolio Research Lab at http://"+host+":"+server.address().port));
}
