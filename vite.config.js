import { defineConfig } from 'vite';
import { trackpadControlPlugin } from './tooling/vite-plugin-trackpad-control.js';

export default defineConfig({
  plugins: [trackpadControlPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
