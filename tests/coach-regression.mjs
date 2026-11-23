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
