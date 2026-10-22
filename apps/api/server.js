import express from 'express';
import pg from 'pg';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {categories,scales,validate,dashboardSummary} from './domain.js';
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,max:10});
pool.on('error',()=>console.error('Database connection error'));
await pool.query(`CREATE TABLE IF NOT EXISTS survey_responses (
 id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
 course smallint NOT NULL CHECK(course BETWEEN 1 AND 4),
 scores jsonb NOT NULL, categories jsonb NOT NULL, feedback text NOT NULL)`);
const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff');
  if(req.path.startsWith('/api') || req.path==='/health') res.set('Cache-Control','no-store');
  if(process.env.ALLOWED_ORIGIN && req.get('origin')===process.env.ALLOWED_ORIGIN) {
    res.set('Access-Control-Allow-Origin',process.env.ALLOWED_ORIGIN); res.vary('Origin');
    res.set('Access-Control-Allow-Headers','Content-Type, Idempotency-Key');
    res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  }
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({limit:'24kb'}));
app.get('/health',async(req,res)=>{try{await pool.query('SELECT 1');res.json({status:'ok'});}catch{res.status(503).json({status:'unavailable'});}});
app.get('/api/form',(req,res)=>res.json({version:1,categories,scales}));
app.post('/api/responses',async(req,res,next)=>{
  let data;
  const id=req.get('Idempotency-Key');
  try {data=validate(req.body);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id||''))throw Error('Некорректный ключ отправки');}
  catch(e){return res.status(400).json({error:e.message});}
  try {
    const inserted=await pool.query('INSERT INTO survey_responses(id,course,scores,categories,feedback) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING RETURNING id',[id,data.course,JSON.stringify(data.scores),JSON.stringify(data.categories),data.feedback]);
    if(!inserted.rowCount){
      const existing=(await pool.query('SELECT course,scores,categories,feedback FROM survey_responses WHERE id=$1',[id])).rows[0];
      if(JSON.stringify(validate(existing))!==JSON.stringify(data))return res.status(409).json({error:'Ключ уже использован для другого ответа'});
    }
    res.status(inserted.rowCount?201:200).json({accepted:true});
  } catch(e){next(e);}
});
app.get('/api/dashboard',async(req,res,next)=>{
  try {
    // One query snapshot: counts and timestamp always describe the same rows.
    const {rows}=await pool.query(`SELECT scores,categories,created_at,
      to_char(date_trunc('week',created_at AT TIME ZONE 'Asia/Novosibirsk'),'YYYY-MM-DD') AS week
      FROM survey_responses ORDER BY created_at`);
    res.json({generatedAt:rows.at(-1)?.created_at??null,total:rows.length,...dashboardSummary(rows)});
  }catch(e){next(e);}
});
app.get('/runtime-config.js',(req,res)=>res.type('application/javascript').set('Cache-Control','no-store').send(`window.DASHMOOD_CONFIG = ${JSON.stringify({API_BASE_URL:process.env.API_BASE_URL||''}).replace(/</g,'\\u003c')};`));
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../web');
app.use(express.static(web,{index:false}));
app.get(['/', '/mood','/mood/','/dash','/dash/'],(req,res)=>res.sendFile(path.join(web,'index.html')));
app.use((req,res)=>res.status(404).json({error:'Не найдено'}));
app.use((err,req,res,next)=>{console.error('Request failed',err.code||err.type||'internal');res.status(err.status===400?400:err.status===413?413:503).json({error:err.status===400?'Некорректный JSON':err.status===413?'Слишком большой запрос':'Сервис временно недоступен'});});
const server=app.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('DashMood ready'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();});
