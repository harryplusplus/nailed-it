# AI 작업자 가이드라인

당신은 Nailed It! 프로젝트 AI 작업자입니다. 아래 가이드를 준수하세요.

- 모르는 것이 있거나 모호한 부분이 있을 경우에 **절대 함부로 단정하지 말고** 사용자에게 물어보세요.
- `README.md` — 프로젝트가 무엇이며, 이 프로젝트를 왜 하는지와 같은 프로젝트 전반적인 내용을 다룹니다.
  외부인이 프로젝트를 봤을 때 전반적인 내용을 이해할 수 있어야 합니다.
- `AGENTS.md` (이 파일) — AI 작업자가 준수해야하는 가이드라인입니다.
  하지만 AGENTS.md 파일의 내용에 대해서 이해가 되지 않는 것은 질문을 하거나 모호한 것은 어떻게 개선하면 좋을지 본인의 의견을 제시하세요.
- Commit 메시지는 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)를 따르세요.
  - Commit 메시지의 언어는 관용적인 영어를 사용하세요.
    하지만 유니코드 예제(e.g. "안녕하세요") 또는 특정 한국어가 고유명사/용어로 사용되는 경우에는 원어를 존중하세요.

## 리팩터링 가이드

- 리팩터링 후 쓸모없어진 변수는 인라인하고 삭제하세요.
  - Don't:
    ```python
    log_dir = _LOGS_DIR # <- 리팩터링 전에는 _LOG_DIR_BASE / svc_name 이었지만,
                        #    서브폴더 제거 후엔 그냥 alias일 뿐
    handler = RotatingFileHandler(str(log_dir / f"{svc_name}.log"), ...)
    ```
    Do:
    ```python
    handler = RotatingFileHandler(str(_LOGS_DIR / f"{svc_name}.log"), ...)
    ```

## Python 작업 가이드

- [Google Python Style Guide](https://google.github.io/styleguide/pyguide.html)를 따르세요.
  - `pylint` 관련 항목은 제외하세요. 이 프로젝트는 `ruff` 및 `pyrefly`를 사용하기 때문입니다.
- `# -- Helpers ----------------`와 같은 섹션 구분 주석은 사용하지 마세요.
  Python 파일은 모듈이고 모듈은 docstring 공간이 있습니다.
  만약 섹션 구분을 사용해버렸다면 기존 모듈 구조를 파악한 후 신규 모듈을 추가하거나 기존 모듈에 기능을 추가하고 모듈의 docstring을 업데이트하세요.
- Python 파일 변경 후 항상 아래 명령줄을 다음과 같은 순서대로 실행하고 경고나 오류가 없도록 수정하세요.
  - `uv run ruff format <foo.py> <bar.py>`: 포매팅
  - `uv run ruff check --fix <foo.py> <bar.py>`: 린팅 및 자동 수정
  - `uv run pyrefly check <foo.py> <bar.py>`: 타입 체킹

## TypeScript 작업 가이드

- TypeScript 파일 변경 후 항상 아래 명령줄을 다음과 같은 순서대로 실행하고 경고나 오류가 없도록 수정하세요.
  - `pnpm oxfmt <foo.ts> <bar.ts>`: 포매팅
  - `pnpm oxlint --type-check <foo.ts> <bar.ts>`: 린팅 및 타입 체킹
- `package.json`을 변경한 후에도 oxfmt를 호출하세요.
- 함수는 동기 버전 (e.g. fs.readFileSync) 대신에 Promise 버전(e.g. fs.promises.readFile)을 사용하세요.
  - 동기 버전은 아주 특수한 경우에만 필요합니다. 대부분의 어플리케이션 코드에서 필요하지 않습니다.
- Node.js 내장 모듈은 named import 대신 default import를 사용하세요.
  - `node:path` → `import path from 'node:path'`
  - `node:os` → `import os from 'node:os'`
  - `node:fs` → `import fs from 'node:fs'`
