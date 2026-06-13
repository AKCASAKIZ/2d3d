/// <reference types="vite/client" />

declare const __BUILD_INFO__: {
  commit: string;
  date: string;
};

interface ImportMetaEnv {
  readonly VITE_PAYMENT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
