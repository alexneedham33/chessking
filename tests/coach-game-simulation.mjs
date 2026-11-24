#!/usr/bin/env node
// Stateful, three-game chess-coach simulation. Node 22+, no dependencies.
// Offline (engine + legality): node tests/coach-game-simulation.mjs --depth 12
// Live (paid requests): node tests/coach-game-simulation.mjs --live --game opera --limit 12
// Live requests go ONLY to an explicitly running loopback proxy; never to OpenAI directly.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {startStockfish} from './stockfish-evidence.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const argv=process.argv.slice(2);
const opt=name=>{const i=argv.indexOf(name);return i<0?undefined:argv[i+1];};
const live=argv.includes('--live'),validateOnly=argv.includes('--validate-only');
const exportBenchmark=argv.includes('--export-benchmark');
if(exportBenchmark&&(live||validateOnly))throw Error('--export-benchmark cannot be combined with --live or --validate-only');
if(live&&validateOnly)throw Error('--live and --validate-only cannot be combined.');
const depth=Number(opt('--depth')||12);
if(!Number.isInteger(depth)||depth<10||depth>20)throw Error('--depth must be an integer from 10 to 20');
const limit=Number(opt('--limit')||8);
if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('--limit must be 1..100 coached plies per game');
const maxPly=opt('--max-ply')===undefined?Infinity:Number(opt('--max-ply'));
const startPly=Number(opt('--start-ply')||1);
if(!Number.isInteger(startPly)||startPly<1)throw Error('--start-ply must be a positive integer');
const resumePath=opt('--resume');
const resumeReport=resumePath?JSON.parse(readFileSync(resolve(process.cwd(),resumePath),'utf8')):null;
if(resumeReport&&(!Array.isArray(resumeReport.games)||resumeReport.mode!=='live'))
 throw Error('--resume needs a previous live coach-games JSON report');

if(maxPly!==Infinity&&(!Number.isInteger(maxPly)||maxPly<1))throw Error('--max-ply must be a positive integer');
const endpoint=opt('--endpoint')||'http://127.0.0.1:8000/api/coach/move';
if(live&&!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\/coach\/move$/.test(endpoint))
 throw Error('Live test requires a loopback coaching proxy, e.g. http://127.0.0.1:8000/api/coach/move');
const gameFile=JSON.parse(readFileSync(resolve(root,'tests/coach-game-lines.json'),'utf8'));
const suite=opt('--suite')||'historical';
if(!['historical','release'].includes(suite))throw Error('--suite must be historical or release');
const releaseFile=JSON.parse(readFileSync(resolve(root,'tests/coach-release-scenarios.json'),'utf8'));
const chosen=opt('--game');
const allCases=suite==='release'?releaseFile.scenarios.map(x=>({...x,scenario:true})):gameFile.games;
const games=allCases.filter(x=>!chosen||x.id===chosen);
if(exportBenchmark&&(suite!=='release'||chosen))throw Error('--export-benchmark requires the complete --suite release without --game');
if(!games.length)throw Error('Unknown game/scenario: '+chosen+'; available '+allCases.map(x=>x.id).join(', '));
const html=readFileSync(resolve(root,'index.html'),'utf8');
const lambda=readFileSync(resolve(root,'lambda-coach/index.mjs'),'utf8');
function between(t,start,end){
 const i=t.indexOf(start),j=t.indexOf(end,i+start.length);
 if(i<0||j<i)throw Error('Production code section not found: '+start);
 return t.slice(i,j);
}
const context={
 dirs:{n:[-33,-31,-18,-14,14,18,31,33],b:[-17,-15,15,17],r:[-16,-1,1,16],k:[-17,-16,-15,-1,1,15,16,17]},
 routeLine:()=>[]
};
vm.createContext(context);
vm.runInContext(
 between(html,'const on=i=>','const positionKey=')+'\n'+
 between(html,'function fenOf(s){','function engineText(')+'\n'+
 between(html,'function coachEngineEvidence(position,analysis){','// Opening context is evidence, not a rule that the learner must follow.')+'\n'+
 between(html,'function playedMoveEvidence(position,move){','async function requestUnifiedMoveCoaching')+
 '\nthis.chess={original,legal,apply,key,fenOf,checked,moveLabel,coachPlainMove,playedMoveEvidence,coachMoveTactics,coachStrategicChanges,coachTeachingPriorities,coachEngineEvidence,coachTacticalContinuation,coachBoardFacts,coachOpponentReplyThreats};',
 context,{timeout:5000}
);
const chess=context.chess;
const guards={};vm.createContext(guards);
vm.runInContext(between(lambda,'const words=text=>','async function generateCoaching(')+
 '\nthis.guards={checkExplanation,coachingBudget};',guards,{timeout:3000});
