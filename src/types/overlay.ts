// src/types/overlay.ts
// Types shared between App.tsx and overlay.ts (not stored in .lmm)

export interface ResolvedAnchor {
  id: string;
  position: number;   // cp offset in plain text
  length: number;     // cp length of exact
  confidence: "high" | "medium" | "low";
}

// Annotation menu state
export interface MenuState {
  anchorId: string;
  x: number;
  y: number;
}
