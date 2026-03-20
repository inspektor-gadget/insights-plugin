/**
 * Singleton WASM loader for the Inspektor Gadget Go binary.
 *
 * Loads main.wasm.gz, decompresses it with the native DecompressionStream API,
 * instantiates the WebAssembly module, and starts the Go runtime.
 * After initialization, `window.wrapWebSocket` becomes globally available.
 */
import './wasm-exec.js';

const PLUGIN_NAME = 'insights-plugin';

let loadPromise: Promise<void> | null = null;

/**
 * Fetch the WASM binary from one of the possible Headlamp plugin paths.
 * Headlamp serves plugins from different paths depending on installation method.
 */
async function fetchWasmWithFallback(): Promise<Response> {
  const prefixes = ['plugins', 'user-plugins', 'static-plugins'];

  let host = window.location.origin;
  if (!window.location.host || window.location.protocol === 'file:') {
    const port = (window as any).headlampBackendPort || 4466;
    host = `http://localhost:${port}`;
  }

  for (const prefix of prefixes) {
    const url = `${host}/${prefix}/${PLUGIN_NAME}/main.wasm.gz`;
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Try next prefix
    }
  }
  throw new Error(
    `Failed to fetch WASM binary. Checked paths: ${prefixes
      .map(p => `${p}/${PLUGIN_NAME}/main.wasm.gz`)
      .join(', ')}`
  );
}

/**
 * Decompress gzipped data using the native DecompressionStream API.
 */
async function decompressGzip(compressed: ArrayBuffer): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

/**
 * Load and initialize the WASM binary. Singleton — subsequent calls return
 * the same promise.
 *
 * After this resolves, `window.wrapWebSocket` is available.
 */
export async function loadWasm(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      console.log('[IG WASM] Fetching WASM binary...');
      const response = await fetchWasmWithFallback();
      const gzipped = await response.arrayBuffer();

      console.log('[IG WASM] Decompressing...');
      const wasmBytes = await decompressGzip(gzipped);

      console.log('[IG WASM] Instantiating WebAssembly...');
      const go = new window.Go();
      const result = await WebAssembly.instantiate(wasmBytes, go.importObject);

      // Start the Go runtime (runs in the background — the promise resolves
      // when the Go program exits, which is only on error).
      go.run(result.instance)
        .then(() => {
          console.error('[IG WASM] Go runtime exited unexpectedly');
          loadPromise = null;
        })
        .catch(err => {
          console.error('[IG WASM] Go runtime error:', err);
          loadPromise = null;
        });

      // Wait briefly for the Go runtime to register window.wrapWebSocket
      await waitForWrapWebSocket();
      console.log('[IG WASM] Ready');
    } catch (err) {
      loadPromise = null;
      throw err;
    }
  })();

  return loadPromise;
}

/**
 * Poll for `window.wrapWebSocket` to become available after Go runtime starts.
 */
function waitForWrapWebSocket(timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (typeof window.wrapWebSocket === 'function') {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error('[IG WASM] Timed out waiting for wrapWebSocket'));
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}
