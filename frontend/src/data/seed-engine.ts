/**
 * 管线探查样例灌入引擎：开发脚本、浏览器、容器三处共用这一份。
 *
 * 顺序由本文件拍板，任何调用方都不能插队：
 *   1. 权限校验：非 admin 一律拦下（越权改动一律拦下）
 *   2. 行级校验：编号必填、状态合法、埋深/净距必须是数字；异常行单独列出并写清原因
 *   3. 按管线编号去重：样例内重复只认第一条；库里已存在的编号幂等跳过（重复灌不会多出行）
 *   4. 编号升序排序：谁先谁后固定，不依赖文件到达顺序
 *   5. 断点续灌：已提交到检查点的行直接跳过，从断掉的那一条接着走
 *   6. 逐行事务写入：commit 写不进去就整笔回滚，已写行不受影响
 *   7. 提交成功后才推进检查点
 *   8. 待办/统计不落库，读取时从同一份管线数据重算（两处只认一份）
 */
import { MODULE_BY_KEY } from './modules'
import type { EntryRow, ModuleMeta } from './types'
import utilitySample from './utility-sample.json'

export const UTILITY_KEY = 'utility'

// 必须强转为数值的字段：本地算出数字、容器里变字符串的故障点就在这。
export const NUMERIC_FIELDS = ['埋设深度', '与隧道净距'] as const

export type RawUtilityRow = Record<string, unknown>

export type RejectedRow = {
  index: number
  code: string
  reason: string
  raw: RawUtilityRow
}

export type SeedState = {
  batchId: string
  appliedCodes: string[]
  rejected: RejectedRow[]
  finished: boolean
  updatedAt: string
}

/**
 * 持久化适配器：Node 脚本用 JSON 文件（原子 rename 真事务），
 * 浏览器用 localStorage（commit 内用补偿动作模拟事务，失败就地撤销）。
 */
export type SeedStore = {
  list(): EntryRow[]
  getState(): SeedState | null
  /** 一次提交 = 一个事务。fn 内任意一步抛错，本批所有写入必须撤销。 */
  commit<T>(fn: (tx: SeedTransaction) => T): T
  reset(): void
}

export type SeedTransaction = {
  upsert(row: EntryRow): void
  setState(state: SeedState): void
}

export type SeedOptions = {
  actor: { role: string }
  /** 断点强制重跑时置 true（reset 用），常规灌入不许改它。 */
  restart?: boolean
  now?: () => Date
}

export type SeedReport = {
  ok: boolean
  authorized: boolean
  message: string
  batchId: string
  resumed: boolean
  inserted: EntryRow[]
  skipped: { code: string; reason: string }[]
  rejected: RejectedRow[]
  appliedCodes: string[]
  finished: boolean
}

type NormalizedRow = {
  index: number
  code: string
  row: EntryRow
}

const utilityMeta = MODULE_BY_KEY.get(UTILITY_KEY)
if (!utilityMeta) {
  throw new Error('模块表缺少 utility 定义，灌样例引擎无法启动')
}
const meta: ModuleMeta = utilityMeta
const UTILITY_STATUSES = meta.statuses
const TERMINAL_STATUS = UTILITY_STATUSES[UTILITY_STATUSES.length - 1]

export function loadSampleFeed(): RawUtilityRow[] {
  return (utilitySample as { rows: RawUtilityRow[] }).rows
}

/** 同一份样例的批次指纹：样例内容变了，批次才变（旧批次检查点自动作废重灌）。 */
export function batchIdOf(rows: RawUtilityRow[]): string {
  const source = JSON.stringify(rows)
  let hash = 0
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) | 0
  }
  return `utility-v${(utilitySample as { version: number }).version}-${(hash >>> 0).toString(36)}`
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim())
    if (Number.isFinite(n)) {
      return n
    }
  }
  return null
}

/**
 * 第 2 步：行级校验 + 数值归一化。返回「可灌行」和「异常行清单」。
 * 空编号没法进去重表，直接拒收。
 */
