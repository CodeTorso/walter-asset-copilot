import { sentenceAround, splitSections } from "./markdown"
import type { FactRow } from "./types"

const COMPLIANCE_ROW = /^\|\s*([^|]+?)\s*\|\s*\**\s*(Met|Not met|In progress|Action required|N\/A|[A-Za-z ]+?)\s*\**\s*\|\s*(.*?)\s*\|\s*$/

/** Deterministic regex extraction of facts that exist only in free-text maintenance reports. Each fact keeps the verbatim quote. */
export function extractReportFacts(maintenanceId: string, docId: string, md: string): FactRow[] {
  const facts: FactRow[] = []
  const { sections } = splitSections(md)

  const cont = /\bcontained\s+(?:about|approximately|roughly)?\s*\**(\d+(?:\.\d+)?)\**\s*hours?/i.exec(md)
  if (cont) {
    const sec = sections.find((s) => s.text.includes(cont[0]))
    facts.push({
      maintenanceId,
      fact: "containment_hours",
      key: "",
      value: cont[1]!,
      quote: sentenceAround(md, cont.index),
      docId,
      section: sec?.section,
      method: "regex",
      confidence: 1,
    })
  }

  const total = /\|\s*\**Total\**\s*\|\s*\**\s*([\d,]+(?:\.\d+)?)\s*\**\s*\|/i.exec(md)
  if (total) {
    const sec = sections.find((s) => s.text.includes(total[0]))
    facts.push({
      maintenanceId,
      fact: "cost_total",
      key: "",
      value: total[1]!.replace(/,/g, ""),
      quote: total[0].trim(),
      docId,
      section: sec?.section,
      method: "regex",
      confidence: 1,
    })
  }

  const cls = /\((minor|moderate|reportable|major) class\)/i.exec(md)
  if (cls) {
    facts.push({
      maintenanceId,
      fact: "reported_class",
      key: "",
      value: cls[1]!.toLowerCase(),
      quote: sentenceAround(md, cls.index),
      docId,
      method: "regex",
      confidence: 1,
    })
  }

  const comp = sections.find((s) => /compliance check/i.test(s.heading))
  if (comp) {
    for (const line of comp.text.split("\n")) {
      if (!line.startsWith("|") || /^\|\s*[-:| ]+\|?\s*$/.test(line) || /^\|\s*Protocol\s*\|/i.test(line)) continue
      const m = COMPLIANCE_ROW.exec(line)
      if (!m) continue
      facts.push({
        maintenanceId,
        fact: "compliance_row",
        key: m[1]!.trim(),
        value: m[2]!.trim(),
        detail: m[3]!.trim(),
        quote: line.trim(),
        docId,
        section: comp.section,
        method: "regex",
        confidence: 1,
      })
    }
  }
  return facts
}
