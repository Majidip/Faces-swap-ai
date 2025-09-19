const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// lowdb file
const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

async function initDB(){
  await db.read();
  db.data = db.data || {};
  db.data.users = db.data.users || [
    { id:'u_admin', name:'Admin', email:'admin@example.com', password:'admin123', credits:1000, followers:[], following:[] }
  ];
  db.data.public_gallery = db.data.public_gallery || [
    { id:'img_1', userId:'u_admin', userHandle:'admin', url:'/assets/sample1.jpg', likes:2, likedBy:['u_admin'] }
  ];
  db.data.templates = db.data.templates || [];
  db.data.notifications = db.data.notifications || [];
  await db.write();
}
initDB();

/* REST endpoints */
// auth (signup/login simplified)
app.post('/api/auth/signup', async (req,res)=>{
  await db.read();
  const { name, email, password, phone } = req.body;
  if(!email || !password) return res.json({ ok:false, error:'email+password required' });
  const exists = (db.data.users||[]).find(u=>u.email===email);
  if(exists) return res.json({ ok:false, error:'email exists' });
  const id = nanoid(8);
  const user = { id, name:name||email.split('@')[0], email, password, phone:phone||'', credits:5, followers:[], following:[], generatedImages:[] };
  db.data.users.push(user);
  await db.write();
  res.json({ ok:true, token:'token-'+id, user });
});
app.post('/api/auth/login', async (req,res)=>{
  await db.read();
  const { email, password } = req.body;
  const u = (db.data.users||[]).find(x=>x.email===email && x.password===password);
  if(!u) return res.json({ ok:false, error:'invalid credentials' });
  res.json({ ok:true, token:'token-'+u.id, user:u });
});

// templates
app.get('/api/templates', async (req,res)=>{ await db.read(); res.json(db.data.templates||[]); });

// public gallery
app.get('/api/public-gallery', async (req,res)=>{ await db.read(); res.json(db.data.public_gallery||[]); });
app.post('/api/public-gallery/:imageId/like', async (req,res)=>{
  const { userId } = req.body; const imageId = req.params.imageId;
  await db.read();
  const img = (db.data.public_gallery||[]).find(i=>i.id===imageId);
  if(!img) return res.status(404).json({ ok:false, error:'not found' });
  img.likedBy = img.likedBy || [];
  if(img.likedBy.includes(userId)){ img.likedBy = img.likedBy.filter(u=>u!==userId); img.likes = Math.max(0,(img.likes||1)-1); }
  else { img.likedBy.push(userId); img.likes = (img.likes||0)+1; }
  await db.write();
  // emit update
  io.emit('likeUpdate', { imageId, likes: img.likes });
  // notify owner
  if(img.userId && img.userId!==userId){
    const notif = { id:'n_'+Date.now(), type:'like', from:userId, to:img.userId, imageId, text:`${userId} liked your image`, ts:Date.now() };
    db.data.notifications.unshift(notif);
    await db.write();
    io.to('user:'+img.userId).emit('notification', notif);
  }
  res.json({ ok:true, likes:img.likes });
});

// follow
app.post('/api/follow/:targetUserId', async (req,res)=>{
  const { userId } = req.body; const target = req.params.targetUserId;
  await db.read();
  const users = db.data.users||[];
  const actor = users.find(u=>u.id===userId); const tar = users.find(u=>u.id===target);
  if(!actor||!tar) return res.status(404).json({ ok:false });
  actor.following = actor.following||[]; tar.followers = tar.followers||[];
  if(tar.followers.includes(userId)){ tar.followers=tar.followers.filter(x=>x!==userId); actor.following=actor.following.filter(x=>x!==target); }
  else { tar.followers.push(userId); actor.following.push(target); }
  await db.write();
  io.emit('followUpdate',{ targetUserId: target, followersCount: tar.followers.length });
  if(!tar.followers.includes(userId)){
    const notif = { id:'n_'+Date.now(), type:'follow', from:userId, to:target, text:`${userId} started following you`, ts:Date.now() };
    db.data.notifications.unshift(notif);
    await db.write();
    io.to('user:'+target).emit('notification', notif);
  }
  res.json({ ok:true });
});

// profile
app.get('/api/profile/:userId', async (req,res)=>{
  await db.read();
  const user = (db.data.users||[]).find(u=>u.id===req.params.userId);
  if(!user) return res.status(404).json({ ok:false });
  const generatedImages = user.generatedImages || [];
  const likedImages = (db.data.public_gallery||[]).filter(img=> (img.likedBy||[]).includes(user.id) );
  res.json({ user, generatedImages, likedImages });
});

