import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AppTitlebar } from '../components/app/AppTitlebar';
import { ChatPage } from '../components/app/ChatPage';
import { ChatSidebar } from '../components/app/ChatSidebar';
import { MainContent } from '../MainContent';
import { StatusBar } from '../components/StatusBar';
import { ToastContainer } from '../components/ToastContainer';
import { toggleSidebar } from '../components/SidebarLayout';
import { toggleJianSidebar } from '../stores/desk-actions';
import { togglePreviewPanel } from '../stores/preview-actions';
import { useStore } from '../stores';
import { createNewSession } from '../stores/session-actions';
import {
  initializeMobileRuntime,
  readMobileAuthSession,
  type MobilePrincipal,
} from './mobile-init';

type AuthState = 'checking' | 'login' | 'ready';
const MOBILE_REQUIRED_SCOPES = Object.freeze(['chat', 'resources.read', 'files.read', 'files.write']);
const MOBILE_EDGE_GESTURE_WIDTH = 28;
const MOBILE_EDGE_GESTURE_MIN_DISTANCE = 56;
const MOBILE_EDGE_GESTURE_MAX_VERTICAL_DRIFT = 80;
const MOBILE_EDGE_GESTURE_DOMINANCE = 1.25;

const LazyPreviewPanel = lazy(() => import('../components/PreviewPanel').then(module => ({ default: module.PreviewPanel })));
const LazyMediaViewer = lazy(() => import('../components/shared/MediaViewer/MediaViewer').then(module => ({ default: module.MediaViewer })));
const LazyWorkspaceCompanionRail = lazy(() => import('../components/app/WorkspaceCompanionRail').then(module => ({ default: module.WorkspaceCompanionRail })));

type MobileEdgeGesture = {
  edge: 'left' | 'right';
  startX: number;
  startY: number;
  cancelled: boolean;
};

export function MobileApp(): React.ReactElement {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [principal, setPrincipal] = useState<MobilePrincipal | null>(null);
  const [loginSecret, setLoginSecret] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const applyAuthenticatedPrincipal = useCallback(async (nextPrincipal: MobilePrincipal) => {
    if (!principalHasRequiredScopes(nextPrincipal, MOBILE_REQUIRED_SCOPES)) {
      await apiJson('/api/web-auth/logout', { method: 'POST' }).catch(() => null);
      setPrincipal(null);
      setLoginError('当前登录缺少工作台权限，请重新输入访问密钥。');
      setAuthState('login');
      return;
    }
    await initializeMobileRuntime(nextPrincipal);
    setPrincipal(nextPrincipal);
    setAuthState('ready');
  }, []);

  const bootstrap = useCallback(async () => {
    const session = await readMobileAuthSession();
    if (!session.authenticated || !session.principal) {
      setAuthState('login');
      return;
    }
    await applyAuthenticatedPrincipal(session.principal);
  }, [applyAuthenticatedPrincipal]);

  useEffect(() => {
    let cancelled = false;
    bootstrap().catch((err) => {
      console.warn('[mobile] bootstrap failed', err);
      if (!cancelled) setAuthState('login');
    });
    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError(null);
    try {
      const data = await apiJson<WebAuthLoginResponse>('/api/web-auth/login', {
        method: 'POST',
        body: JSON.stringify({ credential: loginSecret.trim() }),
      });
      setLoginSecret('');
      if (data?.principal) {
        await applyAuthenticatedPrincipal({
          ...data.principal,
          accessToken: data.accessToken || null,
        });
      } else {
        await bootstrap();
      }
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '登录失败');
    }
  };

  if (authState === 'checking') {
    return <MobileLoadingScreen />;
  }

  if (authState === 'login') {
    return (
      <MobileLoginScreen
        secret={loginSecret}
        error={loginError}
        onSecretChange={setLoginSecret}
        onSubmit={login}
      />
    );
  }

  return (
    <ErrorBoundary region="mobile">
      <MobileDesktopShell principal={principal} />
    </ErrorBoundary>
  );
}

