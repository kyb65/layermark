# LayerMark — 전체 컨텍스트 문서
> 이 문서는 새로운 Claude 세션에서 LayerMark 프로젝트를 완벽하게 파악할 수 있도록
> 지금까지의 모든 설계 결정, 근거, 미결 사항을 담은 단일 진실 공급원(Single Source of Truth)이다.
> 이 문서 하나로 이전 세션과 동일한 수준의 이해를 갖출 수 있어야 한다.

---

## 1. 프로젝트 개요

### 이름
**LayerMark**

### 한 줄 설명
타이핑 노트에서 손필기의 자유로운 마킹(밑줄, 화살표, 메모 풍선, 괄호 등)을 구현하는
**오픈 파일 포맷 + 레퍼런스 편집기** 프로젝트.

### 핵심 철학
- Markdown이 "h1이 몇 픽셀"을 정의하지 않고 "h1"만 정의하듯,
  LayerMark도 **"무엇을"만 저장하고 "어떻게 그릴지"는 렌더러에 위임**한다.
- **데이터 포맷은 보수적으로 (W3C 표준 기반), UX는 진보적으로 (손필기처럼 자유롭게).**
- 레이어 분리: 본문(content)과 마킹(memo)은 별도 파일로 분리한다.
  content.lm은 순수 마크다운이라 외부 편집기로 열 수 있다.

### 탄생 배경
OneNote처럼 타이핑과 손필기를 통합하려 했으나 모두 어중간했다.
LayerMark는 **타이핑의 선형성을 유지하면서 그 위에 관계 정보를 덧씌우는** 방식으로 이를 해결한다.

---

## 2. 파일 구조

### 평소 (개발/편집 모드)
```
my-note/
  content.lm     <- 본문. 순수 마크다운. 외부 편집기(VSCode 등)로 열 수 있음.
  memo.lmm       <- 마킹 레이어. LayerMark 전용 YAML 포맷.
```

### 공유/내보내기 (.lmb 번들)
```
my-note.lmb (zip)
  content.lm
  memo.lmm
  assets/        <- 로컬 이미지/첨부파일. content.lm에서 상대경로로 참조한 파일만 포함.
```
> **assets 규칙:**
> - 로컬 파일(`./img/photo.png` 등 프로젝트 루트 하위 경로)은 assets/ 폴더에 복사해 포함한다.
> - **샌드박스 정책 (Phase 5 구현 필수):** `../`처럼 프로젝트 루트 상위를 참조하는 경로와
>   절대 경로(`C:\...`, `/home/...`)는 번들링 시 **경고 메시지를 표시하고 포함하지 않는다**.
>   content.lm의 해당 이미지 링크는 깨진 상태로 번들에 포함된다.
> - 외부 URL(`https://...`)은 번들에 포함하지 않는다. 링크 자체는 유지된다.
> - v1.0에서는 assets/ 내 파일에 대한 마킹(.lmm anchor)은 지원하지 않는다.

### 파일 확장자 의미
| 확장자 | 역할 |
|--------|------|
| `.lm`  | LayerMark content (마크다운 호환) |
| `.lmm` | LayerMark memo (마킹 레이어) |
| `.lmb` | LayerMark bundle (zip, 공유용) |

### 레이어 명칭
| 레이어 | 파일 | 설명 |
|--------|------|------|
| content 레이어 | `content.lm` | 노트 본문. 마크다운 문법. |
| memo 레이어 | `memo.lmm` | 마킹 정보. anchor + annotation. |

> **네이밍 결정 근거:**
> "memo 레이어 안에 memo 타입"이 생기면 혼란스럽기 때문에,
> 레이어 이름은 memo로 유지하되 텍스트 풍선 annotation 타입은 `note`로 명명했다.
> `mark`는 markdown과 혼동되어 기각됨.

---

## 3. .lmm 파일 포맷 명세 (v1.0)

### 전체 구조
```yaml
layermark: "1.0"   # 포맷 버전. 반드시 "1.0"이어야 함.

anchors:           # content.lm 내 텍스트 위치를 가리키는 포인터 목록. 빈 배열 허용.
  - ...

annotations:       # anchor(들)에 붙는 마킹 목록. 빈 배열 허용.
  - ...
```

> **빈 배열 허용:** `anchors: []`, `annotations: []` 모두 유효하다.
> 새로 만든 노트에 아직 마킹이 없는 상태가 이 케이스다.

### NodeId 규칙
- 형식: `^[a-z0-9]{8}$` — **정확히 8자리** 소문자 알파벳+숫자
- 스키마와 앱 구현 모두 8자리를 강제한다. 가변 길이 없음.
- `36^8 = 약 2.8조` 가지로 실용적 충돌 확률 없음
- anchor ID, note ID, connection ID 모두 동일 규칙 적용
- **파일 내 모든 ID는 전역적으로 유일해야 한다** (anchor와 annotation ID 간에도)
- ID는 앱이 자동 생성한다. 사람이 직접 작성하지 않는다.

