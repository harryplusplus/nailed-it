# 프로젝트 가이드라인

## Python

Python 파일을 변경한 뒤에는 반드시 ruff와 pyright를 실행해:

```bash
uv run ruff check --fix <path/to/file.py>   # 린트 + 자동 수정
uv run pyright <path/to/file.py>            # 타입 체크
```

오류나 경고는 커밋 전에 모두 수정해.

## TypeScript

TypeScript 파일을 변경한 뒤에는 반드시 oxfmt와 oxlint를 실행해:

```bash
pnpm oxfmt <path/to/file.ts>     # 포맷팅
pnpm oxlint <path/to/file.ts>    # 린트(타입 체크 포함)
```

## package.json

package.json 파일을 변경한 뒤에는 반드시 oxlint를 실행해:

```bash
pnpm oxlint <path/to/package.json>    # 린트(타입 체크 포함)
```

오류나 경고는 커밋 전에 모두 수정해.

### Node.js 내장 모듈 import 규칙

Node.js 내장 모듈은 named import 대신 default import를 사용해:

- `node:path` → `import path from 'node:path'`
- `node:os` → `import os from 'node:os'`
- `node:fs/promises` → `import fs from 'node:fs/promises'`

기본적으로 Promise 기반인 `node:fs/promises`를 써. 동기 `node:fs`(`readFileSync`, `existsSync` 등)는 이벤트 루프를 블로킹하니까, non-async 컨텍스트에서 최상위 초기화처럼 환경이 강제하는 경우에만 써.

이유: 이 모듈들은 flat한 네임스페이스라 `path.join()`, `os.homedir()`, `fs.readFile()` 같은 qualified access에 최적화되어 있어. Destructuring하면 호출 지점이 모호해지고 검색(grep)이 어려워져.