export function normalizeRows(rawRows: RawUtilityRow[]): {
  valid: NormalizedRow[]
  rejected: RejectedRow[]
} {
  const valid: NormalizedRow[] = []
  const rejected: RejectedRow[] = []

  rawRows.forEach((raw, index) => {
    const code = String(raw['管线编号'] ?? '').trim()
    const reasons: string[] = []

    if (!code) {
      reasons.push('管线编号为空，无法去重')
    }
    const status = String(raw['探查状态'] ?? '').trim()
    if (!UTILITY_STATUSES.includes(status)) {
      reasons.push(`探查状态「${status}」不合法，允许值：${UTILITY_STATUSES.join('、')}`)
    }
    for (const field of NUMERIC_FIELDS) {
      if (toNumber(raw[field]) === null) {
        reasons.push(`${field}「${String(raw[field] ?? '')}」不是数字`)
      }
    }

    if (reasons.length > 0) {
      rejected.push({ index, code, reason: reasons.join('；'), raw })
      return
    }

    const row: EntryRow = {
      id: 0, // id 由 applyRows 按库内最大号续编
      status,
      pending: status !== TERMINAL_STATUS,
      abnormal: false,
    }
    for (const field of meta.fields) {
      if (field === '探查状态') {
        row[field] = status
        continue
      }
      row[field] = NUMERIC_FIELDS.includes(field as (typeof NUMERIC_FIELDS)[number])
        ? (toNumber(raw[field]) as number)
        : String(raw[field] ?? '').trim()
    }
    valid.push({ index, code, row })
  })

  return { valid, rejected }
}

/**
 * 第 3 步：样例内按编号去重（只认第一条，重复报送算作异常行）+ 库内已存在幂等跳过。
 */
export function dedupeRows(
  valid: NormalizedRow[],
  existing: EntryRow[],
): {
  accepted: NormalizedRow[]
  duplicates: { code: string; reason: string }[]
  invalidDuplicates: RejectedRow[]
} {
  const seenInFeed = new Set<string>()
  const accepted: NormalizedRow[] = []
  const duplicates: { code: string; reason: string }[] = []
  const invalidDuplicates: RejectedRow[] = []

  for (const item of valid) {
    if (seenInFeed.has(item.code)) {
      // 同一份样例里重复报送是数据质量问题，进异常清单，不进库也不混入正常跳过。
      invalidDuplicates.push({
        index: item.index,
        code: item.code,
        reason: `样例内管线编号重复（第 ${item.index + 1} 条），按编号去重只认第一条`,
        raw: item.row,
      })
      continue
    }
    seenInFeed.add(item.code)
    if (existing.some((row) => String(row['管线编号']) === item.code)) {
      duplicates.push({ code: item.code, reason: '库中已存在该管线编号，幂等跳过' })
      continue
    }
    accepted.push(item)
  }
  return { accepted, duplicates, invalidDuplicates }
}

/** 第 4 步：编号升序，编号相同的保留原始先后。顺序固定，灌入结果才可复现。 */
export function orderRows(accepted: NormalizedRow[]): NormalizedRow[] {
  return [...accepted].sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
}

/** 第 8 步的读取侧：待迁移待办只从管线行重算，别处不许另存一份。 */
export function utilityMetrics(rows: EntryRow[]) {
  const count = (status: string) => rows.filter((row) => String(row.status) === status).length
  return {
    待探查管线: count('待探查'),
    已探明管线: count('已探明'),
    迁改中管线: count('迁改中'),
    已恢复管线: count('已恢复'),
    // 待迁移 = 已探明等着安排迁改的；迁改中的另算在办。两处页面只认这个口径。
    待迁移管线: count('已探明'),
  }
}

export function relocationTodos(rows: EntryRow[]): EntryRow[] {
  return rows
    .filter((row) => String(row.status) === '已探明')
    .sort((a, b) => String(a['管线编号']).localeCompare(String(b['管线编号']), 'zh-Hans-CN'))
}

/**
 * 灌入主流程。返回报告，绝不抛出业务异常：调用方拿报告渲染/打印即可。
 * 适配器 commit 抛错代表「写库失败」：本笔就地撤销，并把该行归入 rejected 后停止，
 * 检查点停在最后一条成功行，下次从断掉的那一条接着走。
 */
