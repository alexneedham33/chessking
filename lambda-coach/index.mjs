// Opening Lab AI coach — deploy this file as AWS Lambda index.mjs.
// Runtime: AWS-managed Node.js; handler: index.handler
// Requires OPENAI_API_KEY in Lambda environment variables.
// Do not expose this function publicly without appropriate API access controls.
const reply=(statusCode,data)=>({
 statusCode,
 headers:{'Content-Type':'application/json'},
 body:JSON.stringify(data)
});
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
  const response=await fetch('https://api.openai.com/v1/chat/completions',{
   method:'POST',
   headers:{
    Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
    'Content-Type':'application/json'
   },
   body:JSON.stringify({
    model:'gpt-4.1-mini',
    temperature:0.3,
    max_completion_tokens:220,
    messages:[
     {role:'system',content:`You are Opening Lab's chess teacher. Give accurate, position-specific, friendly explanations of chess moves.
The supplied boardFacts are a deterministic record of piece locations and attacked squares. These override generic opening knowledge. Never describe a piece or pawn occupying a square unless boardFacts supports it. The FEN is the full board position.
The chess engine supplies evaluations and candidate continuations, but not reasons for moves. A candidate's rank is not proof that other legal moves are wrong. Avoid confident explanations of threats, tactics, recaptures or move alternatives unless boardFacts and the legal continuation substantiate them. If evidence is weak, omit the speculative claim.
Never produce algebraic notation or shorthand in the visible response. Do not write examples like 7.Qd2, Rg1, Nf6, O-O, or 3...e6. Instead say "move the queen to d2", "move the rook to g1", "develop the knight to f6", "castle kingside", or "advance the pawn to e6". Square names such as d2 are fine. No move-number prefixes.
Give one meaningful lesson about the current move, then a concrete consequence or sensible plan if evidence supports one. Do not simply repeat the opening move or generic central-control phrases. Respect the learner/opponent distinction. Do not praise weak moves, and do not infer an error solely because the engine prefers a different move.
Keep ordinary moves to 2-3 helpful sentences. For meaningful mistakes, explain the consequence and a supported alternative in 3-5 sentences. Avoid repetition and jargon; explain unfamiliar terms naturally. Return only the coach text.`},
     {role:'user',content:JSON.stringify(evidence)}
    ]
   })
  });
  if(!response.ok){
   console.error('OpenAI request failed:',response.status);
   return reply(response.status===429?429:502,{error:'AI coaching request failed'});
  }
  const result=await response.json();
  const message=result.choices?.[0]?.message?.content?.trim();
  if(!message||message.length<15)return reply(502,{error:'Empty AI response'});
  return reply(200,{
   message:message.slice(0,900),
   engineGrounded:Boolean(input.engine||input.moveAssessment)
  });
 }catch(error){
  console.error('Coach error:',error.message);
  return reply(502,{error:'AI service unavailable'});
 }
};
