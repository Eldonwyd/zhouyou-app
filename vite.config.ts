import { defineConfig } from 'vite';

// A relative base lets the static build work under a subdirectory as well as a domain root.
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1' },
  build: { target: 'es2022' },
});
