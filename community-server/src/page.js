// Public NBN Watch page: live map with a side panel per area, headline numbers,
// daily chart, outage log, a manual report form and a single place for
// discussion (Discord). All data is rendered with textContent (never innerHTML).
// Client code avoids backticks and ${} because it lives inside this template literal.
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NBN Watch — live NBN outages in Australia</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="description" content="Live NBN outages across Australia, detected by home modems and reported by people. See what is down near you, for how long, and how fast it usually comes back.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js"></script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
<style>
:root{
  --bg:#f7f7f5; --surface:#ffffff; --sunken:#f1f1ee; --text:#111111; --text2:#4b4b47; --muted:#7a7a73;
  --line:#e6e5e0; --line2:#d6d5cf; --grid:#ecebe6; --axis:#c9c8c0;
  --bar:#3b6fd8; --accent:#3b6fd8; --critical:#d03b3b; --serious:#ec835a; --good:#0ca30c; --past:#a3a29a;
  --crit-bg:#fdf1f1; --ser-bg:#fdf4ef; --good-bg:#effaef;
  --shadow:0 1px 2px rgba(16,16,16,.04),0 2px 10px rgba(16,16,16,.04);
  --r:12px; --font:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
@media (prefers-color-scheme: dark){:root{
  --bg:#0f0f0e; --surface:#181817; --sunken:#141413; --text:#f3f3ef; --text2:#c7c7c0; --muted:#8f8f88;
  --line:#2a2a28; --line2:#363633; --grid:#232321; --axis:#3a3a37;
  --bar:#6f92ea; --accent:#7aa2f7; --past:#6b6b65;
  --crit-bg:#2a1616; --ser-bg:#2a1d16; --good-bg:#132313; --shadow:none;
}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:14.5px/1.5 var(--font);-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
.wrap{max-width:1200px;margin:0 auto;padding:0 16px}
.num{font-variant-numeric:tabular-nums}

/* nav */
nav{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:saturate(1.4) blur(12px);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;gap:22px;height:58px}
.logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15.5px;letter-spacing:-.015em;color:var(--text)}
.logo:hover{text-decoration:none}
.logo svg{flex:none}
nav .links{display:flex;gap:20px;font-size:14px;font-weight:500}
nav .links a{color:var(--text2)}
nav .right{margin-left:auto;display:flex;gap:8px;align-items:center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:9px;padding:9px 15px;font:600 14px var(--font);cursor:pointer;background:var(--text);color:var(--bg);white-space:nowrap}
.btn:hover{text-decoration:none;opacity:.9}
.btn.ghost{background:var(--surface);color:var(--text);box-shadow:inset 0 0 0 1px var(--line2)}
.btn.discord{background:#5865f2;color:#fff}
.btn:disabled{opacity:.45;cursor:default}
.btn.sm{padding:7px 12px;font-size:13px}

/* status banner */
.banner{margin:22px 0 16px;display:flex;align-items:center;gap:16px;padding:16px 18px;border-radius:var(--r);border:1px solid var(--line);background:var(--surface);box-shadow:var(--shadow)}
.banner .ic{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--good-bg);color:var(--good)}
.banner.bad .ic{background:var(--crit-bg);color:var(--critical)}
.banner.warn .ic{background:var(--ser-bg);color:var(--serious)}
.banner h1{font-size:19px;line-height:1.3;margin:0;letter-spacing:-.015em}
.banner p{margin:2px 0 0;color:var(--muted);font-size:13.5px}
.banner .btn{margin-left:auto}

/* map + panel */
.stage{display:grid;grid-template-columns:minmax(0,1fr) 370px;gap:14px;align-items:stretch}
.mapbox{position:relative;border-radius:var(--r);overflow:hidden;border:1px solid var(--line);background:var(--sunken);min-height:560px}
#map{position:absolute;inset:0}
.legend{position:absolute;left:10px;top:10px;max-width:calc(100% - 70px);display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--text2);background:color-mix(in srgb,var(--surface) 92%,transparent);padding:7px 10px;border-radius:9px;border:1px solid var(--line);z-index:2}
.legend span{display:inline-flex;align-items:center;gap:6px}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}
.dot.crit{background:var(--critical)} .dot.ser{border:2.5px solid var(--serious)} .dot.past{background:var(--past);width:7px;height:7px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);display:flex;flex-direction:column;min-height:560px;max-height:560px;overflow:hidden}
.panel .top{padding:14px 14px 10px;border-bottom:1px solid var(--line)}
.search{position:relative}
.search input{width:100%;padding:10px 12px 10px 36px;border-radius:9px;border:1px solid var(--line2);background:var(--sunken);color:var(--text);font:14px var(--font);outline:none}
.search input:focus{border-color:var(--accent);background:var(--surface)}
.search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted)}
.panel .body{overflow:auto;flex:1}
.ptitle{display:flex;justify-content:space-between;align-items:baseline;padding:12px 16px 6px;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.row{display:flex;gap:11px;align-items:flex-start;padding:11px 16px;cursor:pointer;border-top:1px solid var(--line)}
.row:hover{background:var(--sunken)}
.row .dot{margin-top:5px}
.row .t{font-weight:600;letter-spacing:-.005em}
.row .m{font-size:12.5px;color:var(--muted)}
.row .d{margin-left:auto;text-align:right;font-weight:600;white-space:nowrap}
.row .d small{display:block;font-weight:400;font-size:12px;color:var(--muted)}
.empty{padding:22px 16px;color:var(--muted);text-align:center;font-size:13.5px}
.empty b{display:block;color:var(--text);font-size:14.5px;margin-bottom:2px}
.back{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--text2);font:500 13px var(--font);cursor:pointer;padding:0}
.detail{padding:16px}
.detail h2{margin:10px 0 2px;font-size:20px;letter-spacing:-.02em}
.detail .loc{color:var(--muted);font-size:13px}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
.pill.crit{background:var(--crit-bg);color:var(--critical)} .pill.ser{background:var(--ser-bg);color:var(--serious)} .pill.good{background:var(--good-bg);color:var(--good)}
.pill.plain{background:var(--sunken);color:var(--text2)}
.bigdur{font-size:34px;font-weight:700;letter-spacing:-.03em;margin:14px 0 0;line-height:1.1}
.facts{display:grid;grid-template-columns:auto 1fr;gap:7px 14px;margin:14px 0 4px;font-size:13.5px}
.facts div:nth-child(odd){color:var(--muted)}
.mini{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0 8px}
.mini div{background:var(--sunken);border-radius:9px;padding:9px 10px}
.mini b{display:block;font-size:17px;letter-spacing:-.02em}
.mini span{font-size:11.5px;color:var(--muted)}
.hist{border-top:1px solid var(--line);margin-top:10px}
.hist .h{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13px}
.hist .h:last-child{border-bottom:0}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}

