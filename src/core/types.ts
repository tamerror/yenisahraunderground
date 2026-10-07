/** Longitude, latitude pair (WGS84). */
export type LonLat = [number, number];

export type StreetKind =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'minor'
  | 'service'
  | 'pedestrian'
  | 'footway'
  | 'steps';

export type PoiType =
  | 'bakery'
  | 'cafe'
  | 'food'
  | 'market'
  | 'mosque'
  | 'school'
  | 'park'
  | 'pharmacy'
  | 'pet'
  | 'shop'
  | 'bus'
  | 'metro';

export type AreaType = 'park' | 'grass' | 'pitch' | 'school' | 'religious';

export interface AreaStreet {
  /** name */
  n: string | null;
  /** kind */
  k: StreetKind;
  /** coordinates */
  c: LonLat[];
  /** bridge flag */
  b?: 1;
}

export interface AreaBuilding {
  /** outer ring (not closed) */
  c: LonLat[];
  /** number of floors */
  f?: number;
  /** height in metres */
  h?: number;
}

export interface AreaPoi {
  n: string;
  t: PoiType;
  p: LonLat;
}

export interface AreaPolygon {
  t: AreaType;
  c: LonLat[];
}

/** Compact map description of one neighbourhood, either bundled or built from OSM at runtime. */
export interface AreaData {
  version: 1;
  name: string;
  fullName: string;
  source: string;
  center: LonLat;
  boundary: LonLat[];
  streets: AreaStreet[];
  buildings: AreaBuilding[];
  pois: AreaPoi[];
  areas: AreaPolygon[];
}

export interface Vec2 {
  x: number;
  y: number;
}
