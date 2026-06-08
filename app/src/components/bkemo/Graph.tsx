import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RootStore } from '@/store';
import { BlinkoStore } from '@/store/blinkoStore';
import type { Note } from '@shared/lib/types';
import { extractNoteLinkIds, noteLinkTitle } from '@/lib/noteLinks';
import { isTask, isDone } from '@/lib/taskFilters';
import { eventBus } from '@/lib/event';

type GNode = { id: number; label: string; deg: number; task: boolean; done: boolean; x: number; y: number; vx: number; vy: number };
type GEdge = { s: number; t: number };

/** Read a few theme colors off the live DOM (canvas can't use CSS vars). */
function readColors(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    accent: get('--accent', '#c8924a'),
    fg: get('--fg', '#e8e6e1'),
    fg3: get('--fg-3', '#62666d'),
    edge: get('--border-2', '#2d2f36'),
    bg: get('--bg', '#16171a'),
  };
}

/**
 * Obsidian-style relation graph: a node per memo, an edge per `[[memo]]` link
 * (extracted from the body via `extractNoteLinkIds`). A small force simulation
 * (repulsion + edge springs + gravity) lays it out on a canvas; pan by dragging
 * empty space, zoom with the wheel, drag a node to reposition, click to open.
 */
export const Graph = observer(function Graph({ onOpen, showAll }: { onOpen?: (n: Note) => void; showAll?: boolean }) {
  const blinko = RootStore.Get(BlinkoStore);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    blinko.queryNotes({ type: -1, isRecycle: false, isArchived: false }, 1, 1000)
      .then((list) => { if (!cancelled) setNotes(list); })
      .catch((e) => console.error('[graph] load failed:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinko.updateTicker]);

  // Build the [[ ]] link graph: only memos that participate in a link.
  const { nodes, edges, adjacency } = useMemo(() => {
    const byId = new Map<number, Note>();
    notes.forEach((n) => { if (n.id != null) byId.set(n.id, n); });
    const edges: GEdge[] = [];
    const deg = new Map<number, number>();
    const seen = new Set<string>();
    notes.forEach((n) => {
      if (n.id == null) return;
      extractNoteLinkIds(n.content ?? '').forEach((tid) => {
        if (tid === n.id || !byId.has(tid)) return;
        const key = n.id! < tid ? `${n.id}-${tid}` : `${tid}-${n.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({ s: n.id!, t: tid });
        deg.set(n.id!, (deg.get(n.id!) ?? 0) + 1);
        deg.set(tid, (deg.get(tid) ?? 0) + 1);
      });
    });
    const adjacency = new Map<number, Set<number>>();
    edges.forEach(({ s, t }) => {
      if (!adjacency.has(s)) adjacency.set(s, new Set());
      if (!adjacency.has(t)) adjacency.set(t, new Set());
      adjacency.get(s)!.add(t);
      adjacency.get(t)!.add(s);
    });
    // Default to the link graph (degree ≥ 1); `showAll` adds isolated notes too.
    const nodeIds = showAll
      ? notes.filter((n) => n.id != null).map((n) => n.id!)
      : [...deg.keys()];
    const nodes: GNode[] = [];
    const R = 260;
    const count = nodeIds.length;
    nodeIds.forEach((id, i) => {
      const note = byId.get(id);
      if (!note) return;
      const a = (i / Math.max(1, count)) * Math.PI * 2;
      nodes.push({
        id, label: noteLinkTitle(note.content), deg: deg.get(id) ?? 0,
        task: isTask(note), done: isTask(note) && isDone(note),
        x: Math.cos(a) * R + (Math.random() - 0.5) * 40,
        y: Math.sin(a) * R + (Math.random() - 0.5) * 40,
        vx: 0, vy: 0,
      });
    });
    return { nodes, edges, adjacency };
  }, [notes, showAll]);

  // ── Canvas force simulation + interaction ──
  const view = useRef({ scale: 1, ox: 0, oy: 0 });
  const hovered = useRef<number | null>(null);
  const drag = useRef<{ id: number | null; panning: boolean; lastX: number; lastY: number; moved: boolean }>({ id: null, panning: false, lastX: 0, lastY: 0, moved: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let alpha = 1; // simulation "heat" — cools so it settles, reheats on interaction
    const colors = readColors(wrap);
    const posById = new Map<number, GNode>();
    nodes.forEach((n) => posById.set(n.id, n));

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const radius = (n: GNode) => 4 + Math.min(11, Math.sqrt(n.deg) * 3);

    const toWorld = (sx: number, sy: number) => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const { scale, ox, oy } = view.current;
      return { x: (sx - w / 2 - ox) / scale, y: (sy - h / 2 - oy) / scale };
    };
    const nodeAt = (sx: number, sy: number): GNode | null => {
      const { x, y } = toWorld(sx, sy);
      let best: GNode | null = null; let bestD = Infinity;
      for (const n of nodes) {
        const dx = n.x - x, dy = n.y - y; const d = dx * dx + dy * dy;
        const r = radius(n) + 6;
        if (d < r * r && d < bestD) { bestD = d; best = n; }
      }
      return best;
    };

    const step = () => {
      if (alpha > 0.02) {
        // repulsion (O(n^2) — fine for the typical few-hundred linked notes)
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) { d2 = 0.01; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
            const f = 1600 / d2;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
          }
        }
        // edge springs
        for (const e of edges) {
          const a = posById.get(e.s)!, b = posById.get(e.t)!;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - 90) * 0.015;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
        // gravity toward center + integrate
        for (const n of nodes) {
          if (drag.current.id === n.id) { n.vx = 0; n.vy = 0; continue; }
          n.vx += -n.x * 0.012; n.vy += -n.y * 0.012;
          n.vx *= 0.82; n.vy *= 0.82;
          n.x += n.vx * alpha; n.y += n.vy * alpha;
        }
        alpha *= 0.992;
      }
      draw();
      raf = requestAnimationFrame(step);
    };

    const draw = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const { scale, ox, oy } = view.current;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + ox, h / 2 + oy);
      ctx.scale(scale, scale);

      const hov = hovered.current;
      const neighbors = hov != null ? (adjacency.get(hov) ?? new Set()) : null;

      // edges
      ctx.lineWidth = 1 / scale;
      for (const e of edges) {
        const a = posById.get(e.s)!, b = posById.get(e.t)!;
        const lit = hov != null && (e.s === hov || e.t === hov);
        ctx.strokeStyle = lit ? colors.accent : colors.edge;
        ctx.globalAlpha = hov != null && !lit ? 0.25 : 0.7;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // nodes
      for (const n of nodes) {
        const r = radius(n);
        const isHov = n.id === hov;
        const isNeighbor = neighbors?.has(n.id);
        const dim = hov != null && !isHov && !isNeighbor;
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.task ? colors.accent : colors.fg3;
        ctx.fill();
        if (isHov || isNeighbor) { ctx.lineWidth = 1.5 / scale; ctx.strokeStyle = colors.accent; ctx.stroke(); }
      }

      // labels: hovered + neighbors, plus hubs when zoomed in enough
      ctx.globalAlpha = 1;
      ctx.font = `${11 / scale}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (const n of nodes) {
        const isHov = n.id === hov;
        const isNeighbor = neighbors?.has(n.id);
        const showHub = hov == null && (n.deg >= 3 || scale > 1.4);
        if (!isHov && !isNeighbor && !showHub) continue;
        ctx.fillStyle = isHov ? colors.fg : colors.fg3;
        const label = n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label;
        ctx.fillText(label, n.x, n.y + radius(n) + 3 / scale);
      }
      ctx.restore();
    };

    // interaction
    const onDown = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
      const n = nodeAt(sx, sy);
      drag.current = { id: n ? n.id : null, panning: !n, lastX: sx, lastY: sy, moved: false };
    };
    const onMove = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
      const d = drag.current;
      if (d.id != null) {
        const { x, y } = toWorld(sx, sy);
        const node = posById.get(d.id)!; node.x = x; node.y = y; node.vx = 0; node.vy = 0;
        d.moved = true; alpha = Math.max(alpha, 0.4);
      } else if (d.panning) {
        view.current.ox += sx - d.lastX; view.current.oy += sy - d.lastY;
        d.lastX = sx; d.lastY = sy; d.moved = true;
      } else {
        const n = nodeAt(sx, sy);
        hovered.current = n ? n.id : null;
        canvas.style.cursor = n ? 'pointer' : 'grab';
      }
    };
    const onUp = (ev: MouseEvent) => {
      const d = drag.current;
      if (d.id != null && !d.moved) {
        const note = notes.find((x) => x.id === d.id);
        if (note) onOpen ? onOpen(note) : eventBus.emit('bkemo:open-note', { id: d.id });
      }
      drag.current = { id: null, panning: false, lastX: 0, lastY: 0, moved: false };
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const before = toWorld(sx, sy);
      const factor = Math.exp(-ev.deltaY * 0.0015);
      view.current.scale = Math.min(4, Math.max(0.2, view.current.scale * factor));
      // keep the world point under the cursor stationary after the zoom
      const { scale } = view.current;
      view.current.ox = sx - w / 2 - before.x * scale;
      view.current.oy = sy - h / 2 - before.y * scale;
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.style.cursor = 'grab';
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, adjacency]);

  return (
    <div className="v-stack" style={{ flex: 1, height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>
      <div className="h-stack" style={{ height: 44, padding: '0 18px', borderBottom: '1px solid var(--border)', gap: 12, background: 'var(--bg)', flexShrink: 0 }}>
        <span style={{ color: 'var(--fg)', fontSize: 13, fontWeight: 600 }}>Graph</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>Link graph</span>
        <span className="spacer" />
        <span style={{ color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{nodes.length} notes · {edges.length} links</span>
      </div>
      <div ref={wrapRef} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
        {!loading && nodes.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12, pointerEvents: 'none', padding: 24 }}>
            No links yet. Connect memos with <span style={{ color: 'var(--accent)', margin: '0 4px' }}>[[</span> in any composer.
          </div>
        )}
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontSize: 12, pointerEvents: 'none' }}>Loading…</div>
        )}
      </div>
    </div>
  );
});
