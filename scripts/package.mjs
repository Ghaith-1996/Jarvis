// Packages dist/ into out/JARVIS-win32-x64/JARVIS.exe. Everything runtime is bundled by esbuild, so only dist/ and
// package.json ship; speech models stay outside the app (chosen in Settings, or a "models" folder next to the exe).
import { packager } from '@electron/packager';

const keep = /^\/(dist(\/|$)|package\.json$)/;
const paths = await packager({
  dir: '.',
  name: 'JARVIS',
  platform: 'win32',
  arch: 'x64',
  out: 'out',
  overwrite: true,
  asar: true,
  prune: false,
  ignore: (path) => path !== '' && !keep.test(path),
  win32metadata: { CompanyName: 'Personal', FileDescription: 'JARVIS personal assistant', ProductName: 'JARVIS' },
});
console.log(paths.join('\n'));
