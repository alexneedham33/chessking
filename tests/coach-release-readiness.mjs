#!/usr/bin/env node
// Review reports from the three contrasting ChessKing release scenarios.
// Usage: node tests/coach-release-readiness.mjs tests/reports/coach-games-live-....json
// Run --self-test without paid API calls to check the verdict logic.
import {readFileSync} from 'node:fs';
const required=['positional','tactical','endgame'];
function evaluate(reports){
 const latest=new Map();
 for(const report of reports){
  if(report?.mode!=='live')continue;
  for(const game of report.games||[]){
   if(!required.includes(game.id))continue;
   const responses=(game.entries||[]).filter(x=>x.attempted);
   if(!latest.has(game.id)||responses.length>(latest.get(game.id).entries||[]).filter(x=>x.attempted).length)
    latest.set(game.id,game);
  }
 }
 const missing=required.filter(x=>!latest.has(x));
 const results=[...latest.values()];
 const all=results.flatMap(x=>x.entries||[]).filter(x=>x.attempted);
 const accepted=all.filter(x=>x.response&&!x.error&&x.validation?.status!=='failed');
 const reliability=all.length?accepted.length/all.length:null;
 const reviews=accepted.filter(x=>Number.isFinite(x.humanReview?.accuracy)&&
  Number.isFinite(x.humanReview?.teaching)&&
  typeof x.humanReview?.majorFactualError==='boolean');
 const majorErrors=reviews.filter(x=>x.humanReview.majorFactualError).length;
 const accuracy=reviews.length?reviews.reduce((n,x)=>n+x.humanReview.accuracy,0)/reviews.length:null;
 const teaching=reviews.length?reviews.reduce((n,x)=>n+x.humanReview.teaching,0)/reviews.length:null;
 const enoughSamples=results.every(g=>(g.entries||[]).filter(x=>x.attempted).length>=5);
 const reliable=reliability!==null&&reliability>=.95;
 const reviewed=accepted.length>0&&reviews.length===accepted.length;
 const quality=reviewed&&majorErrors===0&&accuracy>=8&&teaching>=7;
 const status=missing.length||!enoughSamples?'INSUFFICIENT_SAMPLE':
  !reliable?'FAIL_RELIABILITY':
  !reviewed?'AWAITING_HUMAN_REVIEW':
  !quality?'FAIL_QUALITY':'PASS';
 return {status,thresholds:{requiredScenarios:required,minAttemptsPerScenario:5,
  minReliability:0.95,minMeanAccuracy:8,minMeanTeaching:7,maxMajorErrors:0,
  reviewCoverage:'100% of accepted responses'},
  results:required.map(id=>{
   const entries=(latest.get(id)?.entries||[]).filter(x=>x.attempted);
   return {id,attempted:entries.length,accepted:entries.filter(x=>x.response).length,
    errors:entries.filter(x=>x.error).length,
    reviewed:entries.filter(x=>Number.isFinite(x.humanReview?.accuracy)&&
      Number.isFinite(x.humanReview?.teaching)&&
      typeof x.humanReview?.majorFactualError==='boolean').length};
  }),
  totals:{attempted:all.length,accepted:accepted.length,
   reliabilityPercent:reliability===null?null:Number((100*reliability).toFixed(1)),
   repaired:accepted.filter(x=>x.validation?.repairAttempted).length,
   fallbacks:accepted.filter(x=>x.validation?.status==='fallback').length,
   reviewed:reviews.length,majorFactualErrors:majorErrors,
   meanAccuracy:accuracy===null?null:Number(accuracy.toFixed(2)),
   meanTeaching:teaching===null?null:Number(teaching.toFixed(2))},
  explanation:status==='AWAITING_HUMAN_REVIEW'?
   'Transport/validator reliability passed; chess accuracy and usefulness are not proven until every accepted response is manually rated.':
   status==='PASS'?'All automatic and reviewed release gates passed.':
   'The current evidence does not meet the release thresholds.'};
}
function assert(value,message){if(!value)throw Error('Readiness self-test: '+message);}
function mock(id,count=5,error=false,review=true){
 return {id,entries:Array.from({length:count},(_,i)=>({
  attempted:true,response:error&&i===0?null:'Verified teaching response',
  error:error&&i===0?'HTTP 502':null,
  validation:{status:error&&i===0?'failed':'passed'},
  humanReview:review?{accuracy:9,teaching:8,majorFactualError:false}:
   {accuracy:null,teaching:null,majorFactualError:null}
 }))};
}
if(process.argv.includes('--self-test')){
 const base={mode:'live',games:required.map(id=>mock(id))};
 assert(evaluate([base]).status==='PASS','passing reports');
 assert(evaluate([{...base,games:base.games.map(g=>({...g,
  entries:g.entries.map(e=>({...e,humanReview:{accuracy:null,teaching:null,majorFactualError:null}}))}))}]).status==='AWAITING_HUMAN_REVIEW','missing review');
 assert(evaluate([{mode:'live',games:required.map(id=>mock(id,5,true))}]).status==='FAIL_RELIABILITY','failure detection');
 assert(evaluate([{mode:'live',games:required.map(id=>mock(id,4))}]).status==='INSUFFICIENT_SAMPLE','sample count');
 assert(evaluate([{mode:'offline',games:required.map(id=>mock(id))}]).status==='INSUFFICIENT_SAMPLE','offline not live');
 console.log('Readiness evaluator self-test: 5/5 cases passed.');
}else{
 const paths=process.argv.slice(2);
 if(!paths.length)throw Error('Pass at least one live report file, or --self-test.');
 const verdict=evaluate(paths.map(p=>JSON.parse(readFileSync(p,'utf8'))));
 console.log(JSON.stringify(verdict,null,2));
 // Pending human review is not a software crash; an actual failed gate is.
 if(['FAIL_RELIABILITY','FAIL_QUALITY'].includes(verdict.status))process.exitCode=1;
}
