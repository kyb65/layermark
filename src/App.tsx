import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { createAnchor, collectAllIds, resolveAnchor } from "./lib/anchor";
import {
  parseLmm,
  serializeLmm,
  newLmmDocument,
  addAnchor,
  updateAnchorPosition,
} from "./lib/lmm-document";
import type { LmmDocument, AnchorMatch } from "./types/lmm";
import "./App.css";

interface NotePair {
  folder: string;
  content: string;
  memo: string | null;
}

interface ResolvedAnchor {
  id: string;
  position: number;
  length: number;
  confidence: "high" | "medium" | "low";
}

interface TextNodeEntry {
  node: Text;
  start: number;
  end: number;
  chars: string[];
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  high:   "rgba(250, 199, 117, 0.45)",
  medium: "rgba(250, 199, 117, 0.28)",
  low:    "rgba(220, 80, 80, 0.25)",
};

function buildTextNodeEntries(container: HTMLElement): TextNodeEntry[] {
  const entries: TextNodeEntry[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const chars = [...(node.textContent ?? "")];
    entries.push({ node, start: offset, end: offset + chars.length, chars });
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

export default function App() {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [lmmDoc, setLmmDoc] = useState<LmmDocument>(newLmmDocument());
  const [resolvedAnchors, setResolvedAnchors] = useState<ResolvedAnchor[]>([]);
  const [status, setStatus] = useState<string>("노트 폴더를 열어 시작하세요");
  const [orphanCount, setOrphanCount] = useState(0);

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
      entries,
      range.startContainer as Text,
      range.startOffset
    );
    const selEnd = domRangeToPlainOffset(
      entries,
      range.endContainer as Text,
      range.endOffset
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

      await invoke("write_note_pair", {
        folder: folderPath,
        content: await getCurrentContent(),
        memo: serializeLmm(newDoc),
      });

      setLmmDoc(newDoc);
      reconcile(newDoc, domPlain);
      setStatus(
        `앵커 생성: "${selectedText.slice(0, 20)}${selectedText.length > 20 ? "…" : ""}"`
      );
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

  useEffect(() => {
    if (!contentRef.current) return;

    const existing = contentRef.current.querySelectorAll("mark[data-anchor-id]");
    existing.forEach((el) => {
      const parent = el.parentNode!;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });

    if (resolvedAnchors.length === 0) return;

    for (const ra of resolvedAnchors) {
      try {
        injectMark(contentRef.current!, ra);
      } catch {
        // non-fatal
      }
    }
  }, [resolvedAnchors]);

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
        <div className="lm-anchor-count">앵커 {lmmDoc.anchors.length}개</div>
      </div>

      <div className="lm-content-wrap">
        {!folderPath ? (
          <div className="lm-empty">
            <p>노트 폴더를 열어 시작하세요</p>
            <p className="lm-empty-sub">
              폴더 안에 content.lm 파일이 있어야 합니다
            </p>
            <button className="lm-btn-primary lm-btn-lg" onClick={openFolder}>
              폴더 열기
            </button>
          </div>
        ) : (
          <div
            ref={contentRef}
            className="lm-markdown-body"
            onMouseUp={handleMouseUp}
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        )}
      </div>

      {lmmDoc.anchors.length > 0 && (
        <div className="lm-anchor-panel">
          <div className="lm-panel-title">앵커 목록 (Phase 1 디버그)</div>
          {lmmDoc.anchors.map((a) => {
            const resolved = resolvedAnchors.find((r) => r.id === a.id);
            return (
              <div
                key={a.id}
                className={`lm-anchor-item lm-conf-${resolved?.confidence ?? "orphan"}`}
              >
                <span className="lm-anchor-exact">"{a.exact}"</span>
                <span className="lm-anchor-id">{a.id}</span>
                <span className="lm-anchor-conf">
                  {resolved ? resolved.confidence : "orphan"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function injectMark(container: HTMLElement, ra: ResolvedAnchor) {
  const entries = buildTextNodeEntries(container);
  const raEnd = ra.position + ra.length;

  for (const entry of entries) {
    if (entry.end <= ra.position || entry.start >= raEnd) continue;

    const localStart = Math.max(0, ra.position - entry.start);
    const localEnd   = Math.min(entry.chars.length, raEnd - entry.start);

    const before = entry.chars.slice(0, localStart).join("");
    const marked = entry.chars.slice(localStart, localEnd).join("");
    const after  = entry.chars.slice(localEnd).join("");

    const mark = document.createElement("mark");
    mark.dataset.anchorId = ra.id;
    mark.textContent = marked;
    mark.style.backgroundColor = HIGHLIGHT_COLORS[ra.confidence];
    mark.style.borderRadius = "2px";
    mark.title = `${ra.id} (${ra.confidence})`;

    const parent = entry.node.parentNode!;
    if (before) parent.insertBefore(document.createTextNode(before), entry.node);
    parent.insertBefore(mark, entry.node);
    if (after)  parent.insertBefore(document.createTextNode(after), entry.node);
    parent.removeChild(entry.node);
    break;
  }
}
