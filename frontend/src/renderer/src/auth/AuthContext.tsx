import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { api, registerLogoutHandler, setAccessToken } from "../api/client";
import type { User } from "../api/types";
import { platform } from "../platform";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isSuperadmin: boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    setAccessToken(null);
    await platform.clearTokens();
    setUser(null);
  }, []);

  useEffect(() => {
    registerLogoutHandler(() => setUser(null));
    (async () => {
      const tokens = await platform.getTokens();
      if (tokens?.access) {
        setAccessToken(tokens.access);
        try {
          const me = await api.get<User>("/auth/me/");
          setUser(me.data);
        } catch {
          await logout();
        }
      }
      setLoading(false);
    })();
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const resp = await api.post("/auth/login/", { username, password });
    const { access, refresh, user: u } = resp.data;
    setAccessToken(access);
    await platform.setTokens({ access, refresh });
    setUser(u as User);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isSuperadmin: user?.role === "SUPERADMIN",
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
