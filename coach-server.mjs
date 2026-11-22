// Optional local-only AI coaching server. Node.js 20+; no dependencies.
// Start with OPENAI_API_KEY=... node coach-server.mjs
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||8787);
const host='127.0.0.1'; // Do not expose the unauthenticated prototype publicly.
const model=process.env.OPENAI_COACH_MODEL||'gpt-6-luna';
const history=new Map();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.wasm':'application/wasm','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){
 let raw='';for await (const chunk of req){raw+=chunk.toString();if(raw.length>12000)throw Error('Request too large');}
 return JSON.parse(raw);
}
async function suggest(payload){
 const {fen,opening,player,moveHistory,facts,candidates,previous}=payload;
 if(typeof fen!=='string'||fen.length>130||!/^[prnbqkPRNBQK1-8/]+ [wb] /.test(fen))throw Error('Invalid position');
 if(!Array.isArray(candidates)||candidates.length>8||!candidates.every(x=>typeof x.id==='string'&&typeof x.topic==='string'&&typeof x.message==='string'))throw Error('Invalid evidence');
 const instructions=[
  'You are a thoughtful chess coach for a beginner. Choose ONE useful strategic insight from the supplied verified candidate observations, or choose none.',
  'Treat the FEN and position facts as context, not a license to invent tactical threats, forcing sequences, or engine evaluations.',
  'Do not claim that castling is legal unless the facts say it is. Do not recommend a specific move unless the provided candidate warrants it.',
  'Do not frame an opponent plan as certain; use may, might, or worth watching.',
  'Prefer advice about king safety, castling timing, piece coordination, positional pressure and space, when relevant.',
  'Keep advice natural, calm, actionable and tentative. One or two sentences, maximum 220 characters.',
  'Avoid repeating the previous insight. If no candidate is worth saying now, return id none.',
  'Your output MUST reference an input candidate id, or none. Do not create a new candidate id.'
 ].join(' ');
 const input={fen,opening:String(opening||'').slice(0,100),player:player==='Black'?'Black':'White',moveHistory:Array.isArray(moveHistory)?moveHistory.slice(-12):[],facts,previous:previous||null,candidates:candidates.map(x=>({id:x.id,topic:x.topic,message:x.message}))};
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),18000);
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:controller.signal,headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({
   model,store:false,instructions,input:JSON.stringify(input),max_output_tokens:240,
   text:{format:{type:'json_schema',name:'chess_coach_insight',strict:true,schema:{type:'object',additionalProperties:false,properties:{id:{type:'string'},topic:{type:'string'},message:{type:'string'}},required:['id','topic','message']}}}
  })});
  if(!response.ok)throw Error('AI service returned '+response.status);
  const data=await response.json(),str=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
  const result=JSON.parse(str);
  if(result.id==='none')return {id:'none'};
  const candidate=candidates.find(x=>x.id===result.id);
  if(!candidate)throw Error('AI chose an unknown insight');
  // Keep verified candidate text as fallback for malformed or overlong results.
  const message=typeof result.message==='string'&&result.message.length>=12&&result.message.length<=240?result.message:candidate.message;
  return {id:candidate.id,topic:candidate.topic,message,source:'ai'};
 }finally{clearTimeout(timer);}
}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url||'/', 'http://localhost');
 const origin=req.headers.origin;
 if(origin&&origin!=='http://'+host+':'+port){json(res,403,{error:'Wrong origin'});return;}
 if(url.pathname==='/api/coach/status'){json(res,200,{available:!!process.env.OPENAI_API_KEY});return;}
 if(url.pathname==='/api/coach/insight'&&req.method==='POST'){
  if(!process.env.OPENAI_API_KEY){json(res,503,{error:'AI not configured'});return;}
  const ip=req.socket.remoteAddress||'local',now=Date.now(),state=history.get(ip)||[];
  const recent=state.filter(x=>now-x<60000);
  if(recent.length>=12){json(res,429,{error:'Rate limit'});return;}
  history.set(ip,[...recent,now]);
  try{json(res,200,await suggest(await body(req)));}catch(err){console.error('AI coaching request:',err.message);json(res,502,{error:'Coaching unavailable'});}
  return;
 }
 if(req.method!=='GET'&&req.method!=='HEAD'){json(res,405,{error:'Method not allowed'});return;}
 const requested=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
 const name=requested.slice(1);
 // Only serve root assets and the checked-in chess piece images.
 const pieceImage=/^assets\\/pieces\\/cburnett\\/[wb][KQRBNP]\\.svg$/.test(name);
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
