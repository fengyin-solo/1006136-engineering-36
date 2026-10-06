import { defineStore } from 'pinia'

import { roleAllows } from '@/data/types'
import type { Role, RolePermission } from '@/data/types'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
    // 默认值班员：能登记与流转；灌样例 / 恢复初始数据要切到管理员
    role: 'operator' as Role,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    canWrite: (state) => roleAllows(state.role, 'write'),
    canAdmin: (state) => roleAllows(state.role, 'admin'),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: Role) {
      this.role = role
    },
    /** 越权改动一律拦下：组件在动手前先问一句。 */
    require(permission: RolePermission): boolean {
      return roleAllows(this.role, permission)
    },
  },
})
