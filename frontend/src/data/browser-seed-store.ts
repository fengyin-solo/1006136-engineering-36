import { listRows, resetRows, saveRows, storageKey } from './local-store'
import {
  SeedState,
  SeedStore,
  SeedTransaction,
  UTILITY_KEY,
} from './seed-engine'
import type { EntryRow } from './types'

// 灌入批次状态单独存放：检查点、异常行清单都在这里，刷新不丢，断了能接着走。
const STATE_KEY = 'shield-tunnel-construction:utility-seed-state'

function readState(): SeedState | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(STATE_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as SeedState
  } catch {
    return null
  }
}

function writeState(state: SeedState | null): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('当前环境没有 localStorage，灌样例状态无法落库')
  }
  if (state === null) {
    window.localStorage.removeItem(STATE_KEY)
  } else {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state))
  }
}

/**
 * 浏览器适配器：localStorage 没有原生事务，commit 用「快照 + 补偿」模拟——
 * 先把管线表和批次状态两份快照都存好，任一步写失败就按快照还原，整笔撤销。
 */
export function createBrowserSeedStore(): SeedStore {
  return {
    list(): EntryRow[] {
      return listRows(UTILITY_KEY)
    },
    getState(): SeedState | null {
      return readState()
    },
    commit<T>(fn: (tx: SeedTransaction) => T): T {
      const rowsSnapshot = listRows(UTILITY_KEY).map((row) => ({ ...row }))
      const stateSnapshot = readState()
      const rowsBuffer: EntryRow[] = []
      let stateBuffer: SeedState | null = null
      let stateTouched = false

      const tx: SeedTransaction = {
        upsert(row) {
          rowsBuffer.push({ ...row })
        },
        setState(state) {
          stateBuffer = state
          stateTouched = true
        },
      }

      try {
        const result = fn(tx)
        // fn 全部成功后才真正落库；落库顺序：先管线表，后检查点。
        try {
          if (rowsBuffer.length > 0) {
            saveRows(UTILITY_KEY, [...rowsSnapshot, ...rowsBuffer])
          }
          if (stateTouched) {
            writeState(stateBuffer)
          }
        } catch (writeError) {
          // 写库失败就地撤销：两份存储都还原到提交前快照。
          try {
            saveRows(UTILITY_KEY, rowsSnapshot)
            writeState(stateSnapshot)
          } catch (rollbackError) {
            throw new Error(
              `写库失败且回滚未完成：${writeError instanceof Error ? writeError.message : writeError}；` +
                `回滚错误：${rollbackError instanceof Error ? rollbackError.message : rollbackError}`,
            )
          }
          throw writeError
        }
        return result
      } catch (error) {
        // fn 内部主动抛错（例如提交瞬间发现编号被占）：同样整笔还原。
        saveRows(UTILITY_KEY, rowsSnapshot)
        writeState(stateSnapshot)
        throw error
      }
    },
    reset(): void {
      // 回到初始状态：管线表重置为出厂基线，批次状态清掉，随后由引擎重新灌第一遍。
      resetRows(UTILITY_KEY)
      writeState(null)
    },
  }
}

export function utilityStateStorageKey(): string {
  return STATE_KEY
}

export function entriesStorageKey(): string {
  return storageKey()
}
