export type ArchitectureItem = {
  id: string;
  title: string;
  parent?: string;
  kind: 'region' | 'component';
  docsRoute: string;
};
export type ArchitectureRelation = {
  id: string;
  source: string;
  target: string;
};
export type Rect = { x: number; y: number; width: number; height: number };
export type Point = [number, number];
export type TextMetrics = { left: number; top: number; width: number; height: number };
export type MapText = {
  id: string; text: string; x: number; y: number; size: number; weight: number;
  tone: 'ink' | 'muted' | 'faint' | 'accent' | 'primary';
  anchor: 'start' | 'middle' | 'end';
  relations: string[];
};
export type MapSurface = Rect & {
  id: string; node: string; radius: number;
  tier: 'region' | 'boundary' | 'database' | 'component' | 'copy' | 'capture' | 'external';
  accent?: boolean;
};
export type MapRule = { id: string; d: string };
export type MapDecoration = Rect & { id: string; radius: number };
export type MapRoute = {
  id: string; relations: string[]; points: Point[][];
  primary: boolean; arrow: boolean;
  junction?: Point;
};
export type MapTarget = Rect & { node: string; texts: string[] };
