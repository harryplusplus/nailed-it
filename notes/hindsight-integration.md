# Hindsight × Pi Extension — 설계 및 구현 노트

## 1. 목적

Pi 에이전트에 장기 기억을 부여한다. 세션 간, 턴 간 맥락을 유지하고, 과거 대화에서 추출한 사실/패턴을 자동으로 환기시켜 응답 품질을 높인다.

---

## 2. 핵심 설계 결정

### 2.1 에이전트 → Bank 매핑

| 개념           | 값                                                       |
| -------------- | -------------------------------------------------------- |
| 에이전트 ID    | `NI_AGENT_ID` 환경변수 (예: `coding`, `research`) |
| Hindsight Bank | `pi-{agentId}` (예: `pi-coding`, `pi-research`)          |
| Document ID    | `session:{sessionId}` (세션별 대화 구분, upsert 단위)    |

- **1 에이전트 = 1 Hindsight Bank**. 같은 에이전트의 모든 세션이 기억을 공유.
- 세션이 달라도 같은 bank → 과거 세션에서 학습한 팩트가 자동으로 recall됨 = **진짜 장기 기억**.
- `document_id = session:{sessionId}` → 같은 세션은 upsert(최신 상태), 다른 세션은 별도 document(과거 대화 보존).
- 에이전트 ID는 환경변수로 주입 → Pi 실행 시 목적에 맞게 선택.

**세션 단위 bank를 배제한 이유:**

- 세션마다 bank를 나누면 세션 종료 후 기억이 고립 → 장기 기억의 의미 상실.
- 에이전트 단위 bank가 기억 축적과 cross-session recall 모두에 유리.

### 2.2 Recall: 사용자 메시지 도착 시

**훅 지점:** `before_agent_start`

```
사용자 입력 → before_agent_start → recall(query) → systemPrompt에 주입 → LLM 호출
```

**Recall 쿼리 구성:**

```typescript
const recallQuery = [
  userMessage, // 현재 사용자 입력 (핵심)
  recentAssistantSummary, // 직전 어시스턴트 응답 요약 (선택)
]
  .filter(Boolean)
  .join('\n')
```

- 사용자 입력만으로도 충분할 수 있으나, 직전 턴의 맥락이 있으면 recall 정확도 향상.
- **튜닝 포인트:** recall 쿼리에 얼마나 많은 컨텍스트를 포함할지는 상수로 제어.

**주입 위치:** `systemPrompt` 끝에 섹션 추가

```
## Recalled Memories
{recall 결과를 recallResponseToPromptString()으로 포맷}
```

- systemPrompt에 넣는 이유: 모든 턴에서 일관되게 참조 가능, 사용자 프롬프트에 넣으면 매 턴마다 반복 노출.
- recall 결과가 없으면 섹션 자체를 생략 (프롬프트 낭비 방지).

### 2.3 Retain: 어시스턴트 응답 완료 시

**훅 지점:** `agent_end`

```
agent_end → 세션 메시지 필터링 → 포맷 → retain(bankId, content, { documentId: session:{sessionId} })
```

**Upsert 전략:** `document_id = session:{sessionId}`

- 같은 세션에서 매 agent_end마다 전체 대화를 upsert.
- Hindsight가 기존 문서를 삭제하고 재처리 → 항상 최신 상태.
- 중복 팩트 없음.
- 다른 세션의 대화는 별도 document로 보존 → 과거 세션의 팩트도 recall 대상.

**메시지 필터링 — 유의미한 것만 retain:**

| 포함                          | 제외                                             |
| ----------------------------- | ------------------------------------------------ |
| `user` 메시지 (텍스트)        | `toolResult` (파일 내용, 명령어 출력 등)         |
| `assistant` 메시지 (텍스트만) | `bashExecution`                                  |
|                               | `thinking` content block                         |
|                               | `image` content block                            |
|                               | `custom` / `compactionSummary` / `branchSummary` |

필터링 이유:

- toolResult는 대부분 파일 내용/명령어 출력 → 팩트 추출에 노이즈.
- thinking은 내부 추론 → 사용자 의도와 무관.
- 이미지는 텍스트로 변환 비용 > 가치.

**포맷:** Hindsight 권장 대화 포맷 사용

```
User (2024-03-15T09:00:00Z): 안녕하세요
Assistant (2024-03-15T09:01:00Z): 안녕하세요! 무엇을 도와드릴까요?
User (2024-03-15T09:02:00Z): 오늘 날씨 어때?
Assistant (2024-03-15T09:03:00Z): 현재 서울은 맑음입니다...
```

### 2.4 타임아웃 & 취소

**문제:** recall/retain이 AI 에이전트 요청을 블로킹함. 타임아웃 없으면 Pi 전체가 멈침.

**해결:** 저수준 SDK + AbortController

