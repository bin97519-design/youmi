import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPrefix = env.VITE_APP_BASE_API || '/dev-api';
  const apiTarget = env.VITE_APP_API_URL || 'http://127.0.0.1:8083';

  return {
    base: env.VITE_APP_PUBLIC_PATH || '/',
    plugins: [vue()],
    server: {
      host: env.VITE_APP_HOST || '127.0.0.1',
      port: Number(env.VITE_APP_PORT) || 5174,
      open: false,
      proxy: {
        [apiPrefix]: {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(new RegExp(`^${apiPrefix}`), ''),
        },
      },
    },
  };
});
