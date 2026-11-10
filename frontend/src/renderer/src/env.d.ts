/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** A file inlined as a base64 data: URL (see electron.vite.config.ts). */
declare module "*?dataurl" {
  const src: string;
  export default src;
}
