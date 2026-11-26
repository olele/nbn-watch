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
.legend .mut{color:var(--muted)}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}
.dia{width:9px;height:9px;background:var(--accent);transform:rotate(45deg);display:inline-block;flex:none;border-radius:1.5px}
.src{font-size:11.5px;font-weight:600;color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent);padding:2px 7px;border-radius:999px;white-space:nowrap}
.dot.crit{background:var(--critical)} .dot.ser{border:2.5px solid var(--serious)} .dot.past{background:var(--past);width:7px;height:7px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);display:flex;flex-direction:column;min-height:560px;max-height:560px;overflow:hidden}
.panel .top{padding:14px 14px 10px;border-bottom:1px solid var(--line)}
.search{position:relative}
.search input{width:100%;padding:10px 12px 10px 36px;border-radius:9px;border:1px solid var(--line2);background:var(--sunken);color:var(--text);font:14px var(--font);outline:none}
.search input:focus{border-color:var(--accent);background:var(--surface)}
.search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:var(--muted)}
.panel .body{overflow:auto;flex:1}
.ptabs{display:flex;gap:4px;margin-top:10px}
.ptabs button{flex:1;border:1px solid var(--line);background:transparent;color:var(--text2);font:500 12.5px var(--font);padding:6px 4px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px}
.ptabs button.on{background:var(--text);color:var(--bg);border-color:var(--text)}
.ptabs .n{font-size:11px;opacity:.7;font-variant-numeric:tabular-nums}
.pmore{padding:6px 16px 12px;border-top:1px solid var(--line)}
button.link{border:0;background:none;color:var(--accent);font:500 13px var(--font);cursor:pointer;padding:6px 0}
.maphint{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);z-index:2;display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--line2);border-radius:999px;padding:6px 6px 6px 14px;font-size:13px;box-shadow:var(--shadow);white-space:nowrap}
.maphint[hidden]{display:none}
.maphint button{border:0;border-radius:999px;background:var(--text);color:var(--bg);font:600 12.5px var(--font);padding:6px 11px;cursor:pointer}
.legend button{all:unset;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.legend button.off{opacity:.35;text-decoration:line-through}
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

.more{text-align:center;margin-top:12px}
.official{padding:18px;margin-top:12px}
.oh{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ostats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:14px}
.ostats div{border-left:2px solid var(--line);padding-left:12px}
.ostats b{display:block;font-size:22px;letter-spacing:-.02em}
.ostats span{font-size:12.5px;color:var(--muted)}
@media (max-width:700px){.ostats{grid-template-columns:1fr 1fr}}
/* trust */
.trust{display:grid;grid-template-columns:repeat(4,1fr);gap:0;margin-top:14px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}
.trust>div{padding:16px 18px;border-left:1px solid var(--line)}
.trust>div:first-child{border-left:0}
.trust svg{width:22px;height:22px;color:var(--accent);display:block;margin-bottom:8px}
.trust b{display:block;font-size:14px;letter-spacing:-.005em}
.trust span{display:block;font-size:13px;color:var(--muted);margin-top:2px;line-height:1.45}
.livetag{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--good)}
.livetag i{width:7px;height:7px;border-radius:50%;background:var(--good);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--good) 55%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:reduce){.livetag i{animation:none}}

