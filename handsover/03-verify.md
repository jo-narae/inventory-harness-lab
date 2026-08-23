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
