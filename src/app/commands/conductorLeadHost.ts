/**
 * The seam the body conductor's timing commands (#427) reach the player's lead offsets
 * through. The offsets are a per-device pref in the hot store, which a command may not
 * import (`test/commands_firewall.test.ts`), so the app installs this host when
 * `src/app/conductorLeadHost.ts` loads, like the song host.
 */
export interface ConductorLeadHost {
  /** The finished take's offsets, or null when no take has finished. */
  pending(): Record<string, number> | null;
  /** Keep the finished take's offsets (replacing the old set) and close the take. */
  keep(): Record<string, number> | null;
  /** Forget the kept offsets. */
  clear(): void;
}

let host: ConductorLeadHost | null = null;

/** Installed by `src/app/conductorLeadHost.ts` when it loads. */
export function provideConductorLeadHost(next: ConductorLeadHost | null): void {
  host = next;
}

/** The installed host; throws, naming the seam, when none is. */
export function conductorLeadHost(): ConductorLeadHost {
  if (!host) throw new Error('conductor lead host not installed: load src/app/conductorLeadHost before dispatching a conductor timing command');
  return host;
}
