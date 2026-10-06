<template>
  <section class="page" data-module="progress">
    <header class="page-head">
      <div>
        <h2>进度节点管理</h2>
        <p class="page-desc">维护进度节点，围绕节点编号、节点名称、计划完成日、实际完成日做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记进度节点</button>
        <button class="btn" type="button" @click="exportRows">导出进度节点清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="todo-panel">
      <header class="todo-head">
        <h3>管线迁改进度待办</h3>
        <span class="seed-hint">数据来自管线探查页，同一处现算，不另存一份</span>
      </header>
      <table class="data-table">
        <thead>
          <tr><th>管线编号</th><th>管线类型</th><th>埋设深度(m)</th><th>与隧道净距(m)</th><th>权属单位</th><th>迁改方案</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="item in relocationTodos" :key="String(item.id)">
            <td>{{ item['管线编号'] }}</td>
            <td>{{ item['管线类型'] }}</td>
            <td>{{ item['埋设深度'] }}</td>
            <td>{{ item['与隧道净距'] }}</td>
            <td>{{ item['权属单位'] }}</td>
            <td>{{ item['迁改方案'] }}</td>
            <td class="row-actions">
              <button class="link" type="button" :disabled="!store.isAdmin" @click="arrangeRelocation(item)">
                安排迁改
              </button>
            </td>
          </tr>
          <tr v-if="!relocationTodos.length">
            <td colspan="7" class="empty-state">暂无待迁移管线（已探明待迁改的管线会自动进入此清单）</td>
          </tr>
        </tbody>
      </table>
      <footer class="page-foot">
        <span>待迁移管线：{{ pendingRelocation }} 条（与管线探查页、运营概览同一数字）</span>
        <span v-if="todoMessage" class="error-text">{{ todoMessage }}</span>
      </footer>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无进度节点数据，可先登记进度节点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条进度节点记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  getRelocationTodos,
  getUtilityMetrics,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('progress')
const columns = ["节点编号", "节点名称", "计划完成日", "实际完成日", "计划掘进量", "实际掘进量", "偏差天数", "节点状态"]
const actions = ["开始节点", "确认完成", "登记延期"]
const statuses = ["未开始", "进行中", "已完成", "已延期"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const todoMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 灌完的结论落到这个待办清单：已探明待迁改的管线即待迁移，数字两边同步。
const relocationTodos = ref<EntryRow[]>([])
const pendingRelocation = computed(() => getUtilityMetrics().待迁移管线)

const stats = computed(() => [
  { label: "进行中节点", value: rows.value.filter((r) => r.status === '进行中').length },
  { label: "已完成节点", value: rows.value.filter((r) => r.status === '已完成').length },
  { label: "延期节点", value: rows.value.filter((r) => r.status === '已延期').length },
  { label: "待迁移管线", value: pendingRelocation.value },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '进度节点登记入口尚未接入审批流'
}

function arrangeRelocation(item: EntryRow) {
  todoMessage.value = ''
  // 在进度待办里直接把管线从「已探明」推进到「迁改中」，写的仍是管线那一份数据。
  const result = applyAction('utility', Number(item.id), '安排迁改', { role: store.role })
  if (!result.ok) {
    todoMessage.value = result.message
    return
  }
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, { role: store.role })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  todoMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    relocationTodos.value = getRelocationTodos()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '进度节点列表读取失败'
  }
}

onMounted(reload)
</script>
