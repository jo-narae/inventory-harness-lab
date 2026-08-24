# 핸드오버 — 2026-08-24 · `npm run verify` 구성

> 이번 세션에서는 저장소의 검증 수단을 조사하고, 검증 전용 DB에서 동일하게 재현되는 공통 기계 검증 파이프라인 `npm run verify`를 구성했다.
>
> 앞선 세션은 [`01-git-workflow.md`](01-git-workflow.md) · [`02-ssot-harness.md`](02-ssot-harness.md) 참고.

---

## 1. 완료한 것

### 기계 검증 파이프라인

최종 파이프라인은 다음과 같다.

```text
Prepare → Types → Lint → Test → Domain Verify → Build
```

```json
"verify:prepare": "tsx scripts/reset-verify-db.ts",
"typecheck": "tsc --noEmit",
"verify:domain": "tsx scripts/verify-headline.ts && tsx scripts/verify-m1.ts",
"verify": "export DATABASE_URL=file:./prisma/verify.db && npm run verify:prepare && npm run typecheck && npm run lint && npm test && npm run verify:domain && npm run build"
```

각 단계는 `&&`로 연결되어 첫 실패에서 중단된다.

### 검증 전용 DB 격리

`npm run verify`는 `prisma/verify.db`를 사용한다.

Prepare 단계에서 매번 검증 DB를 새로 만들고 다음 순서로 초기화한다.

```text
DB 삭제 → migrate deploy → generate → seed
```

따라서 테스트와 도메인 검증은 매 실행마다 동일한 초기 상태에서 시작하며, 개발용 `prisma/dev.db`는 건드리지 않는다.

안전장치도 추가했다.

- `DATABASE_URL`이 `dev.db`를 가리키면 Prepare가 exit 1로 중단
- `verify.db`는 기존 `.gitignore`의 `prisma/*.db*` 규칙으로 제외
- `prisma generate`도 Prepare에 포함하여 갓 클론한 저장소에서도 `npm run verify` 하나로 실행 가능

### 기존 린트 오류 수정

기존 `npm run lint`에서 발견된 `react-hooks/purity` 오류 2건을 수정했다.

- `TransferForm.tsx`
  - 렌더 중 `Date.now()` 사용
  - 유통기한 계산 기준을 기존 `daysUntil()`로 통일
- `transfers/[id]/page.tsx`
  - 기존 계산 의미를 유지한 `daysAgo()` 공용 헬퍼로 분리
- `transfers/page.tsx`
  - 중복된 지역 `daysAgo()`를 제거하고 공용 헬퍼 사용

### 도메인 검증 게이트화

`verify-m1.ts`와 `verify-headline.ts`가 실패를 출력하고도 exit 0으로 끝나던 문제를 수정했다.

- 불변식 실패 → exit 1
- 실행 중 예외 → exit 1
- `snapshot.ts`는 판정 없는 출력 전용이므로 게이트에서 제외

시드 날짜에 따라 달라지는 항목은 `drift()`로 구분해 경고만 출력하도록 했다.

`npm run verify`에서는 매번 새 시드를 사용하므로 날짜 드리프트 문제는 현재 검증 경로에서 해소됐다.

---

## 2. 현재 상태

- 브랜치: `docs/harness-ssot`
- 변경사항: **미커밋**
- `npm run verify`: **PASS**
  - Prepare ✅
  - TypeScript ✅
  - Lint ✅
  - Architecture Check ✅ (§7)
  - Test 19개 ✅
  - Domain Verify ✅
  - Build 15 routes ✅

격리와 실패 경로도 확인했다.

- `dev.db` 불변식을 고의로 깨도 `npm run verify`는 `verify.db`에서 PASS
- `npm run verify` 전후 `dev.db` 체크섬 동일
- `DATABASE_URL=file:./prisma/dev.db npm run verify:prepare` → exit 1
- 도메인 불변식 위반 시 `verify:domain` → exit 1

---

## 3. 남은 작업

