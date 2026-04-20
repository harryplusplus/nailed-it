# Hindsight Plugin ensure_ascii 버그 조사

## 개요

hermes-agent의 Hindsight 플러그인에서 `json.dumps(messages)` 기본값(`ensure_ascii=True`)으로 인해 한국어 등 non-ASCII 텍스트가 `\uXXXX` 이스케이프되어 Hindsight에 저장되는 버그.

- **PR**: https://github.com/NousResearch/hermes-agent/pull/13090
- **브랜치**: `fix/hindsight-unicode-retain`
- **포크**: `harryplusplus/hermes-agent`
- **수정**: `plugins/memory/hindsight/__init__.py` 라인 732 — `ensure_ascii=False` 추가

---

## json.dumps 호출 위치 분석

`plugins/memory/hindsight/__init__.py` 내 `json.dumps` 6곳:

| 라인 | 코드 | 방향 | 한국어 가능성 | 수정 필요 |
|------|------|------|:---:|:---:|
| 259 | `json.dumps(existing, indent=2)` | config 파일 저장 | 낮음 | ❌ |
| **732** | `json.dumps(messages)` | **→ Hindsight API (aretain_batch)** | **높음** | **✅** |
| 801 | `json.dumps({"result": "Memory stored..."})` | LLM 반환 | 없음 (영어 고정) | ❌ |
| 826 | `json.dumps({"result": "No relevant..."})` | LLM 반환 | 없음 (영어 고정) | ❌ |
| 828 | `json.dumps({"result": "\n".join(lines)})` | Hindsight API → LLM | 높음 | 🔍 확인 필요 |
| 844 | `json.dumps({"result": resp.text or "..."})` | Hindsight API → LLM | 높음 | 🔍 확인 필요 |

- 732번: retain 요청의 content — **확정 문제, 수정 완료**
- 828, 844번: recall/reflect 결과를 LLM에게 반환 — 별도 확인 필요

---

## Hindsight DB 스키마 조사

접속: `postgresql://harry@localhost:5432/hindsight`

### Retain 파이프라인

```
content (retain 요청)
  → documents.original_text   (원문 통째로, 1 row)
  → chunks.chunk_text         (원문 청킹 결과, N rows, LLM 팩트 추출의 입력 단위)
  → memory_units.text         (LLM이 추출한 팩트, 한국어 정상)
```

### 주요 테이블/컬럼

| 테이블 | 컬럼 | 타입 | escaped 영향 | 비고 |
|--------|------|------|:---:|------|
| `documents` | `original_text` | text | ❌ escaped 저장 | 원문 보존용 |
| `chunks` | `chunk_text` | text | ❌ escaped 저장 | BM25 인덱스 없음 |
| `memory_units` | `text` | text | ✅ 한국어 정상 | LLM 추출 팩트 |
| `memory_units` | `embedding` | vector(1024) | ✅ 정상 | `text` 기반 임베딩 |
| `memory_units` | `search_vector` | bm25vector | ✅ 정상 | `text` 기반 BM25 |

### BM25 검색 구조

- `HINDSIGHT_API_TEXT_SEARCH_EXTENSION=vchord` (llmlingua2 토크나이저)
- BM25 인덱스: `idx_memory_units_text_search` on `memory_units.search_vector`
- **chunks에는 BM25 인덱스 없음** — BM25 검색은 `memory_units.search_vector` 기반으로만 동작
- `search_vector`는 `memory_units.text` 기반으로 생성되므로, `ensure_ascii`와 무관하게 정상 동작

### 실제 DB 확인 쿼리

```sql
-- escaped 한국어가 저장된 documents 확인
SELECT left(original_text, 200) FROM documents
WHERE bank_id='openclaw' AND original_text LIKE '%\\u%'
ORDER BY created_at DESC LIMIT 3;

-- escaped chunk 확인
SELECT left(chunk_text, 200) FROM chunks
WHERE bank_id='openclaw' AND chunk_text LIKE '%\\u%'
ORDER BY created_at DESC LIMIT 3;

-- LLM 추출 팩트는 한국어 정상
SELECT left(text, 200) FROM memory_units
WHERE bank_id='openclaw' AND document_id IN (
  SELECT id FROM documents WHERE original_text LIKE '%\\ub098%' AND bank_id='openclaw'
)
ORDER BY created_at ASC LIMIT 5;

-- BM25 search_vector 내용
SELECT left(search_vector::text, 200) FROM memory_units
WHERE bank_id='openclaw' AND search_vector IS NOT NULL
ORDER BY created_at DESC LIMIT 1;
```

---

## 임베딩 모델 검증 (bge-m3)

```python
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer('BAAI/bge-m3')

# 단어 수준
cosine('나', '\\ub098') = 0.47       # 매우 다르게 임베딩
cosine('나', '로그') = 0.43
cosine('\\ub098', '\\ub85c\\uadf8') = 0.82  # escaped끼리는 유사

# 문장 수준
original = '나 Hermes Agent 로그 보는 방법'
escaped  = '\\ub098 Hermes Agent \\ub85c\\uadf8 \\ubcf4\\ub294 \\ubc29\\ubc95'
cosine(original, escaped) = 0.60     # 의미가 달라짐
```

결론: 임베딩 모델은 `"나"`와 `"\ub098"`을 전혀 다른 것으로 본다. 하지만 Hindsight는 `memory_units.text` 기반으로 임베딩하므로 실제 검색엔 영향 없음.

---

## 토크나이저 비교 (tiktoken, gpt-4o)

| Text | `ensure_ascii=True` | `ensure_ascii=False` | 증가율 |
|------|---------------------|---------------------|--------|
| `안녕 こんにちは 你好` | 31 tokens | 8 tokens | +287% |
| `👨‍👩‍👧‍👦 family` | 43 tokens | 14 tokens | +207% |
| `나 Hermes Agent 로그 보는 방법` | 29 tokens | 8 tokens | +262% |

LLM은 escaped 문자열을 이해할 수 있지만, 토큰 수가 크게 증가하여 비용/지연 증가.

---

## 테스트 설계 인사이트

`json.loads` round-trip 검증으로는 이 버그를 잡을 수 없음:

```python
# 둘 다 "안"으로 디코딩됨 — 테스트가 통과해버림
json.loads(json.dumps("안", ensure_ascii=True))   # "안"
json.loads(json.dumps("안", ensure_ascii=False))  # "안"
```

직렬화된 문자열 자체를 검사해야 함:

```python
# 직렬화 상태 비교 — 이것만이 버그를 잡음
json.dumps("안", ensure_ascii=True)   # '"\\uc548"'  ← "안" 없음
json.dumps("안", ensure_ascii=False)  # '"안"'       ← "안" 있음
```

작성한 테스트: `test_sync_turn_preserves_unicode` — 직렬화된 content 문자열에 `"안녕"`, `"こんにちは"`, `"你好"`, `"👨‍👩‍👧‍👦"`가 있는지 확인.

---

## 기여 가이드 요약 (hermes-agent)

- **CONTRIBUTING.md**: https://github.com/NousResearch/hermes-agent/blob/main/CONTRIBUTING.md
- **브랜치 네이밍**: `fix/description`, `feat/description`
- **커밋 메시지**: Conventional Commits — `fix(hindsight): ...`
- **PR 전 체크리스트**: `pytest tests/ -v`, 수동 테스트, 하나의 논리적 변경만
- **개발 환경**: `uv venv venv --python 3.11 && uv pip install -e ".[all,dev]"`