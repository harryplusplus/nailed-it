# Nailed It!

에이전트의, 에이전트에 의한, 에이전트를 위한 환경.

Hindsight 장기기억 + Pi Coding Agent + Hermes Agent + 각종 도구들.

## 내 환경

- Python 3.14
- Node.js 24
- PostgreSQL 18

## 실행

```sh
# Hindsight API 서버
tmux new -s hs-api uv run --env-file .env hindsight-api

# Hindsight 웹 대시보드
tmux new -s hs-web pnpm hindsight-control-plane
```

## 의존성 설치

```sh
uv sync --all-packages
CXXFLAGS=-std=c++20 pnpm i
```

## 구조

```
python-packages/
├── dev-cli/                        # CLI 도구 (Python)
│   └── src/dev_cli/commands/
│       ├── setup/                  # 개발 환경 설정
│       │   ├── git_submodules.py   # 서브모듈 초기화
│       │   ├── hermes_config.py    # Hermes Agent 설정
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
│       ├── usage.ts            # 토큰 사용량 표시
│       ├── web-fetch.ts        # 웹 페이지 페치
│       └── web-search.ts       # 웹 검색
└── opencode/               # OpenCode 플러그인

skills-src/
├── tavily/                      # Tavily 검색 및 추출
├── web-search/                  # 웹 검색
├── web-fetch/                   # 웹 페이지 페치
├── memory/                      # Hindsight 장기기억
├── agent-skills-dev/            # 스킬 개발/스캐폴드
├── agent-skills-review/         # 스킬 검수
├── agent-skills-python-dev/     # 스킬 Python 품질 검사
└── agent-skills-typescript-dev/ # 스킬 TypeScript 품질 검사

external/
├── hindsight/          # Hindsight API (서브모듈)
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

`.env.example` 참고.

## 라이선스

MIT
