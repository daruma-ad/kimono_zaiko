import { defineConfig } from 'vite';

export default defineConfig({
  // 相対パスに設定することで、GitHub Pagesなどのサブディレクトリ（例: /kimono_zaiko/）に
  // デプロイした際にも、CSSやJSなどのアセットが正しく読み込まれるようにします。
  base: './',
  build: {
    outDir: 'dist',
  }
});
