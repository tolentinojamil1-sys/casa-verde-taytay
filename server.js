import express from 'express';
import session from 'express-session';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;
const db = new Database(path.join(__dirname,'data','casa-verde.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY,check_in TEXT NOT NULL,check_out TEXT NOT NULL,guests INTEGER NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT,total INTEGER NOT NULL,payment_method TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blocked_dates(date TEXT PRIMARY KEY,reason TEXT NOT NULL);`);
const defaults={nightly_rate:'10000',max_guests:'10',property_name:'Casa Verde Taytay'};
for(const [k,v] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k,v);
app.use(express.json());
app.use(session({secret:process.env.SESSION_SECRET||'dev-only-change-me',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax'}}));
app.use(express.static(path.join(__dirname,'public')));
function iso(d){return new Date(d+'T00:00:00').toISOString().slice(0,10)}
function datesBetween(a,b){const out=[];let d=new Date(a+'T00:00:00'),e=new Date(b+'T00:00:00');while(d<e){out.push(d.toISOString().slice(0,10));d.setDate(d.getDate()+1)}return out}
function conflicts(a,b){const ds=datesBetween(a,b); if(!ds.length)return true; const q=db.prepare("SELECT 1 FROM bookings WHERE status IN ('pending','paid','confirmed') AND check_in < ? AND check_out > ? LIMIT 1"); if(q.get(b,a))return true; const blocked=new Set(db.prepare(`SELECT date FROM blocked_dates WHERE date IN (${ds.map(()=>'?').join(',')})`).all(...ds).map(x=>x.date)); return ds.some(x=>blocked.has(x));}
function settings(){return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]))}
app.get('/api/config',(req,res)=>res.json(settings()));
app.get('/api/availability',(req,res)=>{const from=req.query.from||iso(new Date().toISOString().slice(0,10)),to=req.query.to||iso(new Date(Date.now()+120*86400000).toISOString().slice(0,10)); const booked=db.prepare("SELECT check_in,check_out,status FROM bookings WHERE status IN ('pending','paid','confirmed') AND check_out > ? AND check_in < ?").all(from,to); const blocked=db.prepare('SELECT date,reason FROM blocked_dates WHERE date>=? AND date<?').all(from,to); res.json({booked,blocked})});
app.post('/api/bookings',(req,res)=>{const {checkIn,checkOut,guests,name,email,phone,paymentMethod}=req.body||{}; const s=settings(); if(!checkIn||!checkOut||!name||!email||!phone)return res.status(400).json({error:'Please complete all required fields.'}); if(!Number.isInteger(Number(guests))||Number(guests)<1||Number(guests)>Number(s.max_guests))return res.status(400).json({error:`Maximum guests: ${s.max_guests}.`}); const nights=datesBetween(checkIn,checkOut).length; if(nights<1)return res.status(400).json({error:'Check-out must be after check-in.'}); if(conflicts(checkIn,checkOut))return res.status(409).json({error:'Those dates are not available.'}); const total=nights*Number(s.nightly_rate); const id='CV-'+crypto.randomBytes(4).toString('hex').toUpperCase(); db.prepare(`INSERT INTO bookings VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,checkIn,checkOut,Number(guests),name,email,phone,total,paymentMethod||'online', 'pending',new Date().toISOString()); res.status(201).json({id,total,nights,status:'pending',message:'Reservation created. Payment is the next step.'});});
app.get('/api/booking/:id',(req,res)=>{const b=db.prepare('SELECT id,check_in,check_out,guests,name,email,phone,total,payment_method,status,created_at FROM bookings WHERE id=?').get(req.params.id); if(!b)return res.status(404).json({error:'Booking not found'}); res.json(b)});
function auth(req,res,next){if(req.session.admin)return next();res.status(401).json({error:'Admin login required.'})}
app.post('/api/admin/login',(req,res)=>{if(req.body.email===process.env.ADMIN_EMAIL&&req.body.password===process.env.ADMIN_PASSWORD){req.session.admin=true;return res.json({ok:true})}res.status(401).json({error:'Invalid login.'})});
app.post('/api/admin/logout',(req,res)=>{req.session.destroy(()=>res.json({ok:true}))});
app.get('/api/admin/bookings',auth,(req,res)=>res.json(db.prepare('SELECT * FROM bookings ORDER BY check_in ASC').all()));
app.post('/api/admin/block',auth,(req,res)=>{const {date,reason='Blocked'}=req.body||{};if(!date)return res.status(400).json({error:'Date required'});db.prepare('INSERT OR REPLACE INTO blocked_dates(date,reason) VALUES(?,?)').run(date,reason);res.json({ok:true})});
app.delete('/api/admin/block/:date',auth,(req,res)=>{db.prepare('DELETE FROM blocked_dates WHERE date=?').run(req.params.date);res.json({ok:true})});
app.post('/api/admin/booking-status',auth,(req,res)=>{const {id,status}=req.body||{};if(!['pending','paid','confirmed','cancelled'].includes(status))return res.status(400).json({error:'Invalid status'});db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,id);res.json({ok:true})});
app.post('/api/admin/settings',auth,(req,res)=>{for(const [k,v] of Object.entries(req.body||{})){if(['nightly_rate','max_guests'].includes(k))db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k,String(v))}res.json(settings())});
app.post('/api/webhooks/payment',(req,res)=>{ // provider-specific webhook hook; verify signature before production use
  const {bookingId,status}=req.body||{}; if(bookingId&&['paid','cancelled'].includes(status)) db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,bookingId); res.json({received:true});
});
app.listen(port,()=>console.log(`Casa Verde running at http://localhost:${port}`));
