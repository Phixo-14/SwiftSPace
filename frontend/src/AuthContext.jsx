import { createContext, useContext, useState, useCallback } from 'react';

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

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
