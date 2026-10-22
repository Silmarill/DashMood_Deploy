import test from 'node:test';
import assert from 'node:assert/strict';
import {validate,summarize,dashboardSummary} from '../apps/api/domain.js';
const response={course:1,scores:{emo:0,comfort:null,satisfaction:10},categories:['none'],feedback:''};
test('zero is a score; missing score is not zero',()=>{assert.equal(validate(response).scores.emo,0);const result=summarize(Array.from({length:5},()=>response));assert.equal(result.scales.emo.mean,0);assert.deepEqual(result.scales.comfort,{n:0,suppressed:true});});
test('invalid survey combinations rejected',()=>{for(const change of [{course:5},{scores:{emo:11}},{categories:['none','load']},{categories:['unknown']},{categories:['load','load']},{feedback:'x'.repeat(4001)}])assert.throws(()=>validate({...response,...change}));});
test('small week cannot be recovered from history total',()=>{const rows=Array.from({length:6},(_,i)=>({...response,week:i<5?'2026-10-12':'2026-10-19'}));const result=dashboardSummary(rows);assert.equal(result.summary.suppressed,true);assert.ok(result.weeks.every(w=>w.suppressed));assert.equal(JSON.stringify(result).includes('feedback'),false);});
test('scale with missing values suppressed across totals',()=>{const rows=Array.from({length:10},(_,i)=>({...response,week:i<5?'a':'b',scores:{...response.scores,emo:i===0?null:0}}));const result=dashboardSummary(rows);assert.equal(result.summary.scales.emo.suppressed,true);assert.ok(result.weeks.every(w=>w.scales.emo.suppressed));});
test('period median uses individual scores',()=>{const rows=[0,0,10,10,10].map(emo=>({...response,scores:{...response.scores,emo}}));assert.equal(summarize(rows).scales.emo.median,10);assert.equal(summarize(rows).scales.emo.mean,6);});
