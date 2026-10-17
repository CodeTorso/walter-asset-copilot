// Walter's message body: GFM markdown + LaTeX (KaTeX) + [[ID]] citation chips. No raw HTML from model text.
import "katex/dist/katex.min.css"
import { memo, type ComponentProps } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { CITATION_PATTERN } from "@/contracts"
import { CiteChip } from "@/components/catalog"
import { cn } from "@/lib/utils"

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> }

/** remark plugin: split text nodes on [[ID]] into `cite` nodes rendered as <cite-ref data-id>. Math/code nodes are not text, so untouched. */
function remarkCitations() {
  const walk = (node: MdNode) => {
    if (!node.children) return
    const out: MdNode[] = []
    for (const child of node.children) {
      if (child.type === "text" && child.value && child.value.includes("[[")) {
        const re = new RegExp(CITATION_PATTERN.source, "g")
        let last = 0
        for (const m of child.value.matchAll(re)) {
          const at = m.index ?? 0
          if (at > last) out.push({ type: "text", value: child.value.slice(last, at).replace(/\s+$/, "") })
          out.push({ type: "cite", data: { hName: "sup", hProperties: { dataCite: m[1] }, hChildren: [{ type: "text", value: m[1] }] } })
          last = at + m[0].length
        }
        if (last < child.value.length) out.push({ type: "text", value: child.value.slice(last) })
      } else {
        walk(child)
        out.push(child)
      }
    }
    node.children = out
  }
  return (tree: MdNode) => walk(tree)
}

const components: Components = {
  sup: ({ node: _n, children, ...props }) => {
    const id = (props as Record<string, unknown>)["data-cite"]
    if (typeof id === "string") return <CiteChip id={id} />
    return <sup {...props}>{children}</sup>
  },
  a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  table: ({ node: _n, ...props }) => (
    <div className="md-table-wrap scroll-thin">
      <table {...props} />
    </div>
  ),
}

/** Hide a half-streamed marker (`[[INS-01`) so it never flashes as literal text. */
const trimPartial = (t: string) => t.replace(/\[\[[^\]\n]{0,40}\]?$/, "")

export const Markdown = memo(function Markdown({ text, streaming, className }: { text: string; streaming?: boolean; className?: string } & Omit<ComponentProps<"div">, "children">) {
  return (
    <div className={cn("md", streaming && "md-streaming", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath, remarkCitations]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]} components={components} skipHtml>
        {streaming ? trimPartial(text) : text}
      </ReactMarkdown>
    </div>
  )
})
