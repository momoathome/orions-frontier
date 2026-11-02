/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_TIME_LAPSE_SCALE?: string;
  readonly VITE_TIME_LAPSE_STARTED_AT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
