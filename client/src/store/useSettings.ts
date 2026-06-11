import { create } from 'zustand';
import { settingsApi, tagsApi } from '../lib/api';
import type { Settings, TagDef } from '../../../server/src/types';

interface SettingsState {
  settings: Settings | null;
  tags: TagDef[];
  loading: boolean;
  fetch: () => Promise<void>;
  updateSettings: (data: Partial<Settings>) => Promise<void>;
  updateTag: (id: number, data: Partial<TagDef>) => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  tags: [],
  loading: false,

  fetch: async () => {
    set({ loading: true });
    const [settings, tags] = await Promise.all([
      settingsApi.get(),
      tagsApi.list(),
    ]);
    set({ settings, tags, loading: false });
  },

  updateSettings: async (data) => {
    const res = await settingsApi.update(data);
    set({ settings: res.settings });
  },

  updateTag: async (id, data) => {
    await tagsApi.update(id, data);
    await get().fetch();
  },
}));
