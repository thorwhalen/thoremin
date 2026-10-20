/**
 * A recording fake of the Web Audio graph, for testing the browser-only output nodes
 * under Node. Every node a test's subject creates is kept, in creation order, with the
 * calls made on its AudioParams and its connections, so a test asserts what the node
 * scheduled (`setTargetAtTime(0, now, release)`) rather than what it sounds like.
 *
 * Only the surface the output nodes use is faked; a method a subject calls that is not
 * here throws, which is the signal to add it.
 */

export type ParamCall = [method: string, ...args: number[]];

export interface FakeParam {
  value: number;
  calls: ParamCall[];
  setValueAtTime(v: number, t: number): void;
  setTargetAtTime(v: number, t: number, tau: number): void;
  linearRampToValueAtTime(v: number, t: number): void;
  exponentialRampToValueAtTime(v: number, t: number): void;
  cancelScheduledValues(t: number): void;
}

export interface FakeNode {
  /** The factory that made it, without `create` (`'Oscillator'`, `'Gain'`, ...). */
  kind: string;
  /** What it was connected to (a node or a param), in order. */
  connections: unknown[];
  disconnected: number;
  started: number[];
  stopped: number[];
  [param: string]: unknown;
}

export function fakeParam(value = 0): FakeParam {
  const calls: ParamCall[] = [];
  return {
    value,
    calls,
    setValueAtTime: (v, t) => void calls.push(['set', v, t]),
    setTargetAtTime: (v, t, tau) => void calls.push(['target', v, t, tau]),
    linearRampToValueAtTime: (v, t) => void calls.push(['linear', v, t]),
    exponentialRampToValueAtTime: (v, t) => void calls.push(['exp', v, t]),
    cancelScheduledValues: (t) => void calls.push(['cancel', t]),
  };
}

/** The params each node kind carries. */
const PARAMS: Record<string, readonly string[]> = {
  Oscillator: ['frequency', 'detune'],
  Gain: ['gain'],
  BiquadFilter: ['frequency', 'Q'],
  StereoPanner: ['pan'],
  DynamicsCompressor: ['threshold', 'knee', 'ratio', 'attack', 'release'],
  Convolver: [],
  MediaElementSource: [],
  BufferSource: [],
};

export interface FakeAudio {
  ac: AudioContext;
  master: GainNode;
  /** Every node created, in order. */
  nodes: FakeNode[];
  /** The nodes of one kind, in order. */
  of(kind: string): FakeNode[];
  /** Move the context's clock. */
  setTime(t: number): void;
}

export function fakeAudio({ sampleRate = 8000, currentTime = 0 }: { sampleRate?: number; currentTime?: number } = {}): FakeAudio {
  const nodes: FakeNode[] = [];
  let now = currentTime;
  const make = (kind: string): FakeNode => {
    const node: FakeNode = {
      kind,
      connections: [],
      disconnected: 0,
      started: [],
      stopped: [],
      type: '',
      connect(target: unknown) {
        node.connections.push(target);
        return target;
      },
      disconnect() {
        node.disconnected += 1;
      },
      start(t = now) {
        node.started.push(t);
      },
      stop(t = now) {
        node.stopped.push(t);
      },
    };
    for (const p of PARAMS[kind] ?? []) node[p] = fakeParam();
    nodes.push(node);
    return node;
  };
  const ac = {
    sampleRate,
    get currentTime() {
      return now;
    },
    createOscillator: () => make('Oscillator'),
    createGain: () => make('Gain'),
    createBiquadFilter: () => make('BiquadFilter'),
    createStereoPanner: () => make('StereoPanner'),
    createDynamicsCompressor: () => make('DynamicsCompressor'),
    createConvolver: () => make('Convolver'),
    createBufferSource: () => make('BufferSource'),
    createMediaElementSource: (element: unknown) => Object.assign(make('MediaElementSource'), { mediaElement: element }),
    createBuffer: (channels: number, length: number, rate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: (c: number) => data[c] };
    },
  };
  const master = { kind: 'master', gain: fakeParam(1), connect() {}, disconnect() {} };
  return {
    ac: ac as unknown as AudioContext,
    master: master as unknown as GainNode,
    nodes,
    of: (kind) => nodes.filter((n) => n.kind === kind),
    setTime: (t) => {
      now = t;
    },
  };
}

/** The param of a fake node, typed. */
export const param = (node: FakeNode, name: string): FakeParam => node[name] as FakeParam;
