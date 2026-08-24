/**
 * 보호 경로 검사 (Protect) — 사람 소유 영역이 바뀌었는지 확인한다.
 *
 * 원본: docs/harness/00-ssot.md §5 "보호 영역과 소유권"
 *   - 표 1 (영역 · AI · 사람) 이 영역별로 AI 가 무엇을 할 수 있는지 정한다.
 *     AI 칸이 "수정"·"작성" 이 아니면(읽기·실행) 그 영역은 사람 소유다.
 *   - 표 2 (영역 · 대상) 가 각 영역이 가리키는 실제 경로를 정한다.
 *
 * 경로 목록을 여기에 적지 않는다 — SSOT 를 읽어 매번 다시 만든다.
 * 두 벌이 되는 순간 어느 쪽이 맞는지 알 수 없어지기 때문이다.
 *
 * 승인도 마찬가지다. 무엇이 유효한 승인인지는 §5 "승인 기록" 이 정한다.
 * 방법과 형식을 여기에 옮겨 적지 않는다 — 아래 코드는 그렇게 정해진 승인을 읽을 뿐이다.
 *
 * DB 도 빌드도 필요 없다. git 과 파일만 읽으므로 파이프라인 맨 앞에 둔다.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const SSOT = 'docs/harness/00-ssot.md'
const SECTION = '## 5. 보호 영역과 소유권'

/** AI 가 직접 바꿀 수 있다고 표가 말하는 표현. 나머지(읽기·실행)는 사람 소유다 */
const AI_MAY_WRITE = /수정|작성/

type Area = { name: string; ai: string; paths: string[]; unresolved: string[] }

function fail(lines: string[]): never {
  console.error('\n' + lines.join('\n') + '\n')
  process.exit(1)
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

// ─── SSOT §5 파싱 ────────────────────────────────────────────────────────────

/** 마크다운 표를 헤더 이름으로 찾아 행을 셀 배열로 돌려준다 */
function readTable(body: string, header: string[]): string[][] | null {
  const rows = body.split('\n')
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())

  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].trim().startsWith('|')) continue
    const head = cells(rows[i])
    if (head.length !== header.length || !header.every((h, k) => head[k] === h)) continue
    if (!/^\|[\s:|-]+\|$/.test(rows[i + 1]?.trim() ?? '')) continue // 구분선

    const out: string[][] = []
    for (let j = i + 2; j < rows.length && rows[j].trim().startsWith('|'); j++) out.push(cells(rows[j]))
    return out
  }
  return null
}

let ssot: string
try {
  ssot = readFileSync(SSOT, 'utf8')
} catch {
  fail([`✗ 보호 경로의 원본 ${SSOT} 을 읽을 수 없습니다.`, '  검사를 건너뛰지 않고 중단합니다.'])
}

const start = ssot.indexOf(SECTION)
if (start === -1) fail([`✗ ${SSOT} 에서 "${SECTION}" 절을 찾지 못했습니다.`, '  절 제목이 바뀌었다면 이 스크립트도 함께 고쳐야 합니다.'])
const rest = ssot.slice(start + SECTION.length)
const end = rest.indexOf('\n## ')
const section = end === -1 ? rest : rest.slice(0, end)

const ownership = readTable(section, ['영역', 'AI', '사람'])
const targets = readTable(section, ['영역', '대상'])
if (!ownership || !targets) {
  fail([
    `✗ ${SSOT} §5 의 표를 읽지 못했습니다.`,
    `  필요한 표: | 영역 | AI | 사람 | · | 영역 | 대상 |`,
    '  표 구조가 바뀌었다면 이 스크립트도 함께 고쳐야 합니다.',
  ])
}

const targetOf = new Map(targets.map((r) => [r[0], r[1]]))

// 두 표의 영역이 어긋나면 SSOT ↔ SSOT 충돌이다 (§4). 임의로 한쪽을 고르지 않는다
const onlyOwnership = ownership.map((r) => r[0]).filter((n) => !targetOf.has(n))
const onlyTargets = targets.map((r) => r[0]).filter((n) => !ownership.some((o) => o[0] === n))
if (onlyOwnership.length > 0 || onlyTargets.length > 0) {
  fail([
    'NEEDS_HUMAN — SSOT ↔ SSOT 충돌',
    `  ${SSOT} §5 의 두 표에 적힌 영역이 서로 다릅니다.`,
    ...onlyOwnership.map((n) => `    소유권 표에만 있음: ${n}`),
    ...onlyTargets.map((n) => `    대상 표에만 있음: ${n}`),
    '  어느 쪽이 맞는지는 사람이 정합니다. 검사는 중단합니다.',
  ])
}

