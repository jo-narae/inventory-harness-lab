# 핸드오버 — 2026-08-23 · Git 원격 재구성부터 PR 머지까지

> 교안 00~03 한 세션 전체 기록. 이 문서만 읽으면 같은 작업을 처음부터 재현할 수 있어야 한다.
> 앞선 기획·구현 이력은 [`docs/HANDOVER.md`](../docs/HANDOVER.md) 를 본다. 이 문서는 **코드 기능이 아니라 작업 흐름**을 다룬다.

---

## 0. 이 세션에서 한 일 (요약)

| 단계 | 주제 | 결과 |
|---|---|---|
| 00 | 원격 저장소 진단 · 흔적 정리 | 원격 0개 상태 확인 후 `.git` 내 옛 URL 흔적 제거 |
| 01 | 새 원격 저장소 생성 · 첫 푸시 | `inventory-harness-lab` (Private) 생성 → 커밋 3개 푸시 |
| 02 | 로컬 실행 | `npm install` → `.env` → dev 서버 → 브라우저 로그인 검증 |
| 03 | 기능 변경 → PR → 머지 | 시드에 비건쿠키 4종 추가 → 피처 브랜치 → PR #1 → 머지 |

**최종 상태**

| 항목 | 값 |
|---|---|
| 저장소 | https://github.com/jo-narae/inventory-harness-lab (Private) |
| 기본 브랜치 | `main` = `d435895` |
| 원격 | `origin` 하나 (`upstream` 없음) |
| 툴체인 | Node v22.22.3 · npm 10.9.8 · Next.js 16.3.1 (Turbopack) |
| 로컬 실행 | http://localhost:3002 (3000 선점되어 자동 이동) |

**커밋 흐름**

```
d435895  Merge pull request #1 from jo-narae/feat/seed-vegan-cookies
├─ c52369c  feat(seed): 비건쿠키 4종을 각 80개씩 시드에 추가
c270713  chore: 패키지명을 inventory-harness-lab 으로 통일
0e3c256  docs: clone 주소를 새 저장소(inventory-harness-lab)로 갱신
31f1161  Update 06-architecture.md          ← 세션 시작 시점
```

---

## 00. 원격 저장소 진단과 흔적 정리

### 상황

`git remote remove upstream` 을 실행한 뒤 "원격을 안 바라보는 것이냐"는 질문에서 출발했다.
진단해 보니 **`upstream` 뿐 아니라 `origin` 도 없는** 상태였다.

```bash
git remote -v          # 출력 없음
git branch -vv         # * main 31f1161  (추적 브랜치 표시 없음)
git for-each-ref refs/remotes   # 비어 있음
```

> **핵심 1 — `git remote remove <name>` 은 그 이름 하나만 지운다.**
> 원격이 사라졌다고 느껴지면 반드시 `git remote -v` 로 전체를 확인한다.
> 여기서는 `origin` 이 별도로 없어진 상태였고, 그래서 `push`/`pull` 이 전부 실패했다.

### 원격을 지워도 남는 흔적 3곳

`git remote remove` 는 `.git/config` 의 `[remote]` 섹션만 지운다. URL은 다른 곳에 계속 남는다.

| 위치 | 남아 있던 내용 |
|---|---|
| `.git/FETCH_HEAD` | `branch 'main' of https://github.com/jo-narae/inventory-poc` |
| `.git/logs/HEAD`, `.git/logs/refs/heads/main` | `clone: from https://github.com/jo-narae/inventory-poc.git` |
| `.git/config` | `[branch "main"] vscode-merge-base = origin/main` |

이 흔적 덕분에 **원본 저장소 주소를 복구할 수 있었다.** 지우기 전에 먼저 읽는다.

```bash
cat .git/FETCH_HEAD
git reflog
```

### 정리 명령

```bash
rm -f .git/FETCH_HEAD
git reflog expire --expire=now --all
rm -f .git/logs/HEAD .git/logs/refs/heads/main
git config --remove-section branch.main
```

검증 — `.git` 전체에서 옛 URL 문자열이 0건이어야 한다.

