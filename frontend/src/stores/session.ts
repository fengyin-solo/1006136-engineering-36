import { defineStore } from 'pinia'

export type AppRole = 'admin' | 'viewer'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '盾构隧道掘进施工管理平台',
    // admin 可写库；viewer 只读，任何状态流转/灌样例/重置都会被服务层拦下。
    role: 'admin' as AppRole,
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isAdmin: (state) => state.role === 'admin',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: AppRole) {
      this.role = role
    },
  },
})
