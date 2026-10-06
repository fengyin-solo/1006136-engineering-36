import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  relocationTodos,
  resetUtilitySeed,
  seedUtility,
  utilityMetrics,
  type SeedReport,
} from '@/data/seed-engine'
import { createBrowserSeedStore } from '@/data/browser-seed-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 谁能写库：只有 admin。viewer 的任何改动一律拦下，查询不受影响。
export type Actor = { role: 'admin' | 'viewer' }

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/**
 * 状态流转规则（顺序在此拍板）：动作必须把记录从当前状态推到「紧邻的下一态」。
 * 不允许跳态（待探查直接确认恢复）、不允许回头（已恢复再提交探查）、
 * 目标态与当前相同（反复点同一个动作）直接幂等拒绝。
 */
export function runAction(key: string, id: number, action: string, actor: Actor = { role: 'admin' }): ActionResult {
  const meta = moduleMeta(key)

  if (actor.role !== 'admin') {
    return { ok: false, message: '越权操作已拦下：当前为只读角色，状态流转仅 admin 可执行' }
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }

  const current = String(rows[index].status)
  if (current === target) {
    // 反复提交只入一条：状态没变就不产生任何写入。
    return { ok: false, message: `${meta.entity}已经是「${target}」，重复操作不生效` }
  }
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  if (currentIndex < 0 || targetIndex !== currentIndex + 1) {
    return {
      ok: false,
      message: `${meta.entity}当前为「${current}」，只能先执行推进到下一态的动作，不能${action}到「${target}」`,
    }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  try {
    saveRows(key, next)
  } catch (error) {
    // 写库失败就地撤销：saveRows 未成功即视为本笔回滚，内存与界面仍以旧数据为准。
    return {
      ok: false,
      message: `写库失败，已整笔回滚：${error instanceof Error ? error.message : '未知存储错误'}`,
    }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string, actor: Actor = { role: 'admin' }): PageResult {
  if (actor.role !== 'admin') {
    throw new Error('越权操作已拦下：恢复初始数据仅 admin 可执行')
  }
  resetRows(key)
  return listEntries(key)
}

// ===== 管线探查：灌样例 / 恢复初始状态（浏览器侧，与 Node 脚本同一引擎） =====

export function seedUtilitySamples(actor: Actor): SeedReport {
  return seedUtility(createBrowserSeedStore(), { actor })
}

export function resetUtilitySamples(actor: Actor): SeedReport {
  return resetUtilitySeed(createBrowserSeedStore(), { actor })
}

// 两处页面只认一份：待迁移管线数与待办清单都从同一份管线行现算。
export function getUtilityMetrics() {
  return utilityMetrics(listRows('utility'))
}

export function getRelocationTodos(): EntryRow[] {
  return relocationTodos(listRows('utility'))
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: '\uFEFF' + lines.join('\n') }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  // 待迁移管线数与管线探查页、进度节点页同源同口径，概览页不另算一份。
  const utility = utilityMetrics(rows['utility'] ?? [])
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '待迁移管线', value: utility.待迁移管线 },
  ]
  return { cards, modules }
}
