import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const PUBLIC_AUTH_TOKEN_KEY = 'public_user_token';

interface PublicAuthState {
  token: string | null;
  isAuthenticated: boolean;
  user: { id: string; name: string; email: string; role: string; profile_photo_url?: string | null } | null;
  login: (token: string, user?: { id: string; name: string; email: string; role: string; profile_photo_url?: string | null } | null) => void;
  logout: () => void;
  setUser: (user: { id: string; name: string; email: string; role: string; profile_photo_url?: string | null } | null) => void;
}

export const usePublicAuthStore = create<PublicAuthState>()(
  persist(
    (set) => ({
      token: null,
      isAuthenticated: false,
      user: null,
      login: (token, user = null) => {
        localStorage.setItem(PUBLIC_AUTH_TOKEN_KEY, token);
        set({ token, isAuthenticated: true, user });
      },
      logout: () => {
        localStorage.removeItem(PUBLIC_AUTH_TOKEN_KEY);
        set({ token: null, isAuthenticated: false, user: null });
      },
      setUser: (user) => set({ user }),
    }),
    {
      name: 'public-auth',
      partialize: (state) => ({
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        user: state.user,
      }),
    }
  )
);