```bash
grep -rIl 'github.com\|inventory-poc' .git    # 출력 없음
```

> **핵심 2 — reflog 를 지우면 커밋 복구 안전망도 함께 사라진다.**
> 이 저장소는 reflog 항목이 clone 하나뿐이라 잃을 것이 없었다. 작업 이력이 쌓인 저장소에서는 하지 않는다.
> `logallrefupdates = true` 이므로 다음 커밋부터 reflog 는 다시 쌓인다.

---

## 01. 새 원격 저장소 생성과 첫 푸시

### 사전 확인

```bash
gh auth status              # jo-narae 로 로그인, scope 에 'repo' 필요
git ls-files | grep -Ei '\.env|secret|credential|\.pem|key'   # 민감 파일이 추적 중인지
cat .gitignore              # .env* / node_modules / prisma/*.db 차단 확인
```

> **핵심 3 — 푸시 전에 이름 충돌을 확인한다.**
> `gh repo list jo-narae` 로 보니 `inventory-harness`, `inventory-poc` 가 이미 있었다.
> 새 이름 `inventory-harness-lab` 으로 정했다.

### 생성 + 푸시 (한 줄)

```bash
gh repo create inventory-harness-lab --private --source=. --remote=origin --push
```

이 한 줄이 세 가지를 동시에 한다 — 원격 저장소 생성 · `origin` 등록 · `main` 푸시 및 추적 설정.

### 뒤따라온 이름 정리

새 저장소로 옮기면 **저장소명 말고도 이름이 박혀 있는 곳**이 남는다.

| 파일 | 이전 | 이후 |
|---|---|---|
| `README.md:21` | `git clone .../inventory-poc.git` | `git clone .../inventory-harness-lab.git` |
| `package.json` | `"name": "inventory-poc"` | `"name": "inventory-harness-lab"` |
| `package-lock.json` | `"name": "app_scaffold"` (2곳) | `"name": "inventory-harness-lab"` |

> **핵심 4 — lockfile 의 name 은 조용히 어긋나 있을 수 있다.**
> `package-lock.json` 은 `inventory-poc` 도 아닌 **스캐폴드 잔재 `app_scaffold`** 였다.
> `package.json` 만 고치면 놓친다. 두 파일을 함께 본다.
> (`private: true` 라 npm 배포명과 무관하고 빌드 동작에는 영향이 없다.)

검증은 문자열 검색이 아니라 **원격에 실제로 올라간 내용**으로 한다.

```bash
git show origin/main:README.md | sed -n '21p'
git show origin/main:package.json | sed -n '2p'
```

---

## 02. 로컬 실행

### 설치와 환경 변수

```bash
npm install                 # 565개 · lockfile 변화 없음
cp .env.example .env
```

`.env` 의 `SESSION_SECRET` 은 예시값 그대로 두지 않는다.

```bash
node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))'
```

`.gitignore:46` 이 `.env` 를 막고 있으므로 커밋 대상이 아니다. 확인은 이렇게 한다.

```bash
git check-ignore -v .env    # .gitignore:46:.env  .env
```

### 실행

```bash
npm run dev                 # = npm run db:ensure && next dev
```

`db:ensure` 가 **DB 생성 → 마이그레이션 → 시드까지 자동으로** 처리한다. 별도 준비가 필요 없다.

```
SQLite database dev.db created at file:./prisma/dev.db
Applying migration `20260818122625_init`
✔ Generated Prisma Client (7.9.1)
─────────── 시드 완료 ───────────  총 재고 1194개 · 이동 기록 59건
로그인: warehouse@demo.kr / demo1234
```

> **핵심 5 — 포트는 고정이 아니다.**
> 3000번이 다른 프로세스에 점유되어 Next 가 **3002** 로 자동 이동했다.
> `⚠ Port 3000 is in use ... using available port 3002 instead` 로그를 반드시 읽고 실제 포트를 쓴다.

### 동작 검증

```bash
curl -s -o /dev/null -w "HTTP %{http_code} → %{redirect_url}\n" http://localhost:3002/
# HTTP 307 → http://localhost:3002/login     ← 인증 가드 동작
```

