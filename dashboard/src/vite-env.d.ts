/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_RPC_URL: string
    readonly VITE_VAULT_ADDRESS: string
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }