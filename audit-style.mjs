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

const CATALOG={seasons:[{id:"se1",name:"Spring 2026",starts_on:"2026-08-31",ends_on:"2026-10-25",weeks:8}],
 package:{price_cents:56000,sessions:16},
 groups:[{id:"g1",name:"Mon/Wed U9 Foundation",status:"forming",min_age:7,max_age:9,min_players:4,max_players:6,dropin_price_cents:4000,occupancy:{paid:3,held:0,total:3,capacity:6},eligible:true,locations:{name:"Northside Turf"},trainers:{display_name:"Dani Okoro"},group_meeting_times:[{weekday:1,starts_time:"17:30:00",duration_minutes:60}]}]};

async function audit(path, width) {
  const page=await b.newPage({viewport:{width,height:900},deviceScaleFactor:1});
  await page.route("https://fonts.googleapis.com/**",r=>r.fulfill({status:200,contentType:"text/css",body:""}));
  await page.route("https://fonts.gstatic.com/**",r=>r.fulfill({status:200,contentType:"font/woff2",body:""}));
  await page.route("https://js.stripe.com/**",r=>r.fulfill({status:200,contentType:"text/javascript",body:"window.Stripe=()=>({elements:()=>({create:()=>({mount:()=>{}})}),confirmPayment:async()=>({})});"}));
  await page.route("**/functions/v1/catalog*",r=>r.fulfill({status:200,contentType:"application/json",body:JSON.stringify(CATALOG)}));
  await page.route("**/functions/v1/**",r=>r.fulfill({status:500,contentType:"application/json",body:'{}'}));
  await page.goto(`${base}${path}`,{waitUntil:"load"});
  await page.waitForTimeout(700);

  const m = await page.evaluate(() => {
    const vis = [...document.querySelectorAll("main *")].filter(n => n.offsetParent !== null && n.getBoundingClientRect().height > 0);

    const bordered = vis.filter(n => {
      const c = getComputedStyle(n);
      return parseFloat(c.borderTopWidth) + parseFloat(c.borderRightWidth) +
             parseFloat(c.borderBottomWidth) + parseFloat(c.borderLeftWidth) > 0;
    });

    // Boxes that fully enclose *content*. Buttons, inputs, badges and tables
    // are meant to be bordered — the question is how many containers of prose
    // the page wraps in a frame.
    const CONTROL = new Set(["BUTTON","INPUT","SELECT","TEXTAREA","TABLE","TH","TD","A"]);
    const enclosed = vis.filter(n => {
      if (CONTROL.has(n.tagName)) return false;
      if (n.classList.contains("badge") || n.classList.contains("mark")) return false;
      const c = getComputedStyle(n);
      return ["borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth"]
        .every(k => parseFloat(c[k]) >= 1);
    });

    // Vertical gaps between consecutive block siblings, to see the rhythm.
    const gaps = [];
    for (const parent of vis) {
      const kids = [...parent.children].filter(k => k.offsetParent !== null && k.getBoundingClientRect().height > 4);
      for (let i = 1; i < kids.length; i++) {
        const a = kids[i-1].getBoundingClientRect(), z = kids[i].getBoundingClientRect();
        const g = Math.round(z.top - a.bottom);
        if (g >= 0 && g < 200) gaps.push(g);
      }
    }

    const paras = vis.filter(n => n.tagName === "P" && n.textContent.trim().length > 60);
    const widths = paras.map(p => {
      const size = parseFloat(getComputedStyle(p).fontSize);
      return Math.round(p.getBoundingClientRect().width / (size * 0.5));  // approx chars
    });

    const sizes = [...new Set(vis.map(n => getComputedStyle(n).fontSize))]
      .map(parseFloat).sort((a,z)=>a-z);

    const doc = document.documentElement;
    const ink = vis.filter(n => n.children.length === 0 && n.textContent.trim())
      .reduce((sum, n) => { const r = n.getBoundingClientRect(); return sum + r.width * r.height; }, 0);

    return {
      elements: vis.length,
      bordered: bordered.length,
      enclosed: enclosed.length,
      gaps: gaps.sort((a,z)=>a-z),
      medianGap: gaps.sort((a,z)=>a-z)[Math.floor(gaps.length/2)],
      distinctGaps: [...new Set(gaps)].sort((a,z)=>a-z),
      paraWidths: widths,
      fontSizes: sizes,
      pageHeight: doc.scrollHeight,
      inkRatio: +(ink / (doc.scrollWidth * doc.scrollHeight)).toFixed(3),
    };
  });

  await page.close();
  return m;
}

for (const [path, label] of [["/", "homepage"], ["/find-a-camp/", "camp finder"], ["/my-ptp/parent/", "parent portal"], ["/policies/", "policies"]]) {
  for (const w of [390, 1200]) {
    const m = await audit(path, w);
    console.log(`\n${label} @ ${w}px`);
    console.log(`  elements ${m.elements}   bordered ${m.bordered}   fully-enclosed boxes ${m.enclosed}`);
    console.log(`  page height ${m.pageHeight}px   ink coverage ${m.inkRatio}`);
    console.log(`  median gap ${m.medianGap}px   distinct gaps: ${m.distinctGaps.slice(0,14).join(", ")}`);
    console.log(`  paragraph widths (approx chars): ${m.paraWidths.slice(0,8).join(", ")}`);
    console.log(`  font sizes: ${m.fontSizes.join(", ")}`);
  }
}
await b.close(); s.close();
