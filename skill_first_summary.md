# Skill Content Protection from Context Compaction

> 압축(compaction) 시 스킬 콘텐츠(`<skill_content>` 태그 포함 toolResult)를 보호하여,
> 압축 후에도 스킬 지시사항이 유실되지 않도록 하는 기능의 설계 문서.

---

## 1. 배경

### 1.1 Agent Skills 스펙 요구사항

https://agentskills.io/client-implementation/adding-skills-support#protect-skill-content-from-context-compaction

> "exempt skill content from pruning. Skill instructions are durable behavioral guidance —
> losing them mid-conversation silently degrades the agent's performance without any visible error."
>
> - Flag skill tool outputs as protected so the pruning algorithm skips them
> - Use the structured tags from Step 4 to identify skill content and preserve it during compaction

### 1.2 현재 pi의 문제

- 압축 시 모든 메시지가 동등하게 취급됨 — 스킬 콘텐츠에 대한 보호 메커니즘 없음
- `<skill_content>` 태그로 스킬 콘텐츠는 이미 식별 가능하나, 압축 로직이 이를 인식하지 못함
- 스킬 콘텐츠가 컷포인트 이전에 있으면 요약 대상이 되어 원문 유실
- 요약 시 `serializeConversation()`이 toolResult를 2000자로 잘라버림

---

## 2. 핵심 설계 결정

### 2.1 스킬 콘텐츠는 "참고자료"이지 "사건"이 아니다

- 스킬의 **활성화** (activate_skill toolCall) → 사건 (narrative) → 요약에 포함
- 스킬의 **내용** (`<skill_content>` toolResult) → 참고자료 (reference) → 원문 보존

비유: 소설책 본문에 "마법서를 펼쳤다" (사건) + 부록에 "화염 주문 시전 방법" (참고자료).
부록이 본문 중간에 끼어들 필요 없음.

### 2.2 toolResult → user 메시지 변환

toolResult는 앞의 toolCall과 반드시 짝을 이루어야 함 (LLM API 스펙).
toolCall 없이 toolResult만 남기면 API 에러 발생.

해결: 보호된 스킬 toolResult를 **user 메시지로 변환**하여 재주입.
그러면 toolCall 의존성이 사라짐.

이미 pi가 같은 패턴 사용 중:
- `bashExecution` → user 메시지로 변환
- `custom` → user 메시지로 변환
- `branchSummary` → user 메시지 + `<summary>` 태그
- `compactionSummary` → user 메시지 + `<summary>` 태그

### 2.3 우선순위 기반 예산 할당

예산은 유한하므로, 스킬이 무한정 들어갈 수는 없음.

```
P1 (보호): 스킬 콘텐츠 — 예산 먼저 차지
P2 (일반): 일반 메시지 — P1 남은 예산으로

같은 우선순위 내에서는 최근이 우선 (오래된 것부터 버림)
```

P1이 예산 초과 시, 가장 오래된 P1부터 P2로 강등 (요약 대상이 됨).

### 2.4 요약 프롬프트 수정 불필요

스킬 콘텐츠는 `messagesToSummarize`에서 이미 빠져있으므로,
요약 LLM이 애초에 스킬 내용을 볼 수 없음.
"스킬 내용은 요약하지 마" 같은 지시 불필요.

### 2.5 서라(타임라인) 꼬임 문제

```
원본: [메시지1] → [스킬활성화] → [메시지2]

압축 후: [요약(메시지1+2)] → [스킬 내용(user 메시지)]
```

요약이 "PDF 스킬을 활성화했다"고 말하고, 스킬 내용이 뒤에 나옴.
→ 스킬 내용은 참고자료이므로 부록처럼 뒤에 있어도 자연스러움.
→ 요약이 스킬 활성화 사건을 담당, 스킬 내용은 참고자료로 별도 보존.

---

## 3. 알고리즘 상세

### 3.1 전체 흐름

```
prepareCompaction()
  ├── ① messagesToSummarize에서 P1(스킬) 메시지 식별 & 추출
  ├── ② P1을 최근순 정렬, 예산 내에서 채움
  │     └── 초과분은 P2로 강등
  ├── ③ P1 예산 차감 후 남은 예산으로 P2 컷포인트 계산
  │     └── 기존 findCutPoint() 로직 그대로 사용
  ├── ④ P1 메시지를 toolResult → user 메시지로 변환
  └── ⑤ CompactionResult에 변환된 스킬 내용 포함

compact()
  └── 기존 요약 생성 로직 그대로 (P1은 이미 빠져있음)

buildSessionContext()
  └── compactionSummary 뒤에 변환된 P1(user 메시지) 삽입
```

