// Public NBN Watch page: live map, outage statistics, manual reports, links out
// for discussion. All data is rendered with textContent (never innerHTML).
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NBN Watch</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="description" content="Live NBN outages across Australia, detected by home routers and reported by people. Outage counts and recovery times by area.">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.js"></script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
<style>
:root{
  --bg:#f6f6f3; --surface:#fcfcfb; --raised:#ffffff; --text:#0b0b0b; --text2:#4a4a46; --muted:#77776f;
  --line:rgba(11,11,11,.10); --grid:#e1e0d9; --axis:#c3c2b7;
  --bar:#3b6fd8; --accent:#3b6fd8; --critical:#d03b3b; --serious:#ec835a; --good:#0ca30c;
  --shadow:0 1px 2px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.04);
  --radius:14px; --font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
@media (prefers-color-scheme: dark){:root{
  --bg:#111110; --surface:#1a1a19; --raised:#20201f; --text:#f2f2ee; --text2:#c9c9c2; --muted:#93938b;
  --line:rgba(255,255,255,.10); --grid:#2c2c2a; --axis:#383835; --bar:#6f92ea; --accent:#7aa2f7;
  --shadow:none;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 var(--font);-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
.wrap{max-width:1120px;margin:0 auto;padding:0 16px}
nav{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;gap:20px;height:56px}
.logo{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:-.01em;color:var(--text)}
.logo i{width:12px;height:12px;border-radius:50%;background:var(--good);box-shadow:0 0 0 4px color-mix(in srgb,var(--good) 20%,transparent)}
.logo i.bad{background:var(--critical);box-shadow:0 0 0 4px color-mix(in srgb,var(--critical) 20%,transparent)}
nav .links{display:flex;gap:18px;margin-left:auto;font-size:14px}
nav .links a{color:var(--text2)}
.btn{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:10px 18px;font:600 14px var(--font);cursor:pointer;background:var(--text);color:var(--bg)}
.btn.ghost{background:transparent;color:var(--text);box-shadow:inset 0 0 0 1px var(--line)}
.btn:disabled{opacity:.5;cursor:default}
header.hero{padding:40px 0 22px}
.hero h1{font-size:clamp(26px,4vw,40px);line-height:1.15;letter-spacing:-.02em;margin:0 0 10px;max-width:760px}
.hero p{color:var(--text2);margin:0 0 20px;max-width:680px}
.hero .row{display:flex;gap:10px;flex-wrap:wrap}
.card{background:var(--raised);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
#map{height:460px;border-radius:var(--radius);overflow:hidden;border:1px solid var(--line);background:var(--surface)}
.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--text2);margin:10px 2px 0}
.legend span{display:inline-flex;align-items:center;gap:6px}
.dot{width:11px;height:11px;border-radius:50%;display:inline-block}
.dot.fill{background:var(--critical);box-shadow:0 0 0 2px var(--surface)}
.dot.ring{border:2.5px solid var(--serious);background:transparent}
section{padding:34px 0 0}
h2{font-size:20px;letter-spacing:-.01em;margin:0 0 4px}
.sub{color:var(--muted);font-size:14px;margin:0 0 16px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.tile{padding:16px 18px}
.tile .k{font-size:13px;color:var(--muted)}
.tile .v{font-size:28px;font-weight:700;letter-spacing:-.02em;margin-top:2px;font-variant-numeric:tabular-nums}
.tile .n{font-size:12px;color:var(--muted)}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px;gap:2px;background:var(--surface)}
.seg button{border:0;background:transparent;color:var(--text2);font:500 13px var(--font);padding:5px 12px;border-radius:999px;cursor:pointer}
.seg button.on{background:var(--text);color:var(--bg)}
.head{display:flex;align-items:end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.chart{padding:18px 18px 10px;position:relative}
.bars{display:flex;align-items:flex-end;gap:2px;height:150px;border-bottom:1px solid var(--axis);position:relative}
.bars .b{flex:1;min-width:2px;background:var(--bar);border-radius:4px 4px 0 0;position:relative;cursor:default}
.bars .b.zero{background:transparent}
.bars .hit{flex:1;height:100%;display:flex;align-items:flex-end}
.bars .hit:hover .b:not(.zero){filter:brightness(1.12)}
.grid-line{position:absolute;left:0;right:0;border-top:1px dashed var(--grid);font-size:11px;color:var(--muted)}
.grid-line span{position:absolute;right:0;top:-16px}
.xaxis{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:6px}
.tip{position:absolute;pointer-events:none;background:var(--text);color:var(--bg);font-size:12px;padding:6px 9px;border-radius:8px;white-space:nowrap;transform:translate(-50%,-110%);display:none}
.cols{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}
@media (max-width:860px){.cols{grid-template-columns:1fr} nav .links{display:none}}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:12px;color:var(--muted);font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
.scroll{overflow-x:auto}
.empty{padding:18px;color:var(--muted);text-align:center}
.list .item{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-bottom:1px solid var(--line)}
.list .item:last-child{border-bottom:0}
.list .t{font-weight:600}
.list .m{font-size:13px;color:var(--muted)}
.pill{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--text2);white-space:nowrap}
.discuss{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.discuss a{display:block;padding:16px 18px;color:var(--text)}
.discuss a:hover{text-decoration:none;border-color:var(--accent)}
.discuss b{display:block;margin-bottom:2px}
.discuss span{font-size:13px;color:var(--muted)}
footer{padding:40px 0 50px;color:var(--muted);font-size:13px}
dialog{border:0;border-radius:18px;padding:0;width:min(520px,calc(100vw - 32px));background:var(--raised);color:var(--text);box-shadow:0 20px 60px rgba(0,0,0,.3)}
dialog::backdrop{background:rgba(0,0,0,.45)}
.dlg{padding:22px}
.dlg h3{margin:0 0 4px;font-size:18px}
.field{margin-top:14px} .field label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
input[type=text]{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--text);font:15px var(--font);outline:none}
input[type=text]:focus{border-color:var(--accent)}
.ac{position:relative}
.ac-menu{position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--raised);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.15);max-height:240px;overflow:auto;z-index:3}
.ac-menu div{padding:9px 12px;cursor:pointer;font-size:14px}
.ac-menu div:hover,.ac-menu div.on{background:color-mix(in srgb,var(--accent) 12%,transparent)}
.choices{display:flex;gap:8px;flex-wrap:wrap}
.choices button{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:999px;padding:8px 14px;font:500 14px var(--font);cursor:pointer}
.choices button.on{border-color:var(--text);background:var(--text);color:var(--bg)}
.msg{margin-top:12px;font-size:14px}
.msg.bad{color:var(--critical)} .msg.ok{color:var(--good)}
.maplibregl-popup-content{background:var(--raised);color:var(--text);border-radius:10px;font:13px var(--font);box-shadow:0 6px 24px rgba(0,0,0,.2)}
.maplibregl-popup-tip{display:none}
</style>
</head>
<body>
<nav><div class="wrap">
  <a class="logo" href="#"><i id="logodot"></i>NBN Watch</a>
  <div class="links"><a href="#map-sec">Map</a><a href="#stats">Statistics</a><a href="#log">Outage log</a><a href="#discuss">Discuss</a><a id="gh" href="#">Get the app</a></div>
  <button class="btn" id="report-top">Report a problem</button>