> **ID 생성 알고리즘:**
> CSPRNG(암호학적으로 안전한 난수 생성기)를 사용한다.
> - Rust 백엔드: `rand` crate의 `rand::thread_rng().gen::<[u8; 5]>()` 후 base36 인코딩
> - JS 프론트엔드: `crypto.getRandomValues()` 후 base36 인코딩
> 생성 직후 파일 내 기존 ID와 충돌 여부를 검사하고, 충돌 시 재생성한다.

### Anchor 명세

```yaml
- id: "a1f3b2e9"        # 정확히 8자리. 파일 내 전역 고유.
  exact: "사과"          # 사용자가 선택한 정확한 텍스트. 1자 이상.
  prefix: "오늘 먹은 "   # exact 바로 앞 문자열. 빈 문자열 허용. 기본 32 코드 포인트, 최대 64 코드 포인트.
  suffix: "는 달콤했다"  # exact 바로 뒤 문자열. 빈 문자열 허용. 기본 32 코드 포인트, 최대 64 코드 포인트.
  position: 42           # content.lm 평문 기준 절대 문자 오프셋. fallback 전용.
```

#### position 인코딩 기준 (중요)
`position`은 **유니코드 코드 포인트(Unicode code point)** 단위로 계산한다.
- Rust: `str.chars().count()` 기준 (char 단위, 코드 포인트와 동일)
- JavaScript: `[...str].length` 또는 `Array.from(str).length` 기준
- **UTF-8 바이트 단위 또는 UTF-16 코드 유닛 단위를 사용하면 한국어에서 위치가 어긋난다.**

예시: `"오늘 먹은 사과"` 에서 `"사과"` 의 position은 6 (코드 포인트 기준).
- UTF-16: 6 (우연히 동일, 한국어 기본 글자는 1 코드 유닛)
- UTF-8: 18 (한국어 1글자 = 3바이트) ← 이 값을 쓰면 안 됨

#### prefix/suffix 규칙
- 빈 문자열(`""`)을 허용한다. 문서의 시작/끝 근처 텍스트이거나 단락 첫 단어인 경우 발생하는 정상 케이스다.
- prefix/suffix 길이 결정은 anchor **생성 시점**에 다음 절차로 결정한다:
  1. 기본 32 코드 포인트로 prefix/suffix 추출
  2. 동일한 `exact`가 content.lm에 두 번 이상 등장하는지 검사
  3. 두 번 이상 등장한다면, 각 등장 위치의 prefix/suffix가 서로 다른지 검사
  4. 구별되지 않으면 길이를 늘려서 (최대 64 코드 포인트) 재검사
  5. 64 코드 포인트에서도 구별 불가 → 후보를 모두 수집, 아래 "완전 중복 케이스" 처리로 넘긴다

#### 완전 중복 케이스 처리
`exact`가 여러 번 등장하고 64 코드 포인트 prefix/suffix마저 동일한 경우:
- `position` 힌트와 각 후보 위치의 거리를 비교해 **가장 가까운 후보를 선택**하되
  **confidence: medium** 상태로 표시한다 (사이드바에 "확인 필요" 알림)
- `position`마저 어긋나거나 두 후보의 거리가 동일한 경우:
  **두 후보를 모두 사이드바에 제시하고 사용자가 선택**하게 한다.
  시스템이 임의로 하나를 선택하지 않는다.

#### position 필드 주의사항
- content.lm이 수정되면 position은 즉시 낡은 값이 된다.
- 위치 조회의 주 수단이 아니라 TextQuoteSelector 실패 시의 마지막 힌트로만 쓴다.
- 앵커가 성공적으로 복구되면 그 시점의 올바른 값으로 덮어쓴다.

### Annotation 명세 — 6가지 타입

**공통 규칙:**
- 하나의 anchor에 여러 annotation을 동시에 붙일 수 있다.
  예: 같은 anchor에 `underline` + `highlight` + `bracket` + `note` + `connection` 모두 가능.
- 단일 annotation(`underline`, `highlight`, `box`, `bracket`)의 `target`은
  **anchor ID만 허용**한다. note ID나 connection ID는 참조 불가.
- `connection`의 `from`/`to`는 anchor ID 또는 **id가 명시된 note ID**만 허용한다.
  id 없는 note, connection ID는 참조 불가.

#### (1) underline
```yaml
- type: underline
  target: "a1f3b2e9"    # anchor ID (필수)
  style: single          # single | double | wave | dashed (선택, 기본값: single)
```

#### (2) highlight
```yaml
- type: highlight
  target: "a1f3b2e9"
  color: yellow          # yellow | green | pink | blue (필수)
  style: fill            # fill | check | underline (선택, 기본값: fill)
```

#### (3) box
```yaml
- type: box
  target: "a1f3b2e9"
  style: rectangle       # rectangle | oval | triangle (선택, 기본값: rectangle)
```
> box는 anchor가 가리키는 텍스트 범위 전체를 감싸는 도형을 그린다.
> 여러 단어를 하나의 box로 감싸려면 그 전체를 하나의 anchor로 선택하면 된다.

