import {test,expect} from 'bun:test';
import {card_advice} from '../../dist/src/forecast/card.mjs';
import {judge,available_judgment} from '../../dist/src/app/engine.mjs';
import {render_report} from '../../dist/src/presentation/report.mjs';
import {snapshot} from '../helpers/fixture.mjs';
test('rough advice uses the final forecast, has three preferences and never assumes account state',()=>{
 expect(card_advice({p24:70,p48:80}).decision).toBe('wait');expect(card_advice({p24:40,p48:55}).decision).toBe('wait-if-possible');expect(card_advice({p24:20,p48:65}).decision).toBe('wait-if-possible');expect(card_advice({p24:20,p48:30}).decision).toBe('use-if-needed');expect(card_advice({available:false}).decision).toBe('unknown');
 const r=judge(snapshot()),c=card_advice(r.forecast);expect(r.forecast.cardAdvice).toEqual(c);expect(c.assumption).toBe('quota-insufficient-and-immediate-need');
 expect(render_report(r).match(/• 重置卡：/g)).toHaveLength(1);expect(render_report(r)).toContain(c.text);expect(c.text).not.toMatch(/你已用完|你的额度已|购买|自动使用/);
 const cold=available_judgment(snapshot({events:[],posts:[]}));expect(cold.forecast.cardAdvice).toBeDefined();expect(render_report(cold)).toContain('• 重置卡：');
 r.forecast.p24=99;r.forecast.p48=99;expect(render_report(r)).toContain(card_advice(r.forecast).text);
});
