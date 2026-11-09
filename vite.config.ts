import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import { defineConfig, type UserConfig } from 'vite';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(repoRoot, 'src');
const outDir = path.resolve(repoRoot, 'dist');

function sharedConfig(): UserConfig {
  return {
    root: srcRoot,
    base: './',
    publicDir: false,
    build: {
      outDir,
      emptyOutDir: false,
      target: 'es2022',
      assetsDir: 'assets',
      sourcemap: false,
      reportCompressedSize: false,
    },
  };
}

function uiConfig(): UserConfig {
  return {
    ...sharedConfig(),
    plugins: [react()],
    css: {
      postcss: {
        plugins: [tailwindcss(path.resolve(repoRoot, 'tailwind.config.ts')), autoprefixer()],
      },
    },
    build: {
      ...sharedConfig().build,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          popup: path.resolve(srcRoot, 'popup', 'index.html'),
          options: path.resolve(srcRoot, 'options', 'index.html'),
        },
      },
    },
  };
}

function singleFileConfig(mode: 'background' | 'content'): UserConfig {
  return {
    ...sharedConfig(),
    build: {
      ...sharedConfig().build,
      rollupOptions: {
        input: { [mode]: path.resolve(srcRoot, mode, 'index.ts') },
        output: {
          format: 'iife',
          entryFileNames: `${mode}.js`,
          inlineDynamicImports: true,
          assetFileNames: 'assets/[name][ext]',
        },
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  if (mode === 'background' || mode === 'content') {
    return singleFileConfig(mode);
  }
  if (mode === 'ui') {
    return uiConfig();
  }
  throw new Error(
    `未知构建模式 "${mode}"，请使用 npm run build（内部会以 ui / background / content 三趟构建）`,
  );
});
