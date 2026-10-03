export const at = day => `2026-09-${String(day).padStart(2,'0')}T00:00:00Z`;
export const event = (day, overrides={}) => ({id:`event-${day}`,at:at(day),global:true,banked:false,observed:false,...overrides});
export const post = (day,text,overrides={}) => ({id:`post-${day}`,at:at(day),text,author:'thsottiaux',provenance:'primary',...overrides});
export function snapshot(overrides={}) {
 return {schemaVersion:1,now:at(25),events:[event(1),event(3),event(6),event(10),event(13),event(18),event(24)],posts:[post(24,'We have reset usage for all paid accounts.',{id:'event-24'})],sources:[],unknowns:[],...overrides};
}
