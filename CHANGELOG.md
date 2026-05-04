# CHANGELOG

LayerMark 프로젝트의 모든 변경 이력을 기록한다.
각 Phase 완료 시 해당 세션의 Claude가 이 파일을 업데이트한다.

형식: [Phase X] — 날짜 — 주요 변경사항 요약

---

## [Phase 0] — 2025-05 — .lmm 포맷 명세 확정

### 개요
LayerMark의 핵심 데이터 포맷인 `.lmm` 파일의 스펙을 확정했다.
이 Phase의 산출물이 이후 모든 구현의 기준이 된다.

### 산출물
- `spec/lmm.schema.json` — JSON Schema (헌법)
- `spec/validate.js` — Node.js 검증 스크립트
- `spec/sample.lmm` — 모든 케이스를 포함하는 예시 파일
- `spec/broken.lmm` — 오류 케이스 회귀 테스트용
- `LAYERMARK_CONTEXT.md` — 전체 설계 결정 문서
- `docs/GIT_CONVENTION.md` — Git 커밋 컨벤션

### 주요 설계 결정 (결정 근거는 LAYERMARK_CONTEXT.md 참조)

#### 포맷 구조
- 파일 분리: `content.lm` (마크다운) + `memo.lmm` (YAML 마킹)
- 공유 시 `.lmb` (zip 번들)로 패키징

#### NodeId
- 형식: 정확히 8자리 소문자 알파벳+숫자 (`^[a-z0-9]{8}$`)
- 생성: CSPRNG 기반 (Rust: `rand` crate, JS: `crypto.getRandomValues()`)
- 파일 내 전역 유일성 보장 (anchor ID와 annotation ID 간에도)

#### Anchor (W3C TextQuoteSelector 기반)
- `exact`: 선택된 텍스트 (1자 이상, 한국어 조사 단위도 허용)
- `prefix`/`suffix`: 기본 32 코드 포인트, 최대 64 코드 포인트
- `position`: 유니코드 코드 포인트 단위 절대 오프셋 (UTF-8 바이트 아님)
- 복구 우선순위: TextQuoteSelector → position 근방 탐색 → Orphan

#### Annotation 6종
| 타입 | 주요 속성 |
|------|-----------|
| underline | style: single\|double\|wave\|dashed |
| highlight | color(필수): yellow\|green\|pink\|blue, style: fill\|check\|underline |
| box | style: rectangle\|oval\|triangle |
| bracket | style(필수): round\|square\|curly\|angle\|lenticular\|corner\|double-corner |
| connection | style: solid\|dashed, arrow: none\|one-way\|two-way |
| note | target(anchor귀속) 또는 connection(라벨), floating: bool |

#### Note 설계 핵심 결정
- `NoteFloating` 타입 제거: "위치가 정체성인 개체의 위치를 저장 안 함"은 철학 모순
- 대신 `NoteOnAnchor`에 `floating: boolean` 추가
  - `floating: false` (기본): anchor와 연결선 표시
  - `floating: true`: 연결선 없이 anchor 근처 배치 (여백 메모 효과)
- 편집기 UX: 여백 클릭 시 가장 가까운 텍스트에 자동 anchor 생성 후 floating note 연결

#### 렌더러 명세
- Z-Index 순서: highlight → underline → box/bracket → connection → note
- 다중 줄 anchor 연결점: 모든 줄 bounding box Union 영역의 경계선 중 최단 거리 지점
- 허공 note 없음; position 저장 안 함 (LayerMark 철학)

#### 충돌 해결 (Orphan 처리)
- 4원칙: 자동 삭제 금지, 확신 없는 자동 재연결 금지, 후보 제시 후 사용자 선택, non-blocking
- Confidence: high(자동재연결) / medium(사이드바 확인 요청) / low(Orphan)
- 완전 중복 케이스: position 거리 기반 최근접 선택(medium), 동일 거리 시 사용자 선택

### 수정 이력 (세션 내 주요 변경)
이 Phase는 여러 라운드의 검토를 거쳐 확정됐다. 주요 변경 순서:

