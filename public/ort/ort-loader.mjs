// Loader script that imports onnxruntime-web and exposes it globally
import * as ort from '/ort/ort.min.mjs';
// Set WASM path before any session is created
ort.env.wasm.wasmPaths = '/ort/';
globalThis.ort = ort;
// Signal that ort is ready
globalThis.dispatchEvent(new Event('ort-ready'));