</div></nav>

<div class="wrap">
  <header class="hero">
    <h1 id="headline">Checking NBN across Australia…</h1>
    <p>Live outages detected by home routers running the free NBN Watch app — usually before NBN Co's own status page — plus reports from people. Areas are shown to about 1 km; addresses are never shared.</p>
    <div class="row"><button class="btn" id="report-hero">Is your NBN down? Report it</button><a class="btn ghost" id="app-link" href="#">Get the app</a></div>
  </header>

  <section id="map-sec" style="padding-top:6px">
    <div id="map" role="region" aria-label="Map of current NBN problems"></div>
    <div class="legend"><span><i class="dot fill"></i>Outage / on 4G backup (detected)</span><span><i class="dot ring"></i>Reported by people / degraded</span><span id="map-note"></span></div>
  </section>

  <section id="stats">
    <div class="head">
      <div><h2>Outage statistics</h2><p class="sub" style="margin:0">How often NBN drops, and how long it takes to come back.</p></div>
      <div class="seg" id="range"><button data-d="7">7 days</button><button data-d="30" class="on">30 days</button><button data-d="90">90 days</button></div>
    </div>
    <div class="tiles" id="tiles"></div>
    <div class="card chart" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:14px">Outages per day</b><span class="sub" id="chart-note" style="margin:0"></span></div>
      <div style="position:relative;margin-top:22px"><div class="bars" id="bars"></div><div class="tip" id="tip"></div></div>
      <div class="xaxis" id="xaxis"></div>
    </div>
    <div class="cols" style="margin-top:14px">
      <div class="card scroll"><table><thead><tr><th>Most affected areas</th><th class="num">Outages</th><th class="num">Avg recovery</th><th class="num">Total down</th></tr></thead><tbody id="areas"></tbody></table></div>
      <div class="card scroll"><table><thead><tr><th>Connection type</th><th class="num">Outages</th><th class="num">Avg recovery</th></tr></thead><tbody id="tech"></tbody></table>
        <table style="border-top:1px solid var(--line)"><thead><tr><th>State</th><th class="num">Outages</th><th class="num">Avg recovery</th></tr></thead><tbody id="states"></tbody></table></div>
    </div>
  </section>

  <section id="log">
    <div class="cols">
      <div><h2>Happening now</h2><p class="sub">Open problems, newest first.</p><div class="card list" id="alerts"></div></div>
      <div><h2>Recent outages</h2><p class="sub">Last 7 days with recovery times.</p><div class="card list" id="recent"></div></div>
    </div>
  </section>

  <section id="discuss">
    <h2>Talk about it</h2><p class="sub">This site shows the data. For discussion, join the community where it already happens.</p>
    <div class="discuss" id="links"></div>
  </section>

  <footer>NBN Watch is open source (MIT). Data: NBN Watch app reports, people's reports and NBN Co's public status. Not affiliated with NBN Co, Optus or Telstra. Areas are approximate (~1 km) and no addresses or personal details are published.</footer>
