export interface Point {
  x: number;
  y: number;
  id?: string;
  isCurvePoint?: boolean;
  circleData?: {
    center: { x: number; y: number };
    radius: number;
  };
  polygonData?: {
    id: string;
    center: { x: number; y: number };
    radius: number;
    initialAngle: number;
    sides: number;
    vertexIndex: number;
    polygonType?: 'corner' | 'midpoint';
  };
  rectData?: {
    id: string;
    vertexIndex: number;
  };
}

export type SnapType = 'end' | 'mid' | 'int' | 'origin' | 'grid' | 'anchor' | 'quad' | 'tan' | 'near' | 'extension' | 'perpendicular' | 'intersection' | 'align';

export interface SnapToggles {
  origin: boolean;
  int: boolean;
  end: boolean;
  mid: boolean;
  tan: boolean;
  quad: boolean;
  near?: boolean;
  extension?: boolean;
}

export interface SnapPoint {
  x: number;
  y: number;
  type: SnapType;
}

export interface TrackLine {
  x: number;
  y: number;
  type: 'H' | 'V' | 'angle' | 'extension' | 'perpendicular';
  angle?: number;
  p1?: Point;
  p2?: Point;
}

export type CommandType = 'line' | 'rect' | 'circle' | 'polygon' | 'trim' | 'extend' | 'offset' | 'stretch' | 'dimension' | '';

export type DrawModeType = 'freehand' | 'point' | 'drag';

export interface PathSettings {
  opType: 'extrude' | 'revolve';
  depth: number;
  revolveAxis?: 'left' | 'center' | 'right' | 'origin-y' | 'origin-x';
  booleanType?: 'union' | 'cut';
  groupId?: string;
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
  dimensions?: Array<{ id: string; p1: Point; p2: Point; offset: number; value: number; dimType?: 'horizontal' | 'vertical' | 'aligned' }>;
  pathSettings?: PathSettings[];
  finalPointsSettings?: PathSettings;
  zOffset?: number;
}

export interface HistoryItem {
  rawPoints: Point[];
  layers: CADLayer[];
  activeLayerId: string;
  clickCount: number;
}

