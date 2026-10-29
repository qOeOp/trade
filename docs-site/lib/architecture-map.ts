import type { Locale } from '@/lib/i18n';

export type Copy = Record<Locale, string>;
export type EdgeRoute = { axis: 'x' | 'y'; at: number } | { via: [number, number][] };
export type ArchitectureEdgeData = {
  route?: EdgeRoute; caption?: Copy; emphasis?: 'main' | 'secondary';
  pinOrder?: number; description: Copy; docsRoute: string; isHighlighted?: boolean; isDimmed?: boolean; isRelated?: boolean;
};
export type ArchitectureNodeData = {
  nodeType: 'architecture'; title: string; subtitle?: Copy; importance?: 'core' | 'normal' | 'support';
  owner: string; kind: 'authority' | 'adapter' | 'protected' | 'safety'; emphasis: 'core' | 'standard' | 'support';
  variant?: 'client' | 'strategy' | 'engine' | 'bus' | 'store' | 'record';
  description: Copy; docsRoute: string; activeHandles?: string[];
};
export type OwnerNodeData = {
  nodeType: 'owner' | 'boundary'; label: string; count: number; badge?: string;
  tone: 'neutral' | 'cyan' | 'violet' | 'amber'; role: 'authority' | 'shell' | 'channel' | 'factory' | 'stage';
  roleLabel: 'MODULE' | 'BOUNDARY' | 'SERVICE' | 'DATABASE' | 'READ COPY' | 'PACKAGE' | 'SUBSYSTEM' | 'CONTAINER' | 'CACHE';
  docsRoute: string; memberGroupIds: string[]; activeHandles?: string[];
};
export type DiagramNodeData = ArchitectureNodeData | OwnerNodeData;
