#!/usr/bin/env node
/**
 * 初始化脚本二：把管线探查数据恢复到初始状态。
 *   npm run seed:reset
 *   npm run seed:reset -- --role viewer   # 越权会被拦下，数据不动
 *
 * 语义：清空管线表与灌入批次状态，再从样例第一批重新灌一遍，
 * 跑完与「全新环境第一次灌」完全一致。
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { resetUtilitySeed } from '../src/data/seed-engine'
import { createFileSeedStore, defaultStorePath } from './file-seed-store.mts'
import { printReport } from './seed-utility.mts'

const args = process.argv.slice(2)
const roleIndex = args.indexOf('--role')
const storeIndex = args.indexOf('--store')
const role = roleIndex >= 0 ? args[roleIndex + 1] : process.env.SEED_ROLE || 'admin'
const storePath = storeIndex >= 0 ? args[storeIndex + 1] : defaultStorePath()

mkdirSync(dirname(storePath), { recursive: true })
const report = resetUtilitySeed(createFileSeedStore(storePath), { actor: { role } })
printReport(report)
if (!report.ok) {
  process.exitCode = 1
}
