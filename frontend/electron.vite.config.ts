import { readFile } from "fs/promises";
import { extname, resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * `import src from "./image.jpg?dataurl"` yields the file as a base64 data:
 * URL, identically in dev and build. (Vite 5 has no such import for images,
 * and its size-based inlining does not apply in dev.) Receipts need this:
 * they print from a data:text/html window that cannot load app files.
 */
function dataUrl(): Plugin {
  return {
    name: "cashier:data-url",
    enforce: "pre",
    async load(id) {
      const [file, query] = id.split("?", 2);
      if (!query || !query.split("&").includes("dataurl")) return null;
      this.addWatchFile(file);
      const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      const data = (await readFile(file)).toString("base64");
      return `export default ${JSON.stringify(`data:${type};base64,${data}`)};`;
    },
  };
}

/**
 * Writes this terminal's API server origin (from VITE_API_BASE_URL) into the
 * Content-Security-Policy in index.html. The renderer calls that server and
 * loads product photos from it, and CSP has no wildcard for "any LAN
 * address", so the exact origin has to be baked in at build time.
 */
function apiOriginCsp(): Plugin {
  let origin = "";
  return {
    name: "cashier:api-origin-csp",
    configResolved(config) {
      // Same fallback as src/renderer/src/api/client.ts.
      origin = new URL(config.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api").origin;
    },
    transformIndexHtml: (html) => html.replaceAll("__API_ORIGIN__", origin),
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
      },
    },
    plugins: [react(), dataUrl(), apiOriginCsp()],
    server: {
      port: 5173,
    },
    build: {
      rollupOptions: {
        // The app, and the startup splash the main process shows before it.
        input: {
          index: resolve("src/renderer/index.html"),
          splash: resolve("src/renderer/splash.html"),
        },
      },
    },
  },
});
