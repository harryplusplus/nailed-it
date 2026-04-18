# Slay the Spire LLM Agent — 메모리 시스템 설계 노트

## 1. 목표

LLM이 Slay the Spire(StS)를 플레이하면서 **런 간 학습**을 하는 것. 런 내 상태 추적은 메모리가 아니라 게임 상태 직렬화로 처리하고, **런 간 전략 학습**만이 메모리 시스템의 대상이다.

---

## 2. 핵심 원칙

### 2.1 게임 상태 ≠ 메모리

- 현재 덱, HP, 층, 적 = 게임 상태. 메모리가 아님.
- "Ironclad에서 덱이 얇을 때 승리율이 높다" = 런 간 학습. 이게 메모리.
- 게임 상태는 게임 클라이언트/시뮬레이터에서 제공. 메모리 시스템은 런 간 경험만 관리.

### 2.2 StS는 상황바이상황 게임

- "Carnage가 좋다/나쁘다" 같은 정적 규칙이 없음.
- 같은 카드도 상황에 따라 완전히 다른 가치를 가짐.
- StS 고수들의 조언은 항상 "상황에 따라 다르다".
- 따라서 **압축된 통계("Carnage 승률 0%")도 상황을 무시하면 오해의 소지가 있음**.

### 2.3 하드코딩된 전략 규칙은 안 됨

- 초기에 "🔴 Thin deck > Fat deck" 같은 규칙을 하드코딩하는 건 LLM이 배우는 게 아니라 개발자가 가르치는 것.
- 시작은 빈 상태에서 LLM이 직접 경험을 통해 학습해야 함.

### 2.4 LLM 반성(reflection)도 부족

- 런 종료 후 LLM이 "왜 망했는지" 반성하는 건 LLM의 해석이지 사실이 아님.
- "Carnage 때문에 망함"이라고 반성할 수 있지만, 실제 원인은 덱 두께일 수도 있음.
- LLM 반성은 편향(bias)이 있고, 잘못된 인과관계를 만들 수 있음.

### 2.5 메커니즘은 하나: 컨텍스트 주입

- 모든 LLM 메모리 시스템(Mem0, Zep, Mastra OM 등)의 근본 메커니즘은 컨텍스트에 텍스트를 주입하는 것.
- 차이는 **무엇을** 주입하느냐.
- LLM 반성 < 통계적 사실 < 구체적 에피소드 (신뢰도 순서).
- 하지만 통계도 상황을 무시하면 한계가 있음 → StS에서는 **에피소드 중심**이 적합.

---

## 3. 기각된 접근법

### 3.1 외부 메모리 시스템 (Mem0, Zep, Mastra OM 등)

| 이유 | 설명 |
|------|------|
| StS는 유한한 게임 | 카드 ~340장, 유물 ~180개, 적 ~70종. 무한한 지식 그래프가 필요 없음. |
| 관계가 정적 | "Pommel Strike + Double Tap = 시너지"는 어제도 오늘도 참. 시간에 따라 변하는 관계가 아님. |
| 인프라 오버헤드 | Docker + Neo4j/Qdrant/PG 등. StS 에이전트에 과함. |
| LLM 추출 비용 | Zep/Mem0은 LLM으로 엔티티/관계를 추출. StS의 정적 관계를 LLM으로 재발견하는 건 비용 낭비. |

### 3.2 하드코딩된 전략 규칙

```typescript
// ❌ 이런 건 안 함
const DEFAULT_STRATEGY = {
  ironclad: ["🔴 Act 1: 카드 1장/층 제한 엄격히"],
  general: ["🔴 Thin deck > Fat deck"],
};
```

- LLM이 배우는 게 아니라 개발자가 가르치는 것.
- 상황마다 정답이 다른 게임에 정적 규칙은 위험.

### 3.3 LLM 반성 기반 메모리

```
런 종료 → LLM이 "왜 망했는지" 반성 → 텍스트 저장 → 다음 런에 주입
```

- LLM의 해석이 틀릴 수 있음.
- 반성이 쌓이면 노이즈가 됨.
- 인과관계를 잘못 추론할 수 있음 ("Carnage 때문에 망함" vs 실제로는 덱 두께 때문).

### 3.4 통계 중심 메모리

```
"Carnage → 0승 2패 (평균 F15)"
"덱 20장 이하 → 승리율 45%"
```

- 상황을 무시한 압축 통계. StS는 상황바이상황 게임이라 오해의 소지가 있음.
- "Carnage 승률 0%"가 Carnage가 항상 나쁘다는 뜻이 아님. Strength 덱에서는 좋을 수 있음.
- 보조 정보로는 유용하지만 주 정보로는 부적합.

