# LayerMark — Git 커밋 컨벤션

이 문서는 LayerMark 프로젝트의 모든 Git 커밋이 따라야 할 규칙을 정의한다.
새로운 세션에서 작업을 이어받는 Claude도 이 규칙을 반드시 준수한다.

---

## 커밋 메시지 형식

```
<type>(<scope>): <subject>

<body>

<footer>
```

### type

| type | 사용 시점 |
|------|-----------|
| `feat` | 새 기능 추가 |
| `fix` | 버그 수정 |
| `spec` | 포맷 명세(.lmm 스키마) 변경 |
| `docs` | 문서만 변경 (CONTEXT, CHANGELOG 등) |
| `refactor` | 기능 변화 없는 코드 구조 변경 |
| `test` | 테스트 추가/수정 |
| `chore` | 빌드 설정, .gitignore 등 잡무 |

### scope (선택)

변경 범위를 괄호 안에 명시한다.

| scope | 대상 |
|-------|------|
| `schema` | lmm.schema.json |
| `validator` | validate.js / validate.rs |
| `renderer` | SVG 오버레이 관련 |
| `anchor` | 앵커 복구 로직 |
| `orphan` | Orphan 관리 UI |
| `connection` | connection 렌더링 |
| `bundle` | .lmb 패키징 |
| `tauri` | Tauri/Rust 백엔드 |
| `context` | LAYERMARK_CONTEXT.md |

### subject

- 50자 이내
- 명령형 현재 시제 (한국어: "추가한다" X → "추가" O, 영어: "added" X → "add" O)
- 마침표 없음

### body (선택)

- 72자 줄바꿈
- "무엇을"이 아니라 "왜"를 설명
- 설계 결정의 근거를 기록

### footer (선택)

- `Resolves: #이슈번호`
- `BREAKING CHANGE: 설명` — 하위 호환성이 깨지는 변경 시 필수

---

## Phase별 커밋 전략

각 Phase는 **최소 1개, 최대 논리적 단위**의 커밋으로 구성한다.

```
Phase 0: spec 파일들을 한 커밋으로
Phase 1: Tauri 세팅 + 텍스트 렌더러를 한 커밋으로
         (세팅과 기능이 분리될 만큼 크면 두 커밋으로 나눠도 됨)
Phase 2~5: 마찬가지로 논리적 단위로 분리
```

Phase 완료 커밋은 항상 body에 다음을 포함한다:
- 이번 Phase에서 구현한 것
- 다음 Phase에서 구현할 것
- 알려진 한계나 미결 사항

---

## 실제 커밋 예시

### Phase 0 커밋
```
spec(schema): define .lmm format v1.0

Establishes the complete LayerMark memo layer file format.

Implemented:
- JSON Schema for .lmm (anchors + 6 annotation types)
- Semantic validator (validate.js) with 9 cross-reference rules
- sample.lmm covering all annotation types and edge cases
- broken.lmm for regression testing

Key decisions recorded in LAYERMARK_CONTEXT.md:
- NodeId: exactly 8 chars, CSPRNG-generated
- position field: Unicode code point offset (not UTF-8 bytes)
- NoteFloating removed; all notes anchor-bound with floating:bool
- W3C TextQuoteSelector for anchor recovery (3-tier fallback)

Next: Phase 1 — Tauri project setup + markdown text renderer
```

### Phase 1 커밋
```
feat(tauri): text renderer with bounding box extraction

[Phase 1 완료 후 해당 Phase 세션에서 직접 작성]
```

---

## 새 세션 시작 시 체크리스트

새로운 Claude 세션에서 작업을 이어받을 때:

1. `LAYERMARK_CONTEXT.md` 읽기 — 현재 Phase, 설계 결정 파악
2. `git log --oneline` 확인 — 마지막 커밋 상태 파악
3. `git status` 확인 — 미커밋 변경사항 파악
4. `CHANGELOG.md` 읽기 — 수정 히스토리 파악
5. 작업 시작

세션 종료 시:
1. `CHANGELOG.md` 업데이트
2. `LAYERMARK_CONTEXT.md` 구현 상태 표 업데이트
3. 커밋 (이 컨벤션 문서의 형식 준수)