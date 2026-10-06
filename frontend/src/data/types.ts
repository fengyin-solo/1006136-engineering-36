/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 角色：viewer 只读，operator 可登记与状态流转，admin 才能灌样例 / 恢复初始数据。 */
export type Role = 'viewer' | 'operator' | 'admin'

export type RolePermission = 'read' | 'write' | 'admin'

export const ROLE_LABELS: Record<Role, string> = {
  viewer: '观察员（只读）',
  operator: '值班员（登记/流转）',
  admin: '管理员（含初始化）',
}

const ROLE_PERMISSIONS: Record<Role, RolePermission[]> = {
  viewer: ['read'],
  operator: ['read', 'write'],
  admin: ['read', 'write', 'admin'],
}

/** 越权改动一律拦下：页面、服务层、初始化脚本都走这一道闸。 */
export function roleAllows(role: Role, permission: RolePermission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 状态必须按 statuses 顺序逐格往后走（不允许跳格），用于管线探查等线性流程。 */
  orderedTransitions?: boolean
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 灌入时被挑出来的异常行：写明管线（业务）编号与拒收原因。 */
export type RejectedRow = {
  module: string
  businessKey: string
  reasons: string[]
  raw: unknown
}

export type SeedReport = {
  seededAt: string
  inserted: number
  skipped: number
  rejected: RejectedRow[]
  resumed: boolean
}