/* numbers */
section{padding-top:34px}
.sh{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
h3.st{font-size:18px;letter-spacing:-.015em;margin:0}
.sub{color:var(--muted);font-size:13.5px;margin:2px 0 0}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);padding:16px 18px}
.tile .k{font-size:13px;color:var(--muted);font-weight:500}
.tile .v{font-size:30px;font-weight:700;letter-spacing:-.03em;margin-top:4px;line-height:1.15}
.tile .n{font-size:12.5px;color:var(--muted);margin-top:2px}
.tile.live .v{color:var(--critical)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow)}
.seg{display:inline-flex;border:1px solid var(--line2);border-radius:9px;padding:3px;gap:2px;background:var(--surface)}
.seg button{border:0;background:transparent;color:var(--text2);font:500 13px var(--font);padding:5px 11px;border-radius:6px;cursor:pointer}
.seg button.on{background:var(--text);color:var(--bg)}
.chart{padding:18px 18px 12px;margin-top:12px}
.chart .ch{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.bars{display:flex;align-items:flex-end;gap:2px;height:160px;border-bottom:1px solid var(--axis);position:relative;margin-top:24px}
.bars .hit{flex:1;height:100%;display:flex;align-items:flex-end;cursor:default}
.bars .b{width:100%;background:var(--bar);border-radius:4px 4px 0 0;min-height:0}
.bars .hit:hover .b{filter:brightness(1.12)}
.bars .hit:hover{background:color-mix(in srgb,var(--bar) 7%,transparent)}
.grid-line{position:absolute;left:0;right:0;border-top:1px dashed var(--grid);pointer-events:none}
.grid-line span{position:absolute;left:0;top:-17px;font-size:11px;color:var(--muted)}
.xaxis{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:6px}
.tip{position:absolute;pointer-events:none;background:var(--text);color:var(--bg);font-size:12px;padding:6px 9px;border-radius:7px;white-space:nowrap;transform:translate(-50%,-115%);display:none;z-index:3}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th,td{text-align:left;padding:11px 16px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12px;color:var(--muted);font-weight:600;background:var(--sunken)}
th:first-child{border-top-left-radius:var(--r)} th:last-child{border-top-right-radius:var(--r)}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
tbody tr{cursor:pointer} tbody tr:hover td{background:var(--sunken)}
tr:last-child td{border-bottom:0}
.scroll{overflow-x:auto}

/* community */
.duo{display:grid;grid-template-columns:1.5fr 1fr;gap:12px}
.cta{padding:24px;display:flex;flex-direction:column;gap:10px;justify-content:space-between}
.cta h4{margin:0;font-size:18px;letter-spacing:-.015em}
.cta p{margin:0;color:var(--text2)}
.cta.dc{background:linear-gradient(135deg,#5865f2,#4752c4);color:#fff;border:0}
.cta.dc p{color:rgba(255,255,255,.85)}
.cta.dc .btn{background:#fff;color:#4752c4;align-self:flex-start}
footer{padding:44px 0 56px;color:var(--muted);font-size:13px;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
footer a{color:var(--text2)}

/* dialog */
dialog{border:0;border-radius:16px;padding:0;width:min(500px,calc(100vw - 32px));background:var(--surface);color:var(--text);box-shadow:0 24px 70px rgba(0,0,0,.3)}
dialog::backdrop{background:rgba(0,0,0,.45)}
.dlg{padding:22px}
.dlg h3{margin:0 0 4px;font-size:18px;letter-spacing:-.015em}
.field{margin-top:16px} .field label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
input[type=text]{width:100%;padding:10px 12px;border-radius:9px;border:1px solid var(--line2);background:var(--surface);color:var(--text);font:14.5px var(--font);outline:none}
input[type=text]:focus{border-color:var(--accent)}
.ac{position:relative}
.ac-menu{position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--surface);border:1px solid var(--line2);border-radius:9px;box-shadow:0 10px 30px rgba(0,0,0,.15);max-height:240px;overflow:auto;z-index:3}
.ac-menu div{padding:9px 12px;cursor:pointer;font-size:14px}
.ac-menu div:hover{background:var(--sunken)}
.choices{display:flex;gap:8px;flex-wrap:wrap}
.choices button{border:1px solid var(--line2);background:var(--surface);color:var(--text);border-radius:999px;padding:7px 13px;font:500 13.5px var(--font);cursor:pointer}
.choices button.on{border-color:var(--text);background:var(--text);color:var(--bg)}
.msg{margin-top:12px;font-size:13.5px}
.msg.bad{color:var(--critical)} .msg.ok{color:var(--good)}
.mine{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;margin-top:12px;flex-wrap:wrap}
.maplibregl-popup-content{background:var(--surface);color:var(--text);border-radius:9px;font:12.5px var(--font);padding:8px 11px;box-shadow:0 6px 24px rgba(0,0,0,.18)}
.maplibregl-popup-tip{display:none}
.maplibregl-ctrl-group{border-radius:9px!important}

@media (max-width:980px){
  .stage{grid-template-columns:1fr}
  .mapbox{min-height:0;height:58vh}
  .panel{min-height:0;max-height:none}
  .tiles{grid-template-columns:repeat(2,1fr)}
  .duo{grid-template-columns:1fr}
  nav .links{display:none}
}
@media (max-width:560px){
  .hide-sm{display:none}
  .banner{flex-wrap:wrap} .banner .btn{margin-left:0;width:100%}
  nav .right .ghost{display:none}
  .tile .v{font-size:25px}
}
</style>
</head>
<body>
<nav><div class="wrap">
  <a class="logo" href="#"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--text)"/><path d="M7 13.5a7 7 0 0 1 10 0M9.3 15.8a3.6 3.6 0 0 1 5.4 0" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="18" r="1.3" fill="var(--bg)"/></svg>NBN Watch</a>
  <div class="links"><a href="#map-sec">Live map</a><a href="#numbers">Numbers</a><a href="#log">Outage log</a><a href="#community">Community</a></div>
  <div class="right"><a class="btn ghost sm" id="nav-discord" href="#community">Discord</a><button class="btn sm" id="report-top">Report a problem</button></div>
</div></nav>

<main class="wrap">
  <div class="banner" id="banner" role="status">
    <div class="ic" id="banner-ic"></div>
    <div><h1 id="headline">Checking NBN across Australia…</h1><p id="headsub">Live from home modems running NBN Watch, plus reports from people.</p></div>
    <button class="btn" id="report-hero">Is your NBN down? Report it</button>
  </div>

  <div class="stage" id="map-sec">
    <div class="mapbox">
      <div id="map" role="region" aria-label="Map of NBN problems"></div>
      <div class="legend"><span><i class="dot crit"></i>Outage now</span><span><i class="dot ser"></i>Slow / reported by people</span><span><i class="dot past"></i>Fixed (last 30 days)</span></div>
    </div>
    <aside class="panel" aria-label="Areas">
      <div class="top"><div class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="q" placeholder="Search your suburb or postcode" aria-label="Search suburb or postcode" autocomplete="off"></div></div>
      <div class="body" id="pbody"></div>
    </aside>
  </div>
  <div id="mine-slot"></div>

  <section id="numbers">
    <div class="sh"><div><h3 class="st">The numbers</h3><p class="sub">Problems detected or reported across Australia.</p></div></div>
    <div class="tiles" id="tiles"></div>
    <div class="card chart">
      <div class="ch"><div><b>Problems per day</b> <span class="sub" id="chart-note"></span></div>
        <div class="seg" id="range"><button data-d="7">7 days</button><button data-d="30" class="on">30 days</button><button data-d="90">90 days</button></div></div>
      <div style="position:relative"><div class="bars" id="bars"></div><div class="tip" id="tip"></div></div>
      <div class="xaxis" id="xaxis"></div>
    </div>
  </section>

  <section id="log">
    <div class="sh"><div><h3 class="st">Outage log</h3><p class="sub" id="log-sub">Last 7 days: when each problem started and how long it took to come back.</p></div></div>
    <div class="card scroll"><table><thead><tr><th>Area</th><th>What happened</th><th class="hide-sm">Started</th><th class="r">Lasted</th><th>Status</th></tr></thead><tbody id="logrows"></tbody></table></div>
  </section>

  <section id="community">
    <div class="duo">
      <div class="card cta dc"><div><h4>Talk about it on Discord</h4>
        <p style="margin-top:6px">Is it just you? Ask neighbours in your area, share what your ISP told you, and get help setting up NBN Watch. All discussion lives in our Discord.</p></div>
        <a class="btn" id="discord-btn" href="#" target="_blank" rel="noopener">Join the Discord</a></div>
      <div class="card cta"><div><h4>Get the free app</h4>
        <p style="margin-top:6px">Runs quietly on your computer, reads your modem and alerts you the moment NBN drops — usually before NBN Co’s own status page. Each app adds a dot to this map.</p></div>
        <a class="btn ghost" id="app-btn" href="#" target="_blank" rel="noopener">Download for Windows, Mac or Linux</a></div>
    </div>
  </section>

  <footer>
    <div>NBN Watch is free and open source. Areas are shown to about 1 km; no addresses or personal details are ever published.<br>Not affiliated with NBN Co, Optus or Telstra.</div>
    <div><a id="nbnco" href="#" target="_blank" rel="noopener">NBN Co status</a> · <a id="gh" href="#" target="_blank" rel="noopener">GitHub</a></div>
  </footer>
</main>

<dialog id="dlg"><div class="dlg">
  <h3>Report an NBN problem</h3>
  <div class="sub">Only your ~1 km area appears on the map — never your address.</div>
  <div class="field"><label for="addr">Your address</label>
    <div class="ac"><input type="text" id="addr" autocomplete="off" placeholder="Start typing, e.g. 12 Smith St, Suburb"><div class="ac-menu" id="acmenu" hidden></div></div></div>
  <div class="field"><label>What’s happening?</label><div class="choices" id="problems"></div></div>
  <div class="field" id="ts"></div>
  <div class="msg" id="dmsg"></div>
  <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
    <button class="btn ghost" id="cancel">Cancel</button><button class="btn" id="send" disabled>Report</button></div>
</div></dialog>

<script>
const $=(s)=>document.querySelector(s);
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
async function get(p){const r=await fetch(p,{cache:'no-store'});return r.json();}
async function post(p,b){const r=await fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'failed');return d;}
const dur=(m)=>m==null?'—':m<1?'<1 min':m<60?Math.round(m)+' min':m<1440?(Math.floor(m/60)+'h '+Math.round(m%60)+'m'):(Math.floor(m/1440)+'d '+Math.floor(m%1440/60)+'h');
const minsSince=(iso)=>Math.max(0,(Date.now()-new Date(iso).getTime())/60000);
const when=(iso)=>iso?new Date(iso).toLocaleString([], {weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'';
const day=(iso)=>new Date(iso).toLocaleDateString([], {weekday:'short',day:'numeric',month:'short'});
const name=(a)=>a.suburb||'Unknown area';
const place=(a)=>[a.state,a.postcode].filter(Boolean).join(' ');
const keyOf=(a)=>(a.suburb||'?')+'|'+(a.state||'');
const KIND={nbn_outage:'NBN outage',mobile_backup:'Modem on 4G backup',degraded:'Slow / degraded',user_report:'Reported by people'};
const STATUS={ongoing:'Ongoing',recovered:'Back online',nbn_restored:'Fixed (NBN Co)',expired:'Report faded',no_reports:'Went quiet'};
const ICON={good:'<path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  bad:'<path d="M12 7v6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17" r="1.4" fill="currentColor"/>'};
let CFG={problems:{},links:{}},ALERTS=[],HIST=[],SEL=null,Q='';

// ---------------- data model: areas ----------------
function areas(){
  // Active alerts and the last 30 days of incidents, merged per suburb.
  const m=new Map();
  const get_=(a)=>{const k=keyOf(a);if(!m.has(k))m.set(k,{key:k,suburb:a.suburb,state:a.state,postcode:a.postcode,lat:a.lat,lng:a.lng,alert:null,hist:[]});const o=m.get(k);if(o.lat==null&&a.lat!=null){o.lat=a.lat;o.lng=a.lng;}return o;};
  ALERTS.forEach(a=>{get_(a).alert=a;});
  HIST.forEach(i=>{get_(i).hist.push(i);});
  return [...m.values()];
}
const isSevere=(a)=>a.severity==='outage'&&!a.kinds.user_report;
const match=(a)=>!Q||(a.suburb||'').toLowerCase().includes(Q)||(a.postcode||'').startsWith(Q)||(a.state||'').toLowerCase()===Q;
function summary(list){
  const done=list.filter(i=>i.status!=='ongoing'&&i.status!=='expired');
  const mean=done.length?done.reduce((n,i)=>n+i.duration_min,0)/done.length:null;
  return {count:list.length,mean,longest:list.length?Math.max(...list.map(i=>i.duration_min)):null};
}

// ---------------- side panel ----------------
function renderPanel(){
  const body=$('#pbody');
  if(SEL){body.replaceChildren(detail(SEL));return;}
  const all=areas().filter(match);
  const active=all.filter(a=>a.alert).sort((a,b)=>b.alert.devices-a.alert.devices||a.alert.since.localeCompare(b.alert.since));
  const past=all.filter(a=>!a.alert&&a.hist.length).sort((a,b)=>b.hist[0].started_at.localeCompare(a.hist[0].started_at)).slice(0,30);
  const out=[];
  const t1=el('div','ptitle');t1.append(el('span',null,'Problems now'),el('span','num',String(active.length)));out.push(t1);
  if(!active.length) out.push(Q?emptyBox('Nothing open in “'+Q+'”','No current problems match your search.'):emptyBox('No problems right now','When a modem drops off NBN or someone reports a problem, it shows up here within a minute.'));
  active.forEach(a=>{const r=el('div','row');const al=a.alert;
    const b=el('div');b.append(el('div','t',name(a)),el('div','m',kindText(al.kinds)+' · '+al.devices+(al.devices>1?' homes':' home')+(place(a)?' · '+place(a):'')));
    const d=el('div','d num',dur(minsSince(al.since)));d.append(el('small',null,'so far'));
    r.append(el('i','dot '+(isSevere(al)?'crit':'ser')),b,d);r.onclick=()=>select(a.key,true);out.push(r);});
  if(past.length){const t2=el('div','ptitle');t2.style.marginTop='8px';t2.append(el('span',null,'Fixed in the last 30 days'),el('span','num',String(past.length)));out.push(t2);
    past.forEach(a=>{const r=el('div','row');const last=a.hist[0];const s=summary(a.hist);
      const b=el('div');b.append(el('div','t',name(a)),el('div','m',s.count+(s.count>1?' problems':' problem')+' · last '+day(last.started_at)));
      const d=el('div','d num',dur(last.duration_min));d.append(el('small',null,'last one'));
      r.append(el('i','dot past'),b,d);r.onclick=()=>select(a.key,true);out.push(r);});}
  else if(Q&&!active.length) out.push(emptyBox('','No problems recorded in the last 30 days for this search. Good news for '+Q+'.'));
  body.replaceChildren(...out);
}
function emptyBox(t,s){const e=el('div','empty');if(t)e.append(el('b',null,t));e.append(document.createTextNode(s));return e;}
function kindText(k){return Object.entries(k).map(([x,n])=>(KIND[x]||x)+(n>1?' ×'+n:'')).join(' · ');}

function detail(key){
  const a=areas().find(x=>x.key===key);const box=el('div','detail');
  const back=el('button','back','← All areas');back.onclick=()=>{SEL=null;renderPanel();};box.append(back);
  if(!a){box.append(emptyBox('','This area has no problems on record any more.'));return box;}
  const al=a.alert;
  box.append(el('h2',null,name(a)),el('div','loc',[place(a),'area shown to ~1 km'].filter(Boolean).join(' · ')));
  const pill=al?el('span','pill '+(isSevere(al)?'crit':'ser'),isSevere(al)?'Problem now':'Slow / reported'):el('span','pill good','No problem right now');
  const pw=el('div');pw.style.marginTop='12px';pw.append(pill);box.append(pw);
  if(al){
    const big=el('div','bigdur num',dur(minsSince(al.since)));big.dataset.since=al.since;box.append(big);
    box.append(el('div','sub','down so far'));
    const f=el('div','facts');
    const src=[];if(al.kinds.nbn_outage||al.kinds.mobile_backup||al.kinds.degraded)src.push('home modems');if(al.kinds.user_report)src.push('people');
    [['Started',when(al.since)],['Homes affected',String(al.devices)],['What',kindText(al.kinds)],['Seen by',src.join(' and ')||'—'],
     ['NBN Co',al.nbn_restored?'now says it’s fixed':'not cleared yet'],['Last report',when(al.last_report)+(al.reporting?'':' (devices went quiet)')]]
      .forEach(([k,v])=>f.append(el('div',null,k),el('div',null,v)));
    box.append(f);
  }
  const s=summary(a.hist.filter(i=>i.status!=='ongoing'));
  const mini=el('div','mini');
  [[String(a.hist.length),'in 30 days'],[dur(s.mean),'avg recovery'],[dur(s.longest),'longest']].forEach(([v,k])=>{const d=el('div');d.append(el('b','num',v),el('span',null,k));mini.append(d);});
  box.append(el('div','ptitle',''),mini);
  if(a.hist.length){const h=el('div','hist');
    a.hist.slice(0,12).forEach(i=>{const r=el('div','h');const l=el('div');l.append(el('div',null,when(i.started_at)),el('div','sub',KIND[i.kind]||i.kind));
      const rr=el('div');rr.style.textAlign='right';rr.append(el('div','num',i.status==='ongoing'?'ongoing':dur(i.duration_min)),el('div','sub',STATUS[i.status]||i.status));r.append(l,rr);h.append(r);});
    box.append(h);}
  const act=el('div','actions');
  const rep=el('button','btn sm','Report a problem here');rep.onclick=openReport;act.append(rep);
  if(CFG.links.discord){const d=el('a','btn discord sm','Discuss on Discord');d.href=CFG.links.discord;d.target='_blank';d.rel='noopener';act.append(d);}
  box.append(act);
  return box;
}
function select(key,fly){
  SEL=key;renderPanel();
  const a=areas().find(x=>x.key===key);
  if(fly&&map&&a&&a.lat!=null)map.flyTo({center:[a.lng,a.lat],zoom:Math.max(map.getZoom(),11),speed:1.4});
  if(innerWidth<980)$('.panel').scrollIntoView({behavior:'smooth',block:'start'});
}
setInterval(()=>{document.querySelectorAll('.bigdur').forEach(e=>e.textContent=dur(minsSince(e.dataset.since)));},30000);

// ---------------- map ----------------
const dark=matchMedia('(prefers-color-scheme: dark)').matches;
let map=null;
function setupMap(){
  if(!window.maplibregl){$('#map').append(emptyBox('Map unavailable','The list on the right still works.'));return;}
  const near=CFG.near;
  map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/'+(dark?'dark':'positron'),
    center:near?[near.lng,near.lat]:[134,-28],zoom:near?9.6:3.3,minZoom:3,
    maxBounds:[[100,-50],[170,-5]],attributionControl:{compact:true},cooperativeGestures:matchMedia('(pointer:coarse)').matches});
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
  map.addControl(new maplibregl.GeolocateControl({positionOptions:{enableHighAccuracy:false},fitBoundsOptions:{maxZoom:12}}),'top-right');
  const hover=new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:12});
  map.on('load',()=>{
    map.addSource('areas',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    const ring=dark?'#181817':'#ffffff';
    map.addLayer({id:'past',type:'circle',source:'areas',filter:['==',['get','kind'],'past'],
      paint:{'circle-color':dark?'#6b6b65':'#a3a29a','circle-radius':['interpolate',['linear'],['zoom'],4,3,11,6],'circle-stroke-color':ring,'circle-stroke-width':1.5}});
    map.addLayer({id:'halo',type:'circle',source:'areas',filter:['==',['get','kind'],'crit'],
      paint:{'circle-color':'#d03b3b','circle-opacity':.16,'circle-radius':['+',['interpolate',['linear'],['get','devices'],1,9,10,22],10]}});
    map.addLayer({id:'ser',type:'circle',source:'areas',filter:['==',['get','kind'],'ser'],
      paint:{'circle-color':ring,'circle-radius':['interpolate',['linear'],['get','devices'],1,8,10,20],'circle-stroke-color':'#ec835a','circle-stroke-width':3.5}});
    map.addLayer({id:'crit',type:'circle',source:'areas',filter:['==',['get','kind'],'crit'],
      paint:{'circle-color':'#d03b3b','circle-radius':['interpolate',['linear'],['get','devices'],1,9,10,22],'circle-stroke-color':ring,'circle-stroke-width':2,
        'circle-opacity':['case',['get','reporting'],1,.5]}});
    for(const id of ['past','ser','crit']){
      map.on('click',id,(e)=>select(e.features[0].properties.key,false));
      map.on('mouseenter',id,(e)=>{map.getCanvas().style.cursor='pointer';const p=e.features[0].properties;const b=el('div');b.append(el('b',null,p.name),el('div',null,p.label));hover.setLngLat(e.features[0].geometry.coordinates).setDOMContent(b).addTo(map);});
      map.on('mouseleave',id,()=>{map.getCanvas().style.cursor='';hover.remove();});
    }
    drawMap();
  });
}
let fitted=false;
function drawMap(){
  if(!map||!map.getSource('areas'))return;
  const feats=areas().filter(a=>a.lat!=null).map(a=>{const al=a.alert;
    const kind=al?(isSevere(al)?'crit':'ser'):'past';
    const label=al?(kindText(al.kinds)+' · '+dur(minsSince(al.since))+' so far'):(a.hist.length+(a.hist.length>1?' problems':' problem')+' in 30 days, now fixed');
    return {type:'Feature',geometry:{type:'Point',coordinates:[a.lng,a.lat]},properties:{key:a.key,name:name(a),kind,label,devices:al?al.devices:1,reporting:al?al.reporting:true}};});
  map.getSource('areas').setData({type:'FeatureCollection',features:feats});
  const live=feats.filter(f=>f.properties.kind!=='past');
  if(live.length&&!fitted&&!CFG.near){fitted=true;const b=new maplibregl.LngLatBounds();live.forEach(f=>b.extend(f.geometry.coordinates));map.fitBounds(b,{padding:80,maxZoom:10});}
}

// ---------------- banner ----------------
function renderBanner(){
  const n=ALERTS.length,homes=ALERTS.reduce((s,a)=>s+a.devices,0);
  const near=CFG.near&&CFG.near.city;
  const nearOnes=CFG.near?ALERTS.filter(a=>a.lat!=null&&Math.hypot(a.lat-CFG.near.lat,(a.lng-CFG.near.lng)*Math.cos(a.lat*Math.PI/180))<0.25):[];
  const severe=ALERTS.some(isSevere);
  const b=$('#banner');b.className='banner'+(n?(severe?' bad':' warn'):'');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','22');svg.setAttribute('height','22');svg.setAttribute('viewBox','0 0 24 24');
  const parsed=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">'+(n?ICON.bad:ICON.good)+'</svg>','image/svg+xml');
  [...parsed.documentElement.childNodes].forEach(c=>svg.append(document.importNode(c,true)));
  $('#banner-ic').replaceChildren(svg);
  let h;
  if(near) h=nearOnes.length?('NBN problems near '+near+' right now'):('No known NBN problems near '+near);
  else h=n?('NBN problems in '+n+(n>1?' areas':' area')+' right now'):'No known NBN problems right now';
  $('#headline').textContent=h;
  $('#headsub').textContent=(n?(n+(n>1?' areas':' area')+' · '+homes+(homes>1?' homes':' home')+' affected across Australia'):'Nothing open across Australia')+' · updated '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
}

// ---------------- numbers ----------------
function tile(k,v,n,cls){const t=el('div','tile'+(cls?' '+cls:''));t.append(el('div','k',k),el('div','v num',v),el('div','n',n||''));return t;}
async function loadNumbers(){
  const s=await get('/api/stats?days=30').catch(()=>null);
  if(!s){$('#tiles').replaceChildren(emptyBox('','Numbers unavailable right now.'));return;}
  const d=s.daily,L=d.length;const sum=(a,b)=>d.slice(a,b).reduce((n,x)=>n+x.incidents,0);
  const yest=L>=2?d[L-2].incidents:0, before=L>=3?d[L-3].incidents:0, week=sum(L-7,L), prevWeek=sum(L-14,L-7);
  const homes=ALERTS.reduce((n,a)=>n+a.devices,0);
  const cmp=(a,b,unit)=>a===b?'same as the '+unit+' before':(a>b?(a-b)+' more':(b-a)+' fewer')+' than the '+unit+' before';
  $('#tiles').replaceChildren(
    tile('Problems now',String(ALERTS.length),ALERTS.length?homes+(homes>1?' homes':' home')+' affected':'all clear',ALERTS.length?'live':''),
    tile('Yesterday',String(yest),cmp(yest,before,'day')),
    tile('Last 7 days',String(week),cmp(week,prevWeek,'week')),
    tile('Average recovery',dur(s.overall.mean_recovery_min),s.overall.median_recovery_min!=null?'typical '+dur(s.overall.median_recovery_min)+' · last 30 days':'last 30 days'));
}
async function loadChart(days){
  const s=await get('/api/stats?days='+days).catch(()=>null);if(!s)return;
  const max=Math.max(1,...s.daily.map(d=>d.incidents));const bars=$('#bars');bars.replaceChildren();
  const step=Math.max(1,Math.ceil(max/3));for(let v=step;v<=max;v+=step){const g=el('div','grid-line');g.style.bottom=(v/max*100)+'%';g.append(el('span',null,String(v)));bars.append(g);}
  const tip=$('#tip');
  s.daily.forEach((d)=>{const hit=el('div','hit');const b=el('div','b');b.style.height=(d.incidents/max*100)+'%';
    hit.append(b);hit.setAttribute('aria-label',d.date+': '+d.incidents+' problems');
    hit.onmouseenter=()=>{tip.textContent=day(d.date+'T12:00:00Z')+' · '+d.incidents+(d.incidents===1?' problem':' problems');
      tip.style.display='block';tip.style.left=(hit.offsetLeft+hit.offsetWidth/2)+'px';tip.style.top=(24+160-(d.incidents/max*160))+'px';};
    hit.onmouseleave=()=>{tip.style.display='none';};bars.append(hit);});
  const fmt=(x)=>new Date(x+'T12:00:00Z').toLocaleDateString([], {day:'numeric',month:'short'});
  $('#xaxis').replaceChildren(el('span',null,fmt(s.daily[0].date)),el('span',null,fmt(s.daily[Math.floor(s.daily.length/2)].date)),el('span',null,'Today'));
  $('#chart-note').textContent=s.overall.incidents?'· '+s.overall.incidents+' in '+days+' days':'· none recorded in '+days+' days';
}
document.querySelectorAll('#range button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#range button').forEach(x=>x.classList.toggle('on',x===b));loadChart(Number(b.dataset.d));});

