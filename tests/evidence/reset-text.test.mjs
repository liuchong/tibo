import {test, expect} from 'bun:test';
import {completed_QMARK_} from '../../dist/src/evidence/reset-text.mjs';
import {events_from_posts} from '../../dist/src/evidence/sources.mjs';
import {normalize_events} from '../../dist/src/forecast/signals.mjs';

test('completion survives an unrelated future-tense farewell or later promise', () => {
  for (const text of [
    'Resets all propagated. That will be all. Have a fantastic weekend.',
    'Reset all propagated. May the tokens do good things.',
    'The reset has been processed. We will reset again tomorrow.',
    'Put the reset in the bag. All propagated. https://t.co/example',
    "What would you like with your side of reset? It's done.",
    'The global reset. It is completed.',
  ]) expect(completed_QMARK_(text)).toBe(true);
});
test('future, conditional, negated, banked and weekly wording never proves global completion', () => {
  for (const text of [
    'The reset will be complete tomorrow.', 'If we reset all users, it would be complete.',
    'The reset has not been processed.', 'The reset is not complete.',
    'Reset all propagated. Actually the reset was not complete.',
    'A banked reset card has been processed.', 'Usage limits are now reset automatically every 7 days.',
    'A banked reset card is in the bag. All propagated.',
    'Tomorrow we will reset all paid users. All propagated.',
    "Reset the database. It's done.", 'If the global reset happens. It is done.',
    'The global reset would be nice. It is done.', 'A banked reset card. It is done.',
    'The global reset. Some maths. It is done.',
    'The global reset. It is not done.', 'The global reset will land tomorrow. It is done.',
  ]) expect(completed_QMARK_(text)).toBe(false);
});
test('an adjacent reset completion reply updates the clock and consumes the previous deadline',()=>{
 const post={id:'2109873287853707513',at:'2026-10-13T05:06:06Z',author:'thsottiaux',provenance:'primary',text:"What would you like with your side of reset? It's done."};
 const events=events_from_posts([post]);expect(events).toHaveLength(1);
 expect(normalize_events({posts:[post],events,now:'2026-10-13T05:07:00Z'})[0]).toMatchObject({global:true,verified:true});
});
test('the actual farewell announcement is discovered and keeps the verified clock', () => {
  const post={id:'2103911959544610829',at:'2026-09-26T18:17:54.606Z',author:'thsottiaux',provenance:'primary',text:'Resets all propagated. That will be all. Have a fantastic weekend.'};
  const events=events_from_posts([post]);
  expect(events).toHaveLength(1);
  expect(normalize_events({posts:[post],events,now:'2026-09-27T00:00:00Z'})[0]).toMatchObject({global:true,verified:true});
});
