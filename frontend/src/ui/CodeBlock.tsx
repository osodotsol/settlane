import type { ReactNode } from "react";

// A small, dependency-free code panel with hand-authored highlighting (so no highlighter is shipped).
// Tokens: k = keyword, t = type, f = function, c = comment. Always a dark panel, in both themes.
export type Tok = [kind: "k" | "t" | "f" | "c" | "p", text: string];

const COLOR: Record<Tok[0], string> = { k: "text-[#93a5ff]", t: "text-[#7fd0c0]", f: "text-[#e2a54a]", c: "text-[#8c919b] italic", p: "text-[#ecedef]" };

export function CodeBlock({ lines, label, footer }: { lines: Tok[][]; label: string; footer?: ReactNode }) {
  return (
    <figure className="code-panel m-0 min-w-0 overflow-hidden rounded-2xl">
      <figcaption className="flex items-center justify-between border-b border-line px-5 py-3 text-micro text-ink-3">
        <span>{label}</span>
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-line-control/50" />
          <span className="size-2.5 rounded-full bg-line-control/50" />
          <span className="size-2.5 rounded-full bg-line-control/50" />
        </span>
      </figcaption>
      <pre className="overflow-x-auto p-5 text-[0.875rem] leading-[1.75]" tabIndex={0} aria-label={label}>
        <code className="font-mono">
          {lines.map((line, i) => (
            <span key={i} className="block">
              {line.map(([k, t], j) => (
                <span key={j} className={COLOR[k]}>{t}</span>
              ))}
              {line.length === 0 ? " " : null}
            </span>
          ))}
        </code>
      </pre>
      {footer && <div className="border-t border-line px-5 py-3 text-sm text-ink-2">{footer}</div>}
    </figure>
  );
}