1. CI에서 동일한 `npm run verify` 실행
2. `docs/harness/02-verification.md` 작성
3. README에 `npm run verify` 추가 여부 결정
4. 단독 `npm test`도 검증 DB로 격리할지 결정
5. 수동 검증(페르소나 S1~S12 · 반응형 · 엣지 케이스)의 처리 방법 결정

---

## 4. 다음 시작점

현재 공통 기계 검증은 다음 한 명령으로 재현할 수 있다.

```bash
npm run verify
```

다음 단계에서는 이 명령을 CI에서도 그대로 실행하도록 구성하면 된다.

다만 검증 규칙의 SSOT인 `docs/harness/02-verification.md`는 아직 미작성 상태이므로, 현재 구현을 검증 정책으로 확정하기 전에 문서화할 범위를 먼저 확인한다.

---

## 5. 주의사항

- `npm run verify`는 격리된 `verify.db`를 사용한다.
- 단독 `npm test`와 `npm run verify:domain`은 별도 `DATABASE_URL` 지정이 없으면 여전히 `dev.db`를 사용할 수 있다.
- `next build`는 ESLint를 실행하지 않으므로 Lint는 별도 검증 단계로 유지한다.
- `verify:prepare`는 매 실행마다 DB 초기화와 시드를 수행하므로 수 초의 추가 시간이 든다.
- 검증 규칙의 SSOT인 `docs/harness/02-verification.md`는 아직 미작성이다.
---

## 6. CI 구성

`.github/workflows/verify.yml` 을 추가했다. 저장소의 첫 워크플로다.

```yaml
- run: npm ci
- run: npm run verify
  env:
    SESSION_SECRET: ci-placeholder-not-a-real-secret
```

### 설계

- **CI 전용 검증 단계를 두지 않는다.** 로컬과 같은 `npm run verify` 한 줄만 돌린다.
  순서가 바뀌면 `package.json` 한 곳만 고치면 되고, 로컬과 CI가 어긋날 자리가 없다.
- `DATABASE_URL` 은 워크플로에 적지 않는다. `verify` 스크립트가 검증용 DB로 직접 지정한다.
- 트리거: `main` push · 모든 `pull_request` · `workflow_dispatch`
- 같은 브랜치에 새 커밋이 오면 진행 중이던 실행은 취소한다 (`concurrency`)
- Node 22 · `cache: npm` · `timeout-minutes: 15`

### CI 환경 사전 확인

- **`.env` 없이 통과함을 실측했다** — `DOTENV_CONFIG_PATH` 를 없는 경로로 두고 `npm run verify` → exit 0.
  `dotenv` 는 파일이 없으면 조용히 넘어가고, `verify` 가 `DATABASE_URL` 을 직접 지정하므로 문제되지 않는다.
- `SESSION_SECRET` 은 `secret()` 호출 시점에만 던진다. 정적 프리렌더 대상 화면(`/login`, `/_not-found`)이
  이를 호출하지 않아 빌드는 통과한다. 그래도 `.env.example` 이 요구하는 변수이므로 CI 에도 채워뒀다.
  **실제 비밀값이 아니며 검증 경로에서 쓰이지 않는다.**
- `npm ci --dry-run` 으로 `package-lock.json` 정합성 확인 — 이번에 바꾼 것은 scripts 뿐이라 의존성 변동 없음.
- 워크플로 YAML 파싱·구조 확인 완료.

### 아직 확인 못 한 것

- **실제 CI 실행.** `better-sqlite3` 는 네이티브 모듈이라 ubuntu 러너에서 prebuild 를 받거나 직접 빌드한다.
  로컬(macOS)에서는 검증할 수 없다.
- 현재 브랜치는 `docs/harness-ssot` 이고 push 트리거는 `main` 뿐이므로, **PR 을 열어야 처음 돌아간다.**
  `workflow_dispatch` 는 워크플로가 기본 브랜치에 있어야 UI 에 뜬다.

---

## 7. 아키텍처 검사 — 재고 변경 경로 강제

`docs/06-architecture.md` 가 "코드는 반드시 이 경로를 거쳐야 한다"고 정한 규칙 중
**정적으로 자동 검사할 수 있는 것**을 추려, `npm run verify` 의 Lint 다음 단계로 넣었다.

