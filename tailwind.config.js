/** @type {import('tailwindcss').Config} */
module.exports = {
    // 核心修正：確保掃描到 index.html 以及 js 資料夾下的所有檔案
    content: [
      "./tkd-website/public/index.html",
      "./tkd-website/public/js/**/*.js",
      "./tkd-website/public/*.html"
    ],
    theme: {
      extend: {
        colors: {
          tkdRed: '#D32F2F',
          tkdBlue: '#1976D2',
          tkdDark: '#111827'
        },
        screens: { 
          'xs': '400px' 
        }
      }
    },
    plugins: [],
  }