### 3.2 P1 식별 기준

toolResult 메시지 중 content가 `<skill_content` 태그로 시작하는 것.

```ts
function isSkillContent(message: AgentMessage): boolean {
  if (message.role !== "toolResult") return false;
  const text = message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");
  return text.trimStart().startsWith("<skill_content");
}
```

### 3.3 P1 예산 할당 알고리즘

```
입력: entries[], keepRecentTokens

1. P1 메시지 목록 수집 (인덱스 역순 = 최근순)
2. p1Budget = keepRecentTokens
3. protectedSkills = []  // 보호될 스킬 목록
4. demotedSkills = []    // P2로 강등될 스킬 목록

for each P1 메시지 (최근순):
  tokens = estimateTokens(message)
  if tokens <= p1Budget:
    protectedSkills.push(message)
    p1Budget -= tokens
  else:
    demotedSkills.push(message)  // P2로 강등

5. p2Budget = p1Budget  // P1 차감 후 남은 예산
6. P2 컷포인트 계산: findCutPoint(entries, boundaryStart, boundaryEnd, p2Budget)
```

### 3.4 P1 메시지 변환 (toolResult → user 메시지)

```ts
// 변환 전 (toolResult):
{
  role: "toolResult",
  toolCallId: "abc123",
  toolName: "activate_skill",
  content: [
    { type: "text", text: "<skill_content name=\"pdf-processing\">\n...\n</skill_content>" }
  ]
}

// 변환 후 (user 메시지):
{
  role: "user",
  content: [
    { type: "text", text: "<skill_content name=\"pdf-processing\">\n...\n</skill_content>" }
  ],
  timestamp: <원본 타임스탬프>
}
```

toolCallId, toolName 등 toolResult 전용 필드 제거.
content는 그대로 보존 (이미 `<skill_content>` 태그로 래핑되어 있음).

### 3.5 압축 후 컨텍스트 재구성

```
[systemPrompt]
[compactionSummary (user 메시지)]  ← "스킬 활성화했다"는 사건 포함
[P1 스킬_A (user 메시지)]          ← 참고자료 (최근순)
[P1 스킬_B (user 메시지)]          ← 참고자료
[P2 보존 메시지들]                  ← 기존 순서대로
```

---

## 4. 수정해야 할 파일 목록

### 4.1 `packages/coding-agent/src/core/compaction/compaction.ts`

**변경 내용:**

- `isSkillContent()` 헬퍼 함수 추가 — toolResult에서 `<skill_content>` 태그 식별
- `prepareCompaction()` 수정:
  - P1(스킬) 메시지 식별 & 추출 로직 추가
  - P1 예산 할당 (최근순, 예산 내 채움, 초과분 P2 강등)
  - P2 예산 = keepRecentTokens - P1 사용량
  - `findCutPoint()` 호출 시 P2 예산 전달
  - `CompactionPreparation`에 `protectedSkillMessages` 필드 추가
- `CompactionPreparation` 인터페이스 수정:
  ```ts
  export interface CompactionPreparation {
    // ... 기존 필드 ...
    /** P1: 보호된 스킬 메시지 (toolResult → user 변환 전) */
    protectedSkillMessages: AgentMessage[];
    /** P2로 강등된 스킬 메시지 (요약 대상에 포함) */
    demotedSkillMessages: AgentMessage[];
    /** P1에 사용된 토큰 예산 */
    skillTokensUsed: number;
  }
  ```
- `compact()` 수정:
  - P1 메시지를 toolResult → user 메시지로 변환
  - `CompactionResult`에 변환된 스킬 내용 포함
- `CompactionResult` 인터페이스 수정:
  ```ts
  export interface CompactionResult<T = unknown> {
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: T;
    /** 보호된 스킬 콘텐츠 (toolResult → user 메시지로 변환됨) */
    protectedSkillMessages?: AgentMessage[];
  }
  ```

