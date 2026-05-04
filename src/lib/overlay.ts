// src/lib/overlay.ts
// SVG overlay engine: DOM bounding boxes → SVG drawing instructions
// Phase 2: underline, highlight, bracket, box, note

import type { Annotation, Anchor } from "../types/lmm";
import type { ResolvedAnchor } from "../types/overlay";

// ── BoundingRect ──────────────────────────────────────────────────────────────
// A single visual line-segment of a marked region.
// One anchor may span multiple lines → multiple rects.
export interface LineRect {
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number; // y + ascent, approx. y + height * 0.82
}

// ── Get rects for a resolved anchor ──────────────────────────────────────────
// Uses Range.getClientRects() for sub-word precision.
// containerRect: the markdown body's getBoundingClientRect()
export function getLineRects(
  container: HTMLElement,
  ra: ResolvedAnchor,
  containerRect: DOMRect
): LineRect[] {
  const entries = buildTextNodeEntries(container);
  const raEnd = ra.position + ra.length;

  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const entry of entries) {
    if (startNode === null && entry.end > ra.position) {
      startNode = entry.node;
      const localStart = ra.position - entry.start;
      startOffset = cpToUtf16Offset(entry.node.textContent ?? "", localStart);
    }
    if (entry.end >= raEnd) {
      endNode = entry.node;
      const localEnd = raEnd - entry.start;
      endOffset = cpToUtf16Offset(entry.node.textContent ?? "", localEnd);
      break;
    }
  }

  if (!startNode || !endNode) return [];

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const rects = Array.from(range.getClientRects()).filter(
    (r) => r.width > 0 && r.height > 0
  );

  const merged = mergeAdjacentRects(rects);

  return merged.map((r) => ({
    x: r.left - containerRect.left,
    y: r.top - containerRect.top,
    width: r.width,
    height: r.height,
    baseline: r.top - containerRect.top + r.height * 0.82,
  }));
}

function mergeAdjacentRects(rects: DOMRect[]): DOMRect[] {
  if (rects.length === 0) return [];
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const merged: DOMRect[] = [];
  let current = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const r = sorted[i];
    const sameRow = Math.abs(r.top - current.top) < 2;
    const adjacent = r.left <= current.right + 1;
    if (sameRow && adjacent) {
      current = new DOMRect(
        current.left,
        current.top,
        Math.max(current.right, r.right) - current.left,
        Math.max(current.height, r.height)
      );
    } else {
      merged.push(current);
      current = r;
    }
  }
  merged.push(current);
  return merged;
}

// ── Text node walker ──────────────────────────────────────────────────────────
interface TextEntry {
  node: Text;
  start: number;
  end: number;
}

function buildTextNodeEntries(container: HTMLElement): TextEntry[] {
  const entries: TextEntry[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const cpLen = [...(node.textContent ?? "")].length;
    entries.push({ node, start: offset, end: offset + cpLen });
    offset += cpLen;
  }
  return entries;
}

function cpToUtf16Offset(str: string, cpOffset: number): number {
  let cp = 0;
  let u16 = 0;
  for (const char of str) {
    if (cp >= cpOffset) break;
    u16 += char.length;
    cp++;
  }
  return u16;
}

// ── SVG path types ────────────────────────────────────────────────────────────

export interface DrawInstruction {
  type: string;
  annotationId: string;
  anchorId: string;
  paths: SVGPath[];
  notePos?: { x: number; y: number };
  noteContent?: string;
}

export interface SVGPath {
  d: string;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  opacity?: number;
  strokeDasharray?: string;
}

// Main dispatcher
export function buildDrawInstruction(
  annotation: Annotation,
  anchorId: string,
  rects: LineRect[],
  annotationIndex: number,
  _anchors: Anchor[]
): DrawInstruction | null {
  if (rects.length === 0) return null;
  const annotationId = `ann-${annotationIndex}`;

  switch (annotation.type) {
    case "underline":
      return buildUnderline(annotation.style ?? "single", anchorId, annotationId, rects);
    case "highlight":
      return buildHighlight(annotation.color, anchorId, annotationId, rects);
    case "bracket":
      return buildBracket(annotation.style, anchorId, annotationId, rects);
    case "box":
      return buildBox(annotation.style ?? "rectangle", anchorId, annotationId, rects);
    case "note":
      if ("target" in annotation) return buildNote((annotation as { content: string; target: string }).content, anchorId, annotationId, rects);
      return null;
    default:
      return null;
  }
}