#### (4) bracket
```yaml
- type: bracket
  target: "a1f3b2e9"
  style: round           # 필수. 아래 7종 중 하나.
  # round         ( )   소괄호
  # square        [ ]   대괄호
  # curly         { }   중괄호
  # angle         < >   꺽쇠괄호
  # lenticular   【 】  렌티큘러 (CJK)
  # corner        「 」  홑낫표 (한국어/일본어)
  # double-corner『 』  겹낫표 (한국어/일본어)
```

#### (5) connection
```yaml
- id: "c0nn0001"         # 선택. note가 이 connection을 라벨로 참조할 경우에만 필수.
  type: connection
  from: "a1f3b2e9"       # 출발 노드 ID. anchor ID 또는 id가 있는 note ID. (필수)
  to:   "b2e9c3d1"       # 도착 노드 ID. anchor ID 또는 id가 있는 note ID. (필수)
  style: solid           # solid | dashed (선택, 기본값: solid)
  arrow: none            # none | one-way | two-way (선택, 기본값: none)
```

> **일대다 관계:** connection은 항상 1:1.
> "사과 → 바나나, 사과 → 오렌지"는 connection 두 개로 선언한다.
> 렌더러가 같은 `from`을 가진 connection 여러 개를 팬아웃으로 시각화한다.

> **connection에 단일 annotation 불가:**
> connection 자체에 underline이나 highlight를 붙이는 것은 지원하지 않는다.
> connection에 텍스트를 붙이려면 아래의 note를 사용한다.

#### (6) note
```yaml
- id: "n0te0001"         # 선택. connection의 from/to로 참조될 경우에만 필수.
  type: note
  content: "텍스트 내용" # 필수. 1자 이상.
  target: "a1f3b2e9"    # anchor에 붙는 경우. (target과 connection은 동시 사용 불가)
  floating: false        # 선택. true이면 anchor 근처에 배치되되 연결선을 그리지 않음. 기본값: false.
  connection: "c0nn0001" # connection 선 위의 라벨인 경우.
```

> **note의 두 가지 모드 (스키마 레벨에서 구조적으로 분리됨):**
> - `target` 있음 → `NoteOnAnchor`: anchor에 귀속되는 텍스트 풍선
>   - `floating: false` (기본값) → anchor와 연결선을 그림
>   - `floating: true` → 연결선 없이 anchor 근처에 배치. "여백 메모"처럼 보임.
>     렌더러는 anchor bounding box 기준으로 note를 근처에 배치한다. 정확한 위치는 렌더러가 결정.
> - `connection` 있음 → `NoteOnConnection`: connection 선에 붙는 라벨
> - 둘 다 있음 → **스키마에서 구조적으로 불가능** (`additionalProperties: false`)

> **`NoteFloating` 타입 제거 결정 근거:**
> "완전한 허공 note"는 "위치가 정체성의 일부인 개체"인데 위치를 저장하지 않는 것은
> LayerMark 철학과 개념적으로 충돌한다. 모든 note는 반드시 anchor에 귀속되어야 한다.
> 시각적으로 "여백에 뜨는 메모"가 필요한 경우 `floating: true`로 표현한다.
> 편집기 UX에서 사용자가 여백을 클릭하면 가장 가까운 텍스트 위치에 자동으로 anchor가
> 생성되고 `floating: true` note가 연결된다. 사용자는 "여백에 썼다"고 느끼지만
> 데이터는 항상 텍스트에 귀속된 상태를 유지한다.

> **note 내부 필기 미지원 (v1.0):**
> 메모 풍선 안에 또 밑줄을 긋는 케이스는 재귀 구조가 필요해 v1.0 미구현.
> v2.0 이후 수요 확인 시 검토한다.

---

## 4. JSON Schema 파일 (lmm.schema.json)

`lmm.schema.json`이 LayerMark의 헌법이다.
모든 코드(Rust 백엔드, React 프론트엔드)는 이 파일을 타입 정의의 원본으로 사용한다.

> **중요:** JSON Schema는 각 필드의 형식과 타입만 검사한다.
> "target이 실제로 존재하는 anchor ID를 가리키는가" 같은 cross-reference 검증은
> JSON Schema로 표현 불가능하다. 반드시 `validate.js`의 Semantic Rules도 함께 실행해야 한다.

