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
| `@chat-adapter/state-memory` | 인메모리 상태 (v1) | ✅ 설치됨 |
| `hono` | HTTP 웹훅 서버 | ✅ 설치됨 |
| `@hono/node-server` | Hono Node.js 어댑터 | ✅ 설치됨 |
| `@mariozechner/pi-coding-agent` | Pi SDK | ✅ 설치됨 (devDep) |

## v1 기능

| # | 기능 | 설명 |
|---|------|------|
| 1 | @멘션 → 스레드 + Pi 세션 | 봇 태그하면 Discord 스레드 열리고 Pi 세션 생성 |
| 2 | 대화 유지 | 스레드별 Pi 세션 유지, 대화 맥락 보존 |
| 3 | 스트리밍 응답 | Pi 응답을 Discord에 Post+Edit으로 실시간 표시 (500ms 간격) |
| 4 | "typing..." 표시 | Pi 처리 중 typing 인디케이터 |
| 5 | 텍스트 파일 첨부 | Discord 첨부파일 → fetch → Pi 프롬프트에 포함 |
| 6 | 메시지 큐잉 | Pi 처리 중 들어오는 메시지 순차 처리 |
| 7 | DM 지원 | 다이렉트 메시지에서도 대화 가능 |
| 8 | 에러 핸들링 | Pi 오류 시 Discord에 에러 메시지 표시 |

## v2 고려사항

- 🔄 리액션 → 응답 재시도
- Redis state adapter → 재시작 시 구독 복원
- Pi 세션 영속화 → 재시작 후에도 대화 맥락 유지
- 이미지 첨부 → Pi의 vision 기능 활용
- 슬래시 커맨드 (`/pi`, `/reset` 등)

## 주의사항

- **보안**: 봇에 @멘션하는 누구나 Pi의 도구(bash, 파일 읽기/쓰기)를 사용 가능 → Discord 서버 권한 관리 필수
- **Gateway 연결**: Discord 메시지 수신을 위해 Gateway WebSocket 연결 필수 (HTTP Interactions만으로는 불가)
- **인메모리 상태**: v1은 메모리 기반이라 재시작 시 구독/세션 손실 → 운영환경은 Redis 권장
- **스트리밍 간격**: Discord Post+Edit은 500ms 간격 (rate limit 방지)

## 환경변수

```env
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_PUBLIC_KEY=your_public_key
DISCORD_APPLICATION_ID=your_application_id
PORT=3000
PI_CWD=/path/to/project
```

## Discord 앱 설정 체크리스트

1. Discord Developer Portal에서 앱 생성
2. Bot Token, Public Key, Application ID 확보
3. Privileged Gateway Intents → Message Content Intent 활성화
4. Interactions Endpoint URL → `https://your-domain/api/webhooks/discord`
5. OAuth2 → `bot` + `applications.commands` 스코프, 필요 권한 체크
6. 봇을 서버에 초대

## 핵심 구현 포인트

### 스트리밍 브릿지

Pi SDK의 `text_delta` 이벤트를 Chat SDK가 요구하는 `AsyncIterable<string>`으로 변환:

```typescript
async function* piStream(session: AgentSession, prompt: string): AsyncIterable<string> {
  const chunks: string[] = [];
  let done = false;
  let resolve: (() => void) | null = null;

  const unsub = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      chunks.push(event.assistantMessageEvent.delta);
      resolve?.();
    }
    if (event.type === "agent_end") {
      done = true;
      resolve?.();
    }
  });

  session.prompt(prompt).catch((err) => { /* handle error */ });

  try {
    while (!done || chunks.length > 0) {
      if (chunks.length === 0 && !done) {
        await new Promise<void>((r) => { resolve = r; });
        resolve = null;
      }
      while (chunks.length > 0) {
        yield chunks.shift()!;
      }
    }
  } finally {
    unsub();
  }
}
```

### 메시지 큐잉

Pi가 처리 중일 때 들어오는 메시지를 큐에 적재하고 순차 처리:

```typescript
interface SessionEntry {
  session: AgentSession;
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
      const stream = piStream(entry.session, buildPrompt(text, attachments));
      await thread.post(stream);
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