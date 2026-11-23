#!/usr/bin/env node
// Frozen-position coaching regression. Node 22+, no dependencies.
// Offline: node tests/coach-ai-regression.mjs
// Live (paid API): node tests/coach-ai-regression.mjs --live --limit 6
// Requires the existing local-server.mjs proxy on 127.0.0.1:8000 for --live.
// Deliberately never sends an OpenAI API key or calls OpenAI directly.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import vm from 'node:vm';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2);
const live=args.includes('--live');
const option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const max=Math.max(1,Math.min(24,Number(option('--limit')||6)));
const endpoint=option('--endpoint')||'http://127.0.0.1:8000/api/coach/move';
const selected=option('--case');
const baselineFile=option('--baseline');
const review=JSON.parse(readFileSync(resolve(root,'tests/coach-review-cases.json'),'utf8'));
const html=readFileSync(resolve(root,'index.html'),'utf8');
const lambda=readFileSync(resolve(root,'lambda-coach/index.mjs'),'utf8');

function between(text,start,end){
 const a=text.indexOf(start),b=text.indexOf(end,a+start.length);
 if(a<0||b<a)throw Error('Cannot locate production source section: '+start);
 return text.slice(a,b);
}
// Reuse the live application's move generator, tactical/strategic board facts,
// and the Lambda's own deterministic text checks. Do not duplicate chess rules.
const engine=between(html,'const on=i=>','const positionKey=');
const fen=between(html,'function fenOf(s){','function engineText(');
const analysis=between(html,'function coachEngineEvidence(position,analysis){','// Opening context is evidence, not a rule that the learner must follow.');
// Older versions use 'the learner' in this comment.
const analysisCode=analysis||'';
const played=between(html,'function playedMoveEvidence(position,move){','async function requestUnifiedMoveCoaching');
const lambdaValidation=between(lambda,'const words=text=>','async function generateCoaching(');
const context={dirs:{n:[-33,-31,-18,-14,14,18,31,33],b:[-17,-15,15,17],r:[-16,-1,1,16],k:[-17,-16,-15,-1,1,15,16,17]},routeLine:()=>[]};
vm.createContext(context);
vm.runInContext(engine+'\n'+fen+'\n'+analysisCode+'\n'+played+
 '\nthis.chess={original,legal,apply,key,moveLabel,fenOf,coachBoardFacts,coachMoveTactics,coachStrategicChanges,coachTeachingPriorities,playedMoveEvidence,coachPlainMove};',context,{timeout:3000});
const chess=context.chess;
const checker={};
vm.createContext(checker);
vm.runInContext(lambdaValidation+'\nthis.validate={checkExplanation,coachingBudget};',checker,{timeout:3000});

const sha=obj=>crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0,16);
const otherSequences={
 // Reconstructed legal continuations of the recorded scenario. These are
 // reproducible board positions, not claims about the opponent's actual game.
 '14-white-e-pawn-takes-d5':['g8f6','e4d5'],
 '15-black-e-pawn-takes-d5':['g8f6','e4d5','e6d5']
};
const base=['d2d4','d7d5','g1f3','g8f6','b1c3','e7e6','e2e4','f8b4','a2a3','b4a5','f1d3','a5c3','b2c3'];
function sequenceFor(item){
 if(item.referenceSequence==='main-line')return item.moves;
 if(otherSequences[item.id])return [...base,...otherSequences[item.id]];
 return null;
}
function makeInput(item,moves){
 let state=chess.original(),before=null,playedMove=null,after=null,labels=[];
 for(const uci of moves){
  const move=chess.legal(state).find(m=>chess.key(m)===uci);
  if(!move)throw Error('Illegal fixture '+item.id+': '+uci+' after '+labels.join(' '));
  before=state;playedMove=move;labels.push(chess.moveLabel(before,move));after=chess.apply(before,move);state=after;
 }
 if(!playedMove)throw Error('Empty fixture '+item.id);
 const mover=before.t===1?'White':'Black';
 const tacticalFacts=chess.coachMoveTactics(before,playedMove);
 const strategicFacts=chess.coachStrategicChanges(before,after);
 const teachingPriorities=chess.coachTeachingPriorities(before,playedMove,after,strategicFacts,tacticalFacts);
 const payload={
  beforeFen:chess.fenOf(before),afterFen:chess.fenOf(after),
  player:'White',mover,isOpponentMove:mover==='Black',
  played:chess.playedMoveEvidence(before,playedMove),
  playedPlainEnglish:chess.coachPlainMove(before,playedMove),
  boardFacts:{before:chess.coachBoardFacts(before),after:chess.coachBoardFacts(after)},
  tacticalFacts,strategicFacts,teachingPriorities,
  opening:'Unrecognised',openingContext:{source:'unrecognised',name:null},
  coachingLevel:{opponentElo:1500,explanationStyle:'intermediate'},
  coachingGuidance:{
   perspective:mover==='White'?'learner':'opponent',
   moverColour:mover,playerColour:'White',
   focus:'strategic',explainAlternatives:false,
   alternativePolicy:'No Stockfish evaluation is supplied. Do not recommend an engine alternative or make claims about best play.',
   evaluationPolicy:'No engine analysis supplied; do not assert Stockfish preference or quote evaluations.',
   languagePolicy:'Use clear plain English and verified board facts.'
  },
  engine:null,priorEngine:null,moveAssessment:null,alternativeEvidence:null,positionAssessment:null,
  history:labels,recentCoaching:[],scripted:'Regression case; explain the actual legal move.'
 };
 return {payload,moves,labels};
}
const fixed=[],skipped=[];
for(const item of review.cases){
 if(selected&&item.id!==selected)continue;
 const moves=sequenceFor(item);
 if(!moves){skipped.push({id:item.id,reason:'No complete legal move sequence / exact FEN recorded'});continue;}
 const fixture=makeInput(item,moves);
 fixed.push({id:item.id,category:item.category,expectedLesson:item.expectedLesson,redFlag:item.redFlag,...fixture,
  hash:sha(fixture.payload)});
}
if(selected&&!fixed.length&&!skipped.length)throw Error('Unknown case: '+selected);
const results=[];
const warnings=[];
let allowed=live?Math.min(max,fixed.length):0;
if(live&&!endpoint.startsWith('http://127.0.0.1:')&&!endpoint.startsWith('http://localhost:'))
 throw Error('For safety, --live only calls a loopback development proxy; start node local-server.mjs.');
