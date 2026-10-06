#!/usr/bin/env tsx
/**
 * 初始化脚本（一）：灌样例
 *
 * 用法：
 *   npm run db:seed                          管理员身份灌入（断点可续灌）
 *   npm run db:seed -- --role=viewer         非管理员：越权改动一律拦下
 *   npm run db:seed -- --crash-after=10      演练：提交 10 行后进程中断
 *   npm run db:seed -- --fail-write          演练：写库失败，整笔回滚
 *
 * 重复执行是安全的：按管线编号等业务主键去重，重复灌不会多出重复行。
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runSeed } from '../src/data/seed-engine'
import type { Role } from '../src/data/types'
import { FileStore } from './file-store'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(here, '..', 'data')

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

const role = (arg('role') ?? 'admin') as Role
const crashAfter = Number(arg('crash-after') ?? 0)
const failWrite = process.argv.includes('--fail-write')

const store = new FileStore(dataDir, {
  crashAfter: crashAfter > 0 ? crashAfter : 0,
  failWrite,
})

const cursorBefore = store.readCheckpoint()
if (cursorBefore > 0) {
  console.log(`检测到上次断点（已提交到第 ${cursorBefore} 条），从第 ${cursorBefore + 1} 条续灌。`)
}

try {
  const { report } = runSeed(store, role)
  store.saveReport(report)

  console.log('—'.repeat(48))
  console.log(`灌入完成：新增 ${report.inserted} 行，跳过重复 ${report.skipped} 行，异常 ${report.rejected.length} 行。`)
  console.log(`异常清单已写入 data/seed-report.json`)
  for (const item of report.rejected) {
    console.log(`  [${item.module}] ${item.businessKey}：${item.reasons.join('；')}`)
  }
  console.log('—'.repeat(48))
  console.log('重复灌样例只生效一次：再跑一次，新增会是 0。')
} catch (error) {
  console.error(`灌样例失败，已整笔回滚：${(error as Error).message}`)
  process.exit(1)
}
