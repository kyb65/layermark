// src/App.tsx — Phase 2: SVG overlay rendering
import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
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
} from "./lib/lmm-document";
import { SvgOverlay } from "./components/SvgOverlay";
import { AnnotationMenu } from "./components/AnnotationMenu";
import type { LmmDocument, AnchorMatch, Annotation } from "./types/lmm";
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

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [lmmDoc, setLmmDoc] = useState<LmmDocument>(newLmmDocument());
  const [resolvedAnchors, setResolvedAnchors] = useState<ResolvedAnchor[]>([]);
  const [status, setStatus] = useState<string>("노트 폴더를 열어 시작하세요");
  const [orphanCount, setOrphanCount] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const domPlainRef = useRef<string>("");

  async function openFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;

    try {
      const pair = await invoke<NotePair>("read_note_pair", { folder: selected });
      const html = await invoke<string>("render_markdown", { markdown: pair.content });
      const doc = pair.memo ? parseLmm(pair.memo) : newLmmDocument();

      setFolderPath(selected);
      setHtmlContent(html);
      setLmmDoc(doc);
      setStatus(`${selected.split(/[\\/]/).pop()} 열림`);
    } catch (e) {
      setStatus(`오류: ${e}`);
    }
  }

  useEffect(() => {
    if (!contentRef.current || !htmlContent) return;
    const plain = extractDomPlainText(contentRef.current);
    domPlainRef.current = plain;
    reconcile(lmmDoc, plain);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlContent]);

  const reconcile = useCallback((doc: LmmDocument, plain: string) => {
    const resolved: ResolvedAnchor[] = [];
    let orphans = 0;
    let updatedDoc = doc;

    for (const anchor of doc.anchors) {
      const result = resolveAnchor(anchor, plain);
      if ("candidatePosition" in result) {
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
        orphans++;
      }
    }

    setResolvedAnchors(resolved);
    setOrphanCount(orphans);
    if (updatedDoc !== doc) setLmmDoc(updatedDoc);
  }, []);

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
    } catch (e) {
      setStatus(`앵커 생성 실패: ${e}`);
    }
  }

  async function getCurrentContent(): Promise<string> {
    if (!folderPath) return "";
    const pair = await invoke<NotePair>("read_note_pair", { folder: folderPath });
    return pair.content;
  }

  async function handleAddAnnotation(annotation: Annotation) {
    if (!folderPath) return;
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

  // Re-reconcile when lmmDoc changes (e.g. after annotation added)
  useEffect(() => {
    if (domPlainRef.current) {
      reconcile(lmmDoc, domPlainRef.current);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lmmDoc]);

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
        {orphanCount > 0 && (
          <span className="lm-orphan-badge">⚠ 끊긴 앵커 {orphanCount}개</span>
        )}
        <div className="lm-spacer" />
        <div className="lm-anchor-count">
          앵커 {lmmDoc.anchors.length}  주석 {lmmDoc.annotations.length}
        </div>
      </div>

      <div className="lm-content-wrap">
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
                onAnchorClick={(m) => setMenu(m)}
              />
            </div>

            {menu && (
              <AnnotationMenu
                menu={menu}
                onClose={() => setMenu(null)}
                onAdd={handleAddAnnotation}
                onRemoveAnchor={handleRemoveAnchor}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
