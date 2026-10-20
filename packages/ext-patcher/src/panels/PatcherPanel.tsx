/**
 * The Patcher tool's panel (#14): the instrument's LIVE composed graph drawn with React Flow, and
 * the inspector for the node the player clicks.
 *
 * The graph is the one the engine runs (`../app/liveGraph.ts`), redrawn whenever the engine commits
 * a new one, so switching instruments or turning a branch's dial on shows up here at once. The
 * canvas is a view: nodes can be moved around and the canvas panned and zoomed, but nothing is
 * connected, reconnected or deleted (topology editing is v2), so no canvas gesture reaches the
 * engine. The node layout is layered by longest path (`../lib/layout.ts`).
 */
import { useMemo, useState } from 'react';
import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ExtensionToolPanelProps } from '@thoremin/sdk-ui/types';
import { layoutGraph } from '../lib/layout';
import { useLiveGraph } from '../app/liveGraph';
import NodeInspector from './NodeInspector';

const NODE_STYLE = { width: 170, fontSize: 11, padding: 6, background: '#1f2937', color: '#f9fafb', border: '1px solid rgba(255,255,255,0.2)' } as const;
const SELECTED_STYLE = { ...NODE_STYLE, border: '1px solid #6ee7b7' } as const;

export default function PatcherPanel(_props: ExtensionToolPanelProps) {
  const { spec, version, reader } = useLiveGraph();
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    if (!spec) return { nodes: [] as Node[], edges: [] as Edge[] };
    const nodes: Node[] = layoutGraph(spec).map((p) => ({
      id: p.id,
      position: { x: p.x, y: p.y },
      data: { label: `${p.id} · ${p.type}` },
      style: p.id === selected ? SELECTED_STYLE : NODE_STYLE,
      sourcePosition: 'right' as Node['sourcePosition'],
      targetPosition: 'left' as Node['targetPosition'],
      connectable: false,
      deletable: false,
    }));
    const edges: Edge[] = spec.edges.map((e) => ({
      id: `${e.from.node}.${e.from.port}>${e.to.node}.${e.to.port}`,
      source: e.from.node,
      target: e.to.node,
      deletable: false,
      reconnectable: false,
      animated: false,
      style: e.delayed ? { strokeDasharray: '4 3' } : undefined,
    }));
    return { nodes, edges };
    // `version` changes with every committed graph; `spec` is a fresh object then too.
  }, [spec, version, selected]);

  if (!spec) return <p className="text-xs text-white/60" data-patcher-empty>Waiting for the instrument to start: the graph appears as soon as it runs.</p>;
  return (
    <div className="space-y-3" data-patcher>
      <p className="text-[11px] text-white/60">
        {spec.nodes.length} parts, {spec.edges.length} connections. Click a part to see what flows through it and tune the settings that feed it.
      </p>
      <div className="h-80 w-full overflow-hidden rounded-lg border border-white/10" data-patcher-canvas>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          colorMode="dark"
          fitView
          minZoom={0.1}
          nodesConnectable={false}
          edgesReconnectable={false}
          deleteKeyCode={null}
          onNodeClick={(_, node) => setSelected(node.id)}
          onPaneClick={() => setSelected(null)}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {selected ? <NodeInspector spec={spec} nodeId={selected} reader={reader} /> : <p className="text-xs text-white/40">No part selected.</p>}
    </div>
  );
}