// ---------------- outage log ----------------
function renderLog(){
  const week=Date.now()-7*864e5;
  const rows=HIST.filter(i=>new Date(i.started_at).getTime()>=week||i.status==='ongoing').filter(match).slice(0,60);
  $('#log-sub').textContent=Q?('Last 7 days matching “'+Q+'”.'):'Last 7 days: when each problem started and how long it took to come back.';
  if(!rows.length){const tr=el('tr');const td=el('td','empty',Q?'Nothing in the last 7 days for this search.':'No problems in the last 7 days.');td.colSpan=5;tr.append(td);$('#logrows').replaceChildren(tr);return;}
  $('#logrows').replaceChildren(...rows.map(i=>{const tr=el('tr');
    const st=i.status==='ongoing'?el('span','pill crit','Ongoing'):el('span','pill '+(i.status==='recovered'||i.status==='nbn_restored'?'good':'plain'),STATUS[i.status]||i.status);
    const a=el('td');a.append(el('b',null,name(i)),document.createTextNode(place(i)?'  '+place(i):''));
    const s=el('td');s.append(st);
    tr.append(a,el('td',null,KIND[i.kind]||i.kind),el('td','hide-sm',when(i.started_at)),el('td','r',i.status==='ongoing'?dur(minsSince(i.started_at))+' so far':dur(i.duration_min)),s);
    tr.onclick=()=>{select(keyOf(i),true);$('#map-sec').scrollIntoView({behavior:'smooth'});};return tr;}));
}