// ── Underline ─────────────────────────────────────────────────────────────────
const UNDERLINE_GAP = 2;

function buildUnderline(
  style: string,
  anchorId: string,
  annotationId: string,
  rects: LineRect[]
): DrawInstruction {
  const paths: SVGPath[] = rects.map((r) => {
    const y = r.baseline + UNDERLINE_GAP;
    const x1 = r.x;
    const x2 = r.x + r.width;

    switch (style) {
      case "double":
        return {
          d: `M ${x1} ${y} L ${x2} ${y} M ${x1} ${y + 2.5} L ${x2} ${y + 2.5}`,
          stroke: "var(--accent)",
          strokeWidth: 1.2,
          fill: "none",
        };
      case "wave":
        return { d: wavePathD(x1, x2, y), stroke: "var(--accent)", strokeWidth: 1.4, fill: "none" };
      case "dashed":
        return {
          d: `M ${x1} ${y} L ${x2} ${y}`,
          stroke: "var(--accent)",
          strokeWidth: 1.4,
          fill: "none",
          strokeDasharray: "4 3",
        };
      default:
        return { d: `M ${x1} ${y} L ${x2} ${y}`, stroke: "var(--accent)", strokeWidth: 1.4, fill: "none" };
    }
  });
  return { type: "underline", annotationId, anchorId, paths };
}

function wavePathD(x1: number, x2: number, y: number): string {
  const amplitude = 2.2;
  const wavelength = 8;
  const segments: string[] = [`M ${x1.toFixed(1)} ${y.toFixed(1)}`];
  let x = x1;
  let up = true;
  while (x < x2) {
    const segEnd = Math.min(x + wavelength, x2);
    const mid = (x + segEnd) / 2;
    const cy = up ? y - amplitude : y + amplitude;
    segments.push(`Q ${mid.toFixed(1)} ${cy.toFixed(1)} ${segEnd.toFixed(1)} ${y.toFixed(1)}`);
    x = segEnd;
    up = !up;
  }
  return segments.join(" ");
}

// ── Highlight ─────────────────────────────────────────────────────────────────
const HIGHLIGHT_COLOR_MAP: Record<string, string> = {
  yellow: "rgba(250, 210, 80, 0.35)",
  green:  "rgba(100, 200, 130, 0.32)",
  pink:   "rgba(240, 120, 160, 0.30)",
  blue:   "rgba(80, 160, 240, 0.30)",
};

function buildHighlight(
  color: string,
  anchorId: string,
  annotationId: string,
  rects: LineRect[]
): DrawInstruction {
  const fill = HIGHLIGHT_COLOR_MAP[color] ?? HIGHLIGHT_COLOR_MAP.yellow;
  const paths: SVGPath[] = rects.map((r) => ({
    d: `M ${r.x} ${r.y} h ${r.width} v ${r.height} h ${-r.width} Z`,
    fill,
    stroke: "none",
    strokeWidth: 0,
  }));
  return { type: "highlight", annotationId, anchorId, paths };
}

// ── Bracket ───────────────────────────────────────────────────────────────────
const BRACKET_OFFSET = 3;

function buildBracket(
  style: string,
  anchorId: string,
  annotationId: string,
  rects: LineRect[]
): DrawInstruction {
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));

  const x1 = minX - BRACKET_OFFSET;
  const x2 = maxX + BRACKET_OFFSET;
  const y1 = minY;
  const y2 = maxY;
  const arm = 5;
  const cr = 3;

  let d: string;
  switch (style) {
    case "round":
      d = [
        `M ${x1 + arm} ${y1} Q ${x1 - cr} ${y1} ${x1 - cr} ${(y1 + y2) / 2} Q ${x1 - cr} ${y2} ${x1 + arm} ${y2}`,
        `M ${x2 - arm} ${y1} Q ${x2 + cr} ${y1} ${x2 + cr} ${(y1 + y2) / 2} Q ${x2 + cr} ${y2} ${x2 - arm} ${y2}`,
      ].join(" ");
      break;
    case "curly":
      d = buildCurlyPath(x1, x2, y1, y2);
      break;
    case "angle":
      d = [
        `M ${x1 + arm} ${y1} L ${x1 - arm} ${(y1 + y2) / 2} L ${x1 + arm} ${y2}`,
        `M ${x2 - arm} ${y1} L ${x2 + arm} ${(y1 + y2) / 2} L ${x2 - arm} ${y2}`,
      ].join(" ");
      break;
    case "lenticular":
      d = [
        `M ${x1 + arm} ${y1} Q ${x1 - arm * 2} ${(y1 + y2) / 2} ${x1 + arm} ${y2}`,
        `M ${x2 - arm} ${y1} Q ${x2 + arm * 2} ${(y1 + y2) / 2} ${x2 - arm} ${y2}`,
      ].join(" ");
      break;
    default: // square
      d = [
        `M ${x1 + arm} ${y1} L ${x1} ${y1} L ${x1} ${y2} L ${x1 + arm} ${y2}`,
        `M ${x2 - arm} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x2 - arm} ${y2}`,
      ].join(" ");
  }

  return {
    type: "bracket",
    annotationId,
    anchorId,
    paths: [{ d, stroke: "var(--accent)", strokeWidth: 1.6, fill: "none" }],
  };
}

