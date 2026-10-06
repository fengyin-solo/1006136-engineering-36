#!/usr/bin/env node
/**
 * 初始化脚本一：灌管线探查样例。
 *   npm run seed                # 默认 admin（本地初始化用）
 *   npm run seed -- --role viewer   # 演示越权拦截
 *   SEED_ROLE=admin npm run seed
 *   npm run seed -- --store .data/utility-store.json
 *
 * 保证：按管线编号去重（重复灌不多行）、中断后重跑从断掉的一条接着走、
 * 异常行单独列出并写清原因、写库失败整笔回滚。
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { seedUtility, type SeedReport } from '../src/data/seed-engine'
import { createFileSeedStore, defaultStorePath } from './file-seed-store.mts'

function parseArgs(argv: string[]): { role: string; store: string } {
  const args = [...argv]
  let role = process.env.SEED_ROLE || 'admin'
  let store = defaultStorePath()
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--role' && args[i + 1]) {
      role = args[i + 1]
      i += 1
    } else if (args[i] === '--store' && args[i + 1]) {
      store = args[i + 1]
      i += 1
    }
  }
  return { role, store }
}

export function printReport(report: SeedReport): void {
  const line = '─'.repeat(64)
  console.log(line)
  console.log(`批次：${report.batchId || '(未进入批次)'}　断点续灌：${report.resumed ? '是' : '否'}`)
  console.log(report.message)
  if (report.inserted.length > 0) {
    console.log(`新增 ${report.inserted.length} 条：`)
    for (const row of report.inserted) {
      console.log(
        `  + ${row['管线编号']}　${row['管线类型']}　埋深 ${row['埋设深度']}m　净距 ${row['与隧道净距']}m　${row.status}`,
      )
    }
  }
  if (report.skipped.length > 0) {
    console.log(`跳过 ${report.skipped.length} 条：`)
    for (const item of report.skipped) {
      console.log(`  · ${item.code}：${item.reason}`)
    }
  }
  if (report.rejected.length > 0) {
    console.log(`异常 ${report.rejected.length} 条（已单独列出，不入库）：`)
    for (const item of report.rejected) {
      console.log(`  ! 第 ${item.index + 1} 行 ${item.code || '(无编号)'}：${item.reason}`)
    }
  }
  console.log(`检查点已提交编号：${report.appliedCodes.join(', ') || '(无)'}`)
  console.log(line)
}

// 作为模块被 reset 脚本导入时只复用 printReport，不执行灌入主体。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const { role, store } = parseArgs(process.argv.slice(2))
  mkdirSync(dirname(store), { recursive: true })
  const report = seedUtility(createFileSeedStore(store), { actor: { role } })
  printReport(report)
  if (!report.ok) {
    process.exitCode = 1
  }
}
