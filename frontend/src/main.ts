import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './styles/global.css'
import { seedUtilitySamples } from './api/local-service'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 首次打开自动灌一遍管线样例：引擎按管线编号去重 + 批次检查点，
// 同批次再打开只生效一次，不会反复多出行；异常行不进库。
// 首启以 admin 身份执行（这是出厂初始化，不是用户操作）；运行期写操作仍受角色控制。
seedUtilitySamples({ role: 'admin' })

app.mount('#app')
