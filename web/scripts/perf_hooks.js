// Init-script hooks for perf_probe.mjs: intercept module instantiation so the three.js
// WebGLRenderer instance is captured before R3F renders. Vite dev serves ESM, and ES
// modules get their own namespace objects — importScripts/module patching can't reach
// them, but Function.prototype constructor interception can wrap any module factory.
// Strategy: when a module's export object appears containing a `WebGLRenderer` class,
// replace it with a subclass that records its instance on window.__steelxPerf.renderer.
(() => {
  const g = window;
  g.__steelxPerf = { renderer: null, patched: false };
  const origDefine = Object.defineProperty;
  // Simplest reliable hook for Vite dev ESM: intercept `globalThis.THREE`? No — ESM has no global.
  // Instead patch the class at first construction via a MutationObserver-free approach:
  // wrap HTMLCanvasElement.getContext('webgl2') and mark; then patch by scanning import()...
  // Practical path used here: override Function.prototype so module factories run wrapped? Too invasive.
  // Final approach that WORKS with Vite dev: patch WebGLRenderer via its first use — R3F calls
  // `new THREE.WebGLRenderer(...)`. We cannot see THREE, but three's WebGLRenderer sets
  // renderer.info; we can instead read stats off the RENDER CONTEXT: count drawElements/
  // drawArrays calls per frame + program count via wrapped WebGL2RenderingContext methods.
  const counts = { calls: 0, tris: 0, progs: new Set() };
  g.__steelxPerf.counts = counts;
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const ctx = origGetContext.apply(this, args);
    if (ctx && (args[0] === 'webgl2' || args[0] === 'webgl') && !ctx.__steelxWrapped) {
      ctx.__steelxWrapped = true;
      for (const m of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const orig = ctx[m] && ctx[m].bind(ctx);
        if (!orig) continue;
        ctx[m] = function (...a) {
          counts.calls++;
          // triangle estimate: mode in a[0]; vertex count heuristics per draw type
          try {
            const mode = a[0];
            if (m === 'drawArrays') { const n = a[2] || 0; counts.tris += mode === 5 ? n / 3 : mode === 6 ? Math.max(0, n - 2) : 0; }
            else if (m === 'drawElements') { const n = a[1] || 0; counts.tris += mode === 4 ? n / 3 : 0; }
            else if (m === 'drawArraysInstanced') { const n = a[2] || 0, ic = a[3] || 1; counts.tris += mode === 5 ? (n / 3) * ic : 0; }
            else if (m === 'drawElementsInstanced') { const n = a[1] || 0, ic = a[3] || 1; counts.tris += mode === 4 ? (n / 3) * ic : 0; }
          } catch {}
          return orig(...a);
        };
      }
      const oua = ctx.useProgram && ctx.useProgram.bind(ctx);
      if (oua) ctx.useProgram = function (p) { if (p) counts.progs.add(p); return oua(p); };
    }
    return ctx;
  };
})();
