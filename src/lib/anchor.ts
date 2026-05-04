// src/lib/anchor.ts
// Anchor utilities: ID generation, TextQuoteSelector search, confidence scoring
// Spec reference: LAYERMARK_CONTEXT.md §3 Anchor

import { invoke } from "@tauri-apps/api/core";
import type { Anchor, AnchorMatch, ConfidenceLevel, OrphanAnchor } from "../types/lmm";

// ── ID generation ─────────────────────────────────────────────────────────────
// Delegates to Rust CSPRNG (crypto.getRandomValues fallback for tests)

export async function generateAnchorId(existingIds: string[]): Promise<string> {
  return invoke<string>("generate_anchor_id", { existingIds });
}

// Collect all IDs from a document (anchors + annotation ids)
export function collectAllIds(
  anchors: Anchor[],
  annotations: Array<{ id?: string }>
): string[] {
  return [
    ...anchors.map((a) => a.id),
    ...annotations.flatMap((ann) => (ann.id ? [ann.id] : [])),
  ];
}

// ── Code point utilities ──────────────────────────────────────────────────────
// spec: position = Unicode code point offset, NOT .length (UTF-16 units)
// [...str] converts to array of code points (handles astral plane correctly)

export function cpLength(str: string): number {
  return [...str].length;
}

export function cpSlice(str: string, start: number, end?: number): string {
  return [...str].slice(start, end).join("");
}

export function cpIndexOf(haystack: string, needle: string, fromIndex = 0): number {
  const chars = [...haystack];
  const needleChars = [...needle];
  const needleLen = needleChars.length;
  for (let i = fromIndex; i <= chars.length - needleLen; i++) {
    if (chars.slice(i, i + needleLen).join("") === needle) return i;
  }
  return -1;
}

// ── Anchor creation ───────────────────────────────────────────────────────────
// Called when user finishes a drag-select.
// plainText: full plain text of content.lm (from Rust plain_text_from_markdown)
// selStart/selEnd: code point offsets of the selection

export async function createAnchor(
  plainText: string,
  selStart: number,
  selEnd: number,
  existingIds: string[]
): Promise<Anchor> {
  const exact = cpSlice(plainText, selStart, selEnd);
  if (exact.length === 0) throw new Error("Empty selection");

  const id = await generateAnchorId(existingIds);
  const { prefix, suffix } = buildContext(plainText, selStart, selEnd, exact);
  return { id, exact, prefix, suffix, position: selStart };
}

// Builds prefix/suffix, extending to 64 cp if needed for disambiguation
function buildContext(
  plainText: string,
  selStart: number,
  selEnd: number,
  exact: string
): { prefix: string; suffix: string } {
  for (const len of [32, 64]) {
    const prefix = cpSlice(plainText, Math.max(0, selStart - len), selStart);
    const suffix = cpSlice(plainText, selEnd, selEnd + len);

    // Check if this prefix+suffix uniquely identifies the exact
    const occurrences = findAllOccurrences(plainText, exact);
    if (occurrences.length <= 1) return { prefix, suffix };

    // Multiple occurrences: check if this prefix/suffix is unique
    const isUnique = occurrences.every((pos) => {
      if (pos === selStart) return true; // the intended one
      const otherPrefix = cpSlice(plainText, Math.max(0, pos - len), pos);
      const otherSuffix = cpSlice(plainText, pos + cpLength(exact), pos + cpLength(exact) + len);
      return otherPrefix !== prefix || otherSuffix !== suffix;
    });
    if (isUnique || len === 64) return { prefix, suffix };
  }
  // Unreachable but TypeScript needs it
  return { prefix: "", suffix: "" };
}

function findAllOccurrences(text: string, needle: string): number[] {
  const positions: number[] = [];
  let pos = 0;
  while (true) {
    const found = cpIndexOf(text, needle, pos);
    if (found === -1) break;
    positions.push(found);
    pos = found + 1;
  }
  return positions;
}

// ── TextQuoteSelector search (W3C compatible) ─────────────────────────────────
// Returns best match for an anchor in updated plainText.
// Priority: exact+prefix+suffix → exact+position → orphan

export function resolveAnchor(
  anchor: Anchor,
  plainText: string
): AnchorMatch | OrphanAnchor {
  const occurrences = findAllOccurrences(plainText, anchor.exact);

  if (occurrences.length === 0) {
    // exact text is gone — orphan
    return { anchor, candidates: [] };
  }

  // Score each occurrence by prefix/suffix similarity
  const scored = occurrences.map((pos) => {
    const prefixLen = cpLength(anchor.prefix);
    const suffixLen = cpLength(anchor.suffix);
    const actualPrefix = cpSlice(plainText, Math.max(0, pos - prefixLen), pos);
    const actualSuffix = cpSlice(
      plainText,
      pos + cpLength(anchor.exact),
      pos + cpLength(anchor.exact) + suffixLen
    );
    const prefixScore = anchor.prefix === "" ? 1 : similarity(actualPrefix, anchor.prefix);
    const suffixScore = anchor.suffix === "" ? 1 : similarity(actualSuffix, anchor.suffix);
    const contextScore = (prefixScore + suffixScore) / 2;
    const posDistance = Math.abs(pos - anchor.position);
    return { pos, contextScore, posDistance };
  });

  // Sort: highest context score, then closest position
  scored.sort((a, b) =>
    b.contextScore !== a.contextScore
      ? b.contextScore - a.contextScore
      : a.posDistance - b.posDistance
  );

  const best = scored[0];
  const confidence = scoreToConfidence(best.contextScore, best.pos === anchor.position);

  return {
    anchor,
    confidence,
    candidatePosition: best.pos,
  };
}

function scoreToConfidence(contextScore: number, positionMatches: boolean): ConfidenceLevel {
  if (contextScore >= 0.9) return "high";
  if (contextScore >= 0.6 || positionMatches) return "medium";
  return "low";
}

// Normalised Levenshtein similarity: 0 (completely different) to 1 (identical)
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const maxLen = Math.max(cpLength(a), cpLength(b));
  return 1 - levenshtein(a, b) / maxLen;
}

function levenshtein(a: string, b: string): number {
  const aChars = [...a];
  const bChars = [...b];
  const m = aChars.length;
  const n = bChars.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        aChars[i - 1] === bChars[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
