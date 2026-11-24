#!/usr/bin/env node
// Controlled, paid A/B benchmark: exact production Lambda instructions,
// validation, model completion cap and evidence, with NO AWS deployment.
// Node 22+. --self-test is free. --live makes paid OpenAI API requests.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {handler} from '../lambda-coach/index.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2);
const opt=flag=>{const i=args.indexOf(flag);return i<0?null:args[i+1];};
const variants=[
 {id:'mini-low',model:'gpt-5.4-mini',effort:'low',prices:{input:0.75,cached:0.075,output:4.5}},
 {id:'mini-medium',model:'gpt-5.4-mini',effort:'medium',prices:{input:0.75,cached:0.075,output:4.5}},
 {id:'full-medium',model:'gpt-5.4',effort:'medium',prices:{input:2.5,cached:0.25,output:15}}
];
function dollarCost(usages,prices){
 return usages.reduce((sum,u)=>{
  const input=u.prompt_tokens||0,cache=u.prompt_tokens_details?.cached_tokens||0;
  const output=u.completion_tokens||0;
  return sum+((input-cache)*prices.input+cache*prices.cached+output*prices.output)/1e6;
 },0);
}
function summary(report){
 const rows=report.results||[];
 const byVariant=variants.map(v=>{
  const rs=rows.filter(x=>x.variant===v.id);
  const ok=rs.filter(x=>x.statusCode===200&&x.message);
  const times=rs.map(x=>x.latencyMs).filter(Number.isFinite).sort((a,b)=>a-b);
  const reviews=ok.filter(x=>Number.isFinite(x.humanReview?.accuracy)&&
   Number.isFinite(x.humanReview?.teaching)&&typeof x.humanReview?.majorFactualError==='boolean');
  const mean=(key)=>reviews.length?
   Number((reviews.reduce((n,x)=>n+x.humanReview[key],0)/reviews.length).toFixed(2)):null;
  return {variant:v.id,model:v.model,reasoningEffort:v.effort,
   attempted:rs.length,successful:ok.length,
   successPercent:rs.length?Number((ok.length/rs.length*100).toFixed(1)):null,
   repaired:ok.filter(x=>x.validation?.repairAttempted===true).length,
   fallbacks:ok.filter(x=>x.validation?.status==='fallback').length,
   errors:rs.length-ok.length,
   medianLatencyMs:times.length?times[Math.floor((times.length-1)/2)]:null,
   tokens:rs.reduce((n,x)=>n+(x.usages||[]).reduce((t,u)=>t+(u.prompt_tokens||0)+(u.completion_tokens||0),0),0),
   costUSD:Number(rs.reduce((n,x)=>n+(x.costUSD||0),0).toFixed(6)),
   reviewed:reviews.length,meanAccuracy:mean('accuracy'),meanTeaching:mean('teaching'),
   majorFactualErrors:reviews.filter(x=>x.humanReview.majorFactualError).length};
 });
 const fullyReviewed=byVariant.every(v=>v.attempted>0&&v.reviewed===v.successful);
 const complete=variants.every(v=>report.fixtures?.length===v.attempted);
 return {complete,fullyReviewed,models:byVariant,
  totalCostUSD:Number(byVariant.reduce((n,v)=>n+v.costUSD,0).toFixed(6)),
  verdict:!complete?'INCOMPLETE':!fullyReviewed?'AWAITING_HUMAN_REVIEW':
   byVariant.every(v=>v.successPercent>=95&&v.majorFactualErrors===0&&
    v.meanAccuracy>=8&&v.meanTeaching>=7)?'ALL_PASS':'SOME_BELOW_RELEASE_GATE'};
}
function verifyFixtures(data){
 if(data?.suite!=='model-benchmark'||!Array.isArray(data.fixtures)||
    data.fixtures.length!==15)throw Error('Expected precisely fifteen controlled fixtures');
 const seen=new Set(),counts={positional:0,tactical:0,endgame:0};
 for(const f of data.fixtures){
  if(!f.id||seen.has(f.id)||!Object.hasOwn(counts,f.scenario)||
     typeof f.payload?.beforeFen!=='string'||typeof f.payload?.afterFen!=='string'||
     !Array.isArray(f.payload?.history)||f.payload?.recentCoaching?.length)
   throw Error('Invalid or duplicate fixture '+String(f.id));
  seen.add(f.id);counts[f.scenario]++;
 }
 if(Object.values(counts).some(x=>x!==5))throw Error('Expected five fixtures per scenario');
 return data;
}
if(args.includes('--self-test')){
 const f={suite:'model-benchmark',fixtures:['positional','tactical','endgame']
  .flatMap(id=>Array.from({length:5},(_,i)=>({id:id+':'+i,scenario:id,
   payload:{beforeFen:'x',afterFen:'y',history:[],recentCoaching:[]}})))};
 verifyFixtures(f);
 const cost=dollarCost([{prompt_tokens:1000,completion_tokens:100,prompt_tokens_details:{cached_tokens:100}}],variants[0].prices);
 if(Math.abs(cost-0.0011325)>1e-10)throw Error('Cost accounting regression: '+cost);
 const mock={fixtures:f.fixtures,results:variants.flatMap(v=>f.fixtures.map(x=>({
  variant:v.id,id:x.id,statusCode:200,message:'valid',costUSD:.001,
  latencyMs:100,usages:[],humanReview:{accuracy:null,teaching:null,majorFactualError:null}})))};
 if(summary(mock).verdict!=='AWAITING_HUMAN_REVIEW')throw Error('Human-review gate regression');
 for(const x of mock.results)x.humanReview={accuracy:9,teaching:8,majorFactualError:false};
 if(summary(mock).verdict!=='ALL_PASS')throw Error('Successful review gate regression');
 mock.results[0].humanReview.majorFactualError=true;
 if(summary(mock).verdict!=='SOME_BELOW_RELEASE_GATE')throw Error('Major factual error gate regression');
 console.log('Model benchmark self-test: 4/4 passed. No API requests made.');
 process.exit(0);
}
if(args.includes('--compare')){
 const path=opt('--compare');
 if(!path)throw Error('--compare requires report path');
 const report=JSON.parse(readFileSync(resolve(process.cwd(),path),'utf8'));
 console.log(JSON.stringify(summary(report),null,2));process.exit(0);
}
if(!args.includes('--live'))throw Error('Use --self-test (free), --compare <report>, or --live (paid).');
if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY must be set locally before --live; never commit the key.');
const fixturePath=opt('--fixtures')||'tests/reports/coach-model-benchmark-fixtures.json';
const fixtures=verifyFixtures(JSON.parse(readFileSync(resolve(process.cwd(),fixturePath),'utf8')));
const cap=Number(opt('--max-cost-usd')||15);
if(!Number.isFinite(cap)||cap<=0||cap>100)throw Error('Spend cap must be >0 and <=100 USD.');
const maxCases=Number(opt('--max-cases')||15);
if(!Number.isInteger(maxCases)||maxCases<1||maxCases>15)throw Error('--max-cases must be 1..15');
const selected=fixtures.fixtures.slice(0,maxCases);
const output=opt('--out')||'tests/reports/coach-model-benchmark-results.json';
const path=resolve(process.cwd(),output);
if(existsSync(path)&&!args.includes('--resume'))throw Error('Report exists. Use --resume to continue without recharging.');
const report=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{
 version:1,type:'chess-coach-model-benchmark',createdAt:new Date().toISOString(),
 evidenceSource:fixturePath,fixtures:selected.map(x=>({
  id:x.id,scenario:x.scenario,label:x.label,afterFen:x.afterFen
 })),variants:variants.map(x=>({id:x.id,model:x.model,effort:x.effort,pricingPerMillion:x.prices})),
 notes:'Identical production system instructions and chess evidence. Only model and reasoning effort vary. Independent prompts: no model-generated preceding coaching. Reviewer scores must be assigned manually.',
 results:[]
};
const keys=new Set(report.results.map(x=>x.variant+':'+x.id));
const expected=new Set(selected.flatMap(f=>variants.map(v=>v.id+':'+f.id)));
if(report.results.some(x=>!expected.has(x.variant+':'+x.id)))
 throw Error('Existing output has incompatible position or variant IDs.');
