import { useEffect } from 'react';
import { createSenders } from '../net/senders.ts';
import { WsClient } from '../net/wsClient.ts';
import { useHubStore } from './hubStore.ts';
import { getWsUrl } from './wsUrl.ts';

export function connectHubSocket(token: string): () => void {
  const client = new WsClient({ url: getWsUrl(), token });
  const senders = createSenders(client);
  const unbind = useHubStore.getState().bindNet(senders, (type, handler) =>
    client.bus.on(type, handler),
  );
  client.connect();
  return () => {
    unbind();
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
