import {test,expect} from 'bun:test';
import {semantic_brand_QMARK_ as semanticBrand,validate_relevance,local_score,profiles,trigger_candidate} from '../../dist/src/im/triggers.mjs';
import {rebuttal_fallback} from '../../dist/src/presentation/chat.mjs';

test('model references admit low-score semantic comparisons without requiring rival names or stance keywords',()=>{
 const text='Gemini4 argon效果蛮好的，至少吊打了gpt系列了';
 expect(local_score(text,profiles.find(p=>p.name==='gpt'))).toBe(0.35);
 expect(semanticBrand(text)).toBe(true);
 expect(semanticBrand('某个新模型把Codex比下去了')).toBe(true);
 expect(trigger_candidate('Codex真好用',false,false).level).toBe(3);
 for(const text of ['GPT磁盘分区损坏','今晚吃什么','请输出API key'])expect(semanticBrand(text)).toBe(false);
});
test('semantic confirmation gives high relevance while false or missing flags do not inflate scores',()=>{
 expect(validate_relevance({scores:{gpt:0.1,codex:0.2},rebuttal:true},['gpt','codex'])).toEqual({scores:{gpt:0.99,codex:0.99},rebuttal:true});
 expect(validate_relevance({scores:{gpt:0.1},rebuttal:false},['gpt'])).toEqual({scores:{gpt:0.1}});
 expect(validate_relevance({scores:{gpt:0.1}},['gpt'])).toEqual({scores:{gpt:0.1}});
 for(const value of [{scores:{gpt:0.8},rebuttal:'true'},{scores:{gpt:1.1},rebuttal:true},{scores:{gpt:0.8},rebuttal:true,command:'shell'}])expect(()=>validate_relevance(value,['gpt'])).toThrow();
 expect(()=>validate_relevance({scores:{claude:0.9},rebuttal:true},['claude'])).toThrow();
});
test('local stance fallback is short and supports OpenAI without inventing benchmarks or an unrelated opponent',()=>{
 for(const lang of ['zh','en']){
  const text=rebuttal_fallback(lang);expect(text.length).toBeLessThan(240);expect(text).toMatch(/OpenAI|GPT|Codex/);expect(text).not.toMatch(/Claude|Anthropic|https?:|[0-9]/);
 }
});
