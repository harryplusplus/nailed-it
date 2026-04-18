# Discord Bot for Pi Coding Agent

Discord에서 봇을 @멘션하면 스레드가 열리고, 그 스레드가 Pi 세션이 되어 대화하는 봇.

## 아키텍처

```
Discord User: @nailed-it 코드 리뷰해줘
       │
       ▼
discord.js (Gateway WebSocket, 아웃바운드 연결)
  │ messageCreate 이벤트 → @멘션 감지
  │ thread 메시지 → Effect Queue에 적재
       │
       ▼
Effect.ts Runtime (ManagedRuntime)
  │ DiscordClient Service → discord.js Client
  │ SessionStore Service → Ref<Map<threadId, SessionEntry>>
  │ SessionEntry = { session, sessionManager, queue, fiber }
       │
       ▼
Pi Session (per-thread Effect Fiber)
  │ Queue.take → buildPrompt → collectPiResponse → channel.send
  │ 순차 처리 (busy 플래그 없이 Queue로 보장)
       │
       ▼
discord.js → channel.send(response)
  │ 완료 시 한꺼번에 전송
       ▼
Discord Thread에 응답 표시
```

## 파일 구조

```
packages/discord-bot/
  index.ts          # 메인 엔트리 포인트 (Effect.ts 기반)
  sessions/          # 스레드-세션 매핑 파일 (gitignore)
  .env.example      # 환경변수 예시
```

## 의존성

| 패키지 | 용도 |
|--------|------|
| `discord.js` | Discord Gateway 직접 연결 |
| `@mariozechner/pi-coding-agent` | Pi SDK |
| `effect` | Effect.ts (Effect, Layer, Queue, Ref, ManagedRuntime) |

## v1 기능

| # | 기능 | 설명 |
|---|------|------|
| 1 | @멘션 → 스레드 + Pi 세션 | 봇 태그하면 Discord 스레드 열리고 Pi 세션 생성 |
| 2 | 대화 유지 | 스레드별 Pi 세션 유지, `~/.pi/agent/sessions/` 에 파일 영속화 (CLI/TUI와 동일 방식) |
| 3 | 응답 전송 | Pi 응답 완료 후 Discord에 한꺼번에 전송 (스트리밍 없음) |
| 4 | "typing..." 표시 | Pi 처리 중 typing 인디케이터 |
| 5 | 텍스트 파일 첨부 | Discord 첨부파일 → fetch → Pi 프롬프트에 포함 |
| 6 | 메시지 큐잉 | Effect Queue로 순차 처리 (busy 플래그 불필요) |
| 7 | 즉시 취소 | `/stop` 슬래시 커맨드로 `session.abort()` 호출 |
| 8 | 에러 핸들링 | Pi 오류 시 Discord에 에러 메시지 표시 |

## 주의사항

- **보안**: 봇에 @멘션하는 누구나 Pi의 도구(bash, 파일 읽기/쓰기)를 사용 가능 → Discord 서버 권한 관리 필수
- **Gateway 연결**: Discord 메시지 수신을 위해 Gateway WebSocket 연결 필수. 아웃바운드 연결이므로 외부 포트 오픈 불필요
- **Pi 세션 영속화**: `SessionManager.create(cwd)` 사용 → `~/.pi/agent/sessions/<cwd>/` 에 `.jsonl` 저장, CLI/TUI와 동일 방식. 봇 재시작 시 매핑 파일 기반으로 세션 재개

## 환경변수

```env
DISCORD_BOT_TOKEN=your_bot_token
```

## Effect.ts 아키텍처

### Services (Context.Tag)

```typescript
class DiscordClient extends Context.Tag('DiscordClient')<DiscordClient, Client>() {}
class SessionStore extends Context.Tag('SessionStore')<SessionStore, Ref.Ref<Map<string, SessionEntry>>>() {}
```

### Layers

```typescript
const DiscordClientLive = Layer.sync(DiscordClient, () => new Client({ intents: [...] }))
const SessionStoreLive = Layer.effect(SessionStore, Ref.make(new Map()))
const MainLayer = Layer.merge(DiscordClientLive, SessionStoreLive)
```

### Runtime

```typescript
const runtime = ManagedRuntime.make(MainLayer)
await runtime.runPromise(program)
```

### 메시지 큐잉 (Effect Queue)

- 각 스레드에 `Queue.unbounded` 생성
- `Effect.fork(processQueue(...))` 로 큐 소비 Fiber 실행
- `Queue.offer` 로 메시지 적재, `Queue.take` 로 순차 소비
- busy 플래그 없이 Queue가 순차 처리 보장

### 세션 관리

- `Ref<Map<string, SessionEntry>>` 로 스레드별 세션 상태 관리
- `SessionEntry = { session, sessionManager, queue, fiber }`
- `getOrCreateSession` → 기존 세션 조회 또는 새 세션 생성 + 큐 Fiber fork