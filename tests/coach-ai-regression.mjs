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
import {startStockfish} from './stockfish-evidence.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2);
const live=args.includes('--live');
const useStockfish=args.includes('--stockfish');
const stockfishDepth=Math.max(10,Math.min(20,Number((()=>{const i=args.indexOf('--depth');return i>=0?args[i+1]:14;})())));
const option=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const max=Math.max(1,Math.min(40,Number(option('--limit')||6)));
const group=option('--group');
if(group&&!['tactical','historical','engine'].includes(group))throw Error('--group must be tactical, historical or engine');
if(group==='engine'&&!useStockfish)throw Error('--group engine requires --stockfish: never fabricate engine evaluations');
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
 '\nthis.chess={original,legal,apply,key,moveLabel,fenOf,checked,coachEngineEvidence,coachBoardFacts,coachMoveTactics,coachStrategicChanges,coachTeachingPriorities,playedMoveEvidence,coachPlainMove};',context,{timeout:3000});
const chess=context.chess;
const checker={};
vm.createContext(checker);
vm.runInContext(lambdaValidation+'\nthis.validate={checkExplanation,coachingBudget};',checker,{timeout:3000});

const sha=obj=>crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0,16);
const otherSequences={
 // Reconstructed legal continuations of the recorded scenario. These are
 // reproducible board positions, not claims about the opponent's actual game.
 '14-white-e-pawn-takes-d5':['b8d7','e4d5'],
 '15-black-e-pawn-takes-d5':['b8d7','e4d5','e6d5']
};
const base=['d2d4','d7d5','g1f3','g8f6','b1c3','e7e6','e2e4','f8b4','a2a3','b4a5','f1d3','a5c3','b2c3'];
function sequenceFor(item){
 if(['tactical-fen','engine-fen','engine-line'].includes(item.referenceSequence))return item.moves;
 if(item.referenceSequence==='main-line')return item.moves;
 if(otherSequences[item.id])return [...base,...otherSequences[item.id]];
 return null;
}
// Exact 0x88 board state from a curated FEN. Every proposed move is still
// checked through the application's legal() before any AI call.
function positionFromFen(fen){
 const parts=fen.trim().split(/\s+/);
 if(parts.length!==6)throw Error('Tactical FEN requires six fields');
 const [placement,turn,castling,ep,half,full]=parts,rows=placement.split('/');
 if(rows.length!==8||!['w','b'].includes(turn))throw Error('Invalid tactical FEN');
 const b=Array(128).fill('.');
 rows.forEach((row,rank)=>{
  let file=0;
  for(const ch of row){
   if(/[1-8]/.test(ch))file+=Number(ch);
   else if(/[pnbrqkPNBRQK]/.test(ch)&&file<8)b[rank*16+file++]=ch;
   else throw Error('Invalid FEN piece '+ch);
  }
  if(file!==8)throw Error('Invalid FEN rank '+row);
 });
 if(b.filter(x=>x==='K').length!==1||b.filter(x=>x==='k').length!==1)
  throw Error('Tactical FEN needs one king per side');
 if(castling!=='-'&&/[^KQkq]/.test(castling))throw Error('Invalid FEN castling');
 if(ep!=='-'&&!/^[a-h][1-8]$/.test(ep))throw Error('Invalid FEN en passant');
 const epIndex=ep==='-'?-1:(8-Number(ep[1]))*16+'abcdefgh'.indexOf(ep[0]);
 const s={b,t:turn==='w'?1:-1,c:castling==='-'?0:
  (castling.includes('K')?1:0)+(castling.includes('Q')?2:0)+
  (castling.includes('k')?4:0)+(castling.includes('q')?8:0),
  ep:epIndex,half:Number(half),full:Number(full),i:-1};
 if(chess.fenOf(s)!==fen)throw Error('Tactical FEN does not round-trip: '+fen);
 return s;
}
function makeInput(item,moves){
 let state=item.beforeFen?positionFromFen(item.beforeFen):chess.original(),before=null,playedMove=null,after=null,labels=[];
 let previousBefore=null,previousMove=null;
 for(const uci of moves){
  const move=chess.legal(state).find(m=>chess.key(m)===uci);
  if(!move)throw Error('Illegal fixture '+item.id+': '+uci+' after '+labels.join(' '));
  previousBefore=before;previousMove=playedMove;
  before=state;playedMove=move;labels.push(chess.moveLabel(before,move));after=chess.apply(before,move);state=after;
 }
 if(!playedMove)throw Error('Empty fixture '+item.id);
 const mover=before.t===1?'White':'Black';
 const tacticalFacts=chess.coachMoveTactics(before,playedMove,previousBefore,previousMove);
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
 return {payload,moves,labels,before,after};
}

