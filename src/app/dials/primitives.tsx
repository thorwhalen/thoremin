/**
 * Dials panel primitives — the generic, domain-free UI atoms the settings panels are
 * built from. Extracted from `DialsControlsPanel.tsx` (where they sat above seven
 * feature sections at a completely different altitude) so a panel file contains only
 * its own domain, and so other panels (InstrumentsPanel, LabControls, …) can reuse
 * these instead of re-deriving them.
 *
 * Purely presentational: no store access, no dials knowledge.
 */
import type { ReactNode } from 'react';

/** The shared `<select>` / text-input chrome used across the settings panels. */
export const selectCls = 'rounded bg-white/10 px-2 py-1 text-xs outline-none focus:bg-white/20';

/** A labelled checkbox. */
export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 text-xs ${disabled ? 'opacity-40' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** A collapsible settings group (native <details>), used to group the overlay
 * elements by their category (Input features / Output features / Guides / …). */
export function CollapsibleSection({
  label,
  defaultOpen = true,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen}>
      <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-white/60 transition hover:text-white/90">
        {label}
      </summary>
      <div className="mt-2 space-y-2 pl-1">{children}</div>
    </details>
  );
}

/**
 * A labelled row with a live numeric readout and a SLOT for its control — the chrome
 * around a settings slider.
 *
 * It lives here, at module scope, rather than inside the panel that uses it, and that is
 * load-bearing rather than tidiness: a component declared inside another component's body
 * is a NEW function identity on every render, so React's reconciler sees a different
 * element type and unmounts the subtree instead of updating it. For an
 * `<input type="range">` that is fatal — the DOM node under the pointer is replaced after
 * the first pointer-move, ending the native drag, and keyboard focus drops to <body> after
 * one arrow key. `test/face_axes_panel.test.tsx` pins the resulting node identity.
 *
 * The control is a `children` slot rather than a prop so the `<input type="range">` stays
 * at the CALL SITE: `test/dials_write_path.test.ts` sanctions a direct dials write by the
 * source range of the literal range element, and burying the input in a helper would hide
 * Decision B from that AST guard instead of keeping it auditable.
 */
export function ValueRow({
  label,
  value,
  children,
}: {
  label: string;
  value: number;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs" title={`${label}: ${value}`}>
      <span className="text-white/70">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="w-9 text-right tabular-nums text-[10px] text-white/40">{value}</span>
        {children}
      </span>
    </label>
  );
}

/**
 * A top-level collapsible group (Sound / Face / Overlay / …) — the accordion that
 * keeps the panel from overwhelming as settings grow. More prominent than the
 * inner {@link CollapsibleSection}; a ▸/▾ marker and a divider above.
 */
export function TopSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group border-t border-white/10 pt-3 [&[open]>summary>span.mk]:rotate-90">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/70 transition hover:text-white">
        <span className="mk inline-block transition-transform">▸</span>
        {label}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}
