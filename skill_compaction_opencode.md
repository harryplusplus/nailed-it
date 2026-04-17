# OpenCode 스킬 보호(Compaction) 구현 분석

> OpenCode가 스킬 콘텐츠를 압축(compaction/prune)에서 어떻게 보호하는지 분석.
> pi 구현 참고용.

---

## 1. 아키텍처 개요

OpenCode는 **2단계 압축** 구조를 사용:

| 단계 | 이름 | 방식 | 트리거 |
|---|---|---|---|
| 1단계 | **Prune** | 오래된 툴 출력을 `"[Old tool result content cleared]"`로 교체 | 매 턴 후 자동 |
| 2단계 | **Compaction** | LLM이 전체 대화를 요약 | 컨텍스트 오버플로우 시 |

Prune이 먼저 실행되어 스킬 콘텐츠를 보호하고, 그 후 Compaction이 실행됨.

---

## 2. Prune (가벼운 압축) — 스킬 보호 핵심 로직

### 소스 파일

- **`packages/opencode/src/session/compaction.ts`** — prune 및 compaction 메인 로직

### 핵심 코드

```ts
const PRUNE_PROTECTED_TOOLS = ["skill"]  // ← 보호할 툴 이름 목록

// 뒤에서부터 순회하며 툴 출력 토큰 누적
loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
  const msg = msgs[msgIndex]
  if (msg.info.role === "user") turns++
  if (turns < 2) continue                          // 최근 2턴은 보호
  if (msg.info.role === "assistant" && msg.info.summary) break loop  // 이전 요약에서 중단

  for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
    const part = msg.parts[partIndex]
    if (part.type === "tool")
      if (part.state.status === "completed") {
        if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue  // ← 스킬은 스킵!
        if (part.state.time.compacted) break loop                  // 이미 prune된 것에서 중단
        const estimate = Token.estimate(part.state.output)
        total += estimate
        if (total > PRUNE_PROTECT) {   // 40,000 토큰
          pruned += estimate
          toPrune.push(part)
        }
      }
  }
}

// prune 대상의 출력을 타임스탬프 마킹
if (pruned > PRUNE_MINIMUM) {   // 20,000 토큰
  for (const part of toPrune) {
    if (part.state.status === "completed") {
      part.state.time.compacted = Date.now()  // ← 마킹만, 내용은 나중에 교체
    }
  }
}
```

### Prune 알고리즘 요약

1. 메시지를 **뒤에서부터** 순회
2. 최근 2턴(turns < 2)은 보호
3. 툴 파트 중:
   - `PRUNE_PROTECTED_TOOLS`에 포함된 툴 → **완전 스킵** (토큰 누적도 안 함)
   - 이미 `compacted` 마킹된 것 → 순회 중단
   - 그 외 → 토큰 누적, `PRUNE_PROTECT`(40,000) 초과 시 prune 대상 추가
4. prune 대상이 `PRUNE_MINIMUM`(20,000) 초과 시 → `compacted` 타임스탬프 마킹

### 상수

| 상수 | 값 | 의미 |
|---|---|---|
| `PRUNE_MINIMUM` | 20,000 | prune 실행 최소 토큰 (이하면 실행 안 함) |
| `PRUNE_PROTECT` | 40,000 | 최근 툴 출력을 보호할 토큰 예산 |
| `PRUNE_PROTECTED_TOOLS` | `["skill"]` | prune에서 완전 보호할 툴 이름 목록 |

---

## 3. Prune된 툴 결과의 LLM 전달 처리

### 소스 파일

- **`packages/opencode/src/session/message-v2.ts`** (727-728행)

```ts
const outputText = part.state.time.compacted
  ? "[Old tool result content cleared]"   // ← prune된 툴 결과
  : part.state.output                      // ← 스킬은 그대로!
const attachments = part.state.time.compacted || options?.stripMedia
  ? []
  : (part.state.attachments ?? [])
```

prune된 툴 결과는 LLM에 `"[Old tool result content cleared]"`로 전달.
스킬 툴은 prune되지 않으므로 원본 그대로 전달됨.

### 툴 결과 스키마

```ts
// message-v2.ts (313행)
time: z.object({
  start: z.number(),
  end: z.number(),
  compacted: z.number().optional(),  // ← prune 시 타임스탬프 마킹
}),
```

---

## 4. Compaction (무거운 압축) — LLM 요약

### 소스 파일

- **`packages/opencode/src/session/compaction.ts`** — `processCompaction` 함수

### 요약 프롬프트

