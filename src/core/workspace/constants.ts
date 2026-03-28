export const SOURCELOOP_CONFIG_DIR = ".sourceloop";
export const SOURCELOOP_CONFIG_PATH = `${SOURCELOOP_CONFIG_DIR}/config.json`;

export const WORKSPACE_DIRECTORIES = [
  "vault/chrome-targets",
  "vault/topics",
  "vault/sources",
  "vault/notebook-sources",
  "vault/notebook-setups",
  "vault/notebook-imports",
  "vault/bundles",
  "vault/notebooks",
  "vault/runs",
  "vault/outputs"
] as const;
