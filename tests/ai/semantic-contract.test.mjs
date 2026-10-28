import {test,expect} from 'bun:test';
import {build_semantic_input,decode_semantic} from '../../dist/src/ai/semantic-contract.mjs';
import {available_judgment} from '../../dist/src/app/engine.mjs';
import {dimension_input} from '../../dist/src/evidence/dimensions.mjs';
import {makeSnapshot,done,title,deadline,claim,response,post} from '../helpers/reset-semantic.mjs';
const input=()=>build_semantic_input(dimension_input(available_judgment(makeSnapshot())));
test('T01 valid completion survives invalid dimension and document row; unknown refs are locally rejected',()=>{
 const i=input(),v=response(i);v.dimensions[0]={...v.dimensions[0],support:1,citations:[{postId:done.id,quote:done.text}]};
 v.rows.push({postId:'incident-missing',claims:[claim(done)]});
 const out=decode_semantic(v,i,'main');expect(out.claims.find(c=>c.postId===done.id)).toMatchObject({kind:'completion',scope:'global',semanticValidated:true});
 expect(out.errors.some(e=>e.code==='semantic-window-reference')).toBe(true);expect(out.errors.some(e=>e.code==='semantic-source-reference')).toBe(true);expect(out.dimensions).toHaveLength(6);
 const bad=decode_semantic({rows:[{postId:'unknown',claims:[claim(done)]}]},i,'chain');expect(bad.claims).toHaveLength(0);
});
test('T02 one confirmed boundary, every required window and stable references carry no runtime data',()=>{
 const i=input();expect(i.windows).toHaveLength(7);expect(i.boundary.confirmedAt).toBe(i.lastGlobal.at);
 expect(i.windows[0].throughEpochMs).toBe(Date.parse(i.boundary.confirmedAt));
 expect(i.posts.find(p=>p.id===done.id).ref).toMatch(/^p/);expect(i.posts.every(p=>Array.isArray(p.windows))).toBe(true);
 expect(JSON.stringify(i)).not.toContain('TIBO_STATE_DIR');
});
test('T05 semantic decisions are not vetoed by keyword matching or future farewell; references and chronology still matter',()=>{
 const i=input(),p=i.posts.find(p=>p.id===done.id);
 const out=decode_semantic({postClaims:[{ref:p.ref,...claim(done)}]},i,'main');expect(out.claims[0].statement).toBe('completed');
 for(const text of ['There is nothing left to wait for.','It would be wrong to say the reset has not finished.']){
  const j=structuredClone(i);j.posts.find(p=>p.id===done.id).text=text;
  expect(decode_semantic({postClaims:[{ref:p.ref,...claim({...done,text})}]},j,'main').claims[0].kind).toBe('completion');
 }
 expect(decode_semantic({postClaims:[{ref:p.ref,...claim(done) ,quote:'not in the source'}]},i,'main').claims).toHaveLength(0);
 const product=decode_semantic({postClaims:[{ref:p.ref,...claim(done),subject:'product-change'}]},i,'main');expect(product.claims[0].subject).toBe('product-change');
});

test('later visible replies can clarify a promise; the observation cutoff excludes future evidence',()=>{
 const i=input(),source=i.posts.find(p=>p.id===title.id),context=i.posts.find(p=>p.id===deadline.id);
 const value={postClaims:[{ref:source.ref,...claim(title,'promise',{contextPostIds:[deadline.id]})}]};
 const out=decode_semantic(value,i,'main');
 expect(out.claims[0]).toMatchObject({at:title.at,kind:'promise',contextPostIds:[deadline.id]});
 const beforeReply={...i,now:title.at};
 expect(decode_semantic(value,beforeReply,'main').errors[0].code).toBe('semantic-context-reference');
 const futureClaim={postClaims:[{ref:context.ref,...claim(deadline,'promise',{contextPostIds:[]})}]};
 expect(decode_semantic(futureClaim,beforeReply,'main').errors[0].code).toBe('semantic-source-time');
});

test('object-first envelope canonicalizes product delivery and keeps quota completion object evidence mandatory',()=>{
 const i=input(),p=i.posts.find(p=>p.id===done.id);p.text='https://example.com/play has landed';
 p.linkContext={links:[{url:'https://example.com/play',finalUrl:'https://example.com/play',title:'Example Playground'}]};
 const product=decode_semantic({observations:[{ref:p.ref,delivered:{type:'product_release',label:'Example Playground website',basis:'explicit'},status:'fulfilled',scope:'unknown',quote:p.text,contextRefs:[]}]},i,'repair');
 expect(product.errors).toHaveLength(0);expect(product.claims[0]).toMatchObject({kind:'release',subject:'product-change',statement:'completed',objectText:'Example Playground website'});
 const other=decode_semantic({links:[{ref:p.ref,object:'other',status:'irrelevant',scope:'unknown',quote:p.text,basisRefs:[]}]},i,'chain');
 expect(other.errors).toHaveLength(0);expect(other.claims[0].subject).toBe('unknown');
 const bad=decode_semantic({postClaims:[{...claim({...done,text:p.text}),objectText:undefined}]},i,'main');expect(bad.errors[0].code).toBe('semantic-completion-object');
 const incident=decode_semantic({postClaims:[{...claim({...done,text:p.text},'incident'),subject:'product-change',scope:'partial'}]},i,'main');
 expect(incident.claims[0]).toMatchObject({kind:'incident',scope:'partial'});
});
test('prior reset boundary is a reviewable classification and link fetch clocks do not enter semantic identity',()=>{
 const s=makeSnapshot();s.posts.find(p=>p.id===done.id).linkContext={checkedAt:'2026-10-25T07:00:00Z',retryAt:123,links:[{title:'Example site',finalUrl:'https://example.com/'}]};
 const i=build_semantic_input(dimension_input(available_judgment(s)));
 expect(i.lastGlobal.basis).toBe('stored-classification-to-review');expect(i.lastGlobal.verified).toBeUndefined();
 const link=i.posts.find(p=>p.id===done.id).linkContext;expect(link.links[0].title).toBe('Example site');expect(link.checkedAt).toBeUndefined();expect(link.retryAt).toBeUndefined();
});