1. 초기안: `(문단번호, 텍스트, nth)` 앵커 방식
2. W3C TextQuoteSelector 방식으로 전환
3. ID 패턴 `{4,}` → `{8}` 고정
4. prefix/suffix 32자 → 64 코드 포인트로 상한 조정
5. Note를 NoteOnAnchor/NoteOnConnection/NoteFloating 세 타입으로 분리
6. NoteFloating 철학 모순 발견 → 제거, floating 필드로 대체
7. position 인코딩 기준 명시 (유니코드 코드 포인트)
8. 다중 줄 anchor 연결점 기준 명시 (Union 경계선 최단 거리)
9. assets 샌드박스 정책 추가 (`../` 경로 거부)
10. 완전 중복 케이스 처리 로직 추가

### 다음 Phase
Phase 1: Tauri 개발 환경 세팅 + 마크다운 텍스트 렌더러 + bounding box 추출

---

## [Phase 1] — 2025-05 — Tauri 텍스트 렌더러

### 개요
### 개요
Tauri(Rust + React/TypeScript) 기반 데스크탑 앱을 세팅하고,
마크다운 렌더링과 텍스트 선택 → 앵커 생성 → `.lmm` 저장까지 동작하는
Phase 1 레퍼런스 렌더러를 구현했다.

### 산출물
- `src-tauri/src/commands.rs` — Tauri IPC 커맨드 5종
- `src-tauri/src/lib.rs` — 커맨드 등록 + 플러그인 초기화
- `src/types/lmm.ts` — lmm.schema.json 기반 TypeScript 타입
- `src/lib/anchor.ts` — ID 생성, TextQuoteSelector 검색, confidence 판정
- `src/lib/lmm-document.ts` — parse/serialize, semantic rule A~I 검증
- `src/App.tsx` — 마크다운 렌더러 UI + 앵커 생성/복구 흐름
- `src/App.css` — 다크 테마 스타일

### 구현 내용

#### Rust 백엔드 (src-tauri)
- `generate_anchor_id`: CSPRNG 기반 8자리 ID 생성, 충돌 시 재생성
- `read_note_pair` / `write_note_pair`: content.lm + memo.lmm 쌍 읽기/쓰기
- `render_markdown`: pulldown-cmark로 .lm → HTML 변환
- `plain_text_from_markdown`: 마크다운 평문 추출 (코드 포인트 단위)
- 의존성 추가: pulldown-cmark, serde_yaml, rand, unicode-segmentation, notify, tauri-plugin-fs, tauri-plugin-dialog

#### TypeScript 프론트엔드
- DOM 텍스트 노드 기준 offset 계산 (buildTextNodeEntries)
  - Rust plain text 기준 대신 DOM 기준으로 전환하여 하이라이트 위치 정확도 확보
- W3C TextQuoteSelector 호환 앵커 복구 (Levenshtein similarity 기반 confidence)
- injectMark: TreeWalker로 정확한 위치에 mark 태그 삽입
- 앵커 디버그 패널: exact, ID, confidence 표시

#### 알려진 한계
- injectMark는 단일 텍스트 노드 내 앵커만 처리 (줄바꿈 걸친 앵커는 Phase 2 SVG 오버레이에서 처리)
- annotation 타입 선택 UI 없음 (현재는 앵커 생성만 가능)
- 외부 편집기 변경 감지(notify) 미구현 — Phase 3

### 주요 기술 결정

#### DOM을 plain text 진실의 원본으로 사용
Rust의 plain_text_from_markdown과 브라우저 DOM의 텍스트 노드 순서가
달라 하이라이트 위치가 어긋나는 문제 발생.
DOM TreeWalker로 직접 추출한 텍스트를 기준으로 offset을 계산하는 방식으로 해결.

#### BOM 문제
PowerShell echo 명령이 UTF-16 BOM을 삽입해 Rust UTF-8 파서 실패.
New-Object System.Text.UTF8Encoding $false 로 BOM 없는 UTF-8 파일 생성.

