import { useAuthStore } from './auth/authStore.ts';
import { useHubSocket } from './hub/session.ts';
import { ArenaPage } from './pages/ArenaPage.tsx';
import { AuthPage } from './pages/AuthPage.tsx';
import { HubPage } from './pages/HubPage.tsx';

export default function App() {
  useAuthStore();

  if (!useAuthStore.getState().hydrated) {
    useAuthStore.getState().hydrate();
  }

  const { screen, token } = useAuthStore.getState();
  useHubSocket(token);

  if (screen === 'arena') {
    return <ArenaPage />;
  }
  if (screen === 'hub') {
    return <HubPage />;
  }

  return <AuthPage />;
}