> **Note 스키마 구조:**
> JSON Schema의 Note 정의는 `oneOf`를 사용해 두 가지 모드를 구조적으로 분리한다.
> `NoteOnAnchor`는 `floating` 필드로 연결선 표시 여부를 제어한다.
> `NoteFloating` 타입은 철학적 모순으로 제거됨 (모든 note는 anchor에 귀속).

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://layermark.io/lmm.schema.json",
  "title": "LayerMark Memo Layer (.lmm)",
  "description": "Schema for the LayerMark memo layer file format v1.0",
  "type": "object",
  "required": ["layermark", "anchors", "annotations"],
  "additionalProperties": false,
  "properties": {
    "layermark": { "type": "string", "const": "1.0" },
    "anchors":     { "type": "array", "items": { "$ref": "#/$defs/Anchor" } },
    "annotations": { "type": "array", "items": { "$ref": "#/$defs/Annotation" } }
  },
  "$defs": {
    "NodeId": {
      "description": "Exactly 8 lowercase alphanumeric characters. Generated by CSPRNG, never written by hand.",
      "type": "string",
      "pattern": "^[a-z0-9]{8}$"
    },
    "Anchor": {
      "type": "object",
      "required": ["id","exact","prefix","suffix","position"],
      "additionalProperties": false,
      "properties": {
        "id":       { "$ref": "#/$defs/NodeId" },
        "exact":    { "type": "string", "minLength": 1 },
        "prefix":   { "type": "string", "maxLength": 64 },
        "suffix":   { "type": "string", "maxLength": 64 },
        "position": {
          "description": "Unicode code point offset in content.lm plain text. Fallback only.",
          "type": "integer", "minimum": 0
        }
      }
    },
    "Annotation": {
      "type": "object", "required": ["type"],
      "oneOf": [
        { "$ref": "#/$defs/Underline" },
        { "$ref": "#/$defs/Highlight" },
        { "$ref": "#/$defs/Box" },
        { "$ref": "#/$defs/Bracket" },
        { "$ref": "#/$defs/Connection" },
        { "$ref": "#/$defs/NoteOnAnchor" },
        { "$ref": "#/$defs/NoteOnConnection" }
      ]
    },
    "Underline": {
      "type": "object", "required": ["type","target"], "additionalProperties": false,
      "properties": {
        "type":   { "type": "string", "const": "underline" },
        "target": { "$ref": "#/$defs/NodeId" },
        "style":  { "type": "string", "enum": ["single","double","wave","dashed"], "default": "single" }
      }
    },
    "Highlight": {
      "type": "object", "required": ["type","target","color"], "additionalProperties": false,
      "properties": {
        "type":   { "type": "string", "const": "highlight" },
        "target": { "$ref": "#/$defs/NodeId" },
        "color":  { "type": "string", "enum": ["yellow","green","pink","blue"] },
        "style":  { "type": "string", "enum": ["fill","check","underline"], "default": "fill" }
      }
    },
    "Box": {
      "type": "object", "required": ["type","target"], "additionalProperties": false,
      "properties": {
        "type":   { "type": "string", "const": "box" },
        "target": { "$ref": "#/$defs/NodeId" },
        "style":  { "type": "string", "enum": ["rectangle","oval","triangle"], "default": "rectangle" }
      }
    },
    "Bracket": {
      "type": "object", "required": ["type","target","style"], "additionalProperties": false,
      "properties": {
        "type":   { "type": "string", "const": "bracket" },
        "target": { "$ref": "#/$defs/NodeId" },
        "style":  { "type": "string", "enum": ["round","square","curly","angle","lenticular","corner","double-corner"] }
      }
    },
    "Connection": {
      "type": "object", "required": ["type","from","to"], "additionalProperties": false,
      "properties": {
        "id":    { "$ref": "#/$defs/NodeId" },
        "type":  { "type": "string", "const": "connection" },
        "from":  { "$ref": "#/$defs/NodeId" },
        "to":    { "$ref": "#/$defs/NodeId" },
        "style": { "type": "string", "enum": ["solid","dashed"], "default": "solid" },
        "arrow": { "type": "string", "enum": ["none","one-way","two-way"], "default": "none" }
      }
    },
    "NoteOnAnchor": {
      "description": "Note attached to an anchor. floating=false draws a line; floating=true places note near anchor with no line (visual margin note).",
      "type": "object",
      "required": ["type","content","target"],
      "additionalProperties": false,
      "properties": {
        "id":       { "$ref": "#/$defs/NodeId" },
        "type":     { "type": "string", "const": "note" },
        "content":  { "type": "string", "minLength": 1 },
        "target":   { "$ref": "#/$defs/NodeId" },
        "floating": { "type": "boolean", "default": false }
      }
    },
    "NoteOnConnection": {
      "description": "Note attached to a connection (line label).",
      "type": "object",
      "required": ["type","content","connection"],
      "additionalProperties": false,
      "properties": {
        "id":         { "$ref": "#/$defs/NodeId" },
        "type":       { "type": "string", "const": "note" },
        "content":    { "type": "string", "minLength": 1 },
        "connection": { "$ref": "#/$defs/NodeId" }
      }
    }
  }
}
```

---

## 5. 앵커 복구 로직

### 개념 정리
- **stable_id**: 편집기 세션이 살아있는 동안 메모리에서 anchor를 추적하는 런타임 식별자.
  파일(`memo.lmm`)에는 저장되지 않는다. 세션이 끊기면(파일 닫기, 앱 종료) 소멸한다.
  stable_id는 **복구 수단이 아니라 실시간 추적 수단**이다.
  파일을 다시 열면 복구는 항상 TextQuoteSelector부터 시작한다.

### 앵커 복구 우선순위 (파일을 열 때 or 외부 편집 후)

```
파일 열기 / 외부 편집 감지
        |
        v
