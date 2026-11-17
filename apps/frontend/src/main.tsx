import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TokenProvider, useToken } from './contexts/TokenContext';
import TokenResolver from './pages/TokenResolver';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import LandingPage from './pages/LandingPage';
import CliAuthPage from './pages/CliAuthPage';
import BillingPage from './pages/BillingPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import WorkspaceView from './pages/WorkspaceView';
import FileView from './pages/FileView';
import './index.css';

function RootRoute() {
  const { isLoggedIn } = useToken();
  return isLoggedIn ? <DashboardPage /> : <LandingPage />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TokenProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/cli-auth" element={<CliAuthPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/s/:token" element={<TokenResolver />} />
            <Route path="/w/:wid" element={<WorkspaceView />} />
            <Route path="/w/:wid/f/:fid" element={<FileView />} />
            <Route path="/" element={<RootRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </TokenProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
