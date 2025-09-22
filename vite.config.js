import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  // 添加环境变量配置
  define: {
    'import.meta.env.VITE_WEBSOCKET_URL': JSON.stringify(process.env.VITE_WEBSOCKET_URL || 'ws://localhost:11451')
  }
})