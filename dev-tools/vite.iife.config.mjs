import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: '/home/claude/sales-crm/client', plugins: [react()], define: { 'process.env.NODE_ENV': '"production"' },
  build: { outDir: '/tmp/iife', emptyOutDir: true, lib: { entry: '/home/claude/sales-crm/client/src/main.jsx', formats: ['iife'], name: 'SalesApp', fileName: () => 'app.js' } } });
