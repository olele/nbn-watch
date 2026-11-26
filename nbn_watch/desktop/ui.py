"""Single-page local UI (setup wizard, status, settings). Rendered with textContent only."""

from __future__ import annotations

UI_CSS = r"""
*{box-sizing:border-box}
html,body{margin:0;background:var(--background);color:var(--foreground);
  font:14px/1.55 "JetBrainsMono Nerd Font","JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace}
a{color:var(--accent)}
.wrap{max-width:720px;margin:0 auto;padding:28px 16px 64px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}
.brand{display:flex;align-items:center;gap:10px;color:var(--bright-foreground);font-weight:700;font-size:16px}
.brand .dot{width:12px;height:12px;border-radius:50%;background:var(--dark-foreground);box-shadow:0 0 0 3px var(--selection)}
.ver{color:var(--dark-foreground);font-size:12px}
.brand .sub{color:var(--dark-foreground);font-weight:400;margin-left:2px}
.brand .sub::before{content:"/";margin-right:8px;color:var(--muted)}
.strip{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--muted);background:var(--dark-background);margin-bottom:12px}
.sdot{width:10px;height:10px;border-radius:50%;flex:none}
button.small{padding:5px 10px;font-size:12px}
.steps{display:flex;gap:6px;margin:0 0 18px;flex-wrap:wrap}
.step{flex:1;min-width:110px;padding:8px 10px;border:1px solid var(--muted);color:var(--dark-foreground);font-size:12px}
.step b{display:block;color:inherit;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.step.on{border-color:var(--accent);color:var(--bright-foreground);background:var(--selection)}
.step.done{border-color:var(--green);color:var(--green)}
.card{background:var(--dark-background);border:1px solid var(--muted);padding:18px;margin-bottom:14px}
.card h2{margin:0 0 4px;font-size:15px;color:var(--bright-foreground)}
.card p.lead{margin:0 0 14px;color:var(--dark-foreground)}
label.f{display:block;margin:12px 0 5px;color:var(--bright-foreground);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
input[type=text],input[type=password],input[type=search]{width:100%;padding:10px 12px;background:var(--background);
  color:var(--bright-foreground);border:1px solid var(--muted);font:inherit;outline:none}
input:focus{border-color:var(--accent)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px}
.grow{flex:1}
button{font:inherit;padding:9px 16px;border:1px solid var(--accent);background:var(--accent);color:var(--dark-background);
  cursor:pointer;font-weight:700}
button.ghost{background:transparent;color:var(--accent)}
button.link{border:0;background:transparent;color:var(--dark-foreground);padding:9px 4px;font-weight:400;text-decoration:underline}
button:disabled{opacity:.45;cursor:default}
.list{display:grid;gap:6px;margin-top:12px}
.opt{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--muted);cursor:pointer;background:var(--background)}
.opt:hover{border-color:var(--dark-foreground)}
.opt.sel{border-color:var(--accent);background:var(--selection)}
.opt .t{color:var(--bright-foreground)}
.opt .s{color:var(--dark-foreground);font-size:12px}
.badge{font-size:11px;padding:1px 7px;border:1px solid currentColor;margin-left:6px;white-space:nowrap}
.ok{color:var(--green)}.bad{color:var(--red)}.warn{color:var(--yellow)}.mut{color:var(--dark-foreground)}
.note{padding:10px 12px;border-left:3px solid var(--accent);background:var(--background);margin-top:12px}
.note.ok{border-color:var(--green)}.note.bad{border-color:var(--red)}.note.warn{border-color:var(--yellow)}
.code{font-size:28px;letter-spacing:.18em;color:var(--bright-foreground);padding:14px;text-align:center;
  border:1px dashed var(--accent);margin:12px 0;background:var(--background)}
.toggle{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--selection)}
.toggle:last-child{border-bottom:0}
.toggle input{margin-top:3px;accent-color:var(--accent);width:16px;height:16px}
.toggle .t{color:var(--bright-foreground)}.toggle .s{color:var(--dark-foreground);font-size:12px}
.status{display:flex;align-items:center;gap:14px}
.big{width:18px;height:18px;border-radius:50%;flex:none;box-shadow:0 0 0 4px var(--selection)}
.headline{font-size:20px;color:var(--bright-foreground);font-weight:700}
.kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin-top:14px}
.kv div:nth-child(odd){color:var(--dark-foreground)}
.tabs{display:flex;gap:0;border-bottom:1px solid var(--muted);margin-bottom:14px;flex-wrap:wrap}
.tab{padding:8px 14px;border:0;background:transparent;color:var(--dark-foreground);font-weight:400;border-bottom:2px solid transparent}
.tab.on{color:var(--bright-foreground);border-bottom-color:var(--accent)}
.spin{display:inline-block;width:12px;height:12px;border:2px solid var(--muted);border-top-color:var(--accent);
  border-radius:50%;animation:s 1s linear infinite;vertical-align:-2px;margin-right:8px}
@keyframes s{to{transform:rotate(360deg)}}
.hidden{display:none}
.ac{position:relative}
.ac-menu{position:absolute;left:0;right:0;top:100%;z-index:10;background:var(--dark-background);border:1px solid var(--accent);
  border-top:0;max-height:300px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.ac-opt{padding:9px 12px;cursor:pointer;border-top:1px solid var(--selection)}
.ac-opt:first-child{border-top:0}
.ac-opt.on,.ac-opt:hover{background:var(--selection)}
.ac-opt .t{color:var(--bright-foreground)}
.ac-msg{padding:10px 12px;color:var(--dark-foreground)}
.ac-picked{margin-top:8px;min-height:20px;font-size:13px}
.help{border-color:var(--accent)}
.card h3{margin:18px 0 6px;font-size:13px;color:var(--bright-foreground);text-transform:uppercase;letter-spacing:.06em}
.pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
@media (max-width:640px){.pillars{grid-template-columns:1fr}}
.pillar{border:1px solid var(--muted);background:var(--background);padding:10px 12px}
.pillar .pt{color:var(--accent);font-weight:700;margin-bottom:4px}
.pillar .pd{color:var(--foreground);font-size:12.5px;margin:0}
.pillar ul.pd{padding-left:16px}
.pillar ul.pd li{margin-bottom:3px}
.alt{background:transparent}
.crowd{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.crowd:empty{display:none}
.fact{flex:1;min-width:140px;border:1px solid var(--muted);padding:8px 12px;background:var(--background)}
.fact b{display:block;font-size:20px;color:var(--bright-foreground)}
.fact span{color:var(--dark-foreground);font-size:12px}
.crowd-note{flex-basis:100%;font-size:12px}
"""

