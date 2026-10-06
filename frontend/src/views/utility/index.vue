<template>
  <section class="page" data-module="utility">
    <header class="page-head">
      <div>
        <h2>管线探查管理</h2>
        <p class="page-desc">维护地下管线，围绕管线编号、管线类型、埋设深度、管线管径做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记地下管线</button>
        <button class="btn" type="button" @click="exportRows">导出管线探查清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="showForm" class="filter-bar" @submit.prevent="submitCreate">
      <label v-for="field in createFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="formValues[field]" :placeholder="`请输入${field}`" />
      </label>
      <button class="btn primary" type="submit">提交登记</button>
      <button class="btn ghost" type="button" @click="showForm = false">取消</button>
    </form>

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
              v-for="action in availableActions(row)"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无管线探查数据，可先登记地下管线</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管线探查记录 · 待迁移管线 {{ pendingRelocation }} 条（与进度节点待办同源）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createEntry,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { countPendingRelocation, UTILITY_STATUSES } from '@/data/pipeline-domain'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('utility')
const columns = ["管线编号", "管线类型", "埋设深度", "管线管径", "与隧道净距", "权属单位", "迁改方案", "探查状态"]
const createFields = ["管线编号", "管线类型", "埋设深度", "管线管径", "与隧道净距", "权属单位", "迁改方案"]
const actions = ["提交探查", "安排迁改", "确认恢复"]
const statuses = [...UTILITY_STATUSES]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showForm = ref(false)
const formValues = reactive<Record<string, string>>(
  Object.fromEntries(createFields.map((field) => [field, ''])),
)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
// 待迁移数只认 pipeline-domain 这一份，进度页与概览页看到的同一个数
const pendingRelocation = computed(() => countPendingRelocation(rows.value))
const stats = computed(() => {
  const summary = Object.fromEntries(statusSummary.value.map((item) => [item.status, item.count]))
  return [
    { label: '待探查管线', value: summary['待探查'] ?? 0 },
    { label: '迁改中管线', value: summary['迁改中'] ?? 0 },
    { label: '已恢复管线', value: summary['已恢复'] ?? 0 },
    { label: '待迁移管线', value: pendingRelocation.value },
  ]
})

/** 顺序流程：每行只给出「紧邻的下一步」这一个动作，不让页面上跳着点。 */
function availableActions(row: EntryRow): string[] {
  if (!store.canWrite) {
    return []
  }
  const index = statuses.indexOf(row.status as (typeof statuses)[number])
  if (index < 0 || index >= actions.length) {
    return []
  }
  return [actions[index]]
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  if (!store.require('write')) {
    errorMessage.value = '越权操作被拦下：当前角色为只读，不能登记管线'
    return
  }
  showForm.value = !showForm.value
  errorMessage.value = ''
}

function submitCreate() {
  errorMessage.value = ''
  const payload: Record<string, string | number> = {}
  for (const field of createFields) {
    const raw = formValues[field].trim()
    if (['埋设深度', '管线管径', '与隧道净距'].includes(field)) {
      if (!Number.isFinite(Number(raw))) {
        errorMessage.value = `「${field}」必须是数字`
        return
      }
      payload[field] = Number(raw)
    } else {
      payload[field] = raw
    }
  }
  const result = createEntry(meta.key, payload, store.role)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  for (const field of createFields) {
    formValues[field] = ''
  }
  showForm.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, store.role)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管线探查列表读取失败'
  }
}

onMounted(reload)
</script>