function scenarioPositionFromFen(fen){
 const f=String(fen).split(' '),rows=f[0]?.split('/');
 if(f.length!==6||rows.length!==8||!['w','b'].includes(f[1])||
    !/^(?:-|[KQkq]{1,4})$/.test(f[2])||
    !/^(?:-|[a-h][36])$/.test(f[3])||
    !/^\d+$/.test(f[4])||!/^\d+$/.test(f[5])||Number(f[5])<1)
  throw Error('Invalid scenario FEN');
 const board=Array(128).fill('.');
 for(let r=0;r<8;r++){
  let col=0;
  for(const p of rows[r]){
   if(/[1-8]/.test(p))col+=Number(p);
   else if(/[pnbrqkPNBRQK]/.test(p)){
    if(col>=8)throw Error('Invalid scenario rank');
    board[r*16+col++]=p;
   }else throw Error('Invalid scenario FEN symbol');
  }
  if(col!==8)throw Error('Invalid scenario rank width');
 }
 if(board.filter(x=>x==='K').length!==1||board.filter(x=>x==='k').length!==1)
  throw Error('Scenario needs exactly two kings');
 const square=x=>(8-Number(x[1]))*16+'abcdefgh'.indexOf(x[0]);
 const c=[['K',1],['Q',2],['k',4],['q',8]].reduce((n,[ch,flag])=>n+(f[2].includes(ch)?flag:0),0);
 return {b:board,t:f[1]==='w'?1:-1,c,ep:f[3]==='-'?-1:square(f[3]),
  half:Number(f[4]),full:Number(f[5]),i:0};
}
// Verify the screenshot's post-Guided queen move and the actual legal
// bishop-check / pawn-capture reply in the production move generator.
function assertLooseBishopCheckGuard(){
 const fen='rnb1kb1r/1p2qppp/p3pn2/2p5/2BP4/2N1PN2/PP2QPPP/R1B1K2R w KQkq - 1 8';
 const after=scenarioPositionFromFen(fen);
 const bishop=chess.legal(after).find(x=>chess.key(x)==='c4b5');
 if(!bishop||!chess.checked(chess.apply(after,bishop)))
  throw Error('Queen e7 screenshot: bishop to b5 must be legal check');
 const checkPosition=chess.apply(after,bishop);
 if(!chess.legal(checkPosition).some(x=>chess.key(x)==='a6b5'))
  throw Error('Queen e7 screenshot: pawn a6 must legally capture bishop on b5');
 const before=scenarioPositionFromFen('rnbqkb1r/1p3ppp/p3pn2/2p5/2BP4/2N1PN2/PP2QPPP/R1B1K2R b KQkq - 0 7');
 const queen=chess.legal(before).find(x=>chess.key(x)==='d8e7');
 if(!queen||chess.fenOf(chess.apply(before,queen)).split(' ')[0]!==fen.split(' ')[0])
  throw Error('Queen e7 screenshot: setup move not legal or mismatched');
 const facts=chess.coachMoveTactics(before,queen);
 const reply=facts.opponentCheckingReplyEvidence.find(x=>x.uci==='c4b5');
 if(!reply?.pawnCapturesChecker?.some(x=>x.uci==='a6b5'))
  throw Error('Queen e7 screenshot: chess evidence missing pawn recapture');
 const payload={
  afterFen:fen,
  player:'Black',mover:'Black',played:{side:'Black',from:'d8',to:'e7',piece:'q'},
  tacticalFacts:facts,
  openingContext:{source:'selected-guided',phase:'free-play-after-guided-opening'}
 };
 const bad='Moving the queen to e7 is playable, but it lets White answer with bishop to b5 and check the king.';
 const issues=guards.guards.checkExplanation(bad,payload,guards.guards.coachingBudget(payload));
 if(!issues.some(x=>x.includes('Checking-piece safety')))
  throw Error('Queen e7 screenshot: loose checking recommendation not rejected');
 const good='Black develops the queen toward the centre, but should consider the pressure White can apply to its kingside.';
 if(issues.length===0||guards.guards.checkExplanation(good,payload,guards.guards.coachingBudget(payload))
  .some(x=>x.includes('Checking-piece safety')))
  throw Error('Queen e7 screenshot: loose-check guard misclassifies explanation');
 console.log('Verified queen e7 post-Guided bishop check: c4b5+ is met by legal a6b5; misleading recommendation rejected.');
}
assertLooseBishopCheckGuard();
// Confirm potential future threats are found even when not in Stockfish's
// recommended continuation. These are tactical hazards, not forced losses.
function verifyOpponentReplyThreatScan(){
 const cases=[
  {
   name:'queen on d7 exposed to a bishop pin on b5',
   fen:'rnb1kb1r/pp1q1p1p/4pnp1/2p5/2BP4/2N1PN2/PP2QPPP/R1B1K2R w KQkq - 2 8',
   move:'c4b5',kind:'pin',
   matches:x=>x.newAbsolutePins.some(p=>p.pinnedPiece==='queen'&&p.pinnedSquare==='d7'&&p.kingSquare==='e8')
  },
  {
   name:'knight creates a queen/rook fork',
   fen:'3q1r1k/8/8/8/3N4/8/8/K7 w - - 0 1',
   move:'d4e6',kind:'fork',
   matches:x=>x.forkTargets.some(t=>t.piece==='queen'&&t.square==='d8')&&
     x.forkTargets.some(t=>t.piece==='rook'&&t.square==='f8')
  },
  {
   name:'bishop move uncovers rook attack on queen',
   fen:'q6k/8/8/8/B7/8/8/R3K3 w - - 0 1',
   move:'a4b5',kind:'discovery',
   matches:x=>x.discoveredAttacks.some(d=>d.attacker==='rook'&&d.target==='queen'&&d.targetSquare==='a8')
  }
 ];
 for(const sample of cases){
  const board=scenarioPositionFromFen(sample.fen);
  if(!chess.legal(board).some(m=>chess.key(m)===sample.move))
   throw Error('Reply threat sample is illegal: '+sample.name);
  const threats=chess.coachOpponentReplyThreats(board,{
    variations:[{rank:1,moves:[{uci:'not-a-real-engine-move'}]}]
  });
  const found=threats.candidates.find(x=>x.uci===sample.move);
  if(!found||!sample.matches(found)||found.status!=='legal-next-move-threat-candidate'||
    found.stockfishFirstReply)
   throw Error('Missing or misclassified '+sample.kind+' reply threat: '+sample.name);
 }
 console.log('Verified opponent reply threat scan: queen pins, knight forks and discovered attacks even off the engine PV.');
}
verifyOpponentReplyThreatScan();
function verifyGame(game){
 if(!game.scenario&&(!Array.isArray(game.moves)||game.moves.length<30))
  throw Error('Historical game too short: '+game.id);
 let board=game.startFen?scenarioPositionFromFen(game.startFen):chess.original();
 const states=[],history=[];
 const play=(uci,record)=>{
  const m=chess.legal(board).find(x=>chess.key(x)===uci);
  if(!m)throw Error('Illegal move in '+game.id+' at '+(history.length+1)+': '+uci);
  const after=chess.apply(board,m),label=chess.moveLabel(board,m);
  if(record)states.push({before:board,after,move:m,uci,label});
  history.push(label);board=after;
 };
 if(game.sourceGame){
  const source=gameFile.games.find(x=>x.id===game.sourceGame);
  if(!source||!Number.isInteger(game.startPly)||!Number.isInteger(game.endPly)||
     game.startPly<1||game.endPly>source.moves.length||game.endPly<game.startPly)
   throw Error('Invalid historical segment '+game.id);
  for(let i=0;i<game.endPly;i++)play(source.moves[i],i+1>=game.startPly);
 }else{
  for(const uci of game.setupMoves||[])play(uci,false);
  for(const uci of game.moves||[])play(uci,true);
 }
 if(!states.length)throw Error('No coached moves for '+game.id);
 if(!game.scenario&&(!chess.checked(board)||chess.legal(board).length))
  throw Error('Historical complete game is not checkmate: '+game.id);
 game.prefixLabels=history.slice(0,history.length-states.length);
 return states;
}
const prepared=games.map(game=>({game,states:verifyGame(game)}));
for(const {game,states} of prepared)
 console.log(game.scenario?
  'Verified release scenario '+game.id+': '+states.length+' legal coached plies; '+
  game.prefixLabels.length+' setup plies; final position '+chess.fenOf(states.at(-1).after):
  'Verified complete game '+game.id+': '+states.length+' plies / '+
  Math.ceil(states.length/2)+' numbered moves; final position checkmate.');
