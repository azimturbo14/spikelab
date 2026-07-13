// Loader script that imports onnxruntime-web and exposes it globally
import * as ort from '/ort/ort.min.mjs';
// Force single-threaded WASM (no JSEP/Web Workers — avoids deployment issues)
ort.env.wasm.numThreads = 1;
// Set WASM path before any session is created
ort.env.wasm.wasmPaths = '/ort/';
globalThis.ort = ort;
// Signal that ort is ready
globalThis.dispatchEvent(new Event('ort-ready'));