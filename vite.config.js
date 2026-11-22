import { defineConfig } from 'vite';
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const BUILD = Date.now().toString(36);

export default defineConfig({
  base: './',               // relative paths: works on GitHub Pages sub-folders
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(BUILD) },
  build: { target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 4000 },
  server: { host: true },
  plugins: [{
    name: 'sw-version',
    // stamp the service-worker cache name so every deploy refreshes the offline cache
    writeBundle(opts) {
      const f = `${opts.dir}/sw.js`;
      if (fs.existsSync(f)) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('__BUILD__', BUILD));
      fs.writeFileSync(`${opts.dir}/version.json`, JSON.stringify({ build: BUILD, version: pkg.version }));
    }
  }]
});
