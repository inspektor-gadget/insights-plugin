import baseConfig from './node_modules/@kinvolk/headlamp-plugin/config/vite.config.mjs';
import { pluginNameInjection } from './node_modules/@kinvolk/headlamp-plugin/config/vite-plugin-name-injection.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read plugin name from package.json
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const pluginName = packageJson.name;

const igFrontendDir = path.resolve(__dirname, 'node_modules/@inspektor-gadget/ig-desktop');

/**
 * Vite plugin that:
 * 1. Resolves bare `@inspektor-gadget/frontend` imports to the pre-built library JS.
 * 2. Externalizes Monaco chunk files from the IG library.
 * 3. Inlines the filter worker as a Blob URL so it works in the Headlamp plugin context
 *    (where import.meta.url doesn't point to a real module directory).
 */
function resolveIGFrontend() {
  return {
    name: 'resolve-ig-frontend',
    enforce: 'pre',
    resolveId(source, importer) {
      // Frontend subpath → pre-built library entry
      if (source === '@inspektor-gadget/ig-desktop/frontend') {
        return path.join(igFrontendDir, 'dist-lib', 'ig-frontend.js');
      }

      // React subpath → react wrapper entry
      if (source === '@inspektor-gadget/ig-desktop/frontend/react') {
        return path.join(igFrontendDir, 'react', 'src', 'index.ts');
      }

      // Sub-path imports (CSS, dist-lib files, etc.)
      if (source.startsWith('@inspektor-gadget/ig-desktop/frontend/')) {
        const subpath = source.slice('@inspektor-gadget/ig-desktop/frontend/'.length);
        return path.join(igFrontendDir, subpath);
      }

      // Externalize optional runtime adapters (Wails, Electron) that aren't used in Headlamp
      // Check both paths: symlink (node_modules/@inspektor-gadget/…) and real (vendor/ig-desktop/…)
      const isIGImporter = importer &&
        (importer.includes('inspektor-gadget') || importer.includes('ig-desktop'));
      if (
        isIGImporter &&
        (source === '@wailsio/runtime' || source.startsWith('@wailsio/'))
      ) {
        return { id: source, external: true };
      }

      // Externalize Monaco-related sibling chunks from dist-lib
      if (
        importer &&
        importer.includes(path.join('dist-lib', '')) &&
        isIGImporter &&
        !source.startsWith('@') &&
        !source.startsWith('svelte') &&
        source.endsWith('.js') &&
        source.startsWith('./')
      ) {
        return { id: source, external: true };
      }

      return null;
    },

    /**
     * Inline web worker files referenced via `new URL("…worker…", import.meta.url)`.
     *
     * The pre-built ig-frontend.js contains:
     *   new Worker(new URL("/assets/filter.worker-….js", import.meta.url), {type:"module"})
     *
     * Rollup detects `new URL(…, import.meta.url)` and tries to add the target as an
     * entry module — which fails because the file path doesn't exist relative to the
     * plugin's build root. Even if it resolved, `import.meta.url` is meaningless in the
     * Headlamp plugin context (loaded via `new Function`).
     *
     * Fix: read the worker source from dist-lib/assets/ and replace the `new URL(…)`
     * with `URL.createObjectURL(new Blob([…]))`. The worker is a small self-contained
     * IIFE (no imports), so this works perfectly.
     */
    transform(code, id) {
      if (!id.includes('ig-frontend')) return null;

      const assetsDir = path.join(igFrontendDir, 'dist-lib', 'assets');
      let transformed = code;

      // Match: new URL(/* @vite-ignore */ "/assets/<name>.worker-<hash>.js", import.meta.url)
      // The @vite-ignore comment is optional.
      const workerUrlRe = /new\s+URL\(\s*(?:\/\*[^]*?\*\/\s*)?"([^"]*\.worker[^"]*)"\s*,\s*import\.meta\.url\s*\)/g;

      transformed = transformed.replace(workerUrlRe, (match, workerPath) => {
        // workerPath is e.g. "/assets/filter.worker-CtZqczPL.js"
        const filename = path.basename(workerPath);
        const workerFile = path.join(assetsDir, filename);

        try {
          const workerCode = fs.readFileSync(workerFile, 'utf8');
          // Escape backticks and backslashes for template literal
          const escaped = workerCode.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
          return `URL.createObjectURL(new Blob([\`${escaped}\`],{type:"text/javascript"}))`;
        } catch {
          console.warn(`[resolve-ig-frontend] Worker file not found: ${workerFile}, disabling worker`);
          return `"data:text/javascript,"`;
        }
      });

      if (transformed !== code) {
        return { code: transformed, map: null };
      }
      return null;
    },
  };
}

const config = { ...baseConfig };

// Force Svelte to resolve from the plugin's node_modules (not the symlinked ig-desktop's copy).
// Also ensure browser exports are used (not server/default which lacks client mount()).
config.resolve = {
  ...config.resolve,
  dedupe: ['svelte'],
  conditions: ['browser', 'import', 'module', 'default'],
};

// Enable source maps for debugging
config.build = {
  ...config.build,
  sourcemap: true,
  rollupOptions: {
    ...config.build?.rollupOptions,
    output: {
      ...config.build?.rollupOptions?.output,
    },
  },
};

// Inject our custom plugin before the others
config.plugins = [resolveIGFrontend(), pluginNameInjection({ pluginName }), ...config.plugins];

export default config;
