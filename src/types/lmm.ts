// src/types/lmm.ts
// TypeScript types derived from lmm.schema.json (v1.0)
// Single source of truth: lmm.schema.json
// These types mirror the schema exactly — do not add fields not in the schema.

// ── NodeId ────────────────────────────────────────────────────────────────────
// Exactly 8 lowercase alphanumeric characters: ^[a-z0-9]{8}$
export type NodeId = string;

// ── Anchor ────────────────────────────────────────────────────────────────────
export interface Anchor {
  id: NodeId;
  exact: string;       // selected text, minLength: 1
  prefix: string;      // up to 64 code points before exact
  suffix: string;      // up to 64 code points after exact
  position: number;    // Unicode code point offset — fallback only
}

// ── Annotation types ──────────────────────────────────────────────────────────

export interface Underline {
  type: "underline";
  target: NodeId;      // anchor ID only
  style?: "single" | "double" | "wave" | "dashed"; // default: "single"
}

export interface Highlight {
  type: "highlight";
  target: NodeId;
  color: "yellow" | "green" | "pink" | "blue";   // required
  style?: "fill" | "check" | "underline";          // default: "fill"
}

export interface Box {
  type: "box";
  target: NodeId;
  style?: "rectangle" | "oval" | "triangle";      // default: "rectangle"
}

export interface Bracket {
  type: "bracket";
  target: NodeId;
  style:  // required — no default
    | "round"
    | "square"
    | "curly"
    | "angle"
    | "lenticular"
    | "corner"
    | "double-corner";
}

export interface Connection {
  id?: NodeId;         // required only if a NoteOnConnection references it
  type: "connection";
  from: NodeId;        // anchor or id-having note
  to: NodeId;
  style?: "solid" | "dashed";            // default: "solid"
  arrow?: "none" | "one-way" | "two-way"; // default: "none"
}

export interface NoteOnAnchor {
  id?: NodeId;
  type: "note";
  content: string;     // minLength: 1
  target: NodeId;      // anchor ID
  floating?: boolean;  // default: false
}

export interface NoteOnConnection {
  id?: NodeId;
  type: "note";
  content: string;
  connection: NodeId;  // connection ID (Connection.id must be set)
}

export type Note = NoteOnAnchor | NoteOnConnection;

export type Annotation =
  | Underline
  | Highlight
  | Box
  | Bracket
  | Connection
  | Note;

// ── Root document ─────────────────────────────────────────────────────────────
export interface LmmDocument {
  layermark: "1.0";
  anchors: Anchor[];
  annotations: Annotation[];
}

// ── Confidence (reconciliation, not stored in .lmm) ──────────────────────────
export type ConfidenceLevel = "high" | "medium" | "low";

export interface AnchorMatch {
  anchor: Anchor;
  confidence: ConfidenceLevel;
  candidatePosition?: number; // resolved position in current content
}

export interface OrphanAnchor {
  anchor: Anchor;
  candidates: Array<{ text: string; position: number }>;
}