### 조사 결과 — 06 의 경로 규칙을 세 갈래로 나눔

| 갈래 | 항목 | 처리 |
|---|---|---|
| 정적 검사 가능 | Lot·Movement 직접 쓰기 금지 · `$transaction` 밖 호출 금지 · 클라이언트 컴포넌트의 Prisma import 금지 | 앞의 셋을 이번에 구현 |
| 스키마·설정 스냅샷 | `Lot` unique·index · `Movement @@index([reversalOfId])` · WAL 모드 | **미구현 — 아래 "미해결" 참고** |
| 런타임·테스트 몫 | 한 트랜잭션 안 N회 호출 · 한 거점 안 배분 · `planAllocation` 순수성 · 누적 정산 · 중복 취소 금지 | `06 §9` 표의 기존 테스트가 담당 |

### 만든 것 — `scripts/check-architecture.ts`

| ID | 규칙 | 근거 |
|---|---|---|
| A1 | `Lot` 쓰기는 `src/lib/stock.ts` 안에서만 | `06 §2` · `§4.1` |
| A2 | `Movement` 쓰기는 `src/lib/stock.ts` 안에서만 | `06 §4.1` — 이력은 재고 변경과 같은 트랜잭션 |
| A3 | `applyMovement()`·`reverseMovement()` 첫 인자는 트랜잭션 클라이언트 | `06 §4.1` — 반드시 `$transaction()` 안에서 |
| A4 | raw SQL 로 `Lot`·`Movement` 를 쓰지 않는다 | `06 §7.5` — raw SQL 은 조회에만 |

**A1만으로는 부족하다.** `movement.create()` 직접 호출이나
`$executeRawUnsafe('UPDATE Lot ...')` 로 우회로가 그대로 남기 때문에,
"유일한 통로"를 실제로 유일하게 만들려면 네 개가 한 묶음이어야 한다.

DB·시드가 필요 없고 파일만 읽는다. 1초 안에 끝나므로 Lint 다음 자리가 맞다.

```json
"check:arch": "tsx scripts/check-architecture.ts",
"verify": "... && npm run lint && npm run check:arch && npm test && ..."
```

### 검증 결과

- `npm run verify` 전체 **PASS**. 아키텍처 검사는 57개 파일에서 **위반 0건**
- 가짜 위반을 심어 역방향도 확인 — 네 규칙 모두 `파일:줄` 과 함께 잡아내고 `exit 1`
- 주석 안의 `db.lot.update()` 는 걸리지 않는다 (주석 제거 후 검사)

### 판단해서 정한 것 — 원본에 없음, 확인 필요

원본에 근거가 없어 이번 세션에서 정했다. `00-ssot.md §4` 상 원본에 없으면 정해지지 않은 것이므로,
확정하려면 승인이 필요하다.

1. **검사 범위 = `src/**` + `prisma/seed.ts`**
   - 제외: `src/generated/`(Prisma 생성 코드 — JSDoc 예제가 전부 걸린다) ·
     `tests/`(픽스처 준비·정리) · `scripts/`(검증 하네스 자체)
   - 시드를 넣은 이유: `prisma/seed.ts` 가 이미 모든 수량 변경을 `applyMovement` 로 통과시킨다
2. **인자 없는 `deleteMany()` 는 예외** — 시드의 전체 초기화는 재고 변경이 아니라 판 갈아엎기로 봤다.
   `deleteMany({ where: ... })` 같은 부분 삭제는 그대로 위반으로 잡힌다
3. **A3이 `tx` 와 `t` 둘 다 허용** — `prisma/seed.ts` 가 트랜잭션 클라이언트를 `t` 로 받는다.
   이름을 `tx` 하나로 통일하면 검사가 더 단단해진다

### 미해결 — 06 이 요구하는데 코드가 안 따르는 것 2건

조사 중 발견했고, 이번 범위 밖이라 **손대지 않았다.** 둘 다 자동 검사가 쉽다.