---

## 4. 채택된 접근법: 에피소드 중심 메모리

### 4.1 핵심 아이디어

- 런의 각 **선택**을 독립 에피소드로 저장 (런 전체가 아니라).
- 각 에피소드에는 그 순간의 **전체 상황**을 저장 (덱 리스트, HP, 유물, 층, 선택지, 선택, 결과).
- 다음 런에서 비슷한 상황에 직면하면, **과거 에피소드를 LLM에 보여줌**.
- LLM이 직접 상황을 비교하고 패턴을 발견.
- 시스템은 대충 필터만 하고, 정밀한 유사도 판단은 LLM에게 맡김.

### 4.2 왜 에피소드인가

- StS는 상황마다 정답이 다름 → 상황 전체를 저장해야 함.
- 통계는 상황을 평탄화함 → "Carnage 승률 0%"는 상황을 무시함.
- LLM 반성은 편향이 있음 → 사실(에피소드)을 저장하고 LLM이 판단하게 함.
- 에피소드는 LLM이 "이 상황은 저번 런이랑 비슷하네"라고 직접 비교할 수 있음.

### 4.3 왜 LLM이 유사도를 판단하는가

- StS에서 카드 하나가 덱의 성격을 바꿈. Carnage 하나 = AoE 생김. Inflame 하나 = Strength 방향 열림.
- deckProfile 숫자(공격 60%, 방어 40%)로는 이걸 놓침.
- LLM은 "Strike×5, Defend×4, Bash×1"을 보면 "기본 덱, 아직 아키타입 없음"이라고 이해함.
- LLM은 선택지가 다른 것도 이해함. "과거엔 Carnage가 선택지에 있었지만 지금은 Shrug It Off가 있네."
- 따라서 **숫자 요약이 아니라 원본 에피소드를 LLM에 보여주고, LLM이 직접 판단**하게 함.

---

## 5. 데이터 구조

### 5.1 에피소드

런의 각 선택 포인트를 독립 에피소드로 저장.

```typescript
interface Episode {
  id: string;              // "run7-f6-card"
  runId: number;
  type: "card_reward" | "shop" | "rest_site" | "path" | "event" | "potion_use";
  character: "Ironclad" | "Silent" | "Defect" | "Watcher";
  act: 1 | 2 | 3 | 4;
  floor: number;
  hp: number;
  maxHp: number;
  deck: Record<string, number>;  // { "Strike": 5, "Defend": 4, "Bash": 1 }
  relics: string[];
  options: string[];       // ["Carnage", "Pommel Strike", "Skip"]
  choice: string;          // "Pommel Strike"
  outcome: {
    result: "win" | "loss";
    finalFloor: number;
    cause?: string;         // 사망 원인 (보스 이름 등)
  };
}
```

### 5.2 카드 타입 조회

StS의 모든 카드는 게임이 정의한 타입을 가짐 (하드코딩이 아니라 게임 데이터).

```
Strike     → Attack
Defend     → Skill
Bash       → Attack
Pommel Strike → Attack
Shrug It Off  → Skill
Inflame    → Power
Carnage    → Attack
```

이 데이터는 `CARDS.json` 같은 파일에 저장. 각 카드의 타입, 코스트, 효과 등을 포함.

### 5.3 deckProfile (선택적, 필터용)

에피소드 저장 시 자동 계산. 정밀한 유사도 판단은 LLM이 하지만, 대충 필터링용으로 사용.

```typescript
interface DeckProfile {
  size: number;        // 덱 크기
  attack: number;     // Attack 카드 수
  skill: number;      // Skill 카드 수
  power: number;      // Power 카드 수
  attackPct: number;  // Attack 비율
  skillPct: number;   // Skill 비율
  powerPct: number;   // Power 비율
}
```

계산 예시:
```
덱: Strike×5, Defend×4, Bash×1
→ size: 10, attack: 6, skill: 4, power: 0
→ attackPct: 0.6, skillPct: 0.4, powerPct: 0.0
```

---

## 6. 조회 메커니즘

### 6.1 하드 필터 (반드시 일치)

```
1. 같은 캐릭터 (Ironclad / Silent / Defect / Watcher)
2. 같은 액트 (1 / 2 / 3 / 4)
3. 같은 선택 타입 (card_reward / shop / rest_site / path / event)
```

### 6.2 소프트 정렬 (가까운 순)

```
1. 덱 크기 차이 (|현재 덱 크기 - 과거 덱 크기|)
2. HP 비율 차이 (|현재 HP/maxHP - 과거 HP/maxHP|)
3. 층 차이 (|현재 층 - 과거 층|)
```

