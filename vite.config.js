import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const plugins = [vue()]

  // 仅在本地开发时加载 devtools；CI 构建不会触发这里
  if (command === 'serve') {
    try {
      const { default: vueDevTools } = await import('vite-plugin-vue-devtools')
      plugins.push(vueDevTools())
    } catch (e) {
      // 本地未安装也不阻塞
      console.warn('[vite] vite-plugin-vue-devtools not installed, skipping.')
    }
  }

  const websocketUrl = env.VITE_WEBSOCKET_URL || 'ws://localhost:11451'

  return {
    plugins,
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // 环境变量：给编译期一个默认值；生产环境用 Pages 面板里配置的同名变量覆盖
    define: {
      'import.meta.env.VITE_WEBSOCKET_URL': JSON.stringify(websocketUrl),
    },
  }
})
