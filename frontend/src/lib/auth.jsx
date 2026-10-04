import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setToken, getToken } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // CRITICAL: returning from Google OAuth — let AuthCallback exchange session_id first
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (_e) {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (mobile, password) => {
    const { data } = await api.post("/auth/login", { mobile, password });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const loginWithGoogleSession = async (sessionId) => {
    const { data } = await api.post("/auth/google/session", { session_id: sessionId });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  // OTP flows hand back a ready token — adopt it and pull the profile.
  const loginWithToken = async (token) => {
    setToken(token);
    const { data } = await api.get("/auth/me");
    setUser(data);
    return data;
  };

  const setMobile = async (mobile) => {
    const { data } = await api.post("/auth/set-mobile", { mobile });
    setUser((u) => (u ? { ...u, mobile: data.mobile, needs_mobile: false } : u));
    return data.mobile;
  };

  const signup = async (name, mobile, password) => {
    const { data } = await api.post("/auth/signup", { name, mobile, password });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, loginWithGoogleSession, loginWithToken, setMobile, logout, refresh, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