### 6.3 최대 5개

필터 + 정렬 후 상위 5개만 LLM에 주입. 컨텍스트 오염 방지.

### 6.4 정밀한 유사도 판단은 LLM에게 맡김

시스템은 대충 필터링만 하고, LLM이 에피소드의 원본 데이터(덱 리스트, 선택지 등)를 보고 직접 판단.

이유:
- deckProfile 숫자로는 카드 하나의 영향을 놓침 (Carnage 하나 = AoE 생김)
- 선택지가 다르면 비슷한 상황이 아닐 수 있음
- LLM이 StS를 이해하므로, 원본 데이터를 보면 어떤 에피소드가 진짜 비슷한지 판단 가능

---

## 7. 정보의 흐름

### 7.1 런 진행 중: 에피소드 기록

```
각 선택 포인트마다:
  현재 상황(덱, HP, 유물, 층, 선택지) + 선택을 에피소드로 저장
```

### 7.2 런 종료 후: 결과 기록

```
모든 에피소드의 outcome 필드 업데이트:
  result: "win" | "loss"
  finalFloor: 50
  cause: "Corrupt Heart" (사망 원인)
```

### 7.3 다음 런 시작 시: 통계 주입

```
[과거 경험 요약 — 7런 데이터]

승리 1회 / 7런 (14%)

덱 크기 vs 결과:
  16장 이하: 1승 0패
  20장 이상: 0승 5패

Act 1 카드 취득 vs 결과:
  1-2장: 1승 2패, 평균 F38
  3장+: 0승 4패, 평균 F16
```

통계는 보조 정보. 큰 그림만 보여줌. 상황 무시한 세부 통계는 안 함.

### 7.4 결정 포인트: 에피소드 주입

```
런 #8, Floor 7 — 카드 보상: [Shrug It Off, Clash, Skip]

[과거 비슷한 상황]

[런 #7 F6] Ironclad A1, HP 62/72
  덱: Strike×5, Defend×4, Bash×1 (10장)
  유물: Burning Blood
  선택지: Carnage / Pommel Strike / Skip
  선택: Pommel Strike → F28 사망 (Slime Boss)

[런 #5 F8] Ironclad A1, HP 45/72
  덱: Strike×5, Defend×4, Bash×1, Shrug It Off×1 (11장)
  유물: Burning Blood
  선택지: Inflame / True Grit / Skip
  선택: Shrug It Off → F50 승리

[런 #3 F6] Ironclad A1, HP 70/72
  덱: Strike×5, Defend×4, Bash×1 (10장)
  유물: Burning Blood
  선택지: Carnage / Inflame / Skip
  선택: Carnage → F12 사망 (Gremlin Nob)
```

LLM이 직접 읽고 판단:
- "런 7이랑 지금이랑 덱이 완전히 같네. 근데 선택지가 다름."
- "런 5는 Shrug It Off 가져갔는데 이겼네. 방어 카드가 Act 1에서 좋은 건가?"
- "런 3에서도 Carnage 가져갔다가 F12에서 죽었네."

### 7.5 런이 쌓일수록

```
런 1-3:  비슷한 상황 1-2개. LLM이 실험적으로 플레이.
런 5-10: 비슷한 상황 3-5개. 패턴이 보이기 시작.
런 20+:  대부분의 결정 포인트에 5개의 비슷한 과거 경험.
런 50+:  세분화된 상황도 커버.
```

---

## 8. 인과성 문제

### 8.1 문제

하나의 선택이 런의 결과를 결정하지 않음.

```
에피소드 #7-1: Pommel Strike 선택 → 런 F28 사망

이 사망이 Pommel Strike 때문인가?
아니면 F12에서 Rest 대신 Smith한 때문인가?
아니면 F9에서 Elite 잡은 때문인가?
모름.
```

### 8.2 처리

- 결과를 그 선택의 결과로 귀속하지 않음.
- "이 선택을 한 런이 어떻게 되었는지"를 보여줌.
- LLM이 스스로 인과관계를 판단.
- 여러 에피소드를 보면 패턴이 보임: "Pommel Strike를 선택한 3런 중 1런 승리, Carnage를 선택한 2런 중 0런 승리" → LLM이 패턴 인식.

### 8.3 한계

- 초기에는 데이터가 부족해서 인과관계를 확신할 수 없음.
- LLM이 잘못된 인과관계를 추론할 수 있음.
- 하지만 데이터가 쌓일수록 패턴이 명확해짐.

---

## 9. 초기 데이터 문제

### 9.1 문제