### 4.2 `packages/coding-agent/src/core/session-manager.ts`

**변경 내용:**

- `CompactionEntry` 인터페이스 수정:
  ```ts
  export interface CompactionEntry<T = unknown> extends SessionEntryBase {
    type: "compaction";
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: T;
    fromHook?: boolean;
    /** 보호된 스킬 콘텐츠 (toolResult → user 메시지로 변환됨) */
    protectedSkillMessages?: AgentMessage[];
  }
  ```
- `appendCompaction()` 메서드 수정 — `protectedSkillMessages` 파라미터 추가 및 저장
- `buildSessionContext()` 수정:
  - compaction 엔트리에 `protectedSkillMessages`가 있으면,
    compactionSummary 메시지 바로 뒤에 스킬 user 메시지들 삽입
  ```ts
  if (compaction) {
    // 1. compactionSummary
    messages.push(createCompactionSummaryMessage(...));

    // 2. 보호된 스킬 메시지 삽입 (추가)
    if (compaction.protectedSkillMessages) {
      for (const skillMsg of compaction.protectedSkillMessages) {
        messages.push(skillMsg);
      }
    }

    // 3. kept messages (기존 로직)
    // 4. messages after compaction (기존 로직)
  }
  ```

### 4.3 `packages/coding-agent/src/core/agent-session.ts`

**변경 내용:**

- `compact()` 메서드 — `CompactionResult`에서 `protectedSkillMessages`를 꺼내서
  `sessionManager.appendCompaction()`에 전달
- `_runAutoCompaction()` — 동일하게 `protectedSkillMessages` 전달
- 확장 프로그램 `session_before_compact` 훅에서 커스텀 compaction 제공 시
  `protectedSkillMessages` 처리 로직 필요

### 4.4 `packages/coding-agent/src/core/compaction/utils.ts`

**변경 내용 (선택적):**

- `serializeConversation()` — P2로 강등된 스킬 메시지가 요약 대상에 포함될 경우,
  `<skill_content>` 태그 내용은 2000자 제한(`TOOL_RESULT_MAX_CHARS`)에 걸리지 않도록
  예외 처리 고려. (강등 = 어차피 요약되므로 크게 중요하지 않음)
- **큰 변경 필요 없을 가능성 높음** — 강등된 스킬은 일반 toolResult로 취급

### 4.5 `packages/coding-agent/src/core/messages.ts`

**변경 내용 (선택적):**

- `convertToLlm()` — 변환된 스킬 user 메시지가 이미 user role이므로 추가 변환 불필요
- **큰 변경 필요 없음** — 변환된 메시지는 일반 user 메시지로 처리됨

### 4.6 `packages/coding-agent/src/core/extensions/types.ts`

**변경 내용:**

- `SessionBeforeCompactEvent.preparation` 타입이 `CompactionPreparation`이므로
  `protectedSkillMessages` 필드가 자동으로 확장 프로그램에 노출됨
- 확장 프로그램이 `compaction` 커스텀 결과 제공 시 `protectedSkillMessages` 포함 가능하도록
  `CompactionResult` 인터페이스에 필드 추가 (4.1에서 이미 반영)

---

## 5. 고려사항 & 문제 될 만한 것들

### 5.1 세션 파일 포맷 호환성

`CompactionEntry`에 `protectedSkillMessages` 필드가 추가됨.
기존 세션 파일에는 이 필드가 없음.

- `buildSessionContext()`에서 `compaction.protectedSkillMessages` 접근 시
  `undefined` 체크 필수 (optional 필드이므로 자연스럽게 처리 가능)
- 기존 세션 파일 역호환성 문제 없음 — 필드가 없으면 스킬 보호 없이 기존 동작

### 5.2 P1 예산 초과 시나리오

스킬이 많거나 스킬 내용이 길면 P1만으로 예산 초과 가능.

```
keepRecentTokens = 20000
스킬 A: 8000토큰
스킬 B: 8000토큰
스킬 C: 8000토큰
P1 합계 = 24000 > 20000
```

→ 스킬 C(가장 오래됨)가 P2로 강등 → 요약 대상
→ 스킬 C의 내용이 유실됨

