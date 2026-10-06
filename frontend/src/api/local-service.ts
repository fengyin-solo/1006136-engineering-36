import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  resetAll as resetAllData,
  resetRows,
  saveRows,
  seedEntries,
  seedReport,
} from '@/data/local-store'
import { countPendingRelocation } from '@/data/pipeline-domain'
import { roleAllows } from '@/data/types'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  Role,
  SeedReport,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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

/** 管线模块的顺序闸：只能从当前状态走到紧邻的下一格，跳格一律拦下。 */
function checkOrderedTransition(meta: ModuleMeta, current: string, target: string): string | null {
  if (!meta.orderedTransitions) {
    return null
  }
  const currentIndex = meta.statuses.indexOf(current)
  const targetIndex = meta.statuses.indexOf(target)
  if (currentIndex < 0) {
    return `当前状态「${current}」不在流程里，不能流转`
  }
  if (targetIndex <= currentIndex) {
    return `流程顺序为 ${meta.statuses.join(' → ')}，不能从「${current}」走回「${target}」`
  }
  if (targetIndex !== currentIndex + 1) {
    return `流程顺序为 ${meta.statuses.join(' → ')}，不能从「${current}」跳到「${target}」`
  }
  return null
}

export function runAction(key: string, id: number, action: string, role: Role = 'operator'): ActionResult {
  if (!roleAllows(role, 'write')) {
    return { ok: false, message: '越权操作被拦下：当前角色只能查看，不能改动数据' }
  }
  const meta = moduleMeta(key)
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
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const orderError = checkOrderedTransition(meta, current, target)
  if (orderError) {
    return { ok: false, message: orderError }
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
    // 写库失败会在存储层就地撤销，这里原样把失败原因返回页面
    saveRows(key, next)
  } catch (error) {
    return { ok: false, message: `写库失败，已整笔回滚：${(error as Error).message}` }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/**
 * 登记一条新记录。反复提交也只入一条：业务主键相同就返回已存在那条。
 * 写库失败由存储层回滚，这里不产生半截数据。
 */
export function createEntry(
  key: string,
  values: Record<string, string | number>,
  role: Role = 'operator',
): ActionResult & { id?: number } {
  if (!roleAllows(role, 'write')) {
    return { ok: false, message: '越权操作被拦下：当前角色只能查看，不能登记' }
  }
  const meta = moduleMeta(key)
  const keyField = meta.fields[0]
  const businessKey = String(values[keyField] ?? '').trim()
  if (!businessKey) {
    return { ok: false, message: `${keyField}不能为空` }
  }
  const rows = listRows(key)
  const existing = rows.find((row) => String(row[keyField] ?? '').trim() === businessKey)
  if (existing) {
    // 反复提交只入一条：告诉调用方这是已有的那条，不新插入
    return { ok: true, id: Number(existing.id), message: `${meta.entity}「${businessKey}」已存在，不重复登记` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const row: EntryRow = { id, status: meta.statuses[0], pending: true, abnormal: false, ...values }
  try {
    saveRows(key, [...rows, row])
  } catch (error) {
    return { ok: false, message: `写库失败，已整笔回滚：${(error as Error).message}` }
  }
  return { ok: true, id, message: `${meta.entity}「${businessKey}」已登记` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

/** 初始化入口（页面）：灌样例，仅管理员。 */
export function seedSampleData(role: Role): SeedReport {
  return seedEntries(role)
}

/** 初始化入口（页面）：恢复初始数据，仅管理员。 */
export function restoreSampleData(role: Role): SeedReport {
  return resetAllData(role)
}

export function lastSeedReport(): SeedReport | null {
  return seedReport()
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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
  // 待迁移管线数与管线探查页、进度节点页同一份口径
  const pendingRelocation = countPendingRelocation(rows.utility ?? [])
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '待迁移管线', value: pendingRelocation },
  ]
  return { cards, modules }
}
