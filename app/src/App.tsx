import { useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { ThemeProvider } from 'next-themes';
import { Inspector, InspectParams } from 'react-dev-inspector';
import { HeroUIProvider } from '@heroui/react';
import './styles/github-markdown.css';
import 'react-photo-view/dist/react-photo-view.css';
import '@/lib/i18n';
import { initStore } from '@/store/init';
import { AppProvider } from '@/store/module/AppProvider';
import { LoadingPage } from '@/components/Common/LoadingPage';
import { PluginManagerStore } from '@/store/plugin/pluginManagerStore';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
import { getTokenData, setNavigate } from '@/components/Auth/auth-client';
import { BlinkoStore } from '@/store/blinkoStore';
import { useAndroidShortcuts } from '@/lib/hooks';
import { useInitialHotkeySetup } from '@/hooks/useInitialHotkeySetup';
import { isInTauri, isDesktop } from "@/lib/tauriHelper";
import { listen } from "@tauri-apps/api/event";
import QuickNotePage from "./pages/quicknote";
import { useQuicknoteHotkey } from "./hooks/useQuicknoteHotkey";

const SignInPage = lazy(() => import('./pages/signin'));
const SignUpPage = lazy(() => import('./pages/signup'));
const OAuthCallbackPage = lazy(() => import('./pages/oauth-callback'));
const BkemoPage = lazy(() => import('./pages/bkemo'));
const PublicMemoPage = lazy(() => import('./pages/m/[id]'));

const ProtectedRoute = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isChecking, setIsChecking] = useState(true);
  const userStore = RootStore.Get(UserStore);

  useEffect(() => {
    setNavigate(navigate);
  }, [navigate]);

  useEffect(() => {
    const checkAuth = async () => {
      const publicRoutes = ['/signin', '/signup', '/share', '/_offline', '/oauth-callback', '/ai-share', '/oauth-callback'];
      const isPublicRoute = publicRoutes.some(route =>
        location.pathname === route || location.pathname.startsWith('/share/') || location.pathname.startsWith('/ai-share/')
      );
      if (!userStore.isLogin && !isPublicRoute) {
        const tokenData = await getTokenData();
        console.log('tokenData', tokenData);

        if (!tokenData?.user?.id) {
          console.log('No valid token, redirecting to login page');
          navigate('/signin', { replace: true });
        }
      }

      setIsChecking(false);
    };

    checkAuth();
  }, [userStore.isLogin]);

  if (isChecking) {
    return <LoadingPage />;
  }

  return children;
};

// Detect current window type
const getWindowType = () => {
  if (!isInTauri()) return 'main';

  // Check URL path to determine window type
  const path = window.location.pathname;
  if (path.startsWith('/quicktool')) return 'quicktool';
  if (path.startsWith('/quicknote')) return 'quicknote';
  if (path.startsWith('/quickai')) return 'quickai';
  return 'main';
};

function AppRoutes() {
  const navigate = useNavigate();
  const windowType = getWindowType();

  const userStore = RootStore.Get(UserStore);
  userStore.use();

  // Initialize quick-note hotkey handler inside Router context (main window, desktop only)
  if (windowType === 'main' && isDesktop()) {
    useQuicknoteHotkey(true);
  }

  // Listen for navigation commands from Tauri (only for current window type)
  useEffect(() => {
    if (!isInTauri()) return;

    let isMounted = true;
    let unlistenNavigation: (() => void) | null = null;

    const setupListener = async () => {
      try {
        if (!isMounted) return;

        unlistenNavigation = await listen('navigate-to-route', (event) => {
          const { route, replace = false, targetWindow } = event.payload as {
            route: string;
            replace?: boolean;
            targetWindow?: string;
          };

          // Only handle navigation for current window type or if no target specified
          if (!targetWindow || targetWindow === windowType) {
            console.log(`🔄 [${windowType}] Received navigation command:`, route, 'replace:', replace);

            if (replace) {
              navigate(route, { replace: true });
            } else {
              navigate(route);
            }

            // Emit event to notify components to refresh configuration
            if (windowType === 'quicktool') {
              console.log("🔄 Emitting config refresh event for quicktool");
              // This will be picked up by quicktool component to refresh its config
              window.dispatchEvent(new CustomEvent('quicktool-config-refresh'));
            }
          }
        });
      } catch (error) {
        console.error('Failed to setup navigation listener:', error);
      }
    };

    setupListener();

    return () => {
      isMounted = false;

      // Only try to unlisten if we have a valid function
      try {
        if (unlistenNavigation && typeof unlistenNavigation === 'function') {
          unlistenNavigation();
        }
      } catch (error) {
        console.error('Error cleaning up navigation listener:', error);
      }
    };
  }, [navigate, windowType]);

  // Return different routes based on window type
  switch (windowType) {
    case 'quicknote':
      return (
        <Suspense fallback={<LoadingPage />}>
          <Routes>
            <Route path="/quicknote" element={<QuickNotePage />} />
            <Route path="*" element={<Navigate to="/quicknote" replace />} />
          </Routes>
        </Suspense>
      );

    default: // main window
      return (
        <Suspense fallback={<LoadingPage />}>
          <Routes>
            {/* bkemo is the app */}
            <Route path="/" element={<ProtectedRoute><BkemoPage /></ProtectedRoute>} />
            <Route path="/bkemo" element={<ProtectedRoute><BkemoPage /></ProtectedRoute>} />
            <Route path="/signin" element={<SignInPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/oauth-callback" element={<OAuthCallbackPage />} />
            {/* public share page (comments + reactions) */}
            <Route path="/m/:id" element={<PublicMemoPage />} />
            {/* Tauri quick-capture window */}
            <Route path="/quicknote" element={<QuickNotePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      );
  }
}

function App() {
  initStore();
  
  // Initialize Android shortcuts handler
  useAndroidShortcuts();

  // Initialize hotkey setup for desktop app only
  if (isDesktop()) {
    useInitialHotkeySetup();
  }

  useEffect(() => {
    RootStore.Get(PluginManagerStore).initInstalledPlugins();
  }, []);

  return (
    <>
      <Inspector
        keys={['control', 'alt', 'x']}
        onClickElement={({ codeInfo }: InspectParams) => {
          if (!codeInfo?.absolutePath) return
          const { absolutePath, lineNumber, columnNumber } = codeInfo
          window.open(`cursor://file/${absolutePath}:${lineNumber}:${columnNumber}`)
        }}
      />
      <BrowserRouter>
        <HeroUIProvider>
          <ThemeProvider attribute="class" enableSystem={false} defaultTheme="dark">
            {/* AppProvider mounts global toasts/dialogs; no legacy chrome — bkemo is the app. */}
            <AppProvider />
            <AppRoutes />
          </ThemeProvider>
        </HeroUIProvider>
      </BrowserRouter>
    </>
  );
}

export default App;
