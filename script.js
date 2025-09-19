// assets/script.js - simplified runtime for demo
const lsGet = (k,d)=>JSON.parse(localStorage.getItem(k)||JSON.stringify(d));
const lsSet = (k,v)=>{ localStorage.setItem(k,JSON.stringify(v)); window.dispatchEvent(new Event('storage')); };
const toast=(msg,t=3000)=>{ const c=document.getElementById('notifContainer'); if(!c) return alert(msg); const d=document.createElement('div'); d.className='notif'; d.innerHTML=msg; c.prepend(d); setTimeout(()=>d.remove(), t); };

// Socket.IO client
const socket = io();

// Join user room if logged in
function joinUserRoomIfLoggedIn(){ const user = lsGet('fsai_user', null); if(user && user.id){ socket.emit('joinUserRoom', { userId: user.id }); } }
joinUserRoomIfLoggedIn();

// Listen for realtime events
socket.on('likeUpdate', ({ imageId, likes })=>{ const el = document.getElementById('likes-'+imageId); if(el) el.innerText = likes; });
socket.on('followUpdate', ({ targetUserId, followersCount })=>{ const el = document.getElementById('followers-'+targetUserId); if(el) el.innerText = followersCount; });
socket.on('notification', (n)=>{ toast(n.text); });

// helper: download
function downloadData(url){ const a=document.createElement('a'); a.href=url; a.download='image.png'; a.click(); }

// API helpers
async function api(path, opts){ const res = await fetch(path, opts); return res.json(); }

// Load templates for index
async function renderFrontendTemplates(){
  const grid = document.getElementById('templateGrid'); if(!grid) return;
  const tpl = await api('/api/templates'); grid.innerHTML=''; tpl.forEach(t=>{ const div=document.createElement('div'); div.className='card-dark'; div.innerHTML=`<img src="${t.img}" style="width:100%;height:140px;object-fit:cover;border-radius:10px"/><h4>${t.title}</h4><div class="muted">${t.prompt}</div><div class="row" style="margin-top:8px"><button class="btn" onclick="selectTemplate('${t.id}')">Use</button></div>`; grid.appendChild(div); });
}
function selectTemplate(id){ lsSet('fsai_selected_template', id); toast('Template selected'); }

// Visitor credits display
function renderVisitorCredits(){ const v = lsGet('fsai_visitor',{credits:5}); const el = document.getElementById('visitorCredits'); if(el) el.innerHTML = 'Credits: <b>'+(v.credits||0)+'</b>'; }

// Public gallery actions
async function toggleLike(imageId){
  const user = lsGet('fsai_user', null);
  if(!user){ alert('Login to like'); window.location='/login.html'; return; }
  // call API
  const res = await fetch('/api/public-gallery/'+imageId+'/like',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:user.id})});
  const j = await res.json();
  if(j.ok){ socket.emit('likeImage',{imageId, userId:user.id}); }
}

// follow from gallery
async function followFromGallery(targetId){
  const user = lsGet('fsai_user', null);
  if(!user){ alert('Login to follow'); window.location='/login.html'; return; }
  const res = await fetch('/api/follow/'+targetId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:user.id})});
  const j = await res.json();
  if(j.ok){ socket.emit('followUser',{targetUserId:targetId, userId:user.id}); toast('Toggled follow'); }
}

// make image public (from profile)
async function makePublic(imageId){
  const user = lsGet('fsai_user', null); if(!user){ alert('Login'); return; }
  const res = await fetch('/api/gallery/make-public',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:user.id, imageId})});
  const j = await res.json(); if(j.ok){ toast('Made public'); }
}

// helper: load public gallery (used in explore page)
async function loadPublicGallery(){
  const res = await fetch('/api/public-gallery'); const data = await res.json();
  const container = document.getElementById('publicGallery'); if(!container) return;
  container.innerHTML=''; data.forEach(img=>{
    const div = document.createElement('div'); div.className='card-dark';
    div.innerHTML = `<img src="${img.url}" style="width:100%;height:160px;object-fit:cover;border-radius:10px"/><div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><div><b>@${img.userHandle||'anon'}</b></div><div><button class="btn" onclick="toggleLike('${img.id}')"><span id="heart-${img.id}">🤍</span> <span id="likes-${img.id}">${img.likes||0}</span></button></div></div><div style="margin-top:6px;"><button class="btn ghost" onclick="followFromGallery('${img.userId}')">Follow</button></div>`;
    container.appendChild(div);
  });
}

// profile load api
async function loadProfileData(){
  const user = lsGet('fsai_user', null);
  if(!user) return;
  const res = await fetch('/api/profile/'+user.id); const data = await res.json();
  return data;
}

// simple init
window.addEventListener('DOMContentLoaded', ()=>{
  renderVisitorCredits();
  renderFrontendTemplates();
  // if on explore page, load gallery
  if(document.getElementById('publicGallery')) loadPublicGallery();
  if(document.getElementById('profileInfo')) { loadProfileData().then(data=>{ /* handled in profile page script */ }); }
});
