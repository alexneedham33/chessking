// Run: node --test tests/coach-regression.mjs
// Deterministic mechanics regression; no OpenAI calls or secrets required.
// Extract the actual browser implementation so tests fail if production logic changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const html=readFileSync(resolve(root,'index.html'),'utf8');
const from=html.indexOf('function coachCentralFiles(position){');
const to=html.indexOf('// Verify an engine-suggested move against the board BEFORE explaining it.',from);
assert.ok(from>=0&&to>from,'Strategic analyzer is present in index.html');
const on=i=>i>=0&&i<128&&!(i&0x88);
const side=p=>!p||p==='.'?0:p===p.toUpperCase()?1:-1;
const sq=i=>'abcdefgh'[i&7]+(8-(i>>4));
const dirs={k:[-17,-16,-15,-1,1,15,16,17]};
const coachPieceNames={p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'};
const context={on,side,sq,dirs,coachPieceNames};
vm.runInNewContext(html.slice(from,to)+
 '\nthis.analyze={coachCentralFiles,coachStrategicSnapshot,coachStrategicChanges,coachTeachingPriorities};',context);
const {coachStrategicSnapshot:snapshot,coachStrategicChanges:changes,coachTeachingPriorities:priorities}=context.analyze;

function pos(pieces={}){
 const b=Array(128).fill('.');
 for(const [square,piece] of Object.entries({e1:'K',e8:'k',...pieces})){
  const f='abcdefgh'.indexOf(square[0]),rank=Number(square[1]);
  assert.ok(f>=0&&rank>=1&&rank<=8);
  b[(8-rank)*16+f]=piece;
 }
 return {b};
}
const check=(name,pieces,path,expected)=>{
 test(name,()=>{
  let value=snapshot(pos(pieces));
  for(const part of path)value=value[part];
  assert.equal(value,expected);
 });
};
// Central files: state is geometric, not an engine verdict.
check('01 starting empty central files',{},['centralFiles','d','state'],'open');
check('02 e file open with no pawns',{},['centralFiles','e','state'],'open');
check('03 adjacent d4 and d5 pawns block the d-file',{d4:'P',d5:'p'},['centralFiles','d','state'],'blocked');
check('04 adjacent e4 and e5 pawns block the e-file',{e4:'P',e5:'p'},['centralFiles','e','state'],'blocked');
check('05 nonadjacent opposing d pawns are not labelled blocked',{d3:'P',d6:'p'},['centralFiles','d','state'],'both-sides-occupied');
check('06 White pawn makes d half-open',{d4:'P'},['centralFiles','d','state'],'half-open');
check('07 Black pawn makes d half-open',{d5:'p'},['centralFiles','d','state'],'half-open');
check('08 White pawn makes e half-open',{e4:'P'},['centralFiles','e','state'],'half-open');
check('09 Black pawn makes e half-open',{e5:'p'},['centralFiles','e','state'],'half-open');
check('10 blocked d pair reports blocked flag',{d4:'P',d5:'p'},['centralFiles','d','directlyBlocked'],true);
check('11 separated pawns do not report blocked flag',{d3:'P',d6:'p'},['centralFiles','d','directlyBlocked'],false);
test('12 doubled c pawns exist',()=>assert.equal(snapshot(pos({c2:'P',c3:'P'})).pawns.White.doubled.length,1));
// Additional tests use explicit array predicates to avoid cross-realm object identity issues.
test('13 double c pawns are identified',()=>assert.equal(snapshot(pos({c2:'P',c3:'P'})).pawns.White.doubled[0].file,'c'));
test('14 double d pawns are identified',()=>assert.equal(snapshot(pos({d4:'P',d5:'P'})).pawns.White.doubled[0].file,'d'));
test('15 solitary a pawn is isolated',()=>assert.ok(snapshot(pos({a3:'P',c2:'P'})).pawns.White.isolated.includes('a3')));
test('16 adjacent b pawn prevents a isolation',()=>assert.ok(!snapshot(pos({a3:'P',b2:'P'})).pawns.White.isolated.includes('a3')));
test('17 middle c pawn is isolated with no b or d pawns',()=>assert.ok(snapshot(pos({c4:'P',e4:'P'})).pawns.White.isolated.includes('c4')));
test('18 bishop pair recognised',()=>assert.equal(snapshot(pos({c1:'B',f1:'B'})).bishops.White.hasPair,true));
test('19 single bishop is not a pair',()=>assert.equal(snapshot(pos({c1:'B'})).bishops.White.hasPair,false));
test('20 bishop pin b4-c3-e1 recognised',()=>assert.ok(snapshot(pos({c3:'N',b4:'b'})).pins.some(x=>x.pinnedSquare==='c3'&&x.pinnerSquare==='b4')));
test('21 bishop pin a5-c3-e1 recognised',()=>assert.ok(snapshot(pos({c3:'N',a5:'b'})).pins.some(x=>x.pinnedSquare==='c3'&&x.pinnerSquare==='a5')));
test('22 intervening friendly bishop on d2 ends pin',()=>assert.ok(!snapshot(pos({c3:'N',d2:'B',b4:'b'})).pins.some(x=>x.pinnedSquare==='c3')));
test('23 rook e8-e3-e1 file pin recognised',()=>assert.ok(snapshot(pos({e8:'r',e3:'N',e1:'K',a8:'k'})).pins.some(x=>x.pinnedSquare==='e3')));
test('24 non-slider knight cannot cause absolute pin',()=>assert.equal(snapshot(pos({c3:'N',b4:'n'})).pins.length,0));
const delta=(before,after)=>changes(pos(before),pos(after)).changes;
test('25 recapture creates doubled c pawns',()=>assert.ok(delta({b2:'P',c2:'P'},{c2:'P',c3:'P'}).some(x=>x.type==='doubled-pawns-created'&&x.file==='c')));
test('26 central pawn exchange creates doubled d pawns',()=>assert.ok(delta({d4:'P',e4:'P'},{d4:'P',d5:'P'}).some(x=>x.type==='doubled-pawns-created'&&x.file==='d')));
test('27 removing advanced d pawn removes doubled structure',()=>assert.ok(delta({d4:'P',d5:'P'},{d4:'P',d5:'p'}).some(x=>x.type==='doubled-pawns-removed'&&x.file==='d')));
test('28 a pawn becomes isolated when b pawn leaves',()=>assert.ok(delta({a3:'P',b2:'P'},{a3:'P',c3:'P'}).some(x=>x.type==='isolated-pawn-created'&&x.square==='a3')));
test('29 Black bishop loss changes pair status',()=>assert.ok(delta({c8:'b',f8:'b'},{c8:'b'}).some(x=>x.type==='bishop-pair-lost'&&x.side==='Black')));
test('30 existing bishop pair is not a new event',()=>assert.ok(!delta({c1:'B',f1:'B'},{c1:'B',f1:'B',d4:'P'}).some(x=>x.type.startsWith('bishop-pair'))));
test('31 new pin recorded',()=>assert.ok(delta({c3:'N'},{c3:'N',b4:'b'}).some(x=>x.type==='pin-created')));
test('32 pin removal recorded',()=>assert.ok(delta({c3:'N',b4:'b'},{c3:'N',a6:'b'}).some(x=>x.type==='pin-ended')));
test('33 unchanged blocked centre is not newly open',()=>{const d=changes(pos({d4:'P',d5:'p'}),pos({d4:'P',d5:'p'}));assert.equal(d.before.centralFiles.d.state,'blocked');assert.equal(d.after.centralFiles.d.state,'blocked');});
test('34 pawn capture can turn blocked into half-open',()=>{const d=changes(pos({d4:'P',d5:'p'}),pos({d4:'P'}));assert.equal(d.before.centralFiles.d.state,'blocked');assert.equal(d.after.centralFiles.d.state,'half-open');});
test('35 no pawns after exchange makes file open',()=>assert.equal(snapshot(pos({})).centralFiles.d.state,'open'));
test('36 teaching candidates prefer verified attacks',()=>{
 const before=pos({c3:'N',b4:'b'}),after=pos({c3:'N',a3:'P',b4:'b'});
 const strategic=changes(before,after);
 const facts={givesCheck:false,enemyPiecesAttackedByMovedPiece:[{piece:'bishop',square:'b4'}],legalImmediateCapturesOfMovedPiece:[]};
 const p=priorities(before,[0,0,'',''],after,strategic,facts);
 assert.equal(p.candidates[0].type,'direct-attack');
});

// Bishop lines must be verified on the actual position, not guessed from pawn moves.
test('37 e7-e6 opens the f8 bishop diagonal',()=>{
 const before=pos({f8:'b',c8:'b',e7:'p',d5:'p',e2:'P',d4:'P',g7:'p',d7:'.'});
 const after=pos({f8:'b',c8:'b',e6:'p',d5:'p',e2:'P',d4:'P',g7:'p',d7:'.',e7:'.'});
 const result=changes(before,after).bishopRoutes.changes;
 assert.ok(result.some(x=>x.bishopSquare==='f8'&&x.newlyClearSquares.includes('e7')));
 assert.ok(!result.some(x=>x.bishopSquare==='c8'&&x.newlyClearSquares.length));
});
test('38 e7-e6 does not open c8 bishop',()=>{
 const a=pos({c8:'b',f8:'b',d7:'.',e7:'p',e2:'P'});
 const b=pos({c8:'b',f8:'b',d7:'.',e6:'p',e2:'P',e7:'.'});
 const x=changes(a,b).bishopRoutes;
 assert.ok(x.after.find(y=>y.square==='c8').clearSquares.includes('d7'));
 assert.ok(!x.after.find(y=>y.square==='c8').clearSquares.includes('e6'));
 assert.ok(!x.changes.some(y=>y.bishopSquare==='c8'&&y.newlyClearSquares.length));
});
test('39 a pawn movement can block a bishop diagonal',()=>{
 const a=pos({c8:'b',d7:'.',e6:'.',e7:'p'});
 const b=pos({c8:'b',d7:'.',e6:'p',e7:'.'});
 const r=changes(a,b).bishopRoutes.changes.find(x=>x.bishopSquare==='c8');
 assert.ok(r&&r.newlyBlockedSquares.includes('e6'));
});
test('40 bishop movement itself does not fake opened route from old square',()=>{
 const a=pos({c8:'b'}),b=pos({b7:'b',c8:'.'});
 const r=changes(a,b).bishopRoutes.changes;
 assert.equal(r.length,0);
});
test('41 an unmoved bishop with identical blockers has no route change',()=>{
 const a=pos({f8:'b',e7:'p',d5:'p'}),b=pos({f8:'b',e7:'p',d5:'p',a3:'P'});
 const r=changes(a,b).bishopRoutes.changes;
 assert.equal(r.length,0);
});
test('42 bishop route evidence remains an objective set of empty squares',()=>{
 const a=pos({f8:'b',e7:'p'}),b=pos({f8:'b',e7:'.'});
 const r=changes(a,b).bishopRoutes.changes.find(x=>x.bishopSquare==='f8');
 assert.ok(r.newlyClearSquares.includes('e7'));
 assert.ok(r.newlyClearSquares.includes('d6'));
});

// Validate the same post-generation safeguards used in deployed Lambda.
const lambdaSource=readFileSync(resolve(root,'lambda-coach/index.mjs'),'utf8');
const guardStart=lambdaSource.indexOf('const words=text=>');
const guardEnd=lambdaSource.indexOf('async function generateCoaching(',guardStart);
assert.ok(guardStart>=0&&guardEnd>guardStart,'Lambda guard implementation present');
const guardContext={};vm.createContext(guardContext);
vm.runInContext(lambdaSource.slice(guardStart,guardEnd)+
 '\nthis.guard={checkExplanation,coachingBudget,unsupportedDirectClaims,verifiedRelations,unsupportedStructuralClaims,unsupportedExchangeClaims,unsupportedCheckMechanismClaims,unsupportedSevereBlunderClaims,moveQualityContext,coachPawnBoard,unsupportedPawnHistoryClaims,coachingValidationCodes,needlessEngineAttribution};',guardContext);
const bishopPositionBefore=pos({c8:'b',f8:'b',d7:'.',e7:'p',d5:'p',e2:'P',d4:'P'});
const bishopPositionAfter=pos({c8:'b',f8:'b',d7:'.',e6:'p',e7:'.',d5:'p',e2:'P',d4:'P'});
const guardInput={strategicFacts:changes(bishopPositionBefore,bishopPositionAfter),tacticalFacts:{}};
const guard=m=>Array.from(guardContext.guard.unsupportedStructuralClaims(m,guardInput));
test('43 regression: e6 falsely opens bishop on c8 is flagged',()=>{
 assert.ok(guard('Black reinforces d5 and opens the bishop on c8.').some(x=>x.includes('bishop on c8')));
});
test('44 regression: e6 genuinely opens bishop on f8 is accepted',()=>{
 assert.equal(guard('Black opens the bishop on f8.').length,0);
});
test('45 regression: false claim of blocked e-file is flagged',()=>{
 assert.ok(guard('The centre remains blocked on the e-file.').some(x=>x.includes('e-file')));
});
test('46 regression: false both central files closed is flagged',()=>{
 assert.ok(guard('Both central files are closed for now.').length>0);
});
test('47 regression: accurately blocked d-file is accepted',()=>{
 assert.equal(guard('The d-file is blocked by pawns on d4 and d5.').length,0);
});
test('48 regression: pawns on e-file are not a fully open file',()=>{
 assert.ok(guard('The e-file is open.').some(x=>x.includes('e-file')));
});
test('49 regression: not open e-file is allowed',()=>{
 assert.equal(guard('The e-file is not open.').length,0);
});
test('50 regression: bishop on c8 described as blocked is allowed when newly blocked',()=>{
 assert.equal(guard('The move blocks the bishop on c8.').length,0);
});

const exchangeGuard=(message,evidence)=>Array.from(guardContext.guard.unsupportedExchangeClaims(
 message,{tacticalFacts:{exchangeEvidence:evidence}}));
const equalExchange={captured:{piece:'bishop',value:3},captureOptions:[],
 completedExchange:{sameSquareRecapture:true,equalValuePieces:true,
  previousCapture:{piece:'knight',value:3},currentCapture:{piece:'bishop',value:3}}};
test('51 flags false free-piece win after bishop-for-knight recapture',()=>{
 assert.ok(exchangeGuard("You've won a piece but accepted doubled pawns.",equalExchange).length>0);
});
test('52 allows accurate recapture wording after equal exchange',()=>{
 assert.equal(exchangeGuard("You win back the bishop after losing your knight.",equalExchange).length,0);
});
test('53 allows neutral material language for exchange',()=>{
 assert.equal(exchangeGuard("You capture the bishop and complete the exchange.",equalExchange).length,0);
});
test('54 recapturable attack is not a free piece win',()=>{
 const evidence={captured:{piece:'knight',value:3},captureOptions:[
  {uci:'b2c3',hasLegalRecapture:true,recaptures:[{uci:'a5c3'}]}]};
 assert.ok(exchangeGuard('Black wins the knight for free.',evidence).length>0);
});
test('55 allows neutral capture statement when bishop can be recaptured',()=>{
 const evidence={captured:{piece:'knight',value:3},captureOptions:[
  {uci:'b2c3',hasLegalRecapture:true}]};
 assert.equal(exchangeGuard('The bishop captures the knight with check, and White can recapture.',evidence).length,0);
});
test('56 guards false material gain from a possible pawn capture',()=>{
 const evidence={captured:null,captureOptions:[{uci:'f6e4',hasLegalRecapture:true}]};
 assert.ok(exchangeGuard('Black wins a pawn by capturing on e4.',evidence).length>0);
});
test('57 does not flag a conditional capture with verified recapture',()=>{
 const evidence={captured:null,captureOptions:[{uci:'f6e4',hasLegalRecapture:true}]};
 assert.equal(exchangeGuard('Black can capture the e4 pawn, but White can recapture the knight.',evidence).length,0);
});

test('58 flags equal-value knight-for-bishop claim as a win',()=>{
 const evidence={captured:{piece:'knight',value:3},captureOptions:[
  {uci:'b2c3',capturedPiece:'bishop',hasLegalRecapture:true}]};
 assert.ok(exchangeGuard('Black wins the knight on c3.',evidence).length>0);
});
test('59 allows accurately describing equal-value capture with recapture',()=>{
 const evidence={captured:{piece:'knight',value:3},captureOptions:[
  {uci:'b2c3',capturedPiece:'bishop',hasLegalRecapture:true}]};
 assert.equal(exchangeGuard('Black captures the knight, but the b-pawn can recapture the bishop.',evidence).length,0);
});
test('60 flags undefended pawn when a legal recapture exists',()=>{
 const evidence={captured:null,captureOptions:[
  {uci:'f6e4',capturedPiece:'pawn',hasLegalRecapture:true}]};
 assert.ok(exchangeGuard('The e4 pawn is undefended.',evidence).length>0);
});

const mateGeometry={tacticalFacts:{opponentCheckingReplyEvidence:[{
 uci:'d8h4',checkLine:{checkmate:true,checkingPieces:[{
  piece:'queen',from:'h4',king:'e1',clearSquaresBetween:['g3','f2']
 }]}}]}};
const checkGuard=message=>Array.from(guardContext.guard.unsupportedCheckMechanismClaims(message,mateGeometry));
test('61 flags h3 pawn-cover as false causal explanation of Qh4 checkmate',()=>{
 assert.ok(checkGuard('Black has Qh4 checkmate. The danger is concrete because your g-pawn no longer covers h3, so the queen has a direct mating route.').length>0);
});
test('62 accepts correct h4-g3-f2-e1 diagonal mechanism',()=>{
 assert.equal(checkGuard('Black plays Qh4 checkmate: the queen checks along the open h4-g3-f2-e1 diagonal.').length,0);
});
test('63 does not reject true isolated h3 pawn-control observation',()=>{
 assert.equal(checkGuard('The pawn on g4 no longer controls h3.').length,0);
});
test('64 no spurious checking-line warning without a verified Qh4 mate',()=>{
 assert.equal(guardContext.guard.unsupportedCheckMechanismClaims(
  'Because the pawn no longer covers h3, Black wins.',{tacticalFacts:{}}).length,0);
});

// Derive both positive and negative pawn-defence assertions from the
// production attack-square routine, never from hand-written claimed targets.
const attackFrom=html.indexOf('function coachPieceAttackSquares(position,from){');
const attackTo=html.indexOf('// Explain the *mechanism*',attackFrom);
assert.ok(attackFrom>=0&&attackTo>attackFrom,'Production attack routine exists');
const attacksContext={on,side,dirs:{n:[-33,-31,-18,-14,14,18,31,33],
 b:[-17,-15,15,17],r:[-16,-1,1,16],k:[-17,-16,-15,-1,1,15,16,17]}};
vm.runInNewContext(html.slice(attackFrom,attackTo)+
 '\nthis.attacks=coachPieceAttackSquares;',attacksContext);
const squareIndex=square=>(8-Number(square[1]))*16+'abcdefgh'.indexOf(square[0]);
function knightRelationsAt(from,pawns){
 const b=pos({...Object.fromEntries(pawns.map(square=>[square,'P'])),[from]:'N'});
 const defended=Array.from(attacksContext.attacks(b,squareIndex(from)))
   .map(sq).filter(square=>pawns.includes(square));
 return {movedPiece:{type:'knight',to:from},
  movedPieceAttacks:Array.from(attacksContext.attacks(b,squareIndex(from))).map(sq),
  friendlyPiecesDefendedByMovedPiece:defended.map(square=>({piece:'pawn',square})),
  enemyPiecesAttackedByMovedPiece:[]};
}
const knightRelations=knightRelationsAt('f3',['d4','h2']);
const directGuard=(text,relations=knightRelations)=>Array.from(guardContext.guard.unsupportedDirectClaims(text,
 guardContext.guard.verifiedRelations({tacticalFacts:relations})));
test('65 verifies a real knight on f3 directly protects both d4 and h2',()=>{
 assert.ok(knightRelations.movedPieceAttacks.includes('d4'));
 assert.ok(knightRelations.friendlyPiecesDefendedByMovedPiece.some(x=>x.square==='d4'));
 assert.equal(directGuard('The knight directly supports your d4 pawn and your pawn on h2.').length,0);
});
test('66 catches false support for d4 by a knight actually on c3',()=>{
 const c3=knightRelationsAt('c3',['d4','e4']);
 assert.ok(!c3.movedPieceAttacks.includes('d4'));
 assert.ok(directGuard('The knight protects your pawn on d4.',c3).some(x=>x.includes('d4')));
 assert.ok(directGuard('This piece defends the white d4 pawn.',c3).some(x=>x.includes('d4')));
});
test('67 permits true direct support and general square-control language',()=>{
 assert.equal(directGuard('The knight supports your h2 pawn and protects your d4 pawn.').length,0);
 assert.equal(directGuard('The knight supports the centre and controls e5.').length,0);
});
const severeInput={engine:{variations:[{moves:[]}]},priorEngine:{variations:[{moves:[]}]},
 mover:'Black',player:'White',
 moveAssessment:{centipawnLoss:740,depth:14,playedIsEngineChoice:false,
 evaluationBefore:-2.91,evaluationAfter:4.49}};
test('68 severe engine loss cannot be described as neutral tactical sequence',()=>{
 assert.ok(guardContext.guard.unsupportedSevereBlunderClaims(
 'Black takes the rook, but the queen can be captured, so this is tactical pressure.',severeInput).length>0);
});
test('69 verified severe error can be clearly described as blunder',()=>{
 assert.equal(guardContext.guard.unsupportedSevereBlunderClaims(
 'This is a serious mistake: Black gives up the queen for a rook without enough compensation.',severeInput).length,0);
});
test('70 quiet moves and unverified scores do not trigger severity guard',()=>{
 const routine={...severeInput,moveAssessment:{centipawnLoss:22,depth:14,playedIsEngineChoice:false}};
 assert.equal(guardContext.guard.unsupportedSevereBlunderClaims('This improves king safety.',routine).length,0);
 assert.equal(guardContext.guard.unsupportedSevereBlunderClaims('This loses material.',{...severeInput,engine:null}).length,0);
});

test('71 previously observed weak rook-grab response is flagged as underplaying a blunder',()=>{
 const prior='Black wins the rook on g3, but the queen on g3 is immediately capturable by your queen or by the f-pawn, so it is not a free piece. Stockfish’s main line shows that if you recapture with the queen, Black can answer with a rook check on e1, so the practical point is the tactical sequence, not the rook grab alone.';
 assert.ok(guardContext.guard.unsupportedSevereBlunderClaims(prior,severeInput).length>0);
});
test('72 accepts the actual accurate Nf3 response using production piece geometry',()=>{
 const actual='The knight develops to f3, and it directly supports your d4 pawn while also covering h2. It also adds control over e5 and g5, which helps you keep options flexible in the centre.';
 const input={tacticalFacts:knightRelations,coachingGuidance:{focus:'strategic'}};
 assert.equal(guardContext.guard.checkExplanation(actual,input,guardContext.guard.coachingBudget(input)).length,0);
});

test('73 reports non-sensitive validator issue codes without leaking full text',()=>{
 const a=guardContext.guard.coachingValidationCodes([
  'Too long for this move; preserve the most important factual explanation.',
  'The moved piece does not directly defend the pawn on d4. Remove that claim.'
 ]);
 assert.deepEqual([...a].sort(),['length','piece-relation']);
});
test('74 engine attribution is disallowed for ordinary opening moves',()=>{
 const input={engine:{},moveAssessment:{centipawnLoss:5,depth:14},tacticalFacts:{givesCheck:false},played:{check:false},coachingGuidance:{focus:'strategic'}};
 assert.ok(guardContext.guard.needlessEngineAttribution(
  "Stockfish's main line develops the bishop.",input).length>0);
 assert.equal(guardContext.guard.needlessEngineAttribution(
  'This develops the bishop and prepares castling.',input).length,0);
});
test('75 engine mention is allowed for decisive tactical errors',()=>{
 const input={engine:{},moveAssessment:{centipawnLoss:740,depth:14},tacticalFacts:{givesCheck:false},played:{check:false}};
 assert.equal(guardContext.guard.needlessEngineAttribution(
  'Stockfish confirms a major mistake after White captures the queen.',input).length,0);
});
test('76 validator rejects routine engine-name recital',()=>{
 const input={engine:{},moveAssessment:{centipawnLoss:0,depth:12},tacticalFacts:{givesCheck:false},played:{check:false}};
 const msg="The pawn advances to e4 and Stockfish's main line replies e6.";
 assert.ok(guardContext.guard.checkExplanation(msg,input,
  guardContext.guard.coachingBudget(input)).some(x=>x.includes('Stockfish')));
});

const winningBeforeAndAfter={engine:{variations:[{moves:[]}]},priorEngine:{variations:[{moves:[]}]},
 mover:'White',player:'White',
 moveAssessment:{centipawnLoss:384,depth:12,playedIsEngineChoice:false,
 evaluationBefore:5.85,evaluationAfter:2.01,approximate:true}};
test('77 Opera Game 15.Bxd7+ is a missed stronger win, not a serious mistake',()=>{
 assert.equal(guardContext.guard.moveQualityContext(winningBeforeAndAfter).kind,
  'missed-stronger-win');
 assert.ok(guardContext.guard.unsupportedSevereBlunderClaims(
  'This is a serious mistake: the bishop captures the rook.',winningBeforeAndAfter).length>0);
 assert.equal(guardContext.guard.unsupportedSevereBlunderClaims(
  'White captures the rook and retains a substantial initiative, though a stronger continuation was available.',winningBeforeAndAfter).length,0);
});
test('78 queen-for-rook error goes from winning for Black to clearly losing',()=>{
 const verdict=guardContext.guard.moveQualityContext(severeInput);
 assert.equal(verdict.kind,'serious-deterioration');
 assert.ok(verdict.before>0&&verdict.after<0);
 assert.ok(guardContext.guard.unsupportedSevereBlunderClaims(
  'Black captures the rook, but White can take the queen.',severeInput).length>0);
 assert.equal(guardContext.guard.unsupportedSevereBlunderClaims(
  'This is a serious mistake: Black gives up the queen for a rook and loses the advantage.',severeInput).length,0);
});
test('79 seriously worsening a position already lost does not automatically create a blunder',()=>{
 const input={...winningBeforeAndAfter,
  moveAssessment:{centipawnLoss:340,depth:14,playedIsEngineChoice:false,
   evaluationBefore:-2.4,evaluationAfter:-5.8}};
 assert.equal(guardContext.guard.moveQualityContext(input).kind,'already-losing');
 assert.ok(guardContext.guard.unsupportedSevereBlunderClaims(
  'White makes a catastrophic blunder.',input).length>0);
});
test('80 squandering a clear win is distinct from still-winning and losing outcomes',()=>{
 const input={...winningBeforeAndAfter,
  moveAssessment:{centipawnLoss:340,depth:14,playedIsEngineChoice:false,
   evaluationBefore:3.6,evaluationAfter:0.2}};
 assert.equal(guardContext.guard.moveQualityContext(input).kind,
  'squandered-winning-advantage');
});
test('81 insufficient or shallow evidence cannot justify severe move grading',()=>{
 const input={...winningBeforeAndAfter,
  moveAssessment:{centipawnLoss:500,depth:8,playedIsEngineChoice:false,
   evaluationBefore:5.85,evaluationAfter:0.85}};
 assert.equal(guardContext.guard.moveQualityContext(input).kind,'ungraded');
 assert.equal(guardContext.guard.unsupportedSevereBlunderClaims(
  'This is a blunder.',input).length,0);
});
test('82 full validator catches the actual Opera mistaken blunder wording',()=>{
 const output='This is a serious mistake: White’s bishop takes the rook on d7.';
 const problems=guardContext.guard.checkExplanation(output,winningBeforeAndAfter,
  guardContext.guard.coachingBudget(winningBeforeAndAfter));
 assert.ok(problems.some(x=>x.includes('Move severity')));
});

const immortalCapture={
 beforeFen:'rnbqkbnr/pppp1ppp/8/4p3/4PP2/8/PPPP2PP/RNBQKBNR b KQkq f3 0 2',
 afterFen:'rnbqkbnr/pppp1ppp/8/8/4Pp2/8/PPPP2PP/RNBQKBNR w KQkq - 0 3',
 mover:'Black',player:'White',
 played:{piece:'p',side:'Black',from:'e5',to:'f4',capture:true},
 tacticalFacts:{exchangeEvidence:{captured:{piece:'pawn',square:'f4'},completedExchange:null}},
 strategicFacts:{}
};
const pawnHistory=message=>Array.from(guardContext.guard.unsupportedPawnHistoryClaims(message,immortalCapture));
test('83 Immortal 2...exf4: first capture must not be described as recapture',()=>{
 assert.ok(pawnHistory('Black recaptures on f4.').some(x=>x.includes('Capture sequence')));
 assert.equal(pawnHistory('Black captures the f4 pawn.').length,0);
});
test('84 Immortal 2...exf4: the e-file has only a White pawn',()=>{
 assert.ok(pawnHistory('The e-file still has pawns for both sides.').some(x=>x.includes('Pawn file occupancy')));
 assert.ok(pawnHistory('Both sides have pawns remaining on the e-file.').length>0);
 assert.equal(pawnHistory('The e-file still contains White’s e4 pawn.').length,0);
});
test('85 Immortal 2...exf4: doubled black f-pawns are true',()=>{
 const actual=guardContext.guard.coachPawnBoard(immortalCapture.afterFen);
 assert.equal(actual.Black.filter(square=>square[0]==='f').length,2);
 assert.equal(pawnHistory('Doubled black pawns on the f-file.').length,0);
 assert.equal(pawnHistory('Black pawns on f7 and f4.').length,0);
});
test('86 reject false pawn-square claims even when file is correct',()=>{
 assert.ok(pawnHistory('Black pawns on f7 and f5.').some(x=>x.includes('f5')));
 assert.ok(pawnHistory('Doubled black pawns on the e-file.').length>0);
});
test('87 full validator rejects actual Immortal response after a repair',()=>{
 const incorrect='Black recaptures on f4, but the move creates doubled black pawns on the f-file, with pawns now on f7 and f4. The e-file still has pawns for both sides, so it remains occupied rather than open or blocked by directly facing pawns.';
 const issues=Array.from(guardContext.guard.checkExplanation(incorrect,immortalCapture,
  guardContext.guard.coachingBudget(immortalCapture)));
 assert.ok(issues.some(x=>x.includes('Capture sequence')));
 assert.ok(issues.some(x=>x.includes('Pawn file occupancy')));
});
test('88 true same-square recapture remains permitted',()=>{
 const recapture={...immortalCapture,tacticalFacts:{exchangeEvidence:{
  captured:{piece:'pawn',square:'f4'},completedExchange:{sameSquareRecapture:true}}}};
 assert.equal(guardContext.guard.unsupportedPawnHistoryClaims(
  'Black recaptures on f4.',recapture).length,0);
});
test('89 missing board data does not manufacture occupancy claims',()=>{
 const incomplete={...immortalCapture,afterFen:'unknown'};
 assert.equal(guardContext.guard.unsupportedPawnHistoryClaims(
  'Black pawns on f7 and f5.',incomplete).length,0);
});
test('90 pawn-structure validator exposes safe failure categories',()=>{
 const codes=Array.from(guardContext.guard.coachingValidationCodes([
  'Capture sequence: this is a first capture, not a recapture.',
  'Pawn file occupancy: the e-file lacks pawns from both sides.'
 ]));
 assert.deepEqual(codes,['capture-sequence','pawn-structure']);
});
