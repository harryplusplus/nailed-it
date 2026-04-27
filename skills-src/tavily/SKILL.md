---
name: tavily
description: "Tavily 검색 및 웹 콘텐츠 추출 스킬입니다. 최신 정보 검색, 사실 확인, 웹 페이지에서 깔끔한 콘텐츠 추출이 필요할 때 사용하세요."
license: MIT
compatibility: uv가 필요합니다.
metadata:
  author: harry
  version: "1.0"
---

# Tavily 검색 및 추출

[Tavily](https://tavily.com) API를 사용해 실시간 웹 검색과 웹 페이지 콘텐츠 추출을 수행합니다.

## 전제 조건

- `TAVILY_API_KEY` 환경변수가 설정되어 있어야 합니다.
- `uv`가 설치되어 있어야 합니다.
- 인터넷 접속이 가능해야 합니다.

## 사용법

### 검색

```bash
./scripts/tavily.py search "검색어"
```

```bash
./scripts/tavily.py search "검색어" --max-results 10 --search-depth advanced --include-answer
```

### 웹 페이지 추출

```bash
./scripts/tavily.py extract "https://example.com"
```

```bash
./scripts/tavily.py extract "https://a.com" "https://b.com" --extract-depth advanced
```

## 옵션

### search

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--max-results`, `-n` | 5 | 최대 결과 개수 (1-20) |
| `--search-depth`, `-d` | basic | 검색 깊이: `basic` (빠름), `advanced` (깊음) |
| `--include-answer`, `-a` | false | AI 생성 요약 포함 |

### extract

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--extract-depth`, `-d` | basic | 추출 깊이: `basic`, `advanced` |

## 출력 형식

모든 명령은 JSON 형식으로 stdout에 출력합니다.

## 주의사항

- `TAVILY_API_KEY`가 설정되지 않은 경우 오류 메시지가 출력됩니다.
- Search 기본은 1 credit, advanced는 2 credits를 소모합니다.
- Extract는 URL 5개당 1 credit을 소모합니다.