const areas: Area[] = ownership.map(([name, ai]) => {
  const target = targetOf.get(name) ?? ''
  const paths = [...target.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  // 백틱 경로가 하나도 없으면 아직 경로가 정해지지 않은 영역이다 (예: "추후 정할 …")
  return { name, ai, paths, unresolved: paths.length === 0 && target ? [target] : [] }
})

const protectedAreas = areas.filter((a) => !AI_MAY_WRITE.test(a.ai))
const protectedPaths = protectedAreas.flatMap((a) => a.paths.map((p) => ({ path: p, area: a.name })))
if (protectedPaths.length === 0) {
  fail([`✗ ${SSOT} §5 에서 보호 경로를 하나도 찾지 못했습니다.`, '  표는 읽혔지만 경로가 비어 있습니다. 원본을 확인하세요.'])
}

// ─── 비교 기준(base) 정하기 ──────────────────────────────────────────────────

function resolve(ref: string): string | null {
  try {
    return git(['rev-parse', '--verify', '--quiet', ref + '^{commit}']) || null
  } catch {
    return null
  }
}

/** CI 의 PR 이면 그 PR 의 base 브랜치를 쓴다 */
const candidates = [
  process.env.VERIFY_BASE,
  process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`,
  'origin/main',
  'main',
].filter(Boolean) as string[]

let base: { ref: string; commit: string } | null = null
for (const ref of candidates) {
  const commit = resolve(ref)
  if (!commit) continue
  try {
    base = { ref, commit: git(['merge-base', 'HEAD', commit]) }
    break
  } catch {
    /* HEAD 와 공통 조상이 없는 ref 는 건너뛴다 */
  }
}

if (!base) {
  fail([
    '✗ 비교 기준을 찾지 못했습니다 — 무엇이 바뀌었는지 판단할 수 없습니다.',
    `  시도한 ref: ${candidates.join(', ')}`,
    '  CI 라면 actions/checkout 에 fetch-depth: 0 이 필요합니다.',
    '  기준을 직접 지정하려면 VERIFY_BASE=<ref> 로 실행하세요.',
  ])
}

// 커밋된 변경 + 스테이지 + 작업트리. --no-renames 로 이름이 바뀐 원래 경로도 잡는다
const tracked = git(['diff', '--name-only', '--no-renames', base.commit]).split('\n')
const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n')
const changed = [...new Set([...tracked, ...untracked])].filter(Boolean).sort()

// ─── 판정 ────────────────────────────────────────────────────────────────────

/** SSOT 의 경로가 디렉터리면 그 아래 전부, 파일이면 그 파일만 */
const covers = (rule: string, file: string) =>
  rule.endsWith('/') ? file.startsWith(rule) : file === rule || file.startsWith(rule + '/')

/**
 * SSOT §5 "승인 기록" 이 정한 두 곳에서 승인을 모은다 — 환경변수와 커밋 트레일러.
 * 어느 쪽이 어디까지 유효한지는 SSOT 의 표가 정한다. 여기서는 읽어 모으기만 한다.
 */
type Approval = { value: string; source: string }

const approvals: Approval[] = []

for (const v of (process.env.ALLOW_PROTECTED ?? '').trim().split(/[\s,]+/).filter(Boolean)) {
  approvals.push({ value: v, source: 'ALLOW_PROTECTED' })
}

// %H<US>%B<RS> — 메시지에 줄바꿈이 있으므로 개행이 아닌 제어문자로 자른다
for (const entry of git(['log', '--format=%H%x1f%B%x1e', `${base.commit}..HEAD`]).split('\x1e')) {
  const [sha, body] = entry.split('\x1f')
  if (!sha?.trim() || !body) continue
  for (const m of body.matchAll(/^Approved-Protected:\s*(.+)$/gim)) {
    for (const v of m[1].trim().split(/[\s,]+/).filter(Boolean)) {
      approvals.push({ value: v, source: `커밋 ${sha.trim().slice(0, 7)}` })
    }
  }
}

/** 승인 하나가 이 파일을 덮는가 */
const grants = (a: Approval, file: string, rule: string) =>
  a.value.toLowerCase() === 'all' ||
  a.value === file ||
  a.value === rule ||
  covers(a.value.endsWith('/') ? a.value : a.value + '/', file)

type Hit = { file: string; area: string; rule: string; by?: string }
const violations: Hit[] = []
const approved: Hit[] = []

for (const file of changed) {
  const rule = protectedPaths.find((p) => covers(p.path, file))
  if (!rule) continue
  const by = approvals.find((a) => grants(a, file, rule.path))
  const hit = { file, area: rule.area, rule: rule.path, by: by?.source }
  ;(by ? approved : violations).push(hit)
}

// ─── 출력 ────────────────────────────────────────────────────────────────────

console.log(`\n▸ 보호 경로 검사 — 원본 ${SSOT} §5\n`)
console.log(`  기준: ${base.ref} (merge-base ${base.commit.slice(0, 7)}) · 변경 파일 ${changed.length}개`)
console.log('  보호 경로 (사람 소유):')
for (const a of protectedAreas) console.log(`      ${a.name} — ${a.paths.join(', ')}`)
const undecided = protectedAreas.filter((a) => a.unresolved.length > 0)
for (const a of undecided) console.log(`      ${a.name} — 경로 미정 ("${a.unresolved[0]}") · 검사 제외`)
console.log()

for (const h of approved) console.log(`⚠️  승인됨  ${h.file}   ${h.area} (${h.rule})   ← ${h.by}`)
if (approved.length > 0) console.log(`      사람이 명시적으로 승인한 변경으로 본다 (§5)\n`)

if (violations.length > 0) {
  console.log(`❌ 보호 경로 변경 ${violations.length}건 — 사람 승인이 필요합니다\n`)
  for (const h of violations) console.log(`      ↳ ${h.file}   ${h.area} (${h.rule})`)
  console.log(
    [
      '',
      `이 영역의 변경 권한은 사람에게 있다 (${SSOT} §5).`,
      'AI 는 변경안과 이유를 제시하고 승인을 기다린다.',
      '',
      '승인된 변경이라면 경로를 적는다. 로컬만 통과시키려면 환경변수로,',
      'CI 까지 통과시키려면 커밋 트레일러로 남긴다.',
      `  ALLOW_PROTECTED="${violations.map((v) => v.file).join(' ')}" npm run verify`,
      `  git commit --allow-empty -m "chore: 보호 경로 변경 승인" -m "Approved-Protected: ${violations.map((v) => v.file).join(' ')}"`,
      '',
    ].join('\n')
  )
  process.exit(1)
}

console.log(`✅ 사람 소유 영역은 그대로다${approved.length > 0 ? ' (승인된 변경 ' + approved.length + '건)' : ''}\n`)
