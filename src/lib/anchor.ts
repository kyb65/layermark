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
//
// Strategy: sliding-window similarity search rather than token matching.
// This handles phrase-level anchors (e.g. "타입스크립트는 정적 타입을 추가한다")
// that grow or shrink due to insertions/deletions.
//
// Steps:
//   1. Extract a ±300cp region around the original position.
//   2. Try every substring whose length is within ±30% of exact's length.
//      (±2cp token approach missed phrases that grew by insertion.)
//   3. Score each by prefix+suffix context similarity (same as resolveAnchor).
//   4. Return top 3 by score, deduplicated.
function findNearbyCandidates(
  anchor: Anchor,
  plainText: string
): Array<{ text: string; position: number }> {
  const exactLen = cpLength(anchor.exact);
  const searchWindow = 300;
  const regionStart = Math.max(0, anchor.position - searchWindow);
  const regionEnd = Math.min(cpLength(plainText), anchor.position + exactLen + searchWindow);
  const plainChars = [...plainText];

  // Length range: allow ±30% or ±3cp, whichever is larger
  const minLen = Math.max(1, exactLen - Math.max(3, Math.floor(exactLen * 0.3)));
  const maxLen = exactLen + Math.max(3, Math.floor(exactLen * 0.3));

  const prefixLen = cpLength(anchor.prefix);
  const suffixLen = cpLength(anchor.suffix);

  const scored: Array<{ text: string; position: number; score: number }> = [];

  for (let pos = regionStart; pos < regionEnd; pos++) {
    for (let len = minLen; len <= maxLen && pos + len <= plainChars.length; len++) {
      const candidate = plainChars.slice(pos, pos + len).join("");

      // Quick character-set overlap check to prune obviously wrong candidates
      // (avoids scoring every single substring when exact is long)
      if (exactLen > 4) {
        const candidateSet = new Set([...candidate]);
        const exactSet = new Set([...anchor.exact]);
        let overlap = 0;
        for (const ch of candidateSet) if (exactSet.has(ch)) overlap++;
        const overlapRatio = overlap / Math.max(candidateSet.size, exactSet.size);
        if (overlapRatio < 0.3) continue;
      }

      // Score by prefix/suffix context (same logic as resolveAnchor)
      const actualPrefix = plainChars.slice(Math.max(0, pos - prefixLen), pos).join("");
      const actualSuffix = plainChars.slice(pos + len, pos + len + suffixLen).join("");
      const prefixScore = anchor.prefix === "" ? 1 : similarity(actualPrefix, anchor.prefix);
      const suffixScore = anchor.suffix === "" ? 1 : similarity(actualSuffix, anchor.suffix);
      const score = (prefixScore + suffixScore) / 2;

      if (score > 0.4) {
        scored.push({ text: candidate, position: pos, score });
      }
    }
  }

  // Deduplicate by position (keep best score per position)
  const byPos = new Map<number, { text: string; position: number; score: number }>();
  for (const c of scored) {
    const existing = byPos.get(c.position);
    if (!existing || c.score > existing.score) byPos.set(c.position, c);
  }

  return [...byPos.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ text, position }) => ({ text, position }));
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
