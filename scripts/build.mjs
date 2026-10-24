// Bundles main, preload and renderer with esbuild; type checking is separate (npm run typecheck).
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true }); // start clean so stale files never get packaged
mkdirSync('dist', { recursive: true });
const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'es2023' };
await Promise.all([
  build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['src/renderer/index.tsx'], outfile: 'dist/renderer.js', platform: 'browser', format: 'esm', jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' } }),
  build({ ...common, entryPoints: ['src/renderer/pcm-worklet.ts'], outfile: 'dist/pcm-worklet.js', platform: 'browser', format: 'esm' }),
]);
cpSync('src/renderer/index.html', 'dist/index.html');
cpSync('src/renderer/styles.css', 'dist/styles.css');