// Tactics are curated independently of Stockfish. Verify only claims that can
// be proven from board geometry, legal moves and actual castling/check state.
function assertTacticalFixture(item,fixture){
 if(item.referenceSequence!=='tactical-fen')return;
 const facts=fixture.payload.tacticalFacts;
 const expected=item.expect||{};
 if(expected.forkTargets){
  if(!facts.forkEvidence||!expected.forkTargets.every(x=>
   facts.forkEvidence.targets.some(y=>y.square===x)))
   throw Error('Tactical fork targets missing: '+item.id);
 }
 if(expected.discoveredTarget){
  if(!facts.discoveredAttacks.some(x=>x.targetSquare===expected.discoveredTarget))
   throw Error('Tactical discovered attack missing: '+item.id);
 }
 if(expected.pinSquare){
  if(!fixture.payload.strategicFacts.changes.some(x=>x.type==='pin-created'&&x.pinnedSquare===expected.pinSquare))
   throw Error('Tactical pin missing: '+item.id);
 }
 if(expected.check===true&&!facts.givesCheck)
  throw Error('Expected move to give check: '+item.id);
 if(expected.capturedPiece&&facts.exchangeEvidence.captured?.piece!==expected.capturedPiece)
  throw Error('Incorrect tactical capture: '+item.id);
 if(expected.opponentCaptureUci&&!facts.exchangeEvidence.captureOptions.some(
   x=>x.uci===expected.opponentCaptureUci))
  throw Error('Expected legal reply capturing moved piece: '+item.id);
}

const fixed=[],skipped=[];
for(const item of review.cases){
 if(selected&&item.id!==selected)continue;
 if(group==='tactical'&&item.referenceSequence!=='tactical-fen')continue;
 if(group==='historical'&&['tactical-fen','engine-fen','engine-line'].includes(item.referenceSequence))continue;
 if(group==='engine'&&!item.referenceSequence.startsWith('engine-'))continue;
 if(item.referenceSequence.startsWith('engine-')&&!useStockfish)continue;
 const moves=sequenceFor(item);
 if(!moves){skipped.push({id:item.id,reason:'No complete legal move sequence / exact FEN recorded'});continue;}
 const fixture=makeInput(item,moves);
 assertTacticalFixture(item,fixture);
 fixed.push({id:item.id,category:item.category,expectedLesson:item.expectedLesson,redFlag:item.redFlag,...fixture,
  hash:sha(fixture.payload)});
}
if(selected&&!fixed.length&&!skipped.length)throw Error('Unknown case: '+selected);

// These fixtures reproduce the historical errors on the real production move
// generator. Fail CI if a future refactor drops required recapture evidence.
function assertExchangeFixture(id,check){
 const fixture=fixed.find(x=>x.id===id);
 if(!fixture)return; // --case intentionally narrows the replay.
 const facts=fixture.payload.tacticalFacts.exchangeEvidence;
 if(!check(facts))throw Error('Exchange regression failed for '+id);
}
assertExchangeFixture('09-white-a3',facts=>
 facts.captureOptions.some(x=>x.uci==='b4a3'&&
   x.recaptures.some(r=>r.uci==='b2a3')));
assertExchangeFixture('07-white-e4',facts=>
 facts.captureOptions.some(x=>x.uci==='f6e4'&&x.recaptures.some(r=>r.uci==='c3e4'))&&
 facts.captureOptions.some(x=>x.uci==='d5e4'&&x.recaptures.some(r=>r.uci==='c3e4')));
assertExchangeFixture('12-black-bishop-takes-c3',facts=>
 facts.captured?.piece==='knight'&&
 facts.captureOptions.some(x=>x.uci==='b2c3'&&x.capturedPiece==='bishop'));
assertExchangeFixture('13-white-b-pawn-takes-c3',facts=>
 facts.captured?.piece==='bishop'&&
 facts.completedExchange?.sameSquareRecapture===true&&
 facts.completedExchange?.equalValuePieces===true&&
 facts.completedExchange?.previousCapture?.piece==='knight');