function buildCurlyPath(x1: number, x2: number, y1: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  const arm = 5;
  const tip = 6;
  const lx = x1 - arm;
  const rx = x2 + arm;
  const left = [
    `M ${x1 + arm} ${y1}`,
    `Q ${lx} ${y1} ${lx} ${y1 + (midY - y1) / 2}`,
    `Q ${lx} ${midY - tip} ${lx - 4} ${midY}`,
    `Q ${lx} ${midY + tip} ${lx} ${midY + (y2 - midY) / 2}`,
    `Q ${lx} ${y2} ${x1 + arm} ${y2}`,
  ].join(" ");
  const right = [
    `M ${x2 - arm} ${y1}`,
    `Q ${rx} ${y1} ${rx} ${y1 + (midY - y1) / 2}`,
    `Q ${rx} ${midY - tip} ${rx + 4} ${midY}`,
    `Q ${rx} ${midY + tip} ${rx} ${midY + (y2 - midY) / 2}`,
    `Q ${rx} ${y2} ${x2 - arm} ${y2}`,
  ].join(" ");
  return left + " " + right;
}

// ── Box ───────────────────────────────────────────────────────────────────────
const BOX_PAD = 3;

function buildBox(
  style: string,
  anchorId: string,
  annotationId: string,
  rects: LineRect[]
): DrawInstruction {
  const minX = Math.min(...rects.map((r) => r.x)) - BOX_PAD;
  const maxX = Math.max(...rects.map((r) => r.x + r.width)) + BOX_PAD;
  const minY = Math.min(...rects.map((r) => r.y)) - BOX_PAD;
  const maxY = Math.max(...rects.map((r) => r.y + r.height)) + BOX_PAD;
  const w = maxX - minX;
  const h = maxY - minY;
  const cx = minX + w / 2;
  const cy = minY + h / 2;

  let d: string;
  switch (style) {
    case "oval":
      d = `M ${cx - w / 2} ${cy} A ${w / 2} ${h / 2} 0 1 1 ${cx + w / 2} ${cy} A ${w / 2} ${h / 2} 0 1 1 ${cx - w / 2} ${cy} Z`;
      break;
    case "triangle":
      d = `M ${cx} ${minY} L ${maxX} ${maxY} L ${minX} ${maxY} Z`;
      break;
    default:
      d = `M ${minX} ${minY} h ${w} v ${h} h ${-w} Z`;
  }

  return {
    type: "box",
    annotationId,
    anchorId,
    paths: [{ d, stroke: "var(--accent)", strokeWidth: 1.4, fill: "none" }],
  };
}

// ── Note ──────────────────────────────────────────────────────────────────────
function buildNote(
  content: string,
  anchorId: string,
  annotationId: string,
  rects: LineRect[]
): DrawInstruction {
  const first = rects[0];
  const x = first.x + first.width / 2;
  const y = first.y - 6;

  const paths: SVGPath[] = rects.map((r) => ({
    d: `M ${r.x} ${r.baseline + 2} L ${r.x + r.width} ${r.baseline + 2}`,
    stroke: "var(--accent)",
    strokeWidth: 1,
    fill: "none",
    strokeDasharray: "2 2",
  }));

  return {
    type: "note",
    annotationId,
    anchorId,
    paths,
    notePos: { x, y },
    noteContent: content,
  };
}
