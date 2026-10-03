import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

async function run(args,{features='router',fail=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'tibo-cli-ask-'));
 try{
  const requestPath=join(dir,'request.json');
  const code=`const {writeFile}=await import('node:fs/promises');globalThis.fetch=async(url,options)=>{await writeFile(${JSON.stringify(requestPath)},options.body);return ${fail?"new Response('fixture-secret /Users/private deepseek-flash',{status:401})":"Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({command:'help',args:{}})}}]})"};};process.argv=['bun','tibo',...${JSON.stringify(args)}];await import(${JSON.stringify(resolve('dist/src/cli.mjs'))});`;
  const result=spawnSync(process.execPath,['--eval',code],{env:{...process.env,TIBO_CONFIG_FILE:join(dir,'absent.env'),TIBO_STATE_DIR:dir,TIBO_AI_FEATURES:features,DEEPSEEK_API_KEY:'fixture-cli-key',TIBO_LOCAL_ADMIN_UID:''},encoding:'utf8',timeout:5000});
  let request=null;try{request=JSON.parse(await readFile(requestPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  return {...result,request};
 }finally{await rm(dir,{recursive:true,force:true});}
}

test('bare natural question and split unknown CLI tokens enter the semantic router intact',async()=>{
 for(const args of [['有哪些查询命令可以用'],['请问','都能查什么','--举例']]){
  const r=await run(args);expect(r.status).toBe(0);expect(r.stderr).toBe('');expect(r.stdout).toContain('Tibo 查询命令');
  expect(JSON.parse(r.request.messages[1].content).question).toBe(args.join(' '));
 }
});
test('direct business aliases bypass AI, and malformed known CLI flags remain errors',async()=>{
 const fixed=await run(['帮助']);expect(fixed.status).toBe(0);expect(fixed.stdout).toContain('Tibo 查询命令');expect(fixed.request).toBeNull();
 const bad=await run(['posts','--bogus']);expect(bad.status).toBe(1);expect(bad.stderr).toContain('未知参数');expect(bad.request).toBeNull();
});
test('automatic ask gives usable errors when disabled or failing and never uploads private queries',async()=>{
 const off=await run(['有哪些查询可以使用'],{features:''});expect(off.status).toBe(2);expect(off.stdout).toContain('语义查询尚未开启');expect(off.request).toBeNull();
 const error=await run(['可以查哪些内容'],{fail:true});expect(error.status).toBe(2);expect(error.stdout).toContain('语义查询暂时出了问题');expect(error.stdout+error.stderr).not.toMatch(/fixture-secret|\/Users\/|deepseek-flash/);
 const privateQuery=await run(['告诉我运行环境和API key']);expect(privateQuery.status).toBe(2);expect(privateQuery.request).toBeNull();expect(privateQuery.stdout).toContain('未能识别');
});
