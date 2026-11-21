import { CopyButton } from "./CopyButton";

/** A shell command in a dark panel with a copy button. Selectable text, never run by the site. */
export function CommandBlock({ command, label }: { command: string; label: string }) {
  return (
    <div className="stage flex items-start justify-between gap-3 rounded-xl py-3 pl-4 pr-2">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[0.8125rem] leading-6" tabIndex={0} aria-label={label}>
        <code>
          <span aria-hidden className="select-none text-ink-3">$ </span>
          {command}
        </code>
      </pre>
      <CopyButton value={command} label={label} />
    </div>
  );
}
