import { PlaytestPopulationRegistry, type PlaytestPopulationMember } from './population.js';

type AliasKind =
  | 'asteroid'
  | 'station'
  | 'mission'
  | 'trip'
  | 'order'
  | 'research'
  | 'debris'
  | 'work'
  | 'completion';

function indexedAlias(kind: AliasKind, index: number): string {
  return `${kind}-${String(index).padStart(6, '0')}`;
}

export class PlaytestAliasRegistry {
  private readonly userAliases = new Map<string, string>();
  private readonly stationAliases = new Map<string, string>();
  private readonly stationCountsByUser = new Map<string, number>();
  private readonly entityAliases = new Map<AliasKind, Map<string, string>>();

  constructor(population?: PlaytestPopulationRegistry | readonly PlaytestPopulationMember[]) {
    const members =
      population instanceof PlaytestPopulationRegistry ? population.snapshot() : population;
    for (const member of members ?? []) this.registerPopulationMember(member);
  }

  registerPopulationMember(member: PlaytestPopulationMember): void {
    const existing = this.userAliases.get(member.userId);
    if (existing && existing !== member.alias) {
      throw new Error(`User alias collision for ${member.userId}`);
    }
    this.userAliases.set(member.userId, member.alias);
    this.registerStation(member.userId, member.initialStationId);
  }

  user(userId: string): string {
    const alias = this.userAliases.get(userId);
    if (!alias) throw new Error(`Population user ${userId} has no stable playtest alias`);
    return alias;
  }

  userIds(): string[] {
    return [...this.userAliases.entries()]
      .sort(([, left], [, right]) => left.localeCompare(right))
      .map(([userId]) => userId);
  }

  registerStation(userId: string, stationId: string): string {
    const existing = this.stationAliases.get(stationId);
    if (existing) return existing;
    const userAlias = this.user(userId);
    const index = (this.stationCountsByUser.get(userId) ?? 0) + 1;
    this.stationCountsByUser.set(userId, index);
    const alias = `${userAlias}/station-${String(index).padStart(3, '0')}`;
    this.stationAliases.set(stationId, alias);
    return alias;
  }

  station(stationId: string): string {
    return this.stationAliases.get(stationId) ?? this.entity('station', stationId);
  }

  entity(kind: AliasKind, id: string): string {
    let aliases = this.entityAliases.get(kind);
    if (!aliases) {
      aliases = new Map();
      this.entityAliases.set(kind, aliases);
    }
    const existing = aliases.get(id);
    if (existing) return existing;
    const alias = indexedAlias(kind, aliases.size + 1);
    aliases.set(id, alias);
    return alias;
  }
}