function MobileDesktopShell({
  principal,
}: {
  principal: MobilePrincipal | null;
}) {
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const jianOpen = useStore(s => s.jianOpen);
  const previewOpen = useStore(s => s.previewOpen);
  const mediaViewer = useStore(s => s.mediaViewer);
  const currentTab = useStore(s => s.currentTab);
  const isNarrow = useNarrowMobileViewport();
  const edgeGestureRef = useRef<MobileEdgeGesture | null>(null);

  useEffect(() => {
    useStore.setState({ currentTab: 'chat' });
  }, []);

  useEffect(() => {
    if (isNarrow) useStore.setState({ sidebarOpen: false, jianOpen: false });
  }, [isNarrow]);

  const showDrawerScrim = (sidebarOpen || jianOpen) && isNarrow;
  const openMobileDrawerFromGesture = useCallback((edge: MobileEdgeGesture['edge']) => {
    if (edge === 'left') {
      useStore.setState({ jianOpen: false });
      toggleSidebar(true);
      return;
    }
    useStore.setState({ sidebarOpen: false });
    toggleJianSidebar(true);
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLElement>) => {
    edgeGestureRef.current = null;
    if (!isNarrow || sidebarOpen || jianOpen || event.touches.length !== 1) return;
    if (shouldIgnoreMobileEdgeGestureTarget(event.target)) return;

    const touch = event.touches[0];
    const width = window.innerWidth || document.documentElement.clientWidth;
    if (touch.clientX <= MOBILE_EDGE_GESTURE_WIDTH) {
      edgeGestureRef.current = {
        edge: 'left',
        startX: touch.clientX,
        startY: touch.clientY,
        cancelled: false,
      };
      return;
    }
    if (touch.clientX >= width - MOBILE_EDGE_GESTURE_WIDTH) {
      edgeGestureRef.current = {
        edge: 'right',
        startX: touch.clientX,
        startY: touch.clientY,
        cancelled: false,
      };
    }
  }, [isNarrow, jianOpen, sidebarOpen]);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLElement>) => {
    const gesture = edgeGestureRef.current;
    if (!gesture || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    const horizontalDistance = gesture.edge === 'left' ? dx : -dx;
    const verticalDistance = Math.abs(dy);

    if (verticalDistance > 18 && verticalDistance > Math.abs(dx)) {
      gesture.cancelled = true;
      return;
    }
    if (horizontalDistance > 12 && horizontalDistance > verticalDistance * MOBILE_EDGE_GESTURE_DOMINANCE) {
      event.preventDefault();
    }
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLElement>) => {
    const gesture = edgeGestureRef.current;
    edgeGestureRef.current = null;
    if (!gesture || gesture.cancelled) return;
    const touch = event.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - gesture.startX;
    const dy = touch.clientY - gesture.startY;
    const horizontalDistance = gesture.edge === 'left' ? dx : -dx;
    const verticalDistance = Math.abs(dy);
    const isDrawerSwipe = horizontalDistance >= MOBILE_EDGE_GESTURE_MIN_DISTANCE
      && verticalDistance <= MOBILE_EDGE_GESTURE_MAX_VERTICAL_DRIFT
      && horizontalDistance > verticalDistance * MOBILE_EDGE_GESTURE_DOMINANCE;
    if (!isDrawerSwipe) return;
    openMobileDrawerFromGesture(gesture.edge);
  }, [openMobileDrawerFromGesture]);

  return (
    <main
      className="mobile-desktop-root"
      data-mobile-principal={principal?.credentialKind || 'session'}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => { edgeGestureRef.current = null; }}
    >
      <AppTitlebar
        sidebarOpen={sidebarOpen}
        jianOpen={jianOpen}
        previewOpen={previewOpen}
        showPreviewToggle
        showChannelTabs={false}
        showWidgetButtons={false}
        onToggleSidebar={() => {
          if (!sidebarOpen) useStore.setState({ jianOpen: false });
          toggleSidebar(!sidebarOpen);
        }}
        onToggleJian={() => {
          if (!jianOpen) useStore.setState({ sidebarOpen: false });
          toggleJianSidebar(!jianOpen);
        }}
        onTogglePreview={() => {
          if (!previewOpen) useStore.setState({ sidebarOpen: false, jianOpen: false });
          togglePreviewPanel();
        }}
      />
      <div className="app mobile-desktop-app">
        <ChatSidebar
          open={sidebarOpen && currentTab === 'chat'}
          includeChannels={false}
          showSettingsButton={false}
          showActivityBars={false}
          onNewSession={() => void createNewSession()}
          onCollapse={() => toggleSidebar(false)}
          region="mobile-sidebar"
        />
        <MainContent>
          <ChatPage inputSurface="mobile" regionPrefix="mobile-" />
        </MainContent>
        {previewOpen && (
          <Suspense fallback={null}>
            <LazyPreviewPanel />
          </Suspense>
        )}
        {(!isNarrow || jianOpen) && (
          <Suspense fallback={<WorkspaceCompanionRailFallback open={jianOpen} />}>
            <LazyWorkspaceCompanionRail />
          </Suspense>
        )}
      </div>
      {showDrawerScrim && <button className="mobile-drawer-scrim" type="button" aria-label="关闭侧边栏" onClick={closeMobileDrawers} />}
      <StatusBar />
      {mediaViewer && (
        <Suspense fallback={null}>
          <LazyMediaViewer />
        </Suspense>
      )}
      <ToastContainer />
    </main>
  );
}