> **핵심 6 — 로그인이 React Server Action 이면 `curl` 로 몰 수 없다.**
> 폼이 `<form action={formAction}>` (`useActionState`) 이라 `Next-Action` 헤더가 필요하다.
> 실제 브라우저(Playwright)로 몰아서 검증했다. 로그인 후 `POST /login 200` 과
> `└─ ƒ login({}, {}) in 162ms src/actions/auth.ts` 가 dev 로그에 찍히면 성공이다.

검증 결과 — 홈 `전체 8 SKU · 가용 944개`, 임박 4 · 만료 3, 콘솔 에러 0건.

---

## 03. 기능 변경 → 피처 브랜치 → PR → 머지

### 변경 내용

`prisma/seed.ts` 에 비건쿠키 4종을 각 80개씩 추가했다.

| ID | 이름 | SKU | 배치 |
|---|---|---|---|
| 9 | 비건쿠키 딸기 40g | `DOG-VEGAN-STRAWBERRY-40` | 자사창고 80개 |
| 10 | 비건쿠키 당근 40g | `DOG-VEGAN-CARROT-40` | 자사창고 80개 |
| 11 | 비건쿠키 블루베리 40g | `DOG-VEGAN-BLUEBERRY-40` | 자사창고 80개 |
| 12 | 비건쿠키 고구마 40g | `DOG-VEGAN-SWEETPOTATO-40` | 자사창고 80개 |

**이 시드 파일을 고칠 때의 판단 기준 4가지** — 파일 상단 주석의 원칙에서 나온다.

1. **입고 시점을 "22일 전 신규 입고"로 분리했다.**
   기존 상품처럼 95일 전 초기 입고에 넣으면 이후 발송·출고 흐름에 휩쓸려 80개가 정확히 남지 않는다.
   발송·출고 이력이 없는 신규 라인업으로 두어야 80개가 그대로 남는다.
2. **헬퍼 `inbound()` 를 그대로 썼다.**
   로트를 손으로 만들지 않고 `applyMovement` / `allocateLots` 를 통과시킨다.
   → 시드가 앱의 FEFO·LEFO 규칙을 어길 수 없다는 파일 상단 원칙을 지킨다.
3. **유통기한을 넉넉하게(2027-02~04) 잡았다.**
   임박·만료로 잡히면 시연 시나리오의 `임박 4 · 만료 3` 과 `docs/screenshots` 31장이 어긋난다.
4. **상품 배열 뒤에 append 했다.**
   중간에 끼우면 ID가 밀려 `/products/1~8` 주소와 스크린샷이 전부 깨진다.

### 시드 재실행 — `seed` 와 `seed:reset` 의 차이

```bash
npm run seed          # deleteMany + sqlite_sequence 초기화 후 재삽입 (DB 파일 유지)
npm run seed:reset    # DB 파일 자체를 삭제하고 재생성
```

> **핵심 7 — dev 서버가 떠 있으면 `seed` 를 쓴다.**
> `seed:reset` 은 `prisma/dev.db` 를 지우므로 실행 중인 서버가 붙잡고 있는 파일과 어긋난다.
> 시드는 `sqlite_sequence` 까지 초기화해서 ID가 밀리지 않게 설계되어 있다(파일 상단 주석 참고).

### 검증 (커밋 전에)

| 지표 | 이전 | 이후 |
|---|---|---|
| 자사창고 | 543개 | 863개 (+320 = 80 × 4) |
| 총 재고 | 1194개 | 1514개 |
| 이동 기록 | 59건 | 63건 (+4) |
| 홈 헤더 | 전체 8 SKU · 가용 944개 | 전체 12 SKU · 가용 1,264개 |
| 임박 · 만료 | 4 · 3 | **4 · 3 (회귀 없음)** |

DB 직접 조회로 4종 × 80개 배치와 기존 8종 ID 유지도 확인했다.

> **핵심 8 — `npx tsx -e '...'` 는 top-level await 에서 실패한다.**
> `Top-level await is currently not supported with the "cjs" output format`.
> 확인용 스크립트는 `-e` 대신 **파일로 만들어** 실행하고 끝나면 지운다.