if(validateOnly)process.exit(0);

function analyze(board,raw){
 let p=board,checkedPv=[];
 for(const uci of raw.pv.slice(0,8)){
  const m=chess.legal(p).find(x=>chess.key(x)===uci);
  if(!m)throw Error('Stockfish PV contains illegal move '+uci);
  checkedPv.push(uci);p=chess.apply(p,m);
 }
 if(!checkedPv.length||checkedPv[0]!==raw.bestmove)
  throw Error('Stockfish best move does not match the PV');
 const color=board.t;
 const ev=raw.scoreType==='cp'?Number((color*raw.score/100).toFixed(2)):null;
 const mate=raw.scoreType==='mate'?color*raw.score:null;
 const analysis={depth:raw.depth,evaluation:ev,mate,
  candidates:[{rank:1,pv:checkedPv,evaluation:ev,mate,depth:raw.depth}]};
 return {raw:{engine:raw.version,depth:raw.depth,scoreType:raw.scoreType,score:raw.score,
   scorePerspective:'side-to-move',bestmove:raw.bestmove,pv:checkedPv},
  analysis,evidence:chess.coachEngineEvidence(board,analysis)};
}
const commonWords=new Set(['the','and','for','your','that','this','from','with','after','piece','move','moves',
 'white','black','can','will','you','now','then','also','its','into','only','which','because','have',
 'pawn','knight','bishop','rook','queen','king','theirs','they','their','opening','allows','helps']);
