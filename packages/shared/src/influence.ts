export interface StationInfluence {
  stationId: string;
  points: number;
  requiredPoints: number;
  defended: boolean;
  canTakeOver: boolean;
}
