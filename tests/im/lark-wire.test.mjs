import {test,expect} from 'bun:test';import {spawnSync} from 'node:child_process';import {resolve} from 'node:path';
import {encode_frame,decode_frame,merge_fragment} from '../../dist/adapters/lark/wire.mjs';
test('Lark protobuf reads a fixed wire fixture and preserves 64-bit IDs exactly in ACK',()=>{
 const fixture=Buffer.from('08ac0210ffffffffffffffffff0118a90620012a0d0a047479706512056576656e7442027b7d','hex');
 const frame=decode_frame(fixture);expect(frame.sequence).toBe(300n);expect(frame.log).toBe(18446744073709551615n);expect(frame.service).toBe(809);expect(frame.kind).toBe(1);expect(frame.headers).toEqual([{key:'type',value:'event'}]);expect(Buffer.from(encode_frame(frame))).toEqual(fixture);
 for(const bad of [Buffer.from([8,128]),Buffer.from([0]),fixture.subarray(0,4)])expect(()=>decode_frame(bad)).toThrow();
});
test('event fragments are ordered, duplicate-safe, bounded and expire',()=>{
 const cache=new Map(),frame=(seq,text)=>({headers:[{key:'message_id',value:'event'},{key:'sum',value:'2'},{key:'seq',value:String(seq)}],payload:new TextEncoder().encode(text)});
 expect(merge_fragment(cache,frame(1,'world'),0)).toBeNull();expect(merge_fragment(cache,frame(1,'world'),1)).toBeNull();expect(new TextDecoder().decode(merge_fragment(cache,frame(0,'hello '),2))).toBe('hello world');expect(cache.size).toBe(0);
 expect(()=>merge_fragment(cache,frame(2,'bad'),3)).toThrow();merge_fragment(cache,frame(1,'world'),4);expect(merge_fragment(cache,frame(0,'new'),6000)).toBeNull();
});
test('direct Lark API caches tenant tokens and never retries message writes',()=>{
 const code=`let calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body),auth:opts.headers.authorization});if(url.includes('tenant_access_token'))return new Response(JSON.stringify({code:0,tenant_access_token:'fixture-token',expire:7200}));if(calls.filter(x=>x.url.includes('/messages')).length===2)throw new Error('uncertain');return new Response(JSON.stringify({code:0,data:{message_id:'fixture'}}));};
 const {create_client}=await import(${JSON.stringify(resolve('dist/adapters/lark/api.mjs'))});const client=create_client('fixture-app','fixture-secret','feishu');await client.send({receive_id:'oc_fixture'});let failed=false;try{await client.send({receive_id:'oc_fixture'});}catch{failed=true;}console.log(JSON.stringify({calls,failed}));`;
 const r=spawnSync(process.execPath,['--eval',code],{encoding:'utf8',timeout:5000});expect(r.status).toBe(0);const data=JSON.parse(r.stdout);expect(data.failed).toBe(true);expect(data.calls).toHaveLength(3);expect(data.calls[1].auth).toBe('Bearer fixture-token');expect(data.calls[1].url).toContain('receive_id_type=chat_id');
});
test('own socket handles heartbeat, binary event ACK and shutdown without an SDK',()=>{
 const code=`let sockets=[],sent=[],wire;globalThis.WebSocket=class{constructor(url){this.url=url;this.readyState=0;sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen();});}send(bytes){const f=wire.decode_frame(bytes);sent.push(f);if(f.kind===0)queueMicrotask(()=>this.onmessage({data:wire.encode_frame({...f,headers:[{key:'type',value:'pong'}]}).buffer}));}close(){this.readyState=3;this.onclose?.();}};
 wire=await import(${JSON.stringify(resolve('dist/adapters/lark/wire.mjs'))});const {open_socket}=await import(${JSON.stringify(resolve('dist/adapters/lark/socket.mjs'))});let events=[];const connection=await open_socket({connectConfig:async()=>({code:0,data:{URL:'wss://msg-frontier.feishu.cn/ws?service_id=809',ClientConfig:{PingInterval:120}}})},event=>events.push(event));
 await sockets[0].onmessage({data:wire.encode_frame({sequence:5n,log:9007199254740993n,service:809,kind:1,headers:[{key:'type',value:'event'}],payload:new TextEncoder().encode(JSON.stringify({header:{event_type:'im.message.receive_v1'},event:{message:{message_id:'fixture'}}}))}).buffer});connection.close();console.log(JSON.stringify({events,ping:sent[0].kind,ack:JSON.parse(new TextDecoder().decode(sent.at(-1).payload)),log:String(sent.at(-1).log),closed:sockets[0].readyState}));`;
 const r=spawnSync(process.execPath,['--eval',code],{encoding:'utf8',timeout:5000});expect(r.stderr).toBe('');expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({ping:0,ack:{code:200},log:'9007199254740993',closed:3});expect(JSON.parse(r.stdout).events[0].message.message_id).toBe('fixture');
});
