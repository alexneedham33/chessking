// UCI adapter for the exact Stockfish 17.1 lite engine bundled with Opening Lab.
// Runs as a local Node child process. No network and no AI calls.
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

const LINE=/^info\b/;
export async function startStockfish(root){
 const path=resolve(root,'stockfish-17.1-lite-single-03e3232.js');
 const proc=spawn(process.execPath,[path],{cwd:root,stdio:['pipe','pipe','pipe']});
 let output='',pending=null,closed=false,stderr='';
 proc.stderr.on('data',chunk=>{stderr+=String(chunk).slice(0,3000);});
 proc.on('error',error=>{if(pending){pending.reject(error);pending=null;}closed=true;});
 proc.on('exit',(code,signal)=>{
  closed=true;
  if(pending){pending.reject(Error('Stockfish exited before replying ('+code+', '+signal+'): '+stderr.slice(-600)));pending=null;}
 });
 const listeners=new Set();
 proc.stdout.on('data',chunk=>{
  output+=String(chunk);
  let ix;
  while((ix=output.indexOf('\n'))>=0){
   const line=output.slice(0,ix).trim();output=output.slice(ix+1);
   for(const listener of Array.from(listeners))listener(line);
  }
 });
 const command=text=>{
  if(closed||!proc.stdin.writable)throw Error('Stockfish is not running: '+stderr.slice(-500));
  proc.stdin.write(text+'\n');
 };
 const waitFor=(text,timeout=20000)=>new Promise((resolve,reject)=>{
  let timer;
  const listener=line=>{
   if(line===text){clearTimeout(timer);listeners.delete(listener);resolve(line);}
  };
  listeners.add(listener);
  timer=setTimeout(()=>{listeners.delete(listener);reject(Error('Timed out waiting for '+text+'. '+stderr.slice(-500)));},timeout);
 });
 const ready=async()=>{
  const wait=waitFor('readyok');command('isready');await wait;
 };
 try{
  const waiter=waitFor('uciok');command('uci');await waiter;
  command('setoption name UCI_LimitStrength value false');
  command('setoption name MultiPV value 1');
  await ready();
 }catch(error){commandSafe('quit');proc.kill();throw error;}
 function commandSafe(text){try{command(text);}catch{}}
 async function analyze(fen,depth=14){
  await ready();
  let last=null,info=null;
  const completed=new Promise((resolve,reject)=>{
   let timer;
   const listener=line=>{
    if(LINE.test(line)){
     const d=/\bdepth (\d+)/.exec(line),score=/\bscore (cp|mate) (-?\d+)/.exec(line),pv=/\bpv (.*)$/.exec(line);
     if(d&&score&&pv){
      const candidate={depth:Number(d[1]),scoreType:score[1],score:Number(score[2]),
       pv:pv[1].trim().split(/\s+/).filter(Boolean)};
      if(!last||candidate.depth>=last.depth)last=candidate;
     }
    }
    if(line.startsWith('bestmove ')){
     clearTimeout(timer);listeners.delete(listener);
     const best=line.split(/\s+/)[1];
     if(!last||last.depth<depth-1||!last.pv.length)
      reject(Error('Stockfish did not return a sufficiently deep PV for '+fen));
     else resolve({version:'Stockfish 17.1 lite single-thread',bestmove:best,...last});
    }
   };
   listeners.add(listener);
   timer=setTimeout(()=>{
    listeners.delete(listener);commandSafe('stop');
    reject(Error('Stockfish exceeded analysis timeout at depth '+depth));
   },90000);
  });
  command('position fen '+fen);
  command('go depth '+depth);
  return completed;
 }
 return {analyze,stop:()=>{
  commandSafe('quit');
  const timer=setTimeout(()=>{if(!closed)proc.kill();},750);
  timer.unref?.();
 }};
}
