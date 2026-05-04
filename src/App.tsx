// src/App.tsx — Phase 3: Orphan panel + file watcher + duplicate annotation guard
import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { createAnchor, collectAllIds, resolveAnchor } from "./lib/anchor";
import {
  parseLmm,
  serializeLmm,
  newLmmDocument,
  addAnchor,
  addAnnotation,
  removeAnchor,
  updateAnchorPosition,
  updateAnchorOnReconnect,
} from "./lib/lmm-document";
import { SvgOverlay } from "./components/SvgOverlay";
import { AnnotationMenu } from "./components/AnnotationMenu";
import { OrphanPanel } from "./components/OrphanPanel";
import type { OrphanInfo } from "./components/OrphanPanel";
import type { LmmDocument, AnchorMatch, OrphanAnchor, Annotation } from "./types/lmm";
import type { ResolvedAnchor, MenuState } from "./types/overlay";
import "./App.css";

interface NotePair {
  folder: string;
  content: string;
  memo: string | null;
}

// ── Plain text helpers ────────────────────────────────────────────────────────

interface TextNodeEntry {
  node: Text;
  start: number;
  end: number;
}

function buildTextNodeEntries(container: HTMLElement): TextNodeEntry[] {
  const entries: TextNodeEntry[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const chars = [...(node.textContent ?? "")];
    entries.push({ node, start: offset, end: offset + chars.length });
    offset += chars.length;
  }
  return entries;
}

function domRangeToPlainOffset(
  entries: TextNodeEntry[],
  container: Node,
  offset: number
): number {
  const entry = entries.find((e) => e.node === container);
  if (!entry) return -1;
  const cpOffset = [...(entry.node.textContent!.slice(0, offset))].length;
  return entry.start + cpOffset;
}

function extractDomPlainText(container: HTMLElement): string {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let text = "";
  while (walker.nextNode()) {
    text += walker.currentNode.textContent ?? "";
  }
  return text;
}

// ── Duplicate annotation guard ────────────────────────────────────────────────
// Prevents stacking identical annotation types on the same anchor.
// Connection annotations are always allowed (each represents a distinct link).