</div>

<dialog id="dlg"><div class="dlg">
  <h3>Report an NBN problem</h3>
  <div class="sub" style="margin:0">Your exact address is never shown — only your ~1 km area.</div>
  <div class="field"><label for="addr">Your address</label>
    <div class="ac"><input type="text" id="addr" autocomplete="off" placeholder="Start typing, e.g. 12 Smith St Suburb"><div class="ac-menu" id="acmenu" hidden></div></div></div>
  <div class="field"><label>What's happening?</label><div class="choices" id="problems"></div></div>
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
const dur=(m)=>m==null?'—':m<60?m+' min':m<1440?(Math.floor(m/60)+'h '+(m%60)+'m'):(Math.floor(m/1440)+'d '+Math.floor(m%1440/60)+'h');
const when=(iso)=>iso?new Date(iso).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit',day:'numeric',month:'short'}):'';
const area=(a)=>[a.suburb||'Unknown area',a.state,a.postcode].filter(Boolean).join(' ');
const KIND={nbn_outage:'NBN outage',mobile_backup:'On 4G backup',degraded:'Degraded',user_report:'Reported by people'};
let CFG={problems:{},links:{}};

// ---------------- map ----------------
const dark=matchMedia('(prefers-color-scheme: dark)').matches;
let map=null;
function setupMap(){
  if(!window.maplibregl){$('#map').append(el('div','empty','Map unavailable right now.'));return;}
  // Australia only. Start near the visitor (approximate, from their network) when in AU.
  const near=CFG.near;
  map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/'+(dark?'dark':'positron'),
    center:near?[near.lng,near.lat]:[134,-28],zoom:near?9.5:3.2,minZoom:3,
    maxBounds:[[105,-50],[165,-5]],attributionControl:{compact:true},cooperativeGestures:true});
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
  map.addControl(new maplibregl.GeolocateControl({positionOptions:{enableHighAccuracy:false},fitBoundsOptions:{maxZoom:12},showUserLocation:true}),'top-right');
  if(near&&near.city)$('#map-note').textContent='Showing around '+near.city;
  map.on('load',()=>{
    map.addSource('alerts',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'detected',type:'circle',source:'alerts',filter:['==',['get','style'],'fill'],
      paint:{'circle-color':'#d03b3b','circle-radius':['interpolate',['linear'],['get','devices'],1,8,10,20],
        'circle-stroke-color':dark?'#1a1a19':'#fcfcfb','circle-stroke-width':2,'circle-opacity':['case',['get','reporting'],.9,.45]}});
    map.addLayer({id:'reported',type:'circle',source:'alerts',filter:['==',['get','style'],'ring'],
      paint:{'circle-color':'rgba(0,0,0,0)','circle-radius':['interpolate',['linear'],['get','devices'],1,8,10,20],
        'circle-stroke-color':'#ec835a','circle-stroke-width':3}});
    for(const id of ['detected','reported']){
      map.on('click',id,(e)=>{const p=e.features[0].properties;const box=el('div');
        box.append(el('b',null,p.area),el('div',null,p.kinds),el('div',null,'Since '+p.since),el('div',null,p.status));
        new maplibregl.Popup({closeButton:false}).setLngLat(e.lngLat).setDOMContent(box).addTo(map);});
      map.on('mouseenter',id,()=>map.getCanvas().style.cursor='pointer');
      map.on('mouseleave',id,()=>map.getCanvas().style.cursor='');
    }
    loadAlerts();
  });
}