[1순위] exact + prefix + suffix 로 TextQuoteSelector 검색
        exact가 문서 내에 존재하고 prefix/suffix가 충분히 일치 -> 성공 (confidence: high)
        exact가 존재하나 prefix/suffix가 달라진 경우            -> confidence: medium
        |
        | exact 자체가 사라진 경우
        v
[2순위] position 근방 탐색 (유니코드 코드 포인트 기준)
        position 주변에서 prefix/suffix와 유사한 텍스트 발견    -> confidence: low
        |
        | 완전 실패
        v
Orphan 처리
```

### Confidence 판정 기준

| 상황 | Confidence | 처리 |
|------|-----------|------|
| exact 일치 + prefix/suffix 일치 | high | 자동 재연결, position 최신화 후 저장 |
| exact 일치 + prefix/suffix 불일치 | medium | 사이드바 "확인 필요" 표시, 편집은 계속 가능 |
| exact 불일치, position 근방 유사 텍스트 발견 | low | Orphan 처리, 후보 제시 |
| 완전 실패 | — | Orphan 처리, 후보 없음 |

> Confidence는 임의의 수치가 아니라
> **exact 일치 여부(binary) + prefix/suffix 일치율(Levenshtein 거리 기반)** 조합으로 결정한다.
> 구체적 임계값은 구현 시 테스트를 통해 결정한다.

### 실시간 편집 중 앵커 재검증 (편집기 내부)
```
사용자 타이핑 발생
  -> debounce 300ms 대기
  -> Rust 백엔드: diff 계산 (변경된 텍스트 범위 파악)
  -> 영향받은 anchor만 선별적으로 재검증
  -> confidence에 따라:
       high   -> 자동 재연결, position 최신화
       medium -> 사이드바 알림, 편집 계속
       low/실패 -> Orphan 처리
  -> SVG 오버레이 재렌더링 (bounding box 재계산)
```

### Orphan 처리 4원칙
```
규칙 1: 절대 자동으로 삭제하지 않는다.
규칙 2: 절대 확신 없이 자동 재연결하지 않는다.
규칙 3: 후보가 있으면 제시하되, 최종 선택은 사용자가 한다.
규칙 4: Orphan 상태는 편집을 막지 않는다 (non-blocking).
```

### Orphan 사이드바 UI 예시
```
[!] 연결 끊긴 마킹 (2)
+-----------------------------+
| [밑줄] "사과"               |
| 삭제되었거나 수정됨          |
| 후보: "사과나무" (3번째 줄)  |
| [연결] [삭제] [나중에]       |
+-----------------------------+
```
- "연결" → 후보 anchor에 재연결
- "삭제" → 해당 annotation 영구 제거
- "나중에" → 패널에 보관, 편집 계속 가능

### 편집기 구동 시 Reconciliation 단계
파일을 열 때 1회 실행한다:
```
파일 열기
  -> content.lm 읽기
  -> memo.lmm 읽기
  -> 모든 anchor에 대해 TextQuoteSelector 검색
  -> 실패한 anchor -> Orphan 목록 추가
  -> 성공한 anchor -> position 값 최신화 후 저장
  -> 편집 시작
```

---

## 6. Semantic Rules (스키마 외 추가 검증)

JSON Schema(`lmm.schema.json`)는 각 필드의 형식과 타입만 검사한다.
아래 규칙들은 스키마로 표현 불가하거나 이중 방어가 필요하므로 `validate.js`가 별도로 검사한다.
**완전한 검증을 위해 두 가지를 모두 실행해야 한다.**

| 규칙 | 내용 |
|------|------|
| A | anchor ID는 파일 내 전역적으로 유일해야 한다 |
| B | annotation ID(note/connection의 선택적 id)도 파일 내 전역적으로 유일해야 한다 |
| C | anchor ID와 annotation ID 간에도 충돌이 없어야 한다 (전체 ID 공간이 하나) |
| D | annotation의 target/from/to/connection은 실제 존재하는 ID를 참조해야 한다 |
| E | connection의 from과 to는 같은 ID일 수 없다 |
| F | note의 `target`과 `connection` 동시 사용 금지. 스키마의 `NoteOnAnchor`/`NoteOnConnection` 분리로 구조적으로 완전 차단됨. validate.js의 Rule F는 dead code이므로 제거 가능. |
| G | highlight는 color 필드가 필수다 |
| H | bracket은 style 필드가 필수다 |
| I | connection의 from/to는 anchor ID 또는 id가 명시된 note ID만 허용한다 (connection ID 참조 불가). `floating: true`인 note도 id가 있으면 from/to로 참조 가능. |

---

## 7. 렌더러 명세

### 핵심 원칙
- `.lmm` 파일은 **"무엇을"** 만 정의한다.
- **"어떻게 그릴지"** 는 렌더러가 결정한다.
- 마크다운이 "h1의 픽셀 크기"를 CSS에 위임하는 것과 동일한 철학.

### 렌더링 파이프라인
```
content.lm 파싱
  -> 단어/문자 단위 bounding box 추출 (브라우저 Range.getClientRects() 사용)
  -> memo.lmm의 anchor를 bounding box에 매핑
  -> 텍스트 레이어 위에 투명 SVG 레이어를 오버레이
  -> annotation 타입별 SVG 요소를 Z-Index 순서대로 렌더링
  -> 폰트 크기/창 크기 변경 시 SVG 전체 재계산
