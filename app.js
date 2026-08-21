(function(){
"use strict";

/* ---------------- storage ---------------- */
var KEY = "reps:v1";
var mem = {};

// Three backends, in order of preference:
//   local  - localStorage, the normal case when self-hosted (GitHub Pages, any static host)
//   host   - a window.storage bridge, if the page is embedded in one
//   memory - nothing persists; the Data tab warns and pushes you to export
function detectBackend(){
  try {
    var t = "reps:probe";
    localStorage.setItem(t, "1");
    localStorage.removeItem(t);
    return "local";
  } catch(e){}
  if (window.storage && window.storage.get) return "host";
  return "memory";
}
var backend = detectBackend();
var persistent = backend !== "memory";

var store = {
  get: function(k){
    if (backend === "local"){
      try { return Promise.resolve(localStorage.getItem(k)); }
      catch(e){ return Promise.resolve(null); }
    }
    if (backend === "host"){
      return window.storage.get(k).then(function(r){ return r ? r.value : null; })
                                  .catch(function(){ return null; });
    }
    return Promise.resolve(mem[k] || null);
  },
  set: function(k,v){
    if (backend === "local"){
      try { localStorage.setItem(k,v); return Promise.resolve(); }
      catch(e){ backend = "memory"; persistent = false; }
    }
    if (backend === "host"){
      return window.storage.set(k,v).catch(function(){
        backend = "memory"; persistent = false; mem[k] = v;
      });
    }
    mem[k] = v;
    return Promise.resolve();
  }
};

var db = { units:"lb", days:{} };
var tab = "log";
var cursor = todayKey();
var openExercise = null;   // history detail

/* ---------------- date utils ---------------- */
function todayKey(){
  var d=new Date();
  return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
}
function pad(n){ return n<10 ? "0"+n : ""+n; }
function shiftKey(k, delta){
  var p=k.split("-");
  var d=new Date(+p[0], +p[1]-1, +p[2]);
  d.setDate(d.getDate()+delta);
  return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
}
var DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function labelDate(k){
  var p=k.split("-"), d=new Date(+p[0],+p[1]-1,+p[2]);
  if(k===todayKey()) return "Today";
  if(k===shiftKey(todayKey(),-1)) return "Yesterday";
  return DOW[d.getDay()]+" "+d.getDate()+" "+MON[d.getMonth()];
}
function shortDate(k){
  var p=k.split("-"), d=new Date(+p[0],+p[1]-1,+p[2]);
  return MON[d.getMonth()]+" "+d.getDate();
}
function daysBetween(a,b){
  var pa=a.split("-"), pb=b.split("-");
  var da=new Date(+pa[0],+pa[1]-1,+pa[2]), dbb=new Date(+pb[0],+pb[1]-1,+pb[2]);
  return Math.round((dbb-da)/86400000);
}

/* ---------------- data helpers ---------------- */
function esc(s){ return String(s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function num(n){ return Math.round(n).toLocaleString(); }
function trim(n){ return (Math.round(n*10)/10).toString(); }

function dayEntries(k){ return db.days[k] || []; }
function dayVolume(k){
  return dayEntries(k).reduce(function(t,e){ return t+entryVolume(e); },0);
}
function entryVolume(e){
  return e.sets.reduce(function(t,s){ return t + s.reps*s.weight; },0);
}
function sortedDays(){
  return Object.keys(db.days).filter(function(k){ return db.days[k].length; }).sort();
}
function exerciseNames(){
  var seen={}, out=[];
  sortedDays().reverse().forEach(function(k){
    db.days[k].forEach(function(e){
      var key=e.name.toLowerCase();
      if(!seen[key]){ seen[key]=1; out.push(e.name); }
    });
  });
  return out;
}
function sessionsOf(name){
  var lc=name.toLowerCase(), out=[];
  sortedDays().forEach(function(k){
    db.days[k].forEach(function(e){
      if(e.name.toLowerCase()===lc) out.push({date:k, sets:e.sets});
    });
  });
  return out;                       // ascending
}
function lastSessionBefore(name, dateKey, excludeId){
  var lc=name.toLowerCase(), best=null;
  sortedDays().forEach(function(k){
    if(k>dateKey) return;
    db.days[k].forEach(function(e){
      if(e.name.toLowerCase()!==lc) return;
      if(k===dateKey && e.id===excludeId) return;
      best={date:k, sets:e.sets};
    });
  });
  return best;
}
function topSet(sets){
  return sets.reduce(function(a,s){ return (!a || s.weight>a.weight || (s.weight===a.weight && s.reps>a.reps)) ? s : a; }, null);
}
function e1rm(s){ return s.weight * (1 + s.reps/30); }
function bestEver(name, excludeDate, excludeId){
  var b=0;
  sessionsOf(name).forEach(function(s){
    if(excludeDate && s.date===excludeDate) return;
    s.sets.forEach(function(x){ if(x.weight>b) b=x.weight; });
  });
  return b;
}
function summarise(sets){
  // group identical reps×weight → "3×8 @ 135"
  var parts=[], i=0;
  while(i<sets.length){
    var j=i;
    while(j+1<sets.length && sets[j+1].reps===sets[i].reps && sets[j+1].weight===sets[i].weight) j++;
    var n=j-i+1;
    parts.push((n>1?n+"×":"")+sets[i].reps+" @ "+trim(sets[i].weight));
    i=j+1;
  }
  return parts.join(", ")+" "+db.units;
}

function save(){ return store.set(KEY, JSON.stringify(db)); }
function uid(){ return Math.random().toString(36).slice(2,9); }

/* ---------------- render ---------------- */
var view = document.getElementById("view");
var dayTitle = document.getElementById("dayTitle");
var dayStat = document.getElementById("dayStat");
var daybar = document.getElementById("daybar");

function render(){
  var isLog = tab==="log";
  document.getElementById("prevDay").classList.toggle("hide", !isLog);
  document.getElementById("nextDay").classList.toggle("hide", !isLog);
  dayStat.classList.toggle("hide", !isLog);
  if(isLog) renderLog();
  else if(tab==="history") openExercise ? renderExercise() : renderHistory();
  else renderData();
  refreshDatalist();
}

function renderLog(){
  dayTitle.textContent = labelDate(cursor);
  var list = dayEntries(cursor);
  var sets = list.reduce(function(t,e){ return t+e.sets.length; },0);
  dayStat.innerHTML = list.length
    ? "<b>"+list.length+"</b> exercise"+(list.length>1?"s":"")+" · <b>"+sets+"</b> sets · <b>"+num(dayVolume(cursor))+"</b> "+db.units+" moved"
    : shortDate(cursor)+" · nothing logged";

  var html = "";
  list.forEach(function(e){
    var prev = lastSessionBefore(e.name, cursor, e.id);
    var pr = bestEver(e.name, cursor, e.id);
    html += '<section class="sheet" data-id="'+e.id+'">';
    html += '<div class="sheet-head"><h2>'+esc(e.name)+'</h2>'+
            '<span class="vol">'+num(entryVolume(e))+' '+db.units+'</span>'+
            '<button class="kebab" data-edit="'+e.id+'" aria-label="Edit '+esc(e.name)+'">⋯</button></div>';
    e.sets.forEach(function(s,i){
      var isPR = pr>0 && s.weight>pr;
      html += '<div class="setrow"><span class="idx">'+(i+1)+'</span>'+
              '<span class="figure">'+s.reps+'<span class="x">×</span>'+trim(s.weight)+
              '<span class="unit">'+db.units+'</span></span>'+
              (isPR ? '<span class="tag">PR</span>' : '')+
              '<span class="setvol">'+num(s.reps*s.weight)+'</span></div>';
    });
    if(prev){
      var gap = daysBetween(prev.date, cursor);
      html += '<div class="lastline">Last time · '+shortDate(prev.date)+' ('+gap+'d ago) · '+esc(summarise(prev.sets))+'</div>';
    }
    html += '</section>';
  });

  if(!list.length){
    html = '<div class="empty"><div class="big">Empty page</div>'+
           '<p>Add your first exercise of the day. Previous numbers show up as soon as you name it.</p></div>';
  }
  html += '<button class="add" id="addBtn">+ Add exercise</button>';
  view.innerHTML = html;
}

function renderHistory(){
  var names = exerciseNames();
  var q = (window.__q||"").toLowerCase();
  var html = '<div class="search"><input type="text" id="q" placeholder="Search exercises" value="'+esc(window.__q||"")+'"></div>';
  var shown = names.filter(function(n){ return n.toLowerCase().indexOf(q)>=0; });
  if(!names.length){
    html += '<div class="empty"><div class="big">No history yet</div><p>Log a session and it lands here, with every set kept by date.</p></div>';
  } else {
    shown.forEach(function(n){
      var ss = sessionsOf(n);
      var last = ss[ss.length-1];
      var best = 0;
      ss.forEach(function(s){ s.sets.forEach(function(x){ if(x.weight>best) best=x.weight; }); });
      html += '<button class="hrow" data-ex="'+esc(n)+'"><span class="nm">'+esc(n)+
              '<div class="sub">'+ss.length+' session'+(ss.length>1?"s":"")+' · last '+shortDate(last.date)+'</div></span>'+
              '<span class="best">'+trim(best)+'</span></button>';
    });
  }
  dayTitle.textContent = "History";
  view.innerHTML = html;
}

function renderExercise(){
  var name = openExercise;
  var ss = sessionsOf(name);
  var best=0, bestRm=0, totalVol=0;
  ss.forEach(function(s){ s.sets.forEach(function(x){
    if(x.weight>best) best=x.weight;
    if(e1rm(x)>bestRm) bestRm=e1rm(x);
    totalVol += x.reps*x.weight;
  }); });

  var html = '<button class="ghostbtn" id="backHist" style="margin-bottom:14px">‹ All exercises</button>';
  html += '<h2 style="font-family:var(--cond);font-size:27px;letter-spacing:.04em;text-transform:uppercase;margin:0 0 14px">'+esc(name)+'</h2>';
  html += '<div class="prcards">'+
    '<div class="prcard"><div class="cap">Heaviest</div><div class="v">'+trim(best)+' <small>'+db.units+'</small></div></div>'+
    '<div class="prcard"><div class="cap">Est. 1RM</div><div class="v">'+trim(bestRm)+' <small>'+db.units+'</small></div></div>'+
    '<div class="prcard"><div class="cap">Volume</div><div class="v">'+num(totalVol/1000)+'<small>k</small></div></div></div>';

  html += spark(ss);

  ss.slice().reverse().forEach(function(s){
    var v = s.sets.reduce(function(t,x){ return t+x.reps*x.weight; },0);
    html += '<div class="session"><div class="d">'+shortDate(s.date)+' · '+num(v)+' '+db.units+'</div>'+
            '<div class="s">'+esc(summarise(s.sets))+'</div></div>';
  });
  dayTitle.textContent = "History";
  view.innerHTML = html;
}

function spark(ss){
  var pts = ss.slice(-14).map(function(s){ return topSet(s.sets).weight; });
  if(pts.length<2) return '<div class="note">One session so far. The trend line appears after the second.</div>';
  var w=300, h=60, min=Math.min.apply(null,pts), max=Math.max.apply(null,pts);
  var span = (max-min)||1;
  var coords = pts.map(function(v,i){
    return [ (i/(pts.length-1))*w, h - ((v-min)/span)*h ];
  });
  var line = coords.map(function(c,i){ return (i?"L":"M")+c[0].toFixed(1)+" "+c[1].toFixed(1); }).join(" ");
  var area = line+" L"+w+" "+h+" L0 "+h+" Z";
  var dots = coords.map(function(c){ return '<circle cx="'+c[0].toFixed(1)+'" cy="'+c[1].toFixed(1)+'" r="2.6" fill="var(--plate-blue)"/>'; }).join("");
  return '<div class="sparkwrap"><div class="cap">Top set · last '+pts.length+' sessions</div>'+
    '<svg class="spark" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" aria-hidden="true">'+
    '<path d="'+area+'" fill="rgba(45,125,210,.14)"/>'+
    '<path d="'+line+'" fill="none" stroke="var(--plate-blue)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>'+
    dots+'</svg>'+
    '<div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--steel);margin-top:6px">'+
    '<span>'+trim(min)+'</span><span>'+trim(max)+' '+db.units+'</span></div></div>';
}

function renderData(){
  dayTitle.textContent = "Data";
  var days = sortedDays();
  var totalSets = 0;
  days.forEach(function(k){ db.days[k].forEach(function(e){ totalSets += e.sets.length; }); });
  var html = "";
  if(!persistent){
    html += '<div class="note"><b>Nothing is being saved.</b> This browser is blocking storage — private browsing does that. Export a backup before you close the tab, or reopen the app in a normal window.</div>';
  } else {
    html += '<div class="note">Everything stays on this phone. No account, no server, no sync. Export a backup before you switch phones or clear Safari data.</div>';
  }
  html += '<div class="prcards"><div class="prcard"><div class="cap">Days</div><div class="v">'+days.length+'</div></div>'+
          '<div class="prcard"><div class="cap">Sets</div><div class="v">'+totalSets+'</div></div>'+
          '<div class="prcard"><div class="cap">Moves</div><div class="v">'+exerciseNames().length+'</div></div></div>';
  html += '<label class="fl">Weight unit</label>'+
          '<div class="chips"><button class="chip" data-unit="lb"'+(db.units==="lb"?' style="border-color:var(--plate-blue);color:var(--bone)"':'')+'>lb</button>'+
          '<button class="chip" data-unit="kg"'+(db.units==="kg"?' style="border-color:var(--plate-blue);color:var(--bone)"':'')+'>kg</button></div>';
  html += '<div class="toolrow"><button class="ghostbtn" id="exportBtn">Export backup</button>'+
          '<button class="ghostbtn" id="importBtn">Import backup</button></div>';
  html += '<div class="toolrow"><button class="ghostbtn" id="wipeBtn" style="color:var(--plate-red)">Delete everything</button></div>';
  html += '<input type="file" id="fileIn" accept="application/json" class="hide">';
  view.innerHTML = html;
}

function refreshDatalist(){
  document.getElementById("exlist").innerHTML =
    exerciseNames().map(function(n){ return '<option value="'+esc(n)+'">'; }).join("");
}

/* ---------------- entry panel ---------------- */
var draft = null;   // {id, name, sets:[], reps, weight, editing}

function openPanel(entryId){
  var existing = null;
  if(entryId) existing = dayEntries(cursor).filter(function(e){ return e.id===entryId; })[0];
  draft = existing
    ? { id:existing.id, name:existing.name, sets:existing.sets.map(function(s){ return {reps:s.reps,weight:s.weight}; }),
        reps:existing.sets[existing.sets.length-1].reps, weight:existing.sets[existing.sets.length-1].weight, editing:true }
    : { id:uid(), name:"", sets:[], reps:8, weight:(db.units==="lb"?95:40), editing:false };
  paintPanel();
}
function closePanel(){ draft=null; document.getElementById("modal").innerHTML=""; render(); }

function paintPanel(){
  var prev = draft.name ? lastSessionBefore(draft.name, cursor, draft.id) : null;
  var recents = exerciseNames().slice(0,8);
  var step = db.units==="lb" ? 5 : 2.5;

  var h = '<div class="panel" role="dialog" aria-label="Log exercise"><div class="panel-head">'+
    '<button class="ghostbtn" id="cancelP">Cancel</button>'+
    '<span class="t">'+(draft.editing?"Edit":"Add")+' exercise</span>'+
    (draft.editing?'<button class="ghostbtn" id="delEntry" style="color:var(--plate-red)">Delete</button>':'')+
    '</div><div class="panel-body">';

  h += '<label class="fl" for="exName">Exercise</label>'+
       '<input type="text" id="exName" list="exlist" autocapitalize="words" autocomplete="off" '+
       'placeholder="Bench press" value="'+esc(draft.name)+'">';

  if(!draft.name && recents.length){
    h += '<div class="chips">'+recents.map(function(n){
      return '<button class="chip" data-pick="'+esc(n)+'">'+esc(n)+'</button>'; }).join("")+'</div>';
  }

  if(prev){
    h += '<div class="ghostlast"><div class="lbl">Last time · '+shortDate(prev.date)+' · '+daysBetween(prev.date,cursor)+'d ago</div>'+
         '<div class="val">'+esc(summarise(prev.sets))+'</div></div>';
  }

  h += '<div class="steppers">'+
    '<div class="stepper"><div class="cap">Reps</div><div class="row">'+
      '<button class="pm" data-adj="reps:-1" aria-label="Fewer reps">−</button>'+
      '<input type="text" inputmode="numeric" id="repsIn" value="'+draft.reps+'">'+
      '<button class="pm" data-adj="reps:1" aria-label="More reps">+</button></div></div>'+
    '<div class="stepper"><div class="cap">Weight '+db.units+'</div><div class="row">'+
      '<button class="pm" data-adj="weight:-'+step+'" aria-label="Less weight">−</button>'+
      '<input type="text" inputmode="decimal" id="wIn" value="'+trim(draft.weight)+'">'+
      '<button class="pm" data-adj="weight:'+step+'" aria-label="More weight">+</button></div></div></div>';

  h += '<button class="primary" id="logSet" style="margin-top:14px">+ Log set</button>';

  h += '<div class="queued"><div class="qhead"><span>Sets this session</span><span>'+
       (draft.sets.length? num(draft.sets.reduce(function(t,s){return t+s.reps*s.weight;},0))+" "+db.units : "—")+'</span></div>';
  if(!draft.sets.length){
    h += '<div style="padding:18px 2px;color:#5b616b;font-size:13px">No sets yet. Set the numbers above and log your first.</div>';
  }
  draft.sets.forEach(function(s,i){
    var d = "";
    if(prev && prev.sets[i]){
      var dw = s.weight - prev.sets[i].weight, dr = s.reps - prev.sets[i].reps;
      if(dw) d = '<span class="delta'+(dw<0?' down':'')+'">'+(dw>0?"+":"")+trim(dw)+' '+db.units+'</span>';
      else if(dr) d = '<span class="delta'+(dr<0?' down':'')+'">'+(dr>0?"+":"")+dr+' rep'+(Math.abs(dr)>1?"s":"")+'</span>';
      else d = '<span class="delta down">same</span>';
    }
    h += '<div class="qrow"><span class="idx">'+(i+1)+'</span>'+
         '<span class="figure">'+s.reps+'<span class="x">×</span>'+trim(s.weight)+'<span class="unit">'+db.units+'</span></span>'+
         d+'<span class="setvol">'+num(s.reps*s.weight)+'</span>'+
         '<button class="rm" data-rm="'+i+'" aria-label="Remove set '+(i+1)+'">×</button></div>';
  });
  h += '</div></div>';

  h += '<div class="panel-foot"><button class="primary" id="saveEx"'+(draft.sets.length&&draft.name.trim()?"":" disabled")+'>'+
       (draft.editing?"Save changes":"Save to "+labelDate(cursor).toLowerCase())+'</button></div></div>';

  document.getElementById("modal").innerHTML = h;
}

function readInputs(){
  var r = document.getElementById("repsIn"), w = document.getElementById("wIn");
  if(r) draft.reps = Math.max(1, Math.min(999, parseInt(r.value,10)||1));
  if(w) draft.weight = Math.max(0, parseFloat(w.value)||0);
  var n = document.getElementById("exName");
  if(n) draft.name = n.value;
}

/* ---------------- events ---------------- */
document.addEventListener("click", function(ev){
  var t = ev.target.closest("button");
  if(!t) return;

  if(t.id==="prevDay"){ cursor=shiftKey(cursor,-1); render(); return; }
  if(t.id==="nextDay"){ cursor=shiftKey(cursor,1); render(); return; }

  if(t.dataset.tab){
    tab=t.dataset.tab; openExercise=null;
    [].forEach.call(document.querySelectorAll("nav.tabs button"), function(b){
      b.setAttribute("aria-selected", b===t ? "true":"false"); });
    render(); return;
  }

  if(t.id==="addBtn"){ openPanel(null); return; }
  if(t.dataset.edit){ openPanel(t.dataset.edit); return; }
  if(t.dataset.ex){ openExercise=t.dataset.ex; render(); return; }
  if(t.id==="backHist"){ openExercise=null; render(); return; }

  if(t.dataset.unit){ db.units=t.dataset.unit; save(); render(); return; }

  if(t.id==="exportBtn"){
    var blob = new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reps-backup-"+todayKey()+".json";
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); },2000);
    return;
  }
  if(t.id==="importBtn"){ document.getElementById("fileIn").click(); return; }
  if(t.id==="wipeBtn"){
    if(confirm("Delete every logged session? This cannot be undone.")){
      db={units:db.units,days:{}}; save(); render();
    }
    return;
  }

  /* panel */
  if(!draft) return;
  if(t.id==="cancelP"){ closePanel(); return; }
  if(t.dataset.pick){ readInputs(); draft.name=t.dataset.pick; prefillFromLast(); paintPanel(); focusName(false); return; }
  if(t.dataset.adj){
    readInputs();
    var p=t.dataset.adj.split(":"), amt=parseFloat(p[1]);
    if(p[0]==="reps") draft.reps=Math.max(1, draft.reps+amt);
    else draft.weight=Math.max(0, Math.round((draft.weight+amt)*100)/100);
    paintPanel(); return;
  }
  if(t.id==="logSet"){
    readInputs();
    if(!draft.name.trim()){ focusName(true); return; }
    draft.sets.push({reps:draft.reps, weight:draft.weight});
    paintPanel(); return;
  }
  if(t.dataset.rm!==undefined && t.classList.contains("rm")){
    readInputs(); draft.sets.splice(+t.dataset.rm,1); paintPanel(); return;
  }
  if(t.id==="delEntry"){
    db.days[cursor] = dayEntries(cursor).filter(function(e){ return e.id!==draft.id; });
    save(); closePanel(); return;
  }
  if(t.id==="saveEx"){
    readInputs();
    if(!draft.name.trim() || !draft.sets.length) return;
    var list = db.days[cursor] || (db.days[cursor]=[]);
    var idx = -1;
    list.forEach(function(e,i){ if(e.id===draft.id) idx=i; });
    var rec = { id:draft.id, name:draft.name.trim(), sets:draft.sets };
    if(idx>=0) list[idx]=rec; else list.push(rec);
    save(); closePanel(); return;
  }
});

function focusName(select){
  var n=document.getElementById("exName");
  if(n){ n.focus(); if(select) n.select(); }
}
function prefillFromLast(){
  var prev = lastSessionBefore(draft.name, cursor, draft.id);
  if(prev && prev.sets.length && !draft.sets.length){
    draft.reps = prev.sets[0].reps;
    draft.weight = prev.sets[0].weight;
  }
}

document.addEventListener("change", function(ev){
  if(ev.target.id==="exName" && draft){
    draft.name = ev.target.value;
    prefillFromLast();
    paintPanel();
  }
  if(ev.target.id==="fileIn" && ev.target.files[0]){
    var fr=new FileReader();
    fr.onload=function(){
      try{
        var d=JSON.parse(fr.result);
        if(!d || typeof d.days!=="object") throw 0;
        db={units:d.units||"lb", days:d.days};
        save(); render();
      }catch(e){ alert("That file isn't a Reps backup. Pick the .json you exported."); }
    };
    fr.readAsText(ev.target.files[0]);
  }
});

document.addEventListener("input", function(ev){
  if(ev.target.id==="q"){
    window.__q = ev.target.value;
    var q = window.__q.toLowerCase();
    [].forEach.call(document.querySelectorAll(".hrow"), function(r){
      r.classList.toggle("hide", r.dataset.ex.toLowerCase().indexOf(q) < 0);
    });
  }
});

document.addEventListener("keydown", function(ev){
  if(ev.key==="Enter" && draft){
    if(ev.target.id==="repsIn" || ev.target.id==="wIn"){
      ev.preventDefault(); ev.target.blur();
      readInputs(); draft.sets.push({reps:draft.reps, weight:draft.weight}); paintPanel();
    }
    if(ev.target.id==="exName"){ ev.preventDefault(); ev.target.blur(); }
  }
});

/* ---------------- boot ---------------- */
if ("serviceWorker" in navigator && location.protocol !== "file:"){
  window.addEventListener("load", function(){
    navigator.serviceWorker.register("./sw.js").catch(function(){});
  });
}

store.get(KEY).then(function(raw){
  if(raw){ try{ var d=JSON.parse(raw); if(d && d.days) db=d; }catch(e){} }
  render();
});

})();