function WorkspaceCompanionRailFallback({ open }: { open: boolean }) {
  return (
    <aside className={`jian-sidebar${open ? '' : ' collapsed'}`} id="jianSidebar" data-mobile-workspace-loading="">
      <div className="resize-handle resize-handle-left" id="jianResizeHandle"></div>
      <div className="jian-sidebar-inner"></div>
    </aside>
  );
}

function MobileLoadingScreen() {
  return (
    <main className="onboarding">
      <section className="onboarding-step active">
        <img className="onboarding-avatar" src="./icon.png" alt="" />
        <h1 className="onboarding-title">Hana Mobile</h1>
        <p className="onboarding-subtitle">正在连接 Hana...</p>
      </section>
    </main>
  );
}

function MobileLoginScreen({
  secret,
  error,
  onSecretChange,
  onSubmit,
}: {
  secret: string;
  error: string | null;
  onSecretChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const loginDisabled = !secret.trim();

  return (
    <main className="onboarding">
      <form className="onboarding-step active" onSubmit={onSubmit}>
        <img className="onboarding-avatar" src="./icon.png" alt="" />
        <h1 className="onboarding-title">手机访问 Hana</h1>
        <p className="onboarding-subtitle">输入设备访问密钥登录。首次成功访问会自动绑定来源 IP。</p>

        <label className="custom-field">
          <span className="ob-field-label">访问密钥</span>
          <input className="ob-input" value={secret} onChange={(event) => onSecretChange(event.target.value)} autoComplete="one-time-code" spellCheck={false} />
        </label>

        {error && <div className="ob-status error">{error}</div>}
        <div className="onboarding-actions">
          <button className="ob-btn ob-btn-primary" type="submit" disabled={loginDisabled}>登录</button>
        </div>
      </form>
    </main>
  );
}

interface WebAuthLoginResponse {
  ok?: boolean;
  accessToken?: string | null;
  tokenType?: string | null;
  principal?: MobilePrincipal | null;
}

function closeMobileDrawers() {
  useStore.setState({ sidebarOpen: false, jianOpen: false });
}

function shouldIgnoreMobileEdgeGestureTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, button, [contenteditable="true"], [data-mobile-gesture-ignore="true"]'));
}

function principalHasRequiredScopes(principal: MobilePrincipal, requiredScopes: readonly string[]): boolean {
  const scopes = Array.isArray(principal.scopes) ? principal.scopes : [];
  return requiredScopes.every((scope) => scopeAllows(scopes, scope));
}

function scopeAllows(scopes: string[], required: string): boolean {
  if (scopes.includes(required)) return true;
  const [namespace] = required.split('.');
  return scopes.includes(namespace) || scopes.includes(`${namespace}.*`);
}

function useNarrowMobileViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 860px)').matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(max-width: 860px)');
    const apply = () => setIsNarrow(media.matches);
    apply();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    media.addListener(apply);
    return () => media.removeListener(apply);
  }, []);

  return isNarrow;
}

async function apiJson<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      detail = data.detail || data.error || detail;
    } catch {}
    throw new Error(detail);
  }
  return await res.json() as T;
}
