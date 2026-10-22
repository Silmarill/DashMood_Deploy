// Run only against the isolated database created by test-container.ps1.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.argv[2];
const mode=process.argv[3]||'initial';
if(!base?.startsWith('http://127.0.0.1:')) throw Error('Use isolated local test container');
async function get(path){const r=await fetch(base+path);assert.equal(r.status,200,path);return r;}
if(mode==='unavailable') {
  assert.equal((await fetch(base+'/health')).status,503);
  console.log('PASS health reports unavailable PostgreSQL');
  process.exit(0);
}
assert.deepEqual(await (await get('/health')).json(),{status:'ok'});
if(mode==='persisted') {
  const data=await (await get('/api/dashboard')).json();
  assert.equal(data.total,5);
  assert.equal(data.summary.scales.emo.mean,0);
  console.log('PASS five responses survive application and database container replacement');
  process.exit(0);
}
const form=await (await get('/api/form')).json();
assert.equal(form.categories.length,19);
assert.equal(Object.keys(form.scales).length,3);
assert.equal((await (await get('/api/dashboard')).json()).total,0);
for(const route of ['/mood','/dash']) {
  const page=await get(route);
  assert.match(page.headers.get('content-type'),/text\/html/);
  const html=await page.text();
  assert.ok(html.indexOf('/runtime-config.js')<html.indexOf('type="module"'));
  for(const asset of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) await get(asset[1]);
}
const config=await get('/runtime-config.js');
assert.equal(config.headers.get('cache-control'),'no-store');
assert.ok((await config.text()).includes(base));
const preflight=await fetch(base+'/api/responses',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:18081','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,idempotency-key'}});
assert.equal(preflight.status,204);
assert.equal(preflight.headers.get('access-control-allow-origin'),'http://127.0.0.1:18081');
const disallowed=await fetch(base+'/api/form',{headers:{Origin:'https://untrusted.example'}});
assert.equal(disallowed.headers.get('access-control-allow-origin'),null);
const body={course:1,scores:{emo:0,comfort:null,satisfaction:10},categories:['none'],feedback:'SYNTHETIC PRIVATE TEST FEEDBACK'};
async function post(data,id=randomUUID()){return fetch(base+'/api/responses',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify(data)});}
const id=randomUUID();
assert.equal((await post(body,id)).status,201);
assert.equal((await post(body,id)).status,200);
assert.equal((await post({...body,course:2},id)).status,409);
assert.equal((await post({...body,categories:['none','load']})).status,400);
assert.equal((await post({...body,scores:{emo:11,comfort:null,satisfaction:10}})).status,400);
assert.equal((await post(body,'invalid')).status,400);
const small=await (await get('/api/dashboard')).json();
assert.equal(small.total,1);assert.equal(small.summary.suppressed,true);
for(let i=0;i<4;i++)assert.equal((await post(body)).status,201);
const aggregate=await get('/api/dashboard');
assert.equal(aggregate.headers.get('cache-control'),'no-store');
const data=await aggregate.json();
assert.equal(data.total,5);
assert.equal(data.summary.scales.emo.mean,0);
assert.equal(data.summary.scales.satisfaction.median,10);
assert.equal(data.summary.scales.comfort.suppressed,true);
assert.equal(data.summary.categories.none.count,5);
assert.equal(data.weeks.length,1);
assert.ok(data.generatedAt);
assert.ok(!JSON.stringify(data).includes('SYNTHETIC'));
assert.ok(!JSON.stringify(data).includes(id));
assert.equal((await fetch(base+'/api/responses')).status,404);
assert.equal((await fetch(base+'/missing')).status,404);
console.log('PASS health, static routes/assets, runtime Env, CORS, survey validation, idempotency, aggregation, privacy');
