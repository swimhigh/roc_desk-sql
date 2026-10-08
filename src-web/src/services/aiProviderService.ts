import { invoke } from "@tauri-apps/api/core";
import type { AiProvider, AiProviderInput } from "../types/bindings";

/** IPC boundary: AI provider management (`roc_desk_sql::cmd::ai_provider_*`),
 * this tool's own copy of the same thin CRUD wrappers every AI-capable tool
 * registers (see `roc_desk-workspace`'s identical `aiProviderService`). */
export const aiProviderService = {
  list(): Promise<AiProvider[]> {
    return invoke("ai_provider_list");
  },
  create(input: AiProviderInput): Promise<AiProvider> {
    return invoke("ai_provider_create", { input });
  },
  update(id: string, input: AiProviderInput): Promise<AiProvider> {
    return invoke("ai_provider_update", { id, input });
  },
  delete(id: string): Promise<void> {
    return invoke("ai_provider_delete", { id });
  },
  listModels(id: string): Promise<string[]> {
    return invoke("ai_provider_list_models", { id });
  },
};