### 다음 Phase
Phase 2: SVG 오버레이 기본 구조 + underline/highlight/box/bracket 렌더링
- mark DOM 방식 → 투명 SVG 레이어 오버레이로 교체
- 드래그 종료 시 Quick Action Bar (annotation 타입 선택 팝업)
- Z-Index 순서 준수 (highlight → underline → box/bracket → connection → note)

---

## [Phase 2] — 2026-05 — SVG 오버레이 + 주석 메뉴

### 개요
DOM mark 방식을 걷어내고, Range.getClientRects() 기반 SVG 오버레이로
완전히 전환했다. 텍스트 선택 후 바로 annotation 타입을 선택할 수 있는
2-step 컨텍스트 메뉴도 구현했다.

### 산출물
- `src/lib/overlay.ts` — SVG 드로잉 엔진
  - `getLineRects`: Range.getClientRects() → LineRect[], 멀티라인 지원
  - `buildDrawInstruction`: annotation 타입 → DrawInstruction 디스패처
- `src/types/overlay.ts` — ResolvedAnchor, MenuState 공유 타입
- `src/components/SvgOverlay.tsx` — SVG 오버레이 렌더러
  - ResizeObserver 기반 자동 재계산
  - 레이어 순서: highlight → underline/bracket/box → note
- `src/components/AnnotationMenu.tsx` — 2-level 컨텍스트 메뉴
- `src/App.tsx` — Phase 2로 업데이트 (DOM mark 제거, SVG + 메뉴 연결)
- `src/App.css` — overlay-wrap/svg-wrap 레이아웃, 메뉴 스타일 전체

### 구현 내용

#### SVG 오버레이 아키텍처
```
lm-overlay-wrap (position: relative)
  ├── lm-markdown-body        ← 마크다운 HTML (텍스트 선택 가능)
  ├── lm-svg-wrap             ← position: absolute, top/left: 0, pointer-events: none
  │   └── SvgOverlay (SVG)   ← annotation 그룹별 pointer-events 재활성화
  └── AnnotationMenu          ← position: absolute, z-index: 200
```

#### 지원 annotation 렌더링
| 타입 | 구현 내용 |
|------|-----------|
| underline.single | 1.4px 실선 |
| underline.double | 1.2px 이중선 (2.5px 간격) |
| underline.wave | quadratic bezier 사인파 (amplitude 2.2, wavelength 8) |
| underline.dashed | strokeDasharray 4 3 |
| highlight | RGBA fill rect (색상별 투명도 조정) |
| bracket.round | quadratic bezier 곡선 괄호 |
| bracket.square | L자 꺾임 |
| bracket.curly | 3-segment curly brace |
| bracket.angle | < > 형 |
| bracket.lenticular | 렌즈형 곡선 |
| box.rectangle | 사각형 stroke |
| box.oval | SVG arc 타원 |
| box.triangle | 삼각형 |
| note | 점선 밑줄 + 클릭 토글 말풍선 (SVG foreignObject) |

#### 컨텍스트 메뉴 UX
- 텍스트 드래그 → 앵커 생성 → SVG 주석 즉시 반영
- SVG 위 annotation 클릭 → AnnotationMenu 오픈
- 메뉴 Step 1: highlight / underline / bracket / box / note / 앵커 삭제
- 메뉴 Step 2: 스타일/색상 세부 선택
- Note: textarea 입력, Ctrl+Enter 확인
- 외부 클릭 / ESC로 닫기

#### 멀티라인 처리
Range.getClientRects()가 줄 단위 rect를 반환하므로 Phase 1의 단일 텍스트 노드 한계 해결.
인접 rect 병합 로직(sameRow 2px tolerance, adjacent gap 1px)으로 토막난 rect 통합.

### 주요 기술 결정

#### cpToUtf16Offset
DOM Range API는 UTF-16 offset을 요구하지만 LayerMark의 position은 코드 포인트 단위.
`cpToUtf16Offset()` 함수로 변환하여 이모지 등 surrogate pair 문자 대응.

#### pointer-events 전략
SVG 기본값 `pointer-events: none`으로 텍스트 선택 보호.
highlight 그룹은 `pointer-events: stroke` (테두리만 이벤트).
note 그룹은 `pointer-events: all` (클릭으로 말풍선 토글).

