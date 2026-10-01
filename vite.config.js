import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(({ command }) => ({
  // ビルド時はGitHub Pages用のサブディレクトリbaseを使用、開発時は/
  base: command === 'build'
    ? `/${process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'AI-LiveTalk'}/`
    : '/',
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        voiceLab: path.resolve(import.meta.dirname, 'voice-lab.html'),
      },
    },
  },
}));
