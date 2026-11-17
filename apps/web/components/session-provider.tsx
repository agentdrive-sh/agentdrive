'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { WebSession } from '../lib/session';

interface SessionContextValue {
  session: WebSession | null;
}

const SessionContext = createContext<SessionContextValue>({ session: null });

interface SessionProviderProps {
  session: WebSession | null;
  children: ReactNode;
}

export function SessionProvider({ session, children }: SessionProviderProps) {
  return (
    <SessionContext.Provider value={{ session }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): WebSession | null {
  return useContext(SessionContext).session;
}