| 항목 | 원본 | 현재 |
|---|---|---|
| `Movement @@index([reversalOfId])` | `06 §4.4` | `prisma/schema.prisma` 에 없음 |
| SQLite WAL 모드 | `06 §8` — `PRAGMA journal_mode = WAL` | `src/lib/db.ts` 에 주석만 있고 설정 코드 없음. `dev.db` 헤더 18~19바이트가 `01 01`(rollback journal) — WAL이면 `02 02` |

아키텍처는 사람 소유 영역이고(`00-ssot.md §5`), `06 §4.4` 는 "PoC에서는 애플리케이션 레벨 검증으로
충분"이라고도 적어두었다. 인덱스를 추가할지·WAL을 실제로 켤지는 판단을 받아야 한다.

### §3 남은 작업에 미치는 영향

`docs/harness/02-verification.md` 를 쓸 때, 위 A1~A4 와 "판단해서 정한 것" 3개가
그대로 초안 입력이 된다. 검사 항목을 확정하는 것 자체가 검증 정책 결정이다.

---

## 8. 보호 경로 검사 — 사람 소유 영역 방어

`npm run verify` 의 **첫 단계**로 Protect 를 넣었다. Git 변경 내역에 사람 소유 경로가 들어 있으면
나머지 단계를 돌리기 전에 멈춘다.

```text
Protect → Prepare → Types → Lint → Arch → Test → Domain Verify → Build
```

### 순서 — 원본을 먼저 고치고 스크립트를 만들었다

`00-ssot.md §5` 의 대상 표에서 검증 스크립트 칸이 `추후 생성` 이었다. 경로가 정해지지 않은 상태에서는
무엇을 보호할지 스크립트가 알 수 없다.

1. `00-ssot.md §5` 의 대상 표를 먼저 고쳤다.

   ```diff
   -| 검증 스크립트 | 추후 생성 |
   +| 검증 스크립트 | `scripts/verify/` |
   ```

2. 정해진 그 경로에 `scripts/verify/check-protected.ts` 를 만들었다.

`00-ssot.md §0.3` 이 "기준이 바뀌면 원본을 먼저 수정한다" 고 정한 그대로다. 반대 순서로 했다면
스크립트가 자기 위치를 스스로 정하는 셈이 되고, 그건 §5 상 사람의 권한이다.

`§5` 는 사람 소유 영역이므로 이 변경 자체도 사람이 했다.

### 만든 것 — `scripts/verify/check-protected.ts`

**경로 목록을 스크립트에 적지 않는다.** 실행할 때마다 `00-ssot.md §5` 의 두 표를 파싱해 도출한다.
경로를 코드에 복사하면 SSOT 가 두 벌이 되고, 어느 쪽이 맞는지 알 수 없어진다.

| 표 | 쓰는 방법 |
|---|---|
| `\| 영역 \| AI \| 사람 \|` | AI 칸이 `수정`·`작성` 이 아니면(읽기·실행) 그 영역은 사람 소유 |
| `\| 영역 \| 대상 \|` | 그 영역이 가리키는 실제 경로 (백틱 안의 값) |

현재 도출되는 보호 경로는 다음과 같다.

| 영역 | 경로 |
|---|---|
| 요구사항·아키텍처 | `docs/01-requirements.md` · `docs/06-architecture.md` |
| 하네스 핵심 규칙 | `docs/harness/` · `AGENTS.md` · `CLAUDE.md` |
| 검증 스크립트 | `scripts/verify/` |

`Issue별 테스트` 는 대상이 `추후 정할 Issue별 테스트 경로` 라 백틱 경로가 없다. 경로 미정으로 보고
검사에서 제외한다 — AI 가 작성·수정하는 영역이므로 애초에 보호 대상도 아니다.

### 사람이 정한 것 2가지

원본에 근거가 없어 이번에 판단을 받았다.

1. **비교 기준 = 브랜치 전체 + 작업트리**

   ```text
   VERIFY_BASE → origin/${GITHUB_BASE_REF} (CI PR) → origin/main → main
   ```

   찾은 ref 와 `HEAD` 의 `merge-base` 를 잡고, 그 이후의 커밋 + 스테이지 + 작업트리 + untracked 를 본다.
   로컬과 CI 가 같은 판정을 낸다. `--no-renames` 로 비교하므로 이름만 바꿔 빼내는 것도 잡힌다.

