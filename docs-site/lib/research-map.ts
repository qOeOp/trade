import mapData from '@/lib/generated/rd-map.json';

// Chapter maps, built at prepare time from the chapter's anchored sections (docs/rd/map.json adds each
// capability's kind and the links between capabilities): a function (level 2) is a container of components
// (level 3), a component holds its capabilities (level 4). Hovering a capability shows its links inside the
// chapter; a function counts its links to other chapters.

export type Side = 't' | 'r' | 'b' | 'l';
export type MapCapability = { path: string; title: string; kind: 'mechanism' | 'rule' };
export type MapComponent = { path: string; title: string; caps: MapCapability[] };
export type MapFunction = { path: string; label: string; title: string; components: MapComponent[] };
export type MapChapter = { prefix: string; slug: string; functions: MapFunction[] };

export const data = mapData as { chapters: MapChapter[]; links: [string, string][] };

const CAP_W = 236;
export const CAP_H = 40;
export const CAP_GAP = 6;
export const COMP_PAD = 8;
export const COMP_HEAD = 24;
export const COMP_GAP = 10;
export const FN_PAD = 10;
export const FN_HEAD = 32;
export const FN_W = CAP_W + 2 * COMP_PAD + 2 * FN_PAD;

export const outsideLabel = { zh: '对外关联', en: 'links outside' };
