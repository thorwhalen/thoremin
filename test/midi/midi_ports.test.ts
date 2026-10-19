/**
 * The store-controls bridge emits the MIDI dials as live ports (#137; the MIDI slice's since #600
 * S13, moved from `test/app_store.test.ts` with its assertions): the slice DERIVES them from its
 * dial (`DialSlice.ports`), so the `midi-out` node reads what it always read, next tick, no rebuild.
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { useControls } from '@/app/store';
import { makeStoreControlsNode } from '@/host/storeControls';
import { EXTENSIONS } from '@/extensions';
import { MIDI } from '../helpers/extensions';

const storeControlsNode = makeStoreControlsNode(EXTENSIONS);
const ctxWith = (resources: Record<string, unknown>): NodeContext => ({ tick: 0, time: 0, dt: 0, resources });

describe.runIf(MIDI)('store-controls node reads the store (the MIDI slice)', () => {
  it('emits the MIDI enable/port dials as live ports (#137)', () => {
    // Default: off, first available port — the graph-wired midi-out stays silent.
    useControls.setState({ midi: { enabled: false, port: '', muteFollowsMaster: true } });
    const node = storeControlsNode.make(storeControlsNode.params.parse({}));
    let out = node.process({}, ctxWith({ controls: () => useControls.getState() }));
    expect(out.midiEnabled).toBe(false);
    expect(out.midiPort).toBe('');
    // #168 Q3: the mute-semantics dial is a live port too, on by default.
    expect(out.midiMuteFollowsMaster).toBe(true);
    // Turning the dial on flows straight through — no rebuild, next tick.
    useControls.setState({ midi: { enabled: true, port: 'IAC Driver Bus 1', muteFollowsMaster: false } });
    out = node.process({}, ctxWith({ controls: () => useControls.getState() }));
    expect(out.midiEnabled).toBe(true);
    expect(out.midiPort).toBe('IAC Driver Bus 1');
    expect(out.midiMuteFollowsMaster).toBe(false);
  });

});
