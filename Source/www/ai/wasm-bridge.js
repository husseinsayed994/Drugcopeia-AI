/*
 * Dawaya AI - the fifth runtime transport: llama.cpp compiled to WebAssembly (wllama,
 * MIT, vendored untouched in ai/vendor/wllama/), so the plain web/PWA build runs the
 * same on-device model as the four native shells. No server, no account, no CDN: the
 * model file is downloaded once from the pinned Hugging Face URL through
 * DawayaNet.modelDownload (the privacy gate), stored in OPFS, verified against the
 * pinned SHA-256, and loaded from there. Every fetch still goes through the privacy
 * gate; this file never opens a socket on its own.
 *
 * Everything the bridge knows about the model comes from the arguments model-manager
 * passes (url, fileName, sha256, sizeBytes) or from assets/ai/model-config.json;
 * nothing is hard-coded here.
 *
 * Registered as DawayaAIWasmRuntime. llm-bridge.js tries it after the native,
 * Capacitor and Windows-loopback transports and before the no-runtime fallback.
 *
 * Test hook: DawayaAIWasmRuntime._setModuleForTests(fakeWllamaModule) replaces the
 * vendored import, and _test exposes the pure helpers (ChatML wrap, parameter
 * mapping, the incremental SHA-256) to tests/ai/run-tests.js.
 */
