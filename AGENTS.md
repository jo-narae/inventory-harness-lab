# AGENTS.md

이 저장소에서 작업하는 에이전트 규칙.
**이 파일은 규칙의 원본이 아니라 라우터다.** 무엇이 원본인지는
[`docs/harness/00-ssot.md`](docs/harness/00-ssot.md) 가 정한다.

---

## 0. 읽기 원칙

1. **시작할 때 문서를 전부 읽지 않는다.** 1절 라우팅 표에서 질문에 해당하는 행만 연다.
2. **파일 전체가 아니라 절 단위로 읽는다.** 문서가 크다(`03` 980줄 · `06` 679줄).
   `grep -n "^#" <파일>` 로 목차를 잡고 필요한 절만 `sed -n 'A,Bp'` 로 읽는다.
3. **라우팅된 문서로 판단이 서지 않을 때만 범위를 넓힌다** — 2절의 사다리를 한 칸씩.
4. **원본에 없으면 정해지지 않은 것이다.** 코드에서 추측해 채우지 말고, 없다고 보고한 뒤
   원본에 추가할지 묻는다.
5. 문서끼리 어긋나면 **원본이 이긴다** (`00-ssot.md §0`). 원본에 없는 실행 절차·수치가
   문서마다 다르면 `README.md` 와 실제 실행 결과(`npm test`)를 기준으로 한다.

---

## 1. 라우팅 표

| 질문의 종류 | 읽을 것 | 어느 절부터 |
|---|---|---|
| **재고 규칙** — 로트 단위 · 거점 · 증감 사유 · 무엇을 만들고 안 만드는가 · 완료 기준 | `docs/01-requirements.md` **(원본)** | 개념 §2 · 기능 §3 · 사유 체계 §3 F5-1 · 제외 §6 · 완료 기준 §7 |
| **구조** — 스택 · 폴더 · 데이터 모델 · 재고 증감 통로 · FEFO/LEFO · 정산 역산 · 취소 · 시드 설계 | `docs/06-architecture.md` **(원본)** | 모델 §3 · 핵심 로직 §4 · 시드 §7 · 불변식 §9 |
| **지금 하는 작업** — 범위 · 완료 조건 | 해당 **GitHub Issue (원본)** | `gh issue view <N>` |
| 무엇이 원본인가 / 문서가 서로 다르다 | `docs/harness/00-ssot.md` | 책임별 원본 §1 · 책임 경계 §2 |
| 화면 · 컴포넌트 · 색 · 간격 · 접근성 | `docs/05-design.md` | 토큰 §2 · 컴포넌트 §4 |
| 실행 · 명령어 · 시드 초기화 · 데모 계정 | `README.md` | §실행 · §명령어 |
| 업무 흐름이 실제로 어떻게 이어지나 (S1~S12) | `docs/03-scenarios.md` | 해당 시나리오 절만 |
| 왜 이렇게 됐나 (과거 결정 경위) | `docs/HANDOVER.md` §3 · `handsover/` | 기록일 뿐, 현재 상태로 신뢰하지 않는다 |
| **검증 규칙** — 무엇을 어떻게 통과시켜야 하나 | ⬜ **원본 미작성.** `01 §7`(수용 기준) + `06 §9`(불변식) + `07-plan.md §2`(QA) **세 곳을 다** 본다 | 예정: `docs/harness/02-verification.md` (`00-ssot.md §3`) |
| **구현·검증 루프** — 어떤 순서로 돌리나 | ⬜ **원본 미작성.** `npm test` · `npm run build` 를 수동으로 돌린다 | 예정: `docs/harness/03-loop.md` (`00-ssot.md §3`) |

표의 위 세 줄만 **원본**이다 (`00-ssot.md §1`). 나머지는 참고 문서이므로, 원본과 어긋나면 원본을 따른다.

---

## 2. 판단이 안 설 때 — 확장 사다리

라우팅된 문서로 답이 안 나올 때만 한 칸씩 올라간다. 건너뛰지 않는다.

| 단계 | 범위 |
|---|---|
| 1차 | 라우팅된 문서의 **해당 절** |
| 2차 | 같은 문서의 인접 절 + 표의 짝이 되는 행 (도메인 ↔ 아키텍처는 서로의 짝이다) |
| 3차 | 근거 문서 — `03-scenarios`(흐름) · `02-personas`(왜 필요한가) · `04-engagement`(장치) |
| 4차 | 코드 — `src/lib/` 의 해당 모듈과 `tests/` (지도: `06 §2` · `HANDOVER §6`) |
| 5차 | 저장소 전체 검색. 여기까지 와서 근거가 없으면 **없는 것이다** → 0절 4번대로 보고 |

---

## 3. 작업 규칙

- 결정이 바뀌면 **원본 문서를 먼저 고치고** 코드를 고친다. 결정을 이슈 코멘트에만 묻어두지 않는다.
- 재고 수량 변경은 `applyMovement()` 하나로만 한다 (`06 §4.1`). 새 경로를 만들지 않는다.
- 유통기한은 `lib/date.ts` 의 `dateOnly()` 를 통과시킨다 (`HANDOVER §4`).
- 시드 상품은 배열 **뒤에만** 붙인다 — 중간에 끼우면 ID가 밀린다 (`handsover/01 §6`).
- 검증 원본이 없으므로, 바꾼 것에 대응하는 검증을 **직접 정해 이슈에 적고** 돌린 결과를 보고한다.
- 커밋·푸시는 **요청받았을 때만** 한다. `main` 에 직접 커밋하지 않는다.

---

## 4. 이 파일에 대하여

- `CLAUDE.md` 는 이 파일을 불러오기만 한다. 규칙은 여기 한 곳에만 적는다.
- 아래 `nextjs-agent-rules` 블록은 `next dev` 가 자동으로 다시 써넣는 관리 영역이다.
  지우면 다음 실행 때 되살아나므로 그대로 둔 채 커밋한다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
