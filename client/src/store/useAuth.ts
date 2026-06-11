import { create } from 'zustand';
import { auth } from '../lib/api';

interface AuthState {
  username: string | null;
  loading: boolean;
  check: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  username: null,
  loading: true,

  check: async () => {
    try {
      const { authenticated, username } = await auth.me();
      set({ username: authenticated ? (username ?? null) : null, loading: false });
    } catch {
      set({ username: null, loading: false });
    }
  },

  login: async (username, password) => {
    const res = await auth.login(username, password);
    if (!res.success) throw new Error('Login failed');
    set({ username: res.username });
  },

  logout: async () => {
    await auth.logout();
    set({ username: null });
  },
}));
