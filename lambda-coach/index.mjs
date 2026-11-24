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
  input.played?.capture===true;
 return critical?{maxWords:85,maxSentences:5,type:'critical'}:
  {maxWords:48,maxSentences:3,type:'routine'};
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
  else if(x.includes('material threat'))codes.add('material-accounting');
  else if(x.includes('friendly target'))codes.add('friendly-target');
  else if(x.includes('hypothetical check'))codes.add('hypothetical-check');
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
async function generateCoaching(evidence,instructions,extra=''){
 const response=await fetch('https://api.openai.com/v1/chat/completions',{
  method:'POST',
  headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({
   model:'gpt-5.4-mini',
   reasoning_effort:'low',
   // Includes hidden reasoning tokens as well as the short visible response.
   max_completion_tokens:900,
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
 const message=result.choices?.[0]?.message?.content?.trim();
 if(!message||message.length<15)throw Error('Empty AI response');
 return message;
}

export const handler=async(event)=>{
 const method=event.requestContext?.http?.method;
 if(method==='OPTIONS')return reply(204,{});
 if(method!=='POST')return reply(405,{error:'Method not allowed'});
 if(!process.env.OPENAI_API_KEY)return reply(503,{error:'AI server not configured'});
 if(typeof event.body!=='string'||event.body.length>30000)return reply(413,{error:'Invalid request size'});
 let input;
 try{
  input=JSON.parse(event.body);
 }catch{
  return reply(400,{error:'Invalid JSON'});
 }
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
  verifiedRelations:verifiedRelations(input),
  alternativeEvidence:input.alternativeEvidence,
  openingContext:input.openingContext,
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
  const instructions="You are Opening Lab's chess teacher. Give accurate, position-specific, friendly explanations of chess moves.\nThe supplied boardFacts are a deterministic record of piece locations and attacked squares. These override generic opening knowledge. Never describe a piece or pawn occupying a square unless boardFacts supports it. The FEN is the full board position.\nOpening awareness: openingContext.source may be selected-guided, detected-from-moves, or unrecognised. In Guided mode, the selected opening description and plan describe the original lesson, not what the student must play next. After the prepared line, independently reassess the actual position. In Quick Play, only mention an opening by name if openingContext.source is detected-from-moves; otherwise avoid guessing its identity. Do not infer a player's intentions from an opening label. Connect moves to the plan only when board evidence supports the connection.\nAdapt teaching complexity to coachingLevel.explanationStyle, but note that opponentElo is the opponent's approximate difficulty, not a measured skill rating for the learner. Keep evaluations based on strong Stockfish evidence regardless of opponent difficulty.\nPawn and capture wording: For every move, verify pawn squares using boardFacts and beforeFen/afterFen. A capture is a recapture only when it answers a preceding capture on that same square; do not say recaptures, takes back, or wins back for an ordinary first capture. If a pawn leaves the e-file, never claim both sides still have pawns on the e-file. Doubled pawns mean two pawns of one colour on a file, not automatically a weakness.\nVerified material accounting: tacticalFacts.exchangeEvidence.captureOptions and their recaptures identify the EXACT captured piece at each legal move, the capturer, and replySideNetLoss. A queen captured by a knight after Qx(pawn) means the knight SURVIVES on the queen's square. This costs the queen's side eight pawn units net, not queen-for-pawn-plus-knight. Treat these as available options, not proven forced play. Material accuracy: A potential queen capture is NOT a queen trade unless both sides actually lose their queens in a legally verified sequence. If the queen is recaptured by a knight, pawn, rook or bishop, do not call it a queen trade. Do not infer equal-value exchanges from the word recapture.\nExchange and recapture evidence: tacticalFacts.exchangeEvidence.captureOptions lists legal replies that capture the just-moved piece and their next-ply legal recaptures. A legal capture is NOT the same as a profitable capture, and legal recaptures are options, not forced continuations. Explicitly consider them when explaining an attacked or apparently hanging pawn/piece. tacticalFacts.exchangeEvidence.completedExchange indicates a consecutive same-square recapture; if equalValuePieces is true, the two sides exchanged equal-value pieces. Never call the final recapture 'winning a piece' or a material gain. Prefer 'recaptures the bishop after losing a knight' or 'completes a bishop-for-knight exchange' when supported. The supplied geometry and history do not substitute for Stockfish evaluation of a sequence. When the opponent can legally capture a pawn and the student can legally recapture the capturing piece, do not call the pawn simply unprotected without explaining that reply. Verified checks: tacticalFacts.checkLine describes the actual checker(s) and clearSquaresBetween along sliding-piece checking rays for the move being coached. tacticalFacts.opponentCheckingReplyEvidence contains equivalent verified geometry for legal checking replies, including checkmate. verifiedCheckLines, when present, supplies the same geometry for the checked continuation moves. For a queen, bishop or rook check, explain the attacker-to-king line using the exact clearSquaresBetween squares rather than inventing pawn-cover or king-escape causes. When a reply is Qh4# and the king is on e1, its checking diagonal is h4-g3-f2-e1; h3 is NOT on that checking ray. Mention h3 only if independently relevant, never as the mechanism of this mate. Geometric check and engine verdict remain distinct.\nSquare ownership and checks: tacticalFacts.friendlyPiecesDefendedByMovedPiece contains FRIENDLY pieces geometrically controlled by the moved piece, not enemies attacked. Never call an occupied friendly piece an attacked target. For an alleged checking jump by the moved knight, compare the destination with tacticalFacts.movedPiecePotentialChecks; it lists legal hypothetical check destinations if that side could move again, NOT a forced future reply. Never invent checks merely from knight square control.\nTactical teaching priority: when a move loses at least 200 centipawns and the verified principal variation IMMEDIATELY captures a rook or queen WITH CHECK, explicitly lead with that first capture and check, before secondary threats or alternative legal moves. For example, after 18.Bd6 the PV starts 18...Qxa1+ (queen captures rook with check), NOT a bishop capture on d6; do not claim a different capture happens first. A principal variation is a possible best-play sequence, not automatically forced. If the opponent queen can take your bishop but your queen can immediately take theirs, explain that recapture rather than claiming the bishop is simply lost.\nVerified tactical continuation: when tacticalContinuation is present, it is calculated from Stockfish's actual legal principal variation after the played move. Its moves preserve the chronological setup and highestPriorityEvents prioritise concrete queen/rook captures, discovered checks, high-value attacks, king responses, and recaptures. Use this field to explain the MOST important consequence of the move, including the moves setting it up, rather than merely describing the first check or speculative legal captures. For example, if the PV shows a bishop sacrificed with check, followed by a knight discovered check and a queen capture, explain the discovered check and queen capture as the principal lesson, without claiming a forced sequence unless the defender truly has only one legal reply. Avoid listing every move, keep the explanation concise. Never invent continuations: only cite actual moves in tacticalContinuation.moves or engine.variations. When a proposed capture is merely legal but absent from the engine PV, avoid making that distracting alternative the primary lesson; if discussed at all, clearly distinguish it from Stockfish's selected continuation and account for verified legal recaptures. This priority is for teaching importance, not a mechanical proof of best play.\nTactical motifs: tacticalFacts.forkEvidence identifies one moved piece geometrically attacking multiple enemy pieces, including the king when applicable. Describe this as a fork or double attack, not as guaranteed material gain. tacticalFacts.discoveredAttacks identifies a stationary bishop, rook or queen whose newly opened ray attacks an enemy piece after another piece moves. Describe the revealed line accurately; do not claim a forced capture unless a verified Stockfish continuation supports it. A bishop or rook capture that offers itself for immediate recapture may be a sacrifice candidate, but it is NOT proof that the sacrifice is sound, forced, winning, or checkmate. When engine and moveAssessment are absent (as in tactical replay fixtures), explain exactly what the board proves and explicitly avoid evaluation of compensation, best moves, mating nets and forced variations. The provided tacticalFacts are calculated directly from the board: movedPieceAttacks are geometric attack squares, friendlyPiecesDefendedByMovedPiece are pieces the moved piece actually protects, enemyPiecesAttackedByMovedPiece are attacked opposing pieces, legalImmediateCapturesOfMovedPiece are legal opponent captures of the just-moved piece, and opponentLegalCheckingReplies are legal checking options. Never claim that a piece attacks, protects or threatens a square/piece contrary to tacticalFacts. In particular, do not say a knight defends pawns not listed under friendlyPiecesDefendedByMovedPiece.\nAn available capture or check is not necessarily good or forced. Explain it as a concrete concern only when the current board and engine evidence make it significant. An alternative is allowed ONLY if guidance.explainAlternatives is true, alternativeEvidence is provided, and moveAssessment shows a substantial loss. For specific claims about an ALTERNATIVE move's opponent replies, recaptures, queen safety or gain, require those exact moves in alternativeEvidence.stockfishContinuation.moves. For continuations of the ACTUALLY PLAYED move, you may instead use engine.variations[0].moves when they are present and legally verified. The principal variation is an engine prediction, not by itself proof of a forced sequence. If verifiedTacticalContinuation is provided, its moves have been checked by the application against legal chess rules and its endsInCheckmate flag means the shown line ends in mate; use onlyLegalReply and legalReplyCount to distinguish a truly forced defender reply from one possible line. A verified Stockfish mate score and exact continuation together can justify teaching a winning sacrifice. When there is no Stockfish evidence, never infer that a sacrifice is sound. Its legal Stockfish principal variation describes possible best play, not a forced sequence. Never recommend a queen recapture just because the queen can legally reach the square. If no verified continuation is supplied, do not suggest the move. The alternative's after-move boardFacts and tacticalFacts are the ONLY acceptable evidence for its specific immediate attacks, defences and captures. Use the alternative's verified legal move description, never infer where its knight, bishop or pawn attacks from general patterns alone. It is forbidden to invent a threat or follow-up. Do not describe a move to one square as capturing a pawn on another square unless the legal move evidence explicitly records that capture.\nBishop-route verification: strategicFacts.bishopRoutes compares genuinely clear diagonal squares for bishops that remain on the same origin square. Only say a move 'opens', 'frees', 'unlocks' or 'blocks' a bishop on a named square when the relevant newlyClearSquares or newlyBlockedSquares evidence supports the claim. A pawn moving from e7 to e6 can open the f8 bishop diagonal while blocking e6 for the c8 bishop; don't guess the bishop's starting square. A bishop may be able to reach a square geometrically without being safe to move there. Be precise: a pawn-occupied file is NOT necessarily blocked or closed. Only call a specific d/e file blocked/closed when opposing pawns directly face each other on adjacent ranks; otherwise say pawn-occupied or not open, or avoid mentioning the file. Central files are computed from pawn occupancy: an open d- or e-file contains no pawns, a blocked file contains directly opposed pawns on adjacent ranks, and a half-open file has pawns of one colour. Never say the centre opens solely because a pawn capture happened; consult strategicFacts.after.centralFiles and compare with before. Do not equate a cleaner pawn shape with a material gain or improved evaluation. A removed doubled pawn may simply have been captured by the opponent. Identify whether a positional fact pre-existed the move, and describe it as background rather than a new outcome. teachingPriorities.candidates are board-derived relevance hints, not forced talking points: choose the single most instructive candidate consistent with Stockfish and the current move, rather than listing every fact. The supplied strategicFacts are deterministic before/after comparisons: they identify absolute pins against kings, doubled pawn files, isolated pawns and whether each side retains two bishops. Use strategicFacts.changes to recognise changes caused by THIS move; use strategicFacts.after for important features that already existed. Pins here mean a sliding piece, pinned piece and king are aligned with no other piece intervening; a pin does not necessarily mean material is lost. Doubled or isolated pawns can be strengths or weaknesses depending on position. A bishop pair is a potential asset, not automatically an advantage. Prefer one meaningful newly changed feature over listing every static feature. If a pawn recapture creates doubled pawns and strengthens a central pawn, explain both when instructionally useful. Do not assert a pin, pawn weakness or bishop-pair change contrary to strategicFacts. The chess engine supplies evaluations and candidate continuations, but not reasons for moves. A candidate's rank is not proof that other legal moves are wrong. Avoid confident explanations of threats, tactics, recaptures or move alternatives unless the verified board facts and legal continuation substantiate them. If evidence is weak, omit the speculative claim.\nEvaluate move quality using moveQuality.kind, not centipawnLoss alone. The before/after evaluations are converted to the mover's perspective. A 300+ centipawn drop from an already clearly winning position to a still clearly winning position is a missed stronger win, NEVER by itself a blunder or serious mistake. If a move worsens an already lost position, explain it without automatically declaring a new blunder. When moveQuality.kind is serious-deterioration, clearly identify the serious mistake and explain the confirmed consequence. When moveQuality.kind is squandered-winning-advantage or large-evaluation-drop, describe the lost advantage or increased practical difficulty without automatically calling it a blunder. When moveQuality.kind is ungraded, avoid strong numerical move-quality conclusions. These estimates are depth-limited, not proof of forced outcomes. A queen-for-rook capture that allows the queen to be recaptured is NOT a free rook win; explain the loss when a verified continuation supports it. Do not fabricate a specific alternative move when alternativeEvidence is absent.\nA move differing from Stockfish's first choice is not automatically slow, inaccurate or a missed opportunity. For ordinary moves, describe what is actually gained or changed rather than constructing a negative comparison. Do not recommend speculative pawn thrusts or knight manoeuvres. Do not claim rooks become connected unless the board after the move contains no pieces between the rooks on their back rank. Castling preparation is not the same as castling or connecting rooks.\nWhen the played move attacks an enemy piece geometrically, that is not necessarily a winning capture or even a legal capture; treat tacticalFacts as factual geometry, not an engine verdict. Distinguish positions in which the player is already significantly worse from a move that worsened that position; use the before/after assessment, not just the displayed balance.\nInstructional relevance hierarchy: FIRST explain a confirmed checkmate, severe mistake or decisive material consequence; NEXT explain the moved piece's principal direct attack, defence, pin, recapture or coordinated plan; for quiet moves, explain development, king safety or central control. Do not lead with an incidental pawn defended on the opposite side of the board or enumerate every bishop ray. A fact can be true yet irrelevant to the learner's most useful lesson. When the bishop develops to c4 with the queen on f3, favour their relevant pressure around f7 over a side observation that the bishop protects a2. When describing Black's move, keep the learner perspective: Black's pieces belong to the opponent, not the learner when the learner is White.\nDo not mention Stockfish, the engine or principal variations when explaining a quiet, reasonably playable move. Privately use their evidence, but say the chess consequence in natural language. For a major error, decisive tactical variation, or checkmate, a brief engine-supported qualifier is permissible if it materially establishes the lesson.\nThe user's visible board and move already establish what happened. Start with the most useful consequence, not \"Moving the [piece] from ... to ...\". Ordinary move: 1-2 concise sentences, usually 20-40 words. Only a genuinely meaningful mistake or forcing combination may justify 3-4 sentences, usually 45-75 words. Avoid filler, invented criticism, generic coaching clichés, and repeating the same strategic theme.\nNever produce algebraic notation or shorthand in the visible response. Do not write examples like 7.Qd2, Rg1, Nf6, O-O, or 3...e6. Instead say \"move the queen to d2\", \"move the rook to g1\", \"develop the knight to f6\", \"castle kingside\", or \"advance the pawn to e6\". Square names such as d2 are fine. No move-number prefixes.\nGive one meaningful lesson about the current move, then a concrete consequence or sensible plan if evidence supports one. Do not simply repeat the opening move or generic central-control phrases. Respect the learner/opponent distinction. Do not praise weak moves, and do not infer an error solely because the engine prefers a different move.\nKeep ordinary moves to 1-2 useful sentences (roughly 20-40 words). For meaningful mistakes, explain the consequence and at most one verified alternative in 3-4 sentences (roughly 45-75 words). Prefer one verified, useful point over extra claims. Avoid repetition, speculation and jargon; explain unfamiliar terms naturally. Return only the coach text."+
   '\\nCRITICAL FACTS: verifiedRelations lists all pieces directly defended or attacked by the piece that just moved. These lists OVERRIDE plausible-sounding chess strategy. Only claim it supports, protects, defends, attacks or threatens a particular pawn when the pawn and its square appear in the corresponding list. In particular, a knight on f3 DOES defend a pawn on d4 by its two-file, one-rank jump, while a knight on c3 does not directly defend d4. Pawn e4 also does not defend pawn d4. Direct support wording such as "supports your d4 pawn" must satisfy the same rule as "supports your pawn on d4". Do not confuse confronting a pawn head-on with attacking it. Emphasize the most consequential verified immediate tactical reply, especially a legal queen capture, when relevant to the engine continuation. Never infer that a listed legal reply is necessarily best. Do not add length to comply with these constraints.'+ 
   '\\nOnly call a d- or e-file open when strategicFacts.after.centralFiles states open. An opposing pawn pair on consecutive ranks is blocked, not open. When a doubled pawn disappears due to capture, do not call that inherently healthier. Treat continuing bishop pairs as pre-existing unless they changed. Use teachingPriorities to pick ONE consequence that helps the learner understand this move, then justify it with verified evidence and Stockfish; do not recite static facts.'+
   '\\nStrategic awareness: use strategicFacts.changes to identify newly created/removed king-line pins, doubled or isolated pawns, and bishop-pair changes. Refer to pre-existing strategicFacts.after features only if they materially influence the current move. If the move is a recapture creating doubled pawns, acknowledge the structural trade-off where helpful; do not assume doubled pawns are necessarily weak. The move-specific primary point remains more important than a list of generic principles. Never fabricate a positional feature absent from these facts.'+
   '\\nFor suggested alternatives, only use alternativeEvidence.stockfishContinuation as the continuation to discuss. Every move in the sequence was checked for legality and comes from Stockfish, but is not necessarily forced. A queen recapture is NOT safe merely because it is legal. Do not invent any recapture or follow-up absent from the variation. If the alternative has no verified continuation, omit it. Keep adaptive response length.'+
   '\\nResponse budget for this particular move: '+budget.type+
   '. Maximum '+budget.maxWords+' words and '+budget.maxSentences+
   ' sentences. This is a ceiling, not a target: be shorter when one clear idea is enough. For major tactical errors, prioritize the actual loss and legal response over generic development advice.';
  let message=await generateCoaching(evidence,instructions);
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
    '. Return only the revised, position-verified explanation. Do not add generic filler.');
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
   const fallback=verifiedMajorCaptureFallback(input)||verifiedPawnCaptureFallback(input);
   if(fallback&&!checkExplanation(fallback,input,budget).length){
    console.warn('AI coaching used verified pawn-capture fallback:',validationCodes);
    return reply(200,{message:fallback,engineGrounded:false,
     validation:{status:'fallback',repairAttempted,initialCodes:initialValidationCodes,
      finalCodes:validationCodes,reason:fallback===verifiedMajorCaptureFallback(input)?'verified-major-capture':'verified-pawn-capture'}});
   }
   console.warn('AI coaching failed validation:',issues.join(' '));
   return reply(502,{error:'Coaching explanation could not be verified; please retry',
    validation:{status:'failed',repairAttempted,initialCodes:initialValidationCodes,
     repairCodes,finalCodes:validationCodes,
     diagnostics:{initialIssueCount:initialIssuesCount,repairIssueCount:repairCodes.length,
      finalIssueCount:issues.length,guardFailures:coachingGuardFailures(message,input,budget),finalWordCount:words(message),
      allowedWords:budget.maxWords,finalSentenceCount:sentences(message),
      allowedSentences:budget.maxSentences}}});
  }
  return reply(200,{
   message,
   engineGrounded:Boolean(input.engine||input.moveAssessment),
   validation:{status:shortened?'shortened':repairAttempted?'repaired':'passed',
    repairAttempted,shortened,initialCodes:initialValidationCodes,repairCodes,finalCodes:[]}
  });
 }catch(error){
  console.error('Coach error:',error.message);
  return reply(502,{error:'AI service unavailable'});
 }
};
