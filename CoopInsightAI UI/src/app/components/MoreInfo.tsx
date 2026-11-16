import { useState, type ReactNode } from "react";
import { Info, ChevronDown } from "lucide-react";

/**
 * Explanations live here, folded, at the foot of a page — not as paragraphs
 * above the work. One line on the page says what it is for; anyone who wants
 * the method, the rules or the caveats opens this.
 */
export function MoreInfo({ title = "More info", children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-gray-200 bg-white/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-gray-700 hover:text-[#2D6A4F]"
      >
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 text-[#2D6A4F]" />
          {title}
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-2 border-t border-gray-100 px-4 py-3 text-sm leading-relaxed text-gray-600">{children}</div>}
    </div>
  );
}