(function (global) {
  'use strict';

  const LISTENER_KEY = '__dawayaLLMEvent';
  const STORE_DIR = 'drugcopeia-ai-models';
  const PROGRESS_MS = 400;

  let wllamaModule = null;      // the vendored ESM, imported lazily on first use
  let wllama = null;            // the live Wllama instance while a model is loaded
  let loaded = false;
  let job = null;               // the one active download job
  let expectedSha256 = '';      // learned from load()/download() arguments
  let envOverride = null;       // tests pin the environment instead of a browser
  const generators = new Map(); // requestId -> AbortController

  function emit(event) {
    const hub = global[LISTENER_KEY];
    if (typeof hub === 'function') {
      try { hub(event); } catch (_) {}
    }
  }

  /* The vendored files sit beside this script: .../ai/wasm-bridge.js -> .../ai/vendor/wllama/. */
  function vendorBase() {
    try {
      const current = global.document && global.document.currentScript && global.document.currentScript.src;
      if (current) return current.slice(0, current.lastIndexOf('/')) + '/vendor/wllama/';
      const scripts = global.document ? global.document.querySelectorAll('script[src]') : [];
      for (const tag of scripts) {
        const src = tag.src || '';
        const cut = src.indexOf('/ai/wasm-bridge.js');
        if (cut >= 0) return src.slice(0, cut) + '/ai/vendor/wllama/';
      }
    } catch (_) {}
    return 'ai/vendor/wllama/';
  }

  async function importModule() {
    if (wllamaModule) return wllamaModule;
    wllamaModule = await import(/* @vite-ignore */ vendorBase() + 'index.js');
    return wllamaModule;
  }

  async function modelConfig() {
    try {
      const response = await global.fetch('assets/ai/model-config.json');
      if (!response.ok) return null;
      const parsed = await response.json();
      return parsed && parsed.model ? parsed.model : null;
    } catch (_) {
      return null;
    }
  }

  /* ---------- environment ---------- */

  function hasOPFS() {
    return Boolean(global.navigator && global.navigator.storage && typeof global.navigator.storage.getDirectory === 'function');
  }

  function environment() {
    if (envOverride) return envOverride;
    return {
      wasm: typeof global.WebAssembly === 'object',
      opfs: hasOPFS(),
      streaming: typeof global.ReadableStream === 'function',
      gate: Boolean(global.DawayaNet && typeof global.DawayaNet.modelDownload === 'function'),
      threads: Boolean(global.crossOriginIsolated)
    };
  }

  function environmentOk(env) {
    return Boolean(env.wasm && env.opfs && env.streaming && typeof global.fetch === 'function');
  }

  /* ---------- incremental SHA-256 (pure JS; WebCrypto cannot stream) ---------- */

  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr32(x, n) {
    return ((x >>> n) | (x << (32 - n))) >>> 0;
  }

  function sha256Create() {
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const buffer = new Uint8Array(64);
    let buffered = 0;
    let total = 0;
    let sealed = false;

    function compress(block) {
      for (let i = 0; i < 16; i++) {
        w[i] = ((block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = (rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (let i = 0; i < 64; i++) {
        const s1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (hh + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
        const s0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (s0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }

    function update(bytes) {
      if (sealed) throw new Error('sha256-already-finished');
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      total += data.length;
      let offset = 0;
      if (buffered) {
        const take = Math.min(64 - buffered, data.length);
        buffer.set(data.subarray(0, take), buffered);
        buffered += take;
        offset = take;
        if (buffered === 64) { compress(buffer); buffered = 0; }
      }
      while (offset + 64 <= data.length) {
        compress(data.subarray(offset, offset + 64));
        offset += 64;
      }
      if (offset < data.length) {
        buffer.set(data.subarray(offset), 0);
        buffered = data.length - offset;
      }
    }

    function digestHex() {
      const bitLenHi = Math.floor(total / 0x20000000);
      const bitLenLo = (total * 8) >>> 0;
      update(new Uint8Array([0x80]));
      while (buffered !== 56) update(new Uint8Array([0]));
      const len = new Uint8Array(8);
      new DataView(len.buffer).setUint32(0, bitLenHi, false);
      new DataView(len.buffer).setUint32(4, bitLenLo, false);
      update(len);
      sealed = true;
      let out = '';
      for (let i = 0; i < 8; i++) out += ('00000000' + h[i].toString(16)).slice(-8);
      return out;
    }

    return { update, digestHex };
  }

  /* ---------- OPFS storage ---------- */

  async function storeDir(create) {
    const root = await global.navigator.storage.getDirectory();
    return root.getDirectoryHandle(STORE_DIR, { create: create !== false });
  }

  function sidecarName(fileName) {
    return `${fileName}.dawaya.json`;
  }

  async function modelFileSize(fileName) {
    try {
      const dir = await storeDir(false);
      const handle = await dir.getFileHandle(fileName, { create: false });
      const file = await handle.getFile();
      return file.size;
    } catch (_) {
      return -1;
    }
  }

  async function readSidecar(fileName) {
    try {
      const dir = await storeDir(false);
      const handle = await dir.getFileHandle(sidecarName(fileName), { create: false });
      const file = await handle.getFile();
      return JSON.parse(await file.text());
    } catch (_) {
      return null;
    }
  }

  async function writeSidecar(fileName, patch) {
    const existing = await readSidecar(fileName);
    const dir = await storeDir(true);
    const handle = await dir.getFileHandle(sidecarName(fileName), { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ ...(existing || {}), ...patch, fileName }));
    await writable.close();
  }

  async function removeModelFiles(fileName) {
    try {
      const dir = await storeDir(false);
      for (const name of [fileName, sidecarName(fileName)]) {
        try { await dir.removeEntry(name); } catch (_) {}
      }
    } catch (_) {}
  }

  async function readModelBlob(fileName) {
    const dir = await storeDir(false);
    const handle = await dir.getFileHandle(fileName, { create: false });
    return handle.getFile();
  }

  /* The first .gguf in the store, for status() before any config has arrived. */
  async function firstStoredModel() {
    try {
      const dir = await storeDir(false);
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file' && name.endsWith('.gguf')) return name;
      }
    } catch (_) {}
    return null;
  }

  async function hashBlob(blob) {
    const hash = sha256Create();
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return hash.digestHex();
  }

  /* ---------- ChatML: byte-identical to the three native shells ---------- */

  function chatml(prompt) {
    return '<|im_start|>system\nYou answer only from the reference data the user supplies.<|im_end|>\n'
      + '<|im_start|>user\n' + prompt + '<|im_end|>\n<|im_start|>assistant\n';
  }

  /* model-manager speaks llama-server names; wllama speaks OpenAI-compatible names. */
  function mapParams(params) {
    const source = params || {};
    const out = {
      max_tokens: Number(source.n_predict) > 0 ? Number(source.n_predict) : 240,
      temperature: Number.isFinite(Number(source.temperature)) ? Number(source.temperature) : 0.3,
      top_k: Number(source.top_k) > 0 ? Number(source.top_k) : 40,
      top_p: Number.isFinite(Number(source.top_p)) ? Number(source.top_p) : 0.9,
      min_p: Number.isFinite(Number(source.min_p)) ? Number(source.min_p) : 0,
      penalty_repeat: Number(source.repeat_penalty) > 0 ? Number(source.repeat_penalty) : 1.1,
      stop: ['<|im_end|>']
    };
    if (Number.isFinite(Number(source.seed)) && Number(source.seed) > 0) out.seed = Number(source.seed);
    return out;
  }

  function quietLogger() {
    const noop = () => {};
    const warn = (...args) => { try { console.warn(...args); } catch (_) {} };
    const error = (...args) => { try { console.error(...args); } catch (_) {} };
    return { debug: noop, log: noop, warn, error };
  }

  /* ---------- the download job ---------- */

  function emitProgress(force) {
    if (!job) return;
    const now = Date.now();
    if (!force && now - job.lastEmit < PROGRESS_MS) return;
    job.lastEmit = now;
    const elapsed = Math.max(1, (now - job.startedAt) / 1000);
    emit({
      type: 'download-progress',
      id: job.id,
      downloadedBytes: job.offset,
      totalBytes: job.sizeBytes,
      bytesPerSecond: Math.round(job.sessionBytes / elapsed)
    });
  }

  async function runDownload(current) {
    try {
      /* A sidecar written at the start is what makes an interrupted download
         resumable after the page was closed: status() can offer Resume with the
         URL and the expected size instead of starting blind. */
      await writeSidecar(current.fileName, {
        url: current.url, sizeBytes: current.sizeBytes, sha256: current.sha256, sha256Verified: false
      });
      let offset = await modelFileSize(current.fileName);
      if (offset >= Number(current.sizeBytes) || offset < 0) offset = 0;
      const response = await global.DawayaNet.modelDownload(current.url, {
        userInitiated: true,
        range: offset > 0 ? `bytes=${offset}-` : null,
        signal: current.controller.signal
      });
      if (response.status === 200 && offset > 0) offset = 0; /* the range was refused: start over */
      if (!response.ok && response.status !== 206) throw new Error(`download-failed:${response.status}`);
      const dir = await storeDir(true);
      const handle = await dir.getFileHandle(current.fileName, { create: true });
      const writable = await handle.createWritable({ keepExistingData: offset > 0 });
      current.offset = offset;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await writable.write({ type: 'write', position: current.offset, data: value });
        current.offset += value.byteLength;
        current.sessionBytes += value.byteLength;
        emitProgress(false);
      }
      await writable.close();
      emitProgress(true);
      const size = await modelFileSize(current.fileName);
      if (Number(current.sizeBytes) && size !== Number(current.sizeBytes)) {
        throw new Error(`download-size-mismatch:${size}`);
      }
      job = null;
      emit({ type: 'download-completed', id: current.id, sizeBytes: size });
    } catch (error) {
      job = null;
      const aborted = error && (error.name === 'AbortError' || /abort/i.test(String(error.message || error)));
      if (aborted && current.intent === 'pause') {
        emit({ type: 'download-paused', id: current.id });
      } else if (aborted && current.intent === 'cancel') {
        await removeModelFiles(current.fileName);
        emit({ type: 'download-cancelled', id: current.id });
      } else {
        emit({ type: 'download-error', id: current.id, error: String(error && error.message || error) });
      }
    }
  }

  /* ---------- the bridge the runtime contract expects ---------- */

  const bridge = {
    async capabilities() {
      const env = environment();
      let quota = 0;
      try {
        const estimate = global.navigator && global.navigator.storage && global.navigator.storage.estimate
          ? await global.navigator.storage.estimate() : null;
        quota = (estimate && Number(estimate.quota)) || 0;
      } catch (_) {}
      const deviceMemory = global.navigator && typeof global.navigator.deviceMemory === 'number' ? global.navigator.deviceMemory : 0;
      return {
        /* r201: without cross-origin isolation (GitHub Pages cannot send COOP/COEP) the wasm
           runtime is single-threaded, which is too slow and memory-hungry for a phone. The web
           build then answers with smart search; the native apps run the model. */
        supported: Boolean(environmentOk(env) && env.gate && env.threads !== false),
        reason: !env.wasm ? 'no-webassembly' : !env.opfs ? 'no-opfs' : !env.streaming ? 'no-streams'
          : !env.gate ? 'privacy-gate-missing' : env.threads === false ? 'web-single-thread' : '',
        backends: ['cpu'],
        totalRamBytes: deviceMemory ? Math.round(deviceMemory * 1024 * 1024 * 1024) : 0,
        freeRamBytes: 0,
        cores: (global.navigator && global.navigator.hardwareConcurrency) || 0,
        storageBytes: quota
      };
    },

    async status() {
      if (job) {
        return { state: 'downloading', id: job.id, fileName: job.fileName, downloadedBytes: job.offset, sizeBytes: job.sizeBytes };
      }
      const fileName = await firstStoredModel();
      if (!fileName) return { state: 'idle', present: false };
      const size = await modelFileSize(fileName);
      const meta = await readSidecar(fileName);
      const expected = Number(meta && meta.sizeBytes) || 0;
      const complete = size > 0 && (!expected || size === expected);
      const verified = Boolean(meta && meta.sha256Verified) && complete;
      return {
        state: complete ? 'idle' : 'paused',
        id: complete ? null : 'web-1',
        present: verified,
        fileName,
        url: meta && meta.url ? meta.url : '',
        sizeBytes: expected || size,
        downloadedBytes: size,
        checksumVerified: verified
      };
    },

    download(options) {
      if (job) return Promise.reject(new Error('download-busy'));
      const env = environment();
      if (!env.gate) return Promise.reject(new Error('privacy-gate-missing'));
      if (options && options.sha256) expectedSha256 = String(options.sha256).toLowerCase();
      job = {
        id: 'web-1',
        url: options.url,
        fileName: options.fileName,
        sha256: options.sha256 || '',
        sizeBytes: Number(options.sizeBytes) || 0,
        controller: new AbortController(),
        offset: 0,
        sessionBytes: 0,
        startedAt: Date.now(),
        lastEmit: 0,
        intent: 'run'
      };
      runDownload(job);
      return Promise.resolve({ id: job.id });
    },

    pauseDownload() {
      if (!job) return Promise.resolve({ ok: false });
      job.intent = 'pause';
      job.controller.abort();
      return Promise.resolve({ ok: true });
    },

    async resumeDownload() {
      if (job) return { ok: false, error: 'download-busy' };
      const live = await bridge.status();
      if (!live.fileName || live.state !== 'paused') return { ok: false, error: 'nothing-to-resume' };
      const meta = await readSidecar(live.fileName);
      return bridge.download({
        url: (meta && meta.url) || live.url,
        fileName: live.fileName,
        sha256: (meta && meta.sha256) || '',
        sizeBytes: live.sizeBytes
      }).then(result => ({ ok: true, id: result.id }));
    },

    async cancelDownload() {
      if (job) {
        job.intent = 'cancel';
        job.controller.abort();
        return { ok: true };
      }
      const fileName = await firstStoredModel();
      if (fileName) await removeModelFiles(fileName);
      return { ok: true };
    },

    async verifyDownload() {
      const fileName = (job && job.fileName) || await firstStoredModel();
      if (!fileName) return { ok: false, error: 'no-file' };
      const meta = await readSidecar(fileName);
      const expected = String((meta && meta.sha256) || expectedSha256 || '').toLowerCase();
      try {
        const blob = await readModelBlob(fileName);
        const actual = await hashBlob(blob);
        if (expected && actual !== expected) {
          /* The bytes are not the bytes this build was configured for: drop the
             file so a later download starts clean, same rule as the native shells. */
          await removeModelFiles(fileName);
          return { ok: false, sha256: actual };
        }
        await writeSidecar(fileName, { sha256Verified: true, sha256: actual, sizeBytes: blob.size });
        return { ok: true, sha256: actual };
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    },

    importModel() {
      return new Promise(resolve => {
        const input = global.document.createElement('input');
        input.type = 'file';
        input.accept = '.gguf,application/octet-stream';
        input.oncancel = () => resolve({ ok: false, error: 'cancelled' });
        input.onchange = async () => {
          const file = input.files && input.files[0];
          if (!file) { resolve({ ok: false, error: 'no-file-chosen' }); return; }
          try {
            const config = await modelConfig();
            if (config && file.name !== config.fileName) {
              resolve({ ok: false, error: 'wrong-file', checksumVerified: false });
              return;
            }
            if (config && Number(config.sizeBytes) && file.size !== Number(config.sizeBytes)) {
              resolve({ ok: false, error: 'wrong-size', checksumVerified: false });
              return;
            }
            /* The same checksum rule as a download: unverified bytes are deleted, not kept. */
            const actual = await hashBlob(file);
            const expected = String((config && config.sha256) || expectedSha256 || '').toLowerCase();
            if (expected && actual !== expected) {
              resolve({ ok: false, error: 'checksum-failed', checksumVerified: false });
              return;
            }
            const dir = await storeDir(true);
            const handle = await dir.getFileHandle(file.name, { create: true });
            const writable = await handle.createWritable();
            await writable.write(file);
            await writable.close();
            await writeSidecar(file.name, {
              url: (config && config.url) || '', sizeBytes: file.size, sha256: actual, sha256Verified: true
            });
            resolve({ ok: true, fileName: file.name, sizeBytes: file.size, checksumVerified: true });
          } catch (error) {
            resolve({ ok: false, error: String(error && error.message || error) });
          }
        };
        input.click();
      });
    },

    async deleteModel() {
      const fileName = await firstStoredModel();
      if (fileName) await removeModelFiles(fileName);
      return { ok: true };
    },

    async load(request) {
      if (loaded && wllama) return { ok: true, already: true };
      const fileName = request && request.fileName;
      const params = (request && request.params) || {};
      if (request && request.sha256) expectedSha256 = String(request.sha256).toLowerCase();
      const module = await importModule();
      const blob = await readModelBlob(fileName);
      if (!blob || !blob.size) throw new Error('model-missing');
      const instance = new module.Wllama(
        { default: vendorBase() + 'wllama.wasm' },
        { logger: quietLogger(), parallelDownloads: 1, allowOffline: true }
      );
      if (typeof instance.setCompat === 'function') {
        /* Never the jsDelivr fallback: both wasm builds ship inside the app. */
        instance.setCompat({ wasm: vendorBase() + 'wllama-compat.wasm' });
      }
      const cores = (global.navigator && global.navigator.hardwareConcurrency) || 2;
      /* Multi-threading needs cross-origin isolation; without it one worker still
         runs the model, only slower. */
      const threads = global.crossOriginIsolated ? Math.max(1, Number(params.n_threads) || cores - 1 || 1) : 1;
      await instance.loadModel([blob], {
        n_ctx: Number(params.n_ctx) || 2048,
        n_batch: Number(params.n_batch) || 128,
        n_threads: threads,
        n_cache_reuse: 256,
        cache_type_k: 'q8_0',
        cache_type_v: 'q8_0',
        embeddings: false
      });
      wllama = instance;
      loaded = true;
      return { ok: true };
    },

    async unload() {
      const instance = wllama;
      wllama = null;
      loaded = false;
      if (instance) await instance.exit().catch(() => {});
      return { ok: true };
    },

    async generate(request) {
      if (!loaded || !wllama) throw new Error('model-not-loaded');
      const requestId = request.requestId || `w${Date.now().toString(36)}`;
      const controller = new AbortController();
      generators.set(requestId, controller);
      const started = Date.now();
      let text = '';
      let completionTokens = 0;
      try {
        await wllama.createCompletion({
          ...mapParams(request.params),
          prompt: chatml(String(request.prompt || '')),
          stream: true,
          abortSignal: controller.signal,
          onData: chunk => {
            const choice = chunk && chunk.choices && chunk.choices[0];
            const piece = choice ? String(choice.text || '') : '';
            if (piece) {
              text += piece;
              emit({ type: 'token', requestId, token: piece });
            }
            if (chunk && chunk.usage && chunk.usage.completion_tokens) completionTokens = chunk.usage.completion_tokens;
          }
        });
        generators.delete(requestId);
        return { text, tokens: completionTokens || null, milliseconds: Date.now() - started, requestId };
      } catch (error) {
        generators.delete(requestId);
        if (error && (error.name === 'WllamaAbortError' || error.name === 'AbortError' || /abort/i.test(String(error.message || '')))) {
          return { text, tokens: null, milliseconds: Date.now() - started, cancelled: true, requestId };
        }
        throw error;
      }
    },

    cancelGeneration(requestId) {
      const controller = generators.get(requestId);
      if (controller) controller.abort();
      generators.delete(requestId);
      return Promise.resolve({ ok: Boolean(controller) });
    }
  };

  global.DawayaAIWasmRuntime = {
    kind: 'web-wasm',
    /* llm-bridge only offers this transport where the runtime can actually work:
       WebAssembly + OPFS + streams. Anything less falls through to smart search. */
    available: () => environmentOk(environment()),
    bridge: () => bridge,
    /* Test seams: the suite runs without OPFS, a network or the vendored module. */
    _setModuleForTests(fake) {
      wllamaModule = fake;
    },
    _setEnvironmentForTests(env) {
      envOverride = env || null;
    },
    _setLoadedForTests(instance) {
      wllama = instance;
      loaded = Boolean(instance);
    },
    _resetForTests() {
      wllamaModule = null;
      wllama = null;
      loaded = false;
      job = null;
      expectedSha256 = '';
      envOverride = null;
      generators.clear();
    },
    _test: {
      chatml,
      mapParams,
      sha256Create,
      environment,
      environmentOk
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