런 1-3에는 비슷한 상황이 1-2개뿐. LLM이 참고할 경험이 없음.

### 9.2 해결

- 초기에는 경험이 없는 상태로 플레이. LLM이 자유롭게 실험.
- 데이터가 쌓이면서 점점 더 비슷한 상황을 찾을 수 있게 됨.
- 이건 모든 학습 시스템의 공통 문제 (cold start problem).
- 강제로 초기 데이터를 넣지 않음 (하드코딩 금지 원칙).

---

## 10. 선택 포인트별 저장 여부

런 하나에 수십 개의 선택이 있음. 모든 선택을 저장하면 에피소드가 너무 많아짐.

### 10.1 반드시 저장

| 타입 | 이유 | 빈도 (런당) |
|------|------|------------|
| card_reward | 가장 중요한 결정. 덱 구성을 결정. | 15-25회 |
| shop (remove/buy) | 덱 편집 결정. | 3-5회 |
| rest_site | Rest vs Smith 결정. | 3-5회 |
| path | Elite vs Safe 결정. | 5-8회 |

### 10.2 저장하지 않음

| 타입 | 이유 |
|------|------|
| combat (카드 플레이 순서) | 너무 세밀. 손패에 의존. |
| potion_use | 상황이 너무 다양. |
| event (일부) | 이벤트마다 선택이 다름. 일부만 저장. |

### 10.3 예상 에피소드 수

```
런당: ~25-40개 에피소드
10런: 250-400개
50런: 1,250-2,000개
100런: 2,500-4,000개
```

JSON 파일로 저장해도 수 MB 수준. 인메모리 필터/정렬 가능.

---

## 11. Pi 확장 아키텍처

### 11.1 구조

```
~/.pi/agent/extensions/sts-memory/
├── index.ts              ← Pi 확장 (도구 2개)
├── data/
│   ├── episodes.json     ← 모든 에피소드
│   └── stats.json        ← 누적 통계 (보조)
└── CARDS.json            ← 카드 데이터 (게임 데이터, 하드코딩 아님)
```

### 11.2 Pi 도구

#### `sts_remember` — 런 종료 후 결과 기록

런 종료 후 호출. 모든 에피소드의 outcome을 업데이트.

```typescript
pi.registerTool({
  name: "sts_remember",
  description: "Record the outcome of a Slay the Spire run",
  parameters: {
    result: "win" | "loss",
    finalFloor: number,
    cause: string,  // 사망 원인
  },
  // 모든 이번 런의 에피소드 outcome 업데이트
  // 통계 갱신
});
```

#### `sts_recall` — 결정 포인트에서 과거 경험 조회

각 결정 포인트에서 호출. 비슷한 과거 에피소드를 반환.

```typescript
pi.registerTool({
  name: "sts_recall",
  description: "Recall similar past situations in Slay the Spire",
  parameters: {
    type: "card_reward" | "shop" | "rest_site" | "path",
    character: string,
    act: number,
    floor: number,
    hp: number,
    maxHp: number,
    deck: Record<string, number>,
    relics: string[],
    options: string[],
  },
  // 하드 필터: 같은 캐릭터, 같은 액트, 같은 타입
  // 소프트 정렬: 덱 크기, HP 비율, 층
  // 최대 5개 반환
});
```

### 11.3 Pi 이벤트

```typescript
// 런 시작: 통계 + 최근 에피소드 주입
pi.on("before_agent_start", async (event, ctx) => {
  // stats.json에서 통계 로드
  // 최근 3개 런의 에피소드 요약 주입
});

// 세션 종료: 에피소드 저장
pi.on("session_shutdown", async (event, ctx) => {
  // episodes.json 저장
});
```

### 11.4 컨텍스트 주입 흐름

```
런 시작 (before_agent_start):
  → 통계 주입 (승률, 평균 사망 층 등)

각 결정 포인트 (LLM이 sts_recall 호출):
  → 비슷한 과거 에피소드 5개 주입
  → LLM이 직접 비교하고 판단

런 종료 (LLM이 sts_remember 호출):
  → 이번 런의 모든 에피소드 outcome 업데이트
  → 통계 갱신
```

---

## 12. 통계와 에피소드의 관계

### 12.1 통계는 보조

에피소드가 주 정보. 통계는 큰 그림만 보여줌.

```
런 시작 시 주입 (통계 — 큰 그림):
  "총 7런, 1승 6패 (14%). 평균 사망 층: 22."

결정 포인트 시 주입 (에피소드 — 구체적 상황):
  "[런 #7 F6] Ironclad A1, HP 62/72, 덱: Strike×5 Defend×4 Bash×1
    선택지: Carnage / Pommel Strike / Skip
    선택: Pommel Strike → F28 사망"
```

