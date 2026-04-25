# Nailed It!

Harry 개인 AI 인프라. Hindsight 장기기억 + Pi 코딩 에이전트 + 각종 도구들.

```sh
# Hindsight API 서버 실행 (tmux)
tmux new -s hs-api uv run --env-file .env hindsight-api

# 웹 대시보드
tmux new -s hs-web 'pnpm run --filter @nailed-it/hs-web start'
```

## 구조

```
packages/
├── hs-web/          # Hindsight 웹 대시보드
├── pi/              # Pi 코딩 에이전트 확장 모음
│   └── extensions/
│       ├── hindsight.ts   # 장기기억 (retain/recall)
│       ├── max-tokens.ts  # 모델별 max_tokens 설정
│       └── ...            # fd, rg, gh 등 도구 확장
├── cli/             # CLI 도구
└── opencode/        # OpenCode 플러그인

scripts/
└── test_retain_models.py  # Hindsight retain용 모델 벤치마크

external/
├── hindsight/       # Hindsight API (서브모듈)
├── hermes-agent/    # Hermes 에이전트
└── VectorChord/     # 벡터 검색 확장
```

## Hindsight Retain 모델 벤치마크

Hindsight가 대화에서 사실(fact)을 추출할 때 쓰는 LLM 모델 성능 비교.

### deepseek-v4-flash:cloud vs gpt-oss:20b

| 항목 | deepseek-v4-flash:cloud | gpt-oss:20b |
|------|------------------------|-------------|
| **평균 응답 시간** | 67.1초 | **23.7초** |
| **평균 fact 수** | 3.7개 | **5.7개** |
| **한국어 처리** | ✅ **한국어 유지** | ❌ **영어로 번역함** |
| **토큰 효율** | 평균 5,659 tokens | 평균 **5,004 tokens** |

### 결론

- **한국어 쓰는 프로젝트면 deepseek-v4-flash:cloud.** gpt-oss:20b는 시스템 프롬프트에 "입력 언어로 출력하라"고 해도 무시하고 영어로 번역해버림. retain 품질에 치명적.
- **속도는 gpt-oss:20b가 3배 빠름.** 영어 전용이거나 속도가 중요하면 고려할 만함.
- **JSON 안정성은 deepseek-v4-flash:cloud.** 항상 깔끔한 JSON을 바로 반환해서 추가 파싱 로직이 필요 없음.

### 테스트해보기

```sh
# 기본 모델 목록으로 테스트
python3 scripts/test_retain_models.py

# 특정 모델만 테스트
python3 scripts/test_retain_models.py deepseek-v4-flash:cloud gpt-oss:20b
```

결과는 `scripts/retain_benchmark_results.json`에 저장됨.

## 환경변수

`.env.example` 참고:

```
HINDSIGHT_API_LLM_MODEL=gemini-3-flash-preview   # retain용 모델
HINDSIGHT_API_LLM_TIMEOUT=120                     # 타임아웃 (초)
HINDSIGHT_API_LLM_MAX_CONCURRENT=3                # 동시 요청 수
```

## 라이선스

MIT
