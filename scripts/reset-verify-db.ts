/**
 * 검증용 DB를 매번 새로 만든다 (Prepare).
 *
 * 개발용 `prisma/dev.db` 는 건드리지 않는다 — 검증이 작업 중인 데이터를 지우면 안 된다.
 * 실행마다 파일을 지우고 마이그레이션과 시드를 다시 돌리므로,
 * 테스트와 도메인 검증은 언제 돌려도 같은 상태에서 시작한다.
 *
 * `DATABASE_URL` 로 대상을 받는다 (`npm run verify` 가 지정한다).
 */
import { rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

const DEFAULT_URL = 'file:./prisma/verify.db'
const url = process.env.DATABASE_URL ?? DEFAULT_URL
const file = url.replace(/^file:/, '')

// 개발용 DB를 지우는 사고를 막는다 — 이 스크립트는 검증용 DB만 다룬다
if (/dev\.db$/.test(file)) {
  console.error(`\n✗ 개발용 DB(${file})는 지우지 않습니다. 검증용 DB를 지정하세요.\n`)
  process.exit(1)
}

const dbPath = path.resolve(process.cwd(), file)
for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })

console.log(`\n▸ 검증용 DB를 새로 만듭니다 — ${file}\n`)

// execSync 는 현재 프로세스의 환경을 물려주므로 DATABASE_URL 이 그대로 전달된다
const run = (cmd: string) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } })
run('npx prisma migrate deploy')
run('npx prisma generate')
run('npx tsx prisma/seed.ts')
