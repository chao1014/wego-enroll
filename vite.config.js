import { defineConfig } from 'vite';
import { resolve } from 'path';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  root: 'tkd-website/public', 
  
  // ✨ 新增這行：明確告訴 Vite 靜態資源放在專案最外層的 public 資料夾中
  publicDir: resolve(__dirname, 'public'), 

  plugins: [
    // 產生 .gz 檔案，加速支援 Gzip 的瀏覽器載入
    viteCompression({ algorithm: 'gzip' }),
    // 產生 .br 檔案（Brotli 壓縮率通常高於 Gzip）
    viteCompression({ algorithm: 'brotliCompress' })
  ],
  build: {
    outDir: '../../dist', 
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000, 
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'tkd-website/public/index.html')
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // 細分 Firebase 以利於緩存
            if (id.includes('firebase/auth')) return 'fb-auth';
            if (id.includes('firebase/firestore')) return 'fb-db';
            if (id.includes('firebase/app')) return 'fb-core';
            
            // 大型工具維持獨立分塊
            if (id.includes('xlsx')) return 'xlsx';
            if (id.includes('html2pdf') || id.includes('jspdf') || id.includes('html2canvas')) return 'pdf-tools';
            
            return 'vendor';
          }
        }
      }
    }
  }
});