**완화 방안 (선택적):**
- `skillReserveTokens` 설정 추가 — 스킬 전용 예산을 별도로 관리
- 기본값: keepRecentTokens의 50% 또는 별도 설정값
- 스킬이 예산을 너무 많이 차지하면 일반 메시지 보존량이 줄어드는 트레이드오프 존재

### 5.3 스킬 활성화 toolCall 처리

P1 스킬 toolResult를 추출하면, 앞의 assistant toolCall(activate_skill)은
`messagesToSummarize`에 남음. toolCall 없이 toolResult가 없는 상태.

요약 LLM이 보는 직렬화 결과:
```
[Assistant tool calls]: activate_skill(name="pdf-processing")
```

toolResult가 없으므로 요약 LLM은 "스킬을 호출했지만 결과를 볼 수 없음" 상태.
→ 자연스럽게 "pdf-processing 스킬을 활성화했다" 정도로 요약할 것.
→ 문제없음. 요약 프롬프트 수정 불필요 (2.4에서 결정).

### 5.4 연속 toolResult 그룹 처리

하나의 assistant 메시지가 여러 toolCall을 포함할 수 있음.
그 중 일부만 스킬일 경우:

```
[assistant] toolCall: activate_skill(name="A"), toolCall: read(path="x.ts")
[toolResult] <skill_content name="A">   ← P1
[toolResult] 파일 내용...               ← P2
```

P1만 추출하고 P2 toolResult는 그대로 두면,
요약 시 toolCall(read) + toolResult(파일 내용)는 정상적으로 요약됨.
P1 toolResult만 빠지므로 요약 LLM은 activate_skill의 결과를 못 보지만,
read의 결과는 볼 수 있음.

→ 문제없음. 다만 `serializeConversation()`에서 toolResult 순서가
toolCall 순서와 매칭되는지 확인 필요 (현재 로직에서는 toolCallId로 매칭).

### 5.5 확장 프로그램 session_before_compact 훅

확장 프로그램이 `session_before_compact` 훅에서 커스텀 `CompactionResult`를 제공할 경우,
`protectedSkillMessages`를 포함하지 않으면 스킬 보호가 무시됨.

**해결 방안:**
- 확장 프로그램이 `compaction` 결과를 제공하지 않으면 (기본 경로),
  pi가 자동으로 P1 보호 로직 실행
- 확장 프로그램이 `compaction` 결과를 제공하면,
  `protectedSkillMessages` 포함 여부는 확장 프로그램 책임
- 문서화 필요: 확장 프로그램 개발자에게 스킬 보호 필드 설명

### 5.6 branch-summarization.ts와의 관계

브랜치 요약 시에도 스킬 콘텐츠가 유실될 수 있음.
현재 논의는 compaction에 한정되지만, 장기적으로는
`branch-summarization.ts`의 `prepareBranchEntries()`에서도
P1 보호 로직 적용 고려.

→ **1차 구현에서는 compaction만 처리, branch summarization은 후순위**

### 5.7 스킬 메시지의 timestamp

변환된 user 메시지는 원본 toolResult의 timestamp를 유지해야 함.
그래야 `buildSessionContext()`에서 메시지 순서 정렬 시 올바른 위치에 배치됨.

### 5.8 중복 스킬 활성화

같은 스킬이 여러 번 활성화될 수 있음 (예: 세션 중 스킬 내용이 변경되어 재활성화).
P1 보호 시 최근 활성화만 보존하면 됨 (우선순위 알고리즘이 자동 처리).
같은 스킬의 오래된 활성화는 P2로 강등되어 요약됨.

→ **중복 제거 로직은 불필요** — 우선순위 알고리즘이 자연스럽게 처리

---

## 6. 구현 순서 (권장)

### Phase 1: 핵심 로직

1. **`compaction.ts`** — `isSkillContent()` 헬퍼 추가
2. **`compaction.ts`** — `prepareCompaction()`에 P1 식별 & 예산 할당 로직 추가
3. **`compaction.ts`** — `CompactionPreparation` 인터페이스에 `protectedSkillMessages` 필드 추가
4. **`compaction.ts`** — `compact()`에서 P1 메시지를 toolResult → user 메시지로 변환
5. **`compaction.ts`** — `CompactionResult`에 `protectedSkillMessages` 필드 추가

### Phase 2: 세션 관리

