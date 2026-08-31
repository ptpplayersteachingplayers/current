import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const ROOT="/home/user/current/web";
const T={".html":"text/html",".js":"text/javascript",".css":"text/css"};
const s=createServer(async(rq,rs)=>{const p=new URL(rq.url,"http://x").pathname;const f=join(ROOT,normalize(p));const t=p.endsWith("/")?join(f,"index.html"):f;let b=null;try{b=await readFile(t);}catch{};if(b){rs.writeHead(200,{"Content-Type":T[extname(t)]??"text/plain"});rs.end(b);}else{rs.writeHead(404);rs.end("nf");}});
await new Promise(r=>s.listen(0,r));
const base=`http://127.0.0.1:${s.address().port}`;
const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium"});
async function shot(path,file,h=900,after=null){
  const page=await b.newPage({viewport:{width:400,height:h},deviceScaleFactor:2});
  await page.route("https://fonts.googleapis.com/**",r=>r.fulfill({status:200,contentType:"text/css",body:""}));
  await page.route("https://fonts.gstatic.com/**",r=>r.fulfill({status:200,contentType:"font/woff2",body:""}));
  await page.route("https://js.stripe.com/**",r=>r.fulfill({status:200,contentType:"text/javascript",body:"window.Stripe=()=>({elements:()=>({create:()=>({mount:()=>{}})}),confirmPayment:async()=>({})});"}));
  await page.route("**/functions/v1/**",r=>r.fulfill({status:500,contentType:"application/json",body:'{"error":"offline"}'}));
  await page.goto(`${base}${path}`,{waitUntil:"load"});
  await page.waitForTimeout(800);
  if(after) await after(page);
  await page.screenshot({path:file});
  await page.close();
  console.log("wrote",file);
}
const O=process.argv[2]??"/tmp/site";
await shot("/",`${O}/home.png`,1500);
await shot("/",`${O}/home-menu.png`,900, async p=>{await p.click("button.menu-toggle");await p.waitForTimeout(300);});
await shot("/find-a-camp/",`${O}/finder.png`,1200);
await b.close();s.close();