// ---------------- loading ----------------
async function loadLive(){
  const [a,h]=await Promise.all([get('/api/alerts').catch(()=>({alerts:[]})),get('/api/incidents?days=30').catch(()=>({incidents:[]}))]);
  ALERTS=a.alerts||[];HIST=h.incidents||[];
  renderBanner();renderPanel();drawMap();renderLog();
}
let qt=null;
$('#q').oninput=()=>{clearTimeout(qt);qt=setTimeout(()=>{Q=$('#q').value.trim().toLowerCase();SEL=null;renderPanel();renderLog();},150);};
$('#q').onkeydown=(e)=>{if(e.key==='Enter'){const a=areas().filter(match).sort((x,y)=>(y.alert?1:0)-(x.alert?1:0))[0];if(a)select(a.key,true);}};

function renderLinks(){
  const L=CFG.links||{};
  const dc=$('#discord-btn'),nav=$('#nav-discord');
  if(L.discord){dc.href=L.discord;nav.href=L.discord;nav.target='_blank';nav.rel='noopener';}
  else{dc.textContent='Discord opening soon';dc.removeAttribute('href');dc.style.opacity='.75';nav.style.display='none';}
  if(L.github){$('#gh').href=L.github;$('#app-btn').href=L.github+'/releases/latest';}
  if(L.nbn_status)$('#nbnco').href=L.nbn_status;
}

