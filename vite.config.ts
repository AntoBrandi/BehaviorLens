import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
    plugins: [vue()],
    root: './webview-ui',
    build: {
        outDir: '../media',
        emptyOutDir: false, // Don't delete existing media files (like verification_script.js if needed, though we should clean up eventually)
        rollupOptions: {
            output: {
                entryFileNames: `assets/[name].js`,
                chunkFileNames: `assets/[name].js`,
                assetFileNames: `assets/[name].[ext]`
            }
        }
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './webview-ui/src')
        }
    }
});
