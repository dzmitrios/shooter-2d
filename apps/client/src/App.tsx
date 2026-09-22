import { useAuthStore } from './auth/authStore.ts';
import { AuthPage } from './pages/AuthPage.tsx';
import { HubPage } from './pages/HubPage.tsx';

export default function App() {
  const screen = useAuthStore((state) => state.screen);
  const hydrated = useAuthStore((state) => state.hydrated);

  if (!hydrated) {
    useAuthStore.getState().hydrate();
  }

  if (screen === 'hub' || useAuthStore.getState().screen === 'hub') {
    return <HubPage />;
  }

  return <AuthPage />;
}
