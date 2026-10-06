import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import { roleAllows } from './types'
import type { EntryRow, RejectedRow, Role, SeedReport } from './types'

/**
 * 初始化引擎：浏览器首次打开与命令行 db:seed 共用这一份逻辑。
 * 约定：
 * - 按「管线编号」这类业务主键去重，已存在或本批重复都不会再产生新行（重复灌只生效一次）。
 * - 中途断掉可以从断掉那一条接着走：游标落在已提交的最大序号之后，重跑跳过已入行。
 * - 异常行（缺主键、数值字段不是数字、重复主键）单独列进 rejected 并写清原因，不进正式数据。
 * - 写库走 transaction：任何一次写入失败，整批撤销回滚，不留半截数据。
 */

export type SeedSpec = {
  /** 业务主键字段，去重就认它（管线模块认「管线编号」）。 */
  keyField: string
  /** 必须是数值的字段；不是数字就拒收，避免本地是数字、容器里变字符串。 */
  numericFields: string[]
}

const UTILITY_SPEC: SeedSpec = {
  keyField: '管线编号',
  numericFields: ['埋设深度', '管线管径', '与隧道净距'],
}

function specFor(moduleKey: string): SeedSpec {
  if (moduleKey === 'utility') {
    return UTILITY_SPEC
  }
  const meta = MODULE_BY_KEY.get(moduleKey)
  return { keyField: meta?.fields[0] ?? 'id', numericFields: [] }
}

export const SEED_VERSION = 1

/** 持久化要实现的能力：浏览器用 localStorage，命令行用 data/ 下的 JSON 文件。 */
export type SeedStore = {
  read(): Record<string, EntryRow[]>
  /** 一次事务内整体落库；抛错即代表整笔失败，由引擎负责回滚。 */
  writeAll(rows: Record<string, EntryRow[]>): void
  readCheckpoint?(): number
  writeCheckpoint?(cursor: number): void
}

export type SeedOutcome = {
  report: SeedReport
  rows: Record<string, EntryRow[]>
}

