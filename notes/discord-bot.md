# Discord Bot for Pi Coding Agent

Discord에서 봇을 @멘션하면 스레드가 열리고, 그 스레드가 Pi 세션이 되어 대화하는 봇.

## 아키텍처

```
Discord User: @nailed-it 코드 리뷰해줘
       │
       ▼
Chat SDK (Discord Adapter)
  │ onNewMention → thread.subscribe()
  │ onSubscribedMessage → 큐에 메시지 적재
       │
       ▼
Pi Session Pool (Map<threadId, {session, busy, queue}>)
  │ threadId별로 AgentSession 유지
  │ 메시지 큐잉 → 순차 처리
       │
       ▼
Pi SDK (createAgentSession)
  │ session.prompt(text) → LLM + 도구 실행
  │ subscribe() → text_delta 스트리밍 수집
       │
       ▼
AsyncIterable<string> 브릿지
  │ Pi의 text_delta 이벤트를 AsyncIterable로 변환
       │
       ▼
Chat SDK → thread.post(stream)
  │ Discord Post+Edit 방식으로 실시간 업데이트
       ▼
Discord Thread에 스트리밍 응답 표시
```

## 파일 구조

```
packages/discord-bot/
  index.ts          # 메인 엔트리 포인트
  .env.example      # 환경변수 예시
```

## 의존성

| 패키지 | 용도 | 설치 상태 |
|--------|------|----------|
| `chat` | Chat SDK 코어 | ✅ 설치됨 |
| `@chat-adapter/discord` | Discord 어댑터 | ✅ 설치됨 |
| `hono` | HTTP 웹훅 서버 | ✅ 설치됨 |
| `@hono/node-server` | Hono Node.js 어댑터 | ✅ 설치됨 |
| `@mariozechner/pi-coding-agent` | Pi SDK | ✅ 설치됨 (devDep) |

## v1 기능

| # | 기능 | 설명 |
|---|------|------|
| 1 | @멘션 → 스레드 + Pi 세션 | 봇 태그하면 Discord 스레드 열리고 Pi 세션 생성 |
| 2 | 대화 유지 | 스레드별 Pi 세션 유지, `~/.pi/agent/sessions/` 에 파일 영속화 (CLI/TUI와 동일 방식) |
| 3 | 응답 전송 | Pi 응답 완료 후 Discord에 한꺼번에 전송 (스트리밍 없음) |
| 4 | "typing..." 표시 | Pi 처리 중 typing 인디케이터 |
| 5 | 텍스트 파일 첨부 | Discord 첨부파일 → fetch → Pi 프롬프트에 포함 |
| 6 | 메시지 큐잉 | Pi 처리 중 들어오는 메시지 순차 처리 |
| 7 | 즉시 취소 | `/stop` 슬래시 커맨드로 `session.abort()` 호출, 현재 Pi 실행 즉시 중단 |
| 8 | 에러 핸들링 | Pi 오류 시 Discord에 에러 메시지 표시 |

## v2 고려사항

- 슬래시 커맨드 추가 (`/pi`, `/reset` 등)

## 주의사항

- **보안**: 봇에 @멘션하는 누구나 Pi의 도구(bash, 파일 읽기/쓰기)를 사용 가능 → Discord 서버 권한 관리 필수
- **Gateway 연결**: Discord 메시지 수신을 위해 Gateway WebSocket 연결 필수. 아웃바운드 연결이므로 외부 포트 오픈 불필요
- **Pi 세션 영속화**: `SessionManager.create(cwd)` 사용 → `~/.pi/agent/sessions/<cwd>/` 에 `.jsonl` 저장, CLI/TUI와 동일 방식. 봇 재시작 시 `SessionManager.continueRecent()` 로 이어서 대화 가능


## 환경변수

```env
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_PUBLIC_KEY=your_public_key
DISCORD_APPLICATION_ID=your_application_id
```

