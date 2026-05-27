# Arize Phoenix OSS 로컬 Eval 을 위한 Tracing 정보 요구사항

## 요약

Arize Phoenix 로 eval 을 위해 **req body 와 res body 를 tracing attribute 로 저장**하면 됩니다. HAR 파일은 불필요합니다.

---

## 1. Span 모델 구조

Arize Phoenix 의 `Span` 테이블은 다음 필드를 가집니다:

```python
class Span(HasId):
    span_id: str
    parent_id: Optional[str]
    name: str
    span_kind: str
    start_time: datetime
    end_time: datetime
    attributes: dict[str, Any]  # ← 핵심! 모든 데이터는 여기에
    events: list[dict[str, Any]]
    status_code: str  # 'OK', 'ERROR', 'UNSET'
    status_message: str
    
    # 자동 계산된 속성
    latency_ms: float
    input_value: Any  # attributes.input.value 에서 추출
    input_mime_type: Any
    output_value: Any  # attributes.output.value 에서 추출
    output_mime_type: Any
```

**핵심**: 모든 eval 에 필요한 데이터는 `attributes` dict 에 저장됩니다.

---

## 2. OpenInference Semantic Conventions

Arize Phoenix 는 [OpenInference Semantic Conventions](https://github.com/Arize-ai/openinference-semantic-conventions) 을 따릅니다.

### 필수 Attributes (Eval 을 위해)

#### Request Body 저장
```python
# Input value (req body)
attributes["input.value"] = json.dumps(request_body)
attributes["input.mime_type"] = "application/json"
```

#### Response Body 저장
```python
# Output value (res body)
attributes["output.value"] = json.dumps(response_body)
attributes["output.mime_type"] = "application/json"
```

#### LLM Token Count (비용 분석용)
```python
attributes["llm.token_count.prompt"] = prompt_tokens
attributes["llm.token_count.completion"] = completion_tokens
attributes["llm.token_count.total"] = total_tokens
```

#### Model Information
```python
attributes["llm.model_name"] = "mimo-v2.5-pro-precision"
attributes["llm.model_provider"] = "custom"  # 또는 "openai", "anthropic" 등
```

#### HTTP Attributes (mitmproxy 에서)
```python
attributes["http.method"] = "POST"
attributes["http.url"] = "https://crof.ai/v1/chat/completions"
attributes["http.status_code"] = 200
attributes["http.response.duration_ms"] = 1234
attributes["http.request.body"] = request_text  # 대안
attributes["http.response.body"] = response_text  # 대안
```

---

## 3. Eval 을 위한 필수 정보 목록

### ✅ **필수 (Must Have)**

| 정보 | Attribute Key | 설명 |
|------|---------------|------|
| **Request Body** | `input.value` | 클라이언트에서 보낸 요청 본문 (JSON) |
| **Response Body** | `output.value` | crof.ai 에서 반환한 응답 본문 (JSON) |
| **Model Name** | `llm.model_name` | 사용된 모델 이름 |
| **Model Provider** | `llm.model_provider` | 모델 제공자 (custom, openai 등) |
| **Duration** | `latency_ms` (자동) | 요청/응답 소요 시간 |
| **Status** | `status_code` | 'OK' 또는 'ERROR' |

### ✅ **권장 (Should Have)**

| 정보 | Attribute Key | 설명 |
|------|---------------|------|
| **Token Count** | `llm.token_count.prompt` | 프롬프트 토큰 수 |
| **Token Count** | `llm.token_count.completion` | 응답 토큰 수 |
| **Client ID** | `client.id` | 클라이언트 식별자 (hermes, pi, hindsight) |
| **Client Name** | `client.name` | 클라이언트 이름 |
| **HTTP Method** | `http.method` | HTTP 메서드 (POST, GET 등) |
| **HTTP URL** | `http.url` | 요청 URL |
| **HTTP Status** | `http.status_code` | HTTP 상태 코드 |
| **Timestamp** | `start_time`, `end_time` (자동) | 요청/응답 타임스탬프 |

### ⚠️ **선택 (Nice to Have)**

| 정보 | Attribute Key | 설명 |
|------|---------------|------|
| **Metadata** | `metadata.*` | 추가 메타데이터 (예: `metadata.user_id`) |
| **Prompt Template** | `llm.prompt_template` | 사용된 프롬프트 템플릿 |
| **Tool Calls** | `tool_call.*` | 도구 호출 정보 |
| **Events** | `events.*` | span 내 이벤트 (예: streaming events) |

---

## 4. mitmproxy Script Addon 예제

```python
# assets/mitm/addon.py
from mitmproxy import ctx, flow
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
import json

# Arize Phoenix 설정
ARIZE_ENDPOINT = "http://localhost:6006/v1/traces"
ARIZE_API_KEY = "your-api-key"

# Tracer 설정
provider = TracerProvider()
processor = BatchSpanProcessor(
    OTLPSpanExporter(
        endpoint_url=ARIZE_ENDPOINT,
        headers={"Authorization": f"Bearer {ARIZE_API_KEY}"}
    )
)
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)
tracer = trace.get_tracer(__name__)

def request(flow: flow.Request):
    # crof.ai 으로 forward
    flow.request.url = "https://crof.ai" + flow.request.url
    
    # Tracing span 생성
    with tracer.start_as_current_span(f"{flow.request.method} {flow.request.path}") as span:
        # HTTP attributes
        span.set_attribute("http.method", flow.request.method)
        span.set_attribute("http.url", flow.request.url)
        span.set_attribute("client.id", ctx.client.id)
        span.set_attribute("client.name", ctx.client.name)
        
        # Request body (input.value)
        if flow.request.text:
            try:
                body = json.loads(flow.request.text)
                span.set_attribute("input.value", json.dumps(body))
                span.set_attribute("input.mime_type", "application/json")
            except json.JSONDecodeError:
                span.set_attribute("input.value", flow.request.text)
                span.set_attribute("input.mime_type", "text/plain")
        
        # Request headers
        span.set_attribute("http.request.headers", json.dumps(dict(flow.request.headers)))

def response(flow: flow.Response):
    # Tracing span 에 res body 저장
    with tracer.get_current_span() as span:
        span.set_attribute("http.status_code", flow.response.status)
        span.set_attribute("http.response.duration_ms", flow.response.time)
        
        # Response body (output.value)
        if flow.response.text:
            try:
                body = json.loads(flow.response.text)
                span.set_attribute("output.value", json.dumps(body))
                span.set_attribute("output.mime_type", "application/json")
            except json.JSONDecodeError:
                span.set_attribute("output.value", flow.response.text)
                span.set_attribute("output.mime_type", "text/plain")
        
        # LLM attributes (응답에 model info 가 있다면)
        if "model" in flow.response.json() if flow.response.is_json() else False:
            resp = flow.response.json()
            span.set_attribute("llm.model_name", resp.get("model", "unknown"))
            span.set_attribute("llm.model_provider", "custom")
            
            # Token count (있다면)
            if "usage" in resp:
                usage = resp["usage"]
                span.set_attribute("llm.token_count.prompt", usage.get("prompt_tokens", 0))
                span.set_attribute("llm.token_count.completion", usage.get("completion_tokens", 0))
                span.set_attribute("llm.token_count.total", usage.get("total_tokens", 0))
        
        # Status
        if flow.response.status >= 400:
            span.set_status("ERROR", "HTTP error")
        else:
            span.set_status("OK")
```

---

## 5. mitmproxy 실행 스크립트

```bash
#!/usr/bin/env bash
# scripts/mitm.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

exec uvx --from=mitmproxy==12.2.3 mitmweb \
    --mode=reverse:https://crof.ai \
    --no-web-open-browser \
    --listen-port=8081 \
    --addons=script:assets/mitm/addon.py
```

---

## 6. Arize Phoenix 설정

```bash
#!/usr/bin/env bash
# scripts/phoenix.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

export PHOENIX_COLLECTOR_ENDPOINT="http://localhost:6006"
export PHOENIX_API_KEY="your-api-key"
export PHOENIX_PROJECT_NAME="nailed-it-eval"

exec uvx --from=arize-phoenix==16.0.0 phoenix serve
```

---

## 7. Eval 시나리오

### 시나리오 1: 클라이언트별 성능 분석
```sql
-- Hermes 의 요청만 조회
SELECT 
    attributes->>'client.id' as client_id,
    attributes->>'llm.model_name' as model,
    AVG((end_time - start_time) * 1000) as avg_latency_ms,
    COUNT(*) as request_count
FROM traces
JOIN spans ON traces.id = spans.trace_rowid
WHERE attributes->>'client.id' = 'hermes'
GROUP BY client_id, model;
```

### 시나리오 2: 오류 요청 분석
```sql
-- 오류가 발생한 요청만 조회
SELECT 
    attributes->>'client.id' as client_id,
    attributes->>'input.value' as request_body,
    attributes->>'output.value' as response_body,
    status_message
FROM traces
JOIN spans ON traces.id = spans.trace_rowid
WHERE status_code = 'ERROR';
```

### 시나리오 3: 모델별 응답 품질 분석
```sql
-- 모델별 응답 길이 분석
SELECT 
    attributes->>'llm.model_name' as model,
    LENGTH(attributes->>'output.value') as avg_response_length,
    COUNT(*) as request_count
FROM traces
JOIN spans ON traces.id = spans.trace_rowid
GROUP BY model;
```

---

## 8. 결론

**HAR 파일이 필요 없습니다!**

- ✅ **Tracing 만으로도 req body 와 res body 를 저장 가능**
- ✅ **Arize Phoenix 에서 검색/분석/시각화 모두 가능**
- ✅ **SQL 쿼리로 유연한 분석 가능**
- ✅ **Eval 시나리오별 필터링 가능**

**필수 Attributes:**
1. `input.value` - Request body
2. `output.value` - Response body
3. `llm.model_name` - 모델 이름
4. `client.id` - 클라이언트 식별자
5. `http.status_code` - HTTP 상태 코드
6. `latency_ms` - 소요 시간

이 정보만 있으면 Arize Phoenix 로 완전한 eval 이 가능합니다! 🚀
