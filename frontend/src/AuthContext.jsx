import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('rd_user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = useCallback((token, userData) => {
    localStorage.setItem('rd_token', token);
    localStorage.setItem('rd_user', JSON.stringify(userData));
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('rd_token');
    localStorage.removeItem('rd_user');
    setUser(null);
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('rd_token')) return undefined;
    let active = true;

    async function refreshCurrentUser() {
      const token = localStorage.getItem('rd_token');
      if (!token) return;
      try {
        const { data } = await api.get('/auth/me');
        if (!active || localStorage.getItem('rd_token') !== token) return;
        localStorage.setItem('rd_user', JSON.stringify(data.user));
        setUser(data.user);
      } catch (error) {
        if (active && localStorage.getItem('rd_token') === token && error.response?.status === 401) {
          logout();
        }
      }
    }

    function refreshWhenVisible() {
      if (document.visibilityState === 'visible') refreshCurrentUser();
    }

    refreshCurrentUser();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    return () => {
      active = false;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [logout]);

  const isAdmin = Boolean(user?.role === 'admin');

  return <AuthContext.Provider value={{ user, isAdmin, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
