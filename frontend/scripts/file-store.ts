import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { SeedStore } from '../src/data/seed-engine'
import type { EntryRow, SeedReport } from '../src/data/types'

/**
 * 命令行初始化脚本的存储适配器：数据落在 data/ 下的 JSON 文件。
 * 与浏览器 LocalStorageStore 实现同一个 SeedStore 接口，灌入引擎完全复用。
 */

const DATA_FILE = 'entries.json'
const CHECKPOINT_FILE = 'seed-cursor.json'
const REPORT_FILE = 'seed-report.json'

export class FileStore implements SeedStore {
  private readonly dir: string
  /** 演练写库失败：第一次 writeAll 抛错（之后恢复，模拟瞬时故障），验证回滚能把数据复原。 */
  private failWrite: boolean
  /** 演练断点：游标推进到这个全局序号后进程硬退出，验证「从断掉那一条接着走」。 */
  private readonly crashAfter: number

  constructor(dataDir: string, opts: { failWrite?: boolean; crashAfter?: number } = {}) {
    this.dir = dataDir
    this.failWrite = opts.failWrite ?? false
    this.crashAfter = opts.crashAfter ?? 0
  }

  private path(file: string): string {
    return join(this.dir, file)
  }

  private readJson<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(this.path(file), 'utf-8')) as T
    } catch {
      return fallback
    }
  }

  private atomicWrite(file: string, content: string): void {
    mkdirSync(dirname(this.path(file)), { recursive: true })
    const target = this.path(file)
    const tmp = `${target}.tmp`
    writeFileSync(tmp, content, 'utf-8')
    renameSync(tmp, target)
  }

  read(): Record<string, EntryRow[]> {
    return this.readJson<Record<string, EntryRow[]>>(DATA_FILE, {})
  }

  /** 原子写：先写临时文件再 rename，避免半截文件；failWrite 时模拟写库失败。 */
  writeAll(rows: Record<string, EntryRow[]>): void {
    if (this.failWrite) {
      this.failWrite = false
      throw new Error('模拟写库失败（磁盘瞬时不可写）')
    }
    this.atomicWrite(DATA_FILE, JSON.stringify(rows, null, 2))
  }

  readCheckpoint(): number {
    const value = this.readJson<{ cursor: number } | null>(CHECKPOINT_FILE, null)
    return value && Number.isInteger(value.cursor) ? value.cursor : 0
  }

  writeCheckpoint(cursor: number): void {
    this.atomicWrite(CHECKPOINT_FILE, JSON.stringify({ cursor }, null, 2))
    // 数据与游标都已成功落盘，在这里杀掉进程：重跑时从 cursor+1 续灌
    if (this.crashAfter > 0 && cursor >= this.crashAfter && cursor > 0) {
      writeFileSync(
        join(this.dir, 'CRASH-NOTES.txt'),
        `断点演练：处理到全局第 ${cursor} 条后进程中断\n`,
        'utf-8',
      )
      process.exit(2)
    }
  }

  saveReport(report: SeedReport): void {
    this.atomicWrite(REPORT_FILE, JSON.stringify(report, null, 2))
  }
}
