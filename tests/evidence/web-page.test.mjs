import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extract_page} from '../../dist/src/evidence/page-extract.mjs';
import {public_url,public_ip_QMARK_ as publicIP,resolve_public} from '../../dist/src/evidence/web-policy.mjs';
const article='Weekly limits renew on a seven-day cycle. The account page shows the precise date. '.repeat(8);
const html=`<html><head><title>Usage guide</title><script type="application/ld+json">{"@type":"Article","headline":"Usage guide","author":{"name":"Guide author"},"datePublished":"2026-10-20"}</script></head><body><nav>${'menu '.repeat(400)}</nav><article><h1>Usage guide</h1><p>${article}</p><p>Current details appear on the account page.</p><pre>quota = 7</pre></article><footer>unrelated footer</footer></body></html>`;
async function trial(code){const dir=await mkdtemp(join(tmpdir(),'tibo-page-'));try{const r=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_WEB_RENDER:'0'},encoding:'utf8',timeout:15000});expect(r.status,r.stderr).toBe(0);return JSON.parse(r.stdout);}finally{await rm(dir,{recursive:true,force:true});}}
const path=n=>JSON.stringify(resolve('dist/src/evidence/'+n+'.mjs'));
test('native extraction selects readable article and metadata without scripts, menus or footer',async()=>{
 const p=await extract_page(html,'https://docs.example.com/guide');
 expect(p.state).toBe('ok');expect(p.title).toBe('Usage guide');expect(p.author).toBe('Guide author');expect(p.publishedAt).toBe('2026-10-20');
 expect(p.text).toContain('seven-day cycle');expect(p.text).toContain('quota = 7');expect(p.text).not.toContain('menu');expect(p.text).not.toContain('unrelated footer');expect(p.text).not.toContain('application/ld+json');
});
test('paragraph density handles pages without article and marks truncation and access gates',async()=>{
 const p=await extract_page('<body><div><p>'+article+'</p><p>'+article+'</p></div></body>','https://example.com/');expect(p.state).toBe('ok');
 const gate=await extract_page('<title>Just a moment...</title><body>Verify you are human</body>','https://example.com/');expect(gate.state).toBe('blocked');
 const sparse=await extract_page('<body><div id="root"></div><script>render()</script></body>','https://example.com/');expect(sparse.state).toBe('partial');
 const big=await extract_page('<article><p>'+article.repeat(60)+'</p></article>','https://example.com/');expect(big.truncated).toBe(true);expect(big.text.length).toBeLessThanOrEqual(24000);
});
test('public URL and address validation reject local, metadata, reserved and encoded IP forms',async()=>{
 for(const url of [pathToFileURL(resolve('web-fixture')).href,'http://localhost/x','https://127.1/x','https://2130706433/x','https://[::1]/','https://[::ffff:127.0.0.1]/','https://user:pass@example.com/','https://example.com:8443/','https://foo.local/'])expect(()=>public_url(url)).toThrow();
 for(const ip of ['0.0.0.0','10.0.0.1','127.0.0.1','169.254.169.254','172.16.1.2','192.168.1.1','100.64.1.1','198.18.0.1','224.0.0.1','::1','2001::','2001:2::1','2001:db8::1','fe80::1','fd00::1','::ffff:8.8.8.8'])expect(publicIP(ip)).toBe(false);
 expect(publicIP('8.8.8.8')).toBe(true);expect(publicIP('2606:4700:4700::1111')).toBe(true);
 await expect(resolve_public('example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}])).rejects.toThrow();
 expect((await resolve_public('example.com',async()=>[{address:'8.8.8.8',family:4}])).address).toBe('8.8.8.8');
});
test('concurrent page reads share cache and immutable snapshot; conditional revalidation preserves body',async()=>{
 const d=await trial(`let calls=0,now=Date.now(),conditional;Date.now=()=>now;const {read_page}=await import(${path('web-page')});const load=async(u,o)=>{calls++;conditional=o;await new Promise(r=>setTimeout(r,20));return calls===1?{status:200,url:u,headers:{etag:'fixture-v1','content-type':'text/html'},body:${JSON.stringify(html)}}:{status:304,url:u,headers:{etag:'fixture-v1'},body:''}};const [a,b]=await Promise.all([read_page('https://docs.example.com/cache',{load}),read_page('https://docs.example.com/cache',{load})]);now+=1800001;const c=await read_page('https://docs.example.com/cache',{load});const fs=await import('node:fs/promises');const files=await fs.readdir(process.env.TIBO_STATE_DIR);console.log(JSON.stringify({a,b,c,calls,conditional,files}));`);
 expect(d.calls).toBe(2);expect(d.a.text).toBe(d.b.text);expect(d.b.cached).toBe(true);expect(d.c.text).toBe(d.a.text);expect(d.conditional.headers['if-none-match']).toBe('fixture-v1');expect(d.files.filter(f=>f.startsWith('web-body-'))).toHaveLength(1);
});
test('sparse pages render once; blocked responses do not render; failures remain distinct and cached',async()=>{
 const d=await trial(`const {read_page}=await import(${path('web-page')});let renders=0;const render=async()=>{renders++;return ${JSON.stringify(html)}};const sparse=await read_page('https://docs.example.com/sparse',{load:async u=>({url:u,status:200,headers:{'content-type':'text/html'},body:'<body><div id="app"></div></body>'}),render});const load=async u=>({url:u,status:403,headers:{'content-type':'text/html'},body:'denied'});const blocked=await read_page('https://docs.example.com/denied',{load,render});const again=await read_page('https://docs.example.com/denied',{load,render});const bad=await read_page('https://docs.example.com/error',{load:async()=>{throw Error('private transport secret')}});console.log(JSON.stringify({sparse,blocked,again,bad,renders}));`);
 expect(d.renders).toBe(1);expect(d.sparse.mode).toBe('webview');expect(d.sparse.state).toBe('ok');expect(d.blocked.state).toBe('blocked');expect(d.again.cached).toBe(true);expect(d.bad.state).toBe('unavailable');expect(JSON.stringify(d)).not.toContain('private transport secret');
});
test('redirect, media, body limits and cancellation are enforced before accepting page content',async()=>{
 const d=await trial(`let calls=0;globalThis.fetch=async(u,o)=>{calls++;if(String(u).endsWith('/redirect'))return new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}});if(String(u).endsWith('/pdf'))return new Response('binary',{headers:{'content-type':'application/pdf'}});if(String(u).endsWith('/big'))return new Response('x'.repeat(2000001),{headers:{'content-type':'text/html'}});o.signal.throwIfAborted();return new Response('x');};const {read_page}=await import(${path('web-page')});const redirect=await read_page('https://docs.example.com/redirect'),pdf=await read_page('https://docs.example.com/pdf'),big=await read_page('https://docs.example.com/big');const c=new AbortController();c.abort();const aborted=await read_page('https://docs.example.com/abort',{signal:c.signal});console.log(JSON.stringify({redirect,pdf,big,aborted,calls}));`);
 expect(d.redirect.state).toBe('blocked');expect(d.pdf.state).toBe('unsupported');expect(d.big.state).toBe('unavailable');expect(d.aborted.state).not.toBe('ok');expect(d.calls).toBeLessThanOrEqual(4);
});

test('native proxy rejects private CONNECT and HTTP destinations before contacting a local service',async()=>{
 const d=await trial(`const {egress_proxy,close_egress}=await import(${path('web-egress')});const net=await import('node:net');const proxy=new URL(await egress_proxy());const rows=[];for(const request of ['CONNECT 127.0.0.1:443 HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\n\\r\\n','GET http://127.0.0.1/private HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\n\\r\\n'])rows.push(await new Promise((resolve,reject)=>{const socket=net.connect(Number(proxy.port),proxy.hostname,()=>socket.write(request));socket.setTimeout(2000,()=>socket.destroy());socket.once('error',reject);socket.once('data',b=>{resolve(b.toString());socket.destroy();});}));close_egress();console.log(JSON.stringify(rows));`);
 expect(d).toHaveLength(2);expect(d.every(r=>r.startsWith('HTTP/1.1 403'))).toBe(true);
});
