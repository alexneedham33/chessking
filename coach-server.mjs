// Optional local-only AI coaching server. Node.js 20+; no dependencies.
// Start with OPENAI_API_KEY=... node coach-server.mjs
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||8787);
const host='127.0.0.1'; // Do not expose the unauthenticated prototype publicly.
const model=process.env.OPENAI_COACH_MODEL||'gpt-4.1-mini';
const history=new Map();
// Process-local API safety ceiling (resets at UTC midnight or on server restart).
// Adjust with OPENAI_COACH_DAILY_LIMIT; set to 0 to disable paid calls.
const dailyLimit=Math.max(0,Math.min(10000,Number.isFinite(Number(process.env.OPENAI_COACH_DAILY_LIMIT))&&process.env.OPENAI_COACH_DAILY_LIMIT!==undefined?Math.floor(Number(process.env.OPENAI_COACH_DAILY_LIMIT)):120));
let dailyCalls=0,dailyDate='';
function refreshDailyBudget(){const today=new Date().toISOString().slice(0,10);if(today!==dailyDate){dailyDate=today;dailyCalls=0;}}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){
 let raw='';for await (const chunk of req){raw+=chunk.toString();if(raw.length>12000)throw Error('Request too large');}
 return JSON.parse(raw);
}
function cleanEngineEvidence(input){
 if(!input||typeof input!=='object'||!Number.isInteger(input.depth)||input.depth<1||input.depth>40||!Array.isArray(input.variations))return null;
 const variations=input.variations.slice(0,3).map(line=>{
  if(!line||typeof line!=='object'||!Array.isArray(line.moves))return null;
  const moves=line.moves.slice(0,6).map(move=>{
   if(!move||typeof move!=='object'||!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move.uci||''))return null;
   return {uci:move.uci,label:String(move.label||'').slice(0,30),
    side:move.side==='Black'?'Black':'White',piece:['p','n','b','r','q','k'].includes(move.piece)?move.piece:'',
    capture:move.capture===true,castle:move.castle===true};
  }).filter(Boolean);
  if(!moves.length)return null;
  const evaluation=Number.isFinite(line.evaluation)&&Math.abs(line.evaluation)<200?line.evaluation:null;
  return {rank:Number.isInteger(line.rank)?line.rank:1,evaluation,
   mate:Number.isInteger(line.mate)&&Math.abs(line.mate)<=100?line.mate:null,moves};
 }).filter(Boolean);
 if(!variations.length)return null;
 return {depth:input.depth,sideToMove:input.sideToMove==='Black'?'Black':'White',
  evaluation:Number.isFinite(input.evaluation)&&Math.abs(input.evaluation)<200?input.evaluation:null,
  mate:Number.isInteger(input.mate)&&Math.abs(input.mate)<=100?input.mate:null,variations};
}
// Explain the move that was actually played, using the board before/after it.
// Principal variations start AFTER the move; they are not the played move.
async function explainMove(payload){
 const {beforeFen,afterFen,opening,player,played,scripted,history,recentCoaching}=payload;
 const fenOk=x=>typeof x==='string'&&x.length<=130&&/^[prnbqkPRNBQK1-8/]+ [wb] /.test(x);
 if(!fenOk(beforeFen)||!fenOk(afterFen))throw Error('Invalid move position');
 if(!played||typeof played!=='object'||!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(played.uci||'')||
    typeof played.label!=='string'||played.label.length>35||!['White','Black'].includes(played.side)||
    !['p','n','b','r','q','k'].includes(played.piece))throw Error('Invalid played move');
 if(typeof scripted!=='string'||scripted.length>900)throw Error('Invalid lesson text');
 const engine=cleanEngineEvidence(payload.engine);
 const prior=payload.priorEngine&&typeof payload.priorEngine==='object'?payload.priorEngine:null;
 const context={
  opening:String(opening||'').slice(0,100),student:player==='Black'?'Black':'White',
  beforeFen,afterFen,
  played:{uci:played.uci,label:played.label,side:played.side,piece:played.piece,
   from:String(played.from||'').slice(0,2),to:String(played.to||'').slice(0,2),
   capture:played.capture===true,castle:played.castle===true,check:played.check===true},
  originalExplanation:scripted,
  moveHistory:Array.isArray(history)?history.slice(-10).map(x=>String(x).slice(0,40)):[],
  recentCoaching:Array.isArray(recentCoaching)?recentCoaching.slice(-3).map(x=>String(x).slice(0,500)):[],
  stockfishAfter:engine,
  stockfishBefore:prior&&Number.isFinite(prior.evaluation)?{evaluation:prior.evaluation,depth:prior.depth}:null
 };
 const instructions=[
  'You are an expert chess teacher for an early-intermediate learner. Produce ONE coherent explanation of the ACTUAL played move, not a separate strategic insight.',
  'FIRST anchor in played.label, played.piece, the beforeFen and afterFen. Name the correct side and the piece that just moved. A Stockfish principal variation starts AFTER the played move; NEVER describe an engine candidate as though it was the played move.',
  'Use the originalExplanation as potentially helpful lesson context, but it may be generic, outdated or wrong; correct it if it conflicts with the board.',
  'Use Stockfish evaluations and continuations only as supporting evidence for concrete consequences. They are calculations, not a statement of intent, and must not be confused with the move that was played.',
  'Explain what changed, why it matters, and one appropriate next consideration. Avoid repetition, unsupported threats or false confidence. Do not claim an advantage is decisive from a small evaluation change.',
  'For routine opening moves, write exactly two concise, natural sentences, normally 30-55 words total, with a hard limit of 65 words. Explain the most useful strategic idea and, only if helpful, one relevant next consideration. For genuinely critical tactical positions, you may use up to three sentences and 85 words.',
  'Do not narrate obvious piece movement or repeat the move notation in prose (for example, avoid White has just played 1. d4, moving the pawn from d2 to d4). The move title already provides this. Mention origin or destination only if it teaches something important.',
  'Prioritise one clear lesson over exhaustive coverage. No filler, repetitive development advice, or speculative follow-ups. Use the actual resulting position to keep the explanation accurate.',
  'If the provided evidence cannot justify a tactical claim, omit it. Keep plain, encouraging language rather than generic stock phrases. Do not invent an unseen move.',
  'Output only a JSON object with a single message string. No separate insights or numbered lists.'
 ].join(' ');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{
   'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'
  },body:JSON.stringify({model,store:false,instructions,input:JSON.stringify(context),max_output_tokens:350,
   text:{format:{type:'json_schema',name:'chess_move_explanation',strict:true,
    schema:{type:'object',additionalProperties:false,properties:{message:{type:'string'}},required:['message']}}}
  })});
  if(!response.ok){
   const errorBody=(await response.text()).slice(0,1200);
   console.error('OpenAI API response',response.status,errorBody.replace(/sk-[A-Za-z0-9_-]+/g,'[redacted key]'));
   throw Error('AI service returned '+response.status);
  }
  const data=await response.json(),raw=(data.output||[]).flatMap(x=>x.content||[])
   .filter(x=>x.type==='output_text').map(x=>x.text).join('');
  const result=JSON.parse(raw);
  if(typeof result.message!=='string'||result.message.trim().length<30||result.message.length>900)throw Error('Invalid coach message');
  return {message:result.message.trim(),engineGrounded:!!engine};
 }finally{clearTimeout(timer);}
}

