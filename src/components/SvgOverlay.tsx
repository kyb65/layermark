// src/components/SvgOverlay.tsx
// SVG overlay renderer — rendered on top of the markdown content via absolute positioning.
// Phase 2: underline, highlight, bracket, box, note bubbles.
// Phase 4: connection arrows.

import { useEffect, useRef, useState, useCallback } from "react";
import type { LmmDocument } from "../types/lmm";
import type { ResolvedAnchor, MenuState } from "../types/overlay";
import { getLineRects, buildDrawInstruction } from "../lib/overlay";
import type { DrawInstruction, LineRect } from "../lib/overlay";

// Ghost: anchor with no annotations — shows a faint indicator so the user
// knows the anchor exists and can click it to add an annotation.
interface GhostAnchor {
  anchorId: string;
  rects: LineRect[];
}

interface Props {
  contentRef: React.RefObject<HTMLElement | null>;
  lmmDoc: LmmDocument;
  resolvedAnchors: ResolvedAnchor[];
  onAnchorClick: (menu: MenuState) => void;
}

export function SvgOverlay({ contentRef, lmmDoc, resolvedAnchors, onAnchorClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [instructions, setInstructions] = useState<DrawInstruction[]>([]);
  const [ghosts, setGhosts] = useState<GhostAnchor[]>([]);
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });
  // Track open note bubble IDs
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());

  const rebuild = useCallback(() => {
    const container = contentRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    setSvgSize({ width: containerRect.width, height: containerRect.height });

    const instrs: DrawInstruction[] = [];

    for (let i = 0; i < lmmDoc.annotations.length; i++) {
      const ann = lmmDoc.annotations[i];
      // Resolve which anchor this annotation targets
      let anchorId: string | null = null;
      if ("target" in ann) anchorId = ann.target;
      else if (ann.type === "connection") anchorId = ann.from; // Phase 4 will handle properly

      if (!anchorId) continue;

      const ra = resolvedAnchors.find((r) => r.id === anchorId);
      if (!ra) continue;

      const rects = getLineRects(container as HTMLElement, ra, containerRect);
      const instr = buildDrawInstruction(ann, anchorId, rects, i, lmmDoc.anchors);
      if (instr) instrs.push(instr);
    }

    setInstructions(instrs);

    // Ghost: anchors that have no annotation targeting them
    const annotatedAnchorIds = new Set(
      lmmDoc.annotations
        .filter((a) => "target" in a)
        .map((a) => (a as { target: string }).target)
    );
    const ghostList: GhostAnchor[] = [];
    for (const ra of resolvedAnchors) {
      if (!annotatedAnchorIds.has(ra.id)) {
        const rects = getLineRects(container as HTMLElement, ra, containerRect);
        if (rects.length > 0) ghostList.push({ anchorId: ra.id, rects });
      }
    }
    setGhosts(ghostList);
  }, [contentRef, lmmDoc, resolvedAnchors]);

  // Rebuild on data or layout change
  useEffect(() => {
    rebuild();
  }, [rebuild]);

  // Rebuild on window resize
  useEffect(() => {
    const ro = new ResizeObserver(rebuild);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [contentRef, rebuild]);

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    // Find which annotation was clicked by data attribute
    const target = e.target as SVGElement;
    const group = target.closest("[data-anchor-id]") as SVGElement | null;
    if (!group) return;
    const anchorId = group.dataset.anchorId;
    if (!anchorId) return;

    const svgRect = svgRef.current!.getBoundingClientRect();
    onAnchorClick({
      anchorId,
      x: e.clientX - svgRect.left,
      y: e.clientY - svgRect.top,
    });
  }

  function toggleNote(annotationId: string) {
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(annotationId)) next.delete(annotationId);
      else next.add(annotationId);
      return next;
    });
  }

  return (
    <svg
      ref={svgRef}
      className="lm-svg-overlay"
      width={svgSize.width}
      height={svgSize.height}
      style={{ overflow: "visible", pointerEvents: "none" }}
      onClick={handleSvgClick}
    >
      {/* Ghost layer: anchors with no annotations yet (bottommost) */}
      {ghosts.map((g) => (
        <g
          key={`ghost-${g.anchorId}`}
          data-anchor-id={g.anchorId}
          style={{ pointerEvents: "all", cursor: "pointer" }}
          onClick={(e) => {
            const svgRect = svgRef.current!.getBoundingClientRect();
            onAnchorClick({ anchorId: g.anchorId, x: e.clientX - svgRect.left, y: e.clientY - svgRect.top });
          }}
        >
          {g.rects.map((r, i) => (
            <rect
              key={i}
              x={r.x}
              y={r.y}
              width={r.width}
              height={r.height}
              fill="var(--accent)"
              opacity={0.08}
              rx={2}
            />
          ))}
          {g.rects.map((r, i) => (
            <line
              key={`u-${i}`}
              x1={r.x}
              y1={r.baseline + 1}
              x2={r.x + r.width}
              y2={r.baseline + 1}
              stroke="var(--accent)"
              strokeWidth={1}
              opacity={0.35}
              strokeDasharray="3 2"
            />
          ))}
        </g>
      ))}

      {/* Render highlights first (bottom layer) */}
      {instructions
        .filter((ins) => ins.type === "highlight")
        .map((ins) => (
          <OverlayGroup key={ins.annotationId} ins={ins} />
        ))}

      {/* Render underlines and brackets */}
      {instructions
        .filter((ins) => ins.type !== "highlight" && ins.type !== "note")
        .map((ins) => (
          <OverlayGroup key={ins.annotationId} ins={ins} />
        ))}

      {/* Render notes last (top layer) */}
      {instructions
        .filter((ins) => ins.type === "note")
        .map((ins) => (
          <NoteGroup
            key={ins.annotationId}
            ins={ins}
            isOpen={openNotes.has(ins.annotationId)}
            onToggle={() => toggleNote(ins.annotationId)}
          />
        ))}
    </svg>
  );
}

