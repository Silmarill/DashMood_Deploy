import fs from 'node:fs';
export const categories = JSON.parse(fs.readFileSync(new URL('../../packages/shared/categories.json', import.meta.url),'utf8').replace(/^\uFEFF/,''));
export const scales = {emo:'Эмоциональное состояние',comfort:'Комфорт обучения',satisfaction:'Удовлетворённость направлением'};
export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Некорректный ответ');
  if (!Number.isInteger(body.course) || body.course < 1 || body.course > 4) throw Error('Выберите курс');
  const scores = {};
  for (const key of Object.keys(scales)) {
    const value = body.scores?.[key];
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 10)) throw Error('Оценки: целые числа от 0 до 10 или пропуск');
    scores[key] = value;
  }
  if (!Array.isArray(body.categories) || body.categories.length > categories.length || new Set(body.categories).size !== body.categories.length || body.categories.some(id=>!categories.some(c=>c.id===id))) throw Error('Некорректные трудности');
  if (body.categories.includes('none') && body.categories.length > 1) throw Error('«Ничего» нельзя совмещать с другими пунктами');
  if (body.categories.length === 0) throw Error('Выберите трудности или «Ничего»');
  if (typeof body.feedback !== 'string' || body.feedback.length > 4000) throw Error('Отзыв: не более 4000 символов');
  return {course:body.course,scores,categories:body.categories,feedback:body.feedback.trim()};
}
export function summarize(rows) {
  const n = rows.length;
  if (n < 5) return {n,suppressed:true};
  const result = {n,suppressed:false,scales:{},categories:{}};
  for (const key of Object.keys(scales)) {
    const values=rows.map(r=>r.scores[key]).filter(v=>v!==null).sort((a,b)=>a-b);
    const count=values.length;
    result.scales[key]=count<5?{n:count,suppressed:true}:{n:count,mean:values.reduce((a,b)=>a+b,0)/count,median:(values[Math.floor((count-1)/2)]+values[Math.floor(count/2)])/2};
  }
  for (const c of categories) result.categories[c.id]={count:rows.filter(r=>r.categories.includes(c.id)).length,n};
  return result;
}
export function dashboardSummary(rows) {
  const groups=[...new Set(rows.map(r=>r.week))].map(week=>({week,...summarize(rows.filter(r=>r.week===week))}));
  const summary=summarize(rows);
  // Do not allow the total to reveal a hidden week by subtraction.
  if(groups.some(g=>g.suppressed)) return {summary:{n:rows.length,suppressed:true},weeks:groups.map(g=>({week:g.week,n:g.n,suppressed:true}))};
  for(const key of Object.keys(scales)) {
    if(groups.some(g=>g.scales[key].suppressed)) {
      summary.scales[key]={n:summary.scales[key].n,suppressed:true};
      for(const group of groups)group.scales[key]={n:group.scales[key].n,suppressed:true};
    }
  }
  return {summary,weeks:groups};
}