for(const fixture of fixed){
 let message=null,error=null,checks=[];
 if(live&&results.filter(x=>x.attempted).length<allowed){
  try{
   const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(fixture.payload),signal:AbortSignal.timeout(45000)});
   const body=await r.json();
   if(!r.ok)throw Error('HTTP '+r.status+': '+String(body.error||'unknown'));
   if(typeof body.message!=='string')throw Error('Missing coach response');
   message=body.message;
   checks=Array.from(checker.validate.checkExplanation(message,fixture.payload,
    checker.validate.coachingBudget(fixture.payload)));
   // A small set of conservative semantic flags. These are warnings for
   // review, not proof that every unflagged sentence is true.
   if(/\b(?:the |your )?rooks? (?:are|is) connected\b/i.test(message))
    checks.push('Unverified connected-rooks claim');
   if(fixture.id==='05-knight-c3'&&/knight[^.!?]*\b(?:supports?|defends?|protects?)\b[^.!?]*pawn on d4/i.test(message))
    checks.push('Known c3-knight / d4-pawn false defence');
   if(fixture.id==='08-black-bishop-b4'&&/\bwins? (?:the |your )?knight\b/i.test(message))
    checks.push('Bishop exchange described as free knight');
  }catch(e){error=e.message;}
 }
 results.push({id:fixture.id,category:fixture.category,hash:fixture.hash,
  beforeFen:fixture.payload.beforeFen,afterFen:fixture.payload.afterFen,
  move:fixture.payload.played.uci,expectedLesson:fixture.expectedLesson,redFlag:fixture.redFlag,
  attempted:live&&results.filter(x=>x.attempted).length<allowed,
  response:message,error,objectiveWarnings:checks,
  // Human-scored dimensions intentionally blank until reviewed.
  review:{accuracy:null,tactical:null,teaching:null,clarity:null,notes:''}});
}
const completed=results.filter(x=>x.response),failures=results.filter(x=>x.error);
const flagged=completed.filter(x=>x.objectiveWarnings.length);
const summary={mode:live?'live':'offline',fixtureCount:fixed.length,skippedCount:skipped.length,
 attempted:completed.length+failures.length,completed:completed.length,errors:failures.length,
 responsesWithWarnings:flagged.length,warningCount:flagged.reduce((n,x)=>n+x.objectiveWarnings.length,0),
 reviewStatus:'Human quality scores not yet assigned'};
const report={version:1,createdAt:new Date().toISOString(),summary,skipped,results};
if(baselineFile){
 const old=JSON.parse(readFileSync(resolve(root,baselineFile),'utf8'));
 const byId=new Map(old.results.map(x=>[x.id,x]));
 report.comparison=results.map(r=>{
  const p=byId.get(r.id);
  return {id:r.id,samePosition:!!p&&p.beforeFen===r.beforeFen&&p.afterFen===r.afterFen,
   sameEvidence:!!p&&p.hash===r.hash,
   previousWarnings:p?.objectiveWarnings?.length??null,currentWarnings:r.objectiveWarnings.length,
   previousResponse:p?.response||null};
 });
 warnings.push('Comparison is valid only when samePosition and sameEvidence are both true. Model outputs remain stochastic.');
}
const directory=resolve(root,'tests/reports');
mkdirSync(directory,{recursive:true});
const out=resolve(directory,'coach-'+(live?'live':'fixtures')+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log('Chess AI regression: '+summary.mode);
console.log(JSON.stringify(summary,null,2));
console.log('Saved '+out);
if(skipped.length)console.log('Incomplete reference cases skipped: '+skipped.map(x=>x.id).join(', '));
if(flagged.length)console.log('Cases requiring review: '+flagged.map(x=>x.id).join(', '));
for(const x of warnings)console.warn('NOTE: '+x);
if(failures.length)process.exitCode=1;
