# Nailed It!

해냈다. 내 AI 환경.

Hindsight 장기기억 + Pi 코딩 에이전트 + 각종 도구들.

```sh
# Hindsight API 서버 실행 (tmux)
tmux new -s hs-api uv run --env-file .env hindsight-api

# 웹 대시보드
tmux new -s hs-web pnpm hindsight-control-plane
```

## 구조

```
python-packages/
└── dev-cli/            # CLI 도구 (Python)
    └── src/dev_cli/commands/
        ├── setup/      # 개발 환경 설정
        │   ├── git_submodules.py   # 서브모듈 초기화
        │   ├── hermes_config.py    # Hermes Agent 설정
        │   ├── opencode_config.py  # OpenCode 설정
        │   ├── pg_config.py        # PostgreSQL 확장 설치
        │   └── pi_config.py        # Pi 에이전트 설정
        └── models_dev.py           # models.dev API 조회

packages/
├── hs-web/             # Hindsight 웹 대시보드
├── pi/                 # Pi 코딩 에이전트 확장 모음
│   └── extensions/
│       ├── hindsight.ts    # 장기기억 (retain/recall)
│       ├── max-tokens.ts   # 모델별 max_tokens 설정
│       └── ...             # fd, rg, gh 등 도구 확장
└── opencode/           # OpenCode 플러그인

external/
├── hindsight/          # Hindsight API (서브모듈)
├── hermes-agent/       # Hermes 에이전트 (서브모듈)
├── VectorChord/        # 벡터 검색 pg extension
├── VectorChord-bm25/   # BM25 pg extension
└── pg_tokenizer.rs/    # 토크나이저 pg extension
```

## CLI 도구

```sh
# 전체 CLI
uv run dev-cli --help

# 개발 환경 설정
uv run dev-cli setup --help

# 서브모듈 클론 및 업데이트
uv run dev-cli setup git-submodules

# Hermes Agent (venv 생성 → config 링크 → 명령어 링크)
uv run dev-cli setup hermes-config

# OpenCode 설정 파일 링크
uv run dev-cli setup opencode-config

# PostgreSQL 확장 빌드 및 설치 (VectorChord, pg_tokenizer, bm25)
uv run dev-cli setup pg-config

# Pi 에이전트 설정 파일 링크 + 패키지 설치
uv run dev-cli setup pi-config

# models.dev API에서 프로바이더/모델 정보 조회
uv run dev-cli models-dev providers
uv run dev-cli models-dev models openai
uv run dev-cli models-dev model openai gpt-4o
```

## 환경변수

`.env.example` 참고:

```
HINDSIGHT_API_LLM_MODEL=gemini-3-flash-preview   # retain용 모델
HINDSIGHT_API_LLM_TIMEOUT=120                     # 타임아웃 (초)
HINDSIGHT_API_LLM_MAX_CONCURRENT=3                # 동시 요청 수
```

## 라이선스

MIT