// ── Individual group renderers ────────────────────────────────────────────────

function OverlayGroup({ ins }: { ins: DrawInstruction }) {
  // highlight uses filled rects — needs "fill" to be clickable.
  // other types draw strokes only — "stroke" is sufficient and
  // avoids blocking text selection in the fill area.
  const pe = ins.type === "highlight" ? "fill" : "stroke";
  return (
    <g
      data-anchor-id={ins.anchorId}
      data-annotation-id={ins.annotationId}
      style={{ pointerEvents: pe, cursor: "pointer" }}
      className={`lm-overlay-group lm-overlay-${ins.type}`}
    >
      {ins.paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          fill={p.fill ?? "none"}
          opacity={p.opacity}
          strokeDasharray={p.strokeDasharray}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

function NoteGroup({
  ins,
  isOpen,
  onToggle,
}: {
  ins: DrawInstruction;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const pos = ins.notePos;
  const content = ins.noteContent ?? "";

  // Estimate bubble width from content length
  const chars = [...content].length;
  const bubbleW = Math.min(Math.max(chars * 8 + 24, 80), 260);
  const bubbleH = content.length > 20 ? 52 : 34;
  const tailH = 8;

  return (
    <g
      data-anchor-id={ins.anchorId}
      data-annotation-id={ins.annotationId}
      style={{ pointerEvents: "all", cursor: "pointer" }}
      onClick={onToggle}
    >
      {/* Underline indicator */}
      {ins.paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          fill="none"
          strokeDasharray={p.strokeDasharray}
          strokeLinecap="round"
        />
      ))}

      {/* Note indicator dot */}
      {pos && (
        <circle
          cx={pos.x}
          cy={pos.y - 2}
          r={4}
          fill="var(--accent)"
          opacity={0.85}
        />
      )}

      {/* Bubble (shown when open) */}
      {isOpen && pos && (
        <NoteBubble
          x={pos.x}
          y={pos.y}
          content={content}
          w={bubbleW}
          h={bubbleH}
          tailH={tailH}
        />
      )}
    </g>
  );
}

function NoteBubble({
  x, y, content, w, h, tailH,
}: {
  x: number; y: number; content: string;
  w: number; h: number; tailH: number;
}) {
  // Position bubble above the note dot
  const bx = x - w / 2;
  const by = y - h - tailH - 8;

  // SVG foreignObject for text wrapping
  return (
    <g className="lm-note-bubble">
      {/* Drop shadow */}
      <rect
        x={bx + 2}
        y={by + 2}
        width={w}
        height={h}
        rx={6}
        fill="rgba(0,0,0,0.3)"
        filter="url(#lm-blur)"
      />
      {/* Bubble body */}
      <rect
        x={bx}
        y={by}
        width={w}
        height={h}
        rx={6}
        fill="var(--bg-2)"
        stroke="var(--accent)"
        strokeWidth={1.2}
      />
      {/* Tail */}
      <path
        d={`M ${x - 5} ${by + h} L ${x} ${by + h + tailH} L ${x + 5} ${by + h} Z`}
        fill="var(--bg-2)"
        stroke="var(--accent)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      {/* Text via foreignObject */}
      <foreignObject x={bx + 8} y={by + 6} width={w - 16} height={h - 12}>
        <div
          style={{
            fontSize: "12px",
            color: "var(--text)",
            lineHeight: "1.5",
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
            overflow: "hidden",
          }}
        >
          {content}
        </div>
      </foreignObject>
    </g>
  );
}
