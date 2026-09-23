import { GameInstance, type GameInstanceOptions, type RoomPlayer } from '../game/gameInstance.js';

export class RoomManager {
  private readonly instances = new Map<string, GameInstance>();

  constructor(private readonly instanceOptions: GameInstanceOptions = {}) {}

  createRoom(roomId: string, players: RoomPlayer[], seed: number): GameInstance {
    const existing = this.instances.get(roomId);
    if (existing) {
      return existing;
    }
    const instance = new GameInstance(roomId, players, seed, {
      autoStart: false,
      ...this.instanceOptions,
    });
    this.instances.set(roomId, instance);
    return instance;
  }

  roomCount(): number {
    return this.instances.size;
  }

  getRoom(roomId: string): GameInstance | undefined {
    return this.instances.get(roomId);
  }

  removeRoom(roomId: string): boolean {
    const instance = this.instances.get(roomId);
    instance?.destroy();
    return this.instances.delete(roomId);
  }

  destroyAll(): void {
    for (const roomId of [...this.instances.keys()]) {
      this.removeRoom(roomId);
    }
  }
}
