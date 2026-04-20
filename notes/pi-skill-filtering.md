# Pi 스킬 필터링

## 배경

`~/.agents/skills/`는 Hermes 등 다른 시스템과 공유하는 글로벌 스킬 디렉터리다.
Pi는 경량으로 관리하고 싶어서, 글로벌 스킬 중 일부만 보이게 필터링해야 할 때가 있다.

## 방법

`settings.json`의 `skills` 배열에 override 패턴을 사용한다.
이 패턴은 자동 발견된 스킬(`~/.agents/skills/`, `~/.pi/agent/skills/` 등)에도 적용된다.

### 패턴 문법

| 패턴 | 의미 | 우선순위 |
|------|------|----------|
| `!pattern` | glob 매칭되는 경로 제외 | 낮음 |
| `+path` | 강제 포함 (제외보다 우선) | 중간 |
| `-path` | 강제 제외 (강제 포함보다 우선) | 높음 |

### 설정 위치

- `~/.pi/agent/settings.json` — 글로벌 (모든 프로젝트)
- `.pi/settings.json` — 프로젝트별

### 예시

특정 스킬만 숨기기:

```json
{
  "skills": [
    "!hindsight-architect",
    "!hindsight-docs",
    "!hindsight-self-hosted",
    "!find-skills"
  ]
}
```

glob으로 여러 스킬 한 번에 제외:

```json
{
  "skills": [
    "!hindsight-*"
  ]
}
```

특정 스킬만 허용 (나머지 전부 제외 후 강제 포함):

```json
{
  "skills": [
    "!*",
    "+karpathy-guidelines"
  ]
}
```

## 소스코드 근거

- `package-manager.js`: `isEnabledByOverrides()` 함수가 `!`/`+`/`-` 패턴을 순차 적용
- `skills` 배열에서 `getOverridePatterns()`로 override 패턴만 추출
- 자동 발견 스킬 경로도 `addResources()` 시 `isEnabledByOverrides()`로 필터링됨

## 참고

- `--no-skills` CLI 플래그로 모든 스킬 자동 발견을 비활성화할 수도 있음
- `--no-skills`와 함께 `--skill <path>`를 쓰면 특정 스킬만 로드 가능
- SKILL.md frontmatter에 `disable-model-invocation: true`를 넣으면 시스템 프롬프트에서는 숨겨지지만 `/skill:name` 명령으로는 호출 가능