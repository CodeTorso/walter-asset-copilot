import { describe, expect, it } from 'vitest'
import type { Finding } from '@/contracts'
import { useChatStore, threadFromHistory } from './chat'
const finding = (id: string, value: number): Finding => ({ id, handle:id, workerId:'maintenance', tool:'analyze_findings', datasetId:'qa', asOf:'2026-10-17', title:id, shape:'list', columns:[{key:'value',label:'Hours',type:'number'}], rows:[{value}], totalRows:1, evidence:[], rowEvidence:[[]], slots:{}, rulesApplied:[], conflicts:[], caveats:[] })
const part = (id: string, value: number) => ({type:'data-visual' as const,data:{surfaceId:'revisable',visual:'table' as const,finding:finding(id,value)}})
describe('revised answer cards',()=>{
 it('replaces data and evidence association without adding a second card',()=>{
  const s=useChatStore.getState();s.reset('qa');s.setUser('qa');s.applyPart(part('first',2));s.applyPart(part('revised',8));
  const t=useChatStore.getState().threads.qa!;const cards=t.items.filter(i=>i.kind==='artifact');
  expect(cards).toHaveLength(1);expect(cards[0]!.findingId).toBe('revised');expect((t.surfaces.revisable!.data.finding as Finding).rows).toEqual([{value:8}]);
 })
 it('keeps the revised association when replaying saved messages',()=>{
  useChatStore.getState().reset('history');const base=useChatStore.getState().threads.history!;
  const t=threadFromHistory(base,[{role:'assistant',parts:[{type:'parts',parts:[part('first',2),part('revised',8)]}]}]);
  const cards=t.items.filter(i=>i.kind==='artifact');expect(cards).toHaveLength(1);expect(cards[0]!.findingId).toBe('revised');
 })
})