/* join */
.steps{display:grid;grid-template-columns:1.35fr 1fr;gap:12px}
.step{display:flex;gap:16px;padding:24px}
.step.main{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.sn{width:30px;height:30px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:14px;background:var(--sunken);color:var(--text2)}
.step.main .sn{background:var(--accent);color:#fff}
.sb{flex:1;min-width:0}
.sb h4{margin:3px 0 6px;font-size:18px;letter-spacing:-.015em}
.sb p{margin:0;color:var(--text2)}
.ticks{list-style:none;padding:0;margin:14px 0 18px;display:grid;gap:7px}
.ticks li{position:relative;padding-left:24px;color:var(--text)}
.ticks li::before{content:"";position:absolute;left:2px;top:6px;width:10px;height:5px;border-left:2px solid var(--good);border-bottom:2px solid var(--good);transform:rotate(-45deg)}
.dl{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}
.btn.big{padding:12px 20px;font-size:15px;background:var(--accent);color:#fff}
.other{font-size:13px;color:var(--muted)}
.other a{color:var(--text2);text-decoration:underline;text-decoration-color:var(--line2);text-underline-offset:3px}
.fine{font-size:12.5px!important;color:var(--muted)!important;margin-top:16px!important}
.step .btn.discord{margin-top:16px}
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
  .panel{min-height:0;max-height:72vh}
  .tiles{grid-template-columns:repeat(2,1fr)}
  .steps{grid-template-columns:1fr}
  .trust{grid-template-columns:1fr 1fr}
  .trust>div:nth-child(3){border-left:0}
  .trust>div:nth-child(n+3){border-top:1px solid var(--line)}
  nav .links{display:none}
}
@media (max-width:560px){
  .hide-sm{display:none}
  .banner{flex-wrap:wrap} .banner .btn{margin-left:0;width:100%}
  nav .right .ghost{display:none}
  .tile .v{font-size:25px}
  .trust{grid-template-columns:1fr}
  .trust>div{border-left:0!important;border-top:1px solid var(--line)}
  .trust>div:first-child{border-top:0}
  .step{padding:18px;gap:12px}
}
</style>
</head>
<body>
<nav><div class="wrap">
  <a class="logo" href="#"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="var(--text)"/><path d="M7 13.5a7 7 0 0 1 10 0M9.3 15.8a3.6 3.6 0 0 1 5.4 0" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="18" r="1.3" fill="var(--bg)"/></svg>NBN Watch</a>
  <div class="links"><a href="#map-sec">Live map</a><a href="#numbers">Numbers</a><a href="#log">Outage log</a><a href="#join">Download</a><a href="#join">Community</a></div>
  <div class="right"><button class="btn ghost sm" id="report-top">Report a problem</button><a class="btn sm" href="#join"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14"/></svg>Download app</a></div>
</div></nav>

<main class="wrap">
  <div class="banner" id="banner" role="status">
    <div class="ic" id="banner-ic"></div>
    <div><h1 id="headline">Checking NBN across Australia…</h1><p><span class="livetag"><i></i>Live</span> <span id="headsub">from home modems running NBN Watch and reports from people</span></p></div>
    <button class="btn" id="report-hero">Is your NBN down? Report it</button>
  </div>

  <div class="stage" id="map-sec">
    <div class="mapbox">
      <div id="map" role="region" aria-label="Map of NBN problems"></div><div class="maphint" id="maphint" hidden></div>
      <div class="legend" aria-label="Map layers (click to show or hide)"><button type="button" data-layers="crit,halo"><i class="dot crit"></i>Outage now</button><button type="button" data-layers="ser"><i class="dot ser"></i>Slow / reported by people</button><button type="button" data-layers="past"><i class="dot past"></i>Fixed (last 30 days)</button><button type="button" data-layers="nbnco"><i class="dia"></i>Official report (NBN Co / providers)</button><span class="mut">Bigger = more homes affected</span></div>
    </div>
    <aside class="panel" aria-label="Areas">
      <div class="top"><div class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="q" placeholder="Search your suburb or postcode" aria-label="Search suburb or postcode" autocomplete="off"></div><div id="ptabs-slot"></div></div>
      <div class="body" id="pbody"></div>
    </aside>
  </div>
  <div id="mine-slot"></div>

  <div class="trust">
    <div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 16.5h.01M11 16.5h.01M8 13V9m8 4V6"/></svg>
      <b>Measured, not guessed</b><span>Live dots come straight from home modems the moment they lose NBN. NBN Co’s official outage register is shown alongside.</span></div>
    <div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 9.5 4-1.2 7-5 7-9.5V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>
      <b>Private by design</b><span>Areas are shown to about 1 km. No addresses, names or IP addresses are ever published.</span></div>
    <div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 8-5 4 5 4m8-8 5 4-5 4M14 5l-4 14"/></svg>
      <b>Open source</b><span>The app, this site and how every number is worked out are public on <a id="gh-trust" href="#" target="_blank" rel="noopener">GitHub</a>.</span></div>
    <div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      <b>Independent</b><span>Run by NBN users for NBN users. Not NBN Co, not an ISP, no ads.</span></div>
  </div>

  <section id="numbers">
    <div class="sh"><div><h3 class="st">The numbers</h3><p class="sub">Problems detected or reported across Australia.</p></div></div>
    <div class="tiles" id="tiles"></div>
    <div class="card chart">
      <div class="ch"><div><b>Problems per day</b> <span class="sub" id="chart-note"></span></div>
        <div class="seg" id="range"><button data-d="7">7 days</button><button data-d="30" class="on">30 days</button><button data-d="90">90 days</button></div></div>
      <div style="position:relative"><div class="bars" id="bars"></div><div class="tip" id="tip"></div></div>
      <div class="xaxis" id="xaxis"></div>
    </div>
    <div class="card official" id="official" hidden>
      <div class="oh"><span class="src">Official</span><b>Major outages in official registers · last 90 days</b></div>
      <div class="ostats" id="ostats"></div>
      <div class="fine" style="margin-top:10px"><span id="reg-srcs"></span> These registers (required by ACMA) list larger outages only, usually after they’re fixed. The live dots come from home modems and people — catching the smaller and unplanned outages these lists miss.</div>
    </div>
  </section>

  <section id="log">
    <div class="sh"><div><h3 class="st">Outage log</h3><p class="sub" id="log-sub">Last 7 days: when each problem started and how long it took to come back.</p></div></div>
    <div class="card scroll" id="logcard"><table><thead><tr><th>Area</th><th>What happened</th><th class="hide-sm">Source</th><th class="hide-sm">Started</th><th class="r">Lasted</th><th>Status</th></tr></thead><tbody id="logrows"></tbody></table></div>
  </section>

  <section id="join">
    <div class="sh"><div><h3 class="st">Join NBN Watch</h3><p class="sub">Two steps. Both free.</p></div></div>
    <div class="steps">
      <div class="card step main">
        <div class="sn">1</div>
        <div class="sb">
          <h4>Get the free app</h4>
          <p>It runs quietly on your computer, reads your modem and tells you the moment NBN drops — and when it’s back.</p>
          <ul class="ticks">
            <li>Instant alerts on your phone via Telegram</li>
            <li>Spots when your modem switches to 4G backup</li>
            <li>Puts your area on this map anonymously, so neighbours know it’s not just them</li>
          </ul>
          <div class="dl">
            <a class="btn big" id="dl-main" href="/download/windows">Download for Windows</a>
            <span class="other" id="dl-other"></span>
          </div>
          <p class="fine">Free and open source · Windows 10+, macOS 13+, most Linux · Works with Optus and Telstra modems, more being added by the community.</p>
        </div>
      </div>
      <div class="card step">
        <div class="sn">2</div>
        <div class="sb">
          <h4>Join the community</h4>
          <p>Is it just you? Ask people in your area, share what your ISP said, get help with setup and suggest features. All conversation happens on Discord.</p>
          <a class="btn discord" id="discord-btn" href="#" target="_blank" rel="noopener"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.6 5.2A17 17 0 0 0 15.4 4l-.5 1a15.7 15.7 0 0 0-5.8 0l-.5-1a17 17 0 0 0-4.2 1.2C1.7 9.2 1 13 1.3 16.8A17 17 0 0 0 6.5 19.4l1.1-1.7c-.6-.2-1.2-.5-1.7-.9l.4-.3a12.2 12.2 0 0 0 11.4 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.7a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.2-2.9-11.6ZM8.7 14.5c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Z"/></svg>Join our Discord</a>
          <p class="fine" style="margin-top:14px">Prefer to just report? Use <a href="#" id="report-link">Report a problem</a> — no account needed.</p>
        </div>
      </div>
    </div>
  </section>

  <footer>
    <div>© NBN Watch · free and open source (MIT). Not affiliated with NBN Co, Optus or Telstra.<br>Official outages: NBN Co outage register. Map © OpenStreetMap contributors. Postcode locations: GeoNames (CC BY 4.0).</div>
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
const dur=(x)=>{if(x==null)return '—';if(x<1)return '<1 min';const m=Math.round(x);return m<60?m+' min':m<1440?(Math.floor(m/60)+'h '+(m%60)+'m'):(Math.floor(m/1440)+'d '+Math.floor(m%1440/60)+'h');};
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
let CFG={problems:{},links:{}},ALERTS=[],HIST=[],NBN=[],SEL=null,Q='',LOGN=12;

// ---------------- data model: areas ----------------
function areas(){
  // Active alerts and the last 30 days of incidents, merged per suburb.
  const m=new Map();
  const get_=(a)=>{const k=keyOf(a);if(!m.has(k))m.set(k,{key:k,suburb:a.suburb,state:a.state,postcode:a.postcode,lat:a.lat,lng:a.lng,alert:null,hist:[]});const o=m.get(k);if(o.lat==null&&a.lat!=null){o.lat=a.lat;o.lng=a.lng;}return o;};
  ALERTS.forEach(a=>{get_(a).alert=a;});
  HIST.forEach(i=>{get_(i).hist.push(i);});
  return [...m.values()];
}
// Red when a modem itself saw NBN drop; orange for slow service or people-only reports.
const nbnMatch=(o)=>!Q||o.suburbs.some(x=>x.toLowerCase().includes(Q))||o.postcodes.some(x=>x.startsWith(Q))||o.states.some(x=>x.toLowerCase()===Q)||o.title.toLowerCase().includes(Q);
const nbnName=(o)=>o.suburbs.length?(o.suburbs.slice(0,2).join(', ')+(o.suburbs.length>2?' +'+(o.suburbs.length-2)+' more':'')):o.title;
const hrs=(h)=>h==null?'—':dur(h*60);
const CAUSE={'Damage by a third party':'Cable damage by a third party','Power interruption':'Power outage','Equipment or system fault or failure':'Equipment fault'};
const cause=(o)=>CAUSE[o.cause]||o.cause||'Not stated';
const isSevere=(a)=>!!(a.kinds.nbn_outage||a.kinds.mobile_backup);
const match=(a)=>!Q||(a.suburb||'').toLowerCase().includes(Q)||(a.postcode||'').startsWith(Q)||(a.state||'').toLowerCase()===Q;
function summary(list){
  const done=list.filter(i=>i.status!=='ongoing'&&i.status!=='expired');
  const mean=done.length?done.reduce((n,i)=>n+i.duration_min,0)/done.length:null;
  return {count:list.length,mean,longest:list.length?Math.max(...list.map(i=>i.duration_min)):null};
}

// ---------------- side panel ----------------
// Panel views: all | now | official | fixed
let VIEW='all',FIXN=6;
function tabs(counts){
  const bar=el('div','ptabs');
  [['all','All'],['now','Now'],['official','Official'],['fixed','Fixed']].forEach(([k,l])=>{
    const b=el('button',VIEW===k?'on':null);b.type='button';b.append(document.createTextNode(l));
    if(k!=='all'){const n=el('span','n',String(counts[k]));b.append(n);}
    b.onclick=()=>{VIEW=k;FIXN=k==='fixed'?40:6;renderPanel();$('#pbody').scrollTop=0;};bar.append(b);});
  return bar;
}
function renderPanel(){
  const body=$('#pbody');
  if(SEL){$('#ptabs-slot').replaceChildren();body.replaceChildren(SEL.startsWith('nbnco:')?nbnDetail(SEL.slice(6)):detail(SEL));body.scrollTop=0;return;}
  const all=areas().filter(match);
  const active=all.filter(a=>a.alert).sort((a,b)=>b.alert.devices-a.alert.devices||a.alert.since.localeCompare(b.alert.since));
  const pastAll=all.filter(a=>!a.alert&&a.hist.length).sort((a,b)=>b.hist[0].started_at.localeCompare(a.hist[0].started_at));
  const offAll=NBN.filter(nbnMatch);
  $('#ptabs-slot').replaceChildren(tabs({now:active.length,official:offAll.length,fixed:pastAll.length}));
  const show=(k)=>VIEW==='all'||VIEW===k;
  const out=[];
  const head=(label,n,more)=>{const t=el('div','ptitle');t.append(el('span',null,label),el('span','num',String(n)));if(out.length)t.style.marginTop='8px';out.push(t);};
  const moreBtn=(n,go)=>{const m=el('div','pmore');const b=el('button','link','Show all '+n);b.type='button';b.onclick=go;m.append(b);out.push(m);};
  if(show('now')){
    head('Problems now',active.length);
    if(!active.length) out.push(Q?emptyBox('Nothing open in “'+Q+'”','No current problems match your search.'):emptyBox('No problems right now','When a modem drops off NBN or someone reports a problem, it shows up here within a minute.'));
    active.forEach(a=>{const r=el('div','row');const al=a.alert;
      const b=el('div');b.append(el('div','t',name(a)),el('div','m',kindText(al.kinds)+' · '+al.devices+(al.devices>1?' homes':' home')+(place(a)?' · '+place(a):'')));
      const d=el('div','d num',dur(minsSince(al.since)));d.append(el('small',null,'so far'));
      r.append(el('i','dot '+(isSevere(al)?'crit':'ser')),b,d);r.onclick=()=>select(a.key,true);out.push(r);});
  }
  if(show('official')){
    head('Official reports · NBN Co & providers · 90 days',offAll.length);
    if(!offAll.length) out.push(emptyBox('',Q?'No official reports for this search in the last 90 days.':'No official reports in the last 90 days.'));
    const lim=VIEW==='official'?offAll.length:5;
    offAll.slice(0,lim).forEach(o=>{const r=el('div','row');const b=el('div');
      b.append(el('div','t',nbnName(o)),el('div','m',srcShort(o)+(isMobile(o)?' mobile':'')+' · '+(o.premises?o.premises.toLocaleString()+' premises · ':'')+cause(o)+' · '+day(o.start_at)));
      const d=el('div','d num',hrs(o.duration_h));d.append(el('small',null,'to fix'));
      const ic=el('i','dia');ic.style.marginTop='6px';r.append(ic,b,d);r.onclick=()=>selectNbn(o.ref,true);out.push(r);});
    if(offAll.length>lim)moreBtn(offAll.length,()=>{VIEW='official';renderPanel();$('#pbody').scrollTop=0;});
  }
  if(show('fixed')){
    head('Fixed in the last 30 days',pastAll.length);
    if(!pastAll.length) out.push(emptyBox('',Q?'No problems recorded in the last 30 days for this search. Good news for '+Q+'.':'Nothing fixed in the last 30 days.'));
    const lim=VIEW==='fixed'?pastAll.length:FIXN;
    pastAll.slice(0,lim).forEach(a=>{const r=el('div','row');const last=a.hist[0];const s=summary(a.hist);
      const b=el('div');b.append(el('div','t',name(a)),el('div','m',s.count+(s.count>1?' problems':' problem')+' · last '+day(last.started_at)));
      const d=el('div','d num',dur(last.duration_min));d.append(el('small',null,'last one'));
      r.append(el('i','dot past'),b,d);r.onclick=()=>select(a.key,true);out.push(r);});
    if(pastAll.length>lim)moreBtn(pastAll.length,()=>{VIEW='fixed';renderPanel();$('#pbody').scrollTop=0;});
  }
  body.replaceChildren(...out);
  updateHint();
}
function emptyBox(t,s){const e=el('div','empty');if(t)e.append(el('b',null,t));e.append(document.createTextNode(s));return e;}
function kindText(k){return Object.entries(k).map(([x,n])=>(KIND[x]||x)+(n>1?' ×'+n:'')).join(' · ');}

function detail(key){
  const a=areas().find(x=>x.key===key);const box=el('div','detail');
  const back=el('button','back','← All areas');back.onclick=()=>{SEL=null;renderPanel();$('#pbody').scrollTop=0;};box.append(back);
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
  const official=a.postcode?NBN.filter(o=>o.postcodes.includes(a.postcode)):[];
  if(official.length){const t=el('div','ptitle');t.style.padding='16px 0 4px';t.append(el('span',null,'Official reports here'),el('span','num',String(official.length)));box.append(t);
    const h=el('div','hist');official.forEach(o=>{const r=el('div','h');r.style.cursor='pointer';const l=el('div');l.append(el('div',null,day(o.start_at)),el('div','sub',cause(o)+(o.premises?' · '+o.premises.toLocaleString()+' premises':'')));
      const rr=el('div','num',hrs(o.duration_h));r.append(l,rr);r.onclick=()=>selectNbn(o.ref,false);h.append(r);});box.append(h);}
  const act=el('div','actions');
  const rep=el('button','btn sm','Report a problem here');rep.onclick=openReport;act.append(rep);
  if(CFG.links.discord){const d=el('a','btn discord sm','Discuss on Discord');d.href=CFG.links.discord;d.target='_blank';d.rel='noopener';act.append(d);}
  box.append(act);
  return box;
}
function nbnDetail(ref){
  const o=NBN.find(x=>x.ref===ref);const box=el('div','detail');
  const back=el('button','back','← All areas');back.onclick=()=>{SEL=null;renderPanel();$('#pbody').scrollTop=0;};box.append(back);
  if(!o){box.append(emptyBox('','This report is no longer listed.'));return box;}
  const tag=el('div');tag.style.marginTop='12px';tag.append(el('span','src',srcShort(o)+' official report'));box.append(tag);
  box.append(el('h2',null,nbnName(o)),el('div','loc',o.states.join(', ')+(o.postcodes.length?' · '+o.postcodes.length+(o.postcodes.length>1?' postcodes':' postcode'):'')));
  const big=el('div','bigdur num',hrs(o.duration_h));box.append(big,el('div','sub','until fixed'));
  const f=el('div','facts');
  const pp=perPoint(o);
  [['Started',when(o.start_at)],['Fixed',o.end_at?when(o.end_at):'not stated'],['Premises',o.premises!=null?o.premises.toLocaleString()+(pp&&o.points.length>1?' (~'+pp.toLocaleString()+' per postcode)':''):'—'],['Cause',cause(o)+(o.natural==='Yes'?' (weather / natural event)':'')],
   ['Services',o.techs||'—'],['Reported by',srcOf(o).name],['Published',o.published||'—']].forEach(([k,v])=>f.append(el('div',null,k),el('div',null,v)));
  box.append(f);
  if(o.suburbs.length){const t=el('div','ptitle');t.style.padding='14px 0 4px';t.append(el('span',null,'Suburbs and towns'),el('span','num',String(o.suburbs.length)));
    const sb=el('div','sub',o.suburbs.slice(0,60).join(', ')+(o.suburbs.length>60?' and '+(o.suburbs.length-60)+' more':''));box.append(t,sb);}
  if(!o.points.length&&o.postcodes.length)box.append(el('div','sub','Too widespread to show as dots on the map.'));
  const act=el('div','actions');const a=el('a','btn ghost sm','View the '+srcShort(o)+' register ↗');a.href=srcOf(o).url;a.target='_blank';a.rel='noopener';act.append(a);box.append(act);
  box.append(el('div','fine','Source: '+srcOf(o).name+' outage register. Providers must list major and significant local outages (ACMA rules), usually after they are fixed.'+(isMobile(o)?' This one affected the mobile network — which is what 4G modem backup relies on.':'')));
  return box;
}
function selectNbn(ref,fly){
  SEL='nbnco:'+ref;renderPanel();const o=NBN.find(x=>x.ref===ref);
  if(fly&&map&&o&&o.points.length){if(o.points.length===1)map.flyTo({center:o.points[0],zoom:Math.max(map.getZoom(),10)});else{const b=new maplibregl.LngLatBounds();o.points.forEach(p=>b.extend(p));map.fitBounds(b,{padding:60,maxZoom:11});}}
  if(innerWidth<980)$('.panel').scrollIntoView({behavior:'smooth',block:'start'});
}
let SOURCES={nbnco:{name:'NBN Co',url:'https://www.nbnco.com.au/outages-register'}};
const srcOf=(o)=>SOURCES[o.source]||{name:o.source||'Official',url:'#'};
const srcShort=(o)=>({nbnco:'NBN Co',tpg:'TPG Telecom',abb:'Aussie Broadband'}[o.source]||srcOf(o).name);
// Estimated premises around each dot of an official outage (its total spread over its postcodes).
const perPoint=(o)=>o.premises&&o.points.length?Math.round(o.premises/o.points.length):null;
const isMobile=(o)=>/mobile/i.test(o.techs)&&!/broadband|nbn|fixed|fttp|fttn|fttc|hfc|wireless internet/i.test(o.techs);
function select(key,fly){
  SEL=key;renderPanel();
  const a=areas().find(x=>x.key===key);
  if(fly&&map&&a&&a.lat!=null)map.flyTo({center:[a.lng,a.lat],zoom:Math.max(map.getZoom(),11),speed:1.4});
  if(innerWidth<980)$('.panel').scrollIntoView({behavior:'smooth',block:'start'});
}
setInterval(()=>{document.querySelectorAll('.bigdur').forEach(e=>e.textContent=dur(minsSince(e.dataset.since)));},30000);

// ---------------- map ----------------
// One size rule for every dot: area grows with how many homes are affected
// (square-root scale, so 4x the homes looks 2x as wide), capped so one huge
// outage can't hide its neighbours.
//  live  – homes reporting the problem now (app devices + people)
//  past  – how many problems the area had in the last 30 days
//  official – premises in the register entry, spread across its postcodes
const SIZE={
  live:['interpolate',['linear'],['get','devices'],1,8,2,10.5,4,13.5,9,18,25,26],
  past:['interpolate',['linear'],['get','count'],1,4.5,3,6.5,6,8.5,15,12],
  official:['interpolate',['linear'],['get','est'],0,1.25,300,1.25,1000,1.55,3000,1.95,10000,2.5,30000,3.2],
};
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
    const ring=dark?'#181817':'#ffffff';
    map.addSource('areas',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    // NBN Co register: blue diamonds (source identity, not severity)
    const sz=22,cv=document.createElement('canvas');cv.width=cv.height=sz;const cx=cv.getContext('2d');
    cx.translate(sz/2,sz/2);cx.rotate(Math.PI/4);cx.fillStyle=dark?'#7aa2f7':'#3b6fd8';cx.strokeStyle=ring;cx.lineWidth=2.5;
    cx.beginPath();cx.roundRect(-6.5,-6.5,13,13,2);cx.fill();cx.stroke();
    map.addImage('nbnco-dia',cx.getImageData(0,0,sz,sz),{pixelRatio:1.5});
    map.addSource('nbnco',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'nbnco',type:'symbol',source:'nbnco',layout:{'icon-image':'nbnco-dia','icon-allow-overlap':true,'symbol-sort-key':['-',0,['get','est']],
      'icon-size':['interpolate',['linear'],['zoom'],4,['*',.9,SIZE.official],11,['*',1.1,SIZE.official]]}});
    map.on('click','nbnco',(e)=>selectNbn(e.features[0].properties.ref,false));
    map.on('mouseenter','nbnco',(e)=>{map.getCanvas().style.cursor='pointer';const p=e.features[0].properties;const b=el('div');b.append(el('b',null,p.name),el('div',null,p.label));hover.setLngLat(e.features[0].geometry.coordinates).setDOMContent(b).addTo(map);});
    map.on('mouseleave','nbnco',()=>{map.getCanvas().style.cursor='';hover.remove();});
    map.addLayer({id:'past',type:'circle',source:'areas',filter:['==',['get','kind'],'past'],
      // Fixed areas: bigger where problems keep coming back (count in the last 30 days).
      paint:{'circle-color':dark?'#6b6b65':'#a3a29a','circle-radius':['interpolate',['linear'],['zoom'],4,['*',.6,SIZE.past],11,SIZE.past],'circle-stroke-color':ring,'circle-stroke-width':1.5}});
    map.addLayer({id:'halo',type:'circle',source:'areas',filter:['==',['get','kind'],'crit'],
      paint:{'circle-color':'#d03b3b','circle-opacity':.16,'circle-radius':['interpolate',['linear'],['zoom'],4,['+',['*',.7,SIZE.live],6],11,['+',SIZE.live,10]]}});
    map.addLayer({id:'ser',type:'circle',source:'areas',filter:['==',['get','kind'],'ser'],
      paint:{'circle-color':ring,'circle-radius':['interpolate',['linear'],['zoom'],4,['*',.7,SIZE.live],11,SIZE.live],'circle-stroke-color':'#ec835a','circle-stroke-width':3.5}});
    map.addLayer({id:'crit',type:'circle',source:'areas',filter:['==',['get','kind'],'crit'],
      paint:{'circle-color':'#d03b3b','circle-radius':['interpolate',['linear'],['zoom'],4,['*',.7,SIZE.live],11,SIZE.live],'circle-stroke-color':ring,'circle-stroke-width':2,
        'circle-opacity':['case',['get','reporting'],1,.5]}});
    for(const id of ['past','ser','crit']){
      map.on('click',id,(e)=>select(e.features[0].properties.key,false));
      map.on('mouseenter',id,(e)=>{map.getCanvas().style.cursor='pointer';const p=e.features[0].properties;const b=el('div');b.append(el('b',null,p.name),el('div',null,p.label));hover.setLngLat(e.features[0].geometry.coordinates).setDOMContent(b).addTo(map);});
      map.on('mouseleave',id,()=>{map.getCanvas().style.cursor='';hover.remove();});
    }
    drawMap();
    map.on('moveend',updateHint);updateHint();
  });
}
function updateHint(){
  const h=$('#maphint');if(!map||!map.getLayer('nbnco')||!NBN.length){h.hidden=true;return;}
  const pts=NBN.flatMap(o=>o.points);if(!pts.length){h.hidden=true;return;}
  const b=map.getBounds();const inView=pts.filter(p=>b.contains(p)).length;
  if(inView||map.getLayoutProperty('nbnco','visibility')==='none'){h.hidden=true;return;}
  const btn=el('button',null,'Show all');btn.onclick=()=>{const bb=new maplibregl.LngLatBounds();pts.forEach(p=>bb.extend(p));map.fitBounds(bb,{padding:50,maxZoom:6});};
  h.replaceChildren(document.createTextNode('No official reports in this view · '+NBN.length+' across Australia'),btn);h.hidden=false;
}
document.querySelectorAll('.legend button').forEach(b=>b.onclick=()=>{if(!map)return;const off=!b.classList.toggle('off');
  b.dataset.layers.split(',').forEach(id=>{if(map.getLayer(id))map.setLayoutProperty(id,'visibility',b.classList.contains('off')?'none':'visible');});updateHint();});
