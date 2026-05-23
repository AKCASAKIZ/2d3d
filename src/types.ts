export interface Point {
  x: number;
  y: number;
  id?: string;
  isCurvePoint?: boolean;
  circleData?: {
    center: { x: number; y: number };
    radius: number;
  };
}

export type SnapType = 'end' | 'mid' | 'int' | 'origin' | 'grid' | 'anchor' | 'quad' | 'tan';

export interface SnapToggles {
  origin: boolean;
  int: boolean;
  end: boolean;
  mid: boolean;
  tan: boolean;
  quad: boolean;
}

export interface SnapPoint {
  x: number;
  y: number;
  type: SnapType;
}

export interface TrackLine {
  x: number;
  y: number;
  type: 'H' | 'V';
}

export type CommandType = 'line' | 'rect' | 'circle' | 'polygon' | 'trim' | 'extend' | 'offset' | 'stretch' | '';

export type DrawModeType = 'freehand' | 'point' | 'drag';

export interface PathSettings {
  opType: 'extrude' | 'revolve';
  depth: number;
  revolveAxis?: 'left' | 'center' | 'right' | 'origin-y' | 'origin-x';
  booleanType?: 'union' | 'cut';
}

export interface CADLayer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  finalPoints: Point[];
  isClosed: boolean;
  opType: 'extrude' | 'revolve';
  depth: number;
  revolveAxis?: 'left' | 'center' | 'right' | 'origin-y' | 'origin-x';
  paths?: Point[][];
  pathSettings?: PathSettings[];
  finalPointsSettings?: PathSettings;
}

export interface HistoryItem {
  rawPoints: Point[];
  layers: CADLayer[];
  activeLayerId: string;
  clickCount: number;
}

