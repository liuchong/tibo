import {test,expect} from 'bun:test';
import {card_advice,current_card} from '../../dist/src/forecast/card.mjs';
import {judge,available_judgment} from '../../dist/src/app/engine.mjs';
import {render_report} from '../../dist/src/presentation/report.mjs';
import {snapshot} from '../helpers/fixture.mjs';
test('five explicit preference bands have a direct action and short numeric reason',()=>{
 for(const [a,b,tier,decision] of [[85,90,'very-high','wait'],[65,80,'high','wait'],[35,55,'medium','lean-wait'],[20,60,'medium','lean-wait'],[19,33,'low','use-now'],[14,25,'very-low','use-now']]){
  const c=card_advice({p24:a,p48:b});expect(c).toMatchObject({tier,decision,source:'local',policy:'card-advice-2'});expect(c.text).toStartWith(c.label+'。');expect(c.text).toMatch(/[0-9]+%/);expect(c.text.length).toBeLessThan(110);
 }
 expect(card_advice({available:false}).decision).toBe('unknown');
 const r=judge(snapshot());expect(r.forecast.cardAdvice).toEqual(card_advice(r.forecast));expect(r.forecast.cardAdvice.assumption).toBe('usable-card-and-choice-to-spend-or-wait');
 expect(render_report(r).match(/• 重置卡：/g)).toHaveLength(1);expect(render_report(available_judgment(snapshot({events:[],posts:[]})))).toContain('• 重置卡：');
 r.forecast.cardAdvice={...r.forecast.cardAdvice,source:'ai',text:'倾向现在用。有效的模型理由。'};expect(render_report(r)).toContain('有效的模型理由');r.forecast.p24=99;r.forecast.p48=99;expect(current_card(r.forecast).source).toBe('local');expect(render_report(r)).not.toContain('有效的模型理由');
});
