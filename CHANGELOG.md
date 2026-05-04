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
[Phase 1 세션에서 완료 후 해당 세션의 Claude가 작성]

---