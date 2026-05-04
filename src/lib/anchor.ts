// src/lib/anchor.ts
// Anchor utilities: ID generation, TextQuoteSelector search, confidence scoring
// Spec reference: LAYERMARK_CONTEXT.md §3 Anchor
//
// Design note (Korean particle edge case):
//   When exact is a single Korean particle (은/는/이/가/을/를 etc.),
//   prefix/suffix alone may collide across multiple occurrences.
//   resolveAnchor handles this via the scored-candidates approach:
//   all occurrences are scored, the best wins. Position is used as a
//   tiebreaker. If contextScore < 0.6 for all candidates, they are
//   reported as Orphan candidates for user review rather than
//   auto-reconnecting.

import { invoke } from "@tauri-apps/api/core";
import type { Anchor, AnchorMatch, ConfidenceLevel, OrphanAnchor } from "../types/lmm";

// ── ID generation ─────────────────────────────────────────────────────────────

export async function generateAnchorId(existingIds: string[]): Promise<string> {
  return invoke<string>("generate_anchor_id", { existingIds });
}

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

function buildContext(
  plainText: string,
  selStart: number,
  selEnd: number,
  exact: string
): { prefix: string; suffix: string } {
  for (const len of [32, 64]) {
    const prefix = cpSlice(plainText, Math.max(0, selStart - len), selStart);
    const suffix = cpSlice(plainText, selEnd, selEnd + len);

    const occurrences = findAllOccurrences(plainText, exact);
    if (occurrences.length <= 1) return { prefix, suffix };

    const isUnique = occurrences.every((pos) => {
      if (pos === selStart) return true;
      const otherPrefix = cpSlice(plainText, Math.max(0, pos - len), pos);
      const otherSuffix = cpSlice(plainText, pos + cpLength(exact), pos + cpLength(exact) + len);
      return otherPrefix !== prefix || otherSuffix !== suffix;
    });
    if (isUnique || len === 64) return { prefix, suffix };
  }
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
// Returns AnchorMatch (found with confidence) or OrphanAnchor (lost).
//
// When exact is gone: search for similar-length tokens near position as candidates.
// When exact exists but context is poor: return as Orphan with candidate positions.

export function resolveAnchor(
  anchor: Anchor,
  plainText: string
): AnchorMatch | OrphanAnchor {
  const occurrences = findAllOccurrences(plainText, anchor.exact);

  if (occurrences.length === 0) {
    // exact text is gone — search near original position for candidates
    const candidates = findNearbyCandidates(anchor, plainText);
    return { anchor, candidates };
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

  scored.sort((a, b) =>
    b.contextScore !== a.contextScore
      ? b.contextScore - a.contextScore
      : a.posDistance - b.posDistance
  );

  const best = scored[0];
  const confidence = scoreToConfidence(best.contextScore, best.pos === anchor.position);

  if (confidence === "low") {
    // All matches are poor — surface as orphan with candidates
    const candidates = scored.map((s) => ({
      text: cpSlice(plainText, s.pos, s.pos + cpLength(anchor.exact)),
      position: s.pos,
    }));
    return { anchor, candidates };
  }

  return {
    anchor,
    confidence,
    candidatePosition: best.pos,
  };
}

// Find candidate replacement texts near the anchor's original position.
// Looks for word-like tokens (sequences of non-whitespace chars) within
// a ±200 code point window of the original position.
function findNearbyCandidates(
  anchor: Anchor,
  plainText: string
): Array<{ text: string; position: number }> {
  const exactLen = cpLength(anchor.exact);
  const window = 200;
  const start = Math.max(0, anchor.position - window);
  const end = Math.min(cpLength(plainText), anchor.position + window);
  const region = cpSlice(plainText, start, end);

  // Tokenize region into word-like segments of similar length (±2 code points)
  const candidates: Array<{ text: string; position: number }> = [];
  const tokenRe = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(region)) !== null) {
    const tokenCp = [...m[0]];
    const lenDiff = Math.abs(tokenCp.length - exactLen);
    if (lenDiff <= 2) {
      candidates.push({
        text: m[0],
        position: start + [...region.slice(0, m.index)].length,
      });
    }
  }

  // Sort by distance to original position, take top 3
  candidates.sort((a, b) =>
    Math.abs(a.position - anchor.position) - Math.abs(b.position - anchor.position)
  );
  return candidates.slice(0, 3);
}

function scoreToConfidence(contextScore: number, positionMatches: boolean): ConfidenceLevel {
  if (contextScore >= 0.9) return "high";
  if (contextScore >= 0.6 || positionMatches) return "medium";
  return "low";
}

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