let fitted=false;
async function loadAlerts(){
  const a=await get('/api/alerts').catch(()=>({alerts:[]}));
  const alerts=a.alerts||[];
  const affected=alerts.reduce((n,x)=>n+x.devices,0);
  $('#headline').textContent=alerts.length?('NBN problems in '+alerts.length+(alerts.length>1?' areas':' area')+' right now'):'No NBN problems reported right now';
  $('#logodot').className=alerts.length?'bad':'';
  if(map&&map.getSource('alerts')){
    const feats=alerts.filter(x=>x.lat!=null).map(x=>({type:'Feature',geometry:{type:'Point',coordinates:[x.lng,x.lat]},
      properties:{devices:x.devices,reporting:x.reporting,style:(x.severity==='outage'&&!x.kinds.user_report)?'fill':'ring',area:area(x),
        kinds:Object.entries(x.kinds).map(([k,n])=>(KIND[k]||k)+(n>1?' ×'+n:'')).join(' · '),since:when(x.since),
        status:x.nbn_restored?'NBN Co now reports normal':x.reporting?'Still affected':'Devices went quiet (maybe offline)'}}));
    map.getSource('alerts').setData({type:'FeatureCollection',features:feats});
    // Visitors in Australia stay centred on their own area; others see where problems are.
    if(feats.length&&!fitted&&!CFG.near){fitted=true;const b=new maplibregl.LngLatBounds();feats.forEach(f=>b.extend(f.geometry.coordinates));map.fitBounds(b,{padding:80,maxZoom:feats.length>1?10:8});}
  }
  if(affected)$('#map-note').textContent=affected+(affected===1?' home':' homes')+' affected nationally';
  const list=$('#alerts');
  list.replaceChildren(...(alerts.length?alerts.map(x=>{const it=el('div','item');
    const ring=(x.severity==='outage'&&!x.kinds.user_report)?'fill':'ring';const d=el('i','dot '+ring);d.style.marginTop='6px';
    const body=el('div');body.style.flex='1';
    body.append(el('div','t',area(x)),el('div','m',Object.entries(x.kinds).map(([k,n])=>(KIND[k]||k)+(n>1?' ×'+n:'')).join(' · ')+' · since '+when(x.since)));
    it.append(d,body,el('span','pill',x.devices+(x.devices>1?' homes':' home')));return it;}):[el('div','empty','🟢 Nothing open right now.')]));
}

// ---------------- stats ----------------
async function loadStats(days){
  const s=await get('/api/stats?days='+days).catch(()=>null);
  if(!s){$('#tiles').replaceChildren(el('div','empty','Statistics unavailable.'));return;}
  const o=s.overall;
  const tile=(k,v,n)=>{const t=el('div','card tile');t.append(el('div','k',k),el('div','v',v),el('div','n',n||''));return t;};
  $('#tiles').replaceChildren(
    tile('Outages',String(o.incidents),o.ongoing?o.ongoing+' still open':'last '+days+' days'),
    tile('Average recovery',dur(o.mean_recovery_min),'mean time back online'),
    tile('Typical recovery',dur(o.median_recovery_min),'median'),
    tile('Longest outage',dur(o.longest_min),''),
    tile('Reports',String(s.sources.app+s.sources.people),s.sources.app+' by routers · '+s.sources.people+' by people'));
  // bars: one series, rounded data-ends, recessive grid, hover tooltip
  const max=Math.max(1,...s.daily.map(d=>d.incidents));const bars=$('#bars');bars.replaceChildren();
  const step=Math.max(1,Math.ceil(max/3));for(let v=step;v<=max;v+=step){const g=el('div','grid-line');g.style.bottom=(v/max*100)+'%';g.append(el('span',null,String(v)));bars.append(g);}
  const tip=$('#tip');
  s.daily.forEach((d)=>{const hit=el('div','hit');const b=el('div','b'+(d.incidents?'':' zero'));b.style.height=(d.incidents/max*100)+'%';
    hit.append(b);hit.setAttribute('aria-label',d.date+': '+d.incidents+' outages');
    hit.onmouseenter=()=>{tip.textContent=new Date(d.date).toLocaleDateString([], {day:'numeric',month:'short'})+' · '+d.incidents+' outage'+(d.incidents===1?'':'s');
      tip.style.display='block';tip.style.left=(hit.offsetLeft+hit.offsetWidth/2)+'px';tip.style.top=(150-(d.incidents/max*150))+'px';};
    hit.onmouseleave=()=>{tip.style.display='none';};bars.append(hit);});
  const fmt=(x)=>new Date(x).toLocaleDateString([], {day:'numeric',month:'short'});
  $('#xaxis').replaceChildren(el('span',null,fmt(s.daily[0].date)),el('span',null,fmt(s.daily[Math.floor(s.daily.length/2)].date)),el('span',null,'Today'));
  $('#chart-note').textContent=o.incidents?'':'No outages recorded in this period';
  const rows=(tbody,list,cols)=>{$(tbody).replaceChildren(...(list.length?list.map(r=>{const tr=el('tr');cols.forEach((c,i)=>tr.append(el('td',i?'num':null,c(r))));return tr;})
    :[(()=>{const tr=el('tr');const td=el('td','empty','No data yet');td.colSpan=cols.length;tr.append(td);return tr;})()]));};
  rows('#areas',s.areas,[r=>r.area,r=>String(r.incidents),r=>dur(r.mean_recovery_min),r=>dur(r.downtime_min)]);
  rows('#tech',s.tech,[r=>r.tech,r=>String(r.incidents),r=>dur(r.mean_recovery_min)]);
  rows('#states',s.states,[r=>r.state,r=>String(r.incidents),r=>dur(r.mean_recovery_min)]);
}
document.querySelectorAll('#range button').forEach(b=>b.onclick=()=>{document.querySelectorAll('#range button').forEach(x=>x.classList.toggle('on',x===b));loadStats(Number(b.dataset.d));});

