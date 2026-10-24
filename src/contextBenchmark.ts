import {countTextTokens,type TextEncoding} from './textTokenizer.js';
/** Real local BPE throughput, not a claim of model comprehension/summary quality. */
export function benchmarkTextContext(tokens=1000000,encoding:TextEncoding='cl100k_base'){
 if(!Number.isSafeInteger(tokens)||tokens<1000||tokens>1000000||!['cl100k_base','o200k_base'].includes(encoding))throw new Error('Text benchmark requires 1000–1000000 tokens and an explicit built-in text encoding');
 const text=' x'.repeat(tokens),before=process.memoryUsage().rss,start=performance.now(),count=countTextTokens(text,encoding);
 return {ok:count===tokens,encoding,requestedTokens:tokens,measuredTokens:count,bytes:Buffer.byteLength(text),elapsedMs:Math.round(performance.now()-start),rssGrowthBytes:Math.max(0,process.memoryUsage().rss-before),modelRequests:0,scope:'Local text BPE throughput only; not repository comprehension, multimodal billing, native model capacity or semantic-summary quality'};
}
