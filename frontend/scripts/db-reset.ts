#!/usr/bin/env tsx
/**
 * 初始化脚本（二）：把数据恢复到初始状态
 *
 * 用法：
 *   npm run db:seed          先灌样例
 *   npm run db:reset         清空已灌数据，恢复为校验通过的样例基线
 *
 * 只有 admin 能执行；坏样例仍会被挑进异常清单，不会混进基线。
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runReset } from '../src/data/seed-engine'
import type { Role } from '../src/data/types'
import { FileStore } from './file-store'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(here, '..', 'data')

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

const role = (arg('role') ?? 'admin') as Role
const store = new FileStore(dataDir)

try {
  const { report } = runReset(store, role)
  store.saveReport(report)

  const total = Object.values(store.read()).reduce((sum, rows) => sum + rows.length, 0)
  console.log('—'.repeat(48))
  console.log(`已恢复到初始状态：基线共 ${total} 行，其中异常 ${report.rejected.length} 行未入基线。`)
  for (const item of report.rejected) {
    console.log(`  [${item.module}] ${item.businessKey}：${item.reasons.join('；')}`)
  }
  console.log('—'.repeat(48))
} catch (error) {
  console.error(`恢复初始数据失败：${(error as Error).message}`)
  process.exit(1)
}