let fitted=false;
function drawMap(){
  if(!map||!map.getSource('areas'))return;
  const feats=areas().filter(a=>a.lat!=null).map(a=>{const al=a.alert;
    const kind=al?(isSevere(al)?'crit':'ser'):'past';
    const label=al?(kindText(al.kinds)+' · '+dur(minsSince(al.since))+' so far'):(a.hist.length+(a.hist.length>1?' problems':' problem')+' in 30 days, now fixed');
    return {type:'Feature',geometry:{type:'Point',coordinates:[a.lng,a.lat]},properties:{key:a.key,name:name(a),kind,label,devices:al?al.devices:1,count:a.hist.length||1,reporting:al?al.reporting:true}};});
  map.getSource('areas').setData({type:'FeatureCollection',features:feats});
  if(map.getSource('nbnco'))map.getSource('nbnco').setData({type:'FeatureCollection',features:NBN.flatMap(o=>o.points.map(pt=>({type:'Feature',geometry:{type:'Point',coordinates:pt},
    properties:{ref:o.ref,name:nbnName(o),est:perPoint(o)||300,label:srcShort(o)+' · '+day(o.start_at)+' · '+hrs(o.duration_h)+' · '+(perPoint(o)?'~'+perPoint(o).toLocaleString()+' premises here':cause(o))}})))});
  updateHint();
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
  $('#headsub').textContent='· '+(n?(n+(n>1?' areas':' area')+', '+homes+(homes>1?' homes':' home')+' affected across Australia'):'nothing open across Australia')+(NBN.length?' · '+NBN.length+' official reports in 90 days':'')+' · updated '+new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
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
function renderOfficial(){
  if(!NBN.length)return;
  const sumP=NBN.reduce((n,o)=>n+(o.premises||0),0);
  const ds=NBN.map(o=>o.duration_h).filter(x=>x!=null).sort((a,b)=>a-b);
  const med=ds.length?ds[Math.floor(ds.length/2)]:null;
  const top=Object.entries(NBN.reduce((m,o)=>{const c=cause(o);m[c]=(m[c]||0)+1;return m;},{})).sort((a,b)=>b[1]-a[1])[0];
  $('#ostats').replaceChildren(...[[String(NBN.length),'major outages'],[sumP.toLocaleString(),'premises affected'],[hrs(med),'typical time to fix'],[top?top[0]:'—',top?top[1]+' of '+NBN.length+' outages':'most common cause']]
    .map(([v,k])=>{const d=el('div');d.append(el('b','num',v),el('span',null,k));return d;}));
  const by={};NBN.forEach(o=>by[o.source]=(by[o.source]||0)+1);
  const sp=$('#reg-srcs');sp.replaceChildren(document.createTextNode('From the outage registers of '));
  const ids=Object.keys(SOURCES);ids.forEach((id,i)=>{const a=el('a',null,srcShort({source:id}));a.href=SOURCES[id].url;a.target='_blank';a.rel='noopener';sp.append(a,document.createTextNode(' ('+(by[id]?by[id]:'none')+')'+(i<ids.length-2?', ':i===ids.length-2?' and ':'.')));});
  $('#official').hidden=false;
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
  const ours=HIST.filter(i=>new Date(i.started_at).getTime()>=week||i.status==='ongoing').filter(match).map(i=>({t:i.started_at,i}));
  const off=NBN.filter(o=>new Date(o.start_at).getTime()>=week).filter(nbnMatch).map(o=>({t:o.start_at,o}));
  const all=ours.concat(off).sort((x,y)=>y.t.localeCompare(x.t));
  const rows=all.slice(0,LOGN);
  const more=$('#logmore');if(more)more.remove();
  if(all.length>LOGN){const m=el('div','more');m.id='logmore';const b=el('button','btn ghost sm','Show more ('+(all.length-LOGN)+')');b.onclick=()=>{LOGN+=20;renderLog();};m.append(b);$('#logcard').after(m);}
  $('#log-sub').textContent=Q?('Last 7 days matching “'+Q+'”.'):'Last 7 days: when each problem started and how long it took to come back.';
  if(!rows.length){const tr=el('tr');const td=el('td','empty',Q?'Nothing in the last 7 days for this search.':'No problems in the last 7 days.');td.colSpan=6;tr.append(td);$('#logrows').replaceChildren(tr);return;}
  $('#logrows').replaceChildren(...rows.map(x=>{if(x.o)return nbnRow(x.o);const i=x.i;const tr=el('tr');
    const st=i.status==='ongoing'?el('span','pill crit','Ongoing'):el('span','pill '+(i.status==='recovered'||i.status==='nbn_restored'?'good':'plain'),STATUS[i.status]||i.status);
    const a=el('td');a.append(el('b',null,name(i)),document.createTextNode(place(i)?'  '+place(i):''));
    const s=el('td');s.append(st);
    const srcTd=el('td','hide-sm',i.kind==='user_report'?'People':'Home modems');srcTd.style.color='var(--muted)';
    tr.append(a,el('td',null,KIND[i.kind]||i.kind),srcTd,el('td','hide-sm',when(i.started_at)),el('td','r',i.status==='ongoing'?dur(minsSince(i.started_at))+' so far':dur(i.duration_min)),s);
    tr.onclick=()=>{select(keyOf(i),true);$('#map-sec').scrollIntoView({behavior:'smooth'});};return tr;}));
}

function nbnRow(o){
  const tr=el('tr');const a=el('td');a.append(el('b',null,nbnName(o)),document.createTextNode(o.states.length?'  '+o.states.join('/'):''));
  const src=el('td','hide-sm');src.append(el('span','src',srcShort(o)));
  const st=el('td');st.append(el('span','pill good','Fixed'));
  tr.append(a,el('td',null,(isMobile(o)?'Mobile outage · ':'Major outage · ')+cause(o)),src,el('td','hide-sm',when(o.start_at)),el('td','r',hrs(o.duration_h)),st);
  tr.onclick=()=>{selectNbn(o.ref,true);$('#map-sec').scrollIntoView({behavior:'smooth'});};return tr;
}

// ---------------- loading ----------------
async function loadLive(){
  const [a,h,n]=await Promise.all([get('/api/alerts').catch(()=>({alerts:[]})),get('/api/incidents?days=30').catch(()=>({incidents:[]})),get('/api/official?days=90').catch(()=>({outages:[]}))]);
  ALERTS=a.alerts||[];HIST=h.incidents||[];NBN=n.outages||[];if(n.sources)n.sources.forEach(x=>SOURCES[x.id]=x);
  renderBanner();renderPanel();drawMap();renderLog();renderOfficial();
}
let qt=null;
$('#q').oninput=()=>{clearTimeout(qt);qt=setTimeout(()=>{Q=$('#q').value.trim().toLowerCase();SEL=null;LOGN=12;VIEW='all';renderPanel();renderLog();},150);};
$('#q').onkeydown=(e)=>{if(e.key==='Enter'){const a=areas().filter(match).sort((x,y)=>(y.alert?1:0)-(x.alert?1:0))[0];if(a)select(a.key,true);}};

function renderLinks(){
  const L=CFG.links||{};
  const dc=$('#discord-btn');
  if(L.discord){dc.href=L.discord;}
  else{dc.lastChild.textContent='Discord opening soon';dc.removeAttribute('href');dc.style.opacity='.6';dc.style.cursor='default';}
  if(L.github){$('#gh').href=L.github;$('#gh-trust').href=L.github;}
  if(L.nbn_status)$('#nbnco').href=L.nbn_status;
  // Offer the visitor's own platform first.
  const ua=navigator.userAgent;const OS=[['windows','Windows'],['macos','Mac'],['linux','Linux']];
  const mine=/Mac/.test(ua)&&!/iPhone|iPad/.test(ua)?'macos':/Linux|X11/.test(ua)&&!/Android/.test(ua)?'linux':/Win/.test(ua)?'windows':null;
  const main=$('#dl-main'),other=$('#dl-other');
  if(mine){main.href='/download/'+mine;main.textContent='Download for '+OS.find(o=>o[0]===mine)[1];}
  else{main.href=(L.github||'')+'/releases/latest';main.textContent='See downloads';}
  other.replaceChildren(document.createTextNode(mine?'Also for ':'For '));
  OS.filter(o=>o[0]!==mine).forEach(([k,n],i,arr)=>{const a=el('a',null,n);a.href='/download/'+k;other.append(a);if(i<arr.length-1)other.append(document.createTextNode(i===arr.length-2?' and ':', '));});
  if(/iPhone|iPad|Android/.test(ua))other.append(document.createTextNode(' — it runs on a computer at home.'));
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
$('#report-top').onclick=openReport;$('#report-hero').onclick=openReport;$('#report-link').onclick=(e)=>{e.preventDefault();openReport();};

(async()=>{CFG=await get('/api/config').catch(()=>CFG);renderLinks();setupMap();await loadLive();loadNumbers();loadChart(30);showMine();
  setInterval(async()=>{await loadLive();loadNumbers();},60000);})();
</script>
</body>
</html>`;
