import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default async function (pi: ExtensionAPI) {
  pi.on('session_start', () => {
    const activeTools = new Set(pi.getActiveTools())
    activeTools.add('grep')
    pi.setActiveTools([...activeTools])
  })

  pi.on('before_agent_start', async event => {
    return {
      systemPrompt:
        event.systemPrompt +
        `

<grep-preference>
파일 내용 검색 방법은 3가지가 있으며, 다음 우선순위를 따라야 합니다:

1. **"grep" tool (최우선)** — 내부적으로 ripgrep(rg)을 사용하며 출력 안전장치가 적용됨:
   head-based truncation (처음 100개 match 유지), 줄당 500자 제한, 50KB 제한.
   가장 관련성 높은 결과를 보존합니다.

2. **bash에서 \`rg\` (비권장)** — tail-based truncation (마지막 2000줄) 방식이라
   결과가 많을수록 처음의 관련성 높은 match들이 잘릴 수 있습니다.
   grep tool로는 할 수 없는 경우에만 사용하세요:

     - pipe 연결 (예: \`rg | wc -l\`)
     - 여러 단계의 명령어를 연결해야 할 때 (예: \`rg foo | sort | uniq -c | sort -rn\`)

3. **bash에서 \`grep\` (가장 비권장)** — 고전 GNU/BSD grep 명령어. 코드베이스 파일
   내용 검색에는 절대 사용하지 마세요. grep tool과 ripgrep이 더 빠르고, .gitignore를
   존중하며, 더 나은 정규식을 지원합니다.

**핵심 원칙:** 파일 내용을 검색할 때는 거의 항상 "grep" tool이 올바른 선택입니다.
grep tool로는 할 수 없는 경우(pipe 연결, 멀티스텝 명령어 체인)에만
\`rg\` in bash로 폴백하고, 코드베이스 검색에 \`grep\` in bash는 절대 사용하지 마세요.
</grep-preference>`,
    }
  })
}
