import { GameInstance, type RoomPlayer } from '../game/gameInstance.js';

export class RoomManager {
  private readonly instances = new Map<string, GameInstance>();

  createRoom(roomId: string, players: RoomPlayer[], seed: number): GameInstance {
    const existing = this.instances.get(roomId);
    if (existing) {
      return existing;
    }
    const instance = new GameInstance(roomId, players, seed);
    this.instances.set(roomId, instance);
    return instance;
  }

  getRoom(roomId: string): GameInstance | undefined {
    return this.instances.get(roomId);
  }

  removeRoom(roomId: string): boolean {
    const instance = this.instances.get(roomId);
    instance?.destroy();
    return this.instances.delete(roomId);
  }
}
