#!/usr/bin/env node
/**
 * 工程化自检：npm run selfcheck
 * 不依赖浏览器，用内存适配器 + 故障注入逐条验收灌样例引擎的承诺：
 *   1. 首灌：4 条合法（覆盖四种状态）入库，数值字段是 number 不是 string
 *   2. 异常 3 行：非数字埋深 / 空编号 / 样例内重复，各有明确原因
 *   3. 重复灌：只生效一次，行数不变
 *   4. 断点续灌：灌到一半 commit 被打断，重跑从断掉的一条接着走，最终行齐、无重复
 *   5. 写库失败整笔回滚：故障行及其检查点都不入
 *   6. 越权拦截：viewer 灌不动也 reset 不动
 *   7. reset：恢复到与首灌一致的初始状态
 *   8. 统计单一数据源：待迁移数 = 已探明数，待办清单同源
 */
import {
  seedUtility,
  resetUtilitySeed,
  utilityMetrics,
  relocationTodos,
  type SeedStore,
  type SeedState,
  type SeedTransaction,
  type SeedReport,
} from '../src/data/seed-engine'
import type { EntryRow } from '../src/data/types'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

class MemorySeedStore implements SeedStore {
  rows: EntryRow[] = []
  state: SeedState | null = null
  /** 注入故障：commit 第 N 次提交（按 upsert 的管线编号匹配）时抛错。 */
  failCommitOnCode: string | null = null
  commitCount = 0

  list(): EntryRow[] {
    return this.rows.map((row) => ({ ...row }))
  }
  getState(): SeedState | null {
    return this.state ? { ...this.state } : null
  }
  commit<T>(fn: (tx: SeedTransaction) => T): T {
    const rowsBefore = this.list()
    const stateBefore = this.getState()
    const staged: EntryRow[] = []
    let nextState = stateBefore
    let touched = false
    const tx: SeedTransaction = {
      upsert: (row) => staged.push({ ...row }),
      setState: (state) => {
        nextState = state
        touched = true
      },
    }
    const result = fn(tx)
    this.commitCount += 1
    const failing = staged.find((row) => String(row['管线编号']) === this.failCommitOnCode)
    if (failing) {
      // 模拟写库失败：不得保留任何本笔痕迹（整笔回滚）。
      this.rows = rowsBefore
      this.state = stateBefore
      throw new Error(`模拟磁盘故障：${failing['管线编号']}`)
    }
    this.rows = [...rowsBefore, ...staged]
    if (touched) {
      this.state = nextState
    }
    return result
  }
  reset(): void {
    this.rows = []
    this.state = null
  }
}

const admin = { role: 'admin' }
const viewer = { role: 'viewer' }

console.log('1) 首灌：四状态入库、数值强转、异常单列')
{
  const store = new MemorySeedStore()
  const report = seedUtility(store, { actor: admin })
  check('首灌成功', report.ok && report.finished)
  check('入库 4 条', store.rows.length === 4, `实际 ${store.rows.length}`)
  const statuses = store.rows.map((row) => row.status).sort()
  check(
    '覆盖待探查/已探明/迁改中/已恢复',
    JSON.stringify(statuses) === JSON.stringify(['已恢复', '已探明', '待探查', '迁改中']),
    statuses.join(','),
  )
  check(
    '埋设深度与隧道净距为 number',
    store.rows.every((row) => typeof row['埋设深度'] === 'number' && typeof row['与隧道净距'] === 'number'),
  )
  check('异常 3 行', report.rejected.length === 3, `实际 ${report.rejected.length}`)
  check(
    '异常行写清原因',
    report.rejected.every((r) => r.reason.length > 0) &&
      report.rejected.some((r) => r.reason.includes('不是数字')) &&
      report.rejected.some((r) => r.reason.includes('管线编号为空')),
  )
  check('按编号升序落库', store.rows.map((r) => r['管线编号']).join(',') === 'UTIL-0001,UTIL-0002,UTIL-0003,UTIL-0004')
  check('id 连续', store.rows.map((r) => r.id).join(',') === '1,2,3,4')
}

