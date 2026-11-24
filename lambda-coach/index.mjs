// Opening Lab AI coach — deploy this file as AWS Lambda index.mjs.
// Runtime: AWS-managed Node.js; handler: index.handler
// Requires OPENAI_API_KEY in Lambda environment variables.
// Do not expose this function publicly without appropriate API access controls.
const reply=(statusCode,data)=>({
 statusCode,
 headers:{'Content-Type':'application/json'},
 body:JSON.stringify(data)
});
// Keep routine lessons compact without shortening genuinely important tactics.
// The final check happens after generation, rather than relying on a prompt alone.
const words=text=>text.trim().split(/\s+/).filter(Boolean).length;
const sentences=text=>(text.match(/[.!?](?=\s|$)/g)||[]).length;
function coachingBudget(input){
 const loss=input.moveAssessment?.centipawnLoss;
 const focus=input.coachingGuidance?.focus;
 const tactics=input.tacticalFacts||{};
 const critical=(Number.isFinite(loss)&&loss>=120)||
  focus==='turning-point'||
  (Number.isFinite(loss)&&loss>=70&&input.alternativeEvidence)||
  input.played?.check===true||
  tactics.givesCheck===true||
  input.played?.capture===true||
  input.opponentReplyThreats?.candidates?.some(x=>x.kind==='pin'||x.kind==='fork');
 const strategic=Boolean(input.strategicFacts?.changes?.length||
  input.teachingPriorities?.length||input.coachingGuidance?.explainAlternatives);
 return critical?{maxWords:150,maxSentences:9,type:'critical'}:
  strategic?{maxWords:100,maxSentences:6,type:'strategic'}:
  {maxWords:80,maxSentences:5,type:'routine'};
}
// Immutable move relationships supplied by the chess engine's legal board
// implementation. These are the only targets the played piece directly guards
// or attacks. "Controls a square" does not mean "defends a pawn" on a
// different square.
function verifiedRelations(input){
 const facts=input.tacticalFacts||{};
 const tidy=items=>(Array.isArray(items)?items:[])
  .filter(x=>x&&typeof x.square==='string'&&/^[a-h][1-8]$/.test(x.square)&&typeof x.piece==='string')
  .map(x=>({piece:x.piece,square:x.square}));
 return {
  movedPiece:facts.movedPiece||null,
  directAttackSquares:Array.isArray(facts.movedPieceAttacks)?facts.movedPieceAttacks.filter(x=>/^[a-h][1-8]$/.test(x)):[],
  friendlyPiecesDirectlyDefended:tidy(facts.friendlyPiecesDefendedByMovedPiece),
  enemyPiecesDirectlyAttacked:tidy(facts.enemyPiecesAttackedByMovedPiece),
  legalImmediateCapturesOfMovedPiece:Array.isArray(facts.legalImmediateCapturesOfMovedPiece)?facts.legalImmediateCapturesOfMovedPiece:[],
  rule:'Only describe a pawn or piece as directly defended, supported, protected, attacked or threatened by the MOVED piece if its square and piece type appear in the corresponding list. Square control is distinct from defending an occupied piece. Do not invent direct pawn support from central control. If the intended relation is absent, discuss verified square control or a practical plan instead.'
 };
}
function unsupportedDirectClaims(message,relations){
 const errors=[];
 const defended=new Set(relations.friendlyPiecesDirectlyDefended.filter(x=>x.piece==='pawn').map(x=>x.square));
 const attacked=new Set(relations.enemyPiecesDirectlyAttacked.filter(x=>x.piece==='pawn').map(x=>x.square));
 // Limit this guard to explicit links between the moved piece and named pawns.
 // Unqualified strategic phrases ("supporting the centre") are not assertions
 // of a direct geometric defence and should not be rejected.
 const clauses=message.split(/(?<=[.!?])\s+|[;,]/);
 for(const clause of clauses){
  const phrases=[
   {type:'defence',re:/\b(?:supports?|defends?|protects?|guards?|back(?:s|ing)? up)\b[^.!?;,]{0,65}?\b(?:your|white(?:'s)?|black(?:'s)?|the)\s+(?:pawn\s+(?:on|at)\s+([a-h][1-8])|([a-h][1-8])\s+pawn)\b/gi,valid:defended},
   {type:'attack',re:/\b(?:attacks?|threatens?|targets?)\b[^.!?;,]{0,65}?\b(?:your|white(?:'s)?|black(?:'s)?|the)\s+(?:pawn\s+(?:on|at)\s+([a-h][1-8])|([a-h][1-8])\s+pawn)\b/gi,valid:attacked}
  ];
  for(const p of phrases)for(const match of clause.matchAll(p.re)){
   const square=match[1]||match[2];
   if(!p.valid.has(square))
    errors.push('The moved piece does not directly '+(p.type==='defence'?'defend':'attack')+' the pawn on '+square+'. Remove that claim.');
  }
 }
 return [...new Set(errors)];
}
// Narrow, falsifiable checks. Ambiguous prose stays for human review rather
// than guessing what the model meant or rejecting a correct broader statement.
function unsupportedStructuralClaims(message,input){
 const issues=[];
 const facts=input.strategicFacts||{};
 const after=facts.after?.centralFiles||{};
 const routes=facts.bishopRoutes||{};
 const actualBishops=routes.after||[];
 const routeChanges=routes.changes||[];
 const clauses=message.split(/(?<=[.!?])\s+|[;,]/);
 for(const clause of clauses){
  const central=/(?:\b([de])-file\b|\b([de])\s+file\b)/ig;
  for(const m of clause.matchAll(central)){
   const file=(m[1]||m[2]).toLowerCase(),state=after[file];
   if(!state)continue;
   const segment=clause.slice(Math.max(0,m.index-50),Math.min(clause.length,m.index+m[0].length+55));
   if(/\b(?:blocked|closed|locked)\b/i.test(segment)&&!state.directlyBlocked)
    issues.push('Do not call the '+file+'-file blocked/closed: its pawns do not directly face each other on adjacent ranks.');
   if(/\b(?:open|opened|opening)\b/i.test(segment)&&!/(?:not|isn't|is not|wasn't|was not|rather than)\s+(?:fully\s+)?open/i.test(segment)&&state.state!=='open')
    issues.push('Do not call the '+file+'-file open: pawns remain on it.');
  }
  if(/\bboth central files\b/i.test(clause)&&/\b(?:closed|blocked|locked)\b/i.test(clause)&&
   (!after.d?.directlyBlocked||!after.e?.directlyBlocked))
    issues.push('Do not call both central files blocked or closed: at least one lacks directly opposed pawns.');
  // Detect claims that a move opens (or blocks) the specified bishop's
  // diagonal only if the square is explicit and the bishop exists.
  const bishopClaim=/(?:\b(?:opens?|opened|unlocks?|unlocked|frees?|freed|releases?|released|blocks?|blocked|closes?|closed)\b[^.!?;,]{0,90}?\bbishop\s+(?:on|at)\s+([a-h][1-8])\b|\bbishop\s+(?:on|at)\s+([a-h][1-8])\b[^.!?;,]{0,90}?\b(?:opens?|opened|unlocks?|unlocked|frees?|freed|blocks?|blocked|closes?|closed)\b)/ig;
  for(const match of clause.matchAll(bishopClaim)){
   const square=match[1]||match[2];
   const bishop=actualBishops.find(x=>x.square===square);
   if(!bishop)continue;
   const changed=routeChanges.find(x=>x.side===bishop.side&&x.bishopSquare===square);
   const opened=/(?:\b(?:opens?|opened|unlocks?|unlocked|frees?|freed|releases?|released)\b)/i.test(match[0]);
   const blocked=/(?:\b(?:blocks?|blocked|closes?|closed)\b)/i.test(match[0]);
   if(opened&&!changed?.newlyClearSquares?.length)
    issues.push('The move did not open a new clear diagonal for the bishop on '+square+'. Remove that claim.');
   if(blocked&&!changed?.newlyBlockedSquares?.length)
    issues.push('The move did not newly block a clear diagonal for the bishop on '+square+'. Remove that claim.');
  }
 }
 return [...new Set(issues)];
}
// Ground concrete pawn claims in the *actual final FEN*. This parser is only
// used to validate statements about pawns and capture sequence; it does not
// attempt chess analysis or infer intent from a move.
function coachPawnBoard(fen){
 if(typeof fen!=='string')return null;
 const ranks=fen.split(' ')[0]?.split('/');
 if(ranks?.length!==8)return null;
 const result={White:[],Black:[]};
 for(let r=0;r<8;r++){
  let file=0;
  for(const ch of ranks[r]){
   if(/[1-8]/.test(ch))file+=Number(ch);
   else if(/[pnbrqkPNBRQK]/.test(ch)){
    if(ch==='P'||ch==='p')
     result[ch==='P'?'White':'Black'].push('abcdefgh'[file]+(8-r));
    file++;
   }else return null;
  }
  if(file!==8)return null;
 }
 return result;
}
function unsupportedPawnHistoryClaims(message,input){
 const issues=[];
 const board=coachPawnBoard(input.afterFen);
 const played=input.played||{};
 const currentCapture=played.capture===true||
  input.tacticalFacts?.exchangeEvidence?.captured!=null;
 const recapture=input.tacticalFacts?.exchangeEvidence?.completedExchange?.sameSquareRecapture===true;
 const moveTo=played.to;
 const previousPawns=coachPawnBoard(input.beforeFen);
 const pawnMove=played.piece==='p'||played.piece==='pawn'||
  (previousPawns&&played.from&&previousPawns[played.side||input.mover]?.includes(played.from));
 // "Black recaptures on f4" is false when the previous move did not
 // capture a piece on f4. With missing history, do not infer a recapture.
 if(pawnMove&&currentCapture&&!recapture&&
    /\b(?:recaptures?|recaptured|takes back|wins back)\b/i.test(message)&&
    (!moveTo||new RegExp('(?:\\bon\\s+|\\bat\\s+)?'+moveTo+'\\b','i').test(message)))
  issues.push('Capture sequence: this is a first capture, not a recapture. Say captures or takes on '+(moveTo||'the destination')+'.');
 if(!board)return [...new Set(issues)];
 const clauses=message.split(/(?<=[.!?])\s+|[;,]/);
 for(const clause of clauses){
  // Explicit "both sides have pawns on the e-file" claims are falsifiable.
  for(const m of clause.matchAll(/\b([a-h])[- ]file\b/gi)){
   const file=m[1].toLowerCase();
   const vicinity=clause.slice(Math.max(0,m.index-75),Math.min(clause.length,m.index+m[0].length+85));
   const both=/\b(?:both sides|both colours|both colors|white and black|black and white)\b/i.test(vicinity)&&
    /\bpawns?\b/i.test(vicinity);
   if(both&&(!board.White.some(x=>x[0]===file)||!board.Black.some(x=>x[0]===file)))
    issues.push('Pawn file occupancy: the '+file+'-file does not contain pawns belonging to both sides. Describe the actual pawns only.');
  }
  // A claim that a named side has pawns on specific squares is checked
  // against exact squares, not assumptions about file control.
  const named=/\b(white|black)(?:'s)?\s+pawns?\s+(?:now\s+)?(?:on|at)\s+([a-h][1-8])(?:\s*(?:and|,)\s*([a-h][1-8]))?/gi;
  for(const m of clause.matchAll(named)){
   const side=m[1][0].toUpperCase()+m[1].slice(1).toLowerCase();
   for(const square of [m[2],m[3]].filter(Boolean))
    if(!board[side].includes(square))
     issues.push('Pawn square occupancy: '+side+' does not have a pawn on '+square+' in the final position.');
  }
  // "doubled black pawns on the f-file" needs two black pawns on f.
  for(const m of clause.matchAll(/\bdoubled\s+(white|black)\s+pawns?\s+on\s+(?:the\s+)?([a-h])[- ]file\b/gi)){
   const side=m[1][0].toUpperCase()+m[1].slice(1).toLowerCase();
   if(board[side].filter(x=>x[0]===m[2].toLowerCase()).length<2)
    issues.push('Pawn structure: '+side+' has no doubled pawns on the '+m[2].toLowerCase()+'-file.');
  }
 }
 return [...new Set(issues)];
}
// Minimal deterministic teaching fallback for a verified pawn capture.
// Only used after BOTH AI attempts failed validation. Never invent threats,
// strategic conclusions or unverified follow-up moves.
function verifiedPawnCaptureFallback(input){
 const played=input.played||{},exchange=input.tacticalFacts?.exchangeEvidence;
 const after=coachPawnBoard(input.afterFen);
 const before=coachPawnBoard(input.beforeFen);
 const mover=played.side||input.mover;
 if(!after||!before||!['White','Black'].includes(mover)||
    !['p','pawn'].includes(played.piece)||played.capture!==true||
    !exchange?.captured||!played.from||!played.to||
    !before[mover].includes(played.from)||!after[mover].includes(played.to))
  return null;
 const victim=exchange.captured;
 if(victim.piece!=='pawn'||victim.square!==played.to)return null;
 const file=played.to[0],pawnSquares=after[mover].filter(x=>x[0]===file).sort();
 const recapture=exchange.completedExchange?.sameSquareRecapture===true;
 const capture=recapture?'recaptures':'captures';
 const first=mover+' '+capture+' the pawn on '+played.to+'.';
 const second=pawnSquares.length>=2?
  ' This leaves '+mover.toLowerCase()+' with doubled pawns on the '+file+'-file ('+
   pawnSquares.join(' and ')+').':'';
 return first+second;
}
// General motif fallback from legal continuations, independent of opening,
// piece location or a particular screenshot. It is explicitly a possibility.
function verifiedMotifFallback(input){
 const candidate=(input.tacticalOpportunities?.top||[])
  .find(x=>x?.motifs?.length&&x.priority>=80&&
   !(x.canCaptureAttacker&&!x.canRecapture&&!x.engineSupported));
 if(!candidate)return null;
 const side=input.mover||input.played?.side;
 if(!['White','Black'].includes(side))return null;
 const top=candidate.motifs.find(x=>x.type==='absolute-pin'&&
  x.sideAtRisk===side)||candidate.motifs[0];
 if(!top)return null;
 const qualification=candidate.engineSupported?
  'Stockfish considers the tactical continuation, but that does not mean every reply is forced.':
  'This is a legal possibility, not a guaranteed winning tactic.';
 if(top.type==='absolute-pin'){
  if(!['pawn','knight','bishop','rook','queen'].includes(top.atRisk)||
    !['bishop','rook','queen'].includes(top.attacker))return null;
  return side+"'s "+top.atRisk+
   ' may be vulnerable to an absolute pin against the king by an opposing '+
   top.attacker+'. '+qualification;
 }
 if(top.type==='fork'){
  const names=(top.targets||[]).map(x=>x.piece)
   .filter(x=>['knight','bishop','rook','queen'].includes(x));
  if(names.length<2)return null;
  return 'The resulting position allows a possible '+top.attacker+
   ' fork against a '+names[0]+' and '+names[1]+'. '+qualification;
 }
 if(top.type==='discovered-attack'&&
  ['bishop','rook','queen'].includes(top.attacker)&&
  ['knight','bishop','rook','queen'].includes(top.target))
  return 'There is a possible discovered attack by an opposing '+
   top.attacker+' against a '+top.target+'. '+qualification;
 return null;
}
// Final board-verified fallback after both model attempts fail tactical checks.
// It does not repeat unverified model claims.
function verifiedNeutralFallback(input){
 const played=input.played||{},side=input.mover||played.side;
 const name={p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king',
  pawn:'pawn',knight:'knight',bishop:'bishop',rook:'rook',queen:'queen',king:'king'}[String(played.piece||'').toLowerCase()];
 const square=played.to;
 if(['White','Black'].includes(side)&&name&&/^[a-h][1-8]$/.test(square||'')){
  const actual=coachPieceAtFen(input.afterFen,square);
  const expected={pawn:'p',knight:'n',bishop:'b',rook:'r',queen:'q',king:'k'}[name];
  if(actual===(side==='White'?expected.toUpperCase():expected))
   return side+' has moved the '+name+' to '+square+'. No verified coaching explanation is available for this move.';
 }
 return 'A verified explanation is unavailable for this move; no tactical conclusion has been established.';
}
// No extra AI request if a genuine capture plus legally available opponent
// recapture has already been proved. This is deliberately modest coaching:
// the reply is a legal option, not an assertion that the trade is forced.
function verifiedCaptureWithReplyFallback(input){
 const e=input.tacticalFacts?.exchangeEvidence,played=input.played||{};
 const victim=e?.captured,reply=e?.captureOptions?.find(x=>x.capturedPiece&&x.uci);
 const mover=input.mover||played.side,after=input.afterFen;
 if(!victim||!reply||!['White','Black'].includes(mover)||
  !/^[a-h][1-8]$/.test(played.to||'')||
  !/^[a-h][1-8]$/.test(played.from||'')||
  victim.square!==played.to||!['pawn','knight','bishop','rook','queen'].includes(victim.piece)||
  !['pawn','knight','bishop','rook','queen'].includes(reply.capturedPiece)||
  reply.capturedPiece!==(input.tacticalFacts?.movedPiece?.type))return null;
 const board=typeof after==='string'?after.split(' ')[0].split('/'):null;
 if(!board||board.length!==8)return null;
 const at=square=>{
  let file=0;const target='abcdefgh'.indexOf(square[0]);
  for(const c of board[8-Number(square[1])]){
   if(/[1-8]/.test(c))file+=Number(c);
   else if(/[pnbrqkPNBRQK]/.test(c)){if(file===target)return c;file++;}
   else return null;
  }
  return null;
 };
 const type={pawn:'p',knight:'n',bishop:'b',rook:'r',queen:'q'};
 const found=at(played.to);
 if(found!==(mover==='White'?type[reply.capturedPiece].toUpperCase():type[reply.capturedPiece]))return null;
 const captures=Array.isArray(e.captureOptions)?e.captureOptions:[];
 if(!captures.some(x=>x.uci===reply.uci&&x.capturedPiece===reply.capturedPiece))return null;
 const capturesText=typeof reply.move==='string'&&reply.move.length<70?reply.move:null;
 if(!capturesText)return null;
 return mover+"'s "+reply.capturedPiece+" captures a "+victim.piece+" on "+played.to+
  ". The opponent can respond by capturing that "+reply.capturedPiece+
  " on "+played.to+". This is a possible exchange; the initial capture does not secure an uncontested material gain.";
}
// Only reject explicit material-win language when the provided legal history
// proves a same-square exchange of equal-value pieces, or when a capture of a
// minor piece has an immediate legal minor-piece recapture. A legal reply is
// not necessarily forced or good, so the message must not claim the outcome
// of the whole variation without Stockfish evidence.
function unsupportedExchangeClaims(message,input){
 const evidence=input.tacticalFacts?.exchangeEvidence;
 if(!evidence)return [];
 const issues=[];
 const freeWin=/\b(?:won|wins?|winning|gained?|gains?)\s+(?:back\s+)?(?:a\s+|the\s+)?(?:piece|material|bishop|knight)\b/i;
 const explicitlyFree=/\b(?:free|for nothing|without compensation|without losing a piece|for no compensation)\b/i;
 const claimedGain=freeWin.test(message)&&!/\b(?:win|won|wins?|winning)\s+back\b/i.test(message);
 const trade=evidence.completedExchange;
 if(trade?.sameSquareRecapture&&trade.equalValuePieces&&claimedGain)
  issues.push('This move completed an equal-value exchange, not a free piece win. Say the piece was recaptured or exchanged and mention actual structural consequences.');
 if(evidence.captured&&evidence.captureOptions?.some(x=>x.hasLegalRecapture)){
  if(explicitlyFree.test(message))
   issues.push('The captured piece can immediately be recaptured. Do not claim it was won for free without a verified engine continuation.');
  const valueByName={pawn:1,knight:3,bishop:3,rook:5,queen:9};
  const equalRecapture=evidence.captureOptions.some(x=>x.hasLegalRecapture&&
   valueByName[x.capturedPiece]===evidence.captured.value);
  if(equalRecapture&&claimedGain&&!input.alternativeEvidence)
   issues.push('The capture allows an immediate equal-value recapture. Describe it as a possible exchange rather than saying the attacker won a piece.');
 }
 if(!evidence.captured&&evidence.captureOptions?.some(x=>x.hasLegalRecapture)&&
   /\b(?:wins?|winning|won)\s+(?:a\s+|the\s+)?(?:pawn|piece|material)\b/i.test(message))
  issues.push('An available capture of the moved piece can be recaptured. Do not label it a material win without verified engine evidence.');
 if(!evidence.captured&&evidence.captureOptions?.some(x=>x.hasLegalRecapture)&&
   /\b(?:unprotected|undefended)\b/i.test(message))
  issues.push('The moved piece can be recaptured after a legal capture; do not describe it as unprotected without explaining the defence.');
 return [...new Set(issues)];
}
// A possible queen capture is NOT a queen trade unless BOTH queens are exchanged.
function unsupportedQueenTradeClaims(message,input){
 if(!/\b(?:queen(?:[- ]for[- ]queen)?[- ](?:trade|exchange)|(?:trade|exchange|swap)(?:s|d|ing)?\s+(?:of\s+)?(?:the\s+|both\s+)?queens?|queens?\s+(?:are|is|gets?|will be|would be)\s+(?:traded|exchanged))\b/i.test(message))return [];
 const board=typeof input.afterFen==='string'?input.afterFen.split(' ')[0]:null;
 if(!board)return [];
 if(board.includes('Q')&&board.includes('q')&&input.verifiedQueenExchange?.bothQueensCaptured!==true)
  return ['Queen exchange: both queens remain on the board and no verified queen-for-queen capture sequence exists. A queen taken by a pawn, knight, bishop or rook is not a queen trade. Describe verified captures and material outcomes only.'];
 return [];
}
// Verified legal two-ply captures from the client: the replying piece takes
// the just-moved piece; a subsequent legal recapture takes the replying piece.
// These are OPTIONS, not forced or necessarily sound lines. Net material is
// counted from actual captured pieces, not the name of the recapturing piece.
function unsupportedMaterialSequenceClaims(message,input){
 const options=input.tacticalFacts?.exchangeEvidence?.captureOptions;
 if(!Array.isArray(options)||!options.length)return [];
 const concerns=[];
 const hasQueenByMinor=options.some(reply=>
  reply.withPiece==='queen'&&reply.capturedPiece==='pawn'&&
  reply.recaptures?.some(r=>r.capturedPiece==='queen'&&
   ['knight','bishop','rook','pawn'].includes(r.withPiece)&&
   r.replySideNetLoss>=6));
 if(hasQueenByMinor&&/\bqueen[- ]for[- ]pawn[- ]plus[- ](?:a[- ])?knight\b|\b(?:lose|loses|losing|sacrifice|sacrifices|giving up)\s+(?:your|the|white(?:'s)?|black(?:'s)?)?\s*knight\b/i.test(message))
  concerns.push('Material sequence: in the verified legal Qx(pawn) followed by minor-piece captures queen line, the knight is the capturing piece, not an additional piece lost. The queen side loses at least eight pawn units net. Do not describe this as queen-for-pawn-plus-knight or say the knight is sacrificed.');
 return [...new Set(concerns)];
}
// Prioritise an immediate checked capture of a major piece after a large
// Stockfish evaluation swing. The PV is verified as legal, not as forced.
function unsupportedPrimaryTacticalClaims(message,input){
 const loss=input.moveAssessment?.centipawnLoss;
 const first=input.tacticalContinuation?.moves?.[0];
 if(!Number.isFinite(loss)||loss<200||!first||
    !['rook','queen'].includes(first.capturedPiece)||first.check!==true||
    !/^[a-h][1-8]$/.test(first.to||''))return [];
 const notation=String(first.label||'').replace(/[+#?!]+$/g,'');
 const notationMentioned=notation.length>0&&message.includes(notation);
 const targetMentioned=new RegExp('\\b'+first.to+'\\b','i').test(message);
 const pieceMentioned=new RegExp('\\b'+first.capturedPiece+'\\b','i').test(message);
 const checkMentioned=/\bcheck\b|\+/i.test(message);
 if(!notationMentioned&&!(targetMentioned&&pieceMentioned&&checkMentioned))
  return ['Primary tactic: the verified Stockfish first reply '+first.label+' immediately captures a '+first.capturedPiece+' with check after a major evaluation swing. Lead with that capture and check, not a speculative alternative. The PV is not necessarily forced.'];
 return [];
}
// Do not imply a minor piece is simply lost to an enemy queen when the
// defending queen can immediately capture that queen in a legal reply.
function unsupportedHangingMinorClaims(message,input){
 const options=input.tacticalFacts?.exchangeEvidence?.captureOptions||[];
 const piece=input.tacticalFacts?.movedPiece?.type;
 if(!['bishop','knight'].includes(piece))return [];
 const guarded=options.some(reply=>reply.withPiece==='queen'&&reply.capturedPiece===piece&&
  reply.recaptures?.some(r=>r.withPiece==='queen'&&r.capturedPiece==='queen'&&r.replySideNetLoss>=5));
 if(!guarded)return [];
 if(/\b(?:bishop|knight|piece)\s+(?:is|isn't|is not|remains|looks)\s+(?:not\s+)?(?:safe|hanging|undefended|unprotected)\b|\b(?:lose|loses|losing)\s+(?:your|the|a)\s+(?:bishop|knight)\b/i.test(message)&&
   !/\b(?:recaptur\w*|take\w*\s+(?:back\s+)?(?:the\s+)?queen|wins?\s+(?:the\s+)?queen)\b/i.test(message))
  return ['Material threat: the opponent queen can capture the moved minor piece, but the defending queen can immediately capture that queen. Do not describe the minor piece as simply unsafe or lost; explain the verified recapture and account for the material difference.'];
 return [];
}
// After AI + one repair fail, explain a verified major checked capture directly.
// Restricted to immediately played, legally verified first PV replies, corroborated
// by the FEN board and a large negative evaluation change. No speculative lines.
function verifiedMajorCaptureFallback(input){
 const first=input.tacticalContinuation?.moves?.[0];
 const loss=input.moveAssessment?.centipawnLoss;
 const after=input.afterFen;
 const quality=moveQualityContext(input);
 if(!first||first.ply!==1||first.check!==true||
    !['rook','queen'].includes(first.capturedPiece)||
    !Number.isFinite(loss)||loss<300||quality.kind!=='serious-deterioration'||
    !/^[a-h][1-8]$/.test(first.from||'')||
    !/^[a-h][1-8]$/.test(first.to||'')||
    !/^[a-h][1-8][a-h][1-8]$/.test(first.uci||'')||
    first.uci!==first.from+first.to||
    !['White','Black'].includes(first.side))return null;
 const ranks=typeof after==='string'?after.split(' ')[0].split('/'):null;
 if(!ranks||ranks.length!==8)return null;
 const pieceAt=square=>{
  let file=0;const wanted='abcdefgh'.indexOf(square[0]);
  for(const c of ranks[8-Number(square[1])]){
   if(/^[1-8]$/.test(c))file+=Number(c);
   else if(/^[pnbrqkPNBRQK]$/.test(c)){
    if(file===wanted)return c;
    file++;
   }else return null;
  }
  return '.';
 };
 const capturer=pieceAt(first.from),victim=pieceAt(first.to);
 if(capturer!==(first.side==='Black'?'q':'Q')||
    victim!==(first.capturedPiece==='rook'?
     first.side==='Black'?'R':'r':first.side==='Black'?'Q':'q'))return null;
 const notation=first.label;
 if(typeof notation!=='string'||!/^([0-9]+\.\.\.\s*)?Qx[a-h][1-8]\+$/.test(notation))return null;
 return 'This is a serious mistake. In the verified Stockfish line, '+
  notation+' captures the '+first.capturedPiece+' on '+first.to+
  ' with check, turning a previously better position into a worse one.';
}
// Tactical language must respect whether a named target belongs to the mover.
// Pawn diagonals control occupied friendly squares; they do not attack enemies
// there. Only reject a square-specific claim supported by exact board evidence.
function unsupportedFriendlyTargetClaims(message,input){
 const t=input.tacticalFacts||{};
 const friends=t.friendlyPiecesDefendedByMovedPiece||[];
 if(!friends.length)return [];
 const own=t.movedPiece?.type;
 if(!own)return [];
 const errors=[];
 for(const match of String(message).matchAll(/\b(?:attacks?|hits?|threatens?|targets?)\s+(?:(?:your|the|white(?:'s)?|black(?:'s)?)\s+)?(pawn|knight|bishop|rook|queen)\s+(?:on|at)\s+([a-h][1-8])\b/gi)){
  const [,type,square]=match;
  if(friends.some(x=>x.piece===type.toLowerCase()&&x.square===square))
   errors.push('Friendly target: the moved '+own+' controls '+square+
    ', occupied by a friendly '+type.toLowerCase()+'. It defends this piece; it does not attack or threaten an opponent there.');
 }
 return [...new Set(errors)];
}
// "Knight can check on c7" must be an actual check in a legally verified
// hypothetical knight move, not merely one of its geometric destinations.
// No general regex on "check": only assertions linking the just-moved knight
// to one specific next-turn destination.
function unsupportedHypotheticalCheckClaims(message,input){
 const t=input.tacticalFacts||{};
 if(t.movedPiece?.type!=='knight')return [];
 const potential=t.movedPiecePotentialChecks;
 if(!Array.isArray(potential))return [];
 const valid=new Set(potential.map(x=>x.to));
 const issues=[];
 for(const clause of String(message).split(/(?<=[.!?])\s+|[;:]/)){
  // Only exact square-linked check claims; otherwise ordinary knight mobility
  // and generic "check" discussion can be valid and must not be suppressed.
  const claimed=[
   ...[...clause.matchAll(/\bchecking\s+(?:knight\s+)?(?:jump|hop|leap)\s+(?:to|on|at)\s+([a-h][1-8])/gi)].map(m=>m[1]),
   ...[...clause.matchAll(/\b(?:knight|jump|hop|leap)\b[^.!?]{0,40}?\b(?:to|on|at)\s+([a-h][1-8])[^.!?]{0,35}?\b(?:with check|gives check|checking)\b/gi)].map(m=>m[1])
  ];
  for(const square of claimed)if(!valid.has(square))
   issues.push('Hypothetical check: the knight moving to '+square+
    ' does not give a legal check in the current position. Do not call this a checking jump.');
 }
 return [...new Set(issues)];
}
// Keep complete leading sentences after a length-only validation failure.
// Revalidate all chess claims; never cut inside a sentence or blindly slice.
function shortenVerifiedExplanation(message,input,budget){
 const segments=String(message).match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)||[];
 if(segments.length<2)return null;
 for(let count=segments.length-1;count>=1;count--){
  const shortened=segments.slice(0,count).join('').trim();
  if(words(shortened)>=12&&!checkExplanation(shortened,input,budget).length)
   return shortened;
 }
 return null;
}
// Conservative causal-check guard: reject an explanation which attributes the
// Fool's Mate queen's *checking diagonal* to h3/pawn cover when the actual
// unobstructed ray is h4-g3-f2-e1. This intentionally does NOT reject a true
// general remark that the pawn no longer controls h3; only the asserted cause
// of the verified checkmate.
// A legal checking move may simply lose the checking piece to an immediate
// legal pawn response. Do not recommend it as profitable counterplay merely
// because it checks the king. The responder's capture is an OPTION, not proof
// the full variation is bad: defer to a verified Stockfish continuation.
function unsupportedLooseCheckingRecommendation(message,input){
 const candidates=input.tacticalFacts?.opponentCheckingReplyEvidence||[];
 const pvFirst=input.tacticalContinuation?.moves?.[0]?.uci||
  input.engine?.variations?.find(x=>x.rank===1)?.moves?.[0]?.uci;
 const issues=[];
 for(const reply of candidates){
  if(!reply?.pawnCapturesChecker?.length||!reply.checkLine?.checkingPieces?.length||
   reply.uci===pvFirst)continue;
  const checker=reply.checkLine.checkingPieces.find(x=>
   reply.pawnCapturesChecker.some(p=>p.to===x.from));
  if(!checker||!['bishop','knight','rook','queen'].includes(checker.piece))continue;
  const square=checker.from;
  const squareMentioned=new RegExp('\\b'+square+'\\b','i').test(message);
  const pieceMentioned=new RegExp('\\b'+checker.piece+'\\b','i').test(message);
  const checkMentioned=/\bcheck(?:ing)?\b/i.test(message);
  if(!squareMentioned||!pieceMentioned||!checkMentioned)continue;
  const unsafeClaim=/\b(?:lets?|allows?|can|could|threatens?|answer|reply|respond|follow(?:s|ing)?|punish(?:es)?|more active|stronger|better|tempo)\b/i.test(message);
  const acknowledgesCapture=/\b(?:pawn|recaptur\w*|capture\w*|take\w*|lose\w*|losing|sacrific\w*)\b/i.test(message)&&
   /\b(?:pawn\s+(?:can|could)|can\s+(?:simply\s+)?capture|recaptur\w*|take\w*\s+the\s+bishop|bishop\s+(?:is|would be)\s+(?:lost|taken)|loses?\s+(?:a|the)\s+bishop)\b/i.test(message);
  if(unsafeClaim&&!acknowledgesCapture)
   issues.push('Checking-piece safety: the proposed '+checker.piece+' check on '+square+
    ' permits the defender to capture the checking '+checker.piece+
    ' immediately with a pawn ('+reply.pawnCapturesChecker[0].uci+'). Do not offer this as a useful checking threat without engine evidence for compensation. Explain the played move instead.');
 }
 return [...new Set(issues)];
}
function unsupportedCheckMechanismClaims(message,input){
 const candidates=[
  ...(input.tacticalFacts?.opponentCheckingReplyEvidence||[]),
  ...(input.verifiedCheckLines||[])
 ];
 const mate=candidates.find(x=>x.checkLine?.checkmate&&
  x.checkLine.checkingPieces?.some(p=>p.piece==='queen'&&p.from==='h4'&&
   p.king==='e1'&&p.clearSquaresBetween?.includes('g3')&&
   p.clearSquaresBetween?.includes('f2')));
 if(!mate)return [];
 const sentences=message.split(/(?<=[.!?])\s+|[;:]/);
 if(sentences.some(x=>/\bh3\b/i.test(x)&&
  /\b(?:g[- ]?pawn|pawn|queen|mate|checkmate)\b/i.test(x)&&
  /\b(?:because|since|so|therefore|hence|means|allow(?:s|ing|ed)?|open(?:s|ing|ed)?|route|reason|danger|caus(?:e|es|ing))\b/i.test(x)))
  return ['The actual queen-checkmate diagonal is h4-g3-f2-e1, through the empty g3 and f2 squares. Do not attribute this checkmate to h3 or pawn cover on h3.'];
 return [];
}
// A suggested queen jump is not a useful fork if an opposing piece can
// simply take the queen on its destination. Validate this against actual
// after-FEN occupancy and attack rays (rather than square-control prose).
function unsupportedUnsafeQueenSuggestions(message,input){
 const boardText=typeof input.afterFen==='string'?input.afterFen.split(' ')[0]:null;
 const ranks=boardText?.split('/');
 if(ranks?.length!==8)return [];
 const board={};const files='abcdefgh';
 for(let r=0;r<8;r++){
  let f=0;
  for(const ch of ranks[r]){
   if(/[1-8]/.test(ch))f+=Number(ch);
   else if(/[pnbrqkPNBRQK]/.test(ch)){if(f>7)return [];board[files[f++]+(8-r)]=ch;}
   else return [];
  }
  if(f!==8)return [];
 }
 const square=(f,r)=>f>=0&&f<8&&r>=1&&r<=8?files[f]+r:null;
 const offset=(sq,df,dr)=>square(files.indexOf(sq[0])+df,Number(sq[1])+dr);
 const betweenClear=(from,to)=>{
  const df=Math.sign(files.indexOf(to[0])-files.indexOf(from[0]));
  const dr=Math.sign(Number(to[1])-Number(from[1]));
  let at=offset(from,df,dr);
  while(at&&at!==to){if(board[at])return false;at=offset(at,df,dr);}
  return at===to;
 };
 const attacks=(from,piece,to)=>{
  const dx=files.indexOf(to[0])-files.indexOf(from[0]),dy=Number(to[1])-Number(from[1]);
  const ax=Math.abs(dx),ay=Math.abs(dy),kind=piece.toLowerCase();
  if(kind==='p')return ay===1&&ax===1&&dy===(piece===piece.toUpperCase()?1:-1);
  if(kind==='n')return (ax===1&&ay===2)||(ax===2&&ay===1);
  if(kind==='k')return Math.max(ax,ay)===1;
  return (kind==='b'&&ax===ay||kind==='r'&&(dx===0||dy===0)||
   kind==='q'&&(ax===ay||dx===0||dy===0))&&
   (ax+ay)>0&&betweenClear(from,to);
 };
 const issues=[];
 // Restrict the check to positive suggestions of a queen move, not a
 // description of the queen already occupying a square.
 const re=/\bqueen\b[^.!?;]{0,95}?\b(?:move|moves|jump|jumps|go|goes|step|steps|to)\s+(?:to\s+)?([a-h][1-8])\b/gi;
 for(const match of message.matchAll(re)){
  const to=match[1],clause=match[0];
  const context=message.slice(Math.max(0,match.index-70),Math.min(message.length,match.index+match[0].length+60));
  if(/\b(?:avoid|never|not|don't|cannot|can't|bad|blunder|loses?|hangs?|unsafe|dangerous|punish)\b/i.test(context))continue;
  const named=/\bblack\b/i.test(context)?'q':/\bwhite\b/i.test(context)?'Q':null;
  const queens=Object.entries(board).filter(([,piece])=>piece.toLowerCase()==='q'&&(!named||piece===named));
  for(const [from,queen] of queens){
   if(from===to||!attacks(from,queen,to))continue;
   if(board[to]&&(board[to]===board[to].toUpperCase())===(queen===queen.toUpperCase()))continue;
   const captured=board[to];
   delete board[from];board[to]=queen;
   const enemies=Object.entries(board).filter(([at,p])=>at!==to&&
    (p===p.toUpperCase())!==(queen===queen.toUpperCase())&&attacks(at,p,to));
   delete board[to];board[from]=queen;if(captured)board[to]=captured;
   if(enemies.length){
    const [attacker,piece]=enemies[0];
    const name={p:'pawn',n:'knight',b:'bishop',r:'rook',q:'queen',k:'king'}[piece.toLowerCase()];
    issues.push('Unsafe queen suggestion: the proposed queen move to '+to+
     ' allows the opposing '+name+' on '+attacker+
     ' to capture the queen immediately. Do not recommend this move as useful pressure or a fork.');
    break;
   }
  }
 }
 return [...new Set(issues)];
}
// Engine evaluations are White-relative. Convert them to the side that
// actually played, so a Black move is graded from Black's point of view.
// Centipawn loss ALONE is not a blunder verdict: dropping from +5.8 to +2.0
// is a missed stronger win, whereas +2.9 to -4.5 loses a winning position.
function moveQualityContext(input){
 const a=input.moveAssessment||{},loss=a.centipawnLoss;
 const mover=input.mover||(input.isOpponentMove?
  (input.player==='White'?'Black':'White'):input.player);
 const sign=mover==='White'?1:mover==='Black'?-1:0;
 const available=Boolean(input.engine&&input.priorEngine)&&
  Number.isFinite(loss)&&loss>=0&&Number.isFinite(a.depth)&&a.depth>=10&&
  !a.playedIsEngineChoice&&sign!==0&&
  Number.isFinite(a.evaluationBefore)&&Number.isFinite(a.evaluationAfter);
 if(!available)return {kind:'ungraded',reason:'incomplete-evaluation'};
 const before=sign*a.evaluationBefore,after=sign*a.evaluationAfter;
 // Absolute thresholds are deliberately conservative and not chess-perfect:
 // depth-12 evaluations are approximate, especially around forced tactics.
 let kind='ordinary';
 if(loss>=300){
  if(before>=1.5&&after>=1.5)kind='missed-stronger-win';
  else if(before<=-1.5&&after<=-1.5)kind='already-losing';
  else if(before>=1.5&&after>-1.5)kind='squandered-winning-advantage';
  else if(after<=-1.5)kind='serious-deterioration';
  else kind='large-evaluation-drop';
 }
 return {kind,loss,before,after,depth:a.depth,
  approximate:a.approximate!==false};
}
function unsupportedSevereBlunderClaims(message,input){
 const assessment=moveQualityContext(input);
 if(assessment.kind==='ungraded')return [];
 const stronglyNegative=/\b(?:blunder|serious (?:mistake|error)|major (?:mistake|error)|severe (?:mistake|error)|disastrous|throws? (?:away|the game)|loses? the game)\b/i;
 if(assessment.kind==='missed-stronger-win'&&stronglyNegative.test(message))
  return ['Move severity: The player remains clearly winning before and after the move. Do not call this a blunder or serious mistake merely because an even stronger winning continuation existed. Describe the actual board consequence and, only with verified alternative evidence, a missed stronger win.'];
 if(assessment.kind==='already-losing'&&stronglyNegative.test(message))
  return ['Move severity: The player was already clearly losing. Explain the concrete worsening without automatically calling this move a new blunder.'];
 if(assessment.kind==='serious-deterioration'&&
    !/\b(?:blunder|major (?:mistake|error)|serious (?:mistake|error)|severe (?:mistake|error)|costly (?:mistake|error)|loses? (?:the |a )?queen|queen (?:for|against) (?:a |the )?rook|major (?:loss|material loss)|loses? substantial material|loses? the (?:winning )?advantage)\b/i.test(message))
  return ['Move severity: The played move turns a competitive or winning position into a clearly losing one. Identify the serious mistake and its verified tactical consequence; do not present it as neutral.'];
 return [];
}
// The learner's colour is fixed by the UI, not by the side that just moved.
// Correct explicit "your [piece] on [square]" ownership using board occupancy
// before validation. Avoid changing "your king" or "your pawn" without a
// named square because those references may legitimately concern the learner.
function coachPieceAtFen(fen,square){
 if(typeof fen!=='string'||!/^[a-h][1-8]$/.test(square))return null;
 const ranks=fen.split(' ')[0].split('/');
 if(ranks.length!==8)return null;
 const row=ranks[8-Number(square[1])];
 let file=0;
 for(const ch of row){
  if(/[1-8]/.test(ch))file+=Number(ch);
  else if(/[pnbrqkPNBRQK]/.test(ch)){
   if(file==='abcdefgh'.indexOf(square[0]))return ch;
   file++;
  }else return null;
 }
 return null;
}
function correctCoachPerspective(message,input){
 const learner=input.player||input.coachingGuidance?.playerColour;
 if(!['White','Black'].includes(learner))return {message,adjusted:false};
 const names={pawn:'p',knight:'n',bishop:'b',rook:'r',queen:'q',king:'k'};
 let adjusted=false;
 const corrected=String(message).replace(
  /\byour\s+(?:(pawn|knight|bishop|rook|queen|king)\s+(?:on|at)\s+([a-h][1-8])|([a-h][1-8])\s+(pawn|knight|bishop|rook|queen|king))\b/gi,
  (original,first,squareOne,squareTwo,last)=>{
   const type=(first||last).toLowerCase(),square=squareOne||squareTwo;
   const found=coachPieceAtFen(input.afterFen,square)||
    coachPieceAtFen(input.beforeFen,square);
   if(!found||found.toLowerCase()!==names[type])return original;
   const owner=found===found.toUpperCase()?'White':'Black';
   if(owner===learner)return original;
   adjusted=true;
   return owner+"'s "+(first?first+' on '+square:square+' '+last);
  }
 );
 return {message:corrected,adjusted};
}
// Coaching explains the move that JUST happened. Do not spoil the learner's
// next decision with an unsolicited candidate move for the side now to play.
function unsupportedAdvanceMoveAdvice(message,input){
 const nextSide=input.mover==='White'?'Black':input.mover==='Black'?'White':null;
 if(!nextSide)return [];
 const issues=[];
 const parts=String(message).split(/(?<=[.!?])\s+|[;]+/);
 for(const part of parts){
  // The next side is explicitly offered a concrete move/target or urged
  // to consider one. This includes the observed "Black should notice ... d5".
  const side=new RegExp('\\b'+nextSide+'\\b|\\b'+(nextSide==='White'?'White':'Black')+"'s\\b",'i');
  const explicitlyNext=side.test(part)||
   /\b(?:the (?:opponent|defender)|your (?:next|reply)|you (?:could|should|can))\b/i.test(part);
  const advice=/\b(?:should|could|can|might|consider|try|look for|notice|idea|option|opportunity|move|reply|respond|instead|best|better|stronger)\b/i.test(part);
  const namedAction=/\b(?:queen|knight|bishop|rook|pawn|king|move|advance|capture|take|play|develop|jump|push)\b[^.!?]{0,110}\b(?:to|on|at)\s+[a-h][1-8]\b/i.test(part)||
   /\b(?:[a-h][1-8])\b[^.!?]{0,45}\b(?:queen|knight|bishop|rook|pawn|move|idea)\b/i.test(part);
  if(explicitlyNext&&advice&&namedAction&&
     !/\b(?:avoid|cannot|can't|illegal|not possible|was just played)\b/i.test(part))
   issues.push('Advance move advice: do not tell '+nextSide+' a specific move to consider before they play. Explain only the completed move and its consequences; alternatives are retrospective for the side that just moved.');
 }
 return [...new Set(issues)];
}
function checkExplanation(message,input,budget){
 const issues=[];
 if(words(message)>budget.maxWords||sentences(message)>budget.maxSentences)
  issues.push('Too long for this move; preserve the most important factual explanation.');
 if(/\bconnect(?:s|ed|ing)? (?:your |the |white |black )?rooks\b/i.test(message)){
  // General connecting-rooks claims need verified positions and are better omitted.
  issues.push('Remove any claim about connecting rooks; concentrate on immediate board effects.');
 }
 if(!input.alternativeEvidence&&/\b(?:a better alternative|better (?:option|move)|stronger alternative|instead (?:play|move)|should have played)\b/i.test(message))
  issues.push('Remove the unsupported move recommendation entirely.');
 // If a suggested square is named, it must be the verified alternative destination.
 const alt=input.alternativeEvidence;
 if(alt&&/\b(?:better|stronger) (?:alternative|option|move)\b/i.test(message)){
  const target=alt.uci?.slice(2,4);
  const claimed=[...message.matchAll(/\b(?:move|develop|retreat|advance|capture|capturing|taking)\b[^.!?]{0,75}?\bto ([a-h][1-8])\b/gi)]
   .map(match=>match[1]);
  if(target&&claimed.length&&claimed.every(square=>square!==target))
   issues.push('The alternative move destination is inconsistent with the verified alternative. Remove the alternative.');
 }
 issues.push(...unsupportedDirectClaims(message,verifiedRelations(input)));
 issues.push(...unsupportedStructuralClaims(message,input));
 issues.push(...unsupportedPawnHistoryClaims(message,input));
 issues.push(...unsupportedExchangeClaims(message,input));
 issues.push(...unsupportedQueenTradeClaims(message,input));
 issues.push(...unsupportedMaterialSequenceClaims(message,input));
 issues.push(...unsupportedPrimaryTacticalClaims(message,input));
 issues.push(...unsupportedHangingMinorClaims(message,input));
 issues.push(...unsupportedFriendlyTargetClaims(message,input));
 issues.push(...unsupportedHypotheticalCheckClaims(message,input));
 issues.push(...unsupportedCheckMechanismClaims(message,input));
 issues.push(...unsupportedLooseCheckingRecommendation(message,input));
 issues.push(...unsupportedUnsafeQueenSuggestions(message,input));
 issues.push(...unsupportedAdvanceMoveAdvice(message,input));
 issues.push(...unsupportedSevereBlunderClaims(message,input));
 issues.push(...needlessEngineAttribution(message,input));
 return issues;
}
// Identify the exact rejecting guard, rather than inferring its identity from
// its human-readable error text. No text, board state or prompts are exposed.
function coachingGuardFailures(message,input,budget){
 const groups={
  length:words(message)>budget.maxWords||sentences(message)>budget.maxSentences,
  'direct-relations':unsupportedDirectClaims(message,verifiedRelations(input)).length>0,
  structure:unsupportedStructuralClaims(message,input).length>0,
  'pawn-history':unsupportedPawnHistoryClaims(message,input).length>0,
  exchange:unsupportedExchangeClaims(message,input).length>0,
  'queen-trade':unsupportedQueenTradeClaims(message,input).length>0,
  'material-sequence':unsupportedMaterialSequenceClaims(message,input).length>0,
  'primary-tactic':unsupportedPrimaryTacticalClaims(message,input).length>0,
  'minor-piece-safety':unsupportedHangingMinorClaims(message,input).length>0,
  'friendly-target':unsupportedFriendlyTargetClaims(message,input).length>0,
  'hypothetical-check':unsupportedHypotheticalCheckClaims(message,input).length>0,
  'check-mechanism':unsupportedCheckMechanismClaims(message,input).length>0,
  'loose-check-recommendation':unsupportedLooseCheckingRecommendation(message,input).length>0,
  'unsafe-queen-suggestion':unsupportedUnsafeQueenSuggestions(message,input).length>0,
  'advance-move-advice':unsupportedAdvanceMoveAdvice(message,input).length>0,
  'move-severity':unsupportedSevereBlunderClaims(message,input).length>0,
  'engine-attribution':needlessEngineAttribution(message,input).length>0
 };
 return Object.keys(groups).filter(x=>groups[x]);
}
// Return non-sensitive diagnostic codes, never previous model wording, prompts,
// private FENs, or raw validator explanations in an API error response.
function coachingValidationCodes(issues){
 const codes=new Set();
 for(const issue of issues){
  const x=String(issue).toLowerCase();
  if(x.includes('too long'))codes.add('length');
  else if(x.includes('capture sequence'))codes.add('capture-sequence');
  else if(x.includes('material sequence'))codes.add('material-accounting');
  else if(x.includes('primary tactic'))codes.add('primary-tactic');
   else if(x.includes('unsafe queen suggestion'))codes.add('unsafe-queen-suggestion');
  else if(x.includes('advance move advice'))codes.add('advance-move-advice');
  else if(x.includes('material threat'))codes.add('material-accounting');
  else if(x.includes('friendly target'))codes.add('friendly-target');
  else if(x.includes('hypothetical check'))codes.add('hypothetical-check');
  else if(x.includes('checking-piece safety'))codes.add('loose-check-recommendation');
  else if(x.includes('pawn file occupancy')||x.includes('pawn square occupancy')||x.includes('pawn structure'))codes.add('pawn-structure');
  else if(x.includes('pawn on ')||x.includes('directly defend')||x.includes('directly attack'))codes.add('piece-relation');
  else if(x.includes('bishop')||x.includes('file')||x.includes('central'))codes.add('position-structure');
  else if(x.includes('check')||x.includes('mate')||x.includes('diagonal')||x.includes('h3'))codes.add('check-mechanism');
  else if(x.includes('serious mistake')||x.includes('blunder')||x.includes('three pawns'))codes.add('move-severity');
  else if(x.includes('material')||x.includes('recapture')||x.includes('exchange')||x.includes('capture')||x.includes('wins'))codes.add('material-exchange');
  else if(x.includes('alternative')||x.includes('recommend'))codes.add('unsupported-alternative');
  else if(x.includes('rook'))codes.add('rook-claim');
  else codes.add('other');
 }
 return [...codes].sort();
}
// A response mentioning Stockfish is useful only when the engine verdict
// itself is instructionally important. Routine development is not a line recital.
function needlessEngineAttribution(message,input){
 const a=input.moveAssessment||{},loss=a.centipawnLoss;
 const meaningful=Number.isFinite(loss)&&loss>=120||
  input.tacticalFacts?.givesCheck||input.played?.check||
  input.engine?.mate!=null||
  input.coachingGuidance?.focus==='turning-point';
 if(meaningful||!/\b(?:stockfish|the engine(?:'s)?|engine(?:'s)? main line)\b/i.test(message))
  return [];
 return ['For an ordinary move, teach the concrete chess idea directly. Remove references to Stockfish or the engine and avoid listing speculative principal-variation moves.'];
}
const benchmarkVariants=Object.freeze({
 'mini-low':{model:'gpt-5.4-mini',effort:'low'},
 'mini-medium':{model:'gpt-5.4-mini',effort:'medium'},
 'full-medium':{model:'gpt-5.4',effort:'medium'}
});
const safeEqual=(a,b)=>{
 if(typeof a!=='string'||typeof b!=='string'||a.length<32||b.length<32)return false;
 // Constant-time string comparison without requiring external dependencies.
 const ab=new TextEncoder().encode(a),bb=new TextEncoder().encode(b);
 if(ab.length!==bb.length)return false;
 let difference=0;
 for(let i=0;i<ab.length;i++)difference|=ab[i]^bb[i];
 return difference===0;
};
function benchmarkAuthorization(event){
 const headers=event.headers||{};
 const sent=Object.entries(headers).find(([key])=>key.toLowerCase()==='x-chessking-benchmark-token')?.[1];
 return process.env.CHESSKING_BENCHMARK_ENABLED==='true'&&
  safeEqual(sent,process.env.CHESSKING_BENCHMARK_TOKEN);
}
async function generateCoaching(evidence,instructions,extra='',variant=null,usageLog=null){
 const response=await fetch('https://api.openai.com/v1/chat/completions',{
  method:'POST',
  headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({
   model:variant?.model||'gpt-5.4-mini',
   reasoning_effort:variant?.effort||'low',
   // Includes hidden reasoning tokens as well as the short visible response.
   max_completion_tokens:1800,
   messages:[
    {role:'system',content:instructions},
    {role:'user',content:JSON.stringify(evidence)},
    ...(extra?[{role:'user',content:extra}]:[])
   ]
  })
 });
 if(!response.ok){
  console.error('OpenAI request failed:',response.status);
  const error=new Error('AI coaching request failed');error.status=response.status;throw error;
 }
 const result=await response.json();
 if(usageLog&&result.usage){
  const u=result.usage;
  usageLog.push({prompt_tokens:Number(u.prompt_tokens)||0,
   completion_tokens:Number(u.completion_tokens)||0,
   prompt_tokens_details:{cached_tokens:Number(u.prompt_tokens_details?.cached_tokens)||0}});
 }
 const message=result.choices?.[0]?.message?.content?.trim();
 if(!message||message.length<15){
  console.warn('Empty AI response:',{finishReason:result.choices?.[0]?.finish_reason||'unknown',
   completionTokens:result.usage?.completion_tokens||0});
  throw Error('Empty AI response');
 }
 return message;
}

export const handler=async(event)=>{
 const method=event.requestContext?.http?.method;
 if(method==='OPTIONS')return reply(204,{});
 if(method!=='POST')return reply(405,{error:'Method not allowed'});
 if(!process.env.OPENAI_API_KEY)return reply(503,{error:'AI server not configured'});
 if(typeof event.body!=='string'||event.body.length>120000)return reply(413,{error:'Invalid request size'});
 let input;
 try{
  input=JSON.parse(event.body);
 }catch{
  return reply(400,{error:'Invalid JSON'});
 }
 const benchmarkRequested=Object.hasOwn(input,'benchmarkVariant');
 // Public requests cannot choose model variants or obtain token usage.
 // A long secret and an explicit Lambda deployment opt-in are both required.
 if(benchmarkRequested&&!benchmarkAuthorization(event))
  return reply(403,{error:'Benchmark not authorized'});
 const variant=benchmarkRequested?benchmarkVariants[input.benchmarkVariant]:null;
 if(benchmarkRequested&&!variant)return reply(400,{error:'Unknown benchmark variant'});
 const benchmarkUsages=benchmarkRequested?[]:null;
 if(typeof input.beforeFen!=='string'||typeof input.afterFen!=='string')
  return reply(400,{error:'Missing chess position'});
 const evidence={
  beforeFen:input.beforeFen,
  afterFen:input.afterFen,
  opening:input.opening,
  player:input.player,
  mover:input.mover,
  isOpponentMove:input.isOpponentMove,
  played:input.played,
  playedPlainEnglish:input.playedPlainEnglish,
  boardFacts:input.boardFacts,
  tacticalFacts:input.tacticalFacts,
  strategicFacts:input.strategicFacts,
  teachingPriorities:input.teachingPriorities,
  tacticalContinuation:input.tacticalContinuation||null,
  opponentReplyThreats:input.opponentReplyThreats||null,
  tacticalOpportunities:input.tacticalOpportunities||null,
  imminentQueenPinRisks:(input.opponentReplyThreats?.candidates||[]).filter(x=>x.newAbsolutePins?.some(p=>p.pinnedPiece==='queen')).slice(0,2).map(x=>({pinnedQueens:x.newAbsolutePins.filter(p=>p.pinnedPiece==='queen'),pinningPiece:x.piece,defenderCaptures:x.immediateDefenderCaptures?.length||0,stockfishFirstReply:!!x.stockfishFirstReply})),
  verifiedRelations:verifiedRelations(input),
  alternativeEvidence:input.alternativeEvidence,
  openingContext:input.openingContext,
  preparedMovePurpose:input.openingContext?.source==='selected-guided'&&
   typeof input.preparedMovePurpose==='string'?
   input.preparedMovePurpose.slice(0,250):null,
  coachingLevel:input.coachingLevel,
  engine:input.engine,
  moveAssessment:input.moveAssessment,
  moveQuality:moveQualityContext(input),
  positionAssessment:input.positionAssessment,
  priorEngine:input.priorEngine,
  verifiedTacticalContinuation:input.verifiedTacticalContinuation||null,
  guidance:input.coachingGuidance,
  recentCoaching:input.recentCoaching,
  history:input.history,
  scripted:input.scripted
 };
 try{
  const budget=coachingBudget(input);
  // A compact, general policy is more reliable than accumulated,
  // screenshot-specific exceptions. Every concrete claim is still validated.
  const instructions=[
   "You are Opening Lab's chess coach. Comment only AFTER the move that was just played.",
   "Player colour: "+input.player+"; move made by: "+input.mover+
    ". You/your always refer to the learner. Use White/Black when ownership is unclear.",
   "Choose the ONE most instructive, position-specific consequence of the completed move.",
   "Evaluate the move fairly: sound moves can still miss meaningful opportunities. Do not mislabel them as mistakes because Stockfish chose differently.",
   "If tacticalOpportunities.top contains a serious verified legal pin, fork or discovered attack, explain the threat it creates, whether the attacking piece can be captured, and how certain the evidence is. Prefer an important queen/king pin over generic development advice. A legally possible tactic is not necessarily profitable, forced or best.",
   "Describe immediate or one/two-ply risks without supplying the next player's move, destination, hint or solution. Mention a retrospective alternative only when guidance.explainAlternatives and alternativeEvidence supply a meaningful verified line for the player who JUST moved.",
   "Treat boardFacts, tacticalFacts, strategicFacts and the FEN as evidence of occupancy and geometry. OpponentReplyThreats and tacticalOpportunities describe legal candidate continuations, not engine endorsements; engine principal variations are possible best-play continuations, not automatically forced.",
   "Verify who attacks, defends, captures or recaptures what. Never describe a piece as directly protecting a named pawn unless it appears in verifiedRelations. Distinguish square control from protecting an occupied piece.",
   "A queen moving to attack multiple pieces is not a sensible fork if an opposing piece can capture that queen immediately. Account for available legal recaptures before making material claims. A legal capture can be bad.",
   "Only explain a concrete line when legal continuation evidence supports it. Do not fabricate positional motifs, checks, pin targets, piece safety, forced mate, material gains or best moves. Omit an uncertain claim instead.",
   "Use plain English (move the bishop to b5, not Bb5). Explain practical importance, not just piece coordinates. Avoid repetitive generic claims and padding.",
   "In Guided mode the opening plan is context, not an obligation after the ten prepared moves. Keep the actual board and consequences primary.",
   "An ordinary move can need just one or two sentences; important threats, missed opportunities or mistakes can take more. Ceiling: "+
    budget.maxWords+" words and "+budget.maxSentences+" sentences. This is not a target.",
   "Return only the natural-language coaching explanation."
  ].join("\n");

  let message=await generateCoaching(evidence,instructions,'',variant,benchmarkUsages);
  let perspective=correctCoachPerspective(message,input);
  message=perspective.message;
  let perspectiveAdjusted=perspective.adjusted;
  let issues=checkExplanation(message,input,budget);
  const initialValidationCodes=coachingValidationCodes(issues);
  const initialIssuesCount=issues.length;
  let repairAttempted=false;
  let repairCodes=[];
  // One repair pass only, to avoid excessive cost or latency. Never cut prose
  // mid-sentence, which can remove qualifications and distort chess advice.
  if(issues.length){
   repairAttempted=true;
   message=await generateCoaching(evidence,instructions,
    'Rewrite the explanation from scratch. Fix ALL these issues: '+issues.join(' ')+
    ' The prior output was: '+JSON.stringify(message)+
    '. Return only the revised, position-verified explanation. Do not add generic filler.',variant,benchmarkUsages);
   perspective=correctCoachPerspective(message,input);
   message=perspective.message;
   perspectiveAdjusted=perspectiveAdjusted||perspective.adjusted;
   issues=checkExplanation(message,input,budget);
   repairCodes=coachingValidationCodes(issues);
  }
  // A complete leading-sentence prefix is permissible only when the
  // remaining error concerns length alone and every validator re-passes.
  let shortened=false;
  if(issues.length&&issues.every(x=>x.startsWith('Too long for this move'))){
   const concise=shortenVerifiedExplanation(message,input,budget);
   if(concise){message=concise;issues=checkExplanation(message,input,budget);shortened=true;}
  }
  // Fail safely. Diagnostic categories contain no model output or source FEN.
  if(issues.length){
   const validationCodes=coachingValidationCodes(issues);
   // A plain pawn-for-pawn capture can still be explained reliably from FEN
   // and capture history if the model keeps making unsupported structural claims.
   const fallback=verifiedMajorCaptureFallback(input)||verifiedMotifFallback(input)||verifiedPawnCaptureFallback(input)||verifiedCaptureWithReplyFallback(input);
   if(fallback&&!checkExplanation(fallback,input,budget).length){
    console.warn('AI coaching used verified capture fallback:',validationCodes);
    return reply(200,{message:fallback,engineGrounded:false,
     ...(benchmarkRequested?{benchmark:{variant:input.benchmarkVariant,usage:benchmarkUsages}}:{}),
     validation:{perspectiveAdjusted,status:'fallback',repairAttempted,initialCodes:initialValidationCodes,
      finalCodes:validationCodes,reason:fallback===verifiedMajorCaptureFallback(input)?'verified-major-capture':fallback===verifiedMotifFallback(input)?'verified-motif':fallback===verifiedPawnCaptureFallback(input)?'verified-pawn-capture':'verified-exchange'}});
   }
   console.warn('AI coaching rejected; using verified neutral fallback:',validationCodes);
   return reply(200,{message:verifiedMotifFallback(input)||verifiedNeutralFallback(input),engineGrounded:false,
    ...(benchmarkRequested?{benchmark:{variant:input.benchmarkVariant,usage:benchmarkUsages}}:{}),
    validation:{status:'fallback',reason:verifiedMotifFallback(input)?'verified-motif':'verified-neutral',repairAttempted,
     initialCodes:initialValidationCodes,repairCodes,finalCodes:validationCodes,
     diagnostics:{initialIssueCount:initialIssuesCount,finalIssueCount:issues.length,
      guardFailures:coachingGuardFailures(message,input,budget)}}});
  }
  return reply(200,{
   message,
   ...(benchmarkRequested?{benchmark:{variant:input.benchmarkVariant,usage:benchmarkUsages}}:{}),
   engineGrounded:Boolean(input.engine||input.moveAssessment),
   validation:{perspectiveAdjusted,status:shortened?'shortened':repairAttempted?'repaired':'passed',
    repairAttempted,shortened,initialCodes:initialValidationCodes,repairCodes,finalCodes:[]}
  });
 }catch(error){
  console.error('Coach error:',{message:error?.message||'unknown',upstreamStatus:error?.status||null});
  // Upstream model failure must not leave the lesson with an empty coach.
  // This fallback makes no tactical assertions not supported by the board.
  return reply(200,{message:verifiedNeutralFallback(input),engineGrounded:false,
   validation:{status:'fallback',reason:verifiedMotifFallback(input)?'verified-motif':'ai-service-error',
    errorCode:error?.status===429?'upstream-rate-limit':
     error?.status?'upstream-http-error':
     error?.message==='Empty AI response'?'empty-model-response':'generation-error'}});
 }
};