const concepts=text=>new Set((text.toLowerCase().match(/[a-z]{4,}/g)||[])
 .filter(x=>!commonWords.has(x)));
function similarity(a,b){
 const x=concepts(a),y=concepts(b);
 if(!x.size||!y.size)return 0;
 const shared=[...x].filter(w=>y.has(w)).length;
 return Number((shared/new Set([...x,...y]).size).toFixed(3));
}
function payloadFor(entry,previous,pre,post,labels,recent,game){
 const {before,after,move}=entry;
 const tacticalFacts=chess.coachMoveTactics(before,move,previous?.before||null,previous?.move||null);
 const strategicFacts=chess.coachStrategicChanges(before,after);
 const delta=Number.isFinite(pre.analysis.evaluation)&&Number.isFinite(post.analysis.evaluation)
  ?Math.round(100*(post.analysis.evaluation-pre.analysis.evaluation)):null;
 const loss=delta===null?null:Math.max(0,-before.t*delta);
 const mover=before.t===1?'White':'Black';
 const critical=loss!==null&&loss>=120;
 return {
  beforeFen:chess.fenOf(before),afterFen:chess.fenOf(after),
  opening:'Unrecognised',openingContext:{source:'unrecognised',name:null},
  player:'White',mover,isOpponentMove:mover==='Black',
  played:chess.playedMoveEvidence(before,move),
  playedPlainEnglish:chess.coachPlainMove(before,move),
  boardFacts:{before:chess.coachBoardFacts(before),after:chess.coachBoardFacts(after)},
  tacticalFacts,strategicFacts,
  teachingPriorities:chess.coachTeachingPriorities(before,move,after,strategicFacts,tacticalFacts),
  engine:post.evidence,priorEngine:pre.evidence,
  tacticalContinuation:chess.coachTacticalContinuation(after,post.evidence),
  moveAssessment:{
   manual:true,playedIsEngineChoice:pre.raw.bestmove===entry.uci,
   centipawnLoss:loss,approximate:true,depth:Math.min(pre.raw.depth,post.raw.depth),
   evaluationBefore:pre.analysis.evaluation,evaluationAfter:post.analysis.evaluation,
   evaluationChangeCentipawns:delta,evaluationChangeForMoverCentipawns:delta===null?null:before.t*delta,
   expectedContinuation:pre.evidence?.variations?.[0]?.moves||[],
   suggestedMove:null,suggestedMovePlainEnglish:null
  },
  alternativeEvidence:null,positionAssessment:null,
  coachingLevel:{opponentElo:1500,explanationStyle:'intermediate'},
  coachingGuidance:{
   perspective:mover==='White'?'learner':'opponent',moverColour:mover,playerColour:'White',
   focus:critical?'turning-point':tacticalFacts.givesCheck?'tactical':'strategic',
   explainAlternatives:false,
   alternativePolicy:'No alternativeEvidence supplied; do not recommend a specific alternative or describe an unverified opponent reply.',
   evaluationPolicy:'Actual same-depth Stockfish before/after scores supplied. Explain concrete tactical outcomes only from legally checked PV and board facts; a variation is not proof of forced replies.',
   languagePolicy:'Coach White as the learner; explain Black moves as opponent actions. Preserve teaching continuity and avoid repeating earlier explanations.'
  },
  history:labels.slice(-10),recentCoaching:recent.slice(-3),
  scripted:'Complete-game coaching simulation: explain this move accurately and concisely, using the current position, legal Stockfish evidence and earlier coaching messages. This is a recreated historical example, not a claim about the user\'s actual game.',
  detail:'adaptive'
 };
}
const benchmarkFixtures=[];
const benchmarkIndices={positional:[1,2,3,4,5],tactical:[1,3,5,9,11],endgame:[1,2,3,5,7]};
const report={version:1,createdAt:new Date().toISOString(),suite,
 mode:live?'live':'offline',engineDepth:depth,limitPerGame:live?limit:null,startPly,
 resumeSource:resumePath||null,
 note:suite==='release'?'Three distinct legally replayed test scenarios (NOT three complete historical games). Live requests capped by --limit per scenario.':'A complete-game chess simulation uses all plies and real engine analysis. Live calls are deliberately capped by --limit per game. These are illustrative historical sequences, not user game records.',
 games:[],summary:{}};
