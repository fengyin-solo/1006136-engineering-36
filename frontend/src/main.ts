import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { ensureSeeded } from './data/local-store'
import './styles/global.css'

// 首次打开灌样例：与命令行 npm run db:seed 走同一套引擎（去重/校验/续灌/回滚）。
ensureSeeded('admin')

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
