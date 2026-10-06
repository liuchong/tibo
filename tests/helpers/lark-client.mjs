// Test-only transport relocation. The production adapter exposes no alternate host.
const nativeFetch=globalThis.fetch,NativeSocket=globalThis.WebSocket;
import {readFileSync} from 'node:fs';
const server=process.env.TIBO_TEST_SERVER;
if(process.env.TIBO_TEST_NOW)Date.now=()=>process.env.TIBO_TEST_CLOCK_FILE
 ? Number(readFileSync(process.env.TIBO_TEST_CLOCK_FILE,'utf8')) : new Date(process.env.TIBO_TEST_NOW).getTime();
globalThis.fetch=(url,options)=>{
 const parsed=new URL(url);
 if(parsed.hostname==='open.feishu.cn')return nativeFetch(server+parsed.pathname+parsed.search,options);
 if(parsed.hostname==='api.deepseek.com')return nativeFetch(server+'/ai',options);
 throw new Error('Unexpected external network request in local Lark trial');
};
globalThis.WebSocket=class extends NativeSocket{
 constructor(url){super(server.replace('http:','ws:')+'/ws');Object.defineProperty(this,'url',{value:url});}
};
await import('../../dist/adapters/lark/main.mjs');