if(report.fixtures.length!==selected.length||report.fixtures.some((f,i)=>f.id!==selected[i].id))
 throw Error('Existing output fixture selection differs; use another --out path.');
function save(){
 mkdirSync(resolve(path,'..'),{recursive:true});
 report.summary=summary(report);
 writeFileSync(path,JSON.stringify(report,null,2)+'\n');
}
const originalFetch=globalThis.fetch;
let activeVariant=null,usages=[];
globalThis.fetch=async(url,init={})=>{
 if(String(url)!=='https://api.openai.com/v1/chat/completions')
  throw Error('Benchmark forbids outgoing requests to unexpected endpoint');
 if(!activeVariant)throw Error('Benchmark model not selected');
 const current=JSON.parse(init.body);
 // Only these two fields differ from production. Never mutate instructions,
 // evidence, token limits, validator code or API endpoint.
 const body=JSON.stringify({...current,model:activeVariant.model,
  reasoning_effort:activeVariant.effort});
 const response=await originalFetch(url,{...init,body,signal:AbortSignal.timeout(45000)});
 try{
  const copied=await response.clone().json();
  if(copied?.usage)usages.push(copied.usage);
 }catch{}
 return response;
};
try{
 for(let i=0;i<selected.length;i++){
  const fixture=selected[i];
  const rotated=[...variants.slice(i%3),...variants.slice(0,i%3)];
  for(const variant of rotated){
   const key=variant.id+':'+fixture.id;
   if(keys.has(key))continue;
   const spent=report.results.reduce((n,x)=>n+(x.costUSD||0),0);
   if(spent>=cap){
    console.warn('Spend cap reached. Existing results saved.');save();process.exit(0);
   }
   activeVariant=variant;usages=[];
   const started=Date.now();
   let response;
   try{
    const event={requestContext:{http:{method:'POST'}},body:JSON.stringify(fixture.payload)};
    const result=await handler(event);
    const parsed=JSON.parse(result.body);
    response={
     statusCode:result.statusCode,message:parsed.message||null,
     error:parsed.error||null,validation:parsed.validation||null
    };
   }catch(err){response={statusCode:0,message:null,error:String(err.message||err).slice(0,250),validation:null};}
   const entry={id:fixture.id,scenario:fixture.scenario,label:fixture.label,
    variant:variant.id,statusCode:response.statusCode,message:response.message,
    error:response.error,validation:response.validation,latencyMs:Date.now()-started,
    usages,costUSD:Number(dollarCost(usages,variant.prices).toFixed(7)),
    humanReview:{accuracy:null,teaching:null,majorFactualError:null,notes:''}};
   report.results.push(entry);keys.add(key);save();
   console.log(variant.id+' / '+fixture.id+': HTTP '+entry.statusCode+
    ', '+entry.latencyMs+'ms, $'+entry.costUSD.toFixed(4)+
    ', '+(entry.validation?.status||'no validation'));
   if(entry.statusCode===0||entry.statusCode===429||entry.statusCode>=500&&
      entry.error==='AI service unavailable'){
    console.warn('Stopping after infrastructure/API failure. Resume later with --resume.');
    save();process.exit(1);
   }
  }
 }
}finally{
 globalThis.fetch=originalFetch;
}
save();
console.log('Benchmark complete. Results: '+path);
console.log(JSON.stringify(summary(report),null,2));