6. **`session-manager.ts`** — `CompactionEntry`에 `protectedSkillMessages` 필드 추가
7. **`session-manager.ts`** — `appendCompaction()` 파라미터 추가
8. **`session-manager.ts`** — `buildSessionContext()`에서 스킬 메시지 재주입 로직 추가

### Phase 3: 세션 연동

9. **`agent-session.ts`** — `compact()` / `_runAutoCompaction()`에서 `protectedSkillMessages` 전달
10. **`agent-session.ts`** — 확장 프로그램 훅 결과와 P1 보호 로직 통합

### Phase 4: 테스트

11. 기존 테스트 파일들에 스킬 보호 시나리오 추가:
    - `compaction.test.ts` — P1 식별, 예산 할당, 강등 로직 단위 테스트
    - `agent-session-compaction.test.ts` — 통합 테스트
    - `compaction-extensions.test.ts` — 확장 프로그램 훅과의 상호작용 테스트
12. 시나리오 테스트:
    - 스킬 1개 보호 (정상 케이스)
    - 스킬 여러 개 보호 (P1 예산 내)
    - 스킬 예산 초과 (가장 오래된 스킬 강등)
    - 스킬 + 일반 메시지 혼합 (P1/P2 예산 분배)
    - 기존 세션 파일 역호환성 (protectedSkillMessages 없는 세션)
    - 확장 프로그램 커스텀 compaction과의 상호작용

---

## 7. 소스 코드 참조

| 파일 | 경로 | 역할 |
|---|---|---|
| compaction.ts | `packages/coding-agent/src/core/compaction/compaction.ts` | 메인 압축 로직. findCutPoint, prepareCompaction, compact, generateSummary |
| utils.ts | `packages/coding-agent/src/core/compaction/utils.ts` | 파일 조작 추적, 대화 직렬화, SUMMARIZATION_SYSTEM_PROMPT |
| branch-summarization.ts | `packages/coding-agent/src/core/compaction/branch-summarization.ts` | 브랜치 요약 (후순위) |
| session-manager.ts | `packages/coding-agent/src/core/session-manager.ts` | CompactionEntry, buildSessionContext, appendCompaction |
| agent-session.ts | `packages/coding-agent/src/core/agent-session.ts` | compact(), _runAutoCompaction(), 확장 프로그램 훅 연동 |
| messages.ts | `packages/coding-agent/src/core/messages.ts` | convertToLlm, CompactionSummaryMessage, COMPACTION_SUMMARY_PREFIX |
| types.ts | `packages/coding-agent/src/core/extensions/types.ts` | SessionBeforeCompactEvent, CompactionPreparation, CompactionResult |

---

## 8. 현재 압축 아키텍처 요약 (참고용)

### 8.1 시스템 프롬프트는 messages[] 밖에 있음

```
AgentState {
  systemPrompt: string;    ← 별도 필드. 압축 영향 안 받음
  messages: AgentMessage[]; ← user/assistant/toolResult/custom/...
}
```

LLM 호출 시: `systemPrompt`는 별도 전달, `messages[]`만 변환해서 전달.

### 8.2 컷포인트 로직

```
findCutPoint(entries, startIndex, endIndex, keepRecentTokens)
  → 뒤에서부터 토큰 누적
  → keepRecentTokens(기본 20000) 넘으면 컷 포인트 결정
  → 컷 이전: messagesToSummarize (요약 후 원본 폐기)
  → 컷 이후: 그대로 유지
```

### 8.3 압축 후 컨텍스트 재구성

```
buildSessionContext() 결과:
  [compactionSummary (user)] → [kept messages] → [after compaction messages]

CompactionEntry:
  summary: string
  firstKeptEntryId: string  ← 단일 분기점 (연속 보존 영역)
```

### 8.4 자동 압축 트리거

```
shouldCompact(): contextTokens > contextWindow - reserveTokens(16384)
_checkCompaction(): 매 어시스턴트 응답 후 체크
  - Case 1: 오버플로우 에러 → 즉시 압축 + 재시도
  - Case 2: 임계값 초과 → 압축 실행
```

### 8.5 확장 프로그램 훅

```
session_before_compact:
  입력: CompactionPreparation, branchEntries, customInstructions, signal
  출력: { cancel?: boolean, compaction?: CompactionResult }

session_compact:
  입력: CompactionEntry, fromExtension
  출력: 없음 (알림용)
```