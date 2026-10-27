import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 相対パスにしておくと、GitHub Pages のどのリポジトリ名でもそのまま動く
export default defineConfig({
  base: './',
  plugins: [react()],
})