UI_JS = r"""
const TOKEN = document.querySelector('meta[name=nbn-token]').content;
const $ = (s) => document.querySelector(s);
function el(tag, cls, text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
async function api(path, body){
  const opt = {headers:{'X-NBN-Token':TOKEN}};
  if(body!==undefined){opt.method='POST';opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body);}
  const r = await fetch(path, opt); const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||('HTTP '+r.status)); return data;
}
let S = null; // state from /api/state
const STEPS = [['address','Address'],['router','Router'],['alerts','Alerts'],['prefs','Finish']];

function shell(title){
  const main = $('#main'); main.replaceChildren(); return main;
}
function card(h, lead){const c=el('div','card');c.append(el('h2',null,h));if(lead)c.append(el('p','lead',lead));return c;}
function btn(text, cls, fn){const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;}
function note(text, cls){return el('div','note '+(cls||''),text);}
function stepper(active){
  const box = el('div','steps');
  STEPS.forEach(([key,name],i)=>{const idx=STEPS.findIndex(s=>s[0]===active);
    const s=el('div','step'+(i===idx?' on':i<idx?' done':''));s.append(el('b',null,'Step '+(i+1)),document.createTextNode(name));box.append(s);});
  return box;
}

// ---------------------------------------------------------------- address
function viewAddress(mode, next){
  const c = card('Where is your NBN connection?','Start typing your street address and pick it from the list. It stays on this computer; only your NBN area is ever shared.');
  let chosen = S.settings.loc_id ? {loc_id:S.settings.loc_id,address:S.settings.address} : null;
  const box = el('div','ac');
  const q = el('input'); q.type='text'; q.autocomplete='off'; q.spellcheck=false;
  q.placeholder='Start typing, e.g. 12 Smith St Suburb'; q.value = chosen ? chosen.address : '';
  q.setAttribute('role','combobox'); q.setAttribute('aria-autocomplete','list');
  const menu = el('div','ac-menu hidden'); menu.setAttribute('role','listbox');
  const picked = el('div','ac-picked'); box.append(q, menu);
  const label = el('input'); label.type='text'; label.value=S.settings.label||'Home'; label.maxLength=30;
  const go = btn(mode==='wizard'?'Next →':'Save', null, async()=>{
    if(!chosen) return; go.disabled=true;
    await api('/api/address',{loc_id:chosen.loc_id,address:chosen.address,label:label.value});
    await refresh(); next();
  });
  function showPicked(){
    picked.replaceChildren();
    if(chosen){picked.append(el('span','ok','✓ '),el('span',null,chosen.address),el('span','mut','  '+chosen.loc_id));}
    go.disabled = !chosen;
  }
  let items = [], active = -1, timer = null, seq = 0;
  function close(){menu.classList.add('hidden');active=-1;}
  function choose(r){chosen=r;q.value=r.address;close();showPicked();}
  function highlight(i){active=i;[...menu.children].forEach((o,j)=>o.classList.toggle('on',j===i));}
  function render(list, msg){
    menu.replaceChildren(); items=list; active=-1;
    if(msg){menu.append(el('div','ac-msg',msg));}
    list.forEach((r,i)=>{const o=el('div','ac-opt');o.setAttribute('role','option');
      o.append(el('div','t',r.address));
      o.onmousedown=(e)=>{e.preventDefault();choose(r);};
      o.onmouseenter=()=>highlight(i);menu.append(o);});
    menu.classList.toggle('hidden', !msg && !list.length);
  }
  async function search(){
    const text=q.value.trim(); const mine=++seq;
    if(text.length<4){close();return;}
    render([], '');menu.firstChild&&menu.firstChild.remove();
    const wait=el('div','ac-msg');wait.append(el('span','spin'),document.createTextNode('Finding addresses…'));menu.replaceChildren(wait);menu.classList.remove('hidden');
    const data = await api('/api/search?q='+encodeURIComponent(text)).catch(()=>({results:[]}));
    if(mine!==seq) return; // a newer keystroke already searched
    render(data.results, data.results.length?'':'No NBN address matches yet — keep typing (number, street, suburb).');
  }
  q.oninput=()=>{ if(chosen && q.value!==chosen.address){chosen=null;showPicked();}
    clearTimeout(timer); timer=setTimeout(search,300); };
  q.onkeydown=(e)=>{
    if(menu.classList.contains('hidden')||!items.length){ if(e.key==='Enter'){e.preventDefault();search();} return; }
    if(e.key==='ArrowDown'){e.preventDefault();highlight(Math.min(items.length-1,active+1));}
    else if(e.key==='ArrowUp'){e.preventDefault();highlight(Math.max(0,active-1));}
    else if(e.key==='Enter'){e.preventDefault();choose(items[Math.max(0,active)]);}
    else if(e.key==='Escape'){close();}
  };
  q.onblur=()=>setTimeout(close,150);
  q.onfocus=()=>{if(items.length&&!chosen)menu.classList.remove('hidden');};
  showPicked();
  c.append(el('label','f','Address'),box,picked,el('label','f','Name in alerts'),label);
  const actions=el('div','row');actions.append(go);c.append(actions);
  setTimeout(()=>q.focus(),50);
  return c;
}

// ---------------------------------------------------------------- router
function viewRouter(mode, next){
  const c = card('Connect your router','The app reads your modem\'s log to see the moment NBN drops and when it switches to 4G backup — usually faster than NBN Co\'s own status page. Your password never leaves this computer.');
  const list = el('div','list'); const form = el('div','hidden'); const result = el('div');
  list.append(el('div','mut'));list.firstChild.append(el('span','spin'),document.createTextNode('Looking for routers on your network…'));
  const user = el('input'); user.type='text'; user.value=S.settings.router_user||'admin';
  const pass = el('input'); pass.type='password'; pass.autocomplete='off'; pass.placeholder=S.settings.router_password_set?'saved — leave blank to keep':'router admin password — not your Wi-Fi password';
  const passHelp = el('div','note warn');
  passHelp.append(el('b',null,'This is the router\'s admin (management) password, not your Wi-Fi password. '),
    document.createTextNode('It\'s the one you use to log in to the modem\'s settings page in a browser. It\'s often printed on the modem\'s sticker as "Admin password", "Device password" or "Web login". '),
    el('span','mut','Optus: sticker on the back · Telstra: "Admin password" on the sticker · Not sure? Use Skip — the app still works using NBN Co\'s status.'));
  let picked = null;
  const test = btn('Test connection',null,async()=>{
    test.disabled=true; result.replaceChildren(el('div','mut'));result.firstChild.append(el('span','spin'),document.createTextNode('Logging in to '+picked.host+'…'));
    const r = await api('/api/router/test',{host:picked.host,user:user.value,password:pass.value,family:picked.family}).catch(e=>({status:'error',message:e.message}));
    test.disabled=false; result.replaceChildren(note(r.message, r.status==='ok'?'ok':'bad'));
    if(r.status==='ok'){ if(r.live) result.append(liveBox(r.live)); cont.disabled=false; }
  });
  const cont = btn(mode==='wizard'?'Next →':'Save',null,async()=>{
    await api('/api/router/save',{host:picked.host,user:user.value,password:pass.value,name:picked.name,family:picked.family}); await refresh(); next();
  });
  cont.disabled = !S.settings.router_password_set;
  form.append(el('label','f','Admin username'),user,el('label','f','Admin password (not the Wi-Fi password)'),pass,passHelp);
  const fr=el('div','row');fr.append(test,cont);form.append(fr,result);
  const unsupported = el('div','hidden');
  const skip = btn(mode==='wizard'?'Skip for now':'Remove router','link',async()=>{
    if(mode!=='wizard') await api('/api/router/save',{host:'',user:'',password:'',name:'',clear:true});
    await refresh(); next();
  });
  c.append(list, form, unsupported);
  const actions=el('div','row');actions.append(skip);c.append(actions);
  api('/api/routers').then((data)=>{
    list.replaceChildren();
    if(!data.routers.length){list.append(note('No router answered on your network. You can skip this step.','warn'));return;}
    data.routers.forEach((r,i)=>{
      const o=el('div','opt');const t=el('div','t',r.name);
      if(r.nbn_modem) t.append(el('span','badge ok','NBN modem'));
      t.append(el('span','badge '+(r.supported?'ok':'warn'),r.supported?(r.experimental?'experimental':'supported'):'not supported yet'));
      o.append(el('div',null),t);o.firstChild.remove();
      const info=el('div');info.append(t,el('div','s',r.host+(r.role?' · '+r.role:'')));o.replaceChildren(info);
      o.onclick=()=>select(o,r);list.append(o);
      if(i===0) select(o,r);
    });
  }).catch(()=>{list.replaceChildren(note('Could not scan the network.','bad'));});
  function select(o,r){
    list.querySelectorAll('.opt').forEach(x=>x.classList.remove('sel'));o.classList.add('sel');picked=r;result.replaceChildren();
    if(r.supported){form.classList.remove('hidden');unsupported.classList.add('hidden');}
    else{form.classList.add('hidden');unsupported.classList.remove('hidden');unsupportedBox(r);}
  }
  function unsupportedBox(r){
    const name=r.name||'modem';
    unsupported.replaceChildren(note('NBN Watch can\'t read your '+name+' yet.','warn'));
    // --- the ask: why, join in, it's safe ---
    const cap=el('div','card help');cap.style.marginTop='14px';
    cap.append(el('h2',null,'Help us support the '+name),
      el('p','lead','NBN Watch is built and kept going by the people who use it. A 5-minute recording from you teaches it to read this modem — for you and for everyone else who has one.'));
    const crowd=el('div','crowd');cap.append(crowd);
    api('/api/community').then(d=>{
      const n=(x)=>Number(x||0).toLocaleString();
      const facts=[];
      if(d.active_users) facts.push([n(d.active_users),d.active_users===1?'person watching their NBN':'people watching their NBN']);
      if(d.recordings) facts.push([n(d.recordings),d.recordings===1?'modem recording shared':'modem recordings shared']);
      facts.push([String((d.supported_models||[]).length),'modem families supported']);
      crowd.replaceChildren(...facts.map(([v,l])=>{const f=el('div','fact');f.append(el('b',null,v),el('span',null,l));return f;}));
      if(d.supported_models&&d.supported_models.length) crowd.append(el('div','mut crowd-note','Supported so far: '+d.supported_models.join(', ')+'. Each one started with a recording like yours.'));
    }).catch(()=>crowd.remove());
    const pillars=el('div','pillars');
    [['Why a recording?','Every modem shows its NBN and 4G-backup status in its own way. Recording its admin pages once shows us where that status lives and how to read it.'],
     ['Be the one who adds it','Send one recording and we build support from it. It reaches everyone in an automatic update, and contributors are thanked by name in our Hall of Fame.'],
     ['Safe by design',null]].forEach(([t,d],i)=>{
      const p=el('div','pillar');p.append(el('div','pt',(i+1)+' · '+t));
      if(d) p.append(el('div','pd',d));
      else{const ul=el('ul','pd');['Your password never leaves this computer.','Passwords, Wi-Fi names and keys, MAC and public IP addresses and serial numbers are removed here, before upload.','Only the modem\'s own pages are kept.','You see a summary and nothing is sent until you press Send.'].forEach(x=>ul.append(el('li',null,x)));p.append(ul);}
      pillars.append(p);});
    cap.append(pillars,el('h3',null,'How to record'),harGuide(r.host));
    const file=el('input');file.type='file';file.accept='.har,application/json';
    const out=el('div');
    file.onchange=async()=>{
      const f=file.files[0];if(!f)return;out.replaceChildren(el('div','mut','Cleaning '+f.name+' on this computer…'));
      const r2=await fetch('/api/capture/preview?host='+encodeURIComponent(r.host),{method:'POST',headers:{'X-NBN-Token':TOKEN},body:f});
      const d=await r2.json().catch(()=>({error:'failed'}));
      if(!r2.ok){out.replaceChildren(note(d.error||'failed','bad'));return;}
      const sm=d.summary;const box=el('div','note ok');
      box.append(el('b',null,'Ready to send: '+sm.requests_kept+' modem requests ('+Math.round(d.bytes/1024)+' KB). '),
        document.createTextNode(sm.other_sites_dropped+' requests to other sites dropped. Removed: '+(Object.entries(sm.removed).map(([k,v])=>v+' '+k).join(', ')||'nothing sensitive found')+'.'));
      const pages=el('div','mut','Pages: '+(sm.pages.join(', ')||'—'));
      const credit=el('input');credit.type='text';credit.maxLength=40;credit.placeholder='e.g. Kai from Geelong — leave empty to stay anonymous';
      const go=btn('Send recording',null,async()=>{go.disabled=true;go.textContent='Sending…';
        const res=await api('/api/capture/send',{credit:credit.value.trim()}).catch(e=>({ok:false,error:e.message}));
        if(res.ok){go.textContent='Sent ✓';credit.disabled=true;
          out.append(note((credit.value.trim()?'Thank you, '+credit.value.trim()+'! ':'Thank you! ')+'You just helped everyone with a '+name+'. We\'ll build support from your recording and it will arrive in an automatic update'+(credit.value.trim()?', with your name in the Hall of Fame':'')+'. If anything is missing, we\'ll ask here.','ok'));}
        else{go.disabled=false;go.textContent='Try again';out.append(note('Could not send: '+(res.error||'no connection')+'. Check your internet connection and try again.','bad'));}});
      const actions=el('div','row');actions.append(go);
      out.replaceChildren(box,pages,el('label','f','Credit me in the Hall of Fame as (optional)'),credit,actions);
    };
    cap.append(el('label','f','Your recording (.har file)'),file,out);unsupported.append(cap);
    // --- the low-effort alternative ---
    const alt=el('div','card alt');
    alt.append(el('h2',null,'Not now?'),
      el('p','lead','Just tell us this modem isn\'t supported. We only send its model name and maker — no recording, no passwords. Every report moves it up our list.'));
    const fb=el('div');
    const send=btn('Report this modem as unsupported','ghost',async()=>{send.disabled=true;send.textContent='Reporting…';
      const res=await api('/api/router/report',{host:r.host}).catch(e=>({ok:false,error:e.message}));
      if(res.ok){send.textContent='Reported ✓';fb.replaceChildren(note('Thanks — we\'ve logged your '+name+' as unsupported. You\'ll get support in an automatic update when it\'s ready. You can still send a recording above any time to speed it up.','ok'));}
      else{send.disabled=false;send.textContent='Try again';fb.replaceChildren(note('Could not send the report'+(res.error?': '+res.error:'')+'. Check your internet connection and try again.','bad'));}});
    const row=el('div','row');row.append(send);alt.append(row,fb);unsupported.append(alt);
  }
  return c;
}
// --- HAR recording guide, tailored to the browser this page is open in ---
function detectBrowser(){
  const ua=navigator.userAgent, mobile=/Android|iPhone|iPad|iPod|Mobile/i.test(ua)||(navigator.maxTouchPoints>1&&/Macintosh/.test(ua));
  const mac=/Mac/i.test(navigator.platform||ua);
  let id='chrome';
  if(/Edg\//.test(ua)) id='edge';
  else if(/Firefox\//.test(ua)) id='firefox';
  else if(/OPR\//.test(ua)) id='opera';
  else if(/Vivaldi/.test(ua)) id='vivaldi';
  else if(navigator.brave) id='brave';
  else if(/Chrome\//.test(ua)||/Chromium\//.test(ua)) id='chrome';
  else if(/Safari\//.test(ua)) id='safari';
  return {id,mac,mobile};
}
const BROWSERS={chrome:'Chrome',edge:'Edge',brave:'Brave',opera:'Opera',vivaldi:'Vivaldi',firefox:'Firefox',safari:'Safari'};
function harSteps(id,mac,host){
  const url='http://'+host;
  const devtools=mac?'Cmd + Option + I':'F12 (or Ctrl + Shift + I)';
  const chromium=[
    ['Open '+url+' in a new '+BROWSERS[id]+' tab. Don\'t log in yet.'],
    ['Press '+devtools+' to open Developer Tools, then click the Network tab.'],
    ['Tick "Preserve log" at the top of the Network tab.'],
    ['Log in to the modem, then open: the status / overview page, the Internet / WAN / broadband page, and the system or event log page. Open the mobile / 4G backup page too if there is one.'],
    ['Click the download icon (⬇ "Export HAR") above the request list, or right-click any request → "Save all as HAR". The default (sanitized) export is fine.'],
    ['Choose the saved .har file below.']];
  const steps={
    firefox:[
      ['Open '+url+' in a new Firefox tab. Don\'t log in yet.'],
      ['Press '+(mac?'Cmd + Option + E':'Ctrl + Shift + E')+' to open the Network panel.'],
      ['Click the ⚙ gear icon in the Network panel and tick "Persist Logs".'],
      chromium[3],
      ['Right-click any request in the list → "Save All As HAR".'],
      chromium[5]],
    safari:[
      ['One-time setup: Safari → Settings → Advanced → tick "Show features for web developers" (older macOS: "Show Develop menu in menu bar").'],
      ['Open '+url+' in a new Safari tab. Don\'t log in yet.'],
      ['Develop menu → Show Web Inspector (Cmd + Option + I), then click the Network tab.'],
      ['Tick "Preserve Log" in the Network tab.'],
      chromium[3],
      ['Click the Export button (⬆) at the top right of the Network tab and save the .har file.'],
      chromium[5]]};
  return steps[id]||chromium;
}
function harGuide(host){
  const b=detectBrowser();const box=el('div');
  if(b.mobile){box.append(note('Recording needs a computer: open NBN Watch on a laptop or desktop connected to this modem\'s network and come back to this step.','warn'));return box;}
  const head=el('div','row');head.style.marginTop='0';
  const sel=el('select');sel.style.cssText='background:var(--background);color:var(--bright-foreground);border:1px solid var(--muted);padding:6px 8px;font:inherit';
  Object.entries(BROWSERS).forEach(([k,v])=>{const o=el('option',null,v);o.value=k;if(k===b.id)o.selected=true;sel.append(o);});
  head.append(el('span','mut','Steps for'),sel,el('span','mut','· detected '+BROWSERS[b.id]+(b.mac?' on Mac':'')));
  const open=el('a',null,'Open modem page ↗');open.href='http://'+host;open.target='_blank';open.rel='noopener';open.style.marginLeft='auto';
  head.append(open);
  const list=el('ol');list.style.cssText='margin:12px 0 12px 18px;padding:0;color:var(--foreground)';
  const draw=()=>{list.replaceChildren();harSteps(sel.value,b.mac,host).forEach(([t])=>{const li=el('li',null,t);li.style.marginBottom='6px';list.append(li);});
    if(sel.value==='safari') list.append(el('div','mut','If the summary below shows no log page, record again in Chrome or Edge — they capture page content most completely.'));};
  sel.onchange=draw;draw();
  box.append(head,list,note('Tip: don\'t browse other sites while recording. Anything not from the modem is dropped on this computer anyway.'));
  return box;
}
function liveBox(live){
  const kv=el('div','kv');
  const add=(k,v,cls)=>{kv.append(el('div',null,k));kv.append(el('div',cls||null,v));};
  add('Connection',live.wan==='mobile'?'📶 Mobile backup':'🌐 NBN',live.wan==='mobile'?'warn':'ok');
  add('NBN',live.nbn_connected?'✅ connected':'❌ disconnected',live.nbn_connected?'ok':'bad');
  add('4G backup',(live.mobile_up?'✅ ready':'⚪ off')+(live.technology?' · '+live.technology:'')+(live.signal?' · '+live.signal:''));
  return kv;
}

// ---------------------------------------------------------------- alerts
function viewAlerts(mode, next){
  const bot = S.telegram_bot || 'FaMuLei_bot';
  const c = card('Get alerts on Telegram','Optional. Alerts come from @'+bot+' when your NBN drops, switches to 4G backup or recovers.');
  const body = el('div'); c.append(body);
  let timer = null;
  async function render(){
    const st = await api('/api/telegram/status').catch(()=>({linked:false}));
    body.replaceChildren();
    if(st.linked){
      body.append(note('✅ Connected'+(st.name?' to '+st.name:'')+'. Alerts will arrive in Telegram.','ok'));
      const row=el('div','row');
      row.append(btn('Send test message','ghost',async()=>{const r=await api('/api/telegram/test',{}).catch(e=>({ok:false}));body.append(note(r.ok?'Test sent — check Telegram.':'Telegram did not accept the test.',r.ok?'ok':'bad'));}));
      row.append(btn('Disconnect','link',async()=>{await api('/api/telegram/unlink',{});await refresh();render();}));
      body.append(row);
    } else {
      body.append(btn('Connect Telegram',null,start));
    }
  }
  async function start(){
    const r = await api('/api/telegram/code',{}).catch(e=>({error:e.message}));
    body.replaceChildren();
    if(r.error){body.append(note('Could not get a code: '+r.error,'bad'));return;}
    body.append(el('div',null,'1. Open @'+r.bot+' in Telegram and press Start (or send this code):'));
    body.append(el('div','code',r.code.slice(0,3)+'-'+r.code.slice(3)));
    const row=el('div','row');const open=el('a',null,'Open Telegram →');open.href=r.link;open.target='_blank';open.rel='noopener';
    row.append(open);body.append(row);
    const wait=el('div','note');wait.append(el('span','spin'),document.createTextNode('2. Waiting for your message… (code valid 15 minutes)'));body.append(wait);
    clearInterval(timer);
    timer=setInterval(async()=>{const st=await api('/api/telegram/status').catch(()=>({}));if(st.linked){clearInterval(timer);await refresh();render();}},2500);
  }
  render();
  const actions=el('div','row');
  actions.append(btn(mode==='wizard'?'Next →':'Done',null,()=>{clearInterval(timer);next();}));
  if(mode==='wizard')actions.append(btn('Skip','link',()=>{clearInterval(timer);next();}));
  c.append(actions);
  return c;
}

// ---------------------------------------------------------------- prefs
function viewPrefs(mode, next){
  const c = card(mode==='wizard'?'Almost done':'Preferences','Choose how NBN Watch runs on this computer.');
  const p = S.settings;
  const items = [
    ['community','Share anonymous outage reports','Puts a dot on the community outage map for your ~1 km area. Never your address.'],
    ['recovery_watch','Let the server watch for recovery','During an outage your NBN location ID is sent (encrypted, deleted when it ends) so recovery is logged even if this computer is offline.'],
    ['speedtest','Speed test every 30 minutes','Only over NBN, never over 4G backup.'],
    ['autostart','Start when I log in','Keeps monitoring in the background.'],
    ['auto_update','Install updates automatically','Updates add support for more routers.'],
  ];
  const boxes = {};
  items.forEach(([k,t,s])=>{const row=el('label','toggle');const cb=el('input');cb.type='checkbox';cb.checked=!!p[k];boxes[k]=cb;
    const txt=el('div');txt.append(el('div','t',t),el('div','s',s));row.append(cb,txt);c.append(row);});
  const go=btn(mode==='wizard'?'Finish setup':'Save',null,async()=>{
    const body={};for(const k in boxes)body[k]=boxes[k].checked;
    await api('/api/prefs',body); if(mode==='wizard') await api('/api/finish',{}); await refresh(); next();
  });
  const actions=el('div','row');actions.append(go);c.append(actions);
  return c;
}

// ---------------------------------------------------------------- status
function statusStrip(){
  // One-line status above the settings; the tray / bar is the main status view.
  const st=S.status; const bar=el('div','strip');
  const dot=el('span','sdot');dot.style.background=st.colour;
  const txt=el('span','grow');txt.append(el('b',null,st.headline+'  '),el('span','mut',st.checked_at?'checked '+st.checked_at:'checking…'));
  bar.append(dot,txt,btn('Check now','ghost small',async()=>{await api('/api/check',{});setTimeout(load,4000);}));
  const out=[bar];
  if(S.update){const u=el('div','strip');u.append(el('span','grow','⬆️ Version '+S.update.version+' is available'),
    btn(S.update.can_install?'Install and restart':'Download','small',async()=>{
      if(S.update.can_install){await api('/api/update/install',{});}else{window.open(S.update.url,'_blank');}}));out.push(u);}
  return out;
}

// ---------------------------------------------------------------- routing
let settingsTab='address';
function route(name){
  const main=shell();
  const dot=$('.brand .dot'); if(S.status) dot.style.background=S.status.colour;
  if(name==='wizard'){
    const step=S.wizard_step||'address'; saveStep(step);
    const order=STEPS.map(s=>s[0]);
    const next=()=>{const i=order.indexOf(step);S.wizard_step=order[i+1]||'done';route(S.wizard_step==='done'?'settings':'wizard');};
    main.append(stepper(step));
    const views={address:viewAddress,router:viewRouter,alerts:viewAlerts,prefs:viewPrefs};
    main.append(views[step]('wizard',next));
    if(step!=='address'){const back=btn('← Back','link',()=>{S.wizard_step=order[order.indexOf(step)-1];route('wizard');});main.append(back);}
    return;
  }
  if(name==='settings'){
    const tabs=el('div','tabs');
    STEPS.map(s=>s[0]).forEach((k)=>{const names={address:'Address',router:'Router',alerts:'Telegram',prefs:'Preferences'};
      const t=btn(names[k],'tab'+(k===settingsTab?' on':''),()=>{settingsTab=k;route('settings');});tabs.append(t);});
    main.append(...statusStrip(), tabs);
    const views={address:viewAddress,router:viewRouter,alerts:viewAlerts,prefs:viewPrefs};
    main.append(views[settingsTab]('settings',async()=>{await refresh();route('settings');}));
    return;
  }
}
async function refresh(){S=Object.assign(S||{},await api('/api/state'));}
function savedStep(){try{return sessionStorage.getItem('nbn-step');}catch(e){return null;}}
function saveStep(s){try{sessionStorage.setItem('nbn-step',s);}catch(e){}}
async function load(){await refresh();$('#ver').textContent='v'+S.version;
  if(!S.settings.setup_done){
    // Resume after a reload; never past the address step without an address.
    S.wizard_step=S.wizard_step||savedStep()||(S.settings.loc_id?'router':'address');
    if(!S.settings.loc_id)S.wizard_step='address';
    route('wizard');}
  else if(!document.querySelector('.tabs')) route('settings');
  else { const strip=document.querySelector('.strip'); if(strip) strip.replaceWith(statusStrip()[0]); }}
load(); setInterval(()=>{if(S&&S.settings.setup_done)load();},30000);
"""


def render_page(theme_css: str, token: str) -> bytes:
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<meta name='nbn-token' content='{token}'>"
        "<title>NBN Watch Settings</title>"
        f"<style>{theme_css}{UI_CSS}</style></head><body><div class='wrap'>"
        "<header><div class='brand'><span class='dot'></span>NBN Watch"
        "<span class='sub'>Settings</span></div>"
        "<span class='ver' id='ver'></span></header><div id='main'></div></div>"
        f"<script>{UI_JS}</script></body></html>"
    ).encode()