function isDuplicateAnnotation(doc: LmmDocument, annotation: Annotation): boolean {
  if (annotation.type === "connection") return false;

  return doc.annotations.some((existing) => {
    // Must be same type and same target anchor
    if (existing.type !== annotation.type) return false;
    if (!("target" in existing) || !("target" in annotation)) return false;
    if (existing.target !== annotation.target) return false;

    // Type-specific identity check
    switch (annotation.type) {
      case "highlight":
        return (existing as typeof annotation).color === annotation.color;
      case "underline":
        // style defaults to "single" when omitted
        return (
          ((existing as typeof annotation).style ?? "single") ===
          (annotation.style ?? "single")
        );
      case "bracket":
        return (existing as typeof annotation).style === annotation.style;
      case "box":
        return (
          ((existing as typeof annotation).style ?? "rectangle") ===
          (annotation.style ?? "rectangle")
        );
      case "note":
        // Only one note per anchor (floating or not — same slot)
        return true;
      default:
        return true;
    }
  });
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [lmmDoc, setLmmDoc] = useState<LmmDocument>(newLmmDocument());
  const [resolvedAnchors, setResolvedAnchors] = useState<ResolvedAnchor[]>([]);
  const [orphans, setOrphans] = useState<OrphanInfo[]>([]);
  const [orphanPanelOpen, setOrphanPanelOpen] = useState(false);
  const [status, setStatus] = useState<string>("노트 폴더를 열어 시작하세요");
  const [menu, setMenu] = useState<MenuState | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const domPlainRef = useRef<string>("");
  // Keep folderPath in a ref so event listeners always see the latest value
  const folderPathRef = useRef<string | null>(null);
  const lmmDocRef = useRef<LmmDocument>(newLmmDocument());

  useEffect(() => { folderPathRef.current = folderPath; }, [folderPath]);
  useEffect(() => { lmmDocRef.current = lmmDoc; }, [lmmDoc]);

  // ── File watcher setup ──────────────────────────────────────────────────────

  useEffect(() => {
    // Listen for "content-changed" event from Rust watcher
    const unlisten = listen<string>("content-changed", async (event) => {
      const changedFolder = event.payload;
      // Only react if this is the currently open folder
      if (changedFolder !== folderPathRef.current) return;

      try {
        const pair = await invoke<NotePair>("read_note_pair", { folder: changedFolder });
        const html = await invoke<string>("render_markdown", { markdown: pair.content });

        setHtmlContent(html);
        setStatus("외부 편집기 변경 감지 — 앵커 재검증 중…");
        // reconcile is triggered by htmlContent useEffect below
      } catch (e) {
        setStatus(`외부 변경 읽기 실패: ${e}`);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // ── Folder open ─────────────────────────────────────────────────────────────

  async function openFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;

    try {
      // Stop watching previous folder
      if (folderPathRef.current) {
        await invoke("unwatch_note_folder").catch(() => {});
      }

      const pair = await invoke<NotePair>("read_note_pair", { folder: selected });
      const html = await invoke<string>("render_markdown", { markdown: pair.content });
      const doc = pair.memo ? parseLmm(pair.memo) : newLmmDocument();

      setFolderPath(selected);
      setHtmlContent(html);
      setLmmDoc(doc);
      setStatus(`${selected.split(/[\\/]/).pop()} 열림`);

      // Start watching new folder
      await invoke("watch_note_folder", { folder: selected }).catch((e) => {
        console.warn("File watcher failed:", e);
      });
    } catch (e) {
      setStatus(`오류: ${e}`);
    }
  }

  // ── Reconciliation ──────────────────────────────────────────────────────────

  const reconcile = useCallback((doc: LmmDocument, plain: string) => {
    const resolved: ResolvedAnchor[] = [];
    const newOrphans: OrphanInfo[] = [];
    let updatedDoc = doc;

    for (const anchor of doc.anchors) {
      const result = resolveAnchor(anchor, plain);

      if ("candidatePosition" in result) {
        // AnchorMatch
        const match = result as AnchorMatch;
        const pos = match.candidatePosition!;
        resolved.push({
          id: anchor.id,
          position: pos,
          length: [...anchor.exact].length,
          confidence: match.confidence,
        });
        if (pos !== anchor.position) {
          updatedDoc = updateAnchorPosition(updatedDoc, anchor.id, pos);
        }
      } else {
        // OrphanAnchor — collect candidates near original position
        const orphan = result as OrphanAnchor;
        newOrphans.push({
          anchor,
          candidates: orphan.candidates,
        });
      }
    }

    setResolvedAnchors(resolved);
    setOrphans(newOrphans);

    // Auto-open orphan panel if new orphans appeared
    if (newOrphans.length > 0) {
      setOrphanPanelOpen(true);
    }

    if (updatedDoc !== doc) {
      setLmmDoc(updatedDoc);
    }
  }, []);

  // Reconcile on content load (covers both open and external edit)
  useEffect(() => {
    if (!contentRef.current || !htmlContent) return;
    const plain = extractDomPlainText(contentRef.current);
    domPlainRef.current = plain;
    reconcile(lmmDoc, plain);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlContent]);

  // Re-reconcile on lmmDoc change (e.g. after annotation added)
  useEffect(() => {
    if (domPlainRef.current) {
      reconcile(lmmDoc, domPlainRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lmmDoc]);

  // ── Selection → Anchor ──────────────────────────────────────────────────────

  async function handleMouseUp() {
    if (!folderPath || !contentRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString();
    if (!selectedText.trim()) return;

    const entries = buildTextNodeEntries(contentRef.current);
    const range = selection.getRangeAt(0);

    const selStart = domRangeToPlainOffset(
      entries, range.startContainer as Text, range.startOffset
    );
    const selEnd = domRangeToPlainOffset(
      entries, range.endContainer as Text, range.endOffset
    );

    if (selStart === -1 || selEnd === -1 || selStart >= selEnd) return;

    const selectionRect = range.getBoundingClientRect();
    const wrapEl = contentRef.current.parentElement!;
    const wrapRect = wrapEl.getBoundingClientRect();
    const menuX = selectionRect.right - wrapRect.left;
    const menuY = selectionRect.bottom - wrapRect.top + 6;

    const domPlain = domPlainRef.current;
    const existingIds = collectAllIds(
      lmmDoc.anchors,
      lmmDoc.annotations as Array<{ id?: string }>
    );

    try {
      const anchor = await createAnchor(domPlain, selStart, selEnd, existingIds);
      const newDoc = addAnchor(lmmDoc, anchor);
      const content = await getCurrentContent();
      await invoke("write_note_pair", {
        folder: folderPath,
        content,
        memo: serializeLmm(newDoc),
      });
      setLmmDoc(newDoc);
      reconcile(newDoc, domPlain);
      setStatus(`앵커 생성: "${selectedText.slice(0, 20)}${selectedText.length > 20 ? "…" : ""}"`);
      selection.removeAllRanges();
      setMenu({ anchorId: anchor.id, x: menuX, y: menuY });
    } catch (e) {
      setStatus(`앵커 생성 실패: ${e}`);
    }
  }

  async function getCurrentContent(): Promise<string> {
    if (!folderPath) return "";
    const pair = await invoke<NotePair>("read_note_pair", { folder: folderPath });
    return pair.content;
  }

  // ── Annotation management ───────────────────────────────────────────────────

  async function handleAddAnnotation(annotation: Annotation) {
    if (!folderPath) return;

    // Duplicate guard
    if (isDuplicateAnnotation(lmmDoc, annotation)) {
      // Special case: note duplicate → open existing note for editing
      if (annotation.type === "note" && "target" in annotation) {
        const existingNote = lmmDoc.annotations.find(
          (a) => a.type === "note" && "target" in a && a.target === annotation.target
        );
        if (existingNote && "content" in existingNote) {
          // Re-open the annotation menu in note-edit mode with the existing content
          setMenu((prev) =>
            prev ? { ...prev, editNoteContent: existingNote.content as string } : prev
          );
          setStatus("기존 메모를 편집합니다");
          return;
        }
      }
      setStatus("이미 동일한 주석이 있습니다");
      return;
    }

    const newDoc = addAnnotation(lmmDoc, annotation);
    const content = await getCurrentContent();
    await invoke("write_note_pair", {
      folder: folderPath,
      content,
      memo: serializeLmm(newDoc),
    });
    setLmmDoc(newDoc);
    setStatus(`주석 추가: ${annotation.type}`);
  }

  async function handleUpdateNote(anchorId: string, newContent: string) {
    if (!folderPath) return;
    const newDoc = {
      ...lmmDoc,
      annotations: lmmDoc.annotations.map((a) =>
        a.type === "note" && "target" in a && a.target === anchorId
          ? { ...a, content: newContent }
          : a
      ),
    };
    const content = await getCurrentContent();
    await invoke("write_note_pair", {
      folder: folderPath,
      content,
      memo: serializeLmm(newDoc),
    });
    setLmmDoc(newDoc);
    setStatus("메모 업데이트 완료");
  }

  async function handleRemoveAnchor(anchorId: string) {
    if (!folderPath) return;
    const newDoc = removeAnchor(lmmDoc, anchorId);
    const content = await getCurrentContent();
    await invoke("write_note_pair", {
      folder: folderPath,
      content,
      memo: serializeLmm(newDoc),
    });
    setLmmDoc(newDoc);
    reconcile(newDoc, domPlainRef.current);
    setStatus("앵커 삭제됨");
  }

  // ── Orphan management ───────────────────────────────────────────────────────

  async function handleOrphanReconnect(
    anchorId: string,
    candidatePosition: number,
    candidateText: string
  ) {
    if (!folderPath) return;

    // Update both position AND exact so resolveAnchor can find the anchor again.
    // Updating position only caused an infinite Orphan loop: resolveAnchor searches
    // by exact first, and if exact is gone the anchor stays orphaned regardless of position.
    const updatedDoc = updateAnchorOnReconnect(lmmDoc, anchorId, candidatePosition, candidateText);
    const content = await getCurrentContent();
    await invoke("write_note_pair", {
      folder: folderPath,
      content,
      memo: serializeLmm(updatedDoc),
    });
    setLmmDoc(updatedDoc);
    // reconcile runs via lmmDoc useEffect → orphan should resolve to high/medium
    setStatus(`Orphan 앵커 재연결: "${candidateText.slice(0, 20)}"`);
  }

  async function handleOrphanDelete(anchorId: string) {
    if (!folderPath) return;
    await handleRemoveAnchor(anchorId);
    setOrphans((prev) => prev.filter((o) => o.anchor.id !== anchorId));
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="lm-app">
      <div className="lm-toolbar">
        <button className="lm-btn-primary" onClick={openFolder}>
          폴더 열기
        </button>
        {folderPath && (
          <span className="lm-folder-name">
            {folderPath.split(/[\\/]/).pop()}
          </span>
        )}
        <span className="lm-status">{status}</span>
        <div className="lm-spacer" />
        <div className="lm-anchor-count">
          앵커 {lmmDoc.anchors.length}  주석 {lmmDoc.annotations.length}
        </div>
      </div>

      <div className="lm-body">
        <div className="lm-content-area">
          {!folderPath ? (
            <div className="lm-empty">
              <p>노트 폴더를 열어 시작하세요</p>
              <p className="lm-empty-sub">폴더 안에 content.lm 파일이 있어야 합니다</p>
              <button className="lm-btn-primary lm-btn-lg" onClick={openFolder}>
                폴더 열기
              </button>
            </div>
          ) : (
            <div className="lm-overlay-wrap">
              {/* Shared SVG defs */}
              <svg width="0" height="0" style={{ position: "absolute", overflow: "hidden" }}>
                <defs>
                  <filter id="lm-blur" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2" />
                  </filter>
                </defs>
              </svg>

              <div
                ref={contentRef}
                className="lm-markdown-body"
                onMouseUp={handleMouseUp}
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />

              <div className="lm-svg-wrap">
                <SvgOverlay
                  contentRef={contentRef}
                  lmmDoc={lmmDoc}
                  resolvedAnchors={resolvedAnchors}
                  onAnchorRightClick={(m) => setMenu(m)}
                />
              </div>

              {menu && (
                <AnnotationMenu
                  menu={menu}
                  onClose={() => setMenu(null)}
                  onAdd={handleAddAnnotation}
                  onRemoveAnchor={handleRemoveAnchor}
                  onUpdateNote={handleUpdateNote}
                />
              )}
            </div>
          )}
        </div>

        {/* Orphan panel — docked to the right, always rendered when folder is open */}
        {folderPath && (
          <OrphanPanel
            orphans={orphans}
            isOpen={orphanPanelOpen}
            onToggle={() => setOrphanPanelOpen((v) => !v)}
            onReconnect={handleOrphanReconnect}
            onDelete={handleOrphanDelete}
          />
        )}
      </div>
    </div>
  );
}