// ---------------- manual report ----------------
let chosen=null,problem=null,tsWidget=null,tsToken='';
function openReport(){
  const dlg=$('#dlg');chosen=null;problem=null;$('#addr').value='';$('#dmsg').textContent='';$('#dmsg').className='msg';update();
  const box=$('#problems');box.replaceChildren(...Object.entries(CFG.problems).map(([k,v])=>{const b=el('button',null,v);b.type='button';
    b.onclick=()=>{problem=k;box.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));update();};return b;}));
  dlg.showModal();setTimeout(()=>$('#addr').focus(),50);
  if(window.turnstile&&CFG.turnstile_site_key){
    if(tsWidget!==null)turnstile.reset(tsWidget);
    else tsWidget=turnstile.render('#ts',{sitekey:CFG.turnstile_site_key,theme:dark?'dark':'light',callback:(t)=>{tsToken=t;update();},'expired-callback':()=>{tsToken='';update();}});
  }
}
function update(){$('#send').disabled=!(chosen&&problem&&tsToken);}
let acTimer=null,acSeq=0;
$('#addr').oninput=()=>{chosen=null;update();clearTimeout(acTimer);acTimer=setTimeout(async()=>{
  const q=$('#addr').value.trim();const menu=$('#acmenu');const mine=++acSeq;
  if(q.length<4){menu.hidden=true;return;}
  const d=await get('/api/address-search?q='+encodeURIComponent(q)).catch(()=>({results:[]}));
  if(mine!==acSeq)return;
  menu.replaceChildren(...(d.results||[]).map(r=>{const o=el('div',null,r.address);o.onmousedown=(e)=>{e.preventDefault();chosen=r;$('#addr').value=r.address;menu.hidden=true;update();};return o;}));
  if(d.error)menu.replaceChildren(el('div',null,d.error));
  menu.hidden=!menu.children.length;},300);};
