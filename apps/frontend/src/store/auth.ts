import { create } from 'zustand';
const API_BASE = import.meta.env.VITE_API_URL || '';
localStorage.removeItem('admin_token');
localStorage.removeItem('admin-auth');

let sessionGeneration = 0;

interface AuthState {
  isAuthenticated: boolean;
  checked: boolean;
  login: () => void;
  clearAuth: () => void;
  checkSession: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  isAuthenticated: false,
  checked: false,
  login: () => { sessionGeneration++; set({ isAuthenticated: true, checked: true }); },
  clearAuth: () => { sessionGeneration++; set({ isAuthenticated: false, checked: true }); },
  checkSession: async () => {
    const generation = sessionGeneration;
    try {
      const response = await fetch(`${API_BASE}/api/admin/session`, { credentials: 'include' });
      if (generation === sessionGeneration) set({ isAuthenticated: response.ok, checked: true });
    } catch { if (generation === sessionGeneration) set({ isAuthenticated: false, checked: true }); }
  },
  logout: async () => {
    const response = await fetch(`${API_BASE}/api/admin/logout`, { method: 'POST', credentials: 'include' });
    if (!response.ok) throw new Error('Logout failed; please try again');
    sessionGeneration++;
    set({ isAuthenticated: false, checked: true });
  },
}));