const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url||'/', 'http://localhost');
 const origin=req.headers.origin;
 if(origin&&origin!=='http://'+host+':'+port){json(res,403,{error:'Wrong origin'});return;}
 if(url.pathname==='/api/coach/status'){refreshDailyBudget();json(res,200,{available:!!process.env.OPENAI_API_KEY,model,dailyLimit,dailyCalls,remaining:Math.max(0,dailyLimit-dailyCalls)});return;}
 if(url.pathname==='/api/coach/move'&&req.method==='POST'){
  if(!process.env.OPENAI_API_KEY){json(res,503,{error:'AI not configured'});return;}
  refreshDailyBudget();
  if(dailyCalls>=dailyLimit){json(res,429,{error:'Daily AI coaching limit reached'});return;}
  const ip=req.socket.remoteAddress||'local',now=Date.now(),state=history.get(ip)||[];
  const recent=state.filter(x=>now-x<60000);
  if(recent.length>=12){json(res,429,{error:'Rate limit'});return;}
  history.set(ip,[...recent,now]);
  // Count attempts, including API failures, to protect against unexpected spend.
  dailyCalls++;
  try{json(res,200,await explainMove(await body(req)));}catch(err){console.error('AI coaching request:',err.message);json(res,502,{error:'Coaching unavailable'});}
  return;
 }
 if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,{error:'Method not allowed'});return;}
 const requested=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
 const name=requested.slice(1);
 // Only serve root assets and the checked-in chess piece images.
 const pieceImage=/^assets\/pieces\/cburnett\/[wb][KQRBNP]\.svg$/.test(name);
 if(!name||name.startsWith('.')||name.includes('..')||name.includes('\\')||name.includes('/')&&!pieceImage){json(res,404,{error:'Not found'});return;}
 const ext=path.extname(name).toLowerCase();
 if(!mime[ext]){json(res,404,{error:'Not found'});return;}
 try{
  const filename=path.join(root,name),file=await readFile(filename);
  res.writeHead(200,{'Content-Type':mime[ext],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:file);
 }catch{json(res,404,{error:'Not found'});}
});
server.listen(port,host,()=>console.log('Opening Lab at http://'+host+':'+port+' | AI '+(process.env.OPENAI_API_KEY?'configured':'disabled')));