```

### Z-Index (렌더링 우선순위)
같은 anchor에 여러 annotation이 붙을 때 아래 순서로 렌더링한다.
낮은 번호가 먼저 그려지므로 높은 번호가 위에 표시된다.

| 순서 | annotation | 이유 |
|------|-----------|------|
| 1 (가장 아래) | highlight | 배경색이므로 다른 요소 아래에 있어야 함 |
| 2 | underline | 텍스트 아래 선 |
| 3 | box, bracket | 텍스트를 감싸는 도형 |
| 4 | connection | 노드 간 연결선 |
| 5 (가장 위) | note | 텍스트 풍선은 항상 읽을 수 있어야 함 |

### Range.getClientRects() 사용 이유
선택된 텍스트의 모든 사각형 영역(rectangle)을 반환한다.
텍스트가 줄바꿈(line wrap)을 걸쳐 있어도 각 줄의 영역을 개별로 반환하므로,
하이라이트/밑줄이 끊기지 않고 자연스럽게 이어진다.

### 다중 줄 anchor에서 connection 연결점
anchor가 줄바꿈에 걸쳐 여러 줄에 위치할 때, connection의 시작/끝점은 다음 기준으로 결정한다:
- anchor가 차지하는 **모든 줄의 bounding box를 합집합(Union) 영역**으로 본다.
- 그 Union 영역의 **경계선 중 상대 노드와 가장 가까운 지점**을 연결점으로 사용한다.
- 이는 "최단 거리" 원칙이며, anchor가 몇 줄에 걸쳐 있든 항상 동일하게 적용된다.

### 연결선 자동 배치
- connection의 시각적 경로(베지어 곡선 등)는 렌더러가 결정한다.
- 레퍼런스 렌더러는 **elkjs** 라이브러리로 연결선 자동 배치를 구현한다.
- 같은 `from`을 가진 connection 여러 개 → 팬아웃(fan-out)으로 시각화한다.

### note 라벨 위치
- `connection` 필드가 있는 note는 해당 연결선에 붙는 라벨로 렌더링된다.
- 선의 정확히 어느 위치에 붙는지는 렌더러가 결정한다.
- 스펙이 보장하는 것은 "해당 연결선에 시각적으로 연관되어 표시된다"는 것뿐이다.

### 허공 note 위치
- `target`도 `connection`도 없는 note의 화면 위치는 렌더러가 결정한다.
- `.lmm`에 좌표를 저장하지 않는다. (LayerMark 철학: 위치 정보는 파일에 없음)
- **알려진 한계:** 노트를 닫았다가 다시 열면 허공 note의 위치가 달라질 수 있다.
  이는 버그가 아니라 의도된 트레이드오프다.

---

## 8. 기술 스택

### 레퍼런스 편집기: Tauri 데스크탑 앱

| 역할 | 기술 | 이유 |
|------|------|------|
| 앱 프레임워크 | **Tauri** | Electron 대비 메모리 1/10, 번들 수 MB |
| 백엔드 | **Rust** | 파싱/diff/reconciliation 성능 민감 |
| 프론트엔드 | **React + TypeScript** | SVG 오버레이 조작, 생태계 |
| 마크다운 파싱 | **pulldown-cmark** (Rust) | Rust 생태계 최고 수준 |
| 앵커링 | **dom-anchor-text-quote** (JS) | Hypothesis 오픈소스, W3C 호환 |
| 연결선 배치 | **elkjs** | 그래프 레이아웃 자동화 |
| YAML 파싱 | **serde-yaml** (Rust) | |

### 왜 Electron이 아닌 Tauri인가
- 메모리: Electron 수백 MB vs Tauri 수십 MB
- 번들 크기: Electron 수백 MB vs Tauri 수 MB
- 성능 민감 작업(파싱, diff)은 Rust가 JS보다 압도적으로 빠름

---

## 9. 개발 로드맵

### Phase 0 — 포맷 확정 ✅ 완료
- `.lmm` JSON Schema 작성 (`lmm.schema.json`)
- 검증 스크립트 (`validate.js`): JSON Schema + Semantic Rules 모두 적용
- `sample.lmm` (모든 케이스), `broken.lmm` (오류 케이스) 작성 및 검증 확인

> **Phase 0이 가장 중요한 이유:**
> 포맷이 바뀌면 모든 기존 파일이 무효가 된다.
> 코드는 리팩토링할 수 있지만 데이터 포맷은 하위 호환성 부채가 생긴다.

### Phase 1 — 텍스트 렌더러 (2~3주)
- Rust + Tauri 개발 환경 세팅 (Windows 기준: Rust 설치 → Visual Studio C++ Build Tools → Tauri CLI → 프로젝트 생성)
- content.lm 읽기 + 마크다운 렌더링 (h1, h2, bold, italic 등)
- 단어/문자 단위 bounding box 추출
- 텍스트 선택 → anchor 생성 → memo.lmm 저장/불러오기

### Phase 2 — 단일 anchor 마킹 (2~3주)
- SVG 오버레이 기본 구조
- underline, highlight, box, bracket 렌더링 (Z-Index 순서 준수)
- note (텍스트 풍선) 렌더링, floating note 배치
- **이 시점에서 anchor 시스템 정확도를 집중 검증**

> **Phase 2 UX 필수 원칙:**
> 마킹 생성은 드래그 종료 후 최소 동작으로 완성되어야 한다.
> 드래그 → 팝업 메뉴 → 한 번 클릭이 최대 허용 흐름이다.
> 이 원칙이 지켜지지 않으면 손필기 대비 UX 열위가 발생해 사용자가 이탈한다.
> Quick Action Bar(드래그 종료 시 즉시 나타나는 소형 메뉴)가 레퍼런스 구현 방식이다.

### Phase 3 — Orphan 관리 (1~2주)
- reconciliation 로직 구현
- Orphan 사이드바 UI
- 외부 편집기 수정 감지

> Phase 3을 Phase 4 이전에 하는 이유:
> connection은 두 anchor가 모두 유효해야 한다.
> Orphan 관리 없이 connection을 구현하면 한쪽 anchor가 깨졌을 때 처리 로직이 얽힌다.

### Phase 4 — connection 렌더링 (3~4주)
- connection 렌더링 (solid/dashed, none/one-way/two-way)
- elkjs로 연결선 자동 배치
- 팬아웃 시각화
- 다중 줄 anchor 연결점 처리

### Phase 5 — 번들링 & 내보내기 (1주)
- .lmb 패키징 (zip: content.lm + memo.lmm + assets/)
- 순수 마크다운으로 내보내기 (memo 레이어는 주석으로 첨부하거나 제거)

---

## 10. 예상 문제점 및 해결 방향

### 문제 1: 조사("은/는/이/가") 단일 글자 anchor
**상황:** `exact: "은"` 처럼 한 글자인 경우 prefix/suffix 충돌 가능성.
**해결:** anchor 생성 시 prefix/suffix 길이 결정 로직(섹션 3 참고)으로 대응.
최대 64 코드 포인트까지 연장 후에도 구별 불가 시 position fallback 사용.
실제 충돌 시 Orphan 처리.

### 문제 2: Orphan 누적
**상황:** 노트를 많이 수정할수록 Orphan이 쌓인다.
**해결:** Non-blocking Orphan 패널. 사용자가 원할 때 처리하면 된다. 절대 자동 삭제하지 않는다.

### 문제 3: 번들(.lmb) 폐쇄성
**상황:** .lmb(zip)를 Obsidian 등 외부 툴이 읽지 못한다.
**해결:** 평소에는 폴더 구조 유지(Git 호환). "공유하기" 시에만 .lmb로 자동 패키징.

### 문제 4: 렌더러 간 표현 불일치
**상황:** 렌더러마다 화살표/연결선 모양이 달라 같은 파일이 다르게 보인다.
**해결:** 초기엔 감수한다. 생태계 성숙 후 "최소 렌더링 가이드라인" 스펙을 작성한다.

### 문제 5: 실시간 편집 성능
**상황:** 타이핑마다 bounding box를 재계산하면 버벅임.
**해결:** debounce 300ms. 타이핑 중에는 마킹을 마지막 위치에 고정. 멈춘 후 재계산.

### 문제 6: note 내부 필기
**상황:** 메모 풍선 안의 텍스트에 또 밑줄을 긋고 싶은 경우.
**해결:** v1.0 미구현. v2.0 이후 검토.

---

## 11. 사용자 선택권 설계 원칙

**"결정은 시스템이, 확인은 사용자가"**

| 자동 처리 (사용자 개입 없음) | 사용자가 확인/결정 |
|---|---|
| anchor ID 8자리 CSPRNG 생성 | Orphan 재연결 또는 삭제 |
| prefix/suffix 길이 결정 (32→64 자동 연장) | anchor의 텍스트 선택 범위 |
| 공유 시 폴더→.lmb 자동 패키징 | memo 레이어 on/off 토글 |
| 연결선 렌더링 방식, Z-Index 순서 | 내보내기 형식 선택 |
| confidence 판정 | medium confidence 시 재연결 확인 |

---

## 12. 수요층 및 시장성

### 주요 수요층
- 마크다운 기반 노트 사용자 (Obsidian, Notion, Logseq 사용자)
- 손필기 노트앱(GoodNotes, Notability)에서 타이핑 노트로 전환하고 싶은 사용자
- 개념 간 관계를 시각화하며 공부하는 학생/연구자
- 기술 문서에 관계 마킹이 필요한 개발자/작가

### 차별점
| 경쟁 제품 | 한계 |
|---|---|
| Obsidian Canvas | 문서 간 관계는 표현하지만 문장 속 특정 단어 단위 연결 불가 |
| OneNote | 타이핑/손필기 통합 시도했으나 캔버스 위 텍스트박스 방식으로 타이핑 선형성 훼손 |
| Hypothesis | 웹 페이지 annotation에 특화, 로컬 마크다운 편집 워크플로우와 맞지 않음 |
| **LayerMark** | 타이핑의 선형성 유지 + 단어 단위 마킹/연결 = 현재 공백 영역 |

### 시장성 조건
포맷 자체보다 **레퍼런스 렌더러의 품질**이 채택을 결정한다.
"연결선이 예쁘게 자동 배치된다"는 것을 보여주는 데모 없이는 확산이 어렵다.

---

## 13. 미래 발전 방향 (v2.0 이후)

### 단기 추가 기능 후보
- **note 내부 필기:** 메모 풍선 안에도 anchor/annotation 허용 (재귀 구조)
- **렌더링 가이드라인:** CommonMark처럼 최소 렌더링 스펙 문서화
- **모바일 지원:** Tauri 모바일 빌드 또는 별도 iOS/Android 앱

### 중기 발전 방향
- **AI 연동:** `.lmm`의 connection 정보를 LLM이 읽어 문서의 논리 구조 자동 파악
- **협업:** CRDT 기반 실시간 동시 편집 (현재는 last-write-wins)
- **웹 클라이언트:** 브라우저 기반 렌더러
- **크로스 파일 앵커링:** 서로 다른 `.lm` 파일 간 connection 지원.
  **⚠️ 포맷 변경 필요:** 현재 anchor ID는 파일 내에서만 유일하면 된다.
  크로스 파일 참조를 위해서는 ID 범위를 전역으로 확장해야 하며, 두 가지 방향이 있다.
  (1) `파일경로/anchorID` 형식의 네임스페이스 도입 — 하위 호환 가능
  (2) 파일 간 관계를 별도 `.lmg`(LayerMark Graph) 파일로 분리 — 기존 포맷 무변경
  v2.0 진입 전에 이 중 하나를 확정해야 한다.

### 장기 비전
LayerMark가 "마킹 레이어를 가진 마크다운"으로 생태계를 형성.
Obsidian, Logseq 등이 `.lmm` 포맷을 플러그인으로 지원하는 것이 목표.

---

## 14. 현재 구현 상태 (Phase 0 완료 시점 기준)

| 항목 | 상태 |
|------|------|
| `.lmm` JSON Schema (`lmm.schema.json`) | ✅ 확정 |
| 검증 스크립트 (`validate.js`) | ✅ 작동 확인 |
| `sample.lmm` (모든 케이스 포함) | ✅ 작성 완료 |
| `broken.lmm` (오류 케이스 테스트) | ✅ 작성 완료 |
| Tauri 프로젝트 세팅 | ✅ Phase 1 완료 |
| 텍스트 렌더러 | ✅ Phase 1 완료 |
| SVG 오버레이 | ✅ Phase 2 완료 |
| Orphan 관리 UI | ⬜ Phase 3 |
| Connection 렌더링 | ⬜ Phase 4 |

## GitHub

- Repo: https://github.com/kyb65/layermark
- Remote: origin → https://github.com/kyb65/layermark.git
- Branch: master
- Credential: Windows Credential Manager (git:https://github.com)
| 번들링(.lmb) | ⬜ Phase 5 |

## Phase 2 UX 핫픽스 (2026-05)

- 앵커 ghost 표시: annotation 없는 앵커 → 반투명 배경 + 점선 밑줄
- 드래그 후 annotation 메뉴 자동 오픈 (range.getBoundingClientRect() 기준)
- 검증 완료: 실기기에서 전체 annotation 타입 정상 작동 확인

---

## 15. 다음 세션 시작 방법

### 시작 방법 (파일 첨부 불필요)

새 세션에서 아래 한 마디만 하면 된다:

> "phase N 수행해줘."

Claude가 PowerShell MCP를 통해 아래를 자동으로 수행한다:

```
1. git log --oneline                         # 현재까지 커밋 히스토리 파악
2. Get-Content LAYERMARK_CONTEXT.md          # 전체 설계 결정 및 현재 Phase 파악
3. Get-Content LAYERMARK_CONTEXT.md의 spec/lmm.schema.json 경로 확인 후 읽기
4. Get-Content CHANGELOG.md                  # 직전 Phase 완료 내용 파악
5. git status                                # 미커밋 변경사항 파악
```

파일을 첨부하거나 별도 설명 없이 바로 작업을 시작할 수 있다.

### 프로젝트 경로
`C:\Users\kybna\layermark`

### Phase별 시작 한 마디
| Phase | 시작 방법 |
|-------|-----------|
| Phase 2 | "phase 2 수행해줘" |
| Phase 3 | "phase 3 수행해줘" |
| Phase 4 | "phase 4 수행해줘" |
| Phase 5 | "phase 5 수행해줘" |

### Claude가 세션 시작 시 반드시 수행하는 것
1. PowerShell MCP로 위 5개 명령 실행해 컨텍스트 파악
2. 현재 Phase 목표와 알려진 한계 확인
3. 작업 시작 전 간단한 계획 요약 후 진행
4. 세션 종료 시: CHANGELOG.md 업데이트 → LAYERMARK_CONTEXT.md 상태 표 업데이트 → 커밋
