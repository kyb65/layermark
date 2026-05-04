// src/components/OrphanPanel.tsx
// Phase 3: Orphan anchor management sidebar panel.
//
// Design rules (from LAYERMARK_CONTEXT.md §Orphan 처리 4원칙):
//   1. Never auto-delete.
//   2. Never auto-reconnect without confidence.
//   3. Show candidates; let the user decide.
//   4. Non-blocking — editing continues regardless.

import { useEffect, useRef } from "react";
import type { Anchor } from "../types/lmm";

export interface OrphanInfo {
  anchor: Anchor;
  // Candidate positions found near the original position (may be empty).
  candidates: Array<{ text: string; position: number }>;
}

interface Props {
  orphans: OrphanInfo[];
  isOpen: boolean;
  onToggle: () => void;
  // User chose to reconnect an orphan to a specific candidate.
  // candidateText: the new exact value to store (replaces the old exact).
  onReconnect: (anchorId: string, candidatePosition: number, candidateText: string) => void;
  // User chose to delete an orphan permanently.
  onDelete: (anchorId: string) => void;
  // User deferred — keeps orphan in panel, does nothing else.
  // (No-op from the panel's perspective; just closes the item's action row.)
}

export function OrphanPanel({
  orphans,
  isOpen,
  onToggle,
  onReconnect,
  onDelete,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close panel on Escape
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onToggle();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onToggle]);

  const count = orphans.length;

  return (
    <div className={`lm-orphan-panel${isOpen ? " lm-orphan-panel--open" : ""}`} ref={panelRef}>
      {/* Header — always visible, acts as toggle */}
      <button
        className="lm-orphan-header"
        onClick={onToggle}
        aria-expanded={isOpen}
        title={isOpen ? "Orphan 패널 닫기" : "Orphan 패널 열기"}
      >
        <span className="lm-orphan-icon">⚠</span>
        <span className="lm-orphan-title">
          연결 끊긴 마킹
          {count > 0 && <span className="lm-orphan-count">{count}</span>}
        </span>
        <span className="lm-orphan-chevron">{isOpen ? "▲" : "▼"}</span>
      </button>

      {/* Body — only rendered when open */}
      {isOpen && (
        <div className="lm-orphan-body">
          {count === 0 ? (
            <div className="lm-orphan-empty">연결 끊긴 마킹이 없습니다.</div>
          ) : (
            <ul className="lm-orphan-list">
              {orphans.map((o) => (
                <OrphanItem
                  key={o.anchor.id}
                  orphan={o}
                  onReconnect={onReconnect}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── Individual orphan row ────────────────────────────────────────────────────

interface ItemProps {
  orphan: OrphanInfo;
  onReconnect: (anchorId: string, candidatePosition: number, candidateText: string) => void;
  onDelete: (anchorId: string) => void;
}

function OrphanItem({ orphan, onReconnect, onDelete }: ItemProps) {
  const { anchor, candidates } = orphan;
  const displayExact =
    anchor.exact.length > 24
      ? anchor.exact.slice(0, 24) + "…"
      : anchor.exact;

  return (
    <li className="lm-orphan-item">
      {/* Exact text */}
      <div className="lm-orphan-exact" title={anchor.exact}>
        <span className="lm-orphan-exact-label">텍스트</span>
        <span className="lm-orphan-exact-value">"{displayExact}"</span>
      </div>

      {/* Candidates */}
      {candidates.length > 0 ? (
        <div className="lm-orphan-candidates">
          <span className="lm-orphan-candidates-label">후보</span>
          <ul className="lm-orphan-candidates-list">
            {candidates.map((c, i) => (
              <li key={i} className="lm-orphan-candidate">
                <span className="lm-orphan-candidate-text">
                  "{c.text.length > 20 ? c.text.slice(0, 20) + "…" : c.text}"
                </span>
                <button
                  className="lm-btn-small lm-btn-reconnect"
                  onClick={() => onReconnect(anchor.id, c.position, c.text)}
                  title="이 후보로 재연결"
                >
                  연결
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="lm-orphan-no-candidate">
          삭제되었거나 크게 수정된 텍스트입니다.
        </div>
      )}

      {/* Actions */}
      <div className="lm-orphan-actions">
        <button
          className="lm-btn-small lm-btn-delete"
          onClick={() => onDelete(anchor.id)}
          title="마킹 영구 삭제"
        >
          삭제
        </button>
        {/* "나중에" — no action needed; item stays in list */}
        <span className="lm-orphan-defer-hint">나중에 처리 가능</span>
      </div>
    </li>
  );
}
