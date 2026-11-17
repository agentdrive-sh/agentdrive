import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface TokenState {
  token: string | null;
  workspaceId: string | null;
  fileId: string | null;
  permission: string | null;
  sessionId: string | null;
  email: string | null;
  orgId: string | null;
}

interface TokenContextValue extends TokenState {
  setToken: (token: string, workspaceId: string, fileId?: string, permission?: string) => void;
  setSession: (sessionId: string, email: string, orgId?: string) => void;
  clearToken: () => void;
  clearSession: () => void;
  isLoggedIn: boolean;
}

const STORAGE_KEY = 'agentdrive_session';

const TokenContext = createContext<TokenContextValue | null>(null);

export function TokenProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TokenState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          token: null,
          workspaceId: null,
          fileId: null,
          permission: null,
          sessionId: parsed.sessionId || null,
          email: parsed.email || null,
          orgId: parsed.orgId || null,
        };
      }
    } catch {}
    return { token: null, workspaceId: null, fileId: null, permission: null, sessionId: null, email: null, orgId: null };
  });

  useEffect(() => {
    if (state.sessionId) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessionId: state.sessionId,
        email: state.email,
        orgId: state.orgId,
      }));
    }
  }, [state.sessionId, state.email, state.orgId]);

  const setToken = useCallback((token: string, workspaceId: string, fileId?: string, permission?: string) => {
    setState(prev => ({ ...prev, token, workspaceId, fileId: fileId ?? null, permission: permission ?? null }));
  }, []);

  const setSession = useCallback((sessionId: string, email: string, orgId?: string) => {
    setState(prev => ({ ...prev, sessionId, email, orgId: orgId ?? prev.orgId }));
  }, []);

  const clearToken = useCallback(() => {
    setState(prev => ({ ...prev, token: null, workspaceId: null, fileId: null, permission: null }));
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(prev => ({ ...prev, sessionId: null, email: null, orgId: null }));
  }, []);

  const isLoggedIn = !!state.sessionId;

  return (
    <TokenContext.Provider value={{ ...state, setToken, setSession, clearToken, clearSession, isLoggedIn }}>
      {children}
    </TokenContext.Provider>
  );
}

export function useToken() {
  const ctx = useContext(TokenContext);
  if (!ctx) throw new Error('useToken must be used within TokenProvider');
  return ctx;
}