### 알려진 한계 / Phase 3으로 이월
- Orphan 사이드바 UI 미구현 (badge만 표시됨)
- 외부 편집기 수정 감지(notify) 미구현
- 한 앵커에 여러 동일 타입 annotation이 쌓일 수 있음 (중복 방지 미구현)
- note 말풍선이 창 위/좌우 경계에서 잘릴 수 있음 (overflow: visible로 임시 처리)

### 다음 Phase
Phase 3: Orphan 관리 — 사이드바 패널 + reconciliation + 외부 편집기 변경 감지

---


## [Phase 3] — 2026-05 — Orphan 관리 + 파일 감시 + 중복 annotation 방지

### 개요
Phase 2에서 badge만 표시되던 Orphan 관리를 완전히 구현했다.
외부 편집기로 content.lm을 수정해도 자동으로 앵커를 재검증하고,
끊긴 마킹을 사이드바 패널에서 시각적으로 관리할 수 있다.

### 산출물
- `src-tauri/src/watch.rs` — notify 기반 content.lm 파일 감시
  - "content-changed" Tauri event emit
  - 폴더 단위 NonRecursive 감시, content.lm 필터링
  - WatcherState: Tauri managed state로 watcher lifetime 관리
- `src-tauri/src/lib.rs` — watch 모듈 등록 + manage(WatcherState)
- `src/components/OrphanPanel.tsx` — Orphan 사이드바 패널
  - 접힘/펼침 토글 (36px ↔ 260px)
  - 후보 목록 표시 + [연결] 버튼
  - [삭제] + "나중에 처리 가능" (non-blocking 원칙 준수)
  - Orphan 발생 시 패널 자동 오픈
- `src/lib/anchor.ts` — resolveAnchor 고도화
  - 저신뢰 케이스(confidence: low)도 OrphanAnchor로 처리
  - findNearbyCandidates: exact가 사라진 경우 ±200 cp 범위에서
    유사 길이 토큰 검색 → 후보 최대 3개 제시
  - 한국어 조사 단독 선택 시 prefix/suffix 충돌 케이스 명시 주석
- `src/App.tsx` — Phase 3 통합
  - listen("content-changed") → 자동 reconcile
  - watch_note_folder / unwatch_note_folder IPC 연결
  - isDuplicateAnnotation: 동일 타입+스타일 annotation 중복 방지
  - OrphanPanel 연결 (reconnect/delete/toggle)
  - lm-body + lm-content-area 레이아웃으로 사이드바 배치
- `src/App.css` — Phase 3 스타일
  - lm-body (flex row), lm-content-area
  - OrphanPanel 전체 스타일 (패널/헤더/아이템/후보/버튼)
  - lm-btn-small, lm-btn-reconnect, lm-btn-delete

### 주요 구현 결정

#### Orphan 4원칙 준수
- 자동 삭제 없음: [삭제]는 항상 명시적 사용자 클릭 필요
- 확신 없는 자동 재연결 없음: confidence=low → Orphan, 후보만 제시
- 사용자 선택: [연결] 클릭 시 해당 position으로 anchor.position 업데이트
  → 다음 reconcile에서 high confidence로 재연결
- Non-blocking: Orphan이 있어도 편집 계속 가능

#### 파일 감시 구조
notify::recommended_watcher가 백그라운드 스레드에서 이벤트를 받아
Tauri AppHandle.emit()으로 프론트에 전달.
WatcherState(Mutex<Option<RecommendedWatcher>>)를 Tauri managed state로
등록해 watcher lifetime을 안전하게 관리.
폴더 전환 시 기존 watcher를 먼저 drop(unwatch)하고 새 watcher 시작.

#### 중복 annotation 방지
connection 타입은 허용 (각각 독립적인 연결).
나머지 타입은 same target + same type + same style/color 조합이면 거부.

### 알려진 한계 / Phase 4로 이월
- connection 렌더링 미구현 (Phase 4)
- note 말풍선 창 경계 clamp 미구현 (overflow: visible 임시 처리 유지)
- Orphan 재연결 후 exact 불일치 케이스는 medium confidence로 남음
  (사용자가 직접 앵커 삭제 후 재선택 권장)

