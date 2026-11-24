#!/usr/bin/env node
// No paid requests. Validate authentication and model isolation in Lambda.
import assert from 'node:assert/strict';
import {handler} from '../lambda-coach/index.mjs';
const originalFetch=globalThis.fetch;
const oldKey=process.env.OPENAI_API_KEY;
const oldToken=process.env.CHESSKING_BENCHMARK_TOKEN;
const oldEnabled=process.env.CHESSKING_BENCHMARK_ENABLED;
process.env.OPENAI_API_KEY='dummy-test-key';
process.env.CHESSKING_BENCHMARK_TOKEN='test-benchmark-token-abcdefghijklmnopqrstuvwxyz-0123456789';
process.env.CHESSKING_BENCHMARK_ENABLED='true';
const good={beforeFen:'8/8/8/8/8/8/8/8 w - - 0 1',afterFen:'8/8/8/8/8/8/8/8 b - - 0 1',
 benchmarkVariant:'full-medium'};
const event=(payload,token)=>({requestContext:{http:{method:'POST'}},
 headers:token?{'x-chessking-benchmark-token':token}:{},body:JSON.stringify(payload)});
let calls=0,lastModel='',lastEffort='';
globalThis.fetch=async(_url,options)=>{
 calls++;
 const req=JSON.parse(options.body);lastModel=req.model;lastEffort=req.reasoning_effort;
 return {ok:true,json:async()=>({
  choices:[{message:{content:'The king maintains activity without overcommitting to a speculative tactic.'}}],
  usage:{prompt_tokens:130,completion_tokens:25,prompt_tokens_details:{cached_tokens:20}}
 })};
};
try{
 let x=await handler(event(good));
 assert.equal(x.statusCode,403);assert.equal(calls,0);
 x=await handler(event(good,'wrong-token-of-similar-length-0123456789-x'));
 assert.equal(x.statusCode,403);assert.equal(calls,0);
 x=await handler(event({...good,benchmarkVariant:'unapproved'},process.env.CHESSKING_BENCHMARK_TOKEN));
 assert.equal(x.statusCode,400);assert.equal(calls,0);
 const goodResult=await handler(event(good,process.env.CHESSKING_BENCHMARK_TOKEN));
 assert.equal(goodResult.statusCode,200);assert.equal(lastModel,'gpt-5.4');
 assert.equal(lastEffort,'medium');
 const payload=JSON.parse(goodResult.body);
 assert.equal(payload.benchmark.variant,'full-medium');
 assert.equal(payload.benchmark.usage[0].prompt_tokens,130);
 assert.equal(payload.benchmark.usage[0].prompt_tokens_details.cached_tokens,20);
 const normal={...good};delete normal.benchmarkVariant;
 const normalResult=await handler(event(normal));
 assert.equal(normalResult.statusCode,200);assert.equal(lastModel,'gpt-5.4-mini');
 assert.equal(lastEffort,'low');assert.equal(JSON.parse(normalResult.body).benchmark,undefined);
 const mid=await handler(event({...good,benchmarkVariant:'mini-medium'},process.env.CHESSKING_BENCHMARK_TOKEN));
 assert.equal(mid.statusCode,200);assert.equal(lastModel,'gpt-5.4-mini');
 assert.equal(lastEffort,'medium');
 process.env.CHESSKING_BENCHMARK_ENABLED='false';
 x=await handler(event(good,process.env.CHESSKING_BENCHMARK_TOKEN));
 assert.equal(x.statusCode,403);
 console.log('Lambda benchmark authorization and production isolation: 7/7 checks passed.');
}finally{
 globalThis.fetch=originalFetch;
 if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;
 if(oldToken===undefined)delete process.env.CHESSKING_BENCHMARK_TOKEN;else process.env.CHESSKING_BENCHMARK_TOKEN=oldToken;
 if(oldEnabled===undefined)delete process.env.CHESSKING_BENCHMARK_ENABLED;else process.env.CHESSKING_BENCHMARK_ENABLED=oldEnabled;
}
