// src/components/AnnotationMenu.tsx
// Context menu that appears when user clicks on an anchor's overlay.
// Lets the user add annotation types to an existing anchor.

import { useEffect, useRef, useState } from "react";
import type { MenuState } from "../types/overlay";
import type { Annotation, Bracket, Highlight } from "../types/lmm";

interface Props {
  menu: MenuState;
  onClose: () => void;
  onAdd: (annotation: Annotation) => void;
  onRemoveAnchor: (anchorId: string) => void;
}

type Step =
  | { kind: "root" }
  | { kind: "highlight" }
  | { kind: "underline" }
  | { kind: "bracket" }
  | { kind: "box" }
  | { kind: "note" };

export function AnnotationMenu({ menu, onClose, onAdd, onRemoveAnchor }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>({ kind: "root" });
  const [noteText, setNoteText] = useState("");

  // Close on outside click
  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function addAndClose(ann: Annotation) {
    onAdd(ann);
    onClose();
  }

  const target = menu.anchorId;

  return (
    <div
      ref={ref}
      className="lm-ann-menu"
      style={{ left: menu.x, top: menu.y }}
    >
      {step.kind === "root" && (
        <>
          <div className="lm-ann-menu-title">주석 추가</div>
          <button onClick={() => setStep({ kind: "highlight" })}>
            <span className="lm-menu-icon">▬</span> 하이라이트
          </button>
          <button onClick={() => setStep({ kind: "underline" })}>
            <span className="lm-menu-icon">_</span> 밑줄
          </button>
          <button onClick={() => setStep({ kind: "bracket" })}>
            <span className="lm-menu-icon">[ ]</span> 괄호
          </button>
          <button onClick={() => setStep({ kind: "box" })}>
            <span className="lm-menu-icon">□</span> 박스
          </button>
          <button onClick={() => setStep({ kind: "note" })}>
            <span className="lm-menu-icon">✎</span> 메모
          </button>
          <div className="lm-ann-menu-sep" />
          <button
            className="lm-menu-danger"
            onClick={() => { onRemoveAnchor(target); onClose(); }}
          >
            앵커 삭제
          </button>
        </>
      )}

      {step.kind === "highlight" && (
        <>
          <div className="lm-ann-menu-title">색상 선택</div>
          {(["yellow", "green", "pink", "blue"] as Highlight["color"][]).map((color) => (
            <button
              key={color}
              className="lm-menu-color-btn"
              onClick={() => addAndClose({ type: "highlight", target, color })}
            >
              <span className="lm-color-dot" data-color={color} />
              {color === "yellow" ? "노랑" : color === "green" ? "초록" : color === "pink" ? "분홍" : "파랑"}
            </button>
          ))}
          <button className="lm-menu-back" onClick={() => setStep({ kind: "root" })}>← 뒤로</button>
        </>
      )}

      {step.kind === "underline" && (
        <>
          <div className="lm-ann-menu-title">밑줄 스타일</div>
          {([
            ["single",  "단선  ___"],
            ["double",  "이중  ═══"],
            ["wave",    "물결  ~~~"],
            ["dashed",  "점선  ---"],
          ] as [string, string][]).map(([style, label]) => (
            <button
              key={style}
              onClick={() => addAndClose({ type: "underline", target, style: style as "single" | "double" | "wave" | "dashed" })}
            >
              {label}
            </button>
          ))}
          <button className="lm-menu-back" onClick={() => setStep({ kind: "root" })}>← 뒤로</button>
        </>
      )}

      {step.kind === "bracket" && (
        <>
          <div className="lm-ann-menu-title">괄호 스타일</div>
          {([
            ["round",     "( )  round"],
            ["square",    "[ ]  square"],
            ["curly",     "{ }  curly"],
            ["angle",     "< >  angle"],
            ["lenticular","[ ]  lenticular"],
          ] as [Bracket["style"], string][]).map(([style, label]) => (
            <button
              key={style}
              onClick={() => addAndClose({ type: "bracket", target, style })}
            >
              {label}
            </button>
          ))}
          <button className="lm-menu-back" onClick={() => setStep({ kind: "root" })}>← 뒤로</button>
        </>
      )}

      {step.kind === "box" && (
        <>
          <div className="lm-ann-menu-title">박스 스타일</div>
          {([
            ["rectangle", "□ 사각형"],
            ["oval",      "○ 타원"],
            ["triangle",  "△ 삼각형"],
          ] as [string, string][]).map(([style, label]) => (
            <button
              key={style}
              onClick={() => addAndClose({ type: "box", target, style: style as "rectangle" | "oval" | "triangle" })}
            >
              {label}
            </button>
          ))}
          <button className="lm-menu-back" onClick={() => setStep({ kind: "root" })}>← 뒤로</button>
        </>
      )}

      {step.kind === "note" && (
        <>
          <div className="lm-ann-menu-title">메모 내용</div>
          <textarea
            className="lm-menu-textarea"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="메모를 입력하세요..."
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                if (noteText.trim()) addAndClose({ type: "note", content: noteText.trim(), target });
              }
            }}
          />
          <div className="lm-menu-note-actions">
            <button className="lm-menu-back" onClick={() => setStep({ kind: "root" })}>← 뒤로</button>
            <button
              className="lm-menu-confirm"
              disabled={!noteText.trim()}
              onClick={() => {
                if (noteText.trim()) addAndClose({ type: "note", content: noteText.trim(), target });
              }}
            >
              확인
            </button>
          </div>
        </>
      )}
    </div>
  );
}