```typescript
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), RECALL_TIMEOUT_MS)

// Pi의 cancel signal도 연동
if (ctx.signal) {
  ctx.signal.addEventListener('abort', () => controller.abort())
}

try {
  const response = await sdk.recallMemories({
    client: internalClient,
    path: { bank_id: bankId },
    body: { query, budget: RECALL_BUDGET, max_tokens: RECALL_MAX_TOKENS },
    signal: controller.signal,
  })
  // ...
} finally {
  clearTimeout(timeoutId)
}
```

**타임아웃 시 동작:**

- recall: 빈 결과 반환 (프롬프트에 "Recalled Memories" 섹션 생략) → 에이전트는 기억 없이 계속 진행.
- retain: 조용히 실패 (다음 턴에 재시도됨) → 에이전트 동작에 영향 없음.

---

## 3. 설정 상수 (최상단 튜닝)

```typescript
// ─── Hindsight Connection ───
const HINDSIGHT_BASE_URL =
  process.env.HINDSIGHT_API_URL ?? 'http://localhost:8888'
const HINDSIGHT_API_KEY = process.env.HINDSIGHT_API_KEY

// ─── Recall ───
const RECALL_TIMEOUT_MS = 10_000 // recall 타임아웃 (ms)
const RECALL_BUDGET: Budget = 'mid' // 'low' | 'mid' | 'high'
const RECALL_MAX_TOKENS = 4096 // recall 결과 최대 토큰
const RECALL_ENABLED = true // recall on/off

// ─── Retain ───
const RETAIN_TIMEOUT_MS = 30_000 // retain 타임아웃 (ms)
const RETAIN_ENABLED = true // retain on/off
const RETAIN_ASYNC = false // true면 백그라운드 처리 (빠르지만 즉시 검색 불가)

// ─── Agent / Bank ───
const BANK_ID_PREFIX = 'pi-' // bank ID 접두사
const DEFAULT_AGENT_ID = 'coding' // NI_AGENT_ID 미설정 시 기본값
const AGENT_PROFILES: Record<string, AgentProfile> = {
  coding: {
    mission:
      'I am a persistent memory for a coding assistant. I remember user preferences, project context, past decisions, and conversation history across sessions.',
    disposition: { skepticism: 2, literalism: 2, empathy: 3 },
  },
  research: {
    mission:
      'I am a persistent memory for a research assistant. I remember research topics, findings, source quality, and user interests across sessions.',
    disposition: { skepticism: 4, literalism: 3, empathy: 2 },
  },
}

// ─── Prompt Injection ───
const RECALL_PROMPT_HEADER = '## Recalled Memories'
```

---

## 4. 동적 필드 — 에이전트별 Bank 분리

### 4.1 문제 인식

Pi를 여러 목적(코딩, 리서치, 글쓰기 등)으로 사용하는 경우, 단일 bank에 모든 기억을 넣으면:

- 코딩 관련 팩트와 글쓰기 팩트가 섞임 → recall 노이즈 증가.
- 행위 목적마다 기억의 "뾰족함(sharpness)"이 흐려짐.

### 4.2 해결: 에이전트 ID = Bank ID

에이전트 ID를 환경변수 `NI_AGENT_ID`로 받아 bank ID를 구성:

```
NI_AGENT_ID=coding  →  bank: pi-coding
NI_AGENT_ID=research →  bank: pi-research
```

같은 에이전트 ID로 실행한 모든 Pi 세션이 같은 bank를 공유 → 장기 기억 축적.

### 4.3 에이전트 프로필

`AGENT_PROFILES` 상수에 에이전트별 mission/disposition 정의. `NI_AGENT_ID`가 프로필에 없으면 기본값으로 bank 생성.

```bash
# 코딩 에이전트로 Pi 실행
NI_AGENT_ID=coding pi

# 리서치 에이전트로 Pi 실행
NI_AGENT_ID=research pi
```

### 4.4 Cross-Bank Recall (향후)

여러 에이전트 bank에서 동시에 recall하려면 병렬 호출:

```typescript
const [codingMemories, researchMemories] = await Promise.all([
  recallFromBank('pi-coding', query),
  recallFromBank('pi-research', query),
])
```

Hindsight는 현재 multi-bank 쿼리를 네이티브 지원하지 않음. 필요시 병렬 호출로 해결.

---

## 5. 이벤트 훅 매핑

| Pi 이벤트            | 동작                       | Hindsight API             |
| -------------------- | -------------------------- | ------------------------- |
| `session_start`      | bank 생성/확인             | `createBank` (idempotent) |
| `before_agent_start` | recall → systemPrompt 주입 | `sdk.recallMemories`      |
| `agent_end`          | 대화 retain (upsert)       | `sdk.retainMemories`      |
| `session_shutdown`   | 정리 (필요시)              | —                         |

### 5.1 `session_start` — Bank 초기화

