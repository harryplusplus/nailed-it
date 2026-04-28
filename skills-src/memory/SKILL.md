---
name: memory
description: "새로운 대화가 시작되면 항상 활성화하세요. Hindsight 장기기억 시스템 스킬입니다. 대화 중 중요한 사실, 절차, 선호, 프로젝트 지식을 발견하면 사용자가 요청하지 않아도 자동으로 저장(retain)하세요. 과거 기억을 찾을 때는 회상(recall), 기억을 종합적으로 분석할 때는 숙고(reflect)하세요. '기억해', '저장해', '이전에 말했던 거 기억나?', '회고', '정리해' 등의 명시적 요청에도 활성화하세요."
license: MIT
compatibility: hindsight CLI가 설치되어 있어야 합니다. Hindsight 서버가 실행 중이어야 합니다.
metadata:
  author: "Nailed It!"
  version: "1.0"
allowed-tools: Bash(hindsight:*)
---

# Hindsight 장기기억 스킬

Hindsight CLI를 사용해 대화 맥락, 사실, 절차를 장기기억에 저장하고 회상합니다.

## 전제 조건

- `hindsight` CLI가 설치되어 있어야 합니다 (`~/.local/bin/hindsight`)
- Hindsight 서버가 실행 중이어야 합니다 (기본: `http://localhost:8888`)
- Bank ID: `openclaw`

## 핵심 명령어

### 기억 저장 (retain)

```bash
hindsight memory retain openclaw "<저장할 내용>" --context "<컨텍스트>" --async
```

- `--async`는 **반드시** 사용하세요. `--async` 없이 실행하면 Hindsight 서버의 LLM 처리가 완료될 때까지 터미널이 행잉(멈춤)되어 대화가 완전히 중단됩니다.
- `--context` 옵션: 콘텐츠의 성격과 출처를 설명합니다. **반드시 설정하세요.** 추출 품질에 큰 영향을 미칩니다.
  - 좋은 예: `--context learnings`, `--context procedures`, `--context preferences`, `--context "architecture review session"`, `--context "weekly standup notes"`
  - 나쁜 예: `--context conversation`, `--context data` (너무 일반적)
  - 생략하면 추출 품질이 현저히 떨어집니다.

예시:
```bash
# 학습 내용 저장
hindsight memory retain openclaw "GitHub PR 컨플릭트 리졸브는 항상 rebase로 해결한다" --context learnings --async

# 절차 저장
hindsight memory retain openclaw "배포 절차: 1) 테스트 실행 2) 버전 업 3) 태그 생성 4) 푸시" --context procedures --async

# 사용자 선호 저장
hindsight memory retain openclaw "사용자가 한국어로 응답을 선호함" --context preferences --async
```

### 기억 회상 (recall)

```bash
hindsight memory recall openclaw "<검색어>"
```

- `--budget`: 검색 깊이 (`low`, `mid`, `high`, 기본값: `mid`)
- `--tags`: 태그 필터 (쉼표 구분)
- `--fact-type`: 팩트 타입 필터 (`world`, `experience`, `opinion`)

예시:
```bash
# 일반 회상
hindsight memory recall openclaw "PR 컨플릭트 해결 방법"

# 태그 필터
hindsight memory recall openclaw "배포 절차" --tags procedures

# 깊은 검색
hindsight memory recall openclaw "복잡한 이슈" --budget high
```

### 숙고 (reflect)

```bash
hindsight memory reflect openclaw "<질문>"
```

저장된 기억을 바탕으로 숙고(추론·종합)하여 답변을 생성합니다.

예시:
```bash
hindsight memory reflect openclaw "지금까지 배운 배포 관련 지식을 정리해줘"
```

### 기타 명령어

```bash
# 뱅크 통계
hindsight bank stats openclaw

# 뱅크 설정 확인
hindsight bank config openclaw

# 메모리 목록
hindsight memory list openclaw
```

## 주의사항

- `retain` 시 **반드시 `--async`** 플래그를 사용하세요. 누락하면 터미널이 행잉되어 대화가 멈춥니다.
- Bank ID는 항상 `openclaw`입니다.
- 서버가 응답하지 않으면 사용자에게 Hindsight 서버 상태를 확인하라고 안내하세요.
- `recall`과 `reflect`는 `--async`를 사용하지 않습니다 (동기 명령어).