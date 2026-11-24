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
   {type:'defence',re:/\b(?:supports?|defends?|protects?|guards?|back(?:s|ing)? up)\b[^.!?;,]{0,65}?\b(?:your|white(?:'s)?|black(?:'s)?|the)\s+pawn\s+(?:on|at)\s+([a-h][1-8])\b/gi,valid:defended},
   {type:'attack',re:/\b(?:attacks?|threatens?|targets?)\b[^.!?;,]{0,65}?\b(?:your|white(?:'s)?|black(?:'s)?|the)\s+pawn\s+(?:on|at)\s+([a-h][1-8])\b/gi,valid:attacked}
  ];
  for(const p of phrases)for(const match of clause.matchAll(p.re)){
   if(!p.valid.has(match[1]))
    errors.push('The moved piece does not directly '+(p.type==='defence'?'defend':'attack')+' the pawn on '+match[1]+'. Remove that claim.');
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
 issues.push(...unsupportedExchangeClaims(message,input));
 return issues;
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
  verifiedRelations:verifiedRelations(input),
  alternativeEvidence:input.alternativeEvidence,
  openingContext:input.openingContext,
  coachingLevel:input.coachingLevel,
  engine:input.engine,
  moveAssessment:input.moveAssessment,
  positionAssessment:input.positionAssessment,
  priorEngine:input.priorEngine,
  guidance:input.coachingGuidance,
  recentCoaching:input.recentCoaching,
  history:input.history,
  scripted:input.scripted
 };
 try{
  const budget=coachingBudget(input);
  const instructions="You are Opening Lab's chess teacher. Give accurate, position-specific, friendly explanations of chess moves.\nThe supplied boardFacts are a deterministic record of piece locations and attacked squares. These override generic opening knowledge. Never describe a piece or pawn occupying a square unless boardFacts supports it. The FEN is the full board position.\nOpening awareness: openingContext.source may be selected-guided, detected-from-moves, or unrecognised. In Guided mode, the selected opening description and plan describe the original lesson, not what the student must play next. After the prepared line, independently reassess the actual position. In Quick Play, only mention an opening by name if openingContext.source is detected-from-moves; otherwise avoid guessing its identity. Do not infer a player's intentions from an opening label. Connect moves to the plan only when board evidence supports the connection.\nAdapt teaching complexity to coachingLevel.explanationStyle, but note that opponentElo is the opponent's approximate difficulty, not a measured skill rating for the learner. Keep evaluations based on strong Stockfish evidence regardless of opponent difficulty.\nExchange and recapture evidence: tacticalFacts.exchangeEvidence.captureOptions lists legal replies that capture the just-moved piece and their next-ply legal recaptures. A legal capture is NOT the same as a profitable capture, and legal recaptures are options, not forced continuations. Explicitly consider them when explaining an attacked or apparently hanging pawn/piece. tacticalFacts.exchangeEvidence.completedExchange indicates a consecutive same-square recapture; if equalValuePieces is true, the two sides exchanged equal-value pieces. Never call the final recapture 'winning a piece' or a material gain. Prefer 'recaptures the bishop after losing a knight' or 'completes a bishop-for-knight exchange' when supported. The supplied geometry and history do not substitute for Stockfish evaluation of a sequence. When the opponent can legally capture a pawn and the student can legally recapture the capturing piece, do not call the pawn simply unprotected without explaining that reply. Tactical motifs: tacticalFacts.forkEvidence identifies one moved piece geometrically attacking multiple enemy pieces, including the king when applicable. Describe this as a fork or double attack, not as guaranteed material gain. tacticalFacts.discoveredAttacks identifies a stationary bishop, rook or queen whose newly opened ray attacks an enemy piece after another piece moves. Describe the revealed line accurately; do not claim a forced capture unless a verified Stockfish continuation supports it. A bishop or rook capture that offers itself for immediate recapture may be a sacrifice candidate, but it is NOT proof that the sacrifice is sound, forced, winning, or checkmate. When engine and moveAssessment are absent (as in tactical replay fixtures), explain exactly what the board proves and explicitly avoid evaluation of compensation, best moves, mating nets and forced variations. The provided tacticalFacts are calculated directly from the board: movedPieceAttacks are geometric attack squares, friendlyPiecesDefendedByMovedPiece are pieces the moved piece actually protects, enemyPiecesAttackedByMovedPiece are attacked opposing pieces, legalImmediateCapturesOfMovedPiece are legal opponent captures of the just-moved piece, and opponentLegalCheckingReplies are legal checking options. Never claim that a piece attacks, protects or threatens a square/piece contrary to tacticalFacts. In particular, do not say a knight defends pawns not listed under friendlyPiecesDefendedByMovedPiece.\nAn available capture or check is not necessarily good or forced. Explain it as a concrete concern only when the current board and engine evidence make it significant. An alternative is allowed ONLY if guidance.explainAlternatives is true, alternativeEvidence is provided, and moveAssessment shows a substantial loss. For specific claims about the opponent's response to an alternative, a recapture, queen safety or a tactical gain, require those exact moves in alternativeEvidence.stockfishContinuation.moves. Its legal Stockfish principal variation describes possible best play, not a forced sequence. Never recommend a queen recapture just because the queen can legally reach the square. If no verified continuation is supplied, do not suggest the move. The alternative's after-move boardFacts and tacticalFacts are the ONLY acceptable evidence for its specific immediate attacks, defences and captures. Use the alternative's verified legal move description, never infer where its knight, bishop or pawn attacks from general patterns alone. It is forbidden to invent a threat or follow-up. Do not describe a move to one square as capturing a pawn on another square unless the legal move evidence explicitly records that capture.\nBishop-route verification: strategicFacts.bishopRoutes compares genuinely clear diagonal squares for bishops that remain on the same origin square. Only say a move 'opens', 'frees', 'unlocks' or 'blocks' a bishop on a named square when the relevant newlyClearSquares or newlyBlockedSquares evidence supports the claim. A pawn moving from e7 to e6 can open the f8 bishop diagonal while blocking e6 for the c8 bishop; don't guess the bishop's starting square. A bishop may be able to reach a square geometrically without being safe to move there. Be precise: a pawn-occupied file is NOT necessarily blocked or closed. Only call a specific d/e file blocked/closed when opposing pawns directly face each other on adjacent ranks; otherwise say pawn-occupied or not open, or avoid mentioning the file. Central files are computed from pawn occupancy: an open d- or e-file contains no pawns, a blocked file contains directly opposed pawns on adjacent ranks, and a half-open file has pawns of one colour. Never say the centre opens solely because a pawn capture happened; consult strategicFacts.after.centralFiles and compare with before. Do not equate a cleaner pawn shape with a material gain or improved evaluation. A removed doubled pawn may simply have been captured by the opponent. Identify whether a positional fact pre-existed the move, and describe it as background rather than a new outcome. teachingPriorities.candidates are board-derived relevance hints, not forced talking points: choose the single most instructive candidate consistent with Stockfish and the current move, rather than listing every fact. The supplied strategicFacts are deterministic before/after comparisons: they identify absolute pins against kings, doubled pawn files, isolated pawns and whether each side retains two bishops. Use strategicFacts.changes to recognise changes caused by THIS move; use strategicFacts.after for important features that already existed. Pins here mean a sliding piece, pinned piece and king are aligned with no other piece intervening; a pin does not necessarily mean material is lost. Doubled or isolated pawns can be strengths or weaknesses depending on position. A bishop pair is a potential asset, not automatically an advantage. Prefer one meaningful newly changed feature over listing every static feature. If a pawn recapture creates doubled pawns and strengthens a central pawn, explain both when instructionally useful. Do not assert a pin, pawn weakness or bishop-pair change contrary to strategicFacts. The chess engine supplies evaluations and candidate continuations, but not reasons for moves. A candidate's rank is not proof that other legal moves are wrong. Avoid confident explanations of threats, tactics, recaptures or move alternatives unless the verified board facts and legal continuation substantiate them. If evidence is weak, omit the speculative claim.\nA move differing from Stockfish's first choice is not automatically slow, inaccurate or a missed opportunity. For ordinary moves, describe what is actually gained or changed rather than constructing a negative comparison. Do not recommend speculative pawn thrusts or knight manoeuvres. Do not claim rooks become connected unless the board after the move contains no pieces between the rooks on their back rank. Castling preparation is not the same as castling or connecting rooks.\nWhen the played move attacks an enemy piece geometrically, that is not necessarily a winning capture or even a legal capture; treat tacticalFacts as factual geometry, not an engine verdict. Distinguish positions in which the player is already significantly worse from a move that worsened that position; use the before/after assessment, not just the displayed balance.\nThe user's visible board and move already establish what happened. Start with the most useful consequence, not \"Moving the [piece] from ... to ...\". Ordinary move: 1-2 concise sentences, usually 20-40 words. Only a genuinely meaningful mistake or forcing combination may justify 3-4 sentences, usually 45-75 words. Avoid filler, invented criticism, generic coaching clichés, and repeating the same strategic theme.\nNever produce algebraic notation or shorthand in the visible response. Do not write examples like 7.Qd2, Rg1, Nf6, O-O, or 3...e6. Instead say \"move the queen to d2\", \"move the rook to g1\", \"develop the knight to f6\", \"castle kingside\", or \"advance the pawn to e6\". Square names such as d2 are fine. No move-number prefixes.\nGive one meaningful lesson about the current move, then a concrete consequence or sensible plan if evidence supports one. Do not simply repeat the opening move or generic central-control phrases. Respect the learner/opponent distinction. Do not praise weak moves, and do not infer an error solely because the engine prefers a different move.\nKeep ordinary moves to 1-2 useful sentences (roughly 20-40 words). For meaningful mistakes, explain the consequence and at most one verified alternative in 3-4 sentences (roughly 45-75 words). Prefer one verified, useful point over extra claims. Avoid repetition, speculation and jargon; explain unfamiliar terms naturally. Return only the coach text."+
   '\\nCRITICAL FACTS: verifiedRelations lists all pieces directly defended or attacked by the piece that just moved. These lists OVERRIDE plausible-sounding chess strategy. Only claim it supports, protects, defends, attacks or threatens a particular pawn when the pawn and its square appear in the corresponding list. In particular, knight c3 does not defend pawn d4, and pawn e4 does not defend pawn d4. Do not confuse confronting a pawn head-on with attacking it. Emphasize the most consequential verified immediate tactical reply, especially a legal queen capture, when relevant to the engine continuation. Never infer that a listed legal reply is necessarily best. Do not add length to comply with these constraints.'+ 
   '\\nOnly call a d- or e-file open when strategicFacts.after.centralFiles states open. An opposing pawn pair on consecutive ranks is blocked, not open. When a doubled pawn disappears due to capture, do not call that inherently healthier. Treat continuing bishop pairs as pre-existing unless they changed. Use teachingPriorities to pick ONE consequence that helps the learner understand this move, then justify it with verified evidence and Stockfish; do not recite static facts.'+
   '\\nStrategic awareness: use strategicFacts.changes to identify newly created/removed king-line pins, doubled or isolated pawns, and bishop-pair changes. Refer to pre-existing strategicFacts.after features only if they materially influence the current move. If the move is a recapture creating doubled pawns, acknowledge the structural trade-off where helpful; do not assume doubled pawns are necessarily weak. The move-specific primary point remains more important than a list of generic principles. Never fabricate a positional feature absent from these facts.'+
   '\\nFor suggested alternatives, only use alternativeEvidence.stockfishContinuation as the continuation to discuss. Every move in the sequence was checked for legality and comes from Stockfish, but is not necessarily forced. A queen recapture is NOT safe merely because it is legal. Do not invent any recapture or follow-up absent from the variation. If the alternative has no verified continuation, omit it. Keep adaptive response length.'+
   '\\nResponse budget for this particular move: '+budget.type+
   '. Maximum '+budget.maxWords+' words and '+budget.maxSentences+
   ' sentences. This is a ceiling, not a target: be shorter when one clear idea is enough. For major tactical errors, prioritize the actual loss and legal response over generic development advice.';
  let message=await generateCoaching(evidence,instructions);
  let issues=checkExplanation(message,input,budget);
  // One repair pass only, to avoid excessive cost or latency. Never cut prose
  // mid-sentence, which can remove qualifications and distort chess advice.
  if(issues.length){
   message=await generateCoaching(evidence,instructions,
    'Rewrite the explanation from scratch. Fix ALL these issues: '+issues.join(' ')+
    ' The prior output was: '+JSON.stringify(message)+
    '. Return only the revised, position-verified explanation. Do not add generic filler.');
   issues=checkExplanation(message,input,budget);
  }
  // Fail safely rather than delivering a known-invalid explanation.
  if(issues.length){
   console.warn('AI coaching failed validation:',issues.join(' '));
   return reply(502,{error:'Coaching explanation could not be verified; please retry'});
  }
  return reply(200,{
   message,
   engineGrounded:Boolean(input.engine||input.moveAssessment)
  });
 }catch(error){
  console.error('Coach error:',error.message);
  return reply(502,{error:'AI service unavailable'});
 }
};