```typescript
pi.on('session_start', async (event, ctx) => {
  const agentId = process.env.NI_AGENT_ID ?? DEFAULT_AGENT_ID
  const bankId = `${BANK_ID_PREFIX}${agentId}`

  try {
    await ensureBankExists(bankId, agentId)
  } catch (e) {
    // Bank 생성 실패 → 기능 비활성화, 에이전트는 계속 동작
    recallEnabled = false
    retainEnabled = false
  }
})
```

### 5.2 `before_agent_start` — Recall + 주입

```typescript
pi.on('before_agent_start', async (event, ctx) => {
  if (!recallEnabled) return

  const recalled = await recallWithTimeout(bankId, event.prompt)
  if (!recalled || recalled.results.length === 0) return

  const memorySection = formatRecallForPrompt(recalled)
  return {
    systemPrompt:
      event.systemPrompt + '\n\n' + RECALL_PROMPT_HEADER + '\n' + memorySection,
  }
})
```

### 5.3 `agent_end` — Retain

```typescript
pi.on('agent_end', async (event, ctx) => {
  if (!retainEnabled) return

  const allMessages = ctx.sessionManager.getBranch() // 세션 전체 메시지
  const sessionId = ctx.sessionManager.getSessionId()

  const filtered = filterMeaningfulMessages(allMessages)
  const formatted = formatConversation(filtered)

  // document_id = session:{sessionId} → 같은 세션은 upsert, 다른 세션은 별도 document
  await retainWithTimeout(bankId, formatted, {
    documentId: `session:${sessionId}`,
  })
})
```

---

## 6. 에러 전략

| 시나리오            | 동작                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------- |
| Hindsight 서버 다운 | `session_start`에서 health check → 기능 자동 비활성화. 에이전트는 기억 없이 정상 동작. |
| Recall 타임아웃     | 빈 결과 반환. 프롬프트에 기억 섹션 생략.                                               |
| Retain 타임아웃     | 조용히 실패. 다음 턴에 재시도.                                                         |
| Bank 생성 실패      | 기능 비활성화. 에이전트 동작 무영향.                                                   |
| 인증 오류           | `session_start`에서 감지. 사용자에게 notify.                                           |

**원칙:** Hindsight는 부가 기능이다. 장애가 Pi의 핵심 동작을 방해하면 안 된다.

---

## 7. 파일 구조

```
.pi/extensions/hindsight/
├── index.ts          # 진입점 — Pi 이벤트 훅
├── client.ts         # 저수준 Hindsight 클라이언트 (타임아웃, 재시도)
├── bank.ts           # Bank 관리 (생성, 확인, 프로필)
├── recall.ts         # Recall 로직 (쿼리 구성, 포맷, 주입)
├── retain.ts         # Retain 로직 (필터링, 포맷, upsert)
├── config.ts         # 상수 설정 + 환경변수
└── package.json      # @vectorize-io/hindsight-client 의존성
```

---

## 8. 구현 체크리스트

- [ ] `config.ts` — 상수 정의 + 환경변수 로드
- [ ] `client.ts` — 저수준 SDK 래퍼 (AbortController 타임아웃, 에러 핸들링)
- [ ] `bank.ts` — bank ID 생성, createBank (idempotent), health check
- [ ] `recall.ts` — recall 쿼리 구성, 타임아웃 래핑, `recallResponseToPromptString` 포맷
- [ ] `retain.ts` — 메시지 필터링, 대화 포맷, upsert retain
- [ ] `index.ts` — Pi 이벤트 훅 연결
- [ ] `package.json` — 의존성 추가
- [ ] 통합 테스트 — 실제 Pi 세션에서 recall/retain 동작 확인
- [ ] 타임아웃 튜닝 — 실제 응답 시간 측정 후 상수 조정
- [ ] 에이전트 프로필 분리 — 코딩/리서치 bank 분리 구현

---

## 9. 열린 질문 (해보면서 결정)

| #   | 질문                                              | 메모                                                                                                |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Recall 쿼리에 직전 assistant 응답을 포함할지?     | 포함하면 맥락 풍부, 미포함하면 쿼리 단순. A/B 비교 필요.                                            |
| 2   | Recall 결과를 systemPrompt vs userMessage 어디에? | systemPrompt가 일관성 있음. 하지만 사용자가 기억을 "무시"해야 할 일이면 userMessage가 나을 수 있음. |
| 3   | Retain 주기를 agent_end vs turn_end?              | agent_end는 프롬프트 단위 (여러 턴 포함). turn_end는 턴 단위. agent_end가 upsert 횟수 적어서 유리.  |
| 4   | 세션 전체 vs 최근 N턴 retain?                     | 전체 upsert가 Hindsight 권장 패턴. 길어지면 비용 증가. max content length 확인 필요.                |
| 5   | ~~에이전트 프로필 자동 감지?~~                    | ✅ 해결: `NI_AGENT_ID` 환경변수로 명시적 선택                                                |
| 6   | Mental model 도입 시기?                           | 초기에는 recall만. 패턴이 쌓이면 mental model로 승격.                                               |
