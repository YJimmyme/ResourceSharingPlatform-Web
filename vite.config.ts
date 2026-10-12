import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    base: env.VITE_BASE_PATH || '/ResourceSharingPlatform-Web/',
    plugins: [react()],
    // 本機開發：/vision-api 轉到本機辨識服務，與正式環境 nginx 的同源代理一致
    server: {
      proxy: {
        '/vision-api': {
          target: env.VISION_DEV_PROXY || 'http://127.0.0.1:8000',
          rewrite: (path) => path.replace(/^\/vision-api/, ''),
        },
      },
    },
  }
})
