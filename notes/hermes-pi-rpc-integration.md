# Hermes 기본 에이전트 엔진 → Pi RPC 교체 조사

조사일: 2026-04-21

## 목표

Hermes의 기본 LLM 엔진(AIAgent)을 Pi RPC로 교체:
- Discord → Hermes (Pi)
- CLI → Hermes (Pi)

## Hermes 아키텍처 요약

### 핵심 클래스: AIAgent (run_agent.py, ~12000줄)

- **LLM API 호출**: `_interruptible_api_call()` / `_interruptible_streaming_api_call()` → OpenAI/Anthropic/Bedrock SDK 직접 호출
- **도구 실행 루프**: `run_conversation()` → LLM 응답 → 도구 호출 → LLM 응답 반복
- **컨텍스트 관리**: 압축, 프롬프트 빌딩, 메모리 주입
- **세션 관리**: 메시지 히스토리, 트랜잭션 로깅

### 호출 경로

```
Discord → gateway/run.py::_run_agent() → AIAgent() → run_conversation()
CLI     → cli.py → AIAgent() → run_conversation()
```

### Transport 레이어

- `agent/transports/base.py`: `ProviderTransport` ABC
- `agent/transports/anthropic.py`: Anthropic Messages API transport
- `agent/transports/types.py`: `NormalizedResponse`, `ToolCall`, `Usage`
- Transport은 **단일 LLM 호출**만 담당 (메시지 변환 + 응답 정규화)

### Proxy 모드 (기존)

`gateway/run.py`에 이미 `_run_agent_via_proxy()` 구현 존재:
- `GATEWAY_PROXY_URL` 환경변수 또는 `gateway.proxy_url` config
- Hermes가 플랫폼 I/O만 처리, 실제 에이전트 작업은 원격 서버에 위임
- `POST /v1/chat/completions` + SSE 스트리밍

## Pi RPC 인터페이스

### 두 가지 통합 방식

| 방식 | 설명 |
|------|------|
| **RPC 모드** (`pi --mode rpc`) | stdin/stdout JSONL 프로토콜, 서브프로세스 |
| **SDK** (`@mariozechner/pi-coding-agent`) | Node.js 인프로세스, `createAgentSession()` API |

### RPC 프로토콜 핵심

- **입력**: `{"type": "prompt", "message": "..."}` → JSONL 한 줄
- **출력**: `message_update` (스트리밍 델타), `tool_execution_*`, `agent_end` 이벤트
- **도구**: Pi 빌트인(bash, read, edit, write, grep, find, ls) + 커스텀 + 확장
- **세션**: `--no-session` 또는 영구 세션 지원
- **승인**: `extension_ui_request` / `extension_ui_response` 서브프로토콜

### SDK 핵심 API

```typescript
const { session } = await createAgentSession({
  model, tools, customTools, resourceLoader,
  sessionManager: SessionManager.inMemory(),
});
session.subscribe((event) => { /* 스트리밍 처리 */ });
await session.prompt("메시지");
```

## 교체 방안 분석

### 방안 A: Transport 레이어 교체 (비현실적)

`ProviderTransport` ABC를 구현하는 `PiTransport` 생성.

**문제**: Pi RPC는 전체 에이전트 루프(LLM→도구→LLM)를 소유. Transport는 단일 LLM 호출만 담당. Hermes의 도구 실행 루프와 Pi의 도구 실행 루프가 충돌.

### 방안 B: Proxy 모델 확장 (가장 실용적 ⭐)

기존 `_run_agent_via_proxy()` 패턴을 Pi RPC에 맞게 확장.

```
Discord → Hermes Gateway (플랫폼 I/O만)
              ↓
         pi --mode rpc (서브프로세스)
              ↓
         Pi Agent (LLM + 도구 + 컨텍스트)
```

구현 스텝:
1. `PiRpcClient` 클래스: 서브프로세스 관리 + JSONL 프로토콜 핸들러
2. `_run_agent_via_pi_rpc()`: `_run_agent_via_proxy()`를 모델로 작성
3. 설정: `GATEWAY_PI_RPC=true` 또는 `gateway.pi_rpc: true`
4. 스트리밍 브릿지: Pi `message_update` → Hermes `stream_delta_callback`
5. 도구 승인 브릿지: Pi `extension_ui_request` → Discord 인터랙티브 메시지

### 방안 C: AIAgent 자체를 Pi SDK로 교체 (가장 급진적)

`run_conversation()` 전체를 Pi RPC 호출로 교체.

**문제**: AIAgent 12000줄 기능(재시도, 페일오버, 압축, 승인 등) 전부 Pi에 위임. 콜백 시스템 브릿지 필요.

## 트레이드오프

| | Hermes 기본 엔진 | Pi RPC 교체 |
|---|---|---|
| **도구** | terminal, browser, MCP, 50+ 도구 | bash, read, edit, write + 확장 |
| **LLM** | OpenAI/Anthropic/Bedrock/Gemini 직접 | Pi가 관리 (동일 프로바이더 지원) |
| **컨텍스트** | Hermes 자체 압축 | Pi 자체 압축 |
| **메모리** | Hindsight 플러그인 | Pi 확장으로 마이그레이션 필요 |
| **세션** | Hermes DB/JSON | Pi JSONL 세션 |
| **승인** | Hermes 내장 | Pi extension_ui 프로토콜 |
| **스트리밍** | 직접 SDK 스트리밍 | RPC 이벤트 → 브릿지 |

---

## LLM API kwargs 훅/오버라이드 설계

### 현황

Hermes에 **LLM API 파라미터를 사용자가 제어할 인터페이스가 없음**. temperature, top_p, frequency_penalty, presence_penalty 등 모두 하드코딩 또는 생략(→ SDK 기본값).