let sf;const cache=new Map();
try{
 sf=await startStockfish(root);
 const get=async board=>{
  const fen=chess.fenOf(board),k=depth+':'+fen;
  if(!cache.has(k))cache.set(k,analyze(board,await sf.analyze(fen,depth)));
  return cache.get(k);
 };
 for(const {game,states} of prepared){
  const output={id:game.id,title:game.title,attribution:game.attribution,focus:game.focus,scenario:!!game.scenario,
   totalPlies:states.length,terminal:chess.checked(states.at(-1).after)&&chess.legal(states.at(-1).after).length===0?'checkmate':'ongoing',entries:[]};
  const labels=[...(game.prefixLabels||[])],recent=[],responses=[];
  let backendUnavailable=false;
  const resumed=resumeReport?.games.find(x=>x.id===game.id);
  if(resumeReport&&!resumed)throw Error('Resume report does not contain selected game '+game.id);
  if(resumed&&resumed.totalPlies!==states.length)
   throw Error('Resume report refers to a different game length: '+game.id);
  // Validate every prior state against the exact move and FEN before reuse.
  const priorMessages=new Map();
  for(const p of resumed?.entries||[]){
   if(!p.response)continue;
   const state=states[p.ply-1];
   if(!state||p.move!==state.uci||p.beforeFen!==chess.fenOf(state.before)||
       p.afterFen!==chess.fenOf(state.after))
    throw Error('Resume report differs from current chess sequence at '+game.id+' ply '+p.ply);
   if(typeof p.response!=='string'||p.response.length>900)
    throw Error('Invalid prior response length at ply '+p.ply);
   priorMessages.set(p.ply,p.response);
  }
  // Do not fabricate earlier coaching context when --start-ply skips history.
  if(startPly>1&&!resumeReport)
   console.warn('Starting at ply '+startPly+' without --resume: the AI will have move history but no earlier coach messages.');

  let errors=0,warnings=0;
  const count=Math.min(states.length,maxPly);
  for(let j=0;j<count;j++){
   const entry=states[j],pre=await get(entry.before);
   // Stockfish has no bestmove/PV from a terminal checkmate position. The
   // production legal generator already proves mate, so don't demand a PV.
   const terminal=chess.legal(entry.after).length===0;
   const post=terminal?{
    raw:{engine:pre.raw.engine,depth,scoreType:'terminal-checkmate',score:null,
     scorePerspective:'side-to-move',bestmove:null,pv:[]},
    analysis:{evaluation:null,mate:entry.before.t===1?1:-1},
    evidence:null
   }:await get(entry.after);
   labels.push(entry.label);
   if(j+1<startPly&&priorMessages.has(j+1)){
    recent.push(priorMessages.get(j+1));
    responses.push({ply:j+1,message:priorMessages.get(j+1)});
   }
   const payload=payloadFor(entry,states[j-1],pre,post,labels,recent,game);
   // Regression: in the real 12.h4 Immortal position, 12...Qxh4
   // 13.Nxh4 is a verified queen capture by a knight, not a queen trade.
   if(game.id==='immortal'&&j+1===23){
    const options=payload.tacticalFacts.exchangeEvidence.captureOptions;
    const queenCapture=options.find(x=>x.uci==='g5h4');
    const knightRecapture=queenCapture?.recaptures?.find(x=>x.uci==='f5h4');
    if(queenCapture?.capturedPiece!=='pawn'||queenCapture?.capturedValue!==1||
       knightRecapture?.withPiece!=='knight'||
       knightRecapture?.capturedPiece!=='queen'||
       knightRecapture?.capturedValue!==9||
       knightRecapture?.replySideNetLoss!==8||
       knightRecapture?.queenForQueen!==false)
     throw Error('Invalid verified Immortal 12.h4 queen-capture material accounting');
   }

   // Ground the two observed Immortal failures in the actual production
   // chess board and the real Lambda validator, not invented stub evidence.
   if(game.id==='immortal'&&j+1===37){
    const flawed='Pushing the pawn to e5 does hit the bishop on d6.';
    if(!payload.tacticalFacts.friendlyPiecesDefendedByMovedPiece.some(x=>
      x.piece==='bishop'&&x.square==='d6')||
      !guards.guards.checkExplanation(flawed,payload,
       guards.guards.coachingBudget(payload)).some(x=>x.startsWith('Friendly target')))
     throw Error('19.e5 friendly bishop validation regression');
   }
   if(game.id==='immortal'&&j+1===40){
    const flawed='The knight eyes c7 and b4, so watch the checking jump to c7.';
    if(payload.tacticalFacts.movedPiecePotentialChecks.some(x=>x.to==='c7')||
      !guards.guards.checkExplanation(flawed,payload,
       guards.guards.coachingBudget(payload)).some(x=>x.startsWith('Hypothetical check')))
     throw Error('20...Na6 checking jump validation regression');
   }

   if(exportBenchmark&&benchmarkIndices[game.id]?.includes(j+1)){
    // Identical chess evidence and history for all compared model variants.
    // No model sees explanations produced by a different model.
    benchmarkFixtures.push({id:game.id+':'+(j+1),scenario:game.id,
     ply:j+1,label:entry.label,beforeFen:payload.beforeFen,afterFen:payload.afterFen,
     payload:{...payload,recentCoaching:[]}});
   }
   const payloadBytes=Buffer.byteLength(JSON.stringify(payload),'utf8');
   // AWS Lambda rejects a coaching request body over 30,000 characters.
   // Validate the same practical limit before issuing any paid requests.
   if(payloadBytes>30000)throw Error('Coach payload exceeds AWS 30KB request limit at '+
    game.id+' ply '+(j+1)+': '+payloadBytes+' bytes');
   const current={ply:j+1,moveNumber:entry.before.full,mover:payload.mover,
    move:entry.uci,label:entry.label,beforeFen:payload.beforeFen,afterFen:payload.afterFen,
    payloadBytes,
    phase:game.scenario?(game.id==='endgame'?'endgame':game.id==='positional'?'positional':'tactical-middlegame'):j<12?'opening':j<26?'development-to-middlegame':'middlegame-or-finish',
    engine:{before:pre.raw,after:post.raw,centipawnLoss:payload.moveAssessment.centipawnLoss,
     isEngineChoice:payload.moveAssessment.playedIsEngineChoice},
    previousCoaching:recent.slice(-3),response:null,responseTimeMs:null,
    objectiveWarnings:[],repetitionFlags:[],validation:null,error:null,attempted:false,
    humanReview:{accuracy:null,teaching:null,repetition:null,clarity:null,majorFactualError:null,notes:''}};
   if(live&&!backendUnavailable&&j+1>=startPly&&j+1<startPly+limit){
    current.attempted=true;
    const started=Date.now();
    try{
     const reply=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
     const body=await reply.json();
     current.validation=body.validation||null;
     if(!reply.ok||typeof body.message!=='string'){
      const reason=String(body.error||body.message||'No error details').slice(0,180);
      throw Error('HTTP '+reply.status+': '+reason+
       (body.validation?.finalCodes?.length?' ['+body.validation.finalCodes.join(', ')+']':''));
     }

     current.response=body.message.trim();current.responseTimeMs=Date.now()-started;
     current.objectiveWarnings=Array.from(guards.guards.checkExplanation(current.response,payload,
      guards.guards.coachingBudget(payload)));
     current.repetitionFlags=responses.slice(-5).map(prior=>({
      priorPly:prior.ply,similarity:similarity(current.response,prior.message)
     })).filter(x=>x.similarity>=0.56);
     recent.push(current.response);responses.push({ply:j+1,message:current.response});
     warnings+=current.objectiveWarnings.length;
    }catch(error){
     current.error=error.message;
     current.responseTimeMs=Date.now()-started;
     errors++;
     // Server-side failures are not chess-quality feedback. Halt this game's
     // paid requests instead of repeatedly calling an unhealthy backend.
     if(/^(?:HTTP 5\d\d|fetch failed|The operation was aborted)/i.test(current.error))
      backendUnavailable=true;
    }
   }
   output.entries.push(current);
   if(backendUnavailable&&current.error){
    console.error('Aborted live calls for '+game.id+' after '+current.error+
     '; remaining plies will not trigger more API requests.');
    // Preserve complete offline analysis of the remaining game plies,
    // but report the failure only once and make no further paid requests.
   }
  }
  output.summary={analyzedPlies:count,liveAttempted:output.entries.filter(x=>x.attempted).length,
   liveCompleted:output.entries.filter(x=>x.response).length,errors,warnings,
   repaired:output.entries.filter(x=>x.validation?.repairAttempted===true).length,
   verifiedFallbacks:output.entries.filter(x=>x.validation?.status==='fallback').length,
   failedValidation:output.entries.filter(x=>x.validation?.status==='failed').length,
   repetitionFlags:output.entries.reduce((n,x)=>n+x.repetitionFlags.length,0),
   meanResponseMs:output.entries.some(x=>x.responseTimeMs!==null)?
    Math.round(output.entries.reduce((n,x)=>n+(x.responseTimeMs||0),0)/
     output.entries.filter(x=>x.responseTimeMs!==null).length):null};
  report.games.push(output);
  console.log('Game '+game.id+': '+count+'/'+states.length+' plies analyzed; '+
   output.summary.liveCompleted+' live coach responses; '+errors+' errors; '+
   warnings+' validation warnings; '+output.summary.repetitionFlags+' repetition candidates.');
 }
}finally{sf?.stop();}
report.summary={
 gameCount:report.games.length,
 totalGamePlies:report.games.reduce((n,g)=>n+g.totalPlies,0),
 analyzedPlies:report.games.reduce((n,g)=>n+g.summary.analyzedPlies,0),
 liveAttempted:report.games.reduce((n,g)=>n+g.summary.liveAttempted,0),
 liveCompleted:report.games.reduce((n,g)=>n+g.summary.liveCompleted,0),
 errors:report.games.reduce((n,g)=>n+g.summary.errors,0),
 repaired:report.games.reduce((n,g)=>n+g.summary.repaired,0),
 verifiedFallbacks:report.games.reduce((n,g)=>n+g.summary.verifiedFallbacks,0),
 failedValidation:report.games.reduce((n,g)=>n+g.summary.failedValidation,0),
 warnings:report.games.reduce((n,g)=>n+g.summary.warnings,0),
 repetitionCandidates:report.games.reduce((n,g)=>n+g.summary.repetitionFlags,0),
 reviewStatus:'Human quality scores not yet assigned'
};
mkdirSync(resolve(root,'tests/reports'),{recursive:true});
if(exportBenchmark){
 if(benchmarkFixtures.length!==15||
    Object.keys(benchmarkIndices).some(id=>benchmarkFixtures.filter(x=>x.scenario===id).length!==5))
  throw Error('Benchmark fixtures must contain five positions per scenario');
 const fixturePath=resolve(root,'tests/reports/coach-model-benchmark-fixtures.json');
 writeFileSync(fixturePath,JSON.stringify({
  version:1,suite:'model-benchmark',engineDepth:depth,createdAt:new Date().toISOString(),
  controls:{sameChessEvidence:true,sameCoachingInstructions:true,independentContext:true,
   promptIncludesHistory:true,promptIncludesOtherModelMessages:false},
  fixtures:benchmarkFixtures
 },null,2)+'\n');
 console.log('Wrote 15 controlled benchmark positions: '+fixturePath);
}
mkdirSync(resolve(root,'tests/reports'),{recursive:true});
const filename='coach-games-'+(live?'live-':'offline-')+
 new Date().toISOString().replace(/[:.]/g,'-')+'.json';
const outputPath=resolve(root,'tests/reports',filename);
writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
console.log('Complete-game coach simulation: '+JSON.stringify(report.summary,null,2));
console.log('Saved '+outputPath);
if(report.summary.errors)process.exitCode=1;
