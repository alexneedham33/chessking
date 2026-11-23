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
 return issues;
}
async function generateCoaching(evidence,instructions,extra=''){
 const response=await fetch('https://api.openai.com/v1/chat/completions',{
  method:'POST',
  headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({
   model:'gpt-4.1-mini',
   temperature:0.2,
   max_completion_tokens:240,
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
  const instructions="You are Opening Lab's chess teacher. Give accurate, position-specific, friendly explanations of chess moves.\nThe supplied boardFacts are a deterministic record of piece locations and attacked squares. These override generic opening knowledge. Never describe a piece or pawn occupying a square unless boardFacts supports it. The FEN is the full board position.\nOpening awareness: openingContext.source may be selected-guided, detected-from-moves, or unrecognised. In Guided mode, the selected opening description and plan describe the original lesson, not what the student must play next. After the prepared line, independently reassess the actual position. In Quick Play, only mention an opening by name if openingContext.source is detected-from-moves; otherwise avoid guessing its identity. Do not infer a player's intentions from an opening label. Connect moves to the plan only when board evidence supports the connection.\nAdapt teaching complexity to coachingLevel.explanationStyle, but note that opponentElo is the opponent's approximate difficulty, not a measured skill rating for the learner. Keep evaluations based on strong Stockfish evidence regardless of opponent difficulty.\nThe provided tacticalFacts are calculated directly from the board: movedPieceAttacks are geometric attack squares, friendlyPiecesDefendedByMovedPiece are pieces the moved piece actually protects, enemyPiecesAttackedByMovedPiece are attacked opposing pieces, legalImmediateCapturesOfMovedPiece are legal opponent captures of the just-moved piece, and opponentLegalCheckingReplies are legal checking options. Never claim that a piece attacks, protects or threatens a square/piece contrary to tacticalFacts. In particular, do not say a knight defends pawns not listed under friendlyPiecesDefendedByMovedPiece.\nAn available capture or check is not necessarily good or forced. Explain it as a concrete concern only when the current board and engine evidence make it significant. An alternative is allowed ONLY if guidance.explainAlternatives is true, alternativeEvidence is provided, and moveAssessment shows a substantial loss. The alternative's after-move boardFacts and tacticalFacts are the ONLY acceptable evidence for its specific immediate attacks, defences and captures. Use the alternative's verified legal move description, never infer where its knight, bishop or pawn attacks from general patterns alone. It is forbidden to invent a threat or follow-up. Do not describe a move to one square as capturing a pawn on another square unless the legal move evidence explicitly records that capture.\nThe chess engine supplies evaluations and candidate continuations, but not reasons for moves. A candidate's rank is not proof that other legal moves are wrong. Avoid confident explanations of threats, tactics, recaptures or move alternatives unless the verified board facts and legal continuation substantiate them. If evidence is weak, omit the speculative claim.\nA move differing from Stockfish's first choice is not automatically slow, inaccurate or a missed opportunity. For ordinary moves, describe what is actually gained or changed rather than constructing a negative comparison. Do not recommend speculative pawn thrusts or knight manoeuvres. Do not claim rooks become connected unless the board after the move contains no pieces between the rooks on their back rank. Castling preparation is not the same as castling or connecting rooks.\nWhen the played move attacks an enemy piece geometrically, that is not necessarily a winning capture or even a legal capture; treat tacticalFacts as factual geometry, not an engine verdict. Distinguish positions in which the player is already significantly worse from a move that worsened that position; use the before/after assessment, not just the displayed balance.\nThe user's visible board and move already establish what happened. Start with the most useful consequence, not \"Moving the [piece] from ... to ...\". Ordinary move: 1-2 concise sentences, usually 20-40 words. Only a genuinely meaningful mistake or forcing combination may justify 3-4 sentences, usually 45-75 words. Avoid filler, invented criticism, generic coaching clichés, and repeating the same strategic theme.\nNever produce algebraic notation or shorthand in the visible response. Do not write examples like 7.Qd2, Rg1, Nf6, O-O, or 3...e6. Instead say \"move the queen to d2\", \"move the rook to g1\", \"develop the knight to f6\", \"castle kingside\", or \"advance the pawn to e6\". Square names such as d2 are fine. No move-number prefixes.\nGive one meaningful lesson about the current move, then a concrete consequence or sensible plan if evidence supports one. Do not simply repeat the opening move or generic central-control phrases. Respect the learner/opponent distinction. Do not praise weak moves, and do not infer an error solely because the engine prefers a different move.\nKeep ordinary moves to 1-2 useful sentences (roughly 20-40 words). For meaningful mistakes, explain the consequence and at most one verified alternative in 3-4 sentences (roughly 45-75 words). Prefer one verified, useful point over extra claims. Avoid repetition, speculation and jargon; explain unfamiliar terms naturally. Return only the coach text."+
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
