import { defineConfig } from 'vite';

// During `npm run dev`, forward /api calls to the backend on port 3000.
export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