async function loadRecent(){
  const r=await get('/api/incidents?days=7').catch(()=>({incidents:[]}));
  const list=(r.incidents||[]).slice(0,12);
  $('#recent').replaceChildren(...(list.length?list.map(i=>{const it=el('div','item');const body=el('div');body.style.flex='1';
    body.append(el('div','t',area(i)),el('div','m',(KIND[i.kind]||i.kind)+' · '+when(i.started_at)+(i.ended_at?' → '+when(i.ended_at):'')));
    const st=i.status==='ongoing'?'ongoing':i.status==='expired'?'faded':dur(i.duration_min);
    it.append(body,el('span','pill',st));return it;}):[el('div','empty','No outages in the last 7 days.')]));
}

// ---------------- discuss links ----------------
function renderLinks(){
  const L=CFG.links||{};const items=[
    [L.discord,'Discord','Chat with other NBN Watch users'],
    [L.discussions,'GitHub Discussions','Router support, ideas and development'],
    [L.reddit,'r/nbn','Australia\\'s NBN subreddit'],
    [L.whirlpool,'Whirlpool forums','Australia\\'s broadband community'],
    [L.nbn_status,'NBN Co status','Official outage checker']];
  $('#links').replaceChildren(...items.filter(x=>x[0]).map(([href,t,s])=>{const a=el('a','card');a.href=href;a.target='_blank';a.rel='noopener';a.append(el('b',null,t),el('span',null,s));return a;}));
  if(L.github){$('#gh').href=L.github;$('#app-link').href=L.github;}
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
    setTimeout(()=>{$('#dlg').close();loadAlerts();showMine();},1800);
  }catch(e){msg.className='msg bad';msg.textContent=e.message;tsToken='';if(window.turnstile&&tsWidget!==null)turnstile.reset(tsWidget);update();}
};
function showMine(){
  let mine=null;try{mine=JSON.parse(localStorage.getItem('nbnw-report')||'null');}catch(e){}
  const old=document.getElementById('mine');if(old)old.remove();
  if(!mine||Date.now()-mine.at>6*3600e3)return;
  const bar=el('div','card');bar.id='mine';bar.style.cssText='display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;margin-top:12px;flex-wrap:wrap';
  bar.append(el('span',null,'You reported a problem in '+mine.area+'. Back online?'));
  const b=el('button','btn','It\\'s fixed');b.onclick=async()=>{await post('/api/manual-report/close',{close_token:mine.token}).catch(()=>{});
    try{localStorage.removeItem('nbnw-report');}catch(e){}bar.remove();loadAlerts();loadRecent();};
  bar.append(b);$('#map-sec').append(bar);
}
$('#report-top').onclick=openReport;$('#report-hero').onclick=openReport;

(async()=>{CFG=await get('/api/config').catch(()=>CFG);renderLinks();setupMap();if(!map)loadAlerts();loadStats(30);loadRecent();showMine();
  setInterval(()=>{loadAlerts();loadRecent();},60000);})();
</script>
</body>
</html>`;
