/**
 * "How to play this" (the player guide): the link at the top of an instrument's editor to the
 * guide's page for it, or for its area when it is a player's own instrument. Opens in a new tab
 * so the live session (camera, sound) is not left. The shipping rule's answer for the guide: a
 * feature nobody can find is not shipped, and an instrument you cannot learn about is half shipped.
 */
import { guideLinkFor } from './links';

export function GuideLink({ name, classId, shipped }: { name: string | undefined; classId: string | undefined; shipped: ReadonlySet<string> }) {
  const { href, own } = guideLinkFor(name, classId, shipped);
  return (
    <a
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-sky-400/30 bg-sky-400/10 px-3 py-2 text-left text-xs text-sky-200 transition hover:bg-sky-400/20"
      data-testid="guide-link"
      data-own={own ? 'true' : 'false'}
      href={href}
      target="_blank"
      rel="noopener"
    >
      <span className="font-semibold">{own ? 'Guide: how to play this' : 'Guide: about this kind of instrument'}</span>
      <span className="text-[10px] text-sky-200/60">opens in a new tab</span>
    </a>
  );
}