function businessKey(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function validateRow(
  moduleKey: string,
  row: EntryRow,
  spec: SeedSpec,
  seenKeys: Set<string>,
): string[] {
  const reasons: string[] = []
  const key = businessKey(row, spec.keyField)
  if (!key) {
    reasons.push(`缺少业务主键「${spec.keyField}」`)
  } else if (seenKeys.has(key)) {
    reasons.push(`业务主键「${spec.keyField}=${key}」在同批样例里重复`)
  }
  for (const field of spec.numericFields) {
    const value = row[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      reasons.push(`数值字段「${field}」不是数字（收到 ${JSON.stringify(value)}）`)
    }
  }
  if (typeof row.id !== 'number' || !Number.isInteger(row.id)) {
    reasons.push('id 必须是整数')
  }
  if (typeof row.status !== 'string' || row.status.trim() === '') {
    reasons.push('status 不能为空')
  }
  const meta = MODULE_BY_KEY.get(moduleKey)
  if (meta && !meta.statuses.includes(row.status)) {
    reasons.push(`状态「${row.status}」不在允许集合 ${meta.statuses.join('/')} 内`)
  }
  return reasons
}

/**
 * 灌入样例。role 不是 admin 直接拦下；已有游标时续灌；任何一行写库失败则整笔回滚。
 * 逐行整体快照落库，writeAll 成功才推进游标：
 * - writeAll 抛错（真没写进去）→ 整笔回滚，游标不动；
 * - 进程在 writeAll 成功后被杀（断点演练由适配器模拟）→ 数据与游标都在，重跑续灌。
 */
export function runSeed(store: SeedStore, role: Role): SeedOutcome {
  if (!roleAllows(role, 'admin')) {
    throw new Error('越权操作被拦下：只有管理员（admin）能灌样例')
  }

  const before = store.read()
  const report: SeedReport = {
    seededAt: new Date().toISOString(),
    inserted: 0,
    skipped: 0,
    rejected: [],
    resumed: false,
  }

  // 打平成带全局序号的清单，断点游标就是这个序号（不能按模块各自从 1 数）
  const flat = Object.entries(SEED_ROWS).flatMap(([moduleKey, rows]) =>
    rows.map((row) => ({ moduleKey, row })),
  ).map((item, index) => ({ ...item, seq: index + 1 }))
  const moduleOrder = Object.keys(SEED_ROWS)
  const cursor = store.readCheckpoint?.() ?? 0
  if (cursor > 0) {
    report.resumed = true
  }

  const working: Record<string, EntryRow[]> = {}
  const seen = new Map<string, Set<string>>()
  for (const key of moduleOrder) {
    const spec = specFor(key)
    working[key] = [...(before[key] ?? [])]
    seen.set(key, new Set((before[key] ?? []).map((row) => businessKey(row, spec.keyField))))
  }

  try {
    for (const item of flat) {
      if (item.seq <= cursor) {
        // 上次已经提交过的：续灌直接跳过，不再入一条
        continue
      }
      const spec = specFor(item.moduleKey)
      const key = businessKey(item.row, spec.keyField)
      const batchSeen = seen.get(item.moduleKey)!

      if (key && batchSeen.has(key)) {
        report.skipped += 1
      } else {
        const reasons = validateRow(item.moduleKey, item.row, spec, batchSeen)
        if (reasons.length > 0) {
          const rejected: RejectedRow = {
            module: item.moduleKey,
            businessKey: key || `(第${item.seq}条)`,
            reasons,
            raw: item.row,
          }
          report.rejected.push(rejected)
        } else {
          working[item.moduleKey].push(item.row)
          batchSeen.add(key)
          report.inserted += 1
        }
      }

      // 逐行提交：落库成功才推进游标，断了重跑就从下一条开始
      store.writeAll(working)
      store.writeCheckpoint?.(item.seq)
    }
    // 全部走完：清掉游标，下次重跑是全新检查（靠业务主键去重），不再误报续灌
    store.writeCheckpoint?.(0)
  } catch (error) {
    // 写不进去就整笔回滚：恢复到灌入前的数据快照
    try {
      store.writeAll(before)
    } catch (rollbackError) {
      throw new Error(
        `灌样例失败且回滚也失败：${(error as Error).message} / ${(rollbackError as Error).message}`,
      )
    }
    throw error
  }

  return { report, rows: store.read() }
}

/** 校验通过后的样例基线（坏样例被挑进 rejected）。 */
export function buildBaseline(): { rows: Record<string, EntryRow[]>; report: SeedReport } {
  const report: SeedReport = {
    seededAt: new Date().toISOString(),
    inserted: 0,
    skipped: 0,
    rejected: [],
    resumed: false,
  }
  const baseline: Record<string, EntryRow[]> = {}
  for (const [moduleKey, rows] of Object.entries(SEED_ROWS)) {
    const spec = specFor(moduleKey)
    const batchSeen = new Set<string>()
    baseline[moduleKey] = []
    for (const row of rows) {
      const key = businessKey(row, spec.keyField)
      const reasons = validateRow(moduleKey, row, spec, batchSeen)
      if (reasons.length > 0) {
        report.rejected.push({ module: moduleKey, businessKey: key || '(空主键)', reasons, raw: row })
      } else {
        baseline[moduleKey].push(row)
        batchSeen.add(key)
        report.inserted += 1
      }
    }
  }
  return { rows: baseline, report }
}

/** 恢复到初始状态：清空已灌数据，整表重写为样例基线（只含校验通过的行）。 */
export function runReset(store: SeedStore, role: Role): { rows: Record<string, EntryRow[]>; report: SeedReport } {
  if (!roleAllows(role, 'admin')) {
    throw new Error('越权操作被拦下：只有管理员（admin）能恢复初始数据')
  }
  const before = store.read()
  const { rows: baseline, report } = buildBaseline()
  try {
    store.writeAll(baseline)
    store.writeCheckpoint?.(0)
  } catch (error) {
    try {
      store.writeAll(before)
    } catch {
      // 基线写失败、原状也恢复不了时继续抛原错
    }
    throw error
  }
  return { rows: store.read(), report }
}