console.log('2) 重复灌只生效一次')
{
  const store = new MemorySeedStore()
  const first = seedUtility(store, { actor: admin })
  const second = seedUtility(store, { actor: admin })
  const third = seedUtility(store, { actor: admin })
  check('三次执行后仍是 4 行', store.rows.length === 4, `实际 ${store.rows.length}`)
  check('第二次报告幂等', second.ok && second.inserted.length === 0 && second.message.includes('只生效一次'))
  check('第三次报告幂等', third.ok && third.inserted.length === 0)
  check('异常清单不随重灌翻倍', third.rejected.length === 3, `实际 ${third.rejected.length}`)
  void first
}

console.log('3) 断点续灌 + 写库失败整笔回滚')
{
  const store = new MemorySeedStore()
  // 顺序升序为 0001..0004：让第 3 条（UTIL-0003）提交时磁盘故障。
  store.failCommitOnCode = 'UTIL-0003'
  const broken = seedUtility(store, { actor: admin })
  check('中断当次报告失败', !broken.ok)
  check('故障前 2 行保留', store.rows.length === 2, `实际 ${store.rows.length}`)
  check('故障行未入库', !store.rows.some((r) => r['管线编号'] === 'UTIL-0003'))
  check('检查点停在第 2 条', (store.state?.appliedCodes ?? []).join(',') === 'UTIL-0001,UTIL-0002')
  check('故障行进入异常清单', broken.rejected.some((r) => r.code === 'UTIL-0003' && r.reason.includes('整笔回滚')))

  // 恢复磁盘，重跑：必须从断掉的那一条接着走。
  store.failCommitOnCode = null
  const resumed = seedUtility(store, { actor: admin })
  check('续灌成功', resumed.ok && resumed.finished)
  check('续灌走了断点', resumed.resumed)
  check('最终 4 行无重复', store.rows.length === 4 && new Set(store.rows.map((r) => r['管线编号'])).size === 4, `实际 ${store.rows.length}`)
  check('编号顺序不乱', store.rows.map((r) => r['管线编号']).join(',') === 'UTIL-0001,UTIL-0002,UTIL-0003,UTIL-0004')
  check('续灌 id 接着 3、4', store.rows.map((r) => r.id).join(',') === '1,2,3,4')
}

console.log('4) 越权改动一律拦下')
{
  const store = new MemorySeedStore()
  const denied = seedUtility(store, { actor: viewer })
  check('viewer 灌入被拒', !denied.ok && !denied.authorized)
  check('被拒后零数据', store.rows.length === 0 && store.state === null)
  seedUtility(store, { actor: admin })
  const deniedReset: SeedReport = resetUtilitySeed(store, { actor: viewer })
  check('viewer 重置被拒且数据不动', !deniedReset.authorized && store.rows.length === 4)
}

console.log('5) reset 恢复初始状态')
{
  const store = new MemorySeedStore()
  seedUtility(store, { actor: admin })
  // 外部乱改一条，模拟接手人用脏了。
  store.rows.push({ id: 99, status: '待探查', pending: true, abnormal: false, '管线编号': 'UTIL-9999' })
  const report = resetUtilitySeed(store, { actor: admin })
  check('reset 后回到 4 行', store.rows.length === 4, `实际 ${store.rows.length}`)
  check('reset 报告完成', report.ok && report.finished)
  check('脏数据消失', !store.rows.some((r) => r['管线编号'] === 'UTIL-9999'))
  check('reset 后 id 重新从 1 起', store.rows.map((r) => r.id).join(',') === '1,2,3,4')
}

console.log('6) 两处只认一份：待迁移数与待办清单同源')
{
  const store = new MemorySeedStore()
  seedUtility(store, { actor: admin })
  const metrics = utilityMetrics(store.rows)
  const todos = relocationTodos(store.rows)
  check('待迁移数 = 已探明数 = 1', metrics.待迁移管线 === 1 && metrics.已探明管线 === 1)
  check('待办清单同数同条', todos.length === metrics.待迁移管线 && todos[0]['管线编号'] === 'UTIL-0002')
  check('终态(已恢复)不计待办', metrics.待探查管线 === 1 && metrics.迁改中管线 === 1 && metrics.已恢复管线 === 1)
}

console.log('')
if (failures > 0) {
  console.error(`自检失败 ${failures} 项`)
  process.exit(1)
}
console.log('全部自检通过')
