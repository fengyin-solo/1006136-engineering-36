import { renameSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'

import type { SeedState, SeedStore, SeedTransaction } from '../src/data/seed-engine'
import type { EntryRow } from '../src/data/types'

/**
 * Node 脚本适配器：管线表 + 批次状态写在同一份 JSON 文件里。
 * commit 走「写临时文件 + 原子 rename」：rename 要么不发生、要么整体生效，
 * 中途断掉不会留下写了一半的库，配合检查点即可从断掉的那一条接着走。
 */
export type FileStoreShape = {
  rows: EntryRow[]
  state: SeedState | null
}

export function defaultStorePath(): string {
  return join(process.cwd(), '.data', 'utility-store.json')
}

function emptyStore(): FileStoreShape {
  return { rows: [], state: null }
}

function readStore(file: string): FileStoreShape {
  if (!existsSync(file)) {
    return emptyStore()
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<FileStoreShape>
  return { rows: Array.isArray(parsed.rows) ? parsed.rows : [], state: parsed.state ?? null }
}

export function createFileSeedStore(file: string = defaultStorePath()): SeedStore {
  let snapshot: FileStoreShape = emptyStore()
  let pendingRows: EntryRow[] | null = null
  let pendingState: SeedState | null = null
  let stateTouched = false

  const persist = (data: FileStoreShape): void => {
    const dir = dirname(file)
    mkdirSync(dir, { recursive: true })
    // 临时文件必须落在目标文件同目录：跨设备 rename 会 EXDEV，同目录 rename 才是原子的。
    const tmpFile = join(dir, `.utility-store.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
    try {
      writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8')
      renameSync(tmpFile, file)
    } finally {
      try {
        rmSync(tmpFile, { force: true })
      } catch {
        // rename 成功后临时文件已不存在，清理失败可忽略。
      }
    }
  }

  const store: SeedStore = {
    list(): EntryRow[] {
      return readStore(file).rows
    },
    getState(): SeedState | null {
      return readStore(file).state
    },
    commit<T>(fn: (tx: SeedTransaction) => T): T {
      snapshot = readStore(file)
      pendingRows = [...snapshot.rows]
      pendingState = snapshot.state
      stateTouched = false

      const tx: SeedTransaction = {
        upsert(row) {
          ;(pendingRows as EntryRow[]).push({ ...row })
        },
        setState(state) {
          pendingState = state
          stateTouched = true
        },
      }

      // fn 抛错：根本不调 persist，磁盘上还是旧文件，天然整笔回滚。
      const result = fn(tx)
      const next: FileStoreShape = {
        rows: pendingRows as EntryRow[],
        state: stateTouched ? pendingState : snapshot.state,
      }
      persist(next) // rename 失败则抛错，旧文件完好，即整笔撤销。
      return result
    },
    reset(): void {
      persist(emptyStore())
    },
  }
  return store
}
