import type { EntryRow } from './types'

/**
 * 管线探查领域口径：待迁移管线与进度待办的统计全走这里。
 * 管线探查页、进度节点页、运营概览三处只认这一份，谁都不许自己再算一遍。
 */

// 管线状态顺序由这里拍板：待探查 → 已探明 → 迁改中 → 已恢复
export const UTILITY_STATUSES = ['待探查', '已探明', '迁改中', '已恢复'] as const

/** 需要迁移的管线：已经探明位置、要安排或正在迁改的（已探明 + 迁改中）。 */
export function isPendingRelocation(row: EntryRow): boolean {
  return row.status === '已探明' || row.status === '迁改中'
}

/** 待迁移管线清单：灌完样例后，它们就成为进度节点上要跟进的待办。 */
export function pendingRelocationPipelines(rows: EntryRow[]): EntryRow[] {
  return rows.filter(isPendingRelocation)
}

export function countPendingRelocation(rows: EntryRow[]): number {
  return pendingRelocationPipelines(rows).length
}

export function utilityStatusCounts(rows: EntryRow[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(
    UTILITY_STATUSES.map((status) => [status, 0]),
  )
  for (const row of rows) {
    const status = String(row.status)
    if (status in counts) {
      counts[status] += 1
    }
  }
  return counts
}
