// src/lib/lmm.ts
// .lmm file serialization and semantic validation
// JSON Schema validation: run validate.js separately (Node-side)
// This module handles runtime parse/serialize and semantic rules A-I

import type { LmmDocument, Anchor, Annotation, NodeId } from "../types/lmm";

const EMPTY_DOC: LmmDocument = {
  layermark: "1.0",
  anchors: [],
  annotations: [],
};

// ── Parse ─────────────────────────────────────────────────────────────────────
// .lmm files are YAML, but YAML is a superset of JSON.
// For Phase 1 we write JSON-compatible YAML (no anchors/aliases).
// We use a tiny YAML subset parser or js-yaml in Phase 2+.
// For now: parse as JSON (valid for machine-written .lmm files).

export function parseLmm(raw: string): LmmDocument {
  if (!raw.trim()) return structuredClone(EMPTY_DOC);
  try {
    // Try JSON first (machine-written files)
    const doc = JSON.parse(raw) as LmmDocument;
    assertVersion(doc);
    return doc;
  } catch {
    // TODO Phase 2: add js-yaml fallback for human-written files
    throw new Error("Failed to parse .lmm: not valid JSON/YAML");
  }
}

export function serializeLmm(doc: LmmDocument): string {
  assertVersion(doc);
  return JSON.stringify(doc, null, 2);
}

function assertVersion(doc: LmmDocument) {
  if (doc.layermark !== "1.0") {
    throw new Error(`Unsupported layermark version: ${doc.layermark}`);
  }
}

// ── Empty document factory ────────────────────────────────────────────────────
export function newLmmDocument(): LmmDocument {
  return structuredClone(EMPTY_DOC);
}

// ── Semantic validation (Rules A-I from CONTEXT §6) ──────────────────────────
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateSemantic(doc: LmmDocument): ValidationResult {
  const errors: string[] = [];
  const allIds = new Set<NodeId>();

  // Rules A, B, C: all IDs globally unique
  for (const anchor of doc.anchors) {
    if (allIds.has(anchor.id)) errors.push(`Rule A/C: duplicate ID "${anchor.id}"`);
    allIds.add(anchor.id);
  }
  for (const ann of doc.annotations) {
    const ann_ = ann as unknown as Record<string, unknown>;
    if (typeof ann_["id"] === "string") {
      if (allIds.has(ann_["id"] as NodeId))
        errors.push(`Rule B/C: duplicate ID "${ann_["id"]}"`);
      allIds.add(ann_["id"] as NodeId);
    }
  }

  // Build sets for rule D
  const anchorIds = new Set(doc.anchors.map((a) => a.id));
  const noteIdsWithId = new Set<NodeId>();
  for (const ann of doc.annotations) {
    if (ann.type === "note" && "id" in ann && ann.id) noteIdsWithId.add(ann.id);
  }

  for (const ann of doc.annotations) {
    // Rule D: target/from/to/connection must reference existing IDs
    if ("target" in ann && !anchorIds.has(ann.target)) {
      errors.push(`Rule D: target "${ann.target}" not found`);
    }
    if (ann.type === "connection") {
      if (!anchorIds.has(ann.from) && !noteIdsWithId.has(ann.from))
        errors.push(`Rule D/I: connection.from "${ann.from}" not found`);
      if (!anchorIds.has(ann.to) && !noteIdsWithId.has(ann.to))
        errors.push(`Rule D/I: connection.to "${ann.to}" not found`);
      // Rule E: from != to
      if (ann.from === ann.to)
        errors.push(`Rule E: connection.from === connection.to ("${ann.from}")`);
    }
    if (ann.type === "note" && "connection" in ann) {
      const connIds = new Set(
        doc.annotations.filter((a) => a.type === "connection" && "id" in a).map((a) => (a as { id: NodeId }).id)
      );
      if (!connIds.has(ann.connection))
        errors.push(`Rule D: note.connection "${ann.connection}" not found`);
    }

    // Rule G: highlight requires color (schema enforces, belt-and-suspenders)
    if (ann.type === "highlight" && !ann.color)
      errors.push(`Rule G: highlight missing color`);

    // Rule H: bracket requires style
    if (ann.type === "bracket" && !ann.style)
      errors.push(`Rule H: bracket missing style`);
  }

  return { valid: errors.length === 0, errors };
}

// ── Mutation helpers ──────────────────────────────────────────────────────────
// Always return a new document (immutable update pattern)

export function addAnchor(doc: LmmDocument, anchor: Anchor): LmmDocument {
  return { ...doc, anchors: [...doc.anchors, anchor] };
}

export function removeAnchor(doc: LmmDocument, anchorId: NodeId): LmmDocument {
  return {
    ...doc,
    anchors: doc.anchors.filter((a) => a.id !== anchorId),
    // Remove annotations that reference this anchor
    annotations: doc.annotations.filter((ann) => {
      if ("target" in ann && ann.target === anchorId) return false;
      if (ann.type === "connection" && (ann.from === anchorId || ann.to === anchorId))
        return false;
      return true;
    }),
  };
}

export function addAnnotation(doc: LmmDocument, annotation: Annotation): LmmDocument {
  return { ...doc, annotations: [...doc.annotations, annotation] };
}

export function updateAnchorPosition(
  doc: LmmDocument,
  anchorId: NodeId,
  newPosition: number
): LmmDocument {
  return {
    ...doc,
    anchors: doc.anchors.map((a) =>
      a.id === anchorId ? { ...a, position: newPosition } : a
    ),
  };
}

// Reconnect an orphaned anchor to a new text span.
// Updates both position and exact so resolveAnchor can find it again.
// Called when the user picks a candidate in the OrphanPanel.
export function updateAnchorOnReconnect(
  doc: LmmDocument,
  anchorId: NodeId,
  newPosition: number,
  newExact: string
): LmmDocument {
  return {
    ...doc,
    anchors: doc.anchors.map((a) =>
      a.id === anchorId ? { ...a, position: newPosition, exact: newExact } : a
    ),
  };
}
