import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import Home from '@/pages/home';
import Records from '@/pages/records';
import NotFound from '@/pages/not-found';
import EntityDetail from '@/pages/entity-detail';
import FinancialDetail from '@/pages/financial-detail';
import LearningSignals from '@/pages/learning-signals';
import Memories from '@/pages/memories';
import Works from '@/pages/works';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import AuthScreen from '@/components/auth-screen';
import { getCurrentUser, logout, type AuthUser } from '@/lib/auth';

const queryClient = new QueryClient();

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
         <Route path="/records" component={Records} />
          <Route path="/people/:id" component={() => <EntityDetail entityType="person" />} />
          <Route path="/projects/:id" component={() => <EntityDetail entityType="project" />} />
           <Route path="/financial/parties/:id" component={FinancialDetail} />
         <Route path="/learning" component={LearningSignals} />
          <Route path="/memories" component={Memories} />
        <Route path="/works" component={Works} />
        <Route path="/works/:id" component={Works} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">جارٍ التحقق من الجلسة…</div>;
  }
  if (!user) return <AuthScreen onAuthenticated={setUser} />;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <div className="relative">
            <button className="fixed left-4 top-4 z-50 rounded-lg border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm" onClick={() => { void logout().finally(() => setUser(null)); }}>
              تسجيل الخروج
            </button>
            <Router />
          </div>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