// Genuine engine evaluations are obtained from the included Stockfish WASM,
// not hard-coded or derived from legal capture geometry. Validate every PV
// move through the production legal generator before showing it to GPT.
function legalEngineAnalysis(board,raw){
 let position=board;
 const pv=[];
 for(const uci of raw.pv.slice(0,8)){
  const m=chess.legal(position).find(x=>chess.key(x)===uci);
  if(!m)throw Error('Stockfish provided an illegal PV move '+uci);
  pv.push(uci);position=chess.apply(position,m);
 }
 if(!pv.length||pv[0]!==raw.bestmove)
  throw Error('Stockfish bestmove and PV disagree');
 const factor=board.t===1?1:-1;
 const evaluation=raw.scoreType==='cp'?Number((factor*raw.score/100).toFixed(2)):null;
 const mate=raw.scoreType==='mate'?factor*raw.score:null;
 const analysis={depth:raw.depth,evaluation,mate,best:raw.bestmove,
  candidates:[{rank:1,depth:raw.depth,evaluation,mate,pv}]};
 const evidence=chess.coachEngineEvidence(board,analysis);
 if(!evidence?.variations?.length||evidence.variations[0].moves[0].uci!==raw.bestmove)
  throw Error('Production engine evidence failed to represent verified PV');
 return {analysis,evidence,raw:{version:raw.version,depth:raw.depth,
  scoreType:raw.scoreType,score:raw.score,scorePerspective:'side-to-move',
  pv,bestmove:raw.bestmove}};
}
function verifyForcedLine(fixture,expected){
 let p=fixture.after;
 const line=[];
 for(const uci of expected){
  const choices=chess.legal(p);
  const m=choices.find(x=>chess.key(x)===uci);
  if(!m)throw Error('Expected continuation is illegal: '+fixture.id+' '+uci);
  line.push({uci,plainEnglish:chess.coachPlainMove(p,m),side:p.t===1?'White':'Black',
   onlyLegalReply:choices.length===1,legalReplyCount:choices.length});
  p=chess.apply(p,m);
 }
 if(!chess.checked(p)||chess.legal(p).length!==0)
  throw Error('Expected continuation does not actually end in checkmate: '+fixture.id);
 return {moves:line,endsInCheckmate:true,endingSideToMove:p.t===1?'White':'Black',
  explanation:'Every move was checked using production legal chess rules and ends in checkmate. Only a reply whose legalReplyCount is 1 is logically forced; otherwise this is one checkmating line, not proof of forced mate.'};
}
if(useStockfish){
 const targets=fixed.filter(x=>x.id.startsWith('29-')||x.id.startsWith('30-'));
 let sf=null;
 try{
  if(targets.length)sf=await startStockfish(root);
  for(const fixture of targets){
   const item=review.cases.find(x=>x.id===fixture.id);
   const verifiedLine=verifyForcedLine(fixture,item.engineExpectedLine);
   const before=legalEngineAnalysis(fixture.before,await sf.analyze(fixture.payload.beforeFen,stockfishDepth));
   const after=legalEngineAnalysis(fixture.after,await sf.analyze(fixture.payload.afterFen,stockfishDepth));
   if(!after.analysis.mate||Math.sign(after.analysis.mate)!==(item.engineExpectedMateFor==='White'?1:-1))
    throw Error('Stockfish did not confirm a winning mate for '+item.engineExpectedMateFor+' in '+fixture.id);
   const expectedFirst=item.engineExpectedLine[0];
   if(after.raw.bestmove!==expectedFirst)
    throw Error('Stockfish did not select expected forcing reply '+expectedFirst+' for '+fixture.id+'; got '+after.raw.bestmove);
   if(!item.engineExpectedLine.every((move,i)=>after.raw.pv[i]===move))
    throw Error('Stockfish PV did not confirm checkmating continuation in '+fixture.id);
   if(item.engineMustBeForced&&verifiedLine.moves.some(x=>x.side!==item.engineExpectedMateFor&&x.legalReplyCount!==1))
    throw Error('Checkmate line has a non-forced defender move in '+fixture.id);
   const side=fixture.before.t;
   const change=before.analysis.evaluation!==null&&after.analysis.evaluation!==null?
    Math.round(100*(after.analysis.evaluation-before.analysis.evaluation)):null;
   const first=before.evidence.variations[0]?.moves[0];
   fixture.payload.engine=after.evidence;
   fixture.payload.verifiedTacticalContinuation=verifiedLine;
   fixture.payload.priorEngine=before.evidence;
   fixture.payload.moveAssessment={
    manual:true,playedIsEngineChoice:before.raw.bestmove===fixture.payload.played.uci,
    centipawnLoss:change===null?null:Math.max(0,-side*change),
    approximate:true,depth:Math.min(before.analysis.depth,after.analysis.depth),
    suggestedMove:first?.label||null,suggestedMovePlainEnglish:first?.plainEnglish||null,
    evaluationBefore:before.analysis.evaluation,evaluationAfter:after.analysis.evaluation,
    evaluationChangeCentipawns:change,
    evaluationChangeForMoverCentipawns:change===null?null:side*change,
    expectedContinuation:before.evidence.variations[0]?.moves||[]
   };
   fixture.payload.coachingGuidance.focus='tactical';
   fixture.payload.coachingGuidance.evaluationPolicy=
    'Actual Stockfish analysis is attached for before and after; mate scores are signed from White perspective. Explain proven checkmates from verified PV without inventing alternatives.';
   fixture.payload.coachingGuidance.alternativePolicy=
    'Only recommend alternatives explicitly present in the Stockfish priorEngine PV, and distinguish engine-preferred lines from forced responses.';
   fixture.payload.scripted='Engine-evaluated regression: teach the verified tactical consequence, including checks and the recorded forcing line. Do not improvise a continuation.';
   console.log('Stockfish verified '+fixture.id+': before '+before.raw.scoreType+' '+before.raw.score+
    ', after '+after.raw.scoreType+' '+after.raw.score+', best reply '+after.raw.bestmove+
    ', forced-mate line '+item.engineExpectedLine.join(' '));
   fixture.engineProvenance={engine:after.raw.version,depth:stockfishDepth,
    before:before.raw,after:after.raw,
    verifiedCheckmateLine:item.engineExpectedLine,
    verifiedDefenderForced:item.engineMustBeForced||false};
   fixture.hash=sha(fixture.payload);
  }
 }finally{sf?.stop();}
}

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
  ...(fixture.engineProvenance?{engineProvenance:fixture.engineProvenance}:{}),
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
