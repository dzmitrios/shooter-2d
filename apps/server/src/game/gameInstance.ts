export interface RoomPlayer {
  userId: string;
  username: string;
  weaponId: string;
  rank: number;
}

export class GameInstance {
  readonly disconnected = new Set<string>();

  constructor(
    readonly roomId: string,
    readonly players: RoomPlayer[],
    readonly seed: number,
  ) {}

  markDisconnected(userId: string): void {
    this.disconnected.add(userId);
  }

  destroy(): void {}
}