$('#addr').onblur=()=>setTimeout(()=>$('#acmenu').hidden=true,150);
$('#cancel').onclick=()=>$('#dlg').close();
$('#send').onclick=async()=>{
  const msg=$('#dmsg');$('#send').disabled=true;
  try{const r=await post('/api/manual-report',{loc_id:chosen.loc_id,problem,turnstile:tsToken});
    try{localStorage.setItem('nbnw-report',JSON.stringify({token:r.close_token,area:r.area,at:Date.now()}));}catch(e){}
    msg.className='msg ok';msg.textContent='Thanks — your report is on the map for '+r.area+'. It fades after 6 hours unless others report too.';
    setTimeout(()=>{$('#dlg').close();loadLive();showMine();},1800);
  }catch(e){msg.className='msg bad';msg.textContent=e.message;tsToken='';if(window.turnstile&&tsWidget!==null)turnstile.reset(tsWidget);update();}
};
function showMine(){
  let mine=null;try{mine=JSON.parse(localStorage.getItem('nbnw-report')||'null');}catch(e){}
  const slot=$('#mine-slot');slot.replaceChildren();
  if(!mine||Date.now()-mine.at>6*3600e3)return;
  const bar=el('div','card mine');
  bar.append(el('span',null,'You reported a problem in '+mine.area+'. Is it back?'));
  const b=el('button','btn sm','Yes, it’s fixed');b.onclick=async()=>{await post('/api/manual-report/close',{close_token:mine.token}).catch(()=>{});
    try{localStorage.removeItem('nbnw-report');}catch(e){}slot.replaceChildren();loadLive();};
  bar.append(b);slot.append(bar);
}
$('#report-top').onclick=openReport;$('#report-hero').onclick=openReport;

(async()=>{CFG=await get('/api/config').catch(()=>CFG);renderLinks();setupMap();await loadLive();loadNumbers();loadChart(30);showMine();
  setInterval(async()=>{await loadLive();loadNumbers();},60000);})();
</script>
</body>
</html>`;