### 브랜치 → 커밋 → 푸시 → PR

```bash
git checkout -b feat/seed-vegan-cookies
git add prisma/seed.ts
git commit                                   # 무엇을 왜 바꿨는지 본문에 남긴다
git push -u origin feat/seed-vegan-cookies
gh pr create --base main --head feat/seed-vegan-cookies --title "..." --body "..."
```

PR 본문에는 **결과만이 아니라 판단 근거**를 넣었다 — 위의 4가지 판단 기준과 회귀 없음 근거.
리뷰어가 "왜 22일 전인가"를 코드만 보고 알 수 없기 때문이다.

### 머지 후 로컬 동기화

머지는 사람이 GitHub 에서 직접 했다. 로컬은 자동으로 따라오지 않는다.

```bash
gh pr view 1 --json state,mergedBy,mergeCommit    # MERGED · jo-narae · d435895  ← 먼저 확인
git checkout main
git fetch origin --prune
git merge --ff-only origin/main                   # c270713..d435895 fast-forward
```

> **핵심 9 — 머지 여부는 추측하지 말고 확인한다.**
> `gh pr view` 로 `MERGED` 와 머지 커밋 해시를 확인한 뒤 동기화한다.
> `--ff-only` 를 쓰면 예상과 다를 때 조용히 머지 커밋을 만들지 않고 실패한다.

---

## 4. 남은 정리거리

| 항목 | 상태 | 처리 방법 |
|---|---|---|
| `feat/seed-vegan-cookies` (로컬·원격) | 머지 완료 후에도 남아 있음 | `git branch -d feat/seed-vegan-cookies` · `git push origin --delete feat/seed-vegan-cookies` |
| dev 서버 | PID 29100, 포트 3002 에서 실행 중 | `kill 29100` |
| `docs/screenshots/` 31장 | 기존 자산 — **건드리지 않음** | 시드 변경으로 수치가 바뀌지 않았으므로 재촬영 불필요 |

---

## 5. 재현 순서 (처음부터)

```bash
git clone https://github.com/jo-narae/inventory-harness-lab.git
cd inventory-harness-lab
npm install
cp .env.example .env        # SESSION_SECRET 을 긴 랜덤 문자열로 교체
npm run dev                 # DB 생성 · 마이그레이션 · 시드까지 자동
```

로그인 `warehouse@demo.kr` / `demo1234` (또는 `sales@demo.kr`).
포트는 로그에 찍힌 값을 쓴다 — 3000이 비어 있지 않으면 다른 번호로 뜬다.

---

## 6. 이 세션에서 나온 함정 모음

| # | 함정 | 대응 |
|---|---|---|
| 1 | `git remote remove <name>` 이 다른 원격까지 지운 것처럼 보임 | `git remote -v` 로 전체 확인 |
| 2 | 원격을 지워도 `FETCH_HEAD`·reflog·`.git/config` 에 URL이 남음 | 지우기 전에 읽어서 주소 복구, 그다음 제거 |
| 3 | reflog 삭제 = 커밋 복구 안전망 삭제 | 이력이 쌓인 저장소에서는 하지 않는다 |
| 4 | `package-lock.json` 의 name 이 `app_scaffold` 로 어긋나 있었음 | `package.json` 과 lockfile 을 함께 확인 |
| 5 | Next 가 3000 대신 3002 로 뜸 | 로그의 실제 포트를 사용 |
| 6 | Server Action 로그인은 `curl` 로 불가 | 브라우저로 몰아서 검증 |
| 7 | dev 서버 실행 중 `seed:reset` 은 DB 파일을 지움 | `npm run seed` 사용 |
| 8 | `npx tsx -e` 는 top-level await 실패 | 임시 파일로 실행 후 삭제 |
| 9 | 머지 여부를 가정하고 동기화 | `gh pr view` 확인 후 `--ff-only` |
| 10 | 시드 상품을 배열 중간에 끼우면 ID가 밀림 | 항상 뒤에 append |