```ts
const defaultPrompt = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.
Do not call any tools. Respond only with the summary text.
Respond in the same language as the user's messages in the conversation.

When constructing the summary, try to stick to this template:
---
## Goal
[What goal(s) is the user trying to accomplish?]
## Instructions
- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]
## Discoveries
[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]
## Accomplished
[What work has been completed, what work is still in progress, and what work is left?]
## Relevant files / directories
[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`
```

### 플러그인 훅

```ts
// compaction 전에 플러그인이 컨텍스트나 프롬프트를 수정할 수 있음
const compacting = yield* plugin.trigger(
  "experimental.session.compacting",
  { sessionID: input.sessionID },
  { context: [], prompt: undefined },
)
const prompt = compacting.prompt ?? [defaultPrompt, ...composing.context].join("\n\n")
```

### 메시지 변환 (prune된 결과 포함)

```ts
const msgs = structuredClone(messages)
yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
const modelMessages = yield* MessageV2.toModelMessagesEffect(msgs, model, { stripMedia: true })
```

`toModelMessagesEffect`에서 `compacted` 마킹된 툴 결과를 `"[Old tool result content cleared]"`로 변환.

---

## 5. 스킬 툴 정의

### 소스 파일

- **`packages/opencode/src/tool/skill.ts`** — 스킬 툴 정의

### 스킬 툴 출력 포맷

```ts
return {
  title: `Loaded skill: ${info.name}`,
  output: [
    `<skill_content name="${info.name}">`,
    `# Skill: ${info.name}`,
    "",
    info.content.trim(),
    "",
    `Base directory for this skill: ${base}`,
    "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
    "Note: file list is sampled.",
    "",
    "<skill_files>",
    files,
    "</skill_files>",
    "</skill_content>",
  ].join("\n"),
  metadata: {
    name: info.name,
    dir,
  },
}
```

**핵심**: 툴 이름이 `"skill"`이므로 `PRUNE_PROTECTED_TOOLS.includes("skill")`에서 매칭됨.

### 스킬 툴 설명 (LLM용)

```ts
description: [
  "Load a specialized skill that provides domain-specific instructions and workflows.",
  "",
  "When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.",
  "",
  "The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.",
  "",
  'Tool output includes a `<skill_content name="...">` block with the loaded content.',
  // ...
].join("\n")
```

---

## 6. 설정

### 소스 파일

- **`packages/opencode/src/config/config.ts`** (249-258행)

```ts
compaction: z.object({
  auto: z.boolean().optional()    // 자동 압축 활성화 (기본: true)
  prune: z.boolean().optional()   // prune 활성화 (기본: true)
  reserved: z.number().int().min(0).optional()  // 압축 버퍼 토큰
})
```

### 오버플로우 감지

- **`packages/opencode/src/session/overflow.ts`**

```ts
const COMPACTION_BUFFER = 20_000

export function isOverflow(input) {
  if (input.cfg.compaction?.auto === false) return false
  const reserved = input.cfg.compaction?.reserved
    ?? Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(input.model))
  const usable = input.model.limit.input
    ? input.model.limit.input - reserved
    : context - ProviderTransform.maxOutputTokens(input.model)
  return count >= usable
}
```

---

## 7. pi와의 비교

| | OpenCode | pi (현재) | pi (제안) |
|---|---|---|---|
| **보호 방식** | 툴 이름 기반 (`"skill"`) | 없음 | `<skill_content>` 태그 기반 식별 |
| **보호 수준** | 완전 스킵 (무제한) | - | P1 우선순위 + 예산 내 보호 |
| **압축 모델** | 2단계 (prune → compaction) | 1단계 (compaction만) | 1단계 (compaction + 스킬 보호) |
| **prune 방식** | 오래된 툴 출력을 `"[Old tool result content cleared]"`로 교체 | - | 해당 없음 |
| **예산 초과 시** | 스킬은 무조건 보호 | - | 오래된 스킬부터 P2 강등 |
| **메시지 변환** | 없음 (원본 유지, compacted 마킹만) | - | toolResult → user 메시지 변환 |
| **식별 방식** | 툴 이름 (`"skill"`) | - | 툴 결과 내용의 `<skill_content>` 태그 |
| **플러그인 훅** | `experimental.session.compacting` | `session_before_compact` | 동일 |
| **메시지 변환 훅** | `experimental.chat.messages.transform` | `context` | 동일 |

### OpenCode 접근의 장단점

**장점:**
- 구현이 매우 단순함 (툴 이름 비교 한 줄)
- 스킬이 무조건 보호됨 (예산 초과 걱정 없음)
- prune은 가벼운 압축이라 LLM 호출 없이 실행됨

**단점:**
- 스킬이 많고 길면 컨텍스트 대부분을 차지할 위험
- 툴 이름 기반이므로 다른 툴의 스킬 콘텐츠는 보호 불가
- prune된 툴 결과는 복구 불가 (`"[Old tool result content cleared]"`로 대체)
- `PRUNE_PROTECTED_TOOLS`가 하드코딩됨 (설정 불가)

### pi 제안 접근의 장단점

**장점:**
- `<skill_content>` 태그 기반이므로 툴 이름에 의존하지 않음
- P1/P2 우선순위로 예산 관리
- 스킬 내용이 원문 보존됨 (prune처럼 내용 삭제 안 함)
- 오래된 스킬은 P2로 강등되어 요약 대상이 됨 (무한 보호 방지)

**단점:**
- 구현이 더 복잡함
- toolResult → user 메시지 변환 로직 필요
- CompactionEntry 스키마 변경 필요

---

## 8. 소스 파일 참조

| 파일 | 경로 | 역할 |
|---|---|---|
| compaction.ts | `packages/opencode/src/session/compaction.ts` | prune + compaction 메인 로직, `PRUNE_PROTECTED_TOOLS` 정의 |
| message-v2.ts | `packages/opencode/src/session/message-v2.ts` | prune된 툴 결과의 LLM 전달 변환 (727-728행) |
| skill.ts | `packages/opencode/src/tool/skill.ts` | 스킬 툴 정의, `<skill_content>` 출력 포맷 |
| overflow.ts | `packages/opencode/src/session/overflow.ts` | 컨텍스트 오버플로우 감지 |
| config.ts | `packages/opencode/src/config/config.ts` | compaction 설정 (auto, prune, reserved) |
| prompt.ts | `packages/opencode/src/session/prompt.ts` | prune 트리거 (1538행), compaction 트리거 (1395행) |