2. **승인은 환경변수로** — `00-ssot.md §5` 의 "사람의 명시적인 수정 요청은 해당 변경에 대한 승인으로 본다"

   ```bash
   ALLOW_PROTECTED="docs/harness/00-ssot.md" npm run verify
   ALLOW_PROTECTED=all npm run verify
   ```

   **CI 워크플로에는 넣지 않았다.** CI 는 항상 엄격하게 막는다.

### 함께 바꾼 것

```json
"verify:protected": "tsx scripts/verify/check-protected.ts",
"verify": "npm run verify:protected && export DATABASE_URL=... && npm run verify:prepare && ..."
```

- 맨 앞에 둔 이유: DB 도 빌드도 필요 없고 git 과 파일만 읽는다. 1초 안에 끝나므로 Prepare 가
  검증 DB 를 지우기 전에 판정이 끝난다
- `.github/workflows/verify.yml` — `actions/checkout` 에 `fetch-depth: 0` 추가.
  기본값(얕은 클론)이면 `origin/main` 이 없어 `merge-base` 를 구하지 못한다

### 검증 결과

| 확인한 것 | 결과 |
|---|---|
| `npm run verify` (승인 없음, 현재 브랜치) | **exit 1** — Prepare 도달 전 중단, 검증 DB 를 건드리지 않음 |
| `ALLOW_PROTECTED=all npm run verify` | **exit 0** — 전 단계 통과 (테스트 19개 · 빌드 15 routes) |
| `§5` 에서 `하네스 핵심 규칙` 의 AI 칸을 `수정` 으로 바꿈 | 그 영역이 보호 목록에서 빠짐 — 하드코딩이 아님을 확인 |
| 두 표의 영역 이름을 어긋나게 함 | `NEEDS_HUMAN — SSOT ↔ SSOT 충돌` 후 중단 (`§4`) |
| 표 헤더를 깨뜨림 | 조용히 통과하지 않고 exit 1 |
| 비교 기준을 못 찾는 경우 | exit 1 + `fetch-depth: 0` · `VERIFY_BASE` 안내 |
| `tsc --noEmit` · `eslint` | clean |

검사 불능은 전부 실패로 처리한다. 보호 경로 검사가 조용히 통과하면 검사가 없는 것보다 나쁘다.

### 주의 — 스스로를 잡는다

`scripts/verify/` 가 보호 경로이므로 이 스크립트는 자기 자신의 변경을 위반으로 잡는다.

```text
❌ 보호 경로 변경 2건 — 사람 승인이 필요합니다
      ↳ docs/harness/00-ssot.md              하네스 핵심 규칙 (docs/harness/)
      ↳ scripts/verify/check-protected.ts    검증 스크립트 (scripts/verify/)
```

의도한 동작이다. 검증 정책 변경은 `§5` 상 사람 승인 사항이므로, 앞으로 이 파일을 고칠 때마다
`ALLOW_PROTECTED` 가 필요하다.

### 현재 상태

- 브랜치: `docs/harness-ssot`
- 변경사항: **미커밋**

```text
 M .github/workflows/verify.yml   fetch-depth: 0
 M docs/harness/00-ssot.md        §5 검증 스크립트 → scripts/verify/
 M package.json                   verify:protected 추가 · verify 맨 앞에 배치
 M handsover/03-verify.md         이 절(§8)
 ?? scripts/verify/               check-protected.ts (신규)
```

### §3 남은 작업에 미치는 영향

`docs/harness/02-verification.md` 를 쓸 때 다음 세 가지가 그대로 초안 입력이 된다.

1. 보호 경로를 `§5` 에서 도출한다는 규칙 자체
2. 비교 기준(브랜치 전체 + 작업트리)과 승인 방식(`ALLOW_PROTECTED`)
3. `Issue별 테스트` 경로 — `§5` 에서 아직 `추후 정할` 상태다. 정해지면 보호 여부도 함께 정해야 한다