### 기존 메커니즘: `request_overrides`

`AIAgent.__init__`의 `request_overrides: Dict[str, Any]` 파라미터가 `api_kwargs.update(self.request_overrides)`로 최종 주입됨 (run_agent.py:6997). 현재는 `/fast` 명령어(`service_tier: priority` / `speed: fast`) 경로로만 생성됨.

**핵심**: `request_overrides`는 이미 dict를 그대로 API kwargs에 병합하는 제네릭 메커니즘. 여기에 `temperature`, `top_p` 등 어떤 키든 넣으면 OpenAI 호환 API에 그대로 전달됨.

### 기존 메커니즘: `extra_body`

`auxiliary` 모델 설정에 `extra_body: {}` 필드가 존재 (hermes_cli/config.py:512). OpenAI SDK의 `extra_body` 파라미터로 전달됨. 하지만 메인 모델에는 이 메커니즘이 없음.

### 제안: config.yaml `model.api_overrides` dict

```yaml
model:
  default: glm-5.1
  provider: ollama-cloud
  base_url: https://ollama.com/v1
  api_overrides:          # NEW: LLM API kwargs override
    temperature: 0
    # top_p: 0.9          # 필요시 추가 가능
    # frequency_penalty: 0
```

또는 `providers` 섹션에:

```yaml
providers:
  ollama-cloud:
    base_url: https://ollama.com/v1
    api_overrides:        # NEW: per-provider override
      temperature: 0
```

### 구현 포인트

#### 1. config 파싱 (hermes_cli/config.py)

`_KNOWN_KEYS`에 `api_overrides` 추가:

```python
_KNOWN_KEYS = {
    "name", "api", "url", "base_url", "api_key", "key_env",
    "api_mode", "transport", "model", "default_model", "models",
    "context_length", "rate_limit_delay",
    "api_overrides",      # NEW
}
```

`_normalize_custom_provider_entry()`에서 `api_overrides` dict 저장:

```python
api_overrides = entry.get("api_overrides")
if isinstance(api_overrides, dict) and api_overrides:
    normalized["api_overrides"] = api_overrides
```

`model` 섹션에서도 `api_overrides` 읽기:

```python
# _resolve_runtime_agent_kwargs() 또는 _resolve_gateway_model()에서
model_cfg = cfg.get("model", {})
api_overrides = model_cfg.get("api_overrides", {}) if isinstance(model_cfg, dict) else {}
```

#### 2. 런타임 전달 (gateway/run.py, cli.py)

`_resolve_turn_agent_config()`에서 `request_overrides`에 병합:

```python
# 기존 fast_mode_overrides와 병합
overrides = resolve_fast_mode_overrides(route["model"]) or {}
if api_overrides:
    overrides.update(api_overrides)
route["request_overrides"] = overrides if overrides else None
```

#### 3. AIAgent에 전달 (run_agent.py)

`request_overrides`는 이미 `api_kwargs.update(self.request_overrides)`로 주입되므로 **추가 수정 불필요**.

#### 4. Anthropic/Bedrock 경로 고려

`request_overrides`는 `chat_completions` 경로에만 적용됨 (run_agent.py:6997). `anthropic_messages`와 `bedrock_converse` 경로는 별도 처리:

- **anthropic_messages**: `build_anthropic_kwargs()`에 `temperature` 파라미터가 이미 있으므로, `request_overrides`에서 `temperature`를 추출해 전달
- **bedrock_converse**: `build_converse_kwargs()`에 `temperature=None`이 하드코딩. `request_overrides`에서 추출해 전달
- **codex_responses**: `request_overrides`가 이미 `kwargs.update()`로 적용됨 (run_agent.py:6781)

→ Transport별로 `request_overrides`에서 해당 프로토콜이 지원하는 키만 추출해 전달하는 래핑 필요.

#### 5. 환경변수 폴백

config.yaml 없이도 설정 가능하도록:

```python
_env_overrides = os.getenv("HERMES_API_OVERRIDES")
if _env_overrides:
    try:
        api_overrides = json.loads(_env_overrides)
    except json.JSONDecodeError:
        api_overrides = {}
```

사용: `HERMES_API_OVERRIDES='{"temperature": 0}'`

### 수정 파일 요약

| 파일 | 수정 내용 |
|------|-----------|
| `hermes_cli/config.py` | `_KNOWN_KEYS`에 `api_overrides` 추가, `_normalize_custom_provider_entry`에서 저장, `DEFAULT_CONFIG`에 `api_overrides` 추가 |
| `gateway/run.py` | `_resolve_turn_agent_config()`에서 `api_overrides`를 `request_overrides`에 병합 |
| `cli.py` | `_resolve_turn_agent_config()`에서 동일 |
| `run_agent.py` | `_build_api_kwargs()`에서 `request_overrides`의 `temperature`를 Anthropic/Bedrock 경로에도 전달 (선택) |
| `agent/anthropic_adapter.py` | `build_anthropic_kwargs()`가 `temperature`를 받도록 이미 되어 있음 (확인 필요) |
| `agent/bedrock_adapter.py` | `build_converse_kwargs()`에 `temperature` 전달 (선택) |

### 업스트림 PR 전략

1. `api_overrides`는 범용 메커니즘이므로 temperature뿐 아니라 top_p, frequency_penalty 등 모든 OpenAI 호환 파라미터에 적용 가능
2. `model` 섹션과 `providers` 섹션 모두에서 지원 → 글로벌 오버라이드 + 프로바이더별 오버라이드
3. 기존 `request_overrides` 인프라를 재사용하므로 런타임 수정 최소화
4. 환경변수 폴백(`HERMES_API_OVERRIDES`)로 컨테이너/Docker 배포에서도 설정 가능