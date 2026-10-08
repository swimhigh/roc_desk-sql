import { create } from "zustand";
import { aiProviderService } from "../services/aiProviderService";
import { formatError } from "../utils/error";
import type { AiProvider, AiProviderInput } from "../types/bindings";

/** AI provider CRUD, backing the SQL Agent's provider picker/management
 * dialog. Same shape as `roc_desk-workspace`'s `aiProviderStore`. */
interface AiProviderState {
  providers: AiProvider[];
  modelsByProvider: Record<string, string[]>;
  error: string | null;

  loadProviders: () => Promise<void>;
  createProvider: (input: AiProviderInput) => Promise<void>;
  updateProvider: (id: string, input: AiProviderInput) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  fetchModels: (providerId: string) => Promise<void>;
}

export const useAiProviderStore = create<AiProviderState>((set, get) => ({
  providers: [],
  modelsByProvider: {},
  error: null,

  loadProviders: async () => {
    try {
      set({ providers: await aiProviderService.list() });
    } catch (e) {
      set({ error: formatError(e) });
    }
  },

  createProvider: async (input) => {
    const created = await aiProviderService.create(input);
    set((s) => ({ providers: [...s.providers, created] }));
  },

  updateProvider: async (id, input) => {
    const updated = await aiProviderService.update(id, input);
    set((s) => ({ providers: s.providers.map((p) => (p.id === id ? updated : p)) }));
  },

  deleteProvider: async (id) => {
    await aiProviderService.delete(id);
    set((s) => ({ providers: s.providers.filter((p) => p.id !== id) }));
  },

  fetchModels: async (providerId) => {
    try {
      const models = await aiProviderService.listModels(providerId);
      set((s) => ({ modelsByProvider: { ...s.modelsByProvider, [providerId]: models } }));
      const provider = get().providers.find((p) => p.id === providerId);
      if (provider && models.length > 0 && !models.includes(provider.model)) {
        await get().updateProvider(providerId, {
          name: provider.name,
          api_base: provider.api_base,
          api_key: null,
          model: models[0],
          is_local: provider.is_local,
          wire_api: provider.wire_api,
          reasoning_effort: provider.reasoning_effort,
          context_window_tokens: provider.context_window_tokens,
        });
      }
    } catch {
      // Silent failure, see the field doc above.
    }
  },
}));
