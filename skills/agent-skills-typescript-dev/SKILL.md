---
name: agent-skills-typescript-dev
description: >-
  Agent Skills 내 TypeScript 스크립트의 코드 품질을 검사하는 스킬입니다.
  oxfmt 포맷/oxlint 린트와 oxlint --type-aware --type-check 타입체크를
  Agent Skills 스크립트 관례에 맞게 실행합니다. Agent Skills에 TypeScript
  스크립트를 포함할 때, 스크립트 품질 검사나 erasableSyntaxOnly 준수
  확인이 필요할 때 사용하세요.
license: MIT
compatibility: "Node.js ^20.19.0 || >=22.12.0, pnpm 필요"
metadata:
  author: al-jal-ttak-kkal-sen
  version: "1.0"
---

# Agent Skills TypeScript Development

Agent Skills 내 TypeScript 스크립트의 코드 품질을 검사합니다.

Agent Skills 스펙은 스크립트 포함 시 다음 관례를 권장합니다:
- 자체 포함 또는 의존성을 명확히 문서화
- JSON 출력은 stdout, 진단은 stderr
- 대화형 입력 금지 (argparse 등 사용)
- 의미 있는 종료 코드

이 스킬은 위 관례에 맞춘 oxfmt/oxlint 설정을 사용합니다.
프로젝트의 설정 파일에 의존하지 않습니다.

## 사용 가능한 스크립트

- **`scripts/check.ts`** — oxfmt 포맷 + oxlint 린트 + oxlint 타입체크

## 워크플로우

### 전체 검사

```bash
pnpm tsx scripts/check.ts <path>...
```

### 자동 수정

```bash
pnpm tsx scripts/check.ts <path>... --fix
```

### 개별 검사

```bash
pnpm tsx scripts/check.ts <path>... --format-only
pnpm tsx scripts/check.ts <path>... --lint-only
pnpm tsx scripts/check.ts <path>... --typecheck-only
```

### 빠른 검사 (타입체크 생략)

```bash
pnpm tsx scripts/check.ts <path>... --format-only --lint-only
```

## 설정

`assets/.oxfmtrc.jsonc`, `assets/.oxlintrc.json`, `assets/tsconfig.strict.json`의 설정을 사용합니다:

| 설정 | 값 | 이유 |
|------|-----|------|
| lineWidth / printWidth | 120 | 스크립트는 프로젝트보다 관대 |
| indentWidth | 2 | TypeScript 관례 |
| erasableSyntaxOnly | true | 런타임 코드 생성 없이 타입만 제거 가능한 구문 허용 |
| strict | true | 장기 유지보수 용이 |
| noUncheckedIndexedAccess | true | 인덱스 접근 시 안전 |
| lint categories | correctness(error), suspicious(warn) | 합리적 기본 규칙 세트 |

프로젝트 설정에 의존하지 않고 `--config`/`--tsconfig`로 스킬 내장 설정을 강제합니다.

## 다른 스킬과의 관계

- **agent-skills-dev**: 스펙 검증(validate), 속성 읽기, 스캐폴딩
- **agent-skills-python-dev**: Python 스크립트 품질 검사 (ruff + pyright)
- **agent-skills-typescript-dev** (이 스킬): TypeScript 스크립트 품질 검사 (oxfmt + oxlint + tsgolint)
- **agent-skills-review**: 종합 검수 (위 스킬들을 모두 호출)

## 주의사항

- `pnpx`로 oxfmt/oxlint/tsgolint를 실행하므로 pnpm이 설치되어 있어야 합니다.
- `--type-aware --type-check`는 `oxlint-tsgolint` 패키지가 필요합니다. 스크립트가 자동으로 `pnpx`로 실행합니다.
- 타입체크는 oxlint가 tsgolint(내부적으로 typescript-go 사용)를 호출하여 수행합니다. 별도의 `tsgo` 설치가 필요하지 않습니다.
- `erasableSyntaxOnly: true` 설정으로 `enum`, `namespace`, `const enum` 등 런타임 코드를 생성하는 구문이 금지됩니다. `type`, `interface`, `as const` 등 타입만 제거 가능한 구문을 사용하세요.