### 12.2 통계에서 하지 않는 것

- 카드별 승률 ("Carnage 승률 0%") → 상황을 무시하므로 오해의 소지
- 행동별 상관관계 ("덱 20장 이하 승리율 45%") → 상황에 따라 다르므로 보조로만
- 세분화된 통계 → 데이터가 부족하면 의미 없음

---

## 13. 한계 및 미해결 문제

### 13.1 LLM이 과거 경험을 무시할 수 있음

- 컨텍스트에 에피소드를 주입해도 LLM이 다른 선택을 할 수 있음.
- 모든 LLM 메모리 시스템의 근본적 한계.
- 완전한 해결책은 없음. 에피소드가 충분히 설득력 있으면 LLM이 참고할 확률이 높아짐.

### 13.2 초기 데이터 부족 (Cold Start)

- 런 1-3에는 비슷한 상황이 1-2개뿐.
- LLM이 실험적으로 플레이할 수밖에 없음.
- 강제 초기 데이터는 하드코딩이므로 금지.

### 13.3 인과성 불확실

- 하나의 선택이 런의 결과를 결정하지 않음.
- "이 선택을 한 런이 어떻게 되었는지"만 알 수 있음.
- LLM이 여러 에피소드를 보고 패턴을 인식해야 함.

### 13.4 선택지가 다른 경우

- 과거 에피소드의 선택지가 현재와 완전히 다를 수 있음.
- LLM이 "선택지가 다르지만 상황은 비슷"라고 판단해야 함.
- LLM이 StS를 이해하므로 가능하지만, 완벽하지 않음.

### 13.5 에피소드 수 증가

- 런당 25-40개 에피소드. 100런이면 2,500-4,000개.
- JSON 파일로 저장하면 수 MB. 인메모리 필터/정렬 가능.
- 장기적으로는 인덱싱이나 압축이 필요할 수 있음.

---

## 14. 구현 우선순위

### Phase 1: 최소 작동 버전

1. 에피소드 저장/조회 (JSON 파일)
2. `sts_recall` 도구 (하드 필터 + 소프트 정렬 + 최대 5개)
3. `sts_remember` 도구 (outcome 업데이트)
4. 런 시작 시 통계 주입
5. CARDS.json (카드 타입 데이터)

### Phase 2: 개선

1. deckProfile 기반 필터링 (카드 타입 분포)
2. 에피소드 압축 (오래된 에피소드 요약)
3. 통계 대시보드 (승률, 평균 사망 층 등)
4. Pi 커맨드 (`sts-stats` 등)

### Phase 3: 고급

1. LLM 기반 에피소드 요약 (런 종료 후 핵심 에피소드만 추출)
2. 에피소드 간 인과관계 추론 (어떤 선택이 어떤 결과로 이어졌는지)
3. 다중 런 패턴 인식 (여러 런에서 반복되는 패턴 발견)

---

## 15. 참고: 기각된 대안들의 비교

| 접근법 | 장점 | 단점 | 기각 이유 |
|--------|------|------|-----------|
| 외부 메모리 (Mem0, Zep) | 검증된 시스템 | 인프라 오버헤드, StS에 과함 | StS는 유한한 게임, 무한 지식 그래프 불필요 |
| 하드코딩된 규칙 | 즉시 작동 | LLM이 배우는 게 아님 | 상황마다 정답이 다름 |
| LLM 반성 | 유연 | 편향, 잘못된 인과 | LLM 해석이 틀릴 수 있음 |
| 통계 중심 | 객관적 | 상황 무시 | StS는 상황바이상황 |
| **에피소드 중심** | **상황 보존, LLM이 판단** | **초기 데이터 부족, 인과 불확실** | **채택** |

---

## 16. 핵심 질문 (구현 전 확인 필요)

1. **에피소드를 언제 기록하는가?** — LLM이 각 선택을 할 때마다? 아니면 게임 클라이언트/시뮬레이터에서 자동으로?
2. **StS와의 인터페이스는?** — 게임 클라이언트(Steam)와 어떻게 연동? 시뮬레이터 사용?
3. **LLM이 게임을 어떻게 플레이하는가?** — 턴별로 상태를 받고 행동을 반환? 아니면 전체 런을 한 번에?
4. **에피소드 기록은 누가 하는가?** — LLM이 `sts_remember`를 호출? 아니면 게임 루프가 자동 기록?
5. **CARDS.json은 어디서 오는가?** — StS 위키에서 스크랩? 게임 데이터에서 추출?