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