// make public
app.post('/api/gallery/make-public', async (req,res)=>{
  const { userId, imageId } = req.body;
  await db.read();
  const user = (db.data.users||[]).find(u=>u.id===userId);
  if(!user) return res.json({ ok:false });
  const img = (user.generatedImages||[]).find(i=>i.id===imageId);
  if(!img) return res.json({ ok:false, error:'image not found' });
  const pub = { id: nanoid(8), userId:user.id, userHandle:user.name, url: img.url, likes:0, likedBy:[] };
  db.data.public_gallery.unshift(pub);
  await db.write();
  io.emit('newImage', pub);
  res.json({ ok:true, image:pub });
});

// admin endpoints (simple pin)
app.get('/api/users', (req,res)=>{ const pin = req.headers['x-admin-pin'] || req.query.admin_pin; if(pin!=='0000') return res.status(401).json({}); res.json(db.data.users||[]); });
app.delete('/api/users/:id', (req,res)=>{ const pin = req.headers['x-admin-pin'] || req.query.admin_pin; if(pin!=='0000') return res.status(401).json({}); db.data.users = (db.data.users||[]).filter(u=>u.id!==req.params.id); db.write(); res.json({ ok:true }); });
app.delete('/api/public-gallery/:id', (req,res)=>{ const pin = req.headers['x-admin-pin'] || req.query.admin_pin; if(pin!=='0000') return res.status(401).json({}); db.data.public_gallery = (db.data.public_gallery||[]).filter(i=>i.id!==req.params.id); db.write(); io.emit('removeImage',{ imageId: req.params.id}); res.json({ ok:true }); });
app.post('/api/public-gallery/:id/reset', (req,res)=>{ const pin = req.headers['x-admin-pin'] || req.query.admin_pin; if(pin!=='0000') return res.status(401).json({}); const img = (db.data.public_gallery||[]).find(i=>i.id===req.params.id); if(img){ img.likes=0; img.likedBy=[]; db.write(); io.emit('likeUpdate',{ imageId: img.id, likes:0}); } res.json({ ok:true }); });

// socket.io connection handling
io.on('connection', (socket)=>{
  console.log('socket connected', socket.id);
  socket.on('joinUserRoom', ({ userId })=>{ if(userId) socket.join('user:'+userId); });
  socket.on('likeImage', async ({ imageId, userId })=>{
    // mirror REST like endpoint for real-time emit
    const img = (db.data.public_gallery||[]).find(i=>i.id===imageId);
    if(!img) return;
    img.likedBy = img.likedBy||[];
    if(img.likedBy.includes(userId)){ img.likedBy = img.likedBy.filter(u=>u!==userId); img.likes = Math.max(0,(img.likes||1)-1); }
    else { img.likedBy.push(userId); img.likes = (img.likes||0)+1; }
    await db.write();
    io.emit('likeUpdate',{ imageId: img.id, likes: img.likes });
    if(img.userId && img.userId !== userId){
      const notif = { id:'n_'+Date.now(), type:'like', from:userId, to:img.userId, imageId: img.id, text:`${userId} liked your image`, ts: Date.now() };
      db.data.notifications.unshift(notif); await db.write();
      io.to('user:'+img.userId).emit('notification', notif);
    }
  });
  socket.on('followUser', async ({ targetUserId, userId })=>{
    const users = db.data.users||[]; const actor = users.find(u=>u.id===userId); const tar=users.find(u=>u.id===targetUserId);
    if(!actor||!tar) return;
    actor.following=actor.following||[]; tar.followers=tar.followers||[];
    if(tar.followers.includes(userId)){ tar.followers=tar.followers.filter(x=>x!==userId); actor.following=actor.following.filter(x=>x!==targetUserId); }
    else { tar.followers.push(userId); actor.following.push(targetUserId); }
    await db.write();
    io.emit('followUpdate',{ targetUserId, followersCount: tar.followers.length });
    if(!tar.followers.includes(userId)){
      const notif = { id:'n_'+Date.now(), type:'follow', from:userId, to:targetUserId, text:`${userId} started following you`, ts:Date.now() };
      db.data.notifications.unshift(notif); await db.write();
      io.to('user:'+targetUserId).emit('notification', notif);
    }
  });
  socket.on('disconnect', ()=>console.log('socket disconnect', socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=>console.log('Server running on', PORT));