export function seedUtility(store: SeedStore, options: SeedOptions): SeedReport {
  const denied: SeedReport = {
    ok: false,
    authorized: false,
    message: '越权操作已拦下：仅 admin 角色可以灌样例/恢复初始状态',
    batchId: '',
    resumed: false,
    inserted: [],
    skipped: [],
    rejected: [],
    appliedCodes: [],
    finished: false,
  }
  if (options.actor.role !== 'admin') {
    return denied
  }

  const rawRows = loadSampleFeed()
  const batchId = batchIdOf(rawRows)
  const now = options.now ?? (() => new Date())

  const previous = store.getState()
  const sameBatch = previous?.batchId === batchId

  // 重复灌样例只生效一次：同批次且已跑完，直接幂等返回，不再碰数据。
  if (sameBatch && previous?.finished && !options.restart) {
    return {
      ok: true,
      authorized: true,
      message: `批次 ${batchId} 已灌过，重复灌只生效一次`,
      batchId,
      resumed: false,
      inserted: [],
      skipped: [],
      rejected: previous.rejected,
      appliedCodes: previous.appliedCodes,
      finished: true,
    }
  }

  // 样例换版或 reset：从空批次重新开始。
  const state: SeedState =
    sameBatch && !options.restart && previous
      ? { ...previous, rejected: [...previous.rejected] }
      : { batchId, appliedCodes: [], rejected: [], finished: false, updatedAt: now().toISOString() }

  const { valid, rejected: invalidRows } = normalizeRows(rawRows)
  // 校验异常只登记一次：断点续灌时沿用批次里已记录的清单。
  for (const item of invalidRows) {
    if (!state.rejected.some((r) => r.index === item.index)) {
      state.rejected.push(item)
    }
  }

  const existing = store.list()
  const { accepted, duplicates, invalidDuplicates } = dedupeRows(valid, existing)
  const ordered = orderRows(accepted)

  // 样例内重复报送每次都要在异常清单里出现（不是「只发生一次」的校验结果，重灌报告也得看得到）。
  for (const item of invalidDuplicates) {
    if (!state.rejected.some((r) => r.index === item.index)) {
      state.rejected.push(item)
    }
  }

  // 第 5 步：断点续灌。检查点里已有编号 = 上次已提交，哪怕它们此刻在去重集合里也算续灌。
  const resumedFromCheckpoint = state.appliedCodes.length > 0
  const pending = ordered.filter((item) => !state.appliedCodes.includes(item.code))
  const alreadyApplied = ordered
    .filter((item) => state.appliedCodes.includes(item.code))
    .map((item) => ({ code: item.code, reason: '断点续灌：该编号已提交，跳过' }))

  const inserted: EntryRow[] = []
  const maxId = existing.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  let nextId = maxId + 1
  let writeFailure: string | null = null

  for (const item of pending) {
    const row: EntryRow = { ...item.row, id: nextId }
    try {
      store.commit((tx) => {
        // 库内清单：去重表是读事务前拍的快照，提交瞬间再兜底查一次编号。
        const live = store.list()
        if (live.some((r) => String(r['管线编号']) === item.code)) {
          throw new Error(`管线编号 ${item.code} 已被其他提交写入，本笔撤销`)
        }
        tx.upsert(row)
        const nextState: SeedState = {
          ...state,
          appliedCodes: [...state.appliedCodes, item.code],
          updatedAt: now().toISOString(),
        }
        tx.setState(nextState)
      })
    } catch (error) {
      // 第 6 步：写库失败，整笔回滚——适配器保证本笔不落盘，这里只记录并停在断点。
      writeFailure = `管线 ${item.code} 写库失败，整笔回滚：${
        error instanceof Error ? error.message : '未知写入错误'
      }`
      state.rejected.push({
        index: item.index,
        code: item.code,
        reason: writeFailure,
        raw: item.row,
      })
      break
    }
    state.appliedCodes.push(item.code)
    existing.push(row)
    inserted.push(row)
    nextId += 1
  }

  const finished = writeFailure === null
  if (finished && !state.finished) {
    try {
      store.commit((tx) => tx.setState({ ...state, finished: true, updatedAt: now().toISOString() }))
    } catch (error) {
      return {
        ok: false,
        authorized: true,
        message: `检查点收尾写入失败，可重跑续灌：${error instanceof Error ? error.message : '未知错误'}`,
        batchId,
        resumed: resumedFromCheckpoint,
        inserted,
        skipped: [...duplicates, ...alreadyApplied],
        rejected: state.rejected,
        appliedCodes: state.appliedCodes,
        finished: false,
      }
    }
    state.finished = true
  }

  const rejectedSorted = [...state.rejected].sort((a, b) => a.index - b.index)
  const message = finished
    ? `灌入完成：新增 ${inserted.length} 条，跳过 ${duplicates.length + alreadyApplied.length} 条，异常 ${rejectedSorted.length} 条`
    : (writeFailure as string)

  return {
    ok: finished,
    authorized: true,
    message,
    batchId,
    resumed: resumedFromCheckpoint,
    inserted,
    skipped: [...duplicates, ...alreadyApplied],
    rejected: rejectedSorted,
    appliedCodes: state.appliedCodes,
    finished,
  }
}

/** 恢复初始状态：清掉管线数据与灌入批次状态，随后从第一批样例重新灌一遍。 */
export function resetUtilitySeed(store: SeedStore, options: SeedOptions): SeedReport {
  if (options.actor.role !== 'admin') {
    return seedUtility(store, options) // 复用同一道越权拦截，返回标准拒绝报告
  }
  store.reset()
  return seedUtility(store, { ...options, restart: true })
}
