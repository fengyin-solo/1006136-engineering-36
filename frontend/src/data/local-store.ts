import { buildBaseline, runReset, runSeed, type SeedStore } from './seed-engine'
import type { EntryRow, Role, SeedReport } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'
const CHECKPOINT_KEY = 'shield-tunnel-construction:seed-cursor'
const REPORT_KEY = 'shield-tunnel-construction:seed-report'
const STATE_KEY = 'shield-tunnel-construction:state-version'
const STATE_VERSION = 1

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 写库边界统一归一化：数值字段若是数字字符串，在这里转回 number，不让它流进页面。 */
function normalize(rows: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const numericFields = ['埋设深度', '管线管径', '与隧道净距']
  const next = clone(rows)
  for (const moduleRows of Object.values(next)) {
    for (const row of moduleRows) {
      for (const field of numericFields) {
        const value = row[field]
        if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
          row[field] = Number(value)
        }
      }
    }
  }
  return next
}

function safeParse(raw: string | null): Record<string, EntryRow[]> | null {
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    return null
  }
}

class LocalStorageStore implements SeedStore {
  read(): Record<string, EntryRow[]> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {}
    }
    return normalize(safeParse(window.localStorage.getItem(STORAGE_KEY)) ?? {})
  }

  /**
   * 事务化提交：先把原值留在变量里，setItem 抛错（配额满 / 隐私模式）时
   * 就地撤销回原值，调用方拿到的仍是写之前的状态。
   */
  writeAll(rows: Record<string, EntryRow[]>): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      throw new Error('当前环境没有可用的本地存储')
    }
    const previous = window.localStorage.getItem(STORAGE_KEY)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(rows)))
    } catch (error) {
      if (previous === null) {
        window.localStorage.removeItem(STORAGE_KEY)
      } else {
        window.localStorage.setItem(STORAGE_KEY, previous)
      }
      throw new Error(`写库失败，已就地撤销：${(error as Error).message}`)
    }
  }

  readCheckpoint(): number {
    const raw = window.localStorage.getItem(CHECKPOINT_KEY)
    const value = Number(raw)
    return Number.isInteger(value) && value > 0 ? value : 0
  }

  writeCheckpoint(cursor: number): void {
    if (cursor > 0) {
      window.localStorage.setItem(CHECKPOINT_KEY, String(cursor))
    } else {
      window.localStorage.removeItem(CHECKPOINT_KEY)
    }
  }
}

const store = new LocalStorageStore()

function saveReport(report: SeedReport): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(REPORT_KEY, JSON.stringify(report))
  }
}

export function seedReport(): SeedReport | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return safeParse(window.localStorage.getItem(REPORT_KEY)) as SeedReport | null
}

/** 首次打开：走与 db:seed 同一份灌入引擎，去重 / 校验 / 报告完全一致。 */
export function ensureSeeded(role: Role = 'admin'): SeedReport | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const version = window.localStorage.getItem(STATE_KEY)
  const hasData = window.localStorage.getItem(STORAGE_KEY) !== null
  if (version === String(STATE_VERSION) && hasData) {
    return null // 重复灌样例只生效一次
  }
  const { report } = runSeed(store, role)
  saveReport(report)
  window.localStorage.setItem(STATE_KEY, String(STATE_VERSION))
  cache = null
  return report
}

/** 初始化脚本之一（页面上的等价入口）：灌样例。已灌过再点，跳过已存在的业务主键。 */
export function seedEntries(role: Role = 'admin'): SeedReport {
  const { report } = runSeed(store, role)
  saveReport(report)
  window.localStorage.setItem(STATE_KEY, String(STATE_VERSION))
  cache = null
  return report
}

/** 初始化脚本之二：把数据恢复到初始状态（只含校验通过的基线行）。 */
export function resetAll(role: Role = 'admin'): SeedReport {
  const { report } = runReset(store, role)
  saveReport(report)
  window.localStorage.setItem(STATE_KEY, String(STATE_VERSION))
  cache = null
  return report
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = store.read()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/** 单次事务内整体替换一个模块；失败由 LocalStorageStore 就地撤销。 */
export function saveRows(key: string, rows: EntryRow[]): void {
  store.writeAll({ ...allRows(), [key]: rows })
  cache = null
}

export function resetRows(key: string): EntryRow[] {
  const rows = baselineRows()[key] ?? []
  saveRows(key, rows)
  return rows
}

/** 校验通过后的样例基线（与 runReset 同一口径，单模块重置也不做两套）。 */
function baselineRows(): Record<string, EntryRow[]> {
  return buildBaseline().rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
