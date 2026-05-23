# Nailed It!

Perfection? 💯 Chaos? 🤡
Harry's AI AgentOps Environment.

## My Environment

- macOS 26.4
- bash
- brew
- uv 0.11
- pnpm 11
- Python 3.14
- Node.js 24
- PostgreSQL 18

## Dependencies

```sh
uv sync --all-packages

# tree-sitter requires C++20
CXXFLAGS=-std=c++20 pnpm i
```

## 설정

```sh
# 서브모듈 초기화
uv run dev-cli setup git-submodules

# PostgreSQL 확장 설치
uv run dev-cli setup pg-config

# LiteLLM for Hindsight
uv run dev-cli setup ll-hs

# Hindsight API
uv run dev-cli setup hs-api

# Hindsight Web
uv run dev-cli setup hs-web
```

## 실행

```sh
# Langfuse
cd external/langfuse && docker compose up -d

# LiteLLM for Hindsight
sh assets/ll-hs/run.sh

# Hindsight API
sh assets/hs-api/run.sh

# Hindsight Web
sh assets/hs-web/run.sh
```

## 구조

```
python-packages/
├── dev-cli/                        # CLI 도구 (Python)
│   └── src/dev_cli/commands/
│       ├── setup/                  # 개발 환경 설정
│       │   ├── git_submodules.py   # 서브모듈 초기화
│       │   ├── hermes_config.py    # Hermes Agent 설정
│       │   ├── hs_api.py           # Hindsight API (uv tool)
│       │   ├── hs_web.py           # Hindsight Web (npm global)
│       │   ├── ll_hs.py            # LiteLLM for Hindsight (uv tool)
│       │   ├── opencode_config.py  # OpenCode 설정
│       │   ├── pg_config.py        # PostgreSQL 확장 설치
│       │   ├── pi_config.py        # Pi Coding Agent 설정
│       │   └── global_skills.py    # 전역 스킬 심볼릭 링크
│       └── models_dev.py           # models.dev API 조회
└── nailed-it-hermes/               # Hermes Agent 플러그인

packages/
├── pi/                     # Pi Coding Agent 확장 모음
│   └── extensions/
│       ├── activate-skill.ts   # 스킬 활성화
│       ├── bash.ts             # bash 실행
│       ├── elapsed-time.ts     # 경과 시간 표시
│       ├── fd.ts               # fd 검색
│       ├── find.ts             # find 검색
│       ├── gh.ts               # GitHub CLI
│       ├── grep.ts             # grep 검색
│       ├── hindsight.ts        # 장기기억 (retain/recall)
│       ├── ls.ts               # ls 파일 목록
│       ├── max-tokens.ts       # 모델별 max_tokens 설정
│       ├── notify.ts           # 시스템 알림
│       ├── rg.ts               # ripgrep 검색
│       ├── tavily.ts           # Tavily 검색 및 추출
│       ├── temperature-zero.ts # temperature 0 설정
│       ├── usages.ts           # 사용량 조회
│       ├── web-fetch.ts        # 웹 페이지 페치
│       └── web-search.ts       # 웹 검색

skills-src/
├── memory/                      # Hindsight 장기기억
└── tavily/                      # Tavily 검색 및 추출

external/
├── langfuse/           # Langfuse observability (docker compose)
├── hermes-agent/       # Hermes Agent (서브모듈)
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

# Hermes Agent (venv 생성 → 의존성 설치 → config/plugin/명령어 링크)
uv run dev-cli setup hermes-config

# LiteLLM for Hindsight (uv tool)
uv run dev-cli setup ll-hs

# Hindsight API (uv tool)
uv run dev-cli setup hs-api

# Hindsight Web (npm global)
uv run dev-cli setup hs-web

# OpenCode 설정 파일 링크
uv run dev-cli setup opencode-config

# PostgreSQL 확장 빌드 및 설치 (VectorChord, pg_tokenizer, bm25)
uv run dev-cli setup pg-config

# Pi Coding Agent 설정 파일 링크 + 패키지 설치
uv run dev-cli setup pi-config

# 전역 스킬 심볼릭 링크 (skills-src/ → ~/.agents/skills/)
uv run dev-cli setup global-skills

# models.dev API에서 프로바이더/모델 정보 조회
uv run dev-cli models-dev providers
uv run dev-cli models-dev models openai
uv run dev-cli models-dev model openai gpt-4o
```

## 환경변수

- `.env.hs-api` — Hindsight API
- `.env.ll-hs` — LiteLLM for Hindsight (Langfuse, CrofAI)

## 라이선스

MIT
