import type { DocSection } from "./types"

const HEADING = /^(#{1,6})\s+(.*?)\s*$/
const NUMBERED = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/
const PROTOCOL_ROW = /^\|\s*\*{0,2}([A-Z]{2}-\d{2})\*{0,2}\s*\|/

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/** Split markdown at headings. The section id is the heading number ("9.3") or a slug. Protocol table rows (SR-01) also become their own sections. */
export function splitSections(md: string): { title: string; sections: DocSection[] } {
  const lines = md.split(/\r?\n/)
  const sections: DocSection[] = []
  let title = ""
  let cur: { section: string; heading: string; lines: string[] } | null = null
  const flush = () => {
    if (!cur) return
    const text = cur.lines.join("\n").trim()
    if (text || cur.heading) sections.push({ section: cur.section, heading: cur.heading, text })
    cur = null
  }
  for (const line of lines) {
    const h = HEADING.exec(line)
    if (h) {
      flush()
      const level = h[1]!.length
      const raw = h[2]!
      if (level === 1 && !title) title = raw
      const n = NUMBERED.exec(raw)
      cur = {
        section: n ? n[1]! : slug(raw),
        heading: n ? n[2]! : raw,
        lines: [],
      }
      continue
    }
    if (!cur) cur = { section: "preamble", heading: "Preamble", lines: [] }
    cur.lines.push(line)
  }
  flush()
  const extra: DocSection[] = []
  for (const s of sections) {
    for (const line of s.text.split("\n")) {
      const m = PROTOCOL_ROW.exec(line)
      if (m) extra.push({ section: m[1]!, heading: `${m[1]} (section ${s.section})`, text: line.trim() })
    }
  }
  return { title, sections: [...sections, ...extra] }
}

/** Smaller quoting units inside a section: one per paragraph, list item or table row. */
export function units(text: string): string[] {
  const out: string[] = []
  let buf: string[] = []
  const flush = () => {
    if (buf.length) out.push(buf.join("\n").trim())
    buf = []
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      flush()
    } else if (/^\s*(?:[-*]|\d+\.)\s+/.test(line) || line.startsWith("|")) {
      flush()
      buf.push(line)
    } else {
      buf.push(line)
    }
  }
  flush()
  return out.filter(Boolean)
}

const BLOCK_START = /^(?:\||-|\*|#|\d+\.)/

/** Sentence-level verbatim quote around a character offset (decimals like 9.4 and soft line wraps do not split). */
export function sentenceAround(text: string, index: number): string {
  const lineStart = (i: number) => i === 0 || text[i - 1] === "\n"
  let start = index
  while (start > 0) {
    if (text.slice(Math.max(0, start - 2), start) === ". ") break
    if (lineStart(start) && (BLOCK_START.test(text.slice(start, start + 3)) || text[start - 2] === "\n" || start === 1)) break
    start--
  }
  let end = index
  while (end < text.length) {
    if (text[end] === "\n") {
      const next = text.slice(end + 1, end + 4)
      if (next === "" || next[0] === "\n" || BLOCK_START.test(next)) break
    }
    if (text[end] === "." && (text[end + 1] === " " || text[end + 1] === "\n" || text[end + 1] === undefined)) {
      end++
      break
    }
    end++
  }
  return text.slice(start, end).trim()
}