## Discord 앱 설정 체크리스트

1. Discord Developer Portal에서 앱 생성
2. Bot Token, Public Key, Application ID 확보
3. Privileged Gateway Intents → Message Content Intent 활성화
4. Interactions Endpoint URL → 설정 불필요 (Gateway로 슬래시 커맨드 수신)
5. OAuth2 → `bot` + `applications.commands` 스코프, 필요 권한 체크
6. 봇을 서버에 초대

## 핵심 구현 포인트

### 세션 매핑 (퍼스레드 파일)

Discord 스레드 ID → Pi 세션 파일 경로 매핑:

```
packages/discord-bot/sessions/
  1234567890.json    ← Discord 스레드 ID별 파일
  0987654321.json
```

```json
{
  "threadId": "1234567890",
  "sessionFile": "~/.pi/agent/sessions/.../2026-04-19T...jsonl",
  "createdAt": "2026-04-19T..."
}
```

- 파일 있으면 → `SessionManager.open(sessionFile)` 로 재개
- 파일 없으면 → 새 세션 생성 + 매핑 파일 저장
- 퍼스레드 파일이므로 파일락 불필요

### 즉시 취소

```typescript
bot.onSlashCommand("stop", async (event) => {
  const entry = sessions.get(event.threadId);
  if (entry?.busy) {
    entry.session.abort();
    await event.thread.post("⏹ 실행을 중단했습니다.");
  } else {
    await event.thread.post("실행 중인 작업이 없습니다.");
  }
});
```

### 응답 수집

Pi 세션의 응답을 완료될 때까지 모았다가 한꺼번에 전송:

```typescript
async function collectPiResponse(session: AgentSession, prompt: string): Promise<string> {
  let response = "";
  const unsub = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      response += event.assistantMessageEvent.delta;
    }
  });

  await session.prompt(prompt);
  unsub();
  return response;
}
```

### 세션 관리 (CLI/TUI와 동일 방식)

```typescript
import { SessionManager } from "@mariozechner/pi-coding-agent";

const cwd = process.cwd(); // packages/discord-bot/ 에서 실행하면 해당 경로가 세션 디렉토리가 됨

// 새 세션 생성 (파일 영속화)
const { session } = await createAgentSession({
  sessionManager: SessionManager.create(cwd),
  cwd,
  tools: createCodingTools(cwd),
});

// 봇 재시작 시 마지막 세션 이어서
const { session } = await createAgentSession({
  sessionManager: SessionManager.continueRecent(cwd),
  cwd,
  tools: createCodingTools(cwd),
});
```

세션 파일은 `~/.pi/agent/sessions/<cwd>/` 에 `.jsonl` 형식으로 저장됨.

### 메시지 큐잉

Pi가 처리 중일 때 들어오는 메시지를 큐에 적재하고 순차 처리:

```typescript
interface SessionEntry {
  session: AgentSession;
  sessionManager: SessionManager;
  busy: boolean;
  queue: Array<{ text: string; attachments?: Attachment[] }>;
}

async function processQueue(threadId: string, thread: Thread): Promise<void> {
  const entry = sessions.get(threadId);
  if (!entry || entry.busy) return;

  while (entry.queue.length > 0) {
    const { text, attachments } = entry.queue.shift()!;
    entry.busy = true;
    try {
      await thread.startTyping();
      const response = await collectPiResponse(entry.session, buildPrompt(text, attachments));
      await thread.post(response);
    } finally {
      entry.busy = false;
    }
  }
}
```

### 파일 첨부 처리

```typescript
function buildPrompt(text: string, attachments?: Attachment[]): string {
  let prompt = text;
  if (attachments?.length) {
    for (const att of attachments) {
      // Discord 첨부 URL → fetch → 텍스트 추출 → 프롬프트에 포함
      prompt += `\n\n--- ${att.filename} ---\n${content}`;
    }
  }
  return prompt;
}
```