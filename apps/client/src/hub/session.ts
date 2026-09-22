import { useEffect } from 'react';
import { useAuthStore } from '../auth/authStore.ts';
import { bindGameNet } from '../game/gameStore.ts';
import { useHudStore } from '../game/hudStore.ts';
import { createSenders } from '../net/senders.ts';
import { WsClient } from '../net/wsClient.ts';
import { useHubStore } from './hubStore.ts';
import { getWsUrl } from './wsUrl.ts';

export function connectHubSocket(token: string): () => void {
  const client = new WsClient({ url: getWsUrl(), token });
  const senders = createSenders(client);
  const unbindHub = useHubStore.getState().bindNet(senders, (type, handler) =>
    client.bus.on(type, handler),
  );
  const unbindGame = bindGameNet(
    (type, handler) => client.bus.on(type, handler),
    () => useAuthStore.getState().userId,
  );
  const unbindHud = useHudStore.getState().bindNet(
    (type, handler) => client.bus.on(type, handler),
    () => useAuthStore.getState().userId,
    () => useHubStore.getState().match?.waveConfig ?? [],
    () => useHubStore.getState().senders,
  );
  client.connect();
  return () => {
    unbindHub();
    unbindGame();
    unbindHud();
    client.disconnect();
  };
}

export function useHubSocket(token: string | null): void {
  useEffect(() => {
    if (!token) {
      return;
    }
    return connectHubSocket(token);
  }, [token]);
}