### 다음 Phase
Phase 4: connection 렌더링 — arrow/line + elkjs 자동 배치

### Phase 3 핫픽스 (검증 후 수정)

#### layout: Orphan 패널 추가 후 스크롤 구조 오류
- `lm-body`에 `min-height: 0` 누락 → flex child가 viewport를 넘어 스크롤바가 전체 영역에 붙는 문제
- `lm-content-area`에 `padding: 40px` 누락 (lm-content-wrap에서 이전하면서 빠짐)
- `lm-overlay-wrap`의 `height: 100%` 제거 (overflow-y scroll 컨테이너 안에서 오동작)

#### duplicate annotation guard 시멘틱 버그
- 기존 `"style" in e || "style" in n` 조건: highlight 객체에 style 키가 없으면
  false → color 체크로 넘어가는 듯 보이지만, `||` 조건이 중간에서 잘못 분기
- 타입별 switch로 교체: highlight→color, underline→style(default:"single"),
  bracket→style, box→style(default:"rectangle"), note→무조건 1개

#### highlight SVG 클릭 불가
- `OverlayGroup`의 `pointerEvents: "stroke"` → highlight는 path가 아닌 filled rect이므로
  stroke 이벤트 없음 → `ins.type === "highlight" ? "fill" : "stroke"`로 분기

#### 드래그로 중복 앵커 생성 (근본 원인)
- 기존 앵커에 annotation 추가 경로: SVG 클릭뿐이었는데 highlight는 클릭 불가
- 결국 사용자가 같은 텍스트를 다시 드래그 → 새 앵커 생성 → 중복 덧씌움
- `handleMouseUp`에 기존 앵커 overlap 감지 로직 추가:
  selStart < raEnd && selEnd > ra.position → 새 앵커 대신 기존 메뉴 오픈

### Phase 3 2차 핫픽스 (검증 후 추가 발견)

#### Orphan 재연결 무한 루프
- 원인: `updateAnchorPosition`으로 position만 교체
  → `resolveAnchor`는 exact로 먼저 검색하므로 exact가 사라진 경우 position과 무관하게 Orphan 유지
- 수정: `updateAnchorOnReconnect` 추가 → exact + position 동시 교체
- OrphanPanel `onReconnect` 시그니처에 `candidateText` 추가

#### 후보 예측 실패 (구 단위 앵커)
- 원인: `findNearbyCandidates`가 ±2cp 토큰 길이 기준으로 필터링
  → "타입스크립트는 정적 타입을 추가한다" 같은 구 단위 앵커에 글자 하나가 삽입되면 길이 범위 초과
- 수정: 슬라이딩 윈도우 + prefix/suffix 유사도 스코어링으로 교체
  → ±30% 길이 허용, 문자집합 overlap 사전 필터, score > 0.4 임계값, 중복 제거 후 top 3

#### UX 구조 변경: 좌클릭/우클릭 분리
- 배경: highlight fill 영역 클릭을 허용하면 좌클릭 드래그와 annotation 메뉴가 충돌
- 수정: 좌클릭 드래그 = 새 앵커 생성 전용 / 우클릭 = annotation 메뉴
  - SvgOverlay: onClick → onContextMenu (e.preventDefault로 브라우저 메뉴 차단)
  - cursor: context-menu, SVG `<title>` 툴팁 "우클릭으로 주석 추가/수정"
  - 기존 overlap 감지 인터셉트 제거 (부분 선택 드래그 불가 문제 해결)

#### note 중복 → 편집 모드 전환
- `isDuplicateAnnotation`에서 note 중복 감지 시 기존 content를 `editNoteContent`로 전달
- `MenuState`에 `editNoteContent?: string` 필드 추가
- `AnnotationMenu`: `isEditingNote` 플래그로 제목("메모 편집"), 버튼("저장"), 뒤로가기 버튼 숨김 분기
- `handleUpdateNote`: 기존 note content를 in-place patch (새 annotation 추가 아님)

