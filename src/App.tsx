import React, { useState, useEffect, useRef } from 'react';
import { jsPDF } from 'jspdf';
import {
  PenTool,
  Square,
  Circle,
  HelpCircle,
  Undo2,
  Trash2,
  Image as ImageIcon,
  CheckCircle,
  Maximize,
  Download,
  Flame,
  MousePointer2,
  ListFilter,
  Activity,
  Workflow,
  Sparkles,
  RefreshCw,
  Layers,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Plus,
  Palette,
  Ruler,
  Save,
  Upload,
  ChevronRight,
  ChevronLeft,
  Copy,
  FlipHorizontal,
  Scissors,
  Clipboard,
  Sliders,
  Grid,
} from 'lucide-react';

import { Point, CommandType, DrawModeType, HistoryItem, SnapPoint, TrackLine, CADLayer, PathSettings, SnapToggles } from './types';
import { calculateSnaps, distance, douglasPeucker, getClosestPointOnSegment, findSegmentIntersection, offsetPolygon } from './utils/geometry';
import { ThreeViewport } from './components/ThreeViewport';

const getDimensionLinePoints = (
  p1: Point,
  p2: Point,
  offset: number,
  dimType: 'horizontal' | 'vertical' | 'aligned' = 'aligned'
) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  let dP1_offX = p1.x;
  let dP1_offY = p1.y;
  let dP2_offX = p2.x;
  let dP2_offY = p2.y;

  if (dimType === 'horizontal') {
    dP1_offX = p1.x;
    dP1_offY = midY + offset;
    dP2_offX = p2.x;
    dP2_offY = midY + offset;
  } else if (dimType === 'vertical') {
    dP1_offX = midX + offset;
    dP1_offY = p1.y;
    dP2_offX = midX + offset;
    dP2_offY = p2.y;
  } else {
    if (len > 0.001) {
      const nx = -dy / len;
      const ny = dx / len;
      dP1_offX = p1.x + nx * offset;
      dP1_offY = p1.y + ny * offset;
      dP2_offX = p2.x + nx * offset;
      dP2_offY = p2.y + ny * offset;
    }
  }

  return {
    dP1_offX,
    dP1_offY,
    dP2_offX,
    dP2_offY,
    midX: (dP1_offX + dP2_offX) / 2,
    midY: (dP1_offY + dP2_offY) / 2,
  };
};

const getAutoDimensionDetails = (
  p1: Point,
  p2: Point,
  cx: number,
  cy: number
) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy);

  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  if (len < 0.001) {
    return { dimType: 'aligned' as const, value: 0, offset: 0 };
  }

  if (Math.abs(dx) < 0.05) {
    return {
      dimType: 'vertical' as const,
      value: Math.abs(dy),
      offset: cx - midX,
    };
  }

  if (Math.abs(dy) < 0.05) {
    return {
      dimType: 'horizontal' as const,
      value: Math.abs(dx),
      offset: cy - midY,
    };
  }

  const segAngle = Math.atan2(dy, dx);
  const perpAngle = segAngle + Math.PI / 2;
  const cursorAngle = Math.atan2(cy - midY, cx - midX);

  const getDiff = (a1: number, a2: number) => {
    const d = Math.abs(a1 - a2) % Math.PI;
    return d > Math.PI / 2 ? Math.PI - d : d;
  };

  const devToVertical = getDiff(cursorAngle, Math.PI / 2);
  const devToHorizontal = getDiff(cursorAngle, 0);
  const devToPerp = getDiff(cursorAngle, perpAngle);

  let dimType: 'horizontal' | 'vertical' | 'aligned' = 'aligned';
  let value = len;
  let offset = 0;

  if (devToPerp <= devToVertical && devToPerp <= devToHorizontal) {
    dimType = 'aligned';
    value = len;
    const nx = -dy / len;
    const ny = dx / len;
    offset = (cx - p1.x) * nx + (cy - p1.y) * ny;
  } else if (devToVertical <= devToHorizontal) {
    dimType = 'horizontal';
    value = Math.abs(dx);
    offset = cy - midY;
  } else {
    dimType = 'vertical';
    value = Math.abs(dy);
    offset = cx - midX;
  }

  return { dimType, value, offset };
};

interface PointAnchor {
  type: 'finalPoints' | 'path';
  pathIdx?: number;
  vertexIdx: number;
  isCircleCenter?: boolean;
}

const findAnchorForPointInLayer = (
  pt: { x: number; y: number },
  finalPoints: Point[],
  paths: Point[][]
): PointAnchor | null => {
  const tolerance = 4.0; // Snapping anchor tolerance in mm
  let bestDist = tolerance;
  let bestAnchor: PointAnchor | null = null;

  // 1. Check finalPoints
  finalPoints.forEach((v, idx) => {
    // Check main vertex
    const d1 = Math.hypot(v.x - pt.x, v.y - pt.y);
    if (d1 < bestDist) {
      bestDist = d1;
      bestAnchor = { type: 'finalPoints', vertexIdx: idx };
    }
    // Check circle center
    if (v.circleData) {
      const d2 = Math.hypot(v.circleData.center.x - pt.x, v.circleData.center.y - pt.y);
      if (d2 < bestDist) {
        bestDist = d2;
        bestAnchor = { type: 'finalPoints', vertexIdx: idx, isCircleCenter: true };
      }
    }
  });

  // 2. Check paths
  paths.forEach((path, pathIdx) => {
    path.forEach((v, idx) => {
      // Check main vertex
      const d1 = Math.hypot(v.x - pt.x, v.y - pt.y);
      if (d1 < bestDist) {
        bestDist = d1;
        bestAnchor = { type: 'path', pathIdx, vertexIdx: idx };
      }
      // Check circle center
      if (v.circleData) {
        const d2 = Math.hypot(v.circleData.center.x - pt.x, v.circleData.center.y - pt.y);
        if (d2 < bestDist) {
          bestDist = d2;
          bestAnchor = { type: 'path', pathIdx, vertexIdx: idx, isCircleCenter: true };
        }
      }
    });
  });

  return bestAnchor;
};

const resolveAnchorInLayer = (
  anchor: PointAnchor,
  finalPoints: Point[],
  paths: Point[][]
): { x: number; y: number } | null => {
  if (anchor.type === 'finalPoints') {
    const v = finalPoints[anchor.vertexIdx];
    if (v) {
      if (anchor.isCircleCenter && v.circleData) {
        return { x: v.circleData.center.x, y: v.circleData.center.y };
      }
      return { x: v.x, y: v.y };
    }
  } else if (anchor.type === 'path' && anchor.pathIdx !== undefined) {
    const path = paths[anchor.pathIdx];
    if (path) {
      const v = path[anchor.vertexIdx];
      if (v) {
        if (anchor.isCircleCenter && v.circleData) {
          return { x: v.circleData.center.x, y: v.circleData.center.y };
        }
        return { x: v.x, y: v.y };
      }
    }
  }
  return null;
};

const syncLayerDimensions = (layer: CADLayer): CADLayer => {
  const currentFinalPoints = layer.finalPoints || [];
  const currentPaths = layer.paths || [];
  const dims = layer.dimensions || [];

  const updatedDims = dims.map(d => {
    // 1. If anchor is missing, try to auto-bind it to closest vertex
    let p1Anchor = (d as any).p1Anchor;
    if (!p1Anchor) {
      p1Anchor = findAnchorForPointInLayer(d.p1, currentFinalPoints, currentPaths);
    }
    let p2Anchor = (d as any).p2Anchor;
    if (!p2Anchor) {
      p2Anchor = findAnchorForPointInLayer(d.p2, currentFinalPoints, currentPaths);
    }

    const nextP1 = { ...d.p1 };
    const nextP2 = { ...d.p2 };

    // 2. If anchor is resolved, update position to the new vertex position
    if (p1Anchor) {
      const coord = resolveAnchorInLayer(p1Anchor, currentFinalPoints, currentPaths);
      if (coord) {
        nextP1.x = coord.x;
        nextP1.y = coord.y;
      }
    }
    if (p2Anchor) {
      const coord = resolveAnchorInLayer(p2Anchor, currentFinalPoints, currentPaths);
      if (coord) {
        nextP2.x = coord.x;
        nextP2.y = coord.y;
      }
    }

    // 3. Re-calculate value (distance/delta) dynamically based on updated endpoints
    let nextVal = d.value;
    if (d.dimType === 'horizontal') {
      nextVal = Math.abs(nextP2.x - nextP1.x);
    } else if (d.dimType === 'vertical') {
      nextVal = Math.abs(nextP2.y - nextP1.y);
    } else {
      nextVal = Math.hypot(nextP2.x - nextP1.x, nextP2.y - nextP1.y);
    }

    return {
      ...d,
      p1: nextP1,
      p2: nextP2,
      value: nextVal,
      p1Anchor,
      p2Anchor
    };
  });

  return { ...layer, dimensions: updatedDims };
};

const syncAllLayersDimensions = (layersList: CADLayer[]): CADLayer[] => {
  return layersList.map((l) => {
    return syncLayerDimensions(l);
  });
};

const isColorDark = (color: string): boolean => {
  if (!color) return true;
  if (color.startsWith('#')) {
    const hex = color.substring(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
    } else if (hex.length === 6) {
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
    }
  }
  return true;
};

export default function App() {
  // Layer state
  const [layers, setLayersRaw] = useState<CADLayer[]>([
    {
      id: 'default',
      name: 'Base Plate',
      color: '#10b981', // Emerald
      visible: true,
      locked: false,
      finalPoints: [],
      isClosed: false,
      opType: 'extrude',
      depth: 100,
    },
    {
      id: 'housing',
      name: 'Top Housing',
      color: '#3b82f6', // Indigo Blue
      visible: true,
      locked: false,
      finalPoints: [],
      isClosed: false,
      opType: 'extrude',
      depth: 60,
    },
    {
      id: 'cutouts',
      name: 'Holes & Trim',
      color: '#ef4444', // Red
      visible: true,
      locked: false,
      finalPoints: [],
      isClosed: false,
      opType: 'extrude',
      depth: 125,
    },
  ]);
  const [activeLayerId, setActiveLayerId] = useState<string>('default');

  const setLayers = (val: CADLayer[] | ((prev: CADLayer[]) => CADLayer[])) => {
    setLayersRaw((prev) => {
      const nextLayers = typeof val === 'function' ? val(prev) : val;
      return syncAllLayersDimensions(nextLayers);
    });
  };

  const activeLayer = layers.find((l) => l.id === activeLayerId) || layers[0];
  const finalPoints = activeLayer.finalPoints;
  const isClosed = activeLayer.isClosed;
  const opType = activeLayer.opType;
  const depth = activeLayer.depth;
  const revolveAxis = activeLayer.revolveAxis || 'center';

  const setFinalPoints = (pts: Point[] | ((prev: Point[]) => Point[])) => {
    setLayers((prevLayers) =>
      prevLayers.map((l) => {
        if (l.id === activeLayerId) {
          const newPts = typeof pts === 'function' ? pts(l.finalPoints) : pts;
          return { ...l, finalPoints: newPts };
        }
        return l;
      })
    );
  };

  const setPaths = (val: Point[][] | ((prev: Point[][]) => Point[][])) => {
    setLayers((prevLayers) =>
      prevLayers.map((l) => {
        if (l.id === activeLayerId) {
          const currentPaths = l.paths || [];
          const newPaths = typeof val === 'function' ? val(currentPaths) : val;
          return { ...l, paths: newPaths };
        }
        return l;
      })
    );
  };

  const setIsClosed = (closed: boolean | ((prev: boolean) => boolean)) => {
    setLayers((prevLayers) =>
      prevLayers.map((l) => {
        if (l.id === activeLayerId) {
          const newClosed = typeof closed === 'function' ? closed(l.isClosed) : closed;
          return { ...l, isClosed: newClosed };
        }
        return l;
      })
    );
  };

  const setOpType = (val: 'extrude' | 'revolve') => {
    setLayers((prevLayers) =>
      prevLayers.map((l) => (l.id === activeLayerId ? { ...l, opType: val } : l))
    );
  };

  const setDepth = (val: number | ((prev: number) => number)) => {
    setLayers((prevLayers) =>
      prevLayers.map((l) => {
        if (l.id === activeLayerId) {
          const newDepth = typeof val === 'function' ? val(l.depth) : val;
          return { ...l, depth: newDepth };
        }
        return l;
      })
    );
  };

  const setRevolveAxis = (val: 'left' | 'center' | 'right' | 'origin-y' | 'origin-x') => {
    setLayers((prevLayers) =>
      prevLayers.map((l) => (l.id === activeLayerId ? { ...l, revolveAxis: val } : l))
    );
  };

  const [rawPoints, setRawPoints] = useState<Point[]>([]);
  const [currentCommand, setCurrentCommand] = useState<CommandType>('');
  const [drawMode, setDrawMode] = useState<DrawModeType>('freehand');
  const [clickCount, setClickCount] = useState(0);

  // Selection states for precise dimensions/parametric coordinates editing
  const [selectedVertexIdx, setSelectedVertexIdx] = useState<number | null>(null);
  const [selectedPathIdx, setSelectedPathIdx] = useState<number>(-1); // -1 is finalPoints, otherwise path Index
  
  // Coordinate Reference Positioning state
  const [alignTargetX, setAlignTargetX] = useState<number>(0);
  const [alignTargetY, setAlignTargetY] = useState<number>(0);
  
  // Multi-selection states for robust integrity and dragging multiple entities
  const [selectedPathIndices, setSelectedPathIndices] = useState<number[]>([]);
  const [isFinalPointsSelected, setIsFinalPointsSelected] = useState<boolean>(false);
  const [copiedPaths, setCopiedPaths] = useState<Point[][]>([]);
  const [copiedFinalPoints, setCopiedFinalPoints] = useState<Point[] | null>(null);
  const [rightClickStart, setRightClickStart] = useState<{ x: number; y: number } | null>(null);
  const [rightClickEnd, setRightClickEnd] = useState<{ x: number; y: number } | null>(null);

  // Viewport Settings
  const [viewZoom, setViewZoom] = useState(1.0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [startPanX, setStartPanX] = useState(0);
  const [startPanY, setStartPanY] = useState(0);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number } | null>(null);

  // Snapshot / Guided Snapping state
  const [snapPoint, setSnapPoint] = useState<SnapPoint | null>(null);
  const [trackedLines, setTrackedLines] = useState<TrackLine[]>([]);
  const [tempPoint, setTempPoint] = useState<Point | null>(null);

  // Segment interactive drag (Stretch vs Move) choice
  const [segmentChoicePending, setSegmentChoicePending] = useState<{
    pathIdx: number;
    segmentIdx: number;
    startX: number;
    startY: number;
    originalPoints: Point[];
  } | null>(null);

  const [activeSegmentStretch, setActiveSegmentStretch] = useState<{
    pathIdx: number;
    segmentIdx: number;
    startX: number;
    startY: number;
    originalPoints: Point[];
  } | null>(null);

  const [activeSegmentMove, setActiveSegmentMove] = useState<{
    pathIdx: number;
    startX: number;
    startY: number;
    originalPoints: Point[];
  } | null>(null);

  // Settings
  const [orthoSnap, setOrthoSnap] = useState(false);
  const [smartSnap, setSmartSnap] = useState(true);
  const [gridSnap, setGridSnap] = useState(false);
  const [snapToggles, setSnapToggles] = useState<SnapToggles>({
    origin: true,
    int: true,
    end: true,
    mid: true,
    tan: true,
    quad: true,
    near: true,
    extension: true
  });
  const [customAnchor, setCustomAnchor] = useState<Point | null>(null);
  const [anchorSelectMode, setAnchorSelectMode] = useState(false);
  const [axisMirrorSelectMode, setAxisMirrorSelectMode] = useState(false);
  const [mirrorFirstPoint, setMirrorFirstPoint] = useState<Point | null>(null);
  const [editingSegmentIdx, setEditingSegmentIdx] = useState<number | null>(null);
  const [editingPathIdx, setEditingPathIdx] = useState<number | null>(null);
  const [editingDimensionValue, setEditingDimensionValue] = useState<string>("");
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [showDims, setShowDims] = useState(true);
  const [polygonSides, setPolygonSides] = useState(6);
  const [polygonType, setPolygonType] = useState<'corner' | 'midpoint'>('corner');
  const [showPolygonPrompt, setShowPolygonPrompt] = useState(false);
  const [polygonSidesInput, setPolygonSidesInput] = useState("6");
  const [polygonTypeInput, setPolygonTypeInput] = useState<'corner' | 'midpoint'>('corner');
  const [filletRadius, setFilletRadius] = useState<number>(24);
  const [chamferDistance, setChamferDistance] = useState<number>(20);
  const [offsetDistance, setOffsetDistance] = useState<number>(15);
  const [cadRotateAngle, setCadRotateAngle] = useState<string>("45");
  const [pendingRotateAngle, setPendingRotateAngle] = useState<number | null>(null);
  const [rotationCenter, setRotationCenter] = useState<Point | null>(null);
  const [rotationCenterSelectMode, setRotationCenterSelectMode] = useState<boolean>(false);
  const [cadScaleFactor, setCadScaleFactor] = useState<string>("1.2");
  const [arrayXCount, setArrayXCount] = useState<string>("3");
  const [arrayYCount, setArrayYCount] = useState<string>("1");
  const [arrayXSpacing, setArrayXSpacing] = useState<string>("50");
  const [arrayYSpacing, setArrayYSpacing] = useState<string>("50");
  const [polarCount, setPolarCount] = useState<string>("6");
  const [polarAngle, setPolarAngle] = useState<string>("360");
  const [aiRefinePrompt, setAiRefinePrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [infill, setInfill] = useState<number>(20);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [gridSize, setGridSize] = useState<number>(5);
  const [canvasBgColor, setCanvasBgColor] = useState<string>('#09090b');
  const [movePointSelectMode, setMovePointSelectMode] = useState<'base_point' | 'target_point' | null>(null);
  const [copyPointSelectMode, setCopyPointSelectMode] = useState<'base_point' | 'target_point' | null>(null);
  const [baseSelectionPoint, setBaseSelectionPoint] = useState<Point | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'sketch' | 'layers' | 'dimensions' | '3d'>('sketch');

  // WebForge3D & Technical Drawing Layout integration states
  const [workspaceLayout, setWorkspaceLayout] = useState<'split' | '2d-only' | '3d-only' | 'drawing-sheet'>('split');
  const [sheetTitle, setSheetTitle] = useState<string>("MEKANIK MIL FLÂNŞI");
  const [sheetRevision, setSheetRevision] = useState<string>("REV-02");
  const [sheetMaterial, setSheetMaterial] = useState<string>("Steel"); // Steel, Aluminum, PLA, Oak, Brass, Copper
  const [sheetScaleMultiplier, setSheetScaleMultiplier] = useState<number>(1.0);
  const [sheetNotes, setSheetNotes] = useState<string>("1. Keskin kenarlar pah kırılıp çapaklardan arındırılacaktır.\n2. Tüm ölçüler mm (milimetre) cinsindendir.\n3. Genel toleranslar ISO 2768-m standartlarına uygundur.\n4. Parça yüzey pürüzlülüğü Ra 1.6 mikrometredir.");

  // Active Layer Dimensions accessor helper (fully automated undo-redo integrated!)
  const dimensions = activeLayer.dimensions || [];
  const setDimensions = (val: any[] | ((prev: any[]) => any[])) => {
    setLayers((prevLayers) =>
      prevLayers.map((l) => {
        if (l.id === activeLayerId) {
          const currentDims = l.dimensions || [];
          const newDims = typeof val === 'function' ? val(currentDims) : val;
          return { ...l, dimensions: newDims };
        }
        return l;
      })
    );
  };

  const [dimP1, setDimP1] = useState<Point | null>(null);
  const [dimP2, setDimP2] = useState<Point | null>(null);
  const [selectedDimensionId, setSelectedDimensionId] = useState<string | null>(null);
  const [editingDimensionValueInput, setEditingDimensionValueInput] = useState<string>("");
  const [moveEntireShapeOnDimChange, setMoveEntireShapeOnDimChange] = useState<boolean>(true);
  const [moveEntireShapeOnCoordChange, setMoveEntireShapeOnCoordChange] = useState<boolean>(true);

  // BG Image reference
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [bgOpacity, setBgOpacity] = useState(0.4);

  // History & Command logs
  const [historyStack, setHistoryStack] = useState<HistoryItem[]>([]);
  const [cmdText, setCmdText] = useState('');
  const [cmdLogs, setCmdLogs] = useState<string[]>([
    'CADERIM v14 - Smart Track & Midpoint Snap System online.',
    'Type commands (L: Line, R: Rect, C: Circle, POL: Polygon, F: Fillet, CH: Chamfer, U: Undo, CLEAR: Reset) in Command bar.',
  ]);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragIndexRef = useRef<number>(-1);
  const dragPathIndexRef = useRef<number>(-1);
  const isDrawingRef = useRef(false);
  const triggerStlExportRef = useRef<(() => void) | null>(null);
  const isDraggingSplitRef = useRef<boolean>(false);
  const snapStartTimeRef = useRef<number>(0);
  const dragEntirePathRef = useRef<{
    startX: number;
    startY: number;
    items: Array<{
      type: 'finalPoints' | 'path';
      pathIdx: number;
      originalPoints: Point[];
    }>;
  } | null>(null);

  // Layer methods helper
  const addNewLayer = () => {
    saveState();
    const id = `layer_${Date.now()}`;
    const nextColors = ['#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#14b8a6', '#f43f5e'];
    const chosenColor = nextColors[layers.length % nextColors.length];
    const newLayerObj: CADLayer = {
      id,
      name: `Layer_0${layers.length + 1}`,
      color: chosenColor,
      visible: true,
      locked: false,
      finalPoints: [],
      isClosed: false,
      opType: 'extrude',
      depth: 80,
    };
    setLayers((prev) => [...prev, newLayerObj]);
    setActiveLayerId(id);
    logCommandResponse(`Layer "${newLayerObj.name}" created successfully.`);
  };

  const updateLayerProps = (id: string, props: Partial<CADLayer>) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...props } : l))
    );
  };

  const toggleLayerVisibility = (id: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    );
  };

  const toggleLayerLock = (id: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l))
    );
  };

  const deleteLayer = (id: string) => {
    if (layers.length <= 1) return;
    saveState();
    const layerToDelete = layers.find((l) => l.id === id);
    setLayers((prev) => prev.filter((l) => l.id !== id));
    if (activeLayerId === id) {
      const remaining = layers.filter((l) => l.id !== id);
      setActiveLayerId(remaining[0].id);
    }
    logCommandResponse(`Deleted layer "${layerToDelete?.name || id}".`);
  };

  // Save state helper
  const saveState = (pointsToSave?: Point[], closedToSave?: boolean, clicksToSave: number = clickCount) => {
    const backup: HistoryItem = {
      rawPoints: [...rawPoints],
      layers: JSON.parse(JSON.stringify(layers)),
      activeLayerId,
      clickCount: clicksToSave,
    };
    setHistoryStack((prev) => [...prev.slice(-29), backup]);
  };

  const handleUndo = () => {
    if (historyStack.length === 0) {
      logCommandResponse('Nothing to undo.');
      return;
    }
    const previous = historyStack[historyStack.length - 1];
    setHistoryStack((prev) => prev.slice(0, -1));
    setRawPoints(previous.rawPoints);
    setLayers(previous.layers);
    setActiveLayerId(previous.activeLayerId);
    setClickCount(previous.clickCount);
    setTempPoint(null);
    logCommandResponse('Undo executed successfully.');
  };

  // Compute bounding box center
  const getSelectedCenter = (points: Point[]): Point => {
    if (points.length === 0) return { x: 0, y: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    return {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    };
  };

  // CAD EDIT CODES
  const applyCadEditCopy = () => {
    saveState();
    let copiedCount = 0;
    const offsetVal = 15; // +15mm standard default CAD offset for visible duplicates

    // Copy active path (finalPoints)
    if (isFinalPointsSelected && finalPoints.length > 0) {
      const duplicated = finalPoints.map((p) => {
        const u: Point = { ...p, x: p.x + offsetVal, y: p.y + offsetVal };
        if (p.circleData) {
          u.circleData = {
            center: { x: p.circleData.center.x + offsetVal, y: p.circleData.center.y + offsetVal },
            radius: p.circleData.radius
          };
        }
        return u;
      });
      setPaths((prev) => [...prev, duplicated]);
      copiedCount++;
    }

    // Copy secondary completed paths
    if (selectedPathIndices.length > 0 && activeLayer.paths) {
      const newPaths = [...activeLayer.paths];
      const newlyCreatedIndices: number[] = [];
      selectedPathIndices.forEach((idx) => {
        const path = activeLayer.paths?.[idx];
        if (path) {
          const duplicated = path.map((p) => {
            const u: Point = { ...p, x: p.x + offsetVal, y: p.y + offsetVal };
            if (p.circleData) {
              u.circleData = {
                center: { x: p.circleData.center.x + offsetVal, y: p.circleData.center.y + offsetVal },
                radius: p.circleData.radius
              };
            }
            return u;
          });
          newPaths.push(duplicated);
          newlyCreatedIndices.push(newPaths.length - 1);
          copiedCount++;
        }
      });
      setPaths(newPaths);
      setSelectedPathIndices(newlyCreatedIndices);
      setIsFinalPointsSelected(false);
    }

    if (copiedCount > 0) {
      logCommandResponse(`Kopyalandı: ${copiedCount} adet obje kopyalandı ve +15mm kaydırıldı.`);
    } else {
      logCommandResponse("Kopyalanacak seçili bir şekil bulunamadı! Lütfen bir şekle tıklayarak veya sağ tıklama kutusuyla seçerek kopyalamayı deneyin.");
    }
  };

  const applyCadEditDelete = () => {
    saveState();
    let deletedCount = 0;

    if (isFinalPointsSelected && finalPoints.length > 0) {
      setFinalPoints([]);
      setIsClosed(false);
      deletedCount++;
    }

    if (selectedPathIndices.length > 0 && activeLayer.paths) {
      const newPaths = activeLayer.paths.filter((_, idx) => !selectedPathIndices.includes(idx));
      setPaths(newPaths);
      deletedCount += selectedPathIndices.length;
    }

    // Reset selection states
    setIsFinalPointsSelected(false);
    setSelectedPathIndices([]);
    setSelectedPathIdx(-1);
    setSelectedVertexIdx(null);

    if (deletedCount > 0) {
      logCommandResponse(`Silindi: Seçili ${deletedCount} adet obje temizlendi.`);
    } else {
      logCommandResponse("Silinecek seçili bir obje bulunamadı.");
    }
  };

  const getSelectedShapeGroupStatus = (): 'joined' | 'independent' | 'none' => {
    if (!isFinalPointsSelected && selectedPathIndices.length === 0 && selectedPathIdx === -1) {
      return 'none';
    }
    const idx = selectedPathIdx !== -1 ? selectedPathIdx : (isFinalPointsSelected ? -1 : (selectedPathIndices.length > 0 ? selectedPathIndices[0] : -1));
    if (idx === -1 && !isFinalPointsSelected) return 'none';

    let gId = '';
    if (idx === -1) {
      gId = activeLayer.finalPointsSettings?.groupId || '';
    } else {
      gId = activeLayer.pathSettings?.[idx]?.groupId || '';
    }

    if (gId.startsWith('independent_')) {
      return 'independent';
    }
    return 'joined';
  };

  const handleSeparateFromSketch = () => {
    saveState();
    
    // We want to make the selected path(s) independent
    // A path is independent if we give it a unique groupId prefix with 'independent_'
    const makeIndependent = (idx: number, l: CADLayer) => {
      const independentGroupId = 'independent_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      if (idx === -1) {
        const currentSettings = l.finalPointsSettings || {
          opType: l.opType || 'extrude',
          depth: l.depth || 30,
          revolveAxis: l.revolveAxis || 'center',
          booleanType: 'union'
        };
        l.finalPointsSettings = { ...currentSettings, groupId: independentGroupId };
      } else {
        const settingsArray = [...(l.pathSettings || [])];
        const pathCount = l.paths ? l.paths.length : 0;
        while (settingsArray.length < pathCount) {
          settingsArray.push({
            opType: l.opType || 'extrude',
            depth: l.depth || 30,
            revolveAxis: l.revolveAxis || 'center',
            booleanType: 'union'
          });
        }
        const currentSettings = settingsArray[idx] || {
          opType: l.opType || 'extrude',
          depth: l.depth || 30,
          revolveAxis: l.revolveAxis || 'center',
          booleanType: 'union'
        };
        settingsArray[idx] = { ...currentSettings, groupId: independentGroupId };
        l.pathSettings = settingsArray;
      }
    };

    const cloned = JSON.parse(JSON.stringify(activeLayer)) as CADLayer;
    let separatedCount = 0;
    if (isFinalPointsSelected) {
      makeIndependent(-1, cloned);
      separatedCount++;
    }
    
    selectedPathIndices.forEach(idx => {
      makeIndependent(idx, cloned);
      separatedCount++;
    });

    if (separatedCount === 0 && selectedPathIdx !== -1) {
      makeIndependent(selectedPathIdx, cloned);
      separatedCount++;
    }

    setLayers(prev => prev.map(l => l.id === activeLayerId ? cloned : l));

    // Reset selection to just the targeted index so the user doesn't drag other things anymore (since they are now separated!)
    if (selectedPathIdx !== -1) {
      if (selectedPathIdx === -1) {
        setIsFinalPointsSelected(true);
        setSelectedPathIndices([]);
      } else {
        setIsFinalPointsSelected(false);
        setSelectedPathIndices([selectedPathIdx]);
      }
    }

    logCommandResponse(`Sketçten Ayrıldı: Seçili parça(lar) ana sketç bütünlüğünden ayrıldı ve bağımsız hale getirildi. Artık bağımsız olarak hareket ettirebilirsiniz.`);
  };

  const handleJoinToSketch = () => {
    saveState();
    const defaultGrp = 'main_group_' + activeLayerId;

    const makeJoined = (idx: number, l: CADLayer) => {
      if (idx === -1) {
        const currentSettings = l.finalPointsSettings || {
          opType: l.opType || 'extrude',
          depth: l.depth || 30,
          revolveAxis: l.revolveAxis || 'center',
          booleanType: 'union'
        };
        l.finalPointsSettings = { ...currentSettings, groupId: defaultGrp };
      } else {
        const settingsArray = [...(l.pathSettings || [])];
        const pathCount = l.paths ? l.paths.length : 0;
        while (settingsArray.length < pathCount) {
          settingsArray.push({
            opType: l.opType || 'extrude',
            depth: l.depth || 30,
            revolveAxis: l.revolveAxis || 'center',
            booleanType: 'union'
          });
        }
        const currentSettings = settingsArray[idx] || {
          opType: l.opType || 'extrude',
          depth: l.depth || 30,
          revolveAxis: l.revolveAxis || 'center',
          booleanType: 'union'
        };
        settingsArray[idx] = { ...currentSettings, groupId: defaultGrp };
        l.pathSettings = settingsArray;
      }
    };

    const cloned = JSON.parse(JSON.stringify(activeLayer)) as CADLayer;
    let joinedCount = 0;
    if (isFinalPointsSelected) {
      makeJoined(-1, cloned);
      joinedCount++;
    }
    
    selectedPathIndices.forEach(idx => {
      makeJoined(idx, cloned);
      joinedCount++;
    });

    if (joinedCount === 0 && selectedPathIdx !== -1) {
      makeJoined(selectedPathIdx, cloned);
      joinedCount++;
    }

    setLayers(prev => prev.map(l => l.id === activeLayerId ? cloned : l));

    // Trigger full group selection synchronously using the updated cloned layer
    const resolvedGroup = getJoinedIndices(selectedPathIdx !== -1 ? selectedPathIdx : -1, cloned);
    setIsFinalPointsSelected(resolvedGroup.selectFinalPoints);
    setSelectedPathIndices(resolvedGroup.selectPathIndices);

    logCommandResponse(`Sketçe Bağlandı: Parçalar ana sketç gövdesiyle birleştirildi. Bütünlük sağlandı.`);
  };

  const handleCopy = () => {
    let copiedCount = 0;
    const items: Point[][] = [];
    let fpItem: Point[] | null = null;

    if (isFinalPointsSelected && finalPoints.length > 0) {
      fpItem = finalPoints.map(p => ({ ...p }));
      copiedCount++;
    }

    if (selectedPathIndices.length > 0 && activeLayer.paths) {
      selectedPathIndices.forEach(idx => {
        const path = activeLayer.paths?.[idx];
        if (path) {
          items.push(path.map(p => ({ ...p })));
          copiedCount++;
        }
      });
    }

    if (copiedCount > 0) {
      setCopiedPaths(items);
      setCopiedFinalPoints(fpItem);
      logCommandResponse(`Kopyalandı: ${copiedCount} adet obje kopyalandı (Panoya alındı). Yapıştırmak için Ctrl + V kullanabilirsiniz.`);
    } else {
      logCommandResponse("Kopyalamak için önce bir şekle tıklayarak seçmelisiniz.");
    }
  };

  const handlePaste = () => {
    saveState();
    let pastedCount = 0;
    const offsetVal = 15; // default slide offset if there is no mouse hover
    
    let dx = offsetVal;
    let dy = offsetVal;

    // Use current hover coordinates (mouse center placement) if hover coordinates are active!
    if (hoverCoords && (copiedPaths.length > 0 || copiedFinalPoints)) {
      // Find total bounding box center of copied paths & final points
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      const allCopiedPts: Point[] = [];
      if (copiedFinalPoints) allCopiedPts.push(...copiedFinalPoints);
      copiedPaths.forEach(path => allCopiedPts.push(...path));
      
      allCopiedPts.forEach(p => {
        if (p.circleData) {
          minX = Math.min(minX, p.circleData.center.x - p.circleData.radius);
          maxX = Math.max(maxX, p.circleData.center.x + p.circleData.radius);
          minY = Math.min(minY, p.circleData.center.y - p.circleData.radius);
          maxY = Math.max(maxY, p.circleData.center.y + p.circleData.radius);
        } else {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      });
      
      if (minX !== Infinity) {
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        dx = hoverCoords.x - centerX;
        dy = hoverCoords.y - centerY;
      }
    }

    if (copiedFinalPoints && copiedFinalPoints.length > 0) {
      const translated = copiedFinalPoints.map(p => {
        const u = { ...p, x: p.x + dx, y: p.y + dy };
        if (p.circleData) {
          u.circleData = {
            center: { x: p.circleData.center.x + dx, y: p.circleData.center.y + dy },
            radius: p.circleData.radius
          };
        }
        return u;
      });
      setFinalPoints(translated);
      setIsFinalPointsSelected(true);
      pastedCount++;
    }

    if (copiedPaths.length > 0 && activeLayer.paths) {
      const newPaths = [...activeLayer.paths];
      const newlyCreatedIndices: number[] = [];
      copiedPaths.forEach(path => {
        const translated = path.map(p => {
          const u = { ...p, x: p.x + dx, y: p.y + dy };
          if (p.circleData) {
            u.circleData = {
              center: { x: p.circleData.center.x + dx, y: p.circleData.center.y + dy },
              radius: p.circleData.radius
            };
          }
          return u;
        });
        newPaths.push(translated);
        newlyCreatedIndices.push(newPaths.length - 1);
        pastedCount++;
      });
      setPaths(newPaths);
      setSelectedPathIndices(newlyCreatedIndices);
      setIsFinalPointsSelected(false);
    }

    if (pastedCount > 0) {
      logCommandResponse(`Yapıştırıldı: ${pastedCount} adet obje yeni pozisyona başarıyla yerleştirildi.`);
    } else {
      logCommandResponse("Pano boş! Kopyalanmış bir şekil bulunamadı.");
    }
  };

  const handleApplyDimensionValue = (dimId: string, targetValue: number) => {
    saveState();
    
    // Find the dimension to change
    const dim = (activeLayer.dimensions || []).find(d => d.id === dimId);
    if (!dim) return;

    const p1 = dim.p1;
    const p2 = dim.p2;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const currentDist = Math.hypot(dx, dy);

    if (currentDist < 0.001) {
      logCommandResponse("Hata: Başlangıç ve bitiş noktası çakışık olduğundan konumlandırma yönü belirlenemedi.");
      return;
    }

    // Resolve anchors or find closest
    let closestP1: { type: 'finalPoints' | 'paths'; pathIdx: number; ptIdx: number; dist: number } | null = null;
    let closestP2: { type: 'finalPoints' | 'paths'; pathIdx: number; ptIdx: number; dist: number } | null = null;

    let p1Anchor = (dim as any).p1Anchor;
    let p2Anchor = (dim as any).p2Anchor;

    if (p1Anchor) {
      closestP1 = {
        type: p1Anchor.type === 'finalPoints' ? 'finalPoints' : 'paths',
        pathIdx: p1Anchor.type === 'finalPoints' ? -1 : (p1Anchor.pathIdx ?? -1),
        ptIdx: p1Anchor.vertexIdx,
        dist: 0
      };
    } else {
      let minD1 = Infinity;
      finalPoints.forEach((pt, ptIdx) => {
        const d = Math.hypot(pt.x - p1.x, pt.y - p1.y);
        if (d < minD1) {
          minD1 = d;
          closestP1 = { type: 'finalPoints', pathIdx: -1, ptIdx, dist: d };
        }
      });
      if (activeLayer.paths) {
        activeLayer.paths.forEach((path, pathIdx) => {
          path.forEach((pt, ptIdx) => {
            const d = Math.hypot(pt.x - p1.x, pt.y - p1.y);
            if (d < minD1) {
              minD1 = d;
              closestP1 = { type: 'paths', pathIdx, ptIdx, dist: d };
            }
          });
        });
      }
    }

    if (p2Anchor) {
      closestP2 = {
        type: p2Anchor.type === 'finalPoints' ? 'finalPoints' : 'paths',
        pathIdx: p2Anchor.type === 'finalPoints' ? -1 : (p2Anchor.pathIdx ?? -1),
        ptIdx: p2Anchor.vertexIdx,
        dist: 0
      };
    } else {
      let minD2 = Infinity;
      finalPoints.forEach((pt, ptIdx) => {
        const d = Math.hypot(pt.x - p2.x, pt.y - p2.y);
        if (d < minD2) {
          minD2 = d;
          closestP2 = { type: 'finalPoints', pathIdx: -1, ptIdx, dist: d };
        }
      });
      if (activeLayer.paths) {
        activeLayer.paths.forEach((path, pathIdx) => {
          path.forEach((pt, ptIdx) => {
            const d = Math.hypot(pt.x - p2.x, pt.y - p2.y);
            if (d < minD2) {
              minD2 = d;
              closestP2 = { type: 'paths', pathIdx, ptIdx, dist: d };
            }
          });
        });
      }
    }

    // Decide which point of the dimension to move (movePoint: 'p1' or 'p2')
    // A point is near a shape node if its distance is within a generous limit or has a saved anchor.
    const snapMatchThreshold = 25.0; 
    let movePoint: 'p1' | 'p2' = 'p2';

    const isP1NearShape = closestP1 && (p1Anchor || closestP1.dist < snapMatchThreshold);
    const isP2NearShape = closestP2 && (p2Anchor || closestP2.dist < snapMatchThreshold);

    if (isP1NearShape && isP2NearShape) {
      // Both are near shape nodes
      if (closestP1!.type === 'finalPoints' && closestP2!.type === 'paths') {
        movePoint = 'p2'; // Keep finalPoints (main body outline) fixed, move inner cutout!
      } else if (closestP1!.type === 'paths' && closestP2!.type === 'finalPoints') {
        movePoint = 'p1'; // Keep finalPoints (main body outline) fixed, move inner cutout!
      } else {
        // If both on different inner paths or same paths/finalPoints, default to p2
        movePoint = 'p2';
      }
    } else if (isP1NearShape && !isP2NearShape) {
      // p1 is near shape, p2 is a reference coordinate (like origin / axis snap)
      if (closestP1!.type === 'finalPoints') {
        // If p1 is on the main perimeter (finalPoints) and p2 is coordinate target,
        // we must be very careful not to shift the whole drawing if not requested!
        // But if it's explicitly horizontal/vertical alignment relative to origin, users move p1.
        movePoint = 'p1';
      } else {
        movePoint = 'p1'; // Move inner cutout node
      }
    } else if (!isP1NearShape && isP2NearShape) {
      // p2 is near shape, p1 is a coordinate reference
      if (closestP2!.type === 'finalPoints') {
        movePoint = 'p2';
      } else {
        movePoint = 'p2'; // Move inner cutout node
      }
    } else {
      // Neither is close geographically. Move whichever has closer distance.
      const d1 = closestP1 ? closestP1.dist : Infinity;
      const d2 = closestP2 ? closestP2.dist : Infinity;
      movePoint = d1 < d2 ? 'p1' : 'p2';
    }

    const targetPt = movePoint === 'p2' ? p2 : p1;
    const anchorPt = movePoint === 'p2' ? p1 : p2;
    const closestNodeInfo = movePoint === 'p2' ? closestP2 : closestP1;

    // Vector from fixed anchorPt to movable targetPt
    const vdx = targetPt.x - anchorPt.x;
    const vdy = targetPt.y - anchorPt.y;
    const vdist = Math.hypot(vdx, vdy);

    if (vdist < 0.001) {
      logCommandResponse("Hata: Başlangıç ve bitiş noktası çakışık olduğundan konumlandırma yönü belirlenemedi.");
      return;
    }

    const dType = dim.dimType || 'aligned';
    let finalTargetX = targetPt.x;
    let finalTargetY = targetPt.y;

    if (dType === 'horizontal') {
      const direction = Math.sign(targetPt.x - anchorPt.x) || 1;
      finalTargetX = anchorPt.x + direction * targetValue;
      finalTargetY = targetPt.y;
    } else if (dType === 'vertical') {
      const direction = Math.sign(targetPt.y - anchorPt.y) || 1;
      finalTargetY = anchorPt.y + direction * targetValue;
      finalTargetX = targetPt.x;
    } else {
      // aligned
      const vux = vdx / vdist;
      const vuy = vdy / vdist;
      finalTargetX = anchorPt.x + vux * targetValue;
      finalTargetY = anchorPt.y + vuy * targetValue;
    }

    const shiftX = finalTargetX - targetPt.x;
    const shiftY = finalTargetY - targetPt.y;

    const isEdgeDimension = isP1NearShape && isP2NearShape &&
      closestP1.type === closestP2.type &&
      (closestP1.type === 'finalPoints' || closestP1.pathIdx === closestP2.pathIdx);

    if (isEdgeDimension) {
      let shapePoints: Point[] = [];
      if (closestP1.type === 'finalPoints') {
        shapePoints = finalPoints;
      } else if (activeLayer.paths) {
        shapePoints = activeLayer.paths[closestP1.pathIdx];
      }

      const v1 = shapePoints[closestP1.ptIdx];
      const v2 = shapePoints[closestP2.ptIdx];
      const polyData = (v1?.polygonData) || (v2?.polygonData);
      const circleData = (v1?.circleData) || (v2?.circleData);

      const scaleFactor = targetValue / currentDist;

      let polyId = polyData?.id;
      if (polyId) {
        const center = polyData.center;
        const updatePoints = (prev: Point[]) => {
          return prev.map(pt => {
            if (pt.polygonData?.id === polyId) {
              const ncx = center.x + (pt.x - center.x) * scaleFactor;
              const ncy = center.y + (pt.y - center.y) * scaleFactor;
              return {
                ...pt,
                x: ncx,
                y: ncy,
                polygonData: {
                  ...pt.polygonData,
                  center: { ...center },
                  radius: pt.polygonData.radius * scaleFactor
                }
              };
            }
            return pt;
          });
        };

        if (closestP1.type === 'finalPoints') {
          setFinalPoints(updatePoints);
        } else {
          const targetPathIdx = closestP1.pathIdx;
          setPaths(prev => prev.map((path, idx) => idx === targetPathIdx ? updatePoints(path) : path));
        }
        logCommandResponse(`Kenar Boyutlandırma: Çokgen kenarı ${targetValue.toFixed(1)} mm olarak ayarlandı, tüm çokgen orantılı ölçeklendi.`);
      } else if (circleData) {
        const center = circleData.center;
        const updatePoints = (prev: Point[]) => {
          return prev.map(pt => {
            if (pt.circleData) {
              const ncx = center.x + (pt.x - center.x) * scaleFactor;
              const ncy = center.y + (pt.y - center.y) * scaleFactor;
              return {
                ...pt,
                x: ncx,
                y: ncy,
                circleData: {
                  center: { ...center },
                  radius: pt.circleData.radius * scaleFactor
                }
              };
            }
            return pt;
          });
        };

        if (closestP1.type === 'finalPoints') {
          setFinalPoints(updatePoints);
        } else {
          const targetPathIdx = closestP1.pathIdx;
          setPaths(prev => prev.map((path, idx) => idx === targetPathIdx ? updatePoints(path) : path));
        }
        logCommandResponse(`Kenar Boyutlandırma: Çember boyutu ${targetValue.toFixed(1)} mm olarak ayarlandı.`);
      } else {
        // Generic segment/vector stretch: move only targetPt to finalTargetX, finalTargetY
        const updateSinglePoint = (prev: Point[]) => {
          const updated = prev.map((pt, i) => {
            if (i === closestNodeInfo.ptIdx) {
              return { ...pt, x: finalTargetX, y: finalTargetY };
            }
            return pt;
          });
          if (updated.length > 2) {
            if (closestNodeInfo.ptIdx === 0) {
              updated[updated.length - 1] = { ...updated[0] };
            } else if (closestNodeInfo.ptIdx === updated.length - 1) {
              updated[0] = { ...updated[updated.length - 1] };
            }
          }
          return updated;
        };

        if (closestP1.type === 'finalPoints') {
          setFinalPoints(updateSinglePoint);
        } else {
          const targetPathIdx = closestP1.pathIdx;
          setPaths(prev => prev.map((path, idx) => idx === targetPathIdx ? updateSinglePoint(path) : path));
        }
        logCommandResponse(`Kenar Boyutlandırma: Çizgi boyutu ${targetValue.toFixed(1)} mm olarak ayarlandı.`);
      }

      // Update dimensions
      setDimensions(prev => prev.map(d => {
        let up1 = { ...d.p1 };
        let up2 = { ...d.p2 };
        const dType = d.dimType || 'aligned';

        if (d.id === dimId) {
          if (movePoint === 'p2') {
            up2 = { ...p2, x: finalTargetX, y: finalTargetY };
          } else {
            up1 = { ...p1, x: finalTargetX, y: finalTargetY };
          }
          let newLen = Math.hypot(up2.x - up1.x, up2.y - up1.y);
          if (dType === 'horizontal') {
            newLen = Math.abs(up2.x - up1.x);
          } else if (dType === 'vertical') {
            newLen = Math.abs(up2.y - up1.y);
          }
          return {
            ...d,
            p1: up1,
            p2: up2,
            value: newLen
          };
        } else {
          if (Math.hypot(d.p1.x - targetPt.x, d.p1.y - targetPt.y) < 1.5) {
            up1 = { ...d.p1, x: finalTargetX, y: finalTargetY };
          }
          if (Math.hypot(d.p2.x - targetPt.x, d.p2.y - targetPt.y) < 1.5) {
            up2 = { ...d.p2, x: finalTargetX, y: finalTargetY };
          }
          let newLen = Math.hypot(up2.x - up1.x, up2.y - up1.y);
          if (dType === 'horizontal') {
            newLen = Math.abs(up2.x - up1.x);
          } else if (dType === 'vertical') {
            newLen = Math.abs(up2.y - up1.y);
          }
          return {
            ...d,
            p1: up1,
            p2: up2,
            value: newLen
          };
        }
      }));

      setSelectedDimensionId(null);
      return;
    }

    const shiftedOriginalPoints: Point[] = [];
    if (closestNodeInfo) {
      const node: any = closestNodeInfo;
      if (node.type === 'finalPoints') {
        shiftedOriginalPoints.push(...finalPoints);
      } else if (node.type === 'paths' && activeLayer.paths) {
        shiftedOriginalPoints.push(...activeLayer.paths[node.pathIdx]);
      }
    }

    if (moveEntireShapeOnDimChange && closestNodeInfo) {
      const node: any = closestNodeInfo;
      if (node.type === 'finalPoints') {
        // Shift entire finalPoints
        setFinalPoints(prev => {
          return prev.map(pt => {
            const u = { ...pt, x: pt.x + shiftX, y: pt.y + shiftY };
            if (pt.circleData) {
              u.circleData = {
                center: { x: pt.circleData.center.x + shiftX, y: pt.circleData.center.y + shiftY },
                radius: pt.circleData.radius
              };
            }
            return u;
          });
        });
        logCommandResponse(`Konumlandırma: Çizim şekli ${targetValue.toFixed(1)} mm olarak konumlandırıldı.`);
      } else if (node.type === 'paths' && activeLayer.paths) {
        // Shift entire path elements of the matching path idx
        const targetPathIdx = node.pathIdx;
        setPaths(prev => {
          return prev.map((path, idx) => {
            if (idx === targetPathIdx) {
              return path.map(pt => {
                const u = { ...pt, x: pt.x + shiftX, y: pt.y + shiftY };
                if (pt.circleData) {
                  u.circleData = {
                    center: { x: pt.circleData.center.x + shiftX, y: pt.circleData.center.y + shiftY },
                    radius: pt.circleData.radius
                  };
                }
                return u;
              });
            }
            return path;
          });
        });
        logCommandResponse(`Konumlandırma: Şekil #${targetPathIdx + 1} ${targetValue.toFixed(1)} mm olarak konumlandırıldı.`);
      }
    } else if (closestNodeInfo) {
      // Move single point only
      const node: any = closestNodeInfo;
      if (node.type === 'finalPoints') {
        setFinalPoints(prev => prev.map((pt, i) => i === node.ptIdx ? { ...pt, x: finalTargetX, y: finalTargetY } : pt));
      } else if (node.type === 'paths' && activeLayer.paths) {
        setPaths(prev => prev.map((path, pIdx) => pIdx === node.pathIdx ? path.map((pt, i) => i === node.ptIdx ? { ...pt, x: finalTargetX, y: finalTargetY } : pt) : path));
      }
      logCommandResponse(`Konumlandırma: Tek nokta ${targetValue.toFixed(1)} mm olarak ayarlandı.`);
    } else {
      logCommandResponse("Konumlandırma yapılamadı: Ölçü noktasına yakın çizim düğümü bulunamadı.");
    }

    // Update dimensions share endpoints coordinates
    setDimensions(prev => prev.map(d => {
      let up1 = { ...d.p1 };
      let up2 = { ...d.p2 };
      const dType = d.dimType || 'aligned';

      if (d.id === dimId) {
        // Active dimension
        if (movePoint === 'p2') {
          up2 = { ...p2, x: finalTargetX, y: finalTargetY };
          if (moveEntireShapeOnDimChange) {
            const isP1OnMovedShape = shiftedOriginalPoints.some(pt => Math.hypot(pt.x - p1.x, pt.y - p1.y) < 2.0);
            if (isP1OnMovedShape) {
              up1 = { ...p1, x: p1.x + shiftX, y: p1.y + shiftY };
            }
          }
        } else {
          up1 = { ...p1, x: finalTargetX, y: finalTargetY };
          if (moveEntireShapeOnDimChange) {
            const isP2OnMovedShape = shiftedOriginalPoints.some(pt => Math.hypot(pt.x - p2.x, pt.y - p2.y) < 2.0);
            if (isP2OnMovedShape) {
              up2 = { ...p2, x: p2.x + shiftX, y: p2.y + shiftY };
            }
          }
        }
        let newLen = Math.hypot(up2.x - up1.x, up2.y - up1.y);
        if (dType === 'horizontal') {
          newLen = Math.abs(up2.x - up1.x);
        } else if (dType === 'vertical') {
          newLen = Math.abs(up2.y - up1.y);
        }
        return {
          ...d,
          p1: up1,
          p2: up2,
          value: newLen
        };
      } else {
        // Other dimensions: shift their endpoints if they are attached to the moved shape
        if (moveEntireShapeOnDimChange) {
          const isP1OnMovedShape = shiftedOriginalPoints.some(pt => Math.hypot(pt.x - d.p1.x, pt.y - d.p1.y) < 2.0);
          if (isP1OnMovedShape) {
            up1 = { ...d.p1, x: d.p1.x + shiftX, y: d.p1.y + shiftY };
          }
          const isP2OnMovedShape = shiftedOriginalPoints.some(pt => Math.hypot(pt.x - d.p2.x, pt.y - d.p2.y) < 2.0);
          if (isP2OnMovedShape) {
            up2 = { ...d.p2, x: d.p2.x + shiftX, y: d.p2.y + shiftY };
          }
        } else {
          if (Math.hypot(d.p1.x - targetPt.x, d.p1.y - targetPt.y) < 1.5) {
            up1 = { ...d.p1, x: finalTargetX, y: finalTargetY };
          }
          if (Math.hypot(d.p2.x - targetPt.x, d.p2.y - targetPt.y) < 1.5) {
            up2 = { ...d.p2, x: finalTargetX, y: finalTargetY };
          }
        }
        let newLen = Math.hypot(up2.x - up1.x, up2.y - up1.y);
        if (dType === 'horizontal') {
          newLen = Math.abs(up2.x - up1.x);
        } else if (dType === 'vertical') {
          newLen = Math.abs(up2.y - up1.y);
        }
        return {
          ...d,
          p1: up1,
          p2: up2,
          value: newLen
        };
      }
    }));

    setSelectedDimensionId(null);
  };

  const handleDeleteDimension = (dimId: string) => {
    saveState();
    setDimensions(prev => prev.filter(d => d.id !== dimId));
    setSelectedDimensionId(null);
    logCommandResponse("Ölçülendirme silindi.");
  };

  const applyCadEditMirror = (axis: 'X' | 'Y') => {
    saveState();
    let modified = false;

    const mirrorPoints = (points: Point[]): Point[] => {
      const center = customAnchor ? customAnchor : getSelectedCenter(points);
      return points.map((p) => {
        let newX = p.x;
        let newY = p.y;
        if (axis === 'Y') {
          newX = center.x - (p.x - center.x);
        } else {
          newY = center.y - (p.y - center.y);
        }
        const u: Point = { ...p, x: newX, y: newY };
        if (p.circleData) {
          let cx = p.circleData.center.x;
          let cy = p.circleData.center.y;
          if (axis === 'Y') {
            cx = center.x - (p.circleData.center.x - center.x);
          } else {
            cy = center.y - (p.circleData.center.y - center.y);
          }
          u.circleData = {
            center: { x: cx, y: cy },
            radius: p.circleData.radius
          };
        }
        if (p.polygonData) {
          let cx = p.polygonData.center.x;
          let cy = p.polygonData.center.y;
          if (axis === 'Y') {
            cx = center.x - (p.polygonData.center.x - center.x);
          } else {
            cy = center.y - (p.polygonData.center.y - center.y);
          }
          u.polygonData = {
            ...p.polygonData,
            center: { x: cx, y: cy }
          };
        }
        return u;
      });
    };

    if (isFinalPointsSelected && finalPoints.length > 0) {
      setFinalPoints(mirrorPoints(finalPoints));
      modified = true;
    }

    if (selectedPathIndices.length > 0 && activeLayer.paths) {
      const updatedPaths = [...activeLayer.paths];
      selectedPathIndices.forEach((idx) => {
        if (updatedPaths[idx]) {
          updatedPaths[idx] = mirrorPoints(updatedPaths[idx]);
        }
      });
      setPaths(updatedPaths);
      modified = true;
    }

    if (modified) {
      logCommandResponse(`${axis === 'Y' ? 'Y-Eksenine (Yatay)' : 'X-Eksenine (Dikey)'} Göre Aynalandı.`);
    } else {
      logCommandResponse("Aynalanacak seçili çizgi veya poligon bulunamadı.");
    }
  };

  const applyCadEditMirrorAcrossLine = (p1: Point, p2: Point) => {
    saveState();
    let modified = false;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.0001) {
      logCommandResponse("Ayna doğrusu sıfır uzunlukta olamaz.");
      return;
    }

    const mirrorPoints = (points: Point[]): Point[] => {
      return points.map((p) => {
        const t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / lenSq;
        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;
        const newX = 2 * projX - p.x;
        const newY = 2 * projY - p.y;
        const u: Point = { ...p, x: newX, y: newY };
        if (p.circleData) {
          const cx = p.circleData.center.x;
          const cy = p.circleData.center.y;
          const tc = ((cx - p1.x) * dx + (cy - p1.y) * dy) / lenSq;
          const cProjX = p1.x + tc * dx;
          const cProjY = p1.y + tc * dy;
          u.circleData = {
            center: {
              x: 2 * cProjX - cx,
              y: 2 * cProjY - cy
            },
            radius: p.circleData.radius
          };
        }
        if (p.polygonData) {
          const cx = p.polygonData.center.x;
          const cy = p.polygonData.center.y;
          const tc = ((cx - p1.x) * dx + (cy - p1.y) * dy) / lenSq;
          const cProjX = p1.x + tc * dx;
          const cProjY = p1.y + tc * dy;
          u.polygonData = {
            ...p.polygonData,
            center: {
              x: 2 * cProjX - cx,
              y: 2 * cProjY - cy
            }
          };
        }
        return u;
      });
    };

    if (isFinalPointsSelected && finalPoints.length > 0) {
      setFinalPoints(mirrorPoints(finalPoints));
      modified = true;
    }

    if (selectedPathIndices.length > 0 && activeLayer.paths) {
      const updatedPaths = [...activeLayer.paths];
      selectedPathIndices.forEach((idx) => {
        if (updatedPaths[idx]) {
          updatedPaths[idx] = mirrorPoints(updatedPaths[idx]);
        }
      });
      setPaths(updatedPaths);
      modified = true;
    }

    if (modified) {
      logCommandResponse("Seçili nesneler belirlenen eksene göre aynalandı.");
    } else {
      logCommandResponse("Aynalanacak seçili çizgi veya poligon bulunamadı.");
    }
  };

  const findClosestSegment = (pt: Point, currentZoom: number) => {
    let closestSeg: { p1: Point; p2: Point } | null = null;
    let minDist = 18 / currentZoom; // Threshold in virtual units

    if (finalPoints.length > 1) {
      for (let i = 0; i < finalPoints.length - 1; i++) {
        const p1 = finalPoints[i];
        const p2 = finalPoints[i + 1];
        const proj = getClosestPointOnSegment(pt, p1, p2);
        const d = Math.hypot(proj.x - pt.x, proj.y - pt.y);
        if (d < minDist) {
          minDist = d;
          closestSeg = { p1, p2 };
        }
      }
      if (isClosed && finalPoints.length > 2) {
        const p1 = finalPoints[finalPoints.length - 1];
        const p2 = finalPoints[0];
        const proj = getClosestPointOnSegment(pt, p1, p2);
        const d = Math.hypot(proj.x - pt.x, proj.y - pt.y);
        if (d < minDist) {
          minDist = d;
          closestSeg = { p1, p2 };
        }
      }
    }

    if (activeLayer.paths) {
      activeLayer.paths.forEach(path => {
        if (path.length > 1) {
          for (let i = 0; i < path.length - 1; i++) {
            const p1 = path[i];
            const p2 = path[i + 1];
            const proj = getClosestPointOnSegment(pt, p1, p2);
            const d = Math.hypot(proj.x - pt.x, proj.y - pt.y);
            if (d < minDist) {
              minDist = d;
              closestSeg = { p1, p2 };
            }
          }
        }
      });
    }

    return closestSeg;
  };

  const applyCadEditRotate = (angleInput: number, explicitCenter?: Point) => {
    saveState();
    let modified = false;
    const rad = (angleInput * Math.PI) / 180;
    const cosVal = Math.cos(rad);
    const sinVal = Math.sin(rad);

    const rotatePoints = (points: Point[]): Point[] => {
      const center = explicitCenter || (customAnchor ? customAnchor : getSelectedCenter(points));
      return points.map((p) => {
        const dx = p.x - center.x;
        const dy = p.y - center.y;
        const newX = center.x + dx * cosVal - dy * sinVal;
        const newY = center.y + dx * sinVal + dy * cosVal;
        const u: Point = { ...p, x: newX, y: newY };
        if (p.circleData) {
          const cdx = p.circleData.center.x - center.x;
          const cdy = p.circleData.center.y - center.y;
          u.circleData = {
            center: {
              x: center.x + cdx * cosVal - cdy * sinVal,
              y: center.y + cdx * sinVal + cdy * cosVal
            },
            radius: p.circleData.radius
          };
        }
        if (p.polygonData) {
          const cdx = p.polygonData.center.x - center.x;
          const cdy = p.polygonData.center.y - center.y;
          u.polygonData = {
            ...p.polygonData,
            center: {
              x: center.x + cdx * cosVal - cdy * sinVal,
              y: center.y + cdx * sinVal + cdy * cosVal
            },
            initialAngle: p.polygonData.initialAngle + rad
          };
        }
        return u;
      });
    };

    if (isFinalPointsSelected && finalPoints.length > 0) {
      setFinalPoints(rotatePoints(finalPoints));
      modified = true;
    }

    if (selectedPathIndices.length > 0 && activeLayer.paths) {
      const updatedPaths = [...activeLayer.paths];
      selectedPathIndices.forEach((idx) => {
        if (updatedPaths[idx]) {
          updatedPaths[idx] = rotatePoints(updatedPaths[idx]);
        }
      });
      setPaths(updatedPaths);
      modified = true;
    }

    if (modified) {
      if (explicitCenter) {
        logCommandResponse(`Döndürüldü: Obje(ler) (X: ${explicitCenter.x.toFixed(1)}, Y: ${explicitCenter.y.toFixed(1)}) merkezi etrafında ${angleInput}° döndürüldü.`);
      } else {
        logCommandResponse(`Döndürüldü: ${angleInput}° Derece Döndürme Tamamlandı.`);
      }
    } else {
      logCommandResponse("Döndürülecek seçili çizgi veya poligon bulunamadı.");
    }
  };

  const applyRelativeRotation = (deltaAngle: number) => {
    // 1. Is there a selection?
    const hasSelection = (isFinalPointsSelected && finalPoints.length > 0) || (selectedPathIndices.length > 0 && activeLayer.paths && activeLayer.paths.some((_, idx) => selectedPathIndices.includes(idx)));
    if (!hasSelection) {
      logCommandResponse("Hata: Dönme hassaslaştırma yapmadan önce lütfen döndürülecek nesne(leri) seçin.");
      return;
    }

    // 2. Resolve rotation center
    let center = rotationCenter;
    if (!center) {
      // Calculate selection center as fallback
      const pointsToMeasure: Point[] = [];
      if (isFinalPointsSelected && finalPoints.length > 0) {
        pointsToMeasure.push(...finalPoints);
      }
      if (selectedPathIndices.length > 0 && activeLayer.paths) {
        selectedPathIndices.forEach(idx => {
          const p = activeLayer.paths?.[idx];
          if (p) pointsToMeasure.push(...p);
        });
      }
      if (pointsToMeasure.length > 0) {
        center = getSelectedCenter(pointsToMeasure);
        setRotationCenter(center);
        logCommandResponse(`Döndürme Merkezi otomatik olarak seçimin orta noktası (X: ${center.x.toFixed(1)}, Y: ${center.y.toFixed(1)}) olarak belirlendi.`);
      }
    }

    if (!center) {
      logCommandResponse("Hata: Dönme merkezi belirlenemedi.");
      return;
    }

    // 3. Apply rotation of delta angle around Resolved center
    applyCadEditRotate(deltaAngle, center);
  };

  const requestRotateAngle = (angle: number) => {
    const hasSelection = (isFinalPointsSelected && finalPoints.length > 0) || (selectedPathIndices.length > 0 && activeLayer.paths && activeLayer.paths.some((_, idx) => selectedPathIndices.includes(idx)));
    if (!hasSelection) {
      logCommandResponse("Hata: Lütfen döndürme işlemi yapmadan önce döndürmek istediğiniz nesneleri (şekilleri) seçin.");
      return;
    }
    setPendingRotateAngle(angle);
    logCommandResponse("Döndürme Eksen Noktası Seçin: Lütfen döndürme merkez noktasını belirlemek için 2D ekran üzerinde bir noktaya tıklayın.");
  };

  const applyCadEditScale = (factorInput: number) => {
    saveState();
    let modified = false;

    const scalePoints = (points: Point[]): Point[] => {
      const center = customAnchor ? customAnchor : getSelectedCenter(points);
      return points.map((p) => {
        const newX = center.x + (p.x - center.x) * factorInput;
        const newY = center.y + (p.y - center.y) * factorInput;
        const u: Point = { ...p, x: newX, y: newY };
        if (p.circleData) {
          const ncx = center.x + (p.circleData.center.x - center.x) * factorInput;
          const ncy = center.y + (p.circleData.center.y - center.y) * factorInput;
          u.circleData = {
            center: { x: ncx, y: ncy },
            radius: p.circleData.radius * factorInput
          };
        }
        if (p.polygonData) {
          const ncx = center.x + (p.polygonData.center.x - center.x) * factorInput;
          const ncy = center.y + (p.polygonData.center.y - center.y) * factorInput;
          u.polygonData = {
            ...p.polygonData,
            center: { x: ncx, y: ncy },
            radius: p.polygonData.radius * factorInput
          };
        }
        return u;
      });
    };

    if (isFinalPointsSelected && finalPoints.length > 0) {
      setFinalPoints(scalePoints(finalPoints));
      modified = true;
    }

    if (selectedPathIndices.length > 0 && activeLayer.paths) {
      const updatedPaths = [...activeLayer.paths];
      selectedPathIndices.forEach((idx) => {
        if (updatedPaths[idx]) {
          updatedPaths[idx] = scalePoints(updatedPaths[idx]);
        }
      });
      setPaths(updatedPaths);
      modified = true;
    }

    if (modified) {
      logCommandResponse(`Ölçeklendi: ${factorInput} Oranında Boyutlandırıldı.`);
    } else {
      logCommandResponse("Ölçeklenecek seçili çizgi veya poligon bulunamadı.");
    }
  };

  const applyCadEditLinearArray = (xc: number, yc: number, xs: number, ys: number) => {
    if (xc <= 0 || yc <= 0) {
      logCommandResponse("Hata: Eleman sayıları 1 veya daha büyük olmalıdır.");
      return;
    }
    const hasSelection = (isFinalPointsSelected && finalPoints.length > 0) || 
                         (selectedPathIndices.length > 0 && activeLayer.paths && activeLayer.paths.some((_, idx) => selectedPathIndices.includes(idx)));
    if (!hasSelection) {
      logCommandResponse("Hata: Çoğaltmak için lütfen önce en az bir şekil veya dış çeper seçin.");
      return;
    }

    saveState();

    let newPaths: Point[][] = activeLayer.paths ? [...activeLayer.paths] : [];
    let addedCount = 0;

    // We will collect the original points list from selection
    const sources: Point[][] = [];
    if (isFinalPointsSelected && finalPoints.length > 0) {
      sources.push(finalPoints);
    }
    if (selectedPathIndices.length > 0 && activeLayer.paths) {
      selectedPathIndices.forEach(idx => {
        if (activeLayer.paths?.[idx]) {
          sources.push(activeLayer.paths[idx]);
        }
      });
    }

    // Loop through x and y indices
    for (let ix = 0; ix < xc; ix++) {
      for (let iy = 0; iy < yc; iy++) {
        // Skip 0,0 since it represents the original element itself
        if (ix === 0 && iy === 0) continue;

        const dx = ix * xs;
        const dy = iy * ys;

        sources.forEach(src => {
          const duplicated = src.map(p => {
            const u: Point = { ...p, x: p.x + dx, y: p.y + dy };
            if (p.circleData) {
              u.circleData = {
                center: { x: p.circleData.center.x + dx, y: p.circleData.center.y + dy },
                radius: p.circleData.radius
              };
            }
            if (p.polygonData) {
              u.polygonData = {
                ...p.polygonData,
                center: { x: p.polygonData.center.x + dx, y: p.polygonData.center.y + dy }
              };
            }
            return u;
          });
          newPaths.push(duplicated);
          addedCount++;
        });
      }
    }

    setPaths(newPaths);
    logCommandResponse(`Doğrusal Çoğaltma: ${addedCount} adet yeni kopya üretildi.`);
  };

  const applyCadEditPolarArray = (count: number, totalAngleDeg: number) => {
    if (count <= 1) {
      logCommandResponse("Hata: Dairesel çoğaltma eleman sayısı 2 veya daha fazla olmalıdır.");
      return;
    }
    const hasSelection = (isFinalPointsSelected && finalPoints.length > 0) || 
                         (selectedPathIndices.length > 0 && activeLayer.paths && activeLayer.paths.some((_, idx) => selectedPathIndices.includes(idx)));
    if (!hasSelection) {
      logCommandResponse("Hata: Çoğaltmak için lütfen önce en az bir şekil veya dış çeper seçin.");
      return;
    }

    // Determine center: explicit rotationCenter or custom anchor set by user
    let center: Point | null = rotationCenter;
    if (!center && customAnchor) {
      center = customAnchor;
    }

    // If center is not explicitly set, ask for it! (polar array döndürme merkezi sorması lazım)
    if (!center) {
      setRotationCenterSelectMode(true);
      logCommandResponse("⚠️ Dairesel Çoğaltma Dönme Merkezi Belirlenmeli: Lütfen çoğaltma merkezi (dönme odağı) olarak kullanılacak noktayı belirlemek için ekranda bir yere tıklayın.");
      return;
    }

    saveState();

    let newPaths: Point[][] = activeLayer.paths ? [...activeLayer.paths] : [];
    let addedCount = 0;

    const sources: Point[][] = [];
    if (isFinalPointsSelected && finalPoints.length > 0) {
      sources.push(finalPoints);
    }
    if (selectedPathIndices.length > 0 && activeLayer.paths) {
      selectedPathIndices.forEach(idx => {
        if (activeLayer.paths?.[idx]) {
          sources.push(activeLayer.paths[idx]);
        }
      });
    }

    const angleIncrementRad = (totalAngleDeg / count) * (Math.PI / 180);

    for (let i = 1; i < count; i++) {
      const currentAngleRad = i * angleIncrementRad;
      const cos = Math.cos(currentAngleRad);
      const sin = Math.sin(currentAngleRad);

      sources.forEach(src => {
        const duplicated = src.map(p => {
          const dx = p.x - center.x;
          const dy = p.y - center.y;
          const rx = center.x + dx * cos - dy * sin;
          const ry = center.y + dx * sin + dy * cos;
          
          const u: Point = { ...p, x: rx, y: ry };

          if (p.circleData) {
            const cdx = p.circleData.center.x - center.x;
            const cdy = p.circleData.center.y - center.y;
            u.circleData = {
              center: {
                x: center.x + cdx * cos - cdy * sin,
                y: center.y + cdx * sin + cdy * cos
              },
              radius: p.circleData.radius
            };
          }

          if (p.polygonData) {
            const pdx = p.polygonData.center.x - center.x;
            const pdy = p.polygonData.center.y - center.y;
            u.polygonData = {
              ...p.polygonData,
              center: {
                x: center.x + pdx * cos - pdy * sin,
                y: center.y + pdx * sin + pdy * cos
              }
            };
          }

          return u;
        });
        newPaths.push(duplicated);
        addedCount++;
      });
    }

    setPaths(newPaths);
    logCommandResponse(`Dairesel Çoğaltma: Merkez (${center.x.toFixed(1)}, ${center.y.toFixed(1)}) etrafında ${addedCount} adet yeni kopya üretildi.`);
  };

  // Global drag handler for viewport splitter
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDraggingSplitRef.current) return;
      const percentage = (e.clientX / window.innerWidth) * 100;
      if (percentage > 5 && percentage < 95) {
        setSplitRatio(percentage);
      }
    };
    
    const handleGlobalMouseUp = () => {
      isDraggingSplitRef.current = false;
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  const logCommandResponse = (msg: string) => {
    setCmdLogs((prev) => [...prev.slice(-4), msg]);
  };

  // Keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        handleUndo();
      }
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        handleCopy();
      }
      if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        handlePaste();
      }
      if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        applyCadEditCopy();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        applyCadEditDelete();
      }
      if (e.key === 'Escape') {
        if (activeSegmentStretch) {
          if (activeSegmentStretch.pathIdx === -1) {
            setFinalPoints(activeSegmentStretch.originalPoints);
          } else {
            const updatedPaths = activeLayer.paths ? [...activeLayer.paths] : [];
            updatedPaths[activeSegmentStretch.pathIdx] = activeSegmentStretch.originalPoints;
            setPaths(updatedPaths);
          }
          setActiveSegmentStretch(null);
          logCommandResponse('Kenar esnetme (Stretch) iptal edildi.');
        } else if (activeSegmentMove) {
          if (activeSegmentMove.pathIdx === -1) {
            setFinalPoints(activeSegmentMove.originalPoints);
          } else {
            const updatedPaths = activeLayer.paths ? [...activeLayer.paths] : [];
            updatedPaths[activeSegmentMove.pathIdx] = activeSegmentMove.originalPoints;
            setPaths(updatedPaths);
          }
          setActiveSegmentMove(null);
          logCommandResponse('Şekil taşıma (Move) iptal edildi.');
        } else if (pendingRotateAngle !== null) {
          setPendingRotateAngle(null);
          logCommandResponse('Döndürme işlemi iptal edildi.');
        } else if (rotationCenterSelectMode) {
          setRotationCenterSelectMode(false);
          logCommandResponse('Döndürme merkez noktası seçimi iptal edildi.');
        } else if (segmentChoicePending) {
          setSegmentChoicePending(null);
          logCommandResponse('Seçim kutusu kapatıldı.');
        } else {
          clearCommand();
          setTempPoint(null);
          setClickCount(0);
          setDimP1(null);
          setDimP2(null);
          setSelectedDimensionId(null);
          logCommandResponse('İşlem iptal edildi.');
        }
      }
      if (e.key === 'f' || e.key === 'F') {
        if (e.key === 'f' && !e.ctrlKey) {
          applyFillet();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [finalPoints, isClosed, historyStack, layers, activeLayerId, activeSegmentStretch, activeSegmentMove, segmentChoicePending, selectedPathIndices, isFinalPointsSelected, copiedPaths, copiedFinalPoints, hoverCoords, pendingRotateAngle, rotationCenterSelectMode]);

  // Global mouseup event listener to ensure panning or dragging never lock/stick
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsPanning(false);
      isDrawingRef.current = false;
      dragIndexRef.current = -1;
      dragPathIndexRef.current = -1;
      dragEntirePathRef.current = null;
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // Init canvas dimensions on load/resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = canvas.parentElement?.clientWidth || 800;
      canvas.height = canvas.parentElement?.clientHeight || 600;
      drawSketch();
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [finalPoints, rawPoints, isClosed, viewZoom, panX, panY, snapPoint, trackedLines, tempPoint, showDims, bgImage, bgOpacity, layers, activeLayerId, selectedPathIndices, isFinalPointsSelected, rightClickStart, rightClickEnd, splitRatio, sidebarCollapsed]);

  // Dynamic Drawing Loop on frame update/state changes
  const drawSketchRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    drawSketchRef.current = drawSketch;
  });

  useEffect(() => {
    drawSketch();
  }, [finalPoints, rawPoints, isClosed, viewZoom, panX, panY, snapPoint, trackedLines, tempPoint, showDims, bgImage, bgOpacity, layers, activeLayerId, selectedPathIndices, isFinalPointsSelected, rightClickStart, rightClickEnd, splitRatio, sidebarCollapsed]);

  // High performance micro-animation loop when snapping is active
  useEffect(() => {
    if (snapPoint) {
      snapStartTimeRef.current = performance.now();
      let frameId: number;
      const tick = () => {
        if (drawSketchRef.current) {
          drawSketchRef.current();
        }
        frameId = requestAnimationFrame(tick);
      };
      frameId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frameId);
    }
  }, [snapPoint]);

  // Convert mouse clients coordinates to canvas model virtual coordinates
  const getVirtualCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - panX) / viewZoom,
      y: (clientY - rect.top - panY) / viewZoom,
    };
  };

  const clearCommand = () => {
    setCurrentCommand('');
    setClickCount(0);
    setTempPoint(null);
    setSnapPoint(null);
    setTrackedLines([]);
    setSelectedVertexIdx(null);
    setSelectedPathIdx(-1);
  };

  const handleStartPolygonDrawing = (sides: number, drawType: 'corner' | 'midpoint' = 'corner') => {
    setPolygonSides(sides);
    setPolygonType(drawType);
    setShowPolygonPrompt(false);

    saveState();
    setCurrentCommand('polygon');

    // Auto-commit previous shape to layers if it has enough vertices
    if (finalPoints.length >= 3) {
      setLayers((prevLayers) =>
        prevLayers.map((l) => {
          if (l.id === activeLayerId) {
            const currentPaths = l.paths || [];
            return {
              ...l,
              paths: [...currentPaths, [...l.finalPoints]],
              finalPoints: [],
              isClosed: false
            };
          }
          return l;
        })
      );
    } else {
      setFinalPoints([]);
      setIsClosed(false);
    }

    setClickCount(0);
    setTempPoint(null);
    setDrawMode('point'); // switch to geometric point entry
    logCommandResponse(`Düzgün Çokgen Çizimi: ${sides} kenarlı poligon hazır (${drawType === 'corner' ? 'Köşegenden' : 'İç Teğetten'}). İlk tıklamayla merkez noktasını belirleyin, parmağınızı kaydırarak sürükleyip boyutu ayarlayın.`);
  };

  const setCommand = (cmd: CommandType) => {
    if (cmd === 'polygon') {
      setShowPolygonPrompt(true);
      setPolygonSidesInput(polygonSides.toString());
      setPolygonTypeInput(polygonType);
      return;
    }

    saveState();
    setCurrentCommand(cmd);

    // Auto-commit previous shape to layers if it has enough vertices
    if (finalPoints.length >= 3) {
      setLayers((prevLayers) =>
        prevLayers.map((l) => {
          if (l.id === activeLayerId) {
            const currentPaths = l.paths || [];
            return {
              ...l,
              paths: [...currentPaths, [...l.finalPoints]],
              finalPoints: [],
              isClosed: false
            };
          }
          return l;
        })
      );
    } else {
      setFinalPoints([]);
      setIsClosed(false);
    }

    setClickCount(0);
    setTempPoint(null);
    setDrawMode('point'); // switch to geometric point entry
    logCommandResponse(`Started ${cmd.toUpperCase()} command. Click on screen to begin.`);
  };

  // Drag and background techniques
  const handleBgImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setBgImage(img);
        logCommandResponse('Reference technical design loaded into background.');
      };
      if (event.target?.result) {
        img.src = event.target.result as string;
      }
    };
    reader.readAsDataURL(file);
  };

  const removeBgImage = () => {
    setBgImage(null);
    logCommandResponse('Reference background image removed.');
  };

  // Geometric modifiers
  const applyFillet = (r: number = filletRadius, targetIdx: number | null = selectedVertexIdx) => {
    if (activeLayer.locked) {
      logCommandResponse(`Layer "${activeLayer.name}" is locked. Unlock it in the Layer Manager to apply Fillet.`);
      return;
    }
    if (finalPoints.length < 4) {
      logCommandResponse('Need at least 3 segments to apply Fillet.');
      return;
    }

    if (targetIdx !== null) {
      if (targetIdx < 0 || targetIdx >= finalPoints.length) {
        logCommandResponse('Invalid selected vertex index.');
        return;
      }
      saveState();
      const roundedPts: Point[] = [];
      let idx = targetIdx;
      if (idx === finalPoints.length - 1) {
        idx = 0;
      }

      for (let i = 0; i < finalPoints.length - 1; i++) {
        const p1 = finalPoints[i];
        if (i === idx) {
          const p0 = finalPoints[i === 0 ? finalPoints.length - 2 : i - 1];
          const p2 = finalPoints[i + 1];

          const dx1 = p0.x - p1.x;
          const dy1 = p0.y - p1.y;
          const len1 = Math.hypot(dx1, dy1);

          const dx2 = p2.x - p1.x;
          const dy2 = p2.y - p1.y;
          const len2 = Math.hypot(dx2, dy2);

          if (len1 > r && len2 > r) {
            roundedPts.push({
              x: p1.x + (dx1 / len1) * r,
              y: p1.y + (dy1 / len1) * r,
              isCurvePoint: false,
            });
            roundedPts.push({
              x: p1.x + (dx1 / len1) * r * 0.5 + (dx2 / len2) * r * 0.1,
              y: p1.y + (dy1 / len1) * r * 0.5 + (dy2 / len2) * r * 0.1,
              isCurvePoint: true,
            });
            roundedPts.push({
              x: p1.x + (dx1 / len1) * r * 0.1 + (dx2 / len2) * r * 0.5,
              y: p1.y + (dy1 / len1) * r * 0.1 + (dy2 / len2) * r * 0.5,
              isCurvePoint: true,
            });
            roundedPts.push({
              x: p1.x + (dx2 / len2) * r,
              y: p1.y + (dy2 / len2) * r,
              isCurvePoint: false,
            });
          } else {
            roundedPts.push(p1);
          }
        } else {
          roundedPts.push(p1);
        }
      }
      roundedPts.push({ ...roundedPts[0] });
      setFinalPoints(roundedPts);
      setIsClosed(true);
      setSelectedVertexIdx(null);
      logCommandResponse(`Fillet applied (r: ${r} mm) to selected corner.`);
      return;
    }

    saveState();
    const roundedPts: Point[] = [];
    for (let i = 0; i < finalPoints.length - 1; i++) {
      const p1 = finalPoints[i];
      const p0 = finalPoints[i === 0 ? finalPoints.length - 2 : i - 1];
      const p2 = finalPoints[i + 1];

      const dx1 = p0.x - p1.x;
      const dy1 = p0.y - p1.y;
      const len1 = Math.hypot(dx1, dy1);

      const dx2 = p2.x - p1.x;
      const dy2 = p2.y - p1.y;
      const len2 = Math.hypot(dx2, dy2);

      if (len1 > r && len2 > r) {
        // Compute rounded tangent points
        roundedPts.push({
          x: p1.x + (dx1 / len1) * r,
          y: p1.y + (dy1 / len1) * r,
          isCurvePoint: false, // keep start/end of fillet rounded arc selected/visible as handles
        });
        // Mid arcs
        roundedPts.push({
          x: p1.x + (dx1 / len1) * r * 0.5 + (dx2 / len2) * r * 0.1,
          y: p1.y + (dy1 / len1) * r * 0.5 + (dy2 / len2) * r * 0.1,
          isCurvePoint: true, // internal curve
        });
        roundedPts.push({
          x: p1.x + (dx1 / len1) * r * 0.1 + (dx2 / len2) * r * 0.5,
          y: p1.y + (dy1 / len1) * r * 0.1 + (dy2 / len2) * r * 0.5,
          isCurvePoint: true, // internal curve
        });
        roundedPts.push({
          x: p1.x + (dx2 / len2) * r,
          y: p1.y + (dy2 / len2) * r,
          isCurvePoint: false, // keep exit of fillet rounded arc visible
        });
      } else {
        roundedPts.push(p1);
      }
    }
    // ensure closed
    roundedPts.push({ ...roundedPts[0] });
    setFinalPoints(roundedPts);
    setIsClosed(true);
    logCommandResponse(`Fillet applied (r: ${r} mm) to all corners.`);
  };

  const applyChamfer = (d: number = chamferDistance, targetIdx: number | null = selectedVertexIdx) => {
    if (activeLayer.locked) {
      logCommandResponse(`Layer "${activeLayer.name}" is locked. Unlock it in the Layer Manager to apply Chamfer.`);
      return;
    }
    if (finalPoints.length < 4) {
      logCommandResponse('Need at least 3 segments to apply Chamfer.');
      return;
    }

    if (targetIdx !== null) {
      if (targetIdx < 0 || targetIdx >= finalPoints.length) {
        logCommandResponse('Invalid selected vertex index.');
        return;
      }
      saveState();
      const chamferPts: Point[] = [];
      let idx = targetIdx;
      if (idx === finalPoints.length - 1) {
        idx = 0;
      }

      for (let i = 0; i < finalPoints.length - 1; i++) {
        const p1 = finalPoints[i];
        if (i === idx) {
          const p0 = finalPoints[i === 0 ? finalPoints.length - 2 : i - 1];
          const p2 = finalPoints[i + 1];

          const dx1 = p0.x - p1.x;
          const dy1 = p0.y - p1.y;
          const len1 = Math.hypot(dx1, dy1);

          const dx2 = p2.x - p1.x;
          const dy2 = p2.y - p1.y;
          const len2 = Math.hypot(dx2, dy2);

          if (len1 > d * 1.5 && len2 > d * 1.5) {
            chamferPts.push({
              x: p1.x + (dx1 / len1) * d,
              y: p1.y + (dy1 / len1) * d,
            });
            chamferPts.push({
              x: p1.x + (dx2 / len2) * d,
              y: p1.y + (dy2 / len2) * d,
            });
          } else {
            chamferPts.push(p1);
          }
        } else {
          chamferPts.push(p1);
        }
      }
      chamferPts.push({ ...chamferPts[0] });
      setFinalPoints(chamferPts);
      setIsClosed(true);
      setSelectedVertexIdx(null);
      logCommandResponse(`Chamfer applied (d: ${d} mm) to selected corner.`);
      return;
    }

    saveState();
    const chamferPts: Point[] = [];
    for (let i = 0; i < finalPoints.length - 1; i++) {
      const p1 = finalPoints[i];
      const p0 = finalPoints[i === 0 ? finalPoints.length - 2 : i - 1];
      const p2 = finalPoints[i + 1];

      const dx1 = p0.x - p1.x;
      const dy1 = p0.y - p1.y;
      const len1 = Math.hypot(dx1, dy1);

      const dx2 = p2.x - p1.x;
      const dy2 = p2.y - p1.y;
      const len2 = Math.hypot(dx2, dy2);

      if (len1 > d * 1.5 && len2 > d * 1.5) {
        chamferPts.push({
          x: p1.x + (dx1 / len1) * d,
          y: p1.y + (dy1 / len1) * d,
        });
        chamferPts.push({
          x: p1.x + (dx2 / len2) * d,
          y: p1.y + (dy2 / len2) * d,
        });
      } else {
        chamferPts.push(p1);
      }
    }
    chamferPts.push({ ...chamferPts[0] });
    setFinalPoints(chamferPts);
    setIsClosed(true);
    logCommandResponse(`Chamfer applied (d: ${d} mm) to all corners.`);
  };

  const applyOffset = (d: number = offsetDistance) => {
    if (activeLayer.locked) {
      logCommandResponse(`Layer "${activeLayer.name}" is locked. Unlock it in Layer Manager to apply offset.`);
      return;
    }
    saveState();

    // Offset all completed paths
    if (activeLayer.paths && activeLayer.paths.length > 0) {
      const offsetPaths = activeLayer.paths.map((p) => offsetPolygon(p, d));
      setPaths(offsetPaths);
    }

    // Offset draft points if closed and has sufficient vertices
    if (finalPoints.length >= 3 && isClosed) {
      const offsetPts = offsetPolygon(finalPoints, d);
      setFinalPoints(offsetPts);
    }

    logCommandResponse(`Offset of ${d > 0 ? '+' : ''}${d} mm applied successfully.`);
  };

  // Find current selected point, previous, next, or circle parameters
  const getSelectedVertexAndNeighbors = () => {
    if (selectedVertexIdx === null) return null;
    const pts = selectedPathIdx === -1 ? finalPoints : (activeLayer.paths ? activeLayer.paths[selectedPathIdx] || [] : []);
    if (pts.length === 0 || selectedVertexIdx >= pts.length) return null;

    const current = pts[selectedVertexIdx];
    const N = pts.length;
    
    // Check if path is circular
    const isCircle = pts.some(p => p.circleData);
    const circleData = pts.find(p => p.circleData)?.circleData || null;

    let prevIdx: number | null = null;
    let nextIdx: number | null = null;

    // Detect closed loop
    const isClosedLoop = N > 2 && Math.hypot(pts[0].x - pts[N - 1].x, pts[0].y - pts[N - 1].y) < 0.1;

    if (isClosedLoop) {
      const activeIdx = (selectedVertexIdx === N - 1) ? 0 : selectedVertexIdx;
      prevIdx = activeIdx === 0 ? N - 2 : activeIdx - 1;
      nextIdx = activeIdx === N - 2 ? 0 : activeIdx + 1;
    } else {
      if (selectedVertexIdx > 0) prevIdx = selectedVertexIdx - 1;
      if (selectedVertexIdx < N - 1) nextIdx = selectedVertexIdx + 1;
    }

    const prevPt = prevIdx !== null ? pts[prevIdx] : null;
    const nextPt = nextIdx !== null ? pts[nextIdx] : null;

    return {
      current,
      prevPt,
      nextPt,
      isCircle,
      circleData,
      prevIdx,
      nextIdx,
      pts,
      N
    };
  };

  const getActivePointsList = (): Point[] => {
    if (selectedPathIdx === -1) {
      return finalPoints;
    } else {
      return activeLayer.paths ? (activeLayer.paths[selectedPathIdx] || []) : [];
    }
  };

  const getJoinedIndices = (clickedIdx: number, layerOverride?: CADLayer): { selectFinalPoints: boolean; selectPathIndices: number[] } => {
    const targetLayer = layerOverride || activeLayer;
    const defaultGrp = 'main_group_' + targetLayer.id;
    
    // Get the effective groupId for the clicked object
    let clickedGroupId = '';
    if (clickedIdx === -1) {
      clickedGroupId = targetLayer.finalPointsSettings?.groupId || defaultGrp;
    } else {
      clickedGroupId = targetLayer.pathSettings?.[clickedIdx]?.groupId || defaultGrp;
    }

    // If the clicked group is explicitly independent, stand alone!
    if (clickedGroupId.startsWith('independent_')) {
      return {
        selectFinalPoints: clickedIdx === -1,
        selectPathIndices: clickedIdx >= 0 ? [clickedIdx] : []
      };
    }

    // Otherwise, find all other shapes in this layer sharing the same groupId
    const selectFinalPoints = (targetLayer.finalPointsSettings?.groupId || defaultGrp) === clickedGroupId;
    const selectPathIndices: number[] = [];
    if (targetLayer.paths) {
      targetLayer.paths.forEach((_, idx) => {
        const pGrp = targetLayer.pathSettings?.[idx]?.groupId || defaultGrp;
        if (pGrp === clickedGroupId) {
          selectPathIndices.push(idx);
        }
      });
    }

    return { selectFinalPoints, selectPathIndices };
  };

  const getSelectedPathSettings = (): PathSettings => {
    if (selectedPathIdx === -1) {
      return activeLayer.finalPointsSettings || {
        opType: activeLayer.opType || 'extrude',
        depth: activeLayer.depth || 30,
        revolveAxis: activeLayer.revolveAxis || 'center',
        booleanType: 'union'
      };
    } else {
      const ps = activeLayer.pathSettings?.[selectedPathIdx];
      return ps || {
        opType: activeLayer.opType || 'extrude',
        depth: activeLayer.depth || 30,
        revolveAxis: activeLayer.revolveAxis || 'center',
        booleanType: 'union'
      };
    }
  };

  const updateSelectedPathSettings = (updates: Partial<PathSettings>) => {
    saveState();
    setLayers(prev => prev.map(l => {
      if (l.id === activeLayerId) {
        if (selectedPathIdx === -1) {
          const currentSettings = l.finalPointsSettings || {
            opType: l.opType || 'extrude',
            depth: l.depth || 30,
            revolveAxis: l.revolveAxis || 'center',
            booleanType: 'union'
          };
          return {
            ...l,
            finalPointsSettings: { ...currentSettings, ...updates }
          };
        } else {
          const settingsArray = [...(l.pathSettings || [])];
          const pathCount = l.paths ? l.paths.length : 0;
          while (settingsArray.length < pathCount) {
            settingsArray.push({
              opType: l.opType || 'extrude',
              depth: l.depth || 30,
              revolveAxis: l.revolveAxis || 'center',
              booleanType: 'union'
            });
          }
          const currentSettings = settingsArray[selectedPathIdx] || {
            opType: l.opType || 'extrude',
            depth: l.depth || 30,
            revolveAxis: l.revolveAxis || 'center',
            booleanType: 'union'
          };
          settingsArray[selectedPathIdx] = { ...currentSettings, ...updates };
          return {
            ...l,
            pathSettings: settingsArray
          };
        }
      }
      return l;
    }));
  };

  const renderShapeSolidSettings = () => {
    const label = selectedPathIdx === -1 ? "Aktif Çizim (Active)" : `Şekil #${selectedPathIdx + 1}`;
    const settings = getSelectedPathSettings();

    return (
      <div className="bg-zinc-900 border border-zinc-800/80 p-3 rounded-lg space-y-3 font-sans mt-2">
        <div className="flex items-center justify-between text-[10px] font-mono text-orange-400 border-b border-zinc-800 pb-1.5 font-bold">
          <span className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-orange-400 animate-pulse" />
            3D BOOLEAN & ENTEGRE SKETCH ({label})
          </span>
        </div>
        
        {/* Boolean Operation Type */}
        <div className="space-y-1">
          <span className="text-[9px] text-zinc-400 block font-mono font-semibold">Solid Boolean İşlemi:</span>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => updateSelectedPathSettings({ booleanType: 'union' })}
              className={`py-1 rounded text-[9px] font-bold font-mono transition text-center border cursor-pointer ${
                settings.booleanType === 'union' || !settings.booleanType
                  ? 'bg-orange-600/20 border-orange-500 text-orange-200'
                  : 'bg-zinc-950/40 border-zinc-850 text-zinc-400 hover:text-white'
              }`}
              title="Union (Birleşim): Bu şekli katı dolgulu bir parça olarak ekler."
            >
              UNION (Katı Ekle)
            </button>
            <button
              onClick={() => updateSelectedPathSettings({ booleanType: 'cut' })}
              className={`py-1 rounded text-[9px] font-bold font-mono transition text-center border cursor-pointer ${
                settings.booleanType === 'cut'
                  ? 'bg-rose-600/20 border-rose-500 text-rose-200'
                  : 'bg-zinc-950/40 border-zinc-850 text-zinc-400 hover:text-white'
              }`}
              title="Cut (Kesim): Bu şekli ana katıdan oyan bir boşluk/delik yapar."
            >
              CUT (Oyuk Kes)
            </button>
          </div>
        </div>

        {/* Process Type: Extrude vs Revolve */}
        <div className="space-y-1">
          <span className="text-[9px] text-zinc-400 block font-mono font-semibold">3D İşlem Tipi:</span>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => updateSelectedPathSettings({ opType: 'extrude' })}
              className={`py-1 rounded text-[9px] font-bold font-mono transition text-center border cursor-pointer ${
                settings.opType === 'extrude' || !settings.opType
                  ? 'bg-blue-600/20 border-blue-500 text-blue-200'
                  : 'bg-zinc-950/40 border-zinc-850 text-zinc-400 hover:text-white'
              }`}
            >
              Extrude (Yükselt)
            </button>
            <button
              onClick={() => updateSelectedPathSettings({ opType: 'revolve' })}
              className={`py-1 rounded text-[9px] font-bold font-mono transition text-center border cursor-pointer ${
                settings.opType === 'revolve'
                  ? 'bg-purple-600/20 border-purple-500 text-purple-200'
                  : 'bg-zinc-950/40 border-zinc-850 text-zinc-400 hover:text-white'
              }`}
            >
              Revolve (Döndür)
            </button>
          </div>
        </div>

        {/* Dynamic Parameter: Extrude Thickness */}
        {settings.opType === 'revolve' ? (
          /* Revolve axis parameter */
          <div className="space-y-1">
            <span className="text-[9px] text-zinc-400 font-mono block">Döndürme Ekseni (Axis):</span>
            <select
              value={settings.revolveAxis || 'center'}
              onChange={(e) => updateSelectedPathSettings({ revolveAxis: e.target.value as any })}
              className="w-full bg-zinc-950 border border-zinc-850 text-[10px] px-2 py-1 rounded text-zinc-250 outline-none focus:border-purple-500"
            >
              <option value="left">Sol Sınır (Left - Min X)</option>
              <option value="center">Merkez Aks (Center Axis)</option>
              <option value="right">Sağ Sınır (Right - Max X)</option>
              <option value="origin-y">Y Ekseni (X=0 vertical)</option>
              <option value="origin-x">X Ekseni (Y=0 horizontal)</option>
            </select>
          </div>
        ) : (
          <div className="space-y-1">
            <span className="text-[9px] text-zinc-400 font-mono block">Yükseklik / Derinlik (Z-Depth):</span>
            <div className="flex gap-2">
              <input
                type="number"
                value={settings.depth !== undefined ? settings.depth : 30}
                onChange={(e) => updateSelectedPathSettings({ depth: Math.max(5, parseInt(e.target.value) || 5) })}
                className="flex-1 min-w-0 bg-zinc-955 border border-zinc-850 text-xs px-2 py-1 rounded text-zinc-200 outline-none focus:border-orange-500 font-mono text-center font-bold"
                min="5"
                max="1000"
              />
              <span className="text-[9px] font-mono self-center text-zinc-500 font-bold">mm</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Update X and Y of selected vertex
  const updateVertexCoords = (newX: number, newY: number) => {
    saveState();
    
    // Get the selected vertex and understand coordinates translation
    const currentPtList = getActivePointsList();
    if (selectedVertexIdx === null || currentPtList.length === 0 || selectedVertexIdx >= currentPtList.length) return;
    const currentPoint = currentPtList[selectedVertexIdx];
    const dx = newX - currentPoint.x;
    const dy = newY - currentPoint.y;

    if (moveEntireShapeOnCoordChange) {
      if (selectedPathIdx === -1) {
        setFinalPoints(prev => prev.map(pt => {
          const u = { ...pt, x: pt.x + dx, y: pt.y + dy };
          if (pt.circleData) {
            u.circleData = {
              center: { x: pt.circleData.center.x + dx, y: pt.circleData.center.y + dy },
              radius: pt.circleData.radius
            };
          }
          return u;
        }));
        logCommandResponse(`Hassas Konumlandırma: Ana çizim bütünüyle dX:${dx.toFixed(2)}, dY:${dy.toFixed(2)} mm kaydırıldı.`);
      } else {
        setLayers(prev => prev.map(l => {
          if (l.id === activeLayerId && l.paths) {
            const updatedPaths = l.paths.map((path, idx) => {
              if (idx === selectedPathIdx) {
                return path.map(pt => {
                  const u = { ...pt, x: pt.x + dx, y: pt.y + dy };
                  if (pt.circleData) {
                    u.circleData = {
                      center: { x: pt.circleData.center.x + dx, y: pt.circleData.center.y + dy },
                      radius: pt.circleData.radius
                    };
                  }
                  return u;
                });
              }
              return path;
            });
            return { ...l, paths: updatedPaths };
          }
          return l;
        }));
        logCommandResponse(`Hassas Konumlandırma: Şekil #${selectedPathIdx + 1} bütünüyle dX:${dx.toFixed(2)}, dY:${dy.toFixed(2)} mm kaydırıldı. Diğer sketç parçaları korunarak konumlandırıldı.`);
      }
      return;
    }

    if (selectedPathIdx === -1) {
      setFinalPoints(prev => {
        const updated = [...prev];
        const draggedPt = updated[selectedVertexIdx!];
        
        if (draggedPt && draggedPt.polygonData) {
          const polyId = draggedPt.polygonData.id;
          const sides = draggedPt.polygonData.sides;
          const vIndex = draggedPt.polygonData.vertexIndex;
          const center = draggedPt.polygonData.center;

          const newRadius = Math.hypot(newX - center.x, newY - center.y);
          const newAngle = Math.atan2(newY - center.y, newX - center.x);
          const newInitialAngle = newAngle - (vIndex * Math.PI * 2) / sides;

          for (let i = 0; i < updated.length; i++) {
            if (updated[i].polygonData?.id === polyId) {
              const currentVIndex = updated[i].polygonData.vertexIndex;
              const targetAngle = newInitialAngle + (currentVIndex * Math.PI * 2) / sides;
              updated[i] = {
                ...updated[i],
                x: center.x + newRadius * Math.cos(targetAngle),
                y: center.y + newRadius * Math.sin(targetAngle),
                polygonData: {
                  ...updated[i].polygonData,
                  radius: newRadius,
                  initialAngle: newInitialAngle
                }
              };
            }
          }
          if (selectedVertexIdx === 0) updated[updated.length - 1] = { ...updated[0] };
          if (selectedVertexIdx === updated.length - 1) updated[0] = { ...updated[updated.length - 1] };
        } else {
          updated[selectedVertexIdx!] = { ...updated[selectedVertexIdx!], x: newX, y: newY };
          if (isClosed && updated.length > 2) {
            if (selectedVertexIdx === 0) updated[updated.length - 1] = { ...updated[updated.length - 1], x: newX, y: newY };
            if (selectedVertexIdx === updated.length - 1) updated[0] = { ...updated[0], x: newX, y: newY };
          }
        }
        return updated;
      });
    } else {
      setLayers(prev => prev.map(l => {
        if (l.id === activeLayerId && l.paths) {
          const updatedPaths = [...l.paths];
          const updatedPath = [...updatedPaths[selectedPathIdx]];
          const draggedPt = updatedPath[selectedVertexIdx!];

          if (draggedPt && draggedPt.polygonData) {
            const polyId = draggedPt.polygonData.id;
            const sides = draggedPt.polygonData.sides;
            const vIndex = draggedPt.polygonData.vertexIndex;
            const center = draggedPt.polygonData.center;

            const newRadius = Math.hypot(newX - center.x, newY - center.y);
            const newAngle = Math.atan2(newY - center.y, newX - center.x);
            const newInitialAngle = newAngle - (vIndex * Math.PI * 2) / sides;

            for (let i = 0; i < updatedPath.length; i++) {
              if (updatedPath[i].polygonData?.id === polyId) {
                const currentVIndex = updatedPath[i].polygonData.vertexIndex;
                const targetAngle = newInitialAngle + (currentVIndex * Math.PI * 2) / sides;
                updatedPath[i] = {
                  ...updatedPath[i],
                  x: center.x + newRadius * Math.cos(targetAngle),
                  y: center.y + newRadius * Math.sin(targetAngle),
                  polygonData: {
                    ...updatedPath[i].polygonData,
                    radius: newRadius,
                    initialAngle: newInitialAngle
                  }
                };
              }
            }
            if (selectedVertexIdx === 0) updatedPath[updatedPath.length - 1] = { ...updatedPath[0] };
            if (selectedVertexIdx === updatedPath.length - 1) updatedPath[0] = { ...updatedPath[updatedPath.length - 1] };
          } else {
            updatedPath[selectedVertexIdx!] = { ...updatedPath[selectedVertexIdx!], x: newX, y: newY };
            
            if (updatedPath.length > 2) {
              const isClosedLoop = Math.hypot(updatedPath[0].x - updatedPath[updatedPath.length - 1].x, updatedPath[0].y - updatedPath[updatedPath.length - 1].y) < 0.1;
              if (isClosedLoop) {
                if (selectedVertexIdx === 0) updatedPath[updatedPath.length - 1] = { ...updatedPath[updatedPath.length - 1], x: newX, y: newY };
                if (selectedVertexIdx === updatedPath.length - 1) updatedPath[0] = { ...updatedPath[0], x: newX, y: newY };
              }
            }
          }
          updatedPaths[selectedPathIdx] = updatedPath;
          return { ...l, paths: updatedPaths };
        }
        return l;
      }));
    }
  };

  // Align/Position entire sketch structurally relative to absolute origin (or defined coordinates) by a selected reference vertex point (Reference origin alignment)
  const alignEntireSketchBySelectedVertex = (targetX: number, targetY: number) => {
    const data = getSelectedVertexAndNeighbors();
    if (!data) return;
    const { current } = data;
    const dx = targetX - current.x;
    const dy = targetY - current.y;

    if (dx === 0 && dy === 0) return;

    saveState();

    // Shift finalPoints
    setFinalPoints(prev => prev.map(p => {
      const updatedPt: Point = {
        ...p,
        x: p.x + dx,
        y: p.y + dy
      };
      if (p.circleData) {
        updatedPt.circleData = {
          center: {
            x: p.circleData.center.x + dx,
            y: p.circleData.center.y + dy
          },
          radius: p.circleData.radius
        };
      }
      return updatedPt;
    }));

    // Shift other paths on the active Layer
    setLayers(prev => prev.map(l => {
      if (l.id === activeLayerId) {
        const updatedPaths = l.paths ? l.paths.map(path => path.map(p => {
          const updatedPt: Point = {
            ...p,
            x: p.x + dx,
            y: p.y + dy
          };
          if (p.circleData) {
            updatedPt.circleData = {
              center: {
                x: p.circleData.center.x + dx,
                y: p.circleData.center.y + dy
              },
              radius: p.circleData.radius
            };
          }
          return updatedPt;
        })) : [];
        return { ...l, paths: updatedPaths };
      }
      return l;
    }));

    logCommandResponse(`Hassas Konumlandırma: Seçilen referans noktası X:${targetX.toFixed(2)}, Y:${targetY.toFixed(2)} koordinatına hizalandı (Tüm geometriler ${dx.toFixed(2)}mm , ${dy.toFixed(2)}mm ötelendi).`);
  };

  // Align/Position ONLY the selected sub-shape containing the chosen node, keeping other designs perfectly locked in place
  const alignSelectedShapeBySelectedVertex = (targetX: number, targetY: number) => {
    const data = getSelectedVertexAndNeighbors();
    if (!data) return;
    const { current } = data;
    const dx = targetX - current.x;
    const dy = targetY - current.y;

    if (dx === 0 && dy === 0) return;

    saveState();

    if (selectedPathIdx === -1) {
      // Shift only finalPoints (the master boundary loop)
      setFinalPoints(prev => prev.map(p => {
        const updatedPt: Point = {
          ...p,
          x: p.x + dx,
          y: p.y + dy
        };
        if (p.circleData) {
          updatedPt.circleData = {
            center: {
              x: p.circleData.center.x + dx,
              y: p.circleData.center.y + dy
            },
            radius: p.circleData.radius
          };
        }
        return updatedPt;
      }));
      logCommandResponse(`İç Konumlandırma: Ana çeper bütünüyle X:${targetX.toFixed(2)}, Y:${targetY.toFixed(2)} hizasına yerleştirildi. Diğer iç şekiller sabit kaldı.`);
    } else {
      // Shift only the specified internal sub-shape from activeLayer.paths
      setLayers(prev => prev.map(l => {
        if (l.id === activeLayerId && l.paths) {
          const updatedPaths = l.paths.map((path, idx) => {
            if (idx === selectedPathIdx) {
              return path.map(p => {
                const updatedPt: Point = {
                  ...p,
                  x: p.x + dx,
                  y: p.y + dy
                };
                if (p.circleData) {
                  updatedPt.circleData = {
                    center: {
                      x: p.circleData.center.x + dx,
                      y: p.circleData.center.y + dy
                    },
                    radius: p.circleData.radius
                  };
                }
                return updatedPt;
              });
            }
            return path;
          });
          return { ...l, paths: updatedPaths };
        }
        return l;
      }));
      logCommandResponse(`İç Konumlandırma: Şekil #${selectedPathIdx + 1} seçilen noktası referansıyla X:${targetX.toFixed(2)}, Y:${targetY.toFixed(2)} koordinatına taşındı. Sketçin genel bütünü ve diğer parçalar korunarak konumlandırıldı.`);
    }
  };

  // Parametric updates for line distances
  const updateSegmentLength = (neighbor: 'prev' | 'next', newLen: number) => {
    const data = getSelectedVertexAndNeighbors();
    if (!data) return;
    const { current, prevPt, nextPt } = data;

    const basePt = neighbor === 'prev' ? prevPt : nextPt;
    if (!basePt) return;

    // Direct vector direction
    const dx = current.x - basePt.x;
    const dy = current.y - basePt.y;
    const currentLen = Math.hypot(dx, dy);

    if (currentLen > 0) {
      const ux = dx / currentLen;
      const uy = dy / currentLen;
      const targetX = basePt.x + ux * newLen;
      const targetY = basePt.y + uy * newLen;
      updateVertexCoords(targetX, targetY);
      logCommandResponse(`Length distance set to: ${newLen.toFixed(1)} mm`);
    }
  };

  const handleUpdateCircleRadius = (newR: number) => {
    saveState();
    const pts = getActivePointsList();
    const circlePt = pts.find(p => p.circleData);
    if (!circlePt || !circlePt.circleData) return;
    const center = circlePt.circleData.center;
    const sides = pts.length - 1;
    
    const points: Point[] = [];
    for (let i = 0; i <= sides; i++) {
      points.push({
        x: center.x + newR * Math.cos((i * Math.PI * 2) / sides),
        y: center.y + newR * Math.sin((i * Math.PI * 2) / sides),
        isCurvePoint: true,
        circleData: { center, radius: newR }
      });
    }

    if (selectedPathIdx === -1) {
      setFinalPoints(points);
    } else {
      setLayers(prevLayers => prevLayers.map(l => {
        if (l.id === activeLayerId && l.paths) {
          const updatedPaths = [...l.paths];
          updatedPaths[selectedPathIdx] = points;
          return { ...l, paths: updatedPaths };
        }
        return l;
      }));
    }
    logCommandResponse(`Circle radius updated: ${newR.toFixed(1)} mm`);
  };

  const handleUpdateCircleCenter = (newCx: number, newCy: number) => {
    saveState();
    const pts = getActivePointsList();
    const circlePt = pts.find(p => p.circleData);
    if (!circlePt || !circlePt.circleData) return;
    const oldRadius = circlePt.circleData.radius;
    const sides = pts.length - 1;
    
    const points: Point[] = [];
    for (let i = 0; i <= sides; i++) {
      points.push({
        x: newCx + oldRadius * Math.cos((i * Math.PI * 2) / sides),
        y: newCy + oldRadius * Math.sin((i * Math.PI * 2) / sides),
        isCurvePoint: true,
        circleData: { center: { x: newCx, y: newCy }, radius: oldRadius }
      });
    }

    if (selectedPathIdx === -1) {
      setFinalPoints(points);
    } else {
      setLayers(prevLayers => prevLayers.map(l => {
        if (l.id === activeLayerId && l.paths) {
          const updatedPaths = [...l.paths];
          updatedPaths[selectedPathIdx] = points;
          return { ...l, paths: updatedPaths };
        }
        return l;
      }));
    }
    logCommandResponse(`Circle center updated: Cx: ${newCx.toFixed(1)} mm, Cy: ${newCy.toFixed(1)} mm`);
  };

  const applyTrimAtPoint = (clickPt: Point) => {
    if (activeLayer.locked) {
      logCommandResponse(`Layer "${activeLayer.name}" is locked.`);
      return;
    }

    // Find the closest segment across all loops (both paths and finalPoints)
    const allLoops = [...(activeLayer.paths || [])];
    if (finalPoints.length >= 3) {
      allLoops.push(finalPoints);
    }

    let closestLoopIdx = -1;
    let closestSegIdx = -1;
    let minDistance = Infinity;

    allLoops.forEach((loop, lIdx) => {
      for (let i = 0; i < loop.length - 1; i++) {
        const seg = getClosestPointOnSegment(clickPt, loop[i], loop[i + 1]);
        if (seg.dist < minDistance) {
          minDistance = seg.dist;
          closestLoopIdx = lIdx;
          closestSegIdx = i;
        }
      }
    });

    // Tolerance limit for clicking: 25px
    if (minDistance > 25 / viewZoom || closestLoopIdx === -1) {
      logCommandResponse("Click closer to a line segment to Trim.");
      return;
    }

    saveState();

    const targetLoop = allLoops[closestLoopIdx];
    const s1 = targetLoop[closestSegIdx];
    const s2 = targetLoop[closestSegIdx + 1];

    // Find all cross intersections with every other segment
    const intersectionPoints: { pt: Point; t: number }[] = [];

    allLoops.forEach((loop, lIdx) => {
      for (let i = 0; i < loop.length - 1; i++) {
        // Avoid self comparison on the same exact segment
        if (closestLoopIdx === lIdx && closestSegIdx === i) continue;

        const pt = findSegmentIntersection(s1, s2, loop[i], loop[i + 1]);
        if (pt && pt.tAb >= 0 && pt.tAb <= 1 && pt.tCd >= 0 && pt.tCd <= 1) {
          intersectionPoints.push({ pt: { x: pt.x, y: pt.y }, t: pt.tAb });
        }
      }
    });

    // Sort collinear intersection points along segment timeline
    intersectionPoints.sort((a, b) => a.t - b.t);

    const clickedSegInfo = getClosestPointOnSegment(clickPt, s1, s2);
    const clickedT = clickedSegInfo.t;

    let tStart = 0;
    let tEnd = 1;
    let pStart = s1;
    let pEnd = s2;

    for (let i = 0; i < intersectionPoints.length; i++) {
      const ptInfo = intersectionPoints[i];
      if (ptInfo.t < clickedT) {
        tStart = ptInfo.t;
        pStart = ptInfo.pt;
      }
      if (ptInfo.t > clickedT) {
        tEnd = ptInfo.t;
        pEnd = ptInfo.pt;
        break;
      }
    }

    // Reconstruction of the trimmed resulting curves
    const isLoopClosed = distance(targetLoop[0], targetLoop[targetLoop.length - 1]) < 0.1;
    const newLoop: Point[] = [];

    if (isLoopClosed) {
      // Split a closed loop into an open curve starting at pEnd wrapping around to pStart
      newLoop.push({ ...pEnd });
      for (let idx = closestSegIdx + 1; idx < targetLoop.length - 1; idx++) {
        newLoop.push({ ...targetLoop[idx] });
      }
      for (let idx = 0; idx <= closestSegIdx; idx++) {
        newLoop.push({ ...targetLoop[idx] });
      }
      newLoop.push({ ...pStart });

      allLoops[closestLoopIdx] = newLoop;
    } else {
      // Split an existing open curve into two disjoint parts
      const part1: Point[] = [];
      const part2: Point[] = [];

      for (let idx = 0; idx <= closestSegIdx; idx++) {
        part1.push({ ...targetLoop[idx] });
      }
      part1.push({ ...pStart });

      part2.push({ ...pEnd });
      for (let idx = closestSegIdx + 1; idx < targetLoop.length; idx++) {
        part2.push({ ...targetLoop[idx] });
      }

      // Remove trimmed loop
      allLoops.splice(closestLoopIdx, 1);

      if (part1.length >= 2) allLoops.push(part1);
      if (part2.length >= 2) allLoops.push(part2);
    }

    setLayers((prevLayers) =>
      prevLayers.map((l) => {
        if (l.id === activeLayerId) {
          const isFinalPointsTrimmed = (finalPoints.length >= 3 && targetLoop === finalPoints);
          if (isFinalPointsTrimmed) {
            return {
              ...l,
              finalPoints: [],
              isClosed: false,
              paths: allLoops
            };
          } else {
            return {
              ...l,
              paths: allLoops
            };
          }
        }
        return l;
      })
    );

    logCommandResponse("Segment trimmed at intersection boundary.");
  };

  const applyExtendAtPoint = (clickPt: Point) => {
    if (activeLayer.locked) {
      logCommandResponse(`Layer "${activeLayer.name}" is locked.`);
      return;
    }

    const allLoops = [...(activeLayer.paths || [])];
    if (finalPoints.length >= 3) {
      allLoops.push(finalPoints);
    }

    let closestLoopIdx = -1;
    let closestPtIdx = -1;
    let minDistance = Infinity;

    allLoops.forEach((loop, lIdx) => {
      const isLoopClosed = distance(loop[0], loop[loop.length - 1]) < 0.1;
      if (isLoopClosed) return;

      const dStart = Math.hypot(loop[0].x - clickPt.x, loop[0].y - clickPt.y);
      if (dStart < minDistance) {
        minDistance = dStart;
        closestLoopIdx = lIdx;
        closestPtIdx = 0;
      }

      const dEnd = Math.hypot(loop[loop.length - 1].x - clickPt.x, loop[loop.length - 1].y - clickPt.y);
      if (dEnd < minDistance) {
        minDistance = dEnd;
        closestLoopIdx = lIdx;
        closestPtIdx = loop.length - 1;
      }
    });

    if (minDistance > 30 / viewZoom || closestLoopIdx === -1) {
      logCommandResponse("Click closer to the endpoint of an open curve to Extend.");
      return;
    }

    saveState();

    const targetLoop = allLoops[closestLoopIdx];
    const endpointPt = targetLoop[closestPtIdx];
    const adjacentPt = closestPtIdx === 0 ? targetLoop[1] : targetLoop[targetLoop.length - 2];

    const dx = endpointPt.x - adjacentPt.x;
    const dy = endpointPt.y - adjacentPt.y;
    const len = Math.hypot(dx, dy) || 1;
    const rdx = dx / len;
    const rdy = dy / len;

    let bestIntersection: Point | null = null;
    let minT = Infinity;

    const maxExtendDist = 10000;
    const distantPoint = { x: endpointPt.x + rdx * maxExtendDist, y: endpointPt.y + rdy * maxExtendDist };

    allLoops.forEach((loop, lIdx) => {
      for (let i = 0; i < loop.length - 1; i++) {
        // Avoid comparing with containing segments
        if (closestLoopIdx === lIdx && (i === 0 || i === loop.length - 2)) continue;

        const pt = findSegmentIntersection(endpointPt, distantPoint, loop[i], loop[i + 1]);
        if (pt && pt.tAb >= 0 && pt.tAb <= 1 && pt.tCd >= 0 && pt.tCd <= 1) {
          const extendLen = pt.tAb * maxExtendDist;
          if (extendLen > 0.1 && extendLen < minT) {
            minT = extendLen;
            bestIntersection = { x: pt.x, y: pt.y };
          }
        }
      }
    });

    if (bestIntersection) {
      const updatedLoop = [...targetLoop];
      updatedLoop[closestPtIdx] = bestIntersection;
      allLoops[closestLoopIdx] = updatedLoop;

      setLayers((prevLayers) =>
        prevLayers.map((l) => {
          if (l.id === activeLayerId) {
            const isFinalPointsExtended = (finalPoints.length >= 3 && targetLoop === finalPoints);
            if (isFinalPointsExtended) {
              return {
                ...l,
                finalPoints: updatedLoop
              };
            } else {
              return {
                ...l,
                paths: allLoops
              };
            }
          }
          return l;
        })
      );
      logCommandResponse(`Segment extended by ${minT.toFixed(1)} mm.`);
    } else {
      logCommandResponse("No intersection found ahead of segment.");
    }
  };

  const runDouglasPeucker = () => {
    if (activeLayer.locked) {
      logCommandResponse(`Layer "${activeLayer.name}" is locked. Unlock it to refine sketch.`);
      return;
    }
    if (rawPoints.length < 3) {
      logCommandResponse('No serbest (freehand) segments found on screen to refine.');
      return;
    }
    saveState();
    const simplified = douglasPeucker(rawPoints, 15 / viewZoom);
    const poly: Point[] = simplified.map((p) => ({ x: p.x, y: p.y }));
    // Auto closing
    poly.push({ ...poly[0] });
    setFinalPoints(poly);
    setRawPoints([]);
    setIsClosed(true);
    setDrawMode('drag');
    clearCommand();
    logCommandResponse('AI Sketch geometry refined successfully.');
  };

  // Reset Canvas Completely
  const handleClearAll = () => {
    if (activeLayer.locked) {
      logCommandResponse(`Layer "${activeLayer.name}" is locked. Cannot clear points.`);
      return;
    }
    saveState([], false, 0);
    setRawPoints([]);
    setFinalPoints([]);
    setIsClosed(false);
    // Also clear completed paths!
    setLayers((prevLayers) =>
      prevLayers.map((l) => (l.id === activeLayerId ? { ...l, finalPoints: [], paths: [], isClosed: false } : l))
    );
    clearCommand();
    setTempPoint(null);
    logCommandResponse('Cleared sketch canvas. Clean board loaded.');
  };

  // Direct numeric updates from Parametric side panel table
  const updatePointsFromTable = (idx: number, len: number, ang: number) => {
    saveState();
    const newPts = [...finalPoints];
    if (newPts.length < 2) return;

    // We rebuild chain starting from index 0 dynamically
    let cx = newPts[0].x;
    let cy = newPts[0].y;

    for (let i = 0; i < newPts.length - 1; i++) {
      let currentLen = distance(newPts[i], newPts[i + 1]);
      let currentAngRad = Math.atan2(-(newPts[i + 1].y - newPts[i].y), newPts[i + 1].x - newPts[i].x);
      let currentAng = (currentAngRad * 180) / Math.PI;
      if (currentAng < 0) currentAng += 360;

      if (i === idx) {
        currentLen = len;
        currentAng = ang;
      }

      const rad = (currentAng * Math.PI) / 180;
      cx += currentLen * Math.cos(rad);
      cy -= currentLen * Math.sin(rad); // invert Y for screen coords
      newPts[i + 1] = { x: cx, y: cy };
    }

    // Update terminal close
    newPts[newPts.length - 1] = { ...newPts[0] };
    setFinalPoints(newPts);
    logCommandResponse(`Updated segment K-${idx + 1} parameters.`);
  };

  const handleApplySegmentDimension = (pathIdx: number, segmentIdx: number, newLen: number) => {
    saveState();
    if (pathIdx === -1) {
      const pts = [...finalPoints];
      if (pts.length < 2) return;
      
      const p1 = pts[segmentIdx];
      const p2 = pts[segmentIdx + 1];
      if (!p1 || !p2) return;
      
      let angRad = Math.atan2(-(p2.y - p1.y), p2.x - p1.x);
      let ang = (angRad * 180) / Math.PI;
      if (ang < 0) ang += 365; // Safe rotation mapping
      
      updatePointsFromTable(segmentIdx, newLen, ang);
    } else {
      setLayers((prevLayers) =>
        prevLayers.map((layer) => {
          if (layer.id === activeLayerId && layer.paths && layer.paths[pathIdx]) {
            const updatedPaths = [...layer.paths];
            const pts = [...updatedPaths[pathIdx]];
            if (pts.length < 2) return layer;
            
            const p1 = pts[segmentIdx];
            const p2 = pts[(segmentIdx + 1) % pts.length];
            if (!p1 || !p2) return layer;
            
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let currentLen = Math.hypot(dx, dy);
            if (currentLen === 0) return layer;
            
            let ratio = newLen / currentLen;
            let targetX = p1.x + dx * ratio;
            let targetY = p1.y + dy * ratio;
            
            let shiftX = targetX - p2.x;
            let shiftY = targetY - p2.y;
            
            pts[(segmentIdx + 1) % pts.length] = { x: targetX, y: targetY };
            
            for (let i = (segmentIdx + 2) % pts.length; i !== (segmentIdx + 1) % pts.length; i = (i + 1) % pts.length) {
              if (i === 0 && distance(pts[0], pts[pts.length - 1]) < 0.1) {
                pts[pts.length - 1] = { ...pts[0] };
                break;
              }
              pts[i] = { x: pts[i].x + shiftX, y: pts[i].y + shiftY };
            }
            
            updatedPaths[pathIdx] = pts;
            return { ...layer, paths: updatedPaths };
          }
          return layer;
        })
      );
      logCommandResponse(`Finished shape segment K-${segmentIdx + 1} updated to ${newLen.toFixed(1)} mm.`);
    }
    setEditingSegmentIdx(null);
    setEditingPathIdx(null);
  };

  // Draw 2D viewport onto screen
  const drawSketch = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Paint dynamic background color
    ctx.fillStyle = canvasBgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    // Pan & Zoom matrices
    ctx.translate(panX, panY);
    ctx.scale(viewZoom, viewZoom);

    // 1. Draw Background Image Guide
    if (bgImage) {
      ctx.globalAlpha = bgOpacity;
      ctx.drawImage(bgImage, 0, 0);
      ctx.globalAlpha = 1.0;
    }

    // 2. Draw Grid Pattern (Adjustable Grid Size)
    const currentGridSize = gridSize;
    const startX = Math.floor(-panX / viewZoom / currentGridSize) * currentGridSize;
    const endX = (canvas.width - panX) / viewZoom;
    const startY = Math.floor(-panY / viewZoom / currentGridSize) * currentGridSize;
    const endY = (canvas.height - panY) / viewZoom;

    if (showGrid) {
      const isDark = isColorDark(canvasBgColor);
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.15)'; // High-contrast dynamic grid lines
      ctx.lineWidth = 0.5 / viewZoom;
      ctx.beginPath();
      for (let x = startX; x < endX; x += currentGridSize) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
      }
      for (let y = startY; y < endY; y += currentGridSize) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
      }
      ctx.stroke();
    }

    // 2.5 Draw Absolute Coordinate Origin Axes (X=0 & Y=0) with labels
    ctx.lineWidth = 1.5 / viewZoom;
    
    // Draw X-Axis (Red-ish)
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)'; // Crimson/Red
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(endX, 0);
    ctx.stroke();

    // Draw Y-Axis (Green-ish)
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)'; // Emerald Green
    ctx.beginPath();
    ctx.moveTo(0, startY);
    ctx.lineTo(0, endY);
    ctx.stroke();

    // Central crosshair ring at origin (0,0)
    ctx.strokeStyle = '#3b82f6'; // Bright blue
    ctx.lineWidth = 1.0 / viewZoom;
    ctx.beginPath();
    ctx.arc(0, 0, 8 / viewZoom, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(0, 0, 2.5 / viewZoom, 0, 2 * Math.PI);
    ctx.fill();

    // Text labels for coordinates
    ctx.fillStyle = 'rgba(239, 68, 68, 0.7)';
    ctx.font = `bold ${Math.max(9, 10 / viewZoom)}px monospace`;
    ctx.fillText("+X", endX - 25 / viewZoom, -5 / viewZoom);
    ctx.fillText("-X", startX + 5 / viewZoom, -5 / viewZoom);

    ctx.fillStyle = 'rgba(16, 185, 129, 0.7)';
    ctx.fillText("+Y", 8 / viewZoom, endY - 10 / viewZoom);
    ctx.fillText("-Y", 8 / viewZoom, startY + 15 / viewZoom);

    // 3. Draw Smart Track guides (Orange dashed lines)
    if (trackedLines.length > 0 && tempPoint) {
      ctx.setLineDash([5 / viewZoom, 5 / viewZoom]);
      ctx.strokeStyle = '#f97316'; // Orange-500
      ctx.lineWidth = 1.0 / viewZoom;
      ctx.beginPath();
      trackedLines.forEach((line) => {
        if (line.type === 'H') {
          ctx.moveTo(line.x, line.y);
          ctx.lineTo(tempPoint.x, line.y);
        } else if (line.type === 'V') {
          ctx.moveTo(line.x, line.y);
          ctx.lineTo(line.x, tempPoint.y);
        } else if (line.type === 'extension' && line.p1) {
          ctx.moveTo(line.p1.x, line.p1.y);
          ctx.lineTo(tempPoint.x, tempPoint.y);
        } else if (line.type === 'angle' && line.p1) {
          ctx.moveTo(line.p1.x, line.p1.y);
          ctx.lineTo(tempPoint.x, tempPoint.y);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw angle text overlays on top of polar rays
      trackedLines.forEach((line) => {
        if (line.type === 'angle' && line.angle !== undefined && line.p1) {
          ctx.save();
          ctx.fillStyle = '#f97316';
          ctx.font = `bold ${Math.max(9, 10 / viewZoom)}px sans-serif`;
          const midX = (line.p1.x + tempPoint.x) / 2;
          const midY = (line.p1.y + tempPoint.y) / 2;
          ctx.fillText(` ${line.angle}°`, midX + 5 / viewZoom, midY - 5 / viewZoom);
          ctx.restore();
        }
      });
    }

    // 4. Smart snap visual cues (Square / Triangle / Cross)
    if (snapPoint) {
      const sz = 8 / viewZoom;
      ctx.lineWidth = 2.0 / viewZoom;

      ctx.save();
      ctx.translate(snapPoint.x, snapPoint.y);

      // Animation parameters
      const elapsed = performance.now() - snapStartTimeRef.current;
      const tPop = Math.min(1, elapsed / 180);
      let scale = 1.0;
      if (tPop < 1) {
        // overshoot easeOutElastic/easeOutBack
        const c1 = 1.70158;
        const c3 = c1 + 1;
        scale = 1 + c3 * Math.pow(tPop - 1, 3) + c1 * Math.pow(tPop - 1, 2);
      } else {
        // subtle continuous breathing/pulsing
        const breatheTime = (elapsed - 180) / 1000;
        scale = 1.0 + Math.sin(breatheTime * Math.PI * 2) * 0.08;
      }

      const currentSz = sz * scale;

      // 4.1. Concentric Expanding Ripple Effect on snap discovery
      if (elapsed < 350) {
        const tRipple = elapsed / 350;
        const rScale = 1.0 + tRipple * 1.3;
        const rAlpha = 1.0 - tRipple;

        ctx.save();
        ctx.globalAlpha = rAlpha;
        ctx.lineWidth = 1.2 / viewZoom;
        const rSz = sz * rScale;

        if (snapPoint.type === 'end') {
          ctx.strokeStyle = '#e11d48'; // Rose-600
          ctx.strokeRect(-rSz / 2, -rSz / 2, rSz, rSz);
        } else if (snapPoint.type === 'mid') {
          ctx.strokeStyle = '#e11d48';
          ctx.beginPath();
          ctx.moveTo(0, -rSz / 2);
          ctx.lineTo(rSz / 2, rSz / 2);
          ctx.lineTo(-rSz / 2, rSz / 2);
          ctx.closePath();
          ctx.stroke();
        } else if (snapPoint.type === 'int') {
          ctx.strokeStyle = '#e11d48';
          ctx.beginPath();
          ctx.moveTo(-rSz / 2, -rSz / 2);
          ctx.lineTo(rSz / 2, rSz / 2);
          ctx.moveTo(rSz / 2, -rSz / 2);
          ctx.lineTo(-rSz / 2, rSz / 2);
          ctx.stroke();
        } else if (snapPoint.type === 'origin') {
          ctx.strokeStyle = '#22c55e'; // Green-500
          ctx.beginPath();
          ctx.arc(0, 0, rSz / 1.5, 0, 2 * Math.PI);
          ctx.stroke();
        } else if (snapPoint.type === 'anchor') {
          ctx.strokeStyle = '#06b6d4'; // Cyan-500
          ctx.strokeRect(-rSz / 2, -rSz / 2, rSz, rSz);
        }
        ctx.restore();
      }

      // 4.2. Main Snap Shapes (Rotated & Scaled)
      if (snapPoint.type === 'end') {
        // Square for End point
        ctx.strokeStyle = '#e11d48'; // Rose-600
        ctx.fillStyle = '#e11d48';
        ctx.strokeRect(-currentSz / 2, -currentSz / 2, currentSz, currentSz);
      } else if (snapPoint.type === 'mid') {
        // Triangle for Midpoint
        ctx.strokeStyle = '#e11d48'; // Rose-600
        ctx.fillStyle = '#e11d48';
        ctx.beginPath();
        ctx.moveTo(0, -currentSz / 2);
        ctx.lineTo(currentSz / 2, currentSz / 2);
        ctx.lineTo(-currentSz / 2, currentSz / 2);
        ctx.closePath();
        ctx.stroke();
      } else if (snapPoint.type === 'int') {
        // Cross for intersection (with subtle spin)
        ctx.strokeStyle = '#e11d48'; // Rose-600
        ctx.fillStyle = '#e11d48';
        ctx.save();
        const spinAngle = elapsed / 400; // Rotating intersection cross!
        ctx.rotate(spinAngle);
        ctx.beginPath();
        ctx.moveTo(-currentSz / 2, -currentSz / 2);
        ctx.lineTo(currentSz / 2, currentSz / 2);
        ctx.moveTo(currentSz / 2, -currentSz / 2);
        ctx.lineTo(-currentSz / 2, currentSz / 2);
        ctx.stroke();
        ctx.restore();
      } else if (snapPoint.type === 'origin') {
        // Circular crosshairs for Origin Snap (Vibrant Green)
        ctx.strokeStyle = '#22c55e'; // Green-500
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(0, 0, currentSz / 1.5, 0, 2 * Math.PI);
        ctx.stroke();

        ctx.save();
        const originSpin = -(elapsed / 600); // Inverse spinning radar crosshair!
        ctx.rotate(originSpin);
        ctx.beginPath();
        ctx.moveTo(-currentSz, 0);
        ctx.lineTo(currentSz, 0);
        ctx.moveTo(0, -currentSz);
        ctx.lineTo(0, currentSz);
        ctx.stroke();
        ctx.restore();
      } else if (snapPoint.type === 'anchor') {
        // Double concentric boxes for Custom Anchor (Vibrant Cyan-500, counter-spinning)
        ctx.strokeStyle = '#06b6d4'; // Cyan-500
        ctx.fillStyle = '#06b6d4';

        ctx.save();
        ctx.rotate(elapsed / 800);
        ctx.strokeRect(-currentSz / 2, -currentSz / 2, currentSz, currentSz);
        ctx.restore();

        ctx.save();
        ctx.rotate(-elapsed / 800);
        ctx.strokeRect(-currentSz / 4, -currentSz / 4, currentSz / 2, currentSz / 2);
        ctx.restore();
      } else if (snapPoint.type === 'near') {
        // Hourglass shape for Nearest Point snap (Light Blue)
        ctx.strokeStyle = '#0284c7'; // Light Blue-600
        ctx.beginPath();
        ctx.moveTo(-currentSz / 2, -currentSz / 2);
        ctx.lineTo(currentSz / 2, -currentSz / 2);
        ctx.lineTo(-currentSz / 2, currentSz / 2);
        ctx.lineTo(currentSz / 2, currentSz / 2);
        ctx.closePath();
        ctx.stroke();
      } else if (snapPoint.type === 'extension') {
        // Diamond with inner dot for axis extensions
        ctx.strokeStyle = '#f97316'; // Orange-500
        ctx.beginPath();
        ctx.moveTo(0, -currentSz / 2);
        ctx.lineTo(currentSz / 2, 0);
        ctx.lineTo(0, currentSz / 2);
        ctx.lineTo(-currentSz / 2, 0);
        ctx.closePath();
        ctx.stroke();
        
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.arc(0, 0, 1.5 / viewZoom, 0, 2 * Math.PI);
        ctx.fill();
      } else if (snapPoint.type === 'intersection') {
        // Crosshairs inside circle for virtual intersection
        ctx.strokeStyle = '#e11d48'; // Rose-600
        ctx.beginPath();
        ctx.arc(0, 0, currentSz / 2, 0, 2 * Math.PI);
        ctx.moveTo(-currentSz / 2, -currentSz / 2);
        ctx.lineTo(currentSz / 2, currentSz / 2);
        ctx.moveTo(currentSz / 2, -currentSz / 2);
        ctx.lineTo(-currentSz / 2, currentSz / 2);
        ctx.stroke();
      } else if (snapPoint.type === 'align') {
        // Target bracket for alignment rays
        ctx.strokeStyle = '#f59e0b'; // Amber-500
        ctx.beginPath();
        ctx.arc(0, 0, currentSz / 2, 0, 2 * Math.PI);
        ctx.stroke();
      }

      ctx.restore();
    }

    // 5. Draw command visual guides
    if (currentCommand !== '' && tempPoint && clickCount > 0) {
      ctx.strokeStyle = '#f59e0b'; // Amber-500
      ctx.setLineDash([4 / viewZoom, 4 / viewZoom]);
      ctx.lineWidth = 1.5 / viewZoom;
      ctx.beginPath();

      if (currentCommand === 'rect' && finalPoints.length > 0) {
        ctx.strokeRect(
          finalPoints[0].x,
          finalPoints[0].y,
          tempPoint.x - finalPoints[0].x,
          tempPoint.y - finalPoints[0].y
        );
      } else if ((currentCommand === 'circle' || currentCommand === 'polygon') && finalPoints.length > 0) {
        const center = finalPoints[0];
        const r = Math.hypot(tempPoint.x - center.x, tempPoint.y - center.y);
        if (currentCommand === 'circle') {
          ctx.arc(center.x, center.y, r, 0, 2 * Math.PI);
          ctx.stroke();
        } else {
          const sides = polygonSides;
          const initialAngle = Math.atan2(tempPoint.y - center.y, tempPoint.x - center.x);
          const isMidpoint = polygonType === 'midpoint';
          const drawRadius = isMidpoint ? r / Math.cos(Math.PI / sides) : r;
          const startAngle = isMidpoint ? initialAngle - Math.PI / sides : initialAngle;
          for (let i = 0; i <= sides; i++) {
            const angle = startAngle + (i * Math.PI * 2) / sides;
            const px = center.x + drawRadius * Math.cos(angle);
            const py = center.y + drawRadius * Math.sin(angle);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      } else if (currentCommand === 'line' && finalPoints.length > 0) {
        ctx.moveTo(finalPoints[finalPoints.length - 1].x, finalPoints[finalPoints.length - 1].y);
        ctx.lineTo(tempPoint.x, tempPoint.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // 6. Draw Raw sketch line (for freehand drawing visualization)
    if (rawPoints.length > 0) {
      ctx.strokeStyle = '#f43f5e'; // Rose-500
      ctx.lineWidth = 2.0 / viewZoom;
      ctx.beginPath();
      ctx.moveTo(rawPoints[0].x, rawPoints[0].y);
      for (let i = 1; i < rawPoints.length; i++) {
        ctx.lineTo(rawPoints[i].x, rawPoints[i].y);
      }
      ctx.stroke();
    }

    // 7. Draw all visible layers' shapes
    layers.forEach((layer) => {
      if (!layer.visible) return;
      const isActive = layer.id === activeLayerId;

      // Group all individual closed or open shapes in the layer
      const allLoopsOnLayer: Point[][] = [];
      if (layer.finalPoints.length > 0) {
        allLoopsOnLayer.push(layer.finalPoints);
      }
      if (layer.paths) {
        layer.paths.forEach((p) => {
          if (p.length > 0) {
            allLoopsOnLayer.push(p);
          }
        });
      }

      allLoopsOnLayer.forEach((pts) => {
        let isPathSelected = false;
        if (isActive) {
          if (pts === finalPoints) {
            isPathSelected = isFinalPointsSelected || (selectedPathIdx === -1 && finalPoints.length > 0);
          } else if (layer.paths) {
            const originalPathIdx = layer.paths.indexOf(pts);
            if (originalPathIdx !== -1 && (selectedPathIndices.includes(originalPathIdx) || selectedPathIdx === originalPathIdx)) {
              isPathSelected = true;
            }
          }
        }

        if (isPathSelected) {
          ctx.setLineDash([6 / viewZoom, 6 / viewZoom]);
        } else {
          ctx.setLineDash([]);
        }

        ctx.strokeStyle = isPathSelected ? '#f97316' : layer.color; // Vibrant CAD Orange for active selections
        ctx.lineWidth = isPathSelected ? 3.5 / viewZoom : (isActive ? 2.5 / viewZoom : 1.2 / viewZoom);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();

        ctx.setLineDash([]); // Always reset layout dash immediately

        // Draw selection glow line if selected
        if (isPathSelected) {
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.25)'; // Orange transparent glow
          ctx.lineWidth = 10 / viewZoom;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
          }
          ctx.stroke();
        }

        // Vertex Nodes & Circle Center Indicator
        if (isActive) {
          ctx.fillStyle = '#3b82f6'; // Bright active vertex node color
          const nodeSize = 6 / viewZoom;
          pts.forEach((p) => {
            if (p.isCurvePoint) return; // Skip drawing node dots on circles and fillets for true CAD "tek parça" curves!
            ctx.fillRect(p.x - nodeSize / 2, p.y - nodeSize / 2, nodeSize, nodeSize);
          });

          // Draw a clean center dot + crosshair for circles
          const circlePt = pts.find(p => p.circleData);
          if (circlePt && circlePt.circleData) {
            const { center } = circlePt.circleData;
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 1.2 / viewZoom;
            ctx.beginPath();
            ctx.moveTo(center.x - 5 / viewZoom, center.y);
            ctx.lineTo(center.x + 5 / viewZoom, center.y);
            ctx.moveTo(center.x, center.y - 5 / viewZoom);
            ctx.lineTo(center.x, center.y + 5 / viewZoom);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(center.x, center.y, 3.5 / viewZoom, 0, 2 * Math.PI);
            ctx.fill();
          }
        } else {
          ctx.fillStyle = layer.color;
          const nodeSize = 4 / viewZoom;
          pts.forEach((p) => {
            if (p.isCurvePoint) return; // Skip drawing node dots on curves
            ctx.beginPath();
            ctx.arc(p.x, p.y, nodeSize / 2, 0, 2 * Math.PI);
            ctx.fill();
          });
        }

        // Draw dimension lines and text only for the active layer
        if (showDims && isActive && pts.length > 1) {
          ctx.font = `${Math.max(10, 11 / viewZoom)}px monospace`;
          ctx.textAlign = 'center';

          const isCirclePath = pts.some(p => p.circleData);
          if (isCirclePath) {
            // Draw a single clean radius dimension from center to edge of the circle!
            const circlePt = pts.find(p => p.circleData);
            if (circlePt && circlePt.circleData) {
              const { center, radius } = circlePt.circleData;
              
              // Draw radius line
              ctx.strokeStyle = '#f43f5e';
              ctx.lineWidth = 1 / viewZoom;
              ctx.setLineDash([3 / viewZoom, 3 / viewZoom]);
              ctx.beginPath();
              ctx.moveTo(center.x, center.y);
              // Draw towards top-right (45 degrees) for good visibility
              const targetX = center.x + radius * Math.cos(Math.PI / 4);
              const targetY = center.y + radius * Math.sin(Math.PI / 4);
              ctx.lineTo(targetX, targetY);
              ctx.stroke();
              ctx.setLineDash([]);
              
              // Draw dimension text
              ctx.fillStyle = '#f43f5e';
              ctx.fillText(
                `R: ${radius.toFixed(1)} mm`,
                (center.x + targetX) / 2 + 10 / viewZoom,
                (center.y + targetY) / 2 - 5 / viewZoom
              );
            }
          } else {
            // Original linear dimensions for segment-by-segment lines!
            for (let i = 0; i < pts.length - 1; i++) {
              const p1 = pts[i];
              if (p1.isCurvePoint) continue; // Skip intermediate curve segmentation points representing fillets!
              const p2 = pts[i + 1];
              const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);

              // Dimension Text
              ctx.fillStyle = '#f43f5e'; // Rose
              ctx.fillText(
                `${d.toFixed(1)} mm`,
                (p1.x + p2.x) / 2,
                (p1.y + p2.y) / 2 - 12 / viewZoom
              );

              // Angle guides
              let ang = Math.atan2(-(p2.y - p1.y), p2.x - p1.x) * (180 / Math.PI);
              if (ang < 0) ang += 360;

              ctx.setLineDash([2 / viewZoom, 2 / viewZoom]);
              ctx.strokeStyle = '#71717a';
              ctx.lineWidth = 0.5 / viewZoom;
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p1.x + 40 / viewZoom, p1.y);
              ctx.stroke();
              ctx.setLineDash([]);

              ctx.fillStyle = '#a1a1aa';
              ctx.fillText(
                `${ang.toFixed(0)}°`,
                p1.x + 25 / viewZoom,
                p1.y - 6 / viewZoom
              );
            }
          }
        }
      });
    });

    // Helper to draw a single custom dimension annotation on canvas
    const drawCustomDimension = (
      p1: Point,
      p2: Point,
      offset: number,
      isHighlighted: boolean,
      customValueText?: string,
      dimType: 'horizontal' | 'vertical' | 'aligned' = 'aligned'
    ) => {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.1) return;

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      let dP1_offX = p1.x;
      let dP1_offY = p1.y;
      let dP2_offX = p2.x;
      let dP2_offY = p2.y;

      let ux = 0;
      let uy = 0;
      let nx = 0;
      let ny = 0;

      let displayValue = len;

      if (dimType === 'horizontal') {
        displayValue = Math.abs(dx);
        dP1_offX = p1.x;
        dP1_offY = midY + offset;
        dP2_offX = p2.x;
        dP2_offY = midY + offset;

        ux = Math.sign(dx) || 1;
        uy = 0;
        nx = 0;
        ny = Math.sign(offset) || 1;
      } else if (dimType === 'vertical') {
        displayValue = Math.abs(dy);
        dP1_offX = midX + offset;
        dP1_offY = p1.y;
        dP2_offX = midX + offset;
        dP2_offY = p2.y;

        ux = 0;
        uy = Math.sign(dy) || 1;
        nx = Math.sign(offset) || 1;
        ny = 0;
      } else {
        displayValue = len;
        ux = dx / len;
        uy = dy / len;
        nx = -uy;
        ny = ux;

        dP1_offX = p1.x + nx * offset;
        dP1_offY = p1.y + ny * offset;
        dP2_offX = p2.x + nx * offset;
        dP2_offY = p2.y + ny * offset;
      }

      // Draw extension lines (faint dashed lines)
      ctx.save();
      ctx.strokeStyle = '#52525b'; // Zinc-600
      ctx.lineWidth = 1.0 / viewZoom;
      ctx.setLineDash([3 / viewZoom, 3 / viewZoom]);
      ctx.beginPath();
      if (dimType === 'horizontal') {
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p1.x, midY + offset + (5 / viewZoom * (offset < 0 ? -1 : 1)));
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p2.x, midY + offset + (5 / viewZoom * (offset < 0 ? -1 : 1)));
      } else if (dimType === 'vertical') {
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(midX + offset + (5 / viewZoom * (offset < 0 ? -1 : 1)), p1.y);
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(midX + offset + (5 / viewZoom * (offset < 0 ? -1 : 1)), p2.y);
      } else {
        ctx.moveTo(p1.x + nx * (offset * 0.1), p1.y + ny * (offset * 0.1));
        ctx.lineTo(dP1_offX + nx * (5 / viewZoom * (offset < 0 ? -1 : 1)), dP1_offY + ny * (5 / viewZoom * (offset < 0 ? -1 : 1)));
        ctx.moveTo(p2.x + nx * (offset * 0.1), p2.y + ny * (offset * 0.1));
        ctx.lineTo(dP2_offX + nx * (5 / viewZoom * (offset < 0 ? -1 : 1)), dP2_offY + ny * (5 / viewZoom * (offset < 0 ? -1 : 1)));
      }
      ctx.stroke();
      ctx.restore();

      // Draw dimension line (solid line)
      ctx.strokeStyle = isHighlighted ? '#f472b6' : '#db2777'; // pink-400 vs pink-600
      ctx.lineWidth = isHighlighted ? 2.5 / viewZoom : 1.5 / viewZoom;
      ctx.beginPath();
      ctx.moveTo(dP1_offX, dP1_offY);
      ctx.lineTo(dP2_offX, dP2_offY);
      ctx.stroke();

      // Draw stylish slash/tick end markers
      ctx.strokeStyle = isHighlighted ? '#f472b6' : '#db2777';
      ctx.lineWidth = isHighlighted ? 3.0 / viewZoom : 2.0 / viewZoom;
      ctx.beginPath();
      ctx.moveTo(dP1_offX - (ux - nx) * (5 / viewZoom), dP1_offY - (uy - ny) * (5 / viewZoom));
      ctx.lineTo(dP1_offX + (ux - nx) * (5 / viewZoom), dP1_offY + (uy - ny) * (5 / viewZoom));
      ctx.moveTo(dP2_offX - (ux + nx) * (5 / viewZoom), dP2_offY - (uy + ny) * (5 / viewZoom));
      ctx.lineTo(dP2_offX + (ux + nx) * (5 / viewZoom), dP2_offY + (uy + ny) * (5 / viewZoom));
      ctx.stroke();

      // Draw dimension textbox masked over the dimension line
      const textMidX = (dP1_offX + dP2_offX) / 2;
      const textMidY = (dP1_offY + dP2_offY) / 2;
      let textAngle = 0;
      if (dimType === 'horizontal') {
        textAngle = 0;
      } else if (dimType === 'vertical') {
        textAngle = -Math.PI / 2;
      } else {
        textAngle = Math.atan2(dy, dx);
        if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
          textAngle += Math.PI;
        }
      }

      ctx.save();
      ctx.translate(textMidX, textMidY);
      ctx.rotate(textAngle);

      const valText = customValueText || `${displayValue.toFixed(1)} mm`;
      ctx.font = `bold ${Math.max(10, 11 / viewZoom)}px monospace`;
      const textWidth = ctx.measureText(valText).width;

      // Background card mask
      ctx.fillStyle = '#18181b'; // Zinc-900 matches app background
      ctx.fillRect(-textWidth/2 - 6 / viewZoom, -7 / viewZoom, textWidth + 12 / viewZoom, 14 / viewZoom);

      // Border frame around active dimension label for extra premium polish
      ctx.strokeStyle = isHighlighted ? '#f472b6' : '#ec4899';
      ctx.lineWidth = 1.0 / viewZoom;
      ctx.strokeRect(-textWidth/2 - 6 / viewZoom, -7 / viewZoom, textWidth + 12 / viewZoom, 14 / viewZoom);

      // Text label filled
      ctx.fillStyle = isHighlighted ? '#fbcfe8' : '#f472b6'; // lighter pink vs dark text
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(valText, 0, 0);

      ctx.restore();
    };

    // 7.5 Draw Placed and Preview Dimension Annotations
    // Always show custom dimensions (her durumda gözüksün), independent of showDims checkbox
    // Draw already placed dimensions for current active layer
    dimensions.forEach(d => {
      const isHighlighted = selectedDimensionId === d.id;
      drawCustomDimension(d.p1, d.p2, d.offset, isHighlighted, undefined, d.dimType || 'aligned');
    });

    // Draw active interactive preview if user is inserting a dimension
    if (currentCommand === 'dimension' && hoverCoords) {
      if (clickCount === 1 && dimP1) {
        // Draw dashed indicator from dimP1 to hoverCoords
        ctx.save();
        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth = 1.5 / viewZoom;
        ctx.setLineDash([4 / viewZoom, 4 / viewZoom]);
        ctx.beginPath();
        ctx.moveTo(dimP1.x, dimP1.y);
        ctx.lineTo(hoverCoords.x, hoverCoords.y);
        ctx.stroke();
        ctx.restore();

        // Draw node markers
        ctx.fillStyle = '#ec4899';
        ctx.fillRect(dimP1.x - 4/viewZoom, dimP1.y - 4/viewZoom, 8/viewZoom, 8/viewZoom);

        // Render length text near hover
        ctx.fillStyle = '#f472b6';
        ctx.font = `bold ${Math.max(10, 11 / viewZoom)}px monospace`;
        const dist = Math.hypot(hoverCoords.x - dimP1.x, hoverCoords.y - dimP1.y);
        ctx.fillText(`L: ${dist.toFixed(1)} mm`, hoverCoords.x + 10 / viewZoom, hoverCoords.y - 10 / viewZoom);
      } else if (clickCount === 2 && dimP1 && dimP2) {
        // Both points set, previewing offset and placement of dimension line
        const details = getAutoDimensionDetails(dimP1, dimP2, hoverCoords.x, hoverCoords.y);
        drawCustomDimension(dimP1, dimP2, details.offset, true, `📐 ${details.value.toFixed(1)} mm`, details.dimType);
      }
    }

    // Render custom axis selection preview
    if (axisMirrorSelectMode && hoverCoords) {
      ctx.save();
      // If we have selected a first point, draw the custom rubberline to hoverCoords
      if (mirrorFirstPoint) {
        ctx.strokeStyle = '#f97316'; // Orange-500
        ctx.lineWidth = 2.0 / viewZoom;
        ctx.setLineDash([4 / viewZoom, 4 / viewZoom]);
        ctx.beginPath();
        ctx.moveTo(mirrorFirstPoint.x, mirrorFirstPoint.y);
        ctx.lineTo(hoverCoords.x, hoverCoords.y);
        ctx.stroke();

        // Draw node markers
        ctx.fillStyle = '#ea580c'; // Orange-600
        ctx.fillRect(mirrorFirstPoint.x - 5 / viewZoom, mirrorFirstPoint.y - 5 / viewZoom, 10 / viewZoom, 10 / viewZoom);
        
        ctx.fillStyle = '#f97316';
        ctx.font = `bold ${Math.max(10, 11 / viewZoom)}px monospace`;
        ctx.fillText("Ayna Eksen Çizgisi", hoverCoords.x + 12 / viewZoom, hoverCoords.y - 12 / viewZoom);
      } else {
        // Find if hovering over a segment
        const closestSeg = findClosestSegment(hoverCoords, viewZoom);
        if (closestSeg) {
          ctx.strokeStyle = '#f97316'; // Orange-500
          ctx.lineWidth = 4 / viewZoom;
          ctx.beginPath();
          ctx.moveTo(closestSeg.p1.x, closestSeg.p1.y);
          ctx.lineTo(closestSeg.p2.x, closestSeg.p2.y);
          ctx.stroke();

          ctx.fillStyle = '#f97316';
          ctx.font = `bold ${Math.max(10, 11 / viewZoom)}px monospace`;
          ctx.fillText("✨ AYNA EKSENİ OLARAK SEÇ", hoverCoords.x + 12 / viewZoom, hoverCoords.y - 12 / viewZoom);
        } else {
          ctx.fillStyle = '#f97316';
          ctx.font = `bold ${Math.max(10, 11 / viewZoom)}px monospace`;
          ctx.fillText("Ayna ekseni belirlemek için bir çizgiye tıklayın veya 2 nokta ile çizin", hoverCoords.x + 12 / viewZoom, hoverCoords.y - 12 / viewZoom);
        }
      }
      ctx.restore();
    }

    // 8. Draw Right-Click Selection Box
    if (rightClickStart && rightClickEnd) {
      const isCrossing = rightClickEnd.x < rightClickStart.x; // RTL is crossing selection
      const x1 = Math.min(rightClickStart.x, rightClickEnd.x);
      const x2 = Math.max(rightClickStart.x, rightClickEnd.x);
      const y1 = Math.min(rightClickStart.y, rightClickEnd.y);
      const y1_corrected = Math.min(rightClickStart.y, rightClickEnd.y);
      const y2 = Math.max(rightClickStart.y, rightClickEnd.y);
      const w = x2 - x1;
      const h = y2 - y1;

      if (isCrossing) {
        // Green crossing selection style (dotted border, transparent green fill)
        ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
        ctx.setLineDash([4 / viewZoom, 4 / viewZoom]);
      } else {
        // Blue window selection style (solid border, transparent blue fill)
        ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.85)';
        ctx.setLineDash([]);
      }
      ctx.lineWidth = 1.5 / viewZoom;
      ctx.fillRect(x1, y1, w, h);
      ctx.strokeRect(x1, y1, w, h);
      ctx.setLineDash([]);

      // Draw helper text over selection box
      ctx.fillStyle = isCrossing ? '#10b981' : '#3b82f6';
      ctx.font = `bold ${Math.max(9, 10 / viewZoom)}px monospace`;
      ctx.fillText(
        isCrossing ? "Kesişenleri Seç (Crossing)" : "İçindekileri Seç (Window)",
        x1 + 4 / viewZoom,
        y1 - 4 / viewZoom
      );
    }

    // Draw Rotation Center indicator if defined
    if (rotationCenter) {
      ctx.save();
      ctx.strokeStyle = '#f59e0b'; // Amber-500
      ctx.lineWidth = 1.5 / viewZoom;
      ctx.setLineDash([3 / viewZoom, 3 / viewZoom]);
      
      // Draw crosshair lines
      ctx.beginPath();
      ctx.moveTo(rotationCenter.x - 12 / viewZoom, rotationCenter.y);
      ctx.lineTo(rotationCenter.x + 12 / viewZoom, rotationCenter.y);
      ctx.moveTo(rotationCenter.x, rotationCenter.y - 12 / viewZoom);
      ctx.lineTo(rotationCenter.x, rotationCenter.y + 12 / viewZoom);
      ctx.stroke();

      // Draw outer circle
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(rotationCenter.x, rotationCenter.y, 8 / viewZoom, 0, 2 * Math.PI);
      ctx.stroke();

      // Draw solid center dot
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(rotationCenter.x, rotationCenter.y, 3 / viewZoom, 0, 2 * Math.PI);
      ctx.fill();

      // Text label "DÖNDÜRME MERKEZİ"
      ctx.fillStyle = '#f59e0b';
      ctx.font = `bold ${Math.max(9, 10 / viewZoom)}px sans-serif`;
      ctx.fillText("🔄 DÖNDÜRME MERKEZİ", rotationCenter.x + 12 / viewZoom, rotationCenter.y - 12 / viewZoom);
      ctx.restore();
    }

    // Draw Point Selective Move / Copy Live Preview
    if ((movePointSelectMode === 'target_point' || copyPointSelectMode === 'target_point') && baseSelectionPoint && hoverCoords) {
      const dx = hoverCoords.x - baseSelectionPoint.x;
      const dy = hoverCoords.y - baseSelectionPoint.y;

      // Draw vector dashed line in orange with a helper circle at base point
      ctx.save();
      ctx.strokeStyle = '#f97316'; // Orange-500
      ctx.lineWidth = 1.5 / viewZoom;
      ctx.setLineDash([5 / viewZoom, 5 / viewZoom]);
      
      // Draw a crosshair or small circle at base point
      ctx.beginPath();
      ctx.arc(baseSelectionPoint.x, baseSelectionPoint.y, 6 / viewZoom, 0, 2 * Math.PI);
      ctx.stroke();

      // Draw dashed line from base to hoverCoords
      ctx.beginPath();
      ctx.moveTo(baseSelectionPoint.x, baseSelectionPoint.y);
      ctx.lineTo(hoverCoords.x, hoverCoords.y);
      ctx.stroke();
      
      // Draw a target dot at mouse/hover
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(hoverCoords.x, hoverCoords.y, 4 / viewZoom, 0, 2 * Math.PI);
      ctx.fill();

      // Draw text label of the translation vector delta in mm
      ctx.fillStyle = '#f97316';
      ctx.font = `bold ${Math.max(10, 11 / viewZoom)}px monospace`;
      const dist = Math.hypot(dx, dy);
      ctx.fillText(`dX: ${dx.toFixed(1)} dY: ${dy.toFixed(1)} Dist: ${dist.toFixed(1)} mm`, hoverCoords.x + 10 / viewZoom, hoverCoords.y - 10 / viewZoom);

      // Render ghost shapes shifted by dx, dy
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.6)'; // Ghost orange
      ctx.lineWidth = 2.0 / viewZoom;
      ctx.setLineDash([4 / viewZoom, 4 / viewZoom]);

      const drawGhostPath = (pts: Point[]) => {
        if (pts.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x + dx, pts[0].y + dy);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x + dx, pts[i].y + dy);
        }
        ctx.stroke();
      };

      if (isFinalPointsSelected && finalPoints.length > 0) {
        drawGhostPath(finalPoints);
      }
      if (selectedPathIndices.length > 0 && activeLayer.paths) {
        selectedPathIndices.forEach(idx => {
          const path = activeLayer.paths?.[idx];
          if (path) {
            drawGhostPath(path);
          }
        });
      }

      ctx.restore();
    }

    ctx.restore();
  };

  // 2D Mouse Actions
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1) {
      // Middle wheel panning
      e.preventDefault();
      setIsPanning(true);
      setStartPanX(e.clientX - panX);
      setStartPanY(e.clientY - panY);
      return;
    }

    if (e.button === 2) {
      // Cancel/Cancel draw with Right Click
      e.preventDefault();
      if (currentCommand === 'line' && finalPoints.length > 2 && !isClosed) {
        if (activeLayer.locked) {
          logCommandResponse(`Layer "${activeLayer.name}" is locked. Unlock it to draw or edit.`);
          return;
        }
        saveState();
        const autoClosed = [...finalPoints, { ...finalPoints[0] }];
        setFinalPoints(autoClosed);
        setIsClosed(true);
        setTempPoint(null);
        setDrawMode('drag');
        clearCommand();
        logCommandResponse('Boundary closed using Right-Click endpoint closure.');
      } else if (currentCommand === '') {
        const { x, y } = getVirtualCoords(e.clientX, e.clientY);
        setRightClickStart({ x, y });
        setRightClickEnd({ x, y });
      }
      return;
    }

    if (activeLayer.locked) {
      logCommandResponse(`Layer "${activeLayer.name}" is locked. Please unlock it in the Layer Manager to edit or draw.`);
      return;
    }

    let { x, y } = tempPoint ? tempPoint : getVirtualCoords(e.clientX, e.clientY);

    // Intercept Point Selective Move
    if (movePointSelectMode === 'base_point') {
      const p = snapPoint ? { x: snapPoint.x, y: snapPoint.y } : { x, y };
      setBaseSelectionPoint(p);
      setMovePointSelectMode('target_point');
      logCommandResponse(`Taşıma: Başlangıç noktası seçildi (${p.x.toFixed(1)}, ${p.y.toFixed(1)}). Şimdi hedef / bitiş noktasını tıklayın.`);
      return;
    }
    if (movePointSelectMode === 'target_point' && baseSelectionPoint) {
      const p = snapPoint ? { x: snapPoint.x, y: snapPoint.y } : { x, y };
      const dx = p.x - baseSelectionPoint.x;
      const dy = p.y - baseSelectionPoint.y;
      
      saveState();
      
      // Perform translation on selected entities
      if (isFinalPointsSelected && finalPoints.length > 0) {
        setFinalPoints(prev => prev.map(pt => {
          const u = { ...pt, x: pt.x + dx, y: pt.y + dy };
          if (pt.circleData) {
            u.circleData = {
              center: { x: pt.circleData.center.x + dx, y: pt.circleData.center.y + dy },
              radius: pt.circleData.radius
            };
          }
          if (pt.polygonData) {
            u.polygonData = {
              ...pt.polygonData,
              center: { x: pt.polygonData.center.x + dx, y: pt.polygonData.center.y + dy }
            };
          }
          return u;
        }));
      }
      
      if (selectedPathIndices.length > 0 && activeLayer.paths) {
        setPaths(prev => prev.map((path, idx) => {
          if (selectedPathIndices.includes(idx)) {
            return path.map(pt => {
              const u = { ...pt, x: pt.x + dx, y: pt.y + dy };
              if (pt.circleData) {
                u.circleData = {
                  center: { x: pt.circleData.center.x + dx, y: pt.circleData.center.y + dy },
                  radius: pt.circleData.radius
                };
              }
              if (pt.polygonData) {
                u.polygonData = {
                  ...pt.polygonData,
                  center: { x: pt.polygonData.center.x + dx, y: pt.polygonData.center.y + dy }
                };
              }
              return u;
            });
          }
          return path;
        }));
      }

      setMovePointSelectMode(null);
      setBaseSelectionPoint(null);
      logCommandResponse(`Taşıma işlemi tamamlandı. Obje(ler) dX: ${dx.toFixed(1)} mm, dY: ${dy.toFixed(1)} mm kaydırıldı.`);
      return;
    }

    // Intercept Point Selective Copy
    if (copyPointSelectMode === 'base_point') {
      const p = snapPoint ? { x: snapPoint.x, y: snapPoint.y } : { x, y };
      setBaseSelectionPoint(p);
      setCopyPointSelectMode('target_point');
      logCommandResponse(`Kopyalama: Başlangıç noktası seçildi (${p.x.toFixed(1)}, ${p.y.toFixed(1)}). Şimdi hedef / bitiş noktasını tıklayın.`);
      return;
    }
    if (copyPointSelectMode === 'target_point' && baseSelectionPoint) {
      const p = snapPoint ? { x: snapPoint.x, y: snapPoint.y } : { x, y };
      const dx = p.x - baseSelectionPoint.x;
      const dy = p.y - baseSelectionPoint.y;

      saveState();

      let newlyCreatedIndices: number[] = [];
      const newPaths = activeLayer.paths ? [...activeLayer.paths] : [];

      if (isFinalPointsSelected && finalPoints.length > 0) {
        const duplicated = finalPoints.map(pt => {
          const u = { ...pt, x: pt.x + dx, y: pt.y + dy };
          if (pt.circleData) {
            u.circleData = {
              center: { x: pt.circleData.center.x + dx, y: pt.circleData.center.y + dy },
              radius: pt.circleData.radius
            };
          }
          if (pt.polygonData) {
            u.polygonData = {
              ...pt.polygonData,
              center: { x: pt.polygonData.center.x + dx, y: pt.polygonData.center.y + dy }
            };
          }
          return u;
        });
        newPaths.push(duplicated);
        newlyCreatedIndices.push(newPaths.length - 1);
      }

      if (selectedPathIndices.length > 0 && activeLayer.paths) {
        selectedPathIndices.forEach(idx => {
          const path = activeLayer.paths?.[idx];
          if (path) {
            const duplicated = path.map(pt => {
              const u = { ...pt, x: pt.x + dx, y: pt.y + dy };
              if (pt.circleData) {
                u.circleData = {
                  center: { x: pt.circleData.center.x + dx, y: pt.circleData.center.y + dy },
                  radius: pt.circleData.radius
                };
              }
              if (pt.polygonData) {
                u.polygonData = {
                  ...pt.polygonData,
                  center: { x: pt.polygonData.center.x + dx, y: pt.polygonData.center.y + dy }
                };
              }
              return u;
            });
            newPaths.push(duplicated);
            newlyCreatedIndices.push(newPaths.length - 1);
          }
        });
      }

      setPaths(newPaths);
      setSelectedPathIndices(newlyCreatedIndices);
      setIsFinalPointsSelected(false);

      setCopyPointSelectMode(null);
      setBaseSelectionPoint(null);
      logCommandResponse(`Kopyalama işlemi tamamlandı. ${newlyCreatedIndices.length} adet yeni obje dX: ${dx.toFixed(1)} mm, dY: ${dy.toFixed(1)} mm konumuna kopyalandı.`);
      return;
    }

    if (pendingRotateAngle !== null) {
      applyCadEditRotate(pendingRotateAngle, { x, y });
      setPendingRotateAngle(null);
      return;
    }

    if (activeSegmentStretch || activeSegmentMove) {
      setActiveSegmentStretch(null);
      setActiveSegmentMove(null);
      setSnapPoint(null);
      setTrackedLines([]);
      logCommandResponse("Sürükleme / Esnetme işlemi başarıyla tamamlandı.");
      return;
    }

    if (anchorSelectMode) {
      setCustomAnchor({ x, y });
      setAnchorSelectMode(false);
      logCommandResponse(`Referans Noktası Belirlendi: (X: ${x.toFixed(1)} mm, Y: ${y.toFixed(1)} mm).`);
      return;
    }

    if (rotationCenterSelectMode) {
      setRotationCenter({ x, y });
      setRotationCenterSelectMode(false);
      logCommandResponse(`Döndürme merkez noktası seçildi: (X: ${x.toFixed(1)} mm, Y: ${y.toFixed(1)} mm).`);
      return;
    }

    if (axisMirrorSelectMode) {
      // First check if user clicked close to an existing segment to use as mirror axis
      const closestSeg = findClosestSegment({ x, y }, viewZoom);
      if (closestSeg) {
        // Success! Use the segment's start and end points as the mirror line
        applyCadEditMirrorAcrossLine(closestSeg.p1, closestSeg.p2);
        setAxisMirrorSelectMode(false);
        setMirrorFirstPoint(null);
        return;
      }

      if (!mirrorFirstPoint) {
        setMirrorFirstPoint({ x, y });
        logCommandResponse(`Ayna ekseninin ilk noktası seçildi: (X: ${x.toFixed(1)} mm, Y: ${y.toFixed(1)} mm). Eksen çizgisini tamamlamak için ikinci bir noktaya tıklayın veya bir çizgi üzerine tıklayarak ekseni belirleyin.`);
      } else {
        applyCadEditMirrorAcrossLine(mirrorFirstPoint, { x, y });
        setAxisMirrorSelectMode(false);
        setMirrorFirstPoint(null);
      }
      return;
    }

    // Dynamic Trim / Extend clicks
    if (currentCommand === 'trim') {
      applyTrimAtPoint({ x, y });
      return;
    }
    if (currentCommand === 'extend') {
      applyExtendAtPoint({ x, y });
      return;
    }

    // Apply Orthogonal snaps if ORTHO is mode
    if (orthoSnap && finalPoints.length > 0) {
      const prev = finalPoints[finalPoints.length - 1];
      if (Math.abs(x - prev.x) > Math.abs(y - prev.y)) {
        y = prev.y;
      } else {
        x = prev.x;
      }
    }

    // Direct geometric commands entry
    if (currentCommand !== '') {
      if (currentCommand === 'line') {
        if (finalPoints.length > 2 && snapPoint?.type === 'end' && snapPoint.x === finalPoints[0].x) {
          saveState([...finalPoints, { x: snapPoint.x, y: snapPoint.y }], true, 0);
          setFinalPoints((prev) => [...prev, { x: snapPoint.x, y: snapPoint.y }]);
          setIsClosed(true);
          setTempPoint(null);
          setDrawMode('drag');
          clearCommand();
          logCommandResponse('Continuous path successfully closed.');
        } else {
          saveState([...finalPoints, { x, y }]);
          setFinalPoints((prev) => [...prev, { x, y }]);
        }
      } else if (currentCommand === 'rect') {
        if (clickCount === 0) {
          setFinalPoints([{ x, y }]);
          setClickCount(1);
        } else {
          const p1 = finalPoints[0];
          const rectId = 'rect_' + Math.random().toString(36).substring(2, 9);
          const polyRect = [
            { x: p1.x, y: p1.y, rectData: { id: rectId, vertexIndex: 0 } },
            { x: x, y: p1.y, rectData: { id: rectId, vertexIndex: 1 } },
            { x: x, y: y, rectData: { id: rectId, vertexIndex: 2 } },
            { x: p1.x, y: y, rectData: { id: rectId, vertexIndex: 3 } },
            { x: p1.x, y: p1.y, rectData: { id: rectId, vertexIndex: 4 } },
          ];
          saveState(polyRect, true, 0);
          setFinalPoints(polyRect);
          setIsClosed(true);
          setClickCount(0);
          setTempPoint(null);
          setDrawMode('drag');
          clearCommand();
          logCommandResponse('Rectangle added to workspace.');
        }
      } else if (currentCommand === 'circle' || currentCommand === 'polygon') {
        if (clickCount === 0) {
          setFinalPoints([{ x, y }]);
          setClickCount(1);
        } else {
          const center = finalPoints[0];
          const radius = Math.hypot(x - center.x, y - center.y);
          const sides = currentCommand === 'circle' ? 64 : polygonSides;
          const points: Point[] = [];
          const polyId = 'poly_' + Math.random().toString(36).substring(2, 9);
          const initialAngle = currentCommand === 'polygon' ? Math.atan2(y - center.y, x - center.x) : 0;
          const isMidpoint = currentCommand === 'polygon' && polygonType === 'midpoint';
          const drawRadius = isMidpoint ? radius / Math.cos(Math.PI / sides) : radius;
          const startAngle = isMidpoint ? initialAngle - Math.PI / sides : initialAngle;

          for (let i = 0; i <= sides; i++) {
            const angle = startAngle + (i * Math.PI * 2) / sides;
            points.push({
              x: center.x + drawRadius * Math.cos(angle),
              y: center.y + drawRadius * Math.sin(angle),
              isCurvePoint: currentCommand === 'circle',
              circleData: currentCommand === 'circle' ? { center: { x: center.x, y: center.y }, radius } : undefined,
              polygonData: currentCommand === 'polygon' ? {
                id: polyId,
                center: { x: center.x, y: center.y },
                radius: drawRadius,
                initialAngle: startAngle,
                sides,
                vertexIndex: i % sides,
                polygonType: polygonType
              } : undefined
            });
          }
          saveState(points, true, 0);
          setFinalPoints(points);
          setIsClosed(true);
          setClickCount(0);
          setTempPoint(null);
          setDrawMode('drag');
          clearCommand();
          // Select one of the circle points so they see circle dimension controls immediately
          setSelectedVertexIdx(0);
          setSelectedPathIdx(-1);
          logCommandResponse(`${currentCommand === 'circle' ? 'Circle' : `Polygon (${polygonSides} sides)`} added to workspace.`);
        }
      } else if (currentCommand === 'dimension') {
        const pt = snapPoint ? { x: snapPoint.x, y: snapPoint.y } : { x, y };
        // If coordinate is very close to X/Y axes (e.g. within 12 pixels), snap exactly to the axis coordinate for easy measurement
        const axisSnapTol = 12 / viewZoom;
        if (Math.abs(pt.x) < axisSnapTol) {
          pt.x = 0;
        }
        if (Math.abs(pt.y) < axisSnapTol) {
          pt.y = 0;
        }

        if (clickCount === 0) {
          setDimP1(pt);
          setClickCount(1);
          logCommandResponse(`Ölçülendirme: 1. Nokta seçildi (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}). Bitiş noktasını seçin.`);
        } else if (clickCount === 1) {
          setDimP2(pt);
          setClickCount(2);
          logCommandResponse("Ölçülendirme: 2. Nokta seçildi. Şimdi ölçü çizgisini konumlandırmak için ekranda bir yere tıklayın.");
        } else if (clickCount === 2) {
          // Calculate offset, type, and value dynamically using auto detection
          if (dimP1 && dimP2) {
            const details = getAutoDimensionDetails(dimP1, dimP2, x, y);
            const newDim = {
              id: Math.random().toString(36).substring(2, 9),
              p1: { ...dimP1 },
              p2: { ...dimP2 },
              offset: details.offset,
              value: details.value,
              dimType: details.dimType
            };
            saveState();
            setDimensions(prev => [...prev, newDim]);
            logCommandResponse(`Ölçülendirme başarıyla eklendi! Ölçü: ${details.value.toFixed(1)} mm (${details.dimType === 'horizontal' ? 'Yatay' : details.dimType === 'vertical' ? 'Dikey' : 'Hizalı'}).`);
          }
          setDimP1(null);
          setDimP2(null);
          setClickCount(0);
          setTempPoint(null);
          clearCommand();
        }
      }
      return;
    }

    // Standard drawing sandbox techniques
    if (drawMode === 'drag') {
      // Check if clicked any placed dimension annotation on active layer
      let clickedDim = null;
      for (const d of dimensions) {
        const geom = getDimensionLinePoints(d.p1, d.p2, d.offset, d.dimType || 'aligned');
        // If click is within 15 virtual units or 18/viewZoom screen units
        if (Math.hypot(geom.midX - x, geom.midY - y) < Math.max(15, 18 / viewZoom)) {
          clickedDim = d;
          break;
        }
      }

      if (clickedDim) {
        setSelectedDimensionId(clickedDim.id);
        const dType = clickedDim.dimType || 'aligned';
        let actualLen = Math.hypot(clickedDim.p2.x - clickedDim.p1.x, clickedDim.p2.y - clickedDim.p1.y);
        if (dType === 'horizontal') {
          actualLen = Math.abs(clickedDim.p2.x - clickedDim.p1.x);
        } else if (dType === 'vertical') {
          actualLen = Math.abs(clickedDim.p2.y - clickedDim.p1.y);
        }
        setEditingDimensionValueInput(actualLen.toFixed(1));
        logCommandResponse(`Ölçülendirme seçildi. Değeri girerek konumlandırmayı ayarlayabilirsiniz.`);
        return;
      }

      let found = false;
      // Seek dragging point node in finalPoints
      if (finalPoints.length > 0) {
        for (let i = 0; i < finalPoints.length; i++) {
          if (Math.hypot(finalPoints[i].x - x, finalPoints[i].y - y) < 15 / viewZoom) {
            dragIndexRef.current = i;
            dragPathIndexRef.current = -1;
            setSelectedVertexIdx(i);
            setSelectedPathIdx(-1);
            found = true;
            break;
          }
        }
      }
      // Seek dragging point node in finished paths
      if (!found && activeLayer.paths) {
        for (let pathIdx = 0; pathIdx < activeLayer.paths.length; pathIdx++) {
          const path = activeLayer.paths[pathIdx];
          for (let i = 0; i < path.length; i++) {
            if (Math.hypot(path[i].x - x, path[i].y - y) < 15 / viewZoom) {
              dragIndexRef.current = i;
              dragPathIndexRef.current = pathIdx;
              setSelectedVertexIdx(i);
              setSelectedPathIdx(pathIdx);
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }

      // Drag segment or entire shape (interactive CAD popup prompt for Stretch vs Move)
      if (!found) {
        let clickedPathIdx: number | null = null;
        let clickedSegmentIdx = -1;
        let isClickOnShape = false;
        let originalPointsToSave: Point[] = [];

        // Check if cursor clicked finalPoints
        if (finalPoints.length > 1) {
          let minSegmentDist = Infinity;
          let minSegIdx = -1;
          for (let i = 0; i < finalPoints.length; i++) {
            if (i === finalPoints.length - 1 && !isClosed) continue;
            const nextIdx = (i + 1) % finalPoints.length;
            const seg = getClosestPointOnSegment({ x, y }, finalPoints[i], finalPoints[nextIdx]);
            if (seg.dist < minSegmentDist) {
              minSegmentDist = seg.dist;
              minSegIdx = i;
            }
          }
          const circlePt = finalPoints.find(p => p.circleData);
          if (circlePt && circlePt.circleData) {
            const distToCenter = Math.hypot(x - circlePt.circleData.center.x, y - circlePt.circleData.center.y);
            if (Math.abs(distToCenter - circlePt.circleData.radius) < 15 / viewZoom || distToCenter < 15 / viewZoom) {
              minSegmentDist = 0;
              minSegIdx = 0;
            }
          }

          if (minSegmentDist < 15 / viewZoom) {
            clickedPathIdx = -1;
            clickedSegmentIdx = minSegIdx;
            isClickOnShape = true;
            originalPointsToSave = finalPoints.map(p => ({ ...p }));
          }
        }

        // Check if cursor clicked other paths
        if (!isClickOnShape && activeLayer.paths) {
          for (let pathIdx = 0; pathIdx < activeLayer.paths.length; pathIdx++) {
            const path = activeLayer.paths[pathIdx];
            if (path.length > 1) {
              let minSegmentDist = Infinity;
              let minSegIdx = -1;
              for (let i = 0; i < path.length; i++) {
                const nextIdx = (i + 1) % path.length;
                const seg = getClosestPointOnSegment({ x, y }, path[i], path[nextIdx]);
                if (seg.dist < minSegmentDist) {
                  minSegmentDist = seg.dist;
                  minSegIdx = i;
                }
              }
              const circlePt = path.find(p => p.circleData);
              if (circlePt && circlePt.circleData) {
                const distToCenter = Math.hypot(x - circlePt.circleData.center.x, y - circlePt.circleData.center.y);
                if (Math.abs(distToCenter - circlePt.circleData.radius) < 15 / viewZoom || distToCenter < 15 / viewZoom) {
                  minSegmentDist = 0;
                  minSegIdx = 0;
                }
              }

              if (minSegmentDist < 15 / viewZoom) {
                clickedPathIdx = pathIdx;
                clickedSegmentIdx = minSegIdx;
                isClickOnShape = true;
                originalPointsToSave = path.map(p => ({ ...p }));
                break;
              }
            }
          }
        }

        if (isClickOnShape && clickedPathIdx !== null) {
          setEditingPathIdx(clickedPathIdx);
          setEditingSegmentIdx(clickedSegmentIdx);
          const activeShapePoints = clickedPathIdx === -1 ? finalPoints : (activeLayer.paths ? activeLayer.paths[clickedPathIdx] : []);
          if (activeShapePoints && activeShapePoints.length > 1) {
            const p1 = activeShapePoints[clickedSegmentIdx];
            const p2 = activeShapePoints[(clickedSegmentIdx + 1) % activeShapePoints.length];
            if (p1 && p2) {
              const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
              setEditingDimensionValue(d.toFixed(1));
            }
          }

          if (false) { // Cancel stretch - always move
            saveState();
            setActiveSegmentStretch({
              pathIdx: clickedPathIdx,
              segmentIdx: clickedSegmentIdx,
              startX: x,
              startY: y,
              originalPoints: originalPointsToSave
            });
            logCommandResponse("Kenar Esnetme (Stretch) Aktif: Kenarı gerip uzatmak için imlecinizi hareket ettirin.");
            found = true;
          } else {
            saveState();

            // Determine if clicked item is part of the multi-selection
            const isClickedInSelection = clickedPathIdx === -1 
              ? isFinalPointsSelected 
              : selectedPathIndices.includes(clickedPathIdx);

            const dragItems: Array<{ type: 'finalPoints' | 'path'; pathIdx: number; originalPoints: Point[] }> = [];

            if (isClickedInSelection) {
              // Drag all selected items as a single cohesive unit
              if (isFinalPointsSelected && finalPoints.length > 0) {
                dragItems.push({
                  type: 'finalPoints',
                  pathIdx: -1,
                  originalPoints: finalPoints.map(p => ({ ...p }))
                });
              }
              selectedPathIndices.forEach(idx => {
                if (activeLayer.paths && activeLayer.paths[idx]) {
                  dragItems.push({
                    type: 'path',
                    pathIdx: idx,
                    originalPoints: activeLayer.paths[idx].map(p => ({ ...p }))
                  });
                }
              });
              logCommandResponse(`Şekil Taşıma (Oynat): ${dragItems.length} seçili obje beraber taşınıyor.`);
            } else {
              // Drag the clicked shape along with any shapes joined to it (integrity support)
              const { selectFinalPoints, selectPathIndices } = getJoinedIndices(clickedPathIdx);

              if (selectFinalPoints && finalPoints.length > 0) {
                dragItems.push({
                  type: 'finalPoints',
                  pathIdx: -1,
                  originalPoints: finalPoints.map(p => ({ ...p }))
                });
              }
              selectPathIndices.forEach(idx => {
                if (activeLayer.paths && activeLayer.paths[idx]) {
                  dragItems.push({
                    type: 'path',
                    pathIdx: idx,
                    originalPoints: activeLayer.paths[idx].map(p => ({ ...p }))
                  });
                }
              });

              setIsFinalPointsSelected(selectFinalPoints);
              setSelectedPathIndices(selectPathIndices);
              setSelectedPathIdx(selectPathIndices.length > 0 ? selectPathIndices[0] : -1);

              if (selectFinalPoints && selectPathIndices.length > 0) {
                logCommandResponse(`Bütünlük Korundu: Birbiriyle bütünleşik ${selectPathIndices.length + 1} parça seçildi ve beraber taşınıyor.`);
              } else if (selectPathIndices.length > 1) {
                logCommandResponse(`Bütünlük Korundu: Birbiriyle bütünleşik ${selectPathIndices.length} parça seçildi ve beraber taşınıyor.`);
              } else {
                logCommandResponse("Taşıma (Move) Aktif: Sürükleyerek konumlandırın.");
              }
            }

            dragEntirePathRef.current = {
              startX: x,
              startY: y,
              items: dragItems
            };
            found = true;
          }
        }
      }
    } else {
      // Freehand drawing initialization
      saveState([], false, 0);
      setFinalPoints([]);
      setIsClosed(false);
      isDrawingRef.current = true;
      setRawPoints([{ x, y }]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPanX(e.clientX - startPanX);
      setPanY(e.clientY - startPanY);
      return;
    }

    if (rightClickStart) {
      const pos = getVirtualCoords(e.clientX, e.clientY);
      setRightClickEnd(pos);
      setHoverCoords(pos);
      
      // If dragged to the right, expand and activate 3D solid rendering!
      if (pos.x - rightClickStart.x > 40) {
        setSplitRatio((prev) => {
          if (prev > 45) {
            logCommandResponse("3D Drawing Area (3D Katı Model) mouse sağa çekilerek aktif edildi.");
            return 45; // Set 2D width to 45%, giving 3D space 55%
          }
          return prev;
        });
      }
      return;
    }

    const rawCoords = getVirtualCoords(e.clientX, e.clientY);
    let x = rawCoords.x;
    let y = rawCoords.y;
    setHoverCoords({ x, y });

    if (activeSegmentStretch) {
      const { pathIdx, segmentIdx, startX, startY, originalPoints } = activeSegmentStretch;
      
      const otherPaths = pathIdx === -1 
        ? (activeLayer.paths || []) 
        : (activeLayer.paths || []).filter((_, idx) => idx !== pathIdx);
      const snapPointsArray = pathIdx === -1 ? [] : finalPoints;

      const snapData = calculateSnaps(
        x,
        y,
        snapPointsArray,
        pathIdx === -1 ? false : isClosed,
        -1,
        smartSnap,
        10 / viewZoom,
        otherPaths,
        gridSnap,
        50,
        customAnchor,
        snapToggles
      );
      const snapX = snapData.x;
      const snapY = snapData.y;
      setSnapPoint(snapData.snapPoint);
      setTrackedLines(snapData.trackedLines);
      setHoverCoords({ x: snapX, y: snapY });

      const dx = snapX - startX;
      const dy = snapY - startY;

      const i = segmentIdx;
      const isClosedLoop = pathIdx !== -1 || isClosed;
      const j = isClosedLoop 
        ? (segmentIdx + 1) % originalPoints.length 
        : segmentIdx + 1;

      const oldPosList: { cx: number; cy: number; nx: number; ny: number }[] = [];
      const updated = originalPoints.map((p, idx) => {
        if (idx === i || (idx === j && j < originalPoints.length)) {
          const updatedPt: Point = {
            ...p,
            x: p.x + dx,
            y: p.y + dy,
          };
          oldPosList.push({ cx: p.x, cy: p.y, nx: p.x + dx, ny: p.y + dy });
          if (p.circleData) {
            updatedPt.circleData = {
              center: {
                x: p.circleData.center.x + dx,
                y: p.circleData.center.y + dy
              },
              radius: p.circleData.radius
            };
          }
          return updatedPt;
        }
        return p;
      });

      if (pathIdx === -1) {
        setFinalPoints(updated);

        // Update coincident paths
        const updatedPaths = activeLayer.paths ? activeLayer.paths.map(path => {
          return path.map(pt => {
            for (const item of oldPosList) {
              if (Math.hypot(pt.x - item.cx, pt.y - item.cy) < 0.05) {
                return { ...pt, x: item.nx, y: item.ny };
              }
            }
            return pt;
          });
        }) : [];
        setPaths(updatedPaths);
      } else {
        const nextPaths = activeLayer.paths ? [...activeLayer.paths] : [];
        nextPaths[pathIdx] = updated;

        // Update coincident finalPoints
        const nextFinalPoints = finalPoints.map(pt => {
          for (const item of oldPosList) {
            if (Math.hypot(pt.x - item.cx, pt.y - item.cy) < 0.05) {
              return { ...pt, x: item.nx, y: item.ny };
            }
          }
          return pt;
        });
        setFinalPoints(nextFinalPoints);

        // Update other paths
        nextPaths.forEach((path, pIdx) => {
          if (pIdx !== pathIdx) {
            let changed = false;
            const nextPath = path.map(pt => {
              for (const item of oldPosList) {
                if (Math.hypot(pt.x - item.cx, pt.y - item.cy) < 0.05) {
                  changed = true;
                  return { ...pt, x: item.nx, y: item.ny };
                }
              }
              return pt;
            });
            if (changed) {
              nextPaths[pIdx] = nextPath;
            }
          }
        });
        setPaths(nextPaths);
      }
      return;
    }

    if (activeSegmentMove) {
      const { pathIdx, startX, startY, originalPoints } = activeSegmentMove;

      const otherPaths = pathIdx === -1 
        ? (activeLayer.paths || []) 
        : (activeLayer.paths || []).filter((_, idx) => idx !== pathIdx);
      const snapPointsArray = pathIdx === -1 ? [] : finalPoints;

      const snapData = calculateSnaps(
        x,
        y,
        snapPointsArray,
        pathIdx === -1 ? false : isClosed,
        -1,
        smartSnap,
        10 / viewZoom,
        otherPaths,
        gridSnap,
        50,
        customAnchor,
        snapToggles
      );
      const snapX = snapData.x;
      const snapY = snapData.y;
      setSnapPoint(snapData.snapPoint);
      setTrackedLines(snapData.trackedLines);
      setHoverCoords({ x: snapX, y: snapY });

      const dx = snapX - startX;
      const dy = snapY - startY;

      const updated = originalPoints.map((p) => {
        const updatedPt: Point = {
          ...p,
          x: p.x + dx,
          y: p.y + dy,
        };
        if (p.circleData) {
          updatedPt.circleData = {
            center: {
              x: p.circleData.center.x + dx,
              y: p.circleData.center.y + dy
            },
            radius: p.circleData.radius
          };
        }
        return updatedPt;
      });

      if (pathIdx === -1) {
        setFinalPoints(updated);
      } else {
        const updatedPaths = activeLayer.paths ? [...activeLayer.paths] : [];
        updatedPaths[pathIdx] = updated;
        setPaths(updatedPaths);
      }
      return;
    }

    if (dragEntirePathRef.current) {
      const { startX, startY, items } = dragEntirePathRef.current;
      
      const otherPaths = (activeLayer.paths || []).filter((_, idx) => !items.some(item => item.type === 'path' && item.pathIdx === idx));
      const snapPointsArray = items.some(item => item.type === 'finalPoints') ? [] : finalPoints;

      const snapData = calculateSnaps(
        x,
        y,
        snapPointsArray,
        items.some(item => item.type === 'finalPoints') ? false : isClosed,
        -1,
        smartSnap,
        10 / viewZoom,
        otherPaths,
        gridSnap,
        50,
        customAnchor,
        snapToggles
      );
      const snapX = snapData.x;
      const snapY = snapData.y;
      setSnapPoint(snapData.snapPoint);
      setTrackedLines(snapData.trackedLines);
      setHoverCoords({ x: snapX, y: snapY });

      const dx = snapX - startX;
      const dy = snapY - startY;

      const updatedPaths = activeLayer.paths ? [...activeLayer.paths] : [];

      items.forEach(item => {
        const translatedPoints = item.originalPoints.map(p => {
          const updatedPt: Point = {
            ...p,
            x: p.x + dx,
            y: p.y + dy,
          };
          if (p.circleData) {
            updatedPt.circleData = {
              center: {
                x: p.circleData.center.x + dx,
                y: p.circleData.center.y + dy
              },
              radius: p.circleData.radius
            };
          }
          if (p.polygonData) {
            updatedPt.polygonData = {
              ...p.polygonData,
              center: {
                x: p.polygonData.center.x + dx,
                y: p.polygonData.center.y + dy
              }
            };
          }
          return updatedPt;
        });

        if (item.type === 'finalPoints') {
          setFinalPoints(translatedPoints);
        } else {
          updatedPaths[item.pathIdx] = translatedPoints;
        }
      });

      if (items.some(item => item.type === 'path')) {
        setPaths(updatedPaths);
      }
      return;
    }

    // Smart track constraint
    setTrackedLines([]);
    setSnapPoint(null);

    if (currentCommand !== '') {
      // Snap evaluation index exclusions
      const snapData = calculateSnaps(x, y, finalPoints, isClosed, -1, smartSnap, 10 / viewZoom, activeLayer.paths, gridSnap, gridSize, customAnchor, snapToggles);
      x = snapData.x;
      y = snapData.y;

      if (currentCommand === 'dimension') {
        const axisSnapTol = 12 / viewZoom;
        if (Math.abs(x) < axisSnapTol) {
          x = 0;
        }
        if (Math.abs(y) < axisSnapTol) {
          y = 0;
        }
      }

      setSnapPoint(snapData.snapPoint);
      setTrackedLines(snapData.trackedLines);
      setTempPoint({ x, y });
    } else {
      if (drawMode === 'drag' && dragIndexRef.current !== -1) {
        const pathIdx = dragPathIndexRef.current;

        if (pathIdx === -1) {
          // Compute snapping while dragging vertices
          const snapData = calculateSnaps(x, y, finalPoints, isClosed, dragIndexRef.current, smartSnap, 10 / viewZoom, activeLayer.paths, gridSnap, gridSize, customAnchor, snapToggles);
          x = snapData.x;
          y = snapData.y;
          setSnapPoint(snapData.snapPoint);
          setTrackedLines(snapData.trackedLines);

          const updated = [...finalPoints];
          const draggedPt = updated[dragIndexRef.current];
          if (!draggedPt) return;

          const cx = draggedPt.x;
          const cy = draggedPt.y;

          if (draggedPt.rectData) {
            const rId = draggedPt.rectData.id;
            const dragVIdx = draggedPt.rectData.vertexIndex;

            const rectIndices: number[] = [];
            for (let i = 0; i < updated.length; i++) {
              if (updated[i].rectData?.id === rId) {
                rectIndices.push(i);
              }
            }

            if (rectIndices.length === 5) {
              const idxMap: { [key: number]: number } = {};
              rectIndices.forEach(idx => {
                idxMap[updated[idx].rectData!.vertexIndex] = idx;
              });

              if (idxMap[0] !== undefined && idxMap[1] !== undefined && idxMap[2] !== undefined && idxMap[3] !== undefined && idxMap[4] !== undefined) {
                const dragIndexMapped = dragVIdx === 4 ? 0 : dragVIdx;

                const origIdxMap: { [key: number]: Point } = {};
                rectIndices.forEach(idx => {
                  origIdxMap[updated[idx].rectData!.vertexIndex] = finalPoints[idx];
                });

                const oppVIdx = (dragIndexMapped + 2) % 4;
                const prevVIdx = (dragIndexMapped + 3) % 4;
                const nextVIdx = (dragIndexMapped + 1) % 4;

                const P_opp = origIdxMap[oppVIdx];
                const P_prev = origIdxMap[prevVIdx];
                const P_next = origIdxMap[nextVIdx];

                const vec_u = { x: P_prev.x - P_opp.x, y: P_prev.y - P_opp.y };
                const vec_v = { x: P_next.x - P_opp.x, y: P_next.y - P_opp.y };

                const len_u = Math.hypot(vec_u.x, vec_u.y);
                const len_v = Math.hypot(vec_v.x, vec_v.y);

                const u = len_u > 0.0001 ? { x: vec_u.x / len_u, y: vec_u.y / len_u } : { x: 1, y: 0 };
                const v = len_v > 0.0001 ? { x: vec_v.x / len_v, y: vec_v.y / len_v } : { x: 0, y: 1 };

                const d = { x: x - P_opp.x, y: y - P_opp.y };

                const proj_u = d.x * u.x + d.y * u.y;
                const proj_v = d.x * v.x + d.y * v.y;

                const P_drag_new = { x, y };
                const P_prev_new = { x: P_opp.x + proj_u * u.x, y: P_opp.y + proj_u * u.y };
                const P_next_new = { x: P_opp.x + proj_v * v.x, y: P_opp.y + proj_v * v.y };

                const oldPosList: { cx: number; cy: number; nx: number; ny: number }[] = [];

                const recordChange = (vIdx: number, newPt: { x: number; y: number }) => {
                  const idx = idxMap[vIdx];
                  oldPosList.push({ cx: updated[idx].x, cy: updated[idx].y, nx: newPt.x, ny: newPt.y });
                  updated[idx] = { ...updated[idx], x: newPt.x, y: newPt.y };
                };

                recordChange(dragIndexMapped, P_drag_new);
                recordChange(prevVIdx, P_prev_new);
                recordChange(nextVIdx, P_next_new);
                
                updated[idxMap[4]] = { ...updated[idxMap[4]], x: updated[idxMap[0]].x, y: updated[idxMap[0]].y };

                oldPosList.forEach((item) => {
                  for (let k = 0; k < updated.length; k++) {
                    if (updated[k].rectData?.id !== rId) {
                      if (Math.hypot(updated[k].x - item.cx, updated[k].y - item.cy) < 0.05) {
                        updated[k] = { ...updated[k], x: item.nx, y: item.ny };
                      }
                    }
                  }
                });

                setFinalPoints(updated);

                const updatedPaths = activeLayer.paths ? activeLayer.paths.map((path) => {
                  return path.map((pt) => {
                    for (const item of oldPosList) {
                      if (pt.rectData?.id !== rId && Math.hypot(pt.x - item.cx, pt.y - item.cy) < 0.05) {
                        return { ...pt, x: item.nx, y: item.ny };
                      }
                    }
                    return pt;
                  });
                }) : [];
                setPaths(updatedPaths);
              }
            }
          } else if (draggedPt.polygonData) {
            const polyId = draggedPt.polygonData.id;
            const sides = draggedPt.polygonData.sides;
            const vIndex = draggedPt.polygonData.vertexIndex;
            const center = draggedPt.polygonData.center;

            // Calculate new radius and angle
            const newRadius = Math.hypot(x - center.x, y - center.y);
            const newAngle = Math.atan2(y - center.y, x - center.x);
            const newInitialAngle = newAngle - (vIndex * Math.PI * 2) / sides;

            const oldPosList: { cx: number; cy: number; nx: number; ny: number }[] = [];

            // Update all vertices belonging to this polygon
            for (let i = 0; i < updated.length; i++) {
              if (updated[i].polygonData?.id === polyId) {
                const currentVIndex = updated[i].polygonData.vertexIndex;
                const targetAngle = newInitialAngle + (currentVIndex * Math.PI * 2) / sides;
                const nx = center.x + newRadius * Math.cos(targetAngle);
                const ny = center.y + newRadius * Math.sin(targetAngle);
                oldPosList.push({ cx: updated[i].x, cy: updated[i].y, nx, ny });
                updated[i] = {
                  ...updated[i],
                  x: nx,
                  y: ny,
                  polygonData: {
                    ...updated[i].polygonData,
                    radius: newRadius,
                    initialAngle: newInitialAngle
                  }
                };
              }
            }

            // Sync endpoints
            if (dragIndexRef.current === 0) {
              updated[updated.length - 1] = { ...updated[0] };
            }
            if (dragIndexRef.current === updated.length - 1) {
              updated[0] = { ...updated[updated.length - 1] };
            }

            // Move coincident vertices in updated (finalPoints)
            oldPosList.forEach((item) => {
              for (let k = 0; k < updated.length; k++) {
                if (updated[k].polygonData?.id !== polyId) {
                  if (Math.hypot(updated[k].x - item.cx, updated[k].y - item.cy) < 0.05) {
                    updated[k] = { ...updated[k], x: item.nx, y: item.ny };
                  }
                }
              }
            });

            setFinalPoints(updated);

            // Move coincident vertices in other paths within updatedPaths
            const updatedPaths = activeLayer.paths ? activeLayer.paths.map((path) => {
              return path.map((pt) => {
                for (const item of oldPosList) {
                  if (pt.polygonData?.id !== polyId && Math.hypot(pt.x - item.cx, pt.y - item.cy) < 0.05) {
                    return { ...pt, x: item.nx, y: item.ny };
                  }
                }
                return pt;
              });
            }) : [];
            setPaths(updatedPaths);

          } else {
            // Standard single vertex drag in finalPoints
            const updated = finalPoints.map((pt, i) => {
              if (i === dragIndexRef.current) {
                return { ...pt, x, y };
              }
              if (Math.hypot(pt.x - cx, pt.y - cy) < 0.05) {
                return { ...pt, x, y };
              }
              return pt;
            });

            // Ensure closed chain remains closed on endpoint movements
            if (dragIndexRef.current === 0 || Math.hypot(finalPoints[0].x - cx, finalPoints[0].y - cy) < 0.05) {
              updated[updated.length - 1] = { ...updated[0] };
            }
            if (dragIndexRef.current === updated.length - 1 || Math.hypot(finalPoints[finalPoints.length - 1].x - cx, finalPoints[finalPoints.length - 1].y - cy) < 0.05) {
              updated[0] = { ...updated[updated.length - 1] };
            }

            setFinalPoints(updated);

            // Update coincident paths as well
            const updatedPaths = activeLayer.paths ? activeLayer.paths.map(path => {
              return path.map(pt => {
                if (Math.hypot(pt.x - cx, pt.y - cy) < 0.05) {
                  return { ...pt, x, y };
                }
                return pt;
              });
            }) : [];
            setPaths(updatedPaths);
          }
        } else {
          // Dragging a completed path vertex
          const targetPath = activeLayer.paths ? activeLayer.paths[pathIdx] : [];
          const otherPaths = activeLayer.paths ? activeLayer.paths.filter((_, idx) => idx !== pathIdx) : [];

          const snapData = calculateSnaps(x, y, targetPath, true, dragIndexRef.current, smartSnap, 10 / viewZoom, [finalPoints, ...otherPaths], gridSnap, gridSize, customAnchor, snapToggles);
          x = snapData.x;
          y = snapData.y;
          setSnapPoint(snapData.snapPoint);
          setTrackedLines(snapData.trackedLines);

          const updatedPaths = activeLayer.paths ? [...activeLayer.paths] : [];
          const updatedPath = [...targetPath];
          const draggedPt = updatedPath[dragIndexRef.current];
          if (!draggedPt) return;
          const cx = draggedPt.x;
          const cy = draggedPt.y;

          if (draggedPt && draggedPt.rectData) {
            const rId = draggedPt.rectData.id;
            const dragVIdx = draggedPt.rectData.vertexIndex;

            const rectIndices: number[] = [];
            for (let i = 0; i < updatedPath.length; i++) {
              if (updatedPath[i].rectData?.id === rId) {
                rectIndices.push(i);
              }
            }

            if (rectIndices.length === 5) {
              const idxMap: { [key: number]: number } = {};
              rectIndices.forEach(idx => {
                idxMap[updatedPath[idx].rectData!.vertexIndex] = idx;
              });

              if (idxMap[0] !== undefined && idxMap[1] !== undefined && idxMap[2] !== undefined && idxMap[3] !== undefined && idxMap[4] !== undefined) {
                const dragIndexMapped = dragVIdx === 4 ? 0 : dragVIdx;

                const origIdxMap: { [key: number]: Point } = {};
                rectIndices.forEach(idx => {
                  origIdxMap[updatedPath[idx].rectData!.vertexIndex] = targetPath[idx];
                });

                const oppVIdx = (dragIndexMapped + 2) % 4;
                const prevVIdx = (dragIndexMapped + 3) % 4;
                const nextVIdx = (dragIndexMapped + 1) % 4;

                const P_opp = origIdxMap[oppVIdx];
                const P_prev = origIdxMap[prevVIdx];
                const P_next = origIdxMap[nextVIdx];

                const vec_u = { x: P_prev.x - P_opp.x, y: P_prev.y - P_opp.y };
                const vec_v = { x: P_next.x - P_opp.x, y: P_next.y - P_opp.y };

                const len_u = Math.hypot(vec_u.x, vec_u.y);
                const len_v = Math.hypot(vec_v.x, vec_v.y);

                const u = len_u > 0.0001 ? { x: vec_u.x / len_u, y: vec_u.y / len_u } : { x: 1, y: 0 };
                const v = len_v > 0.0001 ? { x: vec_v.x / len_v, y: vec_v.y / len_v } : { x: 0, y: 1 };

                const d = { x: x - P_opp.x, y: y - P_opp.y };

                const proj_u = d.x * u.x + d.y * u.y;
                const proj_v = d.x * v.x + d.y * v.y;

                const P_drag_new = { x, y };
                const P_prev_new = { x: P_opp.x + proj_u * u.x, y: P_opp.y + proj_u * u.y };
                const P_next_new = { x: P_opp.x + proj_v * v.x, y: P_opp.y + proj_v * v.y };

                const oldPosList: { cx: number; cy: number; nx: number; ny: number }[] = [];

                const recordChange = (vIdx: number, newPt: { x: number; y: number }) => {
                  const idx = idxMap[vIdx];
                  oldPosList.push({ cx: updatedPath[idx].x, cy: updatedPath[idx].y, nx: newPt.x, ny: newPt.y });
                  updatedPath[idx] = { ...updatedPath[idx], x: newPt.x, y: newPt.y };
                };

                recordChange(dragIndexMapped, P_drag_new);
                recordChange(prevVIdx, P_prev_new);
                recordChange(nextVIdx, P_next_new);

                updatedPath[idxMap[4]] = { ...updatedPath[idxMap[4]], x: updatedPath[idxMap[0]].x, y: updatedPath[idxMap[0]].y };

                const nextPaths = updatedPaths.map((path, pIdx) => {
                  if (pIdx === pathIdx) {
                    return updatedPath;
                  }
                  return path.map((pt) => {
                    for (const item of oldPosList) {
                      if (pt.rectData?.id !== rId && Math.hypot(pt.x - item.cx, pt.y - item.cy) < 0.05) {
                        return { ...pt, x: item.nx, y: item.ny };
                      }
                    }
                    return pt;
                  });
                });
                setPaths(nextPaths);

                const nextFinalPoints = finalPoints.map(pt => {
                  for (const item of oldPosList) {
                    if (pt.rectData?.id !== rId && Math.hypot(pt.x - item.cx, pt.y - item.cy) < 0.05) {
                      return { ...pt, x: item.nx, y: item.ny };
                    }
                  }
                  return pt;
                });
                setFinalPoints(nextFinalPoints);
              }
            }
          } else if (draggedPt && draggedPt.polygonData) {
            const polyId = draggedPt.polygonData.id;
            const sides = draggedPt.polygonData.sides;
            const vIndex = draggedPt.polygonData.vertexIndex;
            const center = draggedPt.polygonData.center;

            // Calculate new radius and angle
            const newRadius = Math.hypot(x - center.x, y - center.y);
            const newAngle = Math.atan2(y - center.y, x - center.x);
            const newInitialAngle = newAngle - (vIndex * Math.PI * 2) / sides;

            for (let i = 0; i < updatedPath.length; i++) {
              if (updatedPath[i].polygonData?.id === polyId) {
                const currentVIndex = updatedPath[i].polygonData.vertexIndex;
                const targetAngle = newInitialAngle + (currentVIndex * Math.PI * 2) / sides;
                updatedPath[i] = {
                  ...updatedPath[i],
                  x: center.x + newRadius * Math.cos(targetAngle),
                  y: center.y + newRadius * Math.sin(targetAngle),
                  polygonData: {
                    ...updatedPath[i].polygonData,
                    radius: newRadius,
                    initialAngle: newInitialAngle
                  }
                };
              }
            }
            // Ensure loop closure matches
            const isClosedLoop = distance(targetPath[0], targetPath[targetPath.length - 1]) < 0.1;
            if (isClosedLoop) {
              if (dragIndexRef.current === 0) {
                updatedPath[updatedPath.length - 1] = { ...updatedPath[0] };
              }
              if (dragIndexRef.current === updatedPath.length - 1) {
                updatedPath[0] = { ...updatedPath[updatedPath.length - 1] };
              }
            }
          } else {
            // Standard single vertex drag in completed paths
            const nextFinalPoints = finalPoints.map(pt => {
              if (Math.hypot(pt.x - cx, pt.y - cy) < 0.05) {
                return { ...pt, x, y };
              }
              return pt;
            });
            if (finalPoints.length > 2 && distance(finalPoints[0], finalPoints[finalPoints.length - 1]) < 0.1) {
              if (Math.hypot(finalPoints[0].x - cx, finalPoints[0].y - cy) < 0.05) {
                nextFinalPoints[nextFinalPoints.length - 1] = { ...nextFinalPoints[0] };
              }
              if (Math.hypot(finalPoints[finalPoints.length - 1].x - cx, finalPoints[finalPoints.length - 1].y - cy) < 0.05) {
                nextFinalPoints[0] = { ...nextFinalPoints[nextFinalPoints.length - 1] };
              }
            }
            setFinalPoints(nextFinalPoints);

            const nextPaths = updatedPaths.map((path, pIdx) => {
              const updatedP = path.map((pt, i) => {
                if (pIdx === pathIdx && i === dragIndexRef.current) {
                  return { ...pt, x, y };
                }
                if (Math.hypot(pt.x - cx, pt.y - cy) < 0.05) {
                  return { ...pt, x, y };
                }
                return pt;
              });

              const isClosedLoop = distance(path[0], path[path.length - 1]) < 0.1;
              if (isClosedLoop) {
                if (Math.hypot(path[0].x - cx, path[0].y - cy) < 0.05 || (pIdx === pathIdx && dragIndexRef.current === 0)) {
                  updatedP[updatedP.length - 1] = { ...updatedP[0] };
                }
                if (Math.hypot(path[path.length - 1].x - cx, path[path.length - 1].y - cy) < 0.05 || (pIdx === pathIdx && dragIndexRef.current === path.length - 1)) {
                  updatedP[0] = { ...updatedP[updatedP.length - 1] };
                }
              }
              return updatedP;
            });

            setPaths(nextPaths);
          }
        }
      } else if (isDrawingRef.current && drawMode === 'freehand') {
        const last = rawPoints[rawPoints.length - 1];
        if (Math.hypot(last.x - x, last.y - y) > 5 / viewZoom) {
          setRawPoints((prev) => [...prev, { x, y }]);
        }
      } else if (drawMode === 'drag') {
        // Hover visual snapping
        const snapData = calculateSnaps(x, y, finalPoints, isClosed, -1, smartSnap, 10 / viewZoom, activeLayer.paths, gridSnap, gridSize, customAnchor, snapToggles);
        setSnapPoint(snapData.snapPoint);
        setTrackedLines(snapData.trackedLines);
      }
    }
  };

  const handleMouseUp = () => {
    isDrawingRef.current = false;
    dragIndexRef.current = -1;
    dragPathIndexRef.current = -1;
    dragEntirePathRef.current = null;
    setIsPanning(false);
    setTrackedLines([]);
    setSnapPoint(null);

    if (rightClickStart && rightClickEnd) {
      const isCrossing = rightClickEnd.x < rightClickStart.x; // RTL is crossing selection
      const x1 = Math.min(rightClickStart.x, rightClickEnd.x);
      const x2 = Math.max(rightClickStart.x, rightClickEnd.x);
      const y1 = Math.min(rightClickStart.y, rightClickEnd.y);
      const y2 = Math.max(rightClickStart.y, rightClickEnd.y);
      const dx = x2 - x1;
      const dy = y2 - y1;

      setRightClickStart(null);
      setRightClickEnd(null);

      const isClick = dx < 2 && dy < 2;

      let newlySelectedPathIndices: number[] = [];
      let nextFinalPointsSelected = false;

      if (isClick && hoverCoords) {
        // Single Click Select
        let clickedFinalPoints = false;
        let clickedPathIdx = -1;

        if (finalPoints.length > 0) {
          const circlePt = finalPoints.find(p => p.circleData);
          if (circlePt && circlePt.circleData) {
            const distToCenter = Math.hypot(hoverCoords.x - circlePt.circleData.center.x, hoverCoords.y - circlePt.circleData.center.y);
            if (Math.abs(distToCenter - circlePt.circleData.radius) < 15 / viewZoom || distToCenter < 15 / viewZoom) {
              clickedFinalPoints = true;
            }
          }
          if (!clickedFinalPoints) {
            for (let i = 0; i < finalPoints.length; i++) {
              if (Math.hypot(finalPoints[i].x - hoverCoords.x, finalPoints[i].y - hoverCoords.y) < 15 / viewZoom) {
                clickedFinalPoints = true;
                break;
              }
            }
          }
          if (!clickedFinalPoints && finalPoints.length > 1) {
            for (let i = 0; i < finalPoints.length - 1; i++) {
              const seg = getClosestPointOnSegment(hoverCoords, finalPoints[i], finalPoints[i + 1]);
              if (seg.dist < 15 / viewZoom) {
                clickedFinalPoints = true;
                break;
              }
            }
          }
        }

        if (!clickedFinalPoints && activeLayer.paths) {
          for (let pathIdx = 0; pathIdx < activeLayer.paths.length; pathIdx++) {
            const path = activeLayer.paths[pathIdx];
            const circlePt = path.find(p => p.circleData);
            if (circlePt && circlePt.circleData) {
              const distToCenter = Math.hypot(hoverCoords.x - circlePt.circleData.center.x, hoverCoords.y - circlePt.circleData.center.y);
              if (Math.abs(distToCenter - circlePt.circleData.radius) < 15 / viewZoom || distToCenter < 15 / viewZoom) {
                clickedPathIdx = pathIdx;
                break;
              }
            }
            let foundVtx = false;
            for (let i = 0; i < path.length; i++) {
              if (Math.hypot(path[i].x - hoverCoords.x, path[i].y - hoverCoords.y) < 15 / viewZoom) {
                foundVtx = true;
                break;
              }
            }
            if (foundVtx) {
              clickedPathIdx = pathIdx;
              break;
            }
            if (path.length > 1) {
              for (let i = 0; i < path.length - 1; i++) {
                const seg = getClosestPointOnSegment(hoverCoords, path[i], path[i + 1]);
                if (seg.dist < 15 / viewZoom) {
                  clickedPathIdx = pathIdx;
                  break;
                }
              }
            }
            if (clickedPathIdx !== -1) break;
          }
        }

        if (clickedFinalPoints) {
          nextFinalPointsSelected = true;
          logCommandResponse("Sketch selected for integrated movement.");
        } else if (clickedPathIdx !== -1) {
          newlySelectedPathIndices = [clickedPathIdx];
          logCommandResponse(`Shape #${clickedPathIdx + 1} selected for integrated movement.`);
        } else {
          nextFinalPointsSelected = false;
          newlySelectedPathIndices = [];
          logCommandResponse("Selection cleared.");
        }
      } else {
        // Box Selection bounding triggers
        const isPointInBox = (pt: Point) => pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2;
        const isSegmentCrossingBox = (p1: Point, p2: Point) => {
          const segMinX = Math.min(p1.x, p2.x);
          const segMaxX = Math.max(p1.x, p2.x);
          const segMinY = Math.min(p1.y, p2.y);
          const segMaxY = Math.max(p1.y, p2.y);
          if (segMaxX < x1 || segMinX > x2 || segMaxY < y1 || segMinY > y2) return false;
          return true;
        };

        if (finalPoints.length > 0) {
          if (isCrossing) {
            const anyVtxInside = finalPoints.some(isPointInBox);
            let anySegCrossing = false;
            if (finalPoints.length > 1) {
              for (let i = 0; i < finalPoints.length - 1; i++) {
                if (isSegmentCrossingBox(finalPoints[i], finalPoints[i + 1])) {
                  anySegCrossing = true;
                  break;
                }
              }
            }
            if (anyVtxInside || anySegCrossing) nextFinalPointsSelected = true;
          } else {
            const allVerticesInside = finalPoints.length > 0 && finalPoints.every(isPointInBox);
            if (allVerticesInside) nextFinalPointsSelected = true;
          }
        }

        if (activeLayer.paths) {
          activeLayer.paths.forEach((path, pathIdx) => {
            if (path.length > 0) {
              if (isCrossing) {
                const anyVtxInside = path.some(isPointInBox);
                let anySegCrossing = false;
                if (path.length > 1) {
                  for (let i = 0; i < path.length - 1; i++) {
                    if (isSegmentCrossingBox(path[i], path[i + 1])) {
                      anySegCrossing = true;
                      break;
                    }
                  }
                }
                if (anyVtxInside || anySegCrossing) newlySelectedPathIndices.push(pathIdx);
              } else {
                const allVerticesInside = path.every(isPointInBox);
                if (allVerticesInside) newlySelectedPathIndices.push(pathIdx);
              }
            }
          });
        }

        const count = (nextFinalPointsSelected ? 1 : 0) + newlySelectedPathIndices.length;
        logCommandResponse(
          `${isCrossing ? "Kesişenler (Crossing)" : "İçindekiler (Window)"} seçimi tamamlandı. Toplam ${count} obje seçildi.`
        );
      }

      setIsFinalPointsSelected(nextFinalPointsSelected);
      setSelectedPathIndices(newlySelectedPathIndices);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawMode !== 'drag') return;
    const { x: mX, y: mY } = getVirtualCoords(e.clientX, e.clientY);

    let insertIdx = -1;
    let optimalPt = { x: mX, y: mY };
    let pathIdxToSplit = -1; // -1 means finalPoints, >= 0 means activeLayer.paths index

    // 1. Try splitting active/selected sub-path first (if selected) or check finalPoints
    if (finalPoints.length >= 2) {
      let minDistance = Infinity;
      // Midpoint snap check
      if (snapPoint?.type === 'mid') {
        optimalPt = { x: snapPoint.x, y: snapPoint.y };
        for (let i = 0; i < finalPoints.length - 1; i++) {
          const midX = (finalPoints[i].x + finalPoints[i + 1].x) / 2;
          const midY = (finalPoints[i].y + finalPoints[i + 1].y) / 2;
          if (Math.abs(midX - optimalPt.x) < 2.0 && Math.abs(midY - optimalPt.y) < 2.0) {
            insertIdx = i;
            break;
          }
        }
      } else {
        for (let i = 0; i < finalPoints.length - 1; i++) {
          const seg = getClosestPointOnSegment({ x: mX, y: mY }, finalPoints[i], finalPoints[i + 1]);
          if (seg.dist < 15 / viewZoom && seg.dist < minDistance) {
            minDistance = seg.dist;
            insertIdx = i;
            optimalPt = { x: seg.x, y: seg.y };
          }
        }
      }
    }

    // 2. Try splitting segments inside activeLayer.paths if no split on finalPoints
    if (insertIdx === -1 && activeLayer.paths) {
      let minDistance = Infinity;
      for (let pIdx = 0; pIdx < activeLayer.paths.length; pIdx++) {
        const path = activeLayer.paths[pIdx];
        if (path.length >= 2) {
          if (snapPoint?.type === 'mid') {
            const tempPt = { x: snapPoint.x, y: snapPoint.y };
            for (let i = 0; i < path.length - 1; i++) {
              const midX = (path[i].x + path[i + 1].x) / 2;
              const midY = (path[i].y + path[i + 1].y) / 2;
              if (Math.abs(midX - tempPt.x) < 2.0 && Math.abs(midY - tempPt.y) < 2.0) {
                insertIdx = i;
                pathIdxToSplit = pIdx;
                optimalPt = tempPt;
                break;
              }
            }
            if (insertIdx !== -1) break;
          } else {
            for (let i = 0; i < path.length - 1; i++) {
              const seg = getClosestPointOnSegment({ x: mX, y: mY }, path[i], path[i + 1]);
              if (seg.dist < 15 / viewZoom && seg.dist < minDistance) {
                minDistance = seg.dist;
                insertIdx = i;
                pathIdxToSplit = pIdx;
                optimalPt = { x: seg.x, y: seg.y };
              }
            }
          }
        }
      }
    }

    if (insertIdx !== -1) {
      saveState();
      if (pathIdxToSplit === -1) {
        const updatedChain = [...finalPoints];
        updatedChain.splice(insertIdx + 1, 0, { ...optimalPt });
        setFinalPoints(updatedChain);
        logCommandResponse(`Çizgi bölündü: Yeni nokta eklendi (Grup K-${insertIdx + 1}).`);
      } else if (activeLayer.paths) {
        const updatedPaths = [...activeLayer.paths];
        const updatedPath = [...updatedPaths[pathIdxToSplit]];
        updatedPath.splice(insertIdx + 1, 0, { ...optimalPt });
        updatedPaths[pathIdxToSplit] = updatedPath;
        setPaths(updatedPaths);
        logCommandResponse(`Alt şekil çizgisi bölündü: Yeni nokta eklendi (Şekil #${pathIdxToSplit + 1}, Grup K-${insertIdx + 1}).`);
      }
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mX = e.clientX - rect.left;
      const mY = e.clientY - rect.top;

      const wX = (mX - panX) / viewZoom;
      const wY = (mY - panY) / viewZoom;

      const scaleFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const zoom = Math.max(0.1, Math.min(viewZoom * scaleFactor, 10.0));

      setViewZoom(zoom);
      setPanX(mX - wX * zoom);
      setPanY(mY - wY * zoom);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [panX, panY, viewZoom]);

  // CLI Command processor
  const handleCommandLineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = cmdText.trim().toUpperCase();
    setCmdText('');

    if (cmd === 'L') {
      setCommand('line');
    } else if (cmd === 'R') {
      setCommand('rect');
    } else if (cmd === 'C') {
      setCommand('circle');
    } else if (cmd === 'POL') {
      setCommand('polygon');
    } else if (cmd === 'F') {
      applyFillet();
    } else if (cmd === 'CH') {
      applyChamfer();
    } else if (cmd === 'U') {
      handleUndo();
    } else if (cmd === 'CLEAR') {
      handleClearAll();
    } else {
      // Attempt parse for numbers as inputs
      const numericVal = parseFloat(cmd);
      if (!isNaN(numericVal) && currentCommand === 'line' && finalPoints.length > 0) {
        // Extrude line with length in ortho direction
        saveState();
        const last = finalPoints[finalPoints.length - 1];
        setFinalPoints((prev) => [...prev, { x: last.x + numericVal, y: last.y }]);
        logCommandResponse(`Extruded segment line by ${numericVal} mm horizontally.`);
      } else {
        logCommandResponse(`Command "${cmd}" not recognized. Please use standard Hotkeys.`);
      }
    }
  };

  // STL triggers
  const executeStlExport = () => {
    if (triggerStlExportRef.current) {
      triggerStlExportRef.current();
    } else {
      logCommandResponse('Error: ThreeJS Export engine not bound yet.');
    }
  };

  // DXF export generator
  const exportToDXF = () => {
    // Collect all paths to export:
    const allPaths: Point[][] = [];
    if (finalPoints.length > 0) {
      allPaths.push(finalPoints);
    }
    if (activeLayer.paths) {
      activeLayer.paths.forEach((p) => {
        if (p.length > 0) {
          allPaths.push(p);
        }
      });
    }

    if (allPaths.length === 0) {
      logCommandResponse('DXF Export için çizimde en az bir eleman bulunmalıdır.');
      return;
    }

    let dxf = '0\nSECTION\n2\nENTITIES\n';

    allPaths.forEach((path) => {
      for (let i = 0; i < path.length; i++) {
        const pt = path[i];

        // Export circle if circleData is present
        if (pt.circleData) {
          dxf += `0\nCIRCLE\n8\n0\n10\n${pt.circleData.center.x.toFixed(4)}\n20\n${(-pt.circleData.center.y).toFixed(4)}\n30\n0.0\n40\n${pt.circleData.radius.toFixed(4)}\n`;
        }

        // Connect segment line to next point
        if (i < path.length - 1) {
          const nextPt = path[i + 1];
          dxf += `0\nLINE\n8\n0\n10\n${pt.x.toFixed(4)}\n20\n${(-pt.y).toFixed(4)}\n30\n0.0\n11\n${nextPt.x.toFixed(4)}\n21\n${(-nextPt.y).toFixed(4)}\n31\n0.0\n`;
        } else if (isClosed && path === finalPoints && path.length > 2) {
          const firstPt = path[0];
          dxf += `0\nLINE\n8\n0\n10\n${pt.x.toFixed(4)}\n20\n${(-pt.y).toFixed(4)}\n30\n0.0\n11\n${firstPt.x.toFixed(4)}\n21\n${(-firstPt.y).toFixed(4)}\n31\n0.0\n`;
        }
      }
    });

    dxf += '0\nENDSEC\n0\nEOF\n';

    const blob = new Blob([dxf], { type: 'application/dxf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `CADERIM_${activeLayer.name || 'Sketch'}.dxf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    logCommandResponse('2D Profil başarıyla DXF olarak kaydedildi.');
  };

  // TECHNICAL BLUEPRINT EXPORT IN PDF FORMAT USING VECTOR RENDERING
  const exportToPDF = () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const visibleLayers = layers.filter(l => l.visible);

      // Collect all drawing points to compute optimal scaling bounds
      const allPts: Point[] = [];
      visibleLayers.forEach(l => {
        if (l.finalPoints) allPts.push(...l.finalPoints);
        if (l.paths) {
          l.paths.forEach(p => allPts.push(...p));
        }
        if (l.dimensions) {
          l.dimensions.forEach(d => {
            allPts.push(d.p1);
            allPts.push(d.p2);
          });
        }
      });

      let minX = -100, maxX = 100, minY = -100, maxY = 100;
      if (allPts.length > 0) {
        minX = Math.min(...allPts.map(p => p.x));
        maxX = Math.max(...allPts.map(p => p.x));
        minY = Math.min(...allPts.map(p => p.y));
        maxY = Math.max(...allPts.map(p => p.y));
      }

      // Safe outer safety margins of bounds
      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const safetyPadding = Math.max(15, Math.max(spanX, spanY) * 0.15);
      
      minX -= safetyPadding;
      maxX += safetyPadding;
      minY -= safetyPadding;
      maxY += safetyPadding;

      const wGeom = maxX - minX;
      const hGeom = maxY - minY;

      // Landscape A4 Page dimension: 297mm x 210mm
      // Area limits avoiding overlaps
      const marginX0 = 15;
      const marginY0 = 15;
      const pWidth = 267; // 297 - 30 margin
      const pHeight = 145; // 210 - 65 margin grid

      // Perfect scale fit calculation
      const scale = Math.min(pWidth / wGeom, pHeight / hGeom);

      // Map CAD Coordinates (center of shape on center of area)
      const cGeomX = (minX + maxX) / 2;
      const cGeomY = (minY + maxY) / 2;
      const cPdfX = marginX0 + pWidth / 2;
      const cPdfY = marginY0 + pHeight / 2;

      const toPdfCoords = (pt: Point) => {
        const rx = cPdfX + (pt.x - cGeomX) * scale;
        const ry = cPdfY - (pt.y - cGeomY) * scale; // Y is inverted in PDF drawing
        return { x: rx, y: ry };
      };

      // 1. Draw Professional Grid Paper block matching CAD origin
      let gridInterval = 10;
      if (wGeom > 300) gridInterval = 50;
      else if (wGeom > 800) gridInterval = 100;
      else if (wGeom < 40) gridInterval = 5;

      doc.setLineWidth(0.06);
      doc.setDrawColor(210, 222, 235); // Engineering graph blue gray
      doc.setTextColor(148, 163, 184);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(6.5);

      const startXDiv = Math.floor(minX / gridInterval) * gridInterval;
      const endXDiv = Math.ceil(maxX / gridInterval) * gridInterval;
      const startYDiv = Math.floor(minY / gridInterval) * gridInterval;
      const endYDiv = Math.ceil(maxY / gridInterval) * gridInterval;

      // Draw Grid Verticals
      for (let gx = startXDiv; gx <= endXDiv; gx += gridInterval) {
        const pTop = toPdfCoords({ x: gx, y: minY });
        if (pTop.x >= 12 && pTop.x <= 285) {
          doc.line(pTop.x, 12, pTop.x, 198);
          doc.text(`${gx}mm`, pTop.x + 0.5, 15);
        }
      }

      // Draw Grid Horizontals
      for (let gy = startYDiv; gy <= endYDiv; gy += gridInterval) {
        const pLeft = toPdfCoords({ x: minX, y: gy });
        if (pLeft.y >= 12 && pLeft.y <= 198) {
          doc.line(12, pLeft.y, 285, pLeft.y);
          doc.text(`${gy}mm`, 13, pLeft.y - 0.5);
        }
      }

      // 2. Draw outer border borders around sheet
      doc.setLineWidth(0.6);
      doc.setDrawColor(15, 23, 42); // slate 900
      doc.rect(10, 10, 277, 190); // Landscape card borders

      // Second elegant double line border
      doc.setLineWidth(0.18);
      doc.rect(11.5, 11.5, 274, 187);

      // 3. Render Technical Title Sheet Block in standard lower-right corner
      const tbX = 177;
      const tbY = 163;
      const tbW = 110;
      const tbH = 35;

      // Fill background of Title Block beautifully
      doc.setLineWidth(0.4);
      doc.setDrawColor(15, 23, 42);
      doc.setFillColor(248, 250, 252); // extremely clean white-slate fill
      doc.rect(tbX, tbY, tbW, tbH, "FD");

      // Internal divisions of Title panel
      doc.setLineWidth(0.18);
      doc.line(tbX, tbY + 11, tbX + tbW, tbY + 11);
      doc.line(tbX, tbY + 23, tbX + tbW, tbY + 23);
      doc.line(tbX + 55, tbY, tbX + 55, tbY + 23);
      doc.line(tbX + 80, tbY + 23, tbX + 80, tbY + 35);

      // Row 1 elements
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5.5);
      doc.setTextColor(100, 116, 139); // Slate-500
      doc.text("LİSANS SAHİBİ & PROJE ADI", tbX + 3, tbY + 3.5);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text("CADERİM BİLİŞİM", tbX + 3, tbY + 8.5);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5.5);
      doc.setTextColor(100, 116, 139);
      doc.text("KATMAN / COMPONENT", tbX + 58, tbY + 3.5);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(activeLayer.name || "Base Profile", tbX + 58, tbY + 8.5);

      // Row 2 elements
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5.5);
      doc.setTextColor(100, 116, 139);
      doc.text("TASARIMCI / E-POSTA", tbX + 3, tbY + 15);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      doc.text("peopleonthearth@gmail.com", tbX + 3, tbY + 20);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5.5);
      doc.setTextColor(100, 116, 139);
      doc.text("YAZILIM / VERSİYON", tbX + 58, tbY + 15);
      doc.setFont("Helvetica", "italic");
      doc.setFontSize(7.5);
      doc.setTextColor(217, 119, 6); // CADERİM amber color
      doc.text("CADERİM v14.0 Sketcher", tbX + 58, tbY + 20);

      // Row 3 elements
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5);
      doc.setTextColor(100, 116, 139);
      doc.text("TANZİM TARİHİ", tbX + 3, tbY + 26.5);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text(new Date().toLocaleDateString('tr-TR'), tbX + 3, tbY + 31.5);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5);
      doc.setTextColor(100, 116, 139);
      doc.text("KARTELA ÖLÇEĞİ", tbX + 58, tbY + 26.5);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text(`1:${(1 / scale).toFixed(1)}`, tbX + 58, tbY + 31.5);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5);
      doc.setTextColor(100, 116, 139);
      doc.text("MÜHENDİSLİK BİRİMİ", tbX + 83, tbY + 26.5);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text("mm", tbX + 83, tbY + 31.5);

      // 4. Render CAD Elements visibly layered
      visibleLayers.forEach(l => {
        const isAct = l.id === activeLayerId;
        doc.setLineWidth(isAct ? 0.45 : 0.22);
        
        // Match Layer RGB colors perfectly from hex
        const colorHex = l.color || "#475569";
        const rColor = parseInt(colorHex.slice(1, 3), 16) || 0;
        const gColor = parseInt(colorHex.slice(3, 5), 16) || 0;
        const bColor = parseInt(colorHex.slice(5, 7), 16) || 0;
        doc.setDrawColor(rColor, gColor, bColor);

        // Path geometries
        const pathsToDraw: { pts: Point[], closed: boolean }[] = [];
        if (l.finalPoints && l.finalPoints.length > 0) {
          pathsToDraw.push({ pts: l.finalPoints, closed: !!l.isClosed });
        }
        if (l.paths) {
          l.paths.forEach(p => {
            if (p.length > 0) {
              const checkClosed = p.length > 2 && Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].y - p[0].y) < 0.05;
              pathsToDraw.push({ pts: p, closed: checkClosed });
            }
          });
        }

        pathsToDraw.forEach(({ pts, closed }) => {
          for (let i = 0; i < pts.length; i++) {
            const currentPt = pts[i];
            const currentPdfCoords = toPdfCoords(currentPt);

            // Vector Circles
            if (currentPt.circleData) {
              const cc = toPdfCoords(currentPt.circleData.center);
              const cr = currentPt.circleData.radius * scale;
              doc.circle(cc.x, cc.y, cr, "S");
            }

            // Draw connecting lines
            if (i < pts.length - 1) {
              const nextPdfCoords = toPdfCoords(pts[i + 1]);
              doc.line(currentPdfCoords.x, currentPdfCoords.y, nextPdfCoords.x, nextPdfCoords.y);
            } else if (closed && pts.length > 2) {
              const firstPdfCoords = toPdfCoords(pts[0]);
              doc.line(currentPdfCoords.x, currentPdfCoords.y, firstPdfCoords.x, firstPdfCoords.y);
            }
          }
        });

        // 5. Draw Dimension Lines overlaid professionally in beautiful gold/grey tint lines
        if (l.dimensions && l.dimensions.length > 0) {
          l.dimensions.forEach(d => {
            const p1Pdf = toPdfCoords(d.p1);
            const p2Pdf = toPdfCoords(d.p2);

            doc.setLineWidth(0.12);
            doc.setDrawColor(220, 110, 50); // Light orange drafting dimension lines
            doc.line(p1Pdf.x, p1Pdf.y, p2Pdf.x, p2Pdf.y);

            // Bounds ticks indicators
            doc.line(p1Pdf.x - 1, p1Pdf.y, p1Pdf.x + 1, p1Pdf.y);
            doc.line(p1Pdf.x, p1Pdf.y - 1, p1Pdf.x, p1Pdf.y + 1);
            doc.line(p2Pdf.x - 1, p2Pdf.y, p2Pdf.x + 1, p2Pdf.y);
            doc.line(p2Pdf.x, p2Pdf.y - 1, p2Pdf.x, p2Pdf.y + 1);

            // Centered dimension numerical string value label
            doc.setFont("Helvetica", "bold");
            doc.setFontSize(6.5);
            doc.setTextColor(190, 80, 20); // Darker amber metric color
            
            const textX = (p1Pdf.x + p2Pdf.x) / 2;
            const textY = (p1Pdf.y + p2Pdf.y) / 2 - 1.2;
            doc.text(`${Number(d.value).toFixed(1)} mm`, textX, textY, { align: "center" });
          });
        }
      });

      // 6. Draw 3D Isometric Projection box in the bottom-left corner
      const isoBoxX = 13;
      const isoBoxY = 148;
      const isoBoxW = 85;
      const isoBoxH = 46;

      // Draw box border
      doc.setLineWidth(0.35);
      doc.setDrawColor(15, 23, 42); // slate 900
      doc.setFillColor(248, 250, 252); // clean slate background
      doc.rect(isoBoxX, isoBoxY, isoBoxW, isoBoxH, "FD");

      // Draw small header text inside 3D Box
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5.5);
      doc.setTextColor(100, 116, 139); // Slate-500
      doc.text("3D İZOMETRİK PROJEKSİYON / 3D ISOMETRIC VIEW", isoBoxX + 3, isoBoxY + 4);

      interface IsoLine {
        p1: { x: number; y: number };
        p2: { x: number; y: number };
        colorHex: string;
        isAct: boolean;
      }
      const isoLines: IsoLine[] = [];
      const allIsoProjPts: { x: number; y: number }[] = [];

      // Geometric isometric projector mapping:
      // Angles for beautiful isometric perspective
      const yaw = -Math.PI / 6;   // -30 deg
      const pitch = Math.PI / 7;  // approx 25.7 deg for beautiful vertical elevation accentuation
      
      const projectToIso = (x: number, y: number, z: number) => {
        // Rotate around Z axis (yaw)
        const xRot = x * Math.cos(yaw) - y * Math.sin(yaw);
        const yRot = x * Math.sin(yaw) + y * Math.cos(yaw);
        
        // Rotate around X axis (pitch)
        const xProj = xRot;
        const yProj = yRot * Math.cos(pitch) - z * Math.sin(pitch);
        
        return { x: xProj, y: yProj };
      };

      // Extract shapes from all layers
      visibleLayers.forEach(l => {
        const isAct = l.id === activeLayerId;
        const colorHex = l.color || "#475569";
        const h = l.depth || 50; // Use extrusion depth or default to 50

        // Function to extract 2D points with circle discretization
        const extractPoints = (pts: Point[], closed: boolean) => {
          if (pts.length === 0) return;
          const layer2dPts: { x: number; y: number }[] = [];
          
          pts.forEach(p => {
            if (p.circleData) {
              const cx = p.circleData.center.x;
              const cy = p.circleData.center.y;
              const r = p.circleData.radius;
              // Add a sample of points to form a smooth discretization
              const samples = 24;
              const circlePoints: { x: number; y: number }[] = [];
              for (let i = 0; i < samples; i++) {
                const angle = (i / samples) * Math.PI * 2;
                circlePoints.push({
                  x: cx + r * Math.cos(angle),
                  y: cy + r * Math.sin(angle)
                });
              }
              // Push all circle points as a path
              layer2dPts.push(...circlePoints);
            } else {
              layer2dPts.push({ x: p.x, y: p.y });
            }
          });

          // Draw bottom face (z = 0) and top face (z = h)
          const bottomProj = layer2dPts.map(pt => projectToIso(pt.x, pt.y, 0));
          const topProj = layer2dPts.map(pt => projectToIso(pt.x, pt.y, h));

          allIsoProjPts.push(...bottomProj, ...topProj);

          // Connect bottom face points
          for (let i = 0; i < bottomProj.length; i++) {
            if (i < bottomProj.length - 1) {
              isoLines.push({ p1: bottomProj[i], p2: bottomProj[i + 1], colorHex, isAct });
            } else if (closed && bottomProj.length > 2) {
              isoLines.push({ p1: bottomProj[i], p2: bottomProj[0], colorHex, isAct });
            }
          }

          // Connect top face points
          for (let i = 0; i < topProj.length; i++) {
            if (i < topProj.length - 1) {
              isoLines.push({ p1: topProj[i], p2: topProj[i + 1], colorHex, isAct });
            } else if (closed && topProj.length > 2) {
              isoLines.push({ p1: topProj[i], p2: topProj[0], colorHex, isAct });
            }
          }

          // Connect corresponding bottom and top vertices (extrusion side lines)
          // To keep wireframe clean, only render side lines for original vertices or key samples
          const connectionInterval = pts.some(p => p.circleData) ? 6 : 1; // skip intermediate circle points to keep drawing lightweight
          for (let i = 0; i < bottomProj.length; i += connectionInterval) {
            isoLines.push({ p1: bottomProj[i], p2: topProj[i], colorHex, isAct });
          }
          // Always connect the end vertex as well
          if (bottomProj.length > 0 && (bottomProj.length - 1) % connectionInterval !== 0) {
            const lastIdx = bottomProj.length - 1;
            isoLines.push({ p1: bottomProj[lastIdx], p2: topProj[lastIdx], colorHex, isAct });
          }
        };

        if (l.finalPoints && l.finalPoints.length > 0) {
          extractPoints(l.finalPoints, !!l.isClosed);
        }
        if (l.paths) {
          l.paths.forEach(p => {
            if (p.length > 0) {
              const checkClosed = p.length > 2 && Math.hypot(p[p.length - 1].x - p[0].x, p[p.length - 1].y - p[0].y) < 0.05;
              extractPoints(p, checkClosed);
            }
          });
        }
      });

      // Fit and render projected 3D coordinates inside bottom-left box
      if (allIsoProjPts.length > 0) {
        const pMinX = Math.min(...allIsoProjPts.map(p => p.x));
        const pMaxX = Math.max(...allIsoProjPts.map(p => p.x));
        const pMinY = Math.min(...allIsoProjPts.map(p => p.y));
        const pMaxY = Math.max(...allIsoProjPts.map(p => p.y));

        const pSpanX = pMaxX - pMinX || 1;
        const pSpanY = pMaxY - pMinY || 1;

        // Inside the 85mm x 46mm box, keep a border margin
        const borderMargin = 4;
        const viewW = isoBoxW - (borderMargin * 2); // 77mm
        const viewH = isoBoxH - 8 - borderMargin; // 34mm (shifted down for header text)

        const isoScale = Math.min(viewW / pSpanX, viewH / pSpanY);

        const cpProjX = (pMinX + pMaxX) / 2;
        const cpProjY = (pMinY + pMaxY) / 2;
        const pdfIsoCenterX = isoBoxX + isoBoxW / 2;
        const pdfIsoCenterY = isoBoxY + 8 + viewH / 2;

        const mapToIsoPdf = (pt: { x: number; y: number }) => {
          return {
            x: pdfIsoCenterX + (pt.x - cpProjX) * isoScale,
            y: pdfIsoCenterY - (pt.y - cpProjY) * isoScale // Subtracting because Y coordinate runs top-down in PDF
          };
        };

        // Render all the 3D projection vector lines onto PDF page
        isoLines.forEach(line => {
          const pt1 = mapToIsoPdf(line.p1);
          const pt2 = mapToIsoPdf(line.p2);

          doc.setLineWidth(line.isAct ? 0.24 : 0.12);
          const colorHex = line.colorHex;
          const rColor = parseInt(colorHex.slice(1, 3), 16) || 0;
          const gColor = parseInt(colorHex.slice(3, 5), 16) || 0;
          const bColor = parseInt(colorHex.slice(5, 7), 16) || 0;
          doc.setDrawColor(rColor, gColor, bColor);

          // Draw the physical edge line
          doc.line(pt1.x, pt1.y, pt2.x, pt2.y);
        });
      } else {
        // Draw elegant placeholder message if drawing is empty
        doc.setFont("Helvetica", "oblique");
        doc.setFontSize(6.5);
        doc.setTextColor(148, 163, 184);
        doc.text("İzometrik Görünüş için Çizim Boş", isoBoxX + isoBoxW / 2, isoBoxY + isoBoxH / 2 + 3, { align: "center" });
      }

      // Save PDF down
      doc.save(`CADERIM_Teknik_Resim_Blueprint_${activeLayer.name || 'Sketch'}.pdf`);
      logCommandResponse('✨ Mükemmel! 2D Teknik Resim Şeması PDF Blueprint olarak başarıyla dışa aktarıldı.');
    } catch (err: any) {
      logCommandResponse(`PDF oluşturma hatası: ${err.message || err}`);
    }
  };

  // FULLY INTEGRATED PRODUCTION-GRADE MECHANICAL BLUEPRINT SHEET EXPORT SYSTEM
  const exportDrawingSheetToPDF = () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const visibleLayers = layers.filter(l => l.visible);

      // Collect all drawing points to compute optimal scaling bounds
      const allPts: Point[] = [];
      visibleLayers.forEach(l => {
        if (l.finalPoints) {
          l.finalPoints.forEach(p => {
            if (p.circleData) {
              const cx = p.circleData.center.x;
              const cy = p.circleData.center.y;
              const r = p.circleData.radius;
              for (let i = 0; i < 16; i++) {
                const angle = (i / 16) * Math.PI * 2;
                allPts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
              }
            } else {
              allPts.push(p);
            }
          });
        }
        if (l.paths) {
          l.paths.forEach(p => {
            p.forEach(pt => {
              if (pt.circleData) {
                const cx = pt.circleData.center.x;
                const cy = pt.circleData.center.y;
                const r = pt.circleData.radius;
                for (let i = 0; i < 16; i++) {
                  const angle = (i / 16) * Math.PI * 2;
                  allPts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
                }
              } else {
                allPts.push(pt);
              }
            });
          });
        }
      });

      let minX = -40, maxX = 40, minY = -40, maxY = 40;
      if (allPts.length > 0) {
        minX = Math.min(...allPts.map(p => p.x));
        maxX = Math.max(...allPts.map(p => p.x));
        minY = Math.min(...allPts.map(p => p.y));
        maxY = Math.max(...allPts.map(p => p.y));
      }

      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const wGeom = Math.max(1, maxX - minX);
      const hGeom = Math.max(1, maxY - minY);

      // 1. PHYSICAL BORDERS OF SHEET PAPER
      doc.setLineWidth(0.65);
      doc.setDrawColor(15, 23, 42); // slate-900
      doc.rect(10, 10, 277, 190); // primary framing

      doc.setLineWidth(0.18);
      doc.rect(11.5, 11.5, 274, 187); // secondary framing

      // Center divisions crosshair guides
      doc.setLineWidth(0.08);
      doc.setDrawColor(210, 215, 225);
      doc.line(148.5, 11.5, 148.5, 198.5); // vert dividing lines
      doc.line(11.5, 105, 285.5, 105);   // horiz dividing lines

      // 2. QUADRANT A: FRONT ELEVATION VIEW (XZ PROFILE)
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5);
      doc.setTextColor(148, 163, 184);
      doc.text("A: ON GORUNUS (FRONT ELEVATION XZ)", 15, 16);

      const scaleVal = Math.min(80 / wGeom, 55 / hGeom) * sheetScaleMultiplier;
      const fMapX = (x: number) => 80 + (x - cx) * scaleVal;
      const fMapZ = (z: number) => 65 - z * scaleVal; // centered top-left

      doc.setLineWidth(0.42);
      doc.setDrawColor(15, 23, 42);
      // Main boundary block paths
      doc.line(fMapX(minX), fMapZ(0), fMapX(maxX), fMapZ(0));
      doc.line(fMapX(minX), fMapZ(depth), fMapX(maxX), fMapZ(depth));
      doc.line(fMapX(minX), fMapZ(0), fMapX(minX), fMapZ(depth));
      doc.line(fMapX(maxX), fMapZ(0), fMapX(maxX), fMapZ(depth));

      // Key elements project columns
      doc.setLineWidth(0.12);
      doc.setDrawColor(100, 116, 139);
      allPts.forEach(pt => {
        doc.line(fMapX(pt.x), fMapZ(0), fMapX(pt.x), fMapZ(depth));
      });

      // Height dimension marker line text
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(37, 99, 235); // Blue-600
      doc.setDrawColor(37, 99, 235);
      doc.setLineWidth(0.25);
      doc.line(fMapX(maxX) + 6, fMapZ(0), fMapX(maxX) + 6, fMapZ(depth));
      doc.line(fMapX(maxX) + 4, fMapZ(0), fMapX(maxX) + 8, fMapZ(0));
      doc.line(fMapX(maxX) + 4, fMapZ(depth), fMapX(maxX) + 8, fMapZ(depth));
      doc.text(`H=${depth} mm`, fMapX(maxX) + 8, (fMapZ(0) + fMapZ(depth))/2 + 1.5);

      // 3. QUADRANT B: 3D ISOMETRIC PARCELLING WIREFRAME (ISO VIEW)
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5);
      doc.setTextColor(148, 163, 184);
      doc.text("B: IZOMETRIK BAKIS (3D ISOMETRIC WIREFRAME)", 153, 16);

      const yaw = -Math.PI / 6;
      const pitch = Math.PI / 7;
      const projectToIsoLocal = (x: number, y: number, z: number) => {
        const xRot = x * Math.cos(yaw) - y * Math.sin(yaw);
        const yRot = x * Math.sin(yaw) + y * Math.cos(yaw);
        const xProj = xRot;
        const yProj = yRot * Math.cos(pitch) - z * Math.sin(pitch);
        return { x: xProj, y: yProj };
      };

      const polyIsoPts: { x: number; y: number }[] = [];
      const isoLinesLocal: Array<{ p1: { x: number; y: number }, p2: { x: number; y: number }, thick: boolean }> = [];

      visibleLayers.forEach(l => {
        const processIsoArray = (points: Point[], closed: boolean) => {
          if (points.length === 0) return;
          const mapFlat: { x: number; y: number }[] = [];
          points.forEach(p => {
            if (p.circleData) {
              const cx = p.circleData.center.x;
              const cy = p.circleData.center.y;
              const r = p.circleData.radius;
              for (let i = 0; i < 24; i++) {
                const angle = (i / 24) * Math.PI * 2;
                mapFlat.push({ cx: cx + r * Math.cos(angle), cy: cy + r * Math.sin(angle) } as any);
              }
            } else {
              mapFlat.push({ cx: p.x, cy: p.y } as any);
            }
          });

          const bottomP = mapFlat.map(pt => projectToIsoLocal((pt as any).cx, (pt as any).cy, 0));
          const topP = mapFlat.map(pt => projectToIsoLocal((pt as any).cx, (pt as any).cy, depth));

          polyIsoPts.push(...bottomP, ...topP);

          // Connect circles and lines
          for (let i = 0; i < bottomP.length; i++) {
            const nextIdx = (i + 1) % bottomP.length;
            if (i < bottomP.length - 1 || closed) {
              isoLinesLocal.push({ p1: bottomP[i], p2: bottomP[nextIdx], thick: false });
              isoLinesLocal.push({ p1: topP[i], p2: topP[nextIdx], thick: true });
            }
          }

          // pillars
          const interval = points.some(p => p.circleData) ? 6 : 1;
          for (let i = 0; i < bottomP.length; i += interval) {
            isoLinesLocal.push({ p1: bottomP[i], p2: topP[i], thick: false });
          }
        };

        if (l.finalPoints && l.finalPoints.length > 0) processIsoArray(l.finalPoints, !!l.isClosed);
        if (l.paths) l.paths.forEach(p => { if (p.length > 0) processIsoArray(p, true); });
      });

      if (polyIsoPts.length > 0) {
        const ipMinX = Math.min(...polyIsoPts.map(p => p.x));
        const ipMaxX = Math.max(...polyIsoPts.map(p => p.x));
        const ipMinY = Math.min(...polyIsoPts.map(p => p.y));
        const ipMaxY = Math.max(...polyIsoPts.map(p => p.y));

        const ipCentX = (ipMinX + ipMaxX) / 2;
        const ipCentY = (ipMinY + ipMaxY) / 2;

        const isoViewScale = Math.min(80 / (ipMaxX - ipMinX || 1), 45 / (ipMaxY - ipMinY || 1)) * sheetScaleMultiplier;
        const mapIsoPtToPdf = (pt: { x: number; y: number }) => ({
          x: 215 + (pt.x - ipCentX) * isoViewScale,
          y: 58 - (pt.y - ipCentY) * isoViewScale
        });

        // Draw wireframe outlines
        isoLinesLocal.forEach(line => {
          const pt1 = mapIsoPtToPdf(line.p1);
          const pt2 = mapIsoPtToPdf(line.p2);
          doc.setLineWidth(line.thick ? 0.38 : 0.15);
          doc.setDrawColor(line.thick ? 15 : 120, line.thick ? 23 : 130, line.thick ? 42 : 145);
          doc.line(pt1.x, pt1.y, pt2.x, pt2.y);
        });
      }

      // 4. QUADRANT C: TOP VIEW WITH DIMENSIONS (CENTERED AT X=80, Y=150)
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5);
      doc.setTextColor(148, 163, 184);
      doc.text("C: UST GORUNUS (TOP VIEW XY + OLCULER)", 15, 110);

      const tScale = Math.min(80 / wGeom, 50 / hGeom) * sheetScaleMultiplier;
      const tMapX = (x: number) => 80 + (x - cx) * tScale;
      const tMapY = (y: number) => 150 - (y - cy) * tScale;

      // Draw dashed centerline guidelines
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.08);
      doc.line(40, 150, 120, 150);
      doc.line(80, 120, 80, 180);

      // Render actual CAD shapes
      doc.setLineWidth(0.42);
      visibleLayers.forEach(l => {
        const colorHex = l.color || "#0f172a";
        const rColor = parseInt(colorHex.slice(1, 3), 16) || 0;
        const gColor = parseInt(colorHex.slice(3, 5), 16) || 0;
        const bColor = parseInt(colorHex.slice(5, 7), 16) || 0;
        doc.setDrawColor(rColor, gColor, bColor);

        const drawLoopPoints = (pts: Point[], closed: boolean) => {
          if (pts.length < 2) return;
          for (let i = 0; i < pts.length; i++) {
            const current = pts[i];
            const px1 = tMapX(current.x);
            const py1 = tMapY(current.y);
            
            if (current.circleData) {
              const ccx = tMapX(current.circleData.center.x);
              const ccy = tMapY(current.circleData.center.y);
              const ccr = current.circleData.radius * tScale;
              doc.circle(ccx, ccy, ccr, "S");
            }

            if (i < pts.length - 1) {
              const next = pts[i+1];
              doc.line(px1, py1, tMapX(next.x), tMapY(next.y));
            } else if (closed && pts.length > 2) {
              doc.line(px1, py1, tMapX(pts[0].x), tMapY(pts[0].y));
            }
          }
        };

        if (l.finalPoints && l.finalPoints.length > 0) drawLoopPoints(l.finalPoints, !!l.isClosed);
        if (l.paths) l.paths.forEach(p => { if (p.length > 0) drawLoopPoints(p, true); });

        // Dimensions overlay in PDF Top View
        const layerDims = l.dimensions || [];
        layerDims.forEach(d => {
          const p1P = { x: tMapX(d.p1.x), y: tMapY(d.p1.y) };
          const p2P = { x: tMapX(d.p2.x), y: tMapY(d.p2.y) };
          
          const dx = d.p2.x - d.p1.x;
          const dy = d.p2.y - d.p1.y;
          const length = Math.hypot(dx, dy);
          const ux = length > 0 ? dx / length : 1;
          const uy = length > 0 ? dy / length : 0;
          
          const nx = -uy;
          const ny = ux;
          
          const dOff = d.offset || 15;
          const offProjX = nx * dOff * tScale;
          const offProjY = -ny * dOff * tScale;
          
          const dim1X = p1P.x + offProjX;
          const dim1Y = p1P.y + offProjY;
          const dim2X = p2P.x + offProjX;
          const dim2Y = p2P.y + offProjY;
          
          const textX = (dim1X + dim2X) / 2;
          const textY = (dim1Y + dim2Y) / 2;

          // Guidelines dotted
          doc.setDrawColor(180, 185, 200);
          doc.setLineWidth(0.1);
          doc.line(p1P.x, p1P.y, dim1X, dim1Y);
          doc.line(p2P.x, p2P.y, dim2X, dim2Y);

          // Measure solid indicator pink
          doc.setDrawColor(219, 39, 119);
          doc.setLineWidth(0.24);
          doc.line(dim1X, dim1Y, dim2X, dim2Y);

          // Text card
          doc.setFillColor(255, 255, 255);
          doc.rect(textX - 7, textY - 2, 14, 4, "F");
          doc.setFont("Helvetica", "bold");
          doc.setFontSize(4.5);
          doc.setTextColor(219, 39, 119);
          doc.text(`${d.value.toFixed(1)}mm`, textX, textY + 1.1, { align: 'center' });
        });
      });

      // 5. QUADRANT D: RIGHT SIDE ELEVATION VIEW (YZ PROFILE CENTERED AT X=215, Y=150)
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5);
      doc.setTextColor(148, 163, 184);
      doc.text("D: SAG YAN GORUNUS (SIDE ELEVATION YZ)", 153, 110);

      const sScale = Math.min(80 / hGeom, 55 / Math.max(10, depth)) * sheetScaleMultiplier;
      const sMapY = (yVal: number) => 215 + (yVal - cy) * sScale;
      const sMapZ = (zVal: number) => 155 - zVal * sScale;

      doc.setLineWidth(0.42);
      doc.setDrawColor(15, 23, 42);
      // boundary box outline
      doc.line(sMapY(minY), sMapZ(0), sMapY(maxY), sMapZ(0));
      doc.line(sMapY(minY), sMapZ(depth), sMapY(maxY), sMapZ(depth));
      doc.line(sMapY(minY), sMapZ(0), sMapY(minY), sMapZ(depth));
      doc.line(sMapY(maxY), sMapZ(0), sMapY(maxY), sMapZ(depth));

      // Side minor projection trails
      doc.setLineWidth(0.12);
      doc.setDrawColor(100, 116, 139);
      allPts.forEach(pt => {
        doc.line(sMapY(pt.y), sMapZ(0), sMapY(pt.y), sMapZ(depth));
      });

      // Width measure indicators
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(37, 99, 235);
      doc.setDrawColor(37, 99, 235);
      doc.setLineWidth(0.25);
      doc.line(sMapY(minY), sMapZ(0) + 6, sMapY(maxY), sMapZ(0) + 6);
      doc.line(sMapY(minY), sMapZ(0) + 4, sMapY(minY), sMapZ(0) + 8);
      doc.line(sMapY(maxY), sMapZ(0) + 4, sMapY(maxY), sMapZ(0) + 8);
      doc.text(`W=${hGeom.toFixed(1)} mm`, (sMapY(minY) + sMapY(maxY))/2, sMapZ(0) + 12, { align: 'center' });


      // 6. GENERAL TECHNICAL PRODUCTION GUIDELINE NOTES (BOTTOM LEFT HALF)
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(5.5);
      doc.setTextColor(15, 23, 42);
      doc.text("GENEL TEKNIK NOTLAR (ENGINEERING TECHNICAL NOTES):", 15, 172);

      doc.setFont("Helvetica", "normal");
      doc.setFontSize(4.8);
      doc.setTextColor(51, 65, 85);
      const noteLines = doc.splitTextToSize(sheetNotes, 115);
      doc.text(noteLines, 15, 177);


      // 7. CAD LEGEND ANTER CARD BOX (SIZE 138mm x 32mm)
      const tbX = 145;
      const tbY = 164;
      const tbW = 138;
      const tbH = 32;

      doc.setLineWidth(0.4);
      doc.setDrawColor(15, 23, 42);
      doc.setFillColor(250, 252, 254);
      doc.rect(tbX, tbY, tbW, tbH, "FD");

      // Division grids
      doc.setLineWidth(0.18);
      doc.line(tbX, tbY + 10, tbX + tbW, tbY + 10);
      doc.line(tbX, tbY + 21, tbX + tbW, tbY + 21);
      doc.line(tbX + 70, tbY, tbX + 70, tbY + 21);
      doc.line(tbX + 105, tbY + 21, tbX + 105, tbY + 32);

      // Row 1 Text
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(4.5);
      doc.setTextColor(100, 116, 139);
      doc.text("PROJE / PARCA ADI (TITLE)", tbX + 3, tbY + 3.2);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text(sheetTitle, tbX + 3, tbY + 8);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(4.5);
      doc.setTextColor(100, 116, 139);
      doc.text("URETICI / SIRKET", tbX + 73, tbY + 3.2);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text("CADERIM BİLİŞİM", tbX + 73, tbY + 8);

      // Row 2 Text
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(4.5);
      doc.setTextColor(100, 116, 139);
      doc.text("TASARIMCI / E-POSTA", tbX + 3, tbY + 13.5);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(6.2);
      doc.text("peopleonthearth@gmail.com", tbX + 3, tbY + 18);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(4.5);
      doc.setTextColor(100, 116, 139);
      doc.text("MALZEME (MATERIAL)", tbX + 73, tbY + 13.5);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(7.2);
      doc.text(sheetMaterial.toUpperCase(), tbX + 73, tbY + 18);

      // Row 3 Text
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(4.5);
      doc.setTextColor(100, 116, 139);
      doc.text("TANZIM TARIHI", tbX + 3, tbY + 24.5);
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(6.2);
      doc.text(new Date().toISOString().split('T')[0], tbX + 3, tbY + 28.5);

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(4.5);
      doc.setTextColor(100, 116, 139);
      doc.text("REV", tbX + 73, tbY + 24.5);
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(180, 50, 50);
      doc.text(sheetRevision, tbX + 73, tbY + 28.5);

      // Projected Mass Calculation
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(4.5);
      doc.setTextColor(100, 116, 139);
      doc.text("HESAPLANAN KUTLE (MASS)", tbX + 108, tbY + 24.5);

      const massValue = (() => {
        let area = 0;
        visibleLayers.forEach(l => {
          const shapes = [];
          if (l.finalPoints && l.finalPoints.length > 0) shapes.push({ points: l.finalPoints, isClosed: l.isClosed });
          if (l.paths) l.paths.forEach(p => { if (p.length > 0) shapes.push({ points: p, isClosed: true }); });
          
          shapes.forEach(sh => {
            if (sh.isClosed && sh.points.length >= 3) {
              let shArea = 0;
              const poly = sh.points;
              for (let i = 0; i < poly.length - 1; i++) {
                shArea += poly[i].x * poly[i+1].y - poly[i+1].x * poly[i].y;
              }
              shArea += poly[poly.length - 1].x * poly[0].y - poly[0].x * poly[poly.length - 1].y;
              area += Math.abs(shArea / 2);
            }
          });
        });
        const volumeCm3 = (area * depth) / 1000;
        const list = {
          "Steel": 7.85, "Aluminum": 2.70, "Brass": 8.40, "Copper": 8.96, "Acrylic": 1.18, "PLA (3D Print)": 1.24, "Oak Wood": 0.75
        };
        const density = (list as any)[sheetMaterial] || 7.85;
        const massGVal = volumeCm3 * density;
        return massGVal > 1000 ? `${(massGVal / 1000).toFixed(3)} kg` : `${massGVal.toFixed(1)} g`;
      })();

      doc.setFont("Helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(21, 128, 61); // emerald-700
      doc.text(massValue, tbX + 108, tbY + 28.5);

      doc.save(`CADERIM_Teknik_Tablo_Sheet_${sheetTitle.replace(/\s+/g, '_')}.pdf`);
      logCommandResponse("✨ Başarılı: Teknik Üretim Resmi Sheet planı DIN A4 standardında başarıyla PDF olarak dışa aktarıldı.");
    } catch (err: any) {
      logCommandResponse(`Hata: Teknik Resim Hazırlanamadı. Nedeni: ${err.message || err}`);
    }
  };

  // Save entire sketch session as JSON
  const saveSketchJSON = () => {
    try {
      const sessionData = {
        layers,
        activeLayerId,
        isClosed,
        finalPoints,
        viewZoom,
        panX,
        panY,
      };
      const jsonString = JSON.stringify(sessionData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Zeki_CAD_Sketch_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      logCommandResponse('Sketch successfully saved as JSON file.');
    } catch (err) {
      logCommandResponse('Error exporting sketch JSON.');
    }
  };

  // Load sketch session from JSON
  const loadSketchJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.layers && Array.isArray(parsed.layers)) {
          setLayers(parsed.layers);
          if (parsed.activeLayerId) setActiveLayerId(parsed.activeLayerId);
          if (parsed.isClosed !== undefined) setIsClosed(parsed.isClosed);
          if (parsed.finalPoints !== undefined) setFinalPoints(parsed.finalPoints);
          if (parsed.viewZoom !== undefined) setViewZoom(parsed.viewZoom);
          if (parsed.panX !== undefined) setPanX(parsed.panX);
          if (parsed.panY !== undefined) setPanY(parsed.panY);
          logCommandResponse('Sketch session successfully loaded from JSON.');
        } else {
          logCommandResponse('Invalid sketch JSON file format.');
        }
      } catch (err) {
        logCommandResponse('Failed to parse sketch JSON file.');
      }
    };
    reader.readAsText(file);
  };

  const handleAIRedefineSketch = async () => {
    if (!aiRefinePrompt.trim()) {
      logCommandResponse("Lütfen bir yapay zeka komutu girin.");
      return;
    }

    setAiLoading(true);
    logCommandResponse("AI Redefine Sketch: Parametrik geometri güncelleniyor, lütfen bekleyin...");

    try {
      const response = await fetch("/api/redefine-sketch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: aiRefinePrompt,
          currentSketch: {
            isClosed,
            finalPoints,
            paths: activeLayer.paths || []
          }
        })
      });

      const data = await response.json();
      if (data.success && data.sketch) {
        saveState();
        
        // Safely map the returned structures
        setIsClosed(!!data.sketch.isClosed);
        if (Array.isArray(data.sketch.finalPoints)) {
          setFinalPoints(data.sketch.finalPoints);
        }
        if (Array.isArray(data.sketch.paths)) {
          setPaths(data.sketch.paths);
        }

        logCommandResponse("✨ AI Redefine Sketch: Geometri yapay zeka ile başarıyla yeniden şekillendirildi.");
        setAiRefinePrompt("");
      } else {
        logCommandResponse(`AI Redefine Sketch Hatası: ${data.error || "Beklenmeyen yanıt formatı"}`);
      }
    } catch (err: any) {
      logCommandResponse(`AI Redefine Sketch Hatası: ${err.message || err}`);
    } finally {
      setAiLoading(false);
    }
  };

  // 3D Volume & Time Estimation helpers
  const getPolygonArea = (poly: Point[]): number => {
    if (poly.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      area += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(area / 2);
  };

  const isPointInPolygon = (pt: { x: number; y: number }, poly: Point[]): boolean => {
    if (poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      
      const intersect = ((yi > pt.y) !== (yj > pt.y))
          && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi || 1) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const getPointsCentroid = (pts: Point[]) => {
    const circlePt = pts.find(p => p.circleData);
    if (circlePt && circlePt.circleData) {
      return circlePt.circleData.center;
    }
    let sx = 0, sy = 0;
    pts.forEach(p => { sx += p.x; sy += p.y; });
    return { x: sx / (pts.length || 1), y: sy / (pts.length || 1) };
  };

  const getPointsArea = (pts: Point[]): number => {
    const circlePt = pts.find(p => p.circleData);
    if (circlePt && circlePt.circleData) {
      return Math.PI * circlePt.circleData.radius * circlePt.circleData.radius;
    }
    return getPolygonArea(pts);
  };

  const calculateActiveLayerVolume = (): number => {
    const loops: Point[][] = [];
    if (finalPoints.length >= 3 && isClosed) {
      loops.push(finalPoints);
    }
    if (activeLayer.paths) {
      activeLayer.paths.forEach(p => {
        if (p.length >= 3 || p.some(pt => pt.circleData)) {
          loops.push(p);
        }
      });
    }

    if (loops.length === 0) return 0;

    const sortedLoops = loops
      .map(points => ({
        points,
        area: getPointsArea(points),
        center: getPointsCentroid(points)
      }))
      .sort((a, b) => b.area - a.area);

    const unions: { outer: any; holes: any[] }[] = [];
    sortedLoops.forEach((loop) => {
      let nestedIndex = -1;
      for (let i = 0; i < unions.length; i++) {
        if (isPointInPolygon(loop.center, unions[i].outer.points)) {
          nestedIndex = i;
          break;
        }
      }
      if (nestedIndex !== -1) {
        unions[nestedIndex].holes.push(loop);
      } else {
        unions.push({ outer: loop, holes: [] });
      }
    });

    let totalVolume = 0;

    unions.forEach(({ outer, holes }) => {
      const activeArea = Math.max(0, outer.area - holes.reduce((acc, h) => acc + h.area, 0));
      if (opType === 'extrude') {
        totalVolume += activeArea * depth;
      } else if (opType === 'revolve') {
        let minX = Infinity;
        let maxX = -Infinity;
        outer.points.forEach((p: Point) => {
          if (p.circleData) {
            minX = Math.min(minX, p.circleData.center.x - p.circleData.radius);
            maxX = Math.max(maxX, p.circleData.center.x + p.circleData.radius);
          } else {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
          }
        });
        const lCx = (minX + maxX) / 2;

        const centroid = outer.center;
        let R = 0;
        if (revolveAxis === 'left') {
          R = Math.abs(centroid.x - minX);
        } else if (revolveAxis === 'right') {
          R = Math.abs(maxX - centroid.x);
        } else if (revolveAxis === 'origin-y') {
          R = Math.abs(centroid.x);
        } else if (revolveAxis === 'origin-x') {
          R = Math.abs(centroid.y);
        } else {
          R = Math.abs(centroid.x - lCx);
        }
        R = Math.max(R, 1.0);
        totalVolume += 2 * Math.PI * R * activeArea;
      }
    });

    return totalVolume;
  };

  const volumeMm3 = calculateActiveLayerVolume();
  const volumeCm3 = volumeMm3 / 1000;
  
  // Weight estimation with typical PLA density = 1.24 g/cm3 and infill shell offset
  const solidFraction = 0.18 + 0.82 * (infill / 100);
  const estimatedWeightG = volumeCm3 * 1.24 * solidFraction;

  // Print speed simulation: volumetric print speed approx 12mm3/s on standard slicers, infilled at standard 80mm/s.
  const estimatedMinutes = volumeCm3 > 0 ? (volumeCm3 * (4.2 + 6.8 * (infill / 100))) : 0;

  const formatPrintTime = (totalMinutes: number): string => {
    if (totalMinutes <= 0) return '0 dk';
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    if (hours > 0) {
      return `${hours} saat ${mins} dakika`;
    }
    return `${mins} dakika`;
  };

  // Check if selected dimension is an edge dimension (for custom edge dimensioning title and hiding positioning selections)
  let isSelectedDimAnEdge = false;
  if (selectedDimensionId !== null) {
    const d = (activeLayer.dimensions || []).find((dim) => dim.id === selectedDimensionId);
    if (d) {
      let closestP1: { type: 'finalPoints' | 'paths'; pathIdx: number; ptIdx: number; dist: number } | null = null;
      let closestP2: { type: 'finalPoints' | 'paths'; pathIdx: number; ptIdx: number; dist: number } | null = null;
      let minD1 = Infinity;
      let minD2 = Infinity;

      finalPoints.forEach((pt, ptIdx) => {
        const d1 = Math.hypot(pt.x - d.p1.x, pt.y - d.p1.y);
        if (d1 < minD1) {
          minD1 = d1;
          closestP1 = { type: 'finalPoints', pathIdx: -1, ptIdx, dist: d1 };
        }
        const d2 = Math.hypot(pt.x - d.p2.x, pt.y - d.p2.y);
        if (d2 < minD2) {
          minD2 = d2;
          closestP2 = { type: 'finalPoints', pathIdx: -1, ptIdx, dist: d2 };
        }
      });

      if (activeLayer.paths) {
        activeLayer.paths.forEach((path, pathIdx) => {
          path.forEach((pt, ptIdx) => {
            const d1 = Math.hypot(pt.x - d.p1.x, pt.y - d.p1.y);
            if (d1 < minD1) {
              minD1 = d1;
              closestP1 = { type: 'paths', pathIdx, ptIdx, dist: d1 };
            }
            const d2 = Math.hypot(pt.x - d.p2.x, pt.y - d.p2.y);
            if (d2 < minD2) {
              minD2 = d2;
              closestP2 = { type: 'paths', pathIdx, ptIdx, dist: d2 };
            }
          });
        });
      }

      const snapMatchThreshold = 25.0;
      const isP1Near = closestP1 && (closestP1 as any).dist < snapMatchThreshold;
      const isP2Near = closestP2 && (closestP2 as any).dist < snapMatchThreshold;

      if (isP1Near && isP2Near && (closestP1 as any).type === (closestP2 as any).type && ((closestP1 as any).type === 'finalPoints' || (closestP1 as any).pathIdx === (closestP2 as any).pathIdx)) {
        isSelectedDimAnEdge = true;
      }
    }
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-100 font-sans text-slate-800 select-none">
      
      {/* 1. Upper Ribbon Bar (Actions & Quick Toolings) */}
      <header className="flex items-center gap-4 px-3 py-1.5 bg-white border-b border-slate-200 overflow-x-auto shrink-0 shadow-sm">
        <div className="flex items-center gap-1.5 pr-3 border-r border-slate-200 shrink-0">
          <Workflow className="w-4 h-4 text-orange-500" />
          <span className="text-xs font-black tracking-wider uppercase text-slate-900">
            CADE<span className="text-orange-500">RIM</span>
          </span>
          <span className="text-[9px] font-mono bg-slate-100 border border-slate-200 px-1 py-0.2 rounded text-slate-500">
            v14.1
          </span>
        </div>

        {/* Sidebar Toggler */}
        <div className="flex items-center border-r border-slate-200 pr-3 shrink-0">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-slate-100 border border-slate-250 hover:bg-slate-200 text-slate-700 transition cursor-pointer font-bold font-mono"
            title={sidebarCollapsed ? "Show Sidebar panel" : "Hide Sidebar panel"}
          >
            {sidebarCollapsed ? <ChevronRight className="w-3 h-3 text-orange-500" /> : <ChevronLeft className="w-3 h-3 text-orange-500" />}
            <span>Sidebar</span>
          </button>
        </div>

        {/* Project Files Save & Load */}
        <div className="flex items-center gap-1 border-r border-slate-200 pr-3 shrink-0">
          <button
            onClick={saveSketchJSON}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-250 hover:border-slate-300 rounded text-[11px] transition cursor-pointer font-bold font-mono"
            title="Save sketch design to computer (.json)"
          >
            <Save className="w-3 h-3 text-orange-500" />
            <span>Save</span>
          </button>
          <label
            className="flex items-center gap-1 px-1.5 py-0.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-250 hover:border-slate-300 rounded text-[11px] transition cursor-pointer font-bold font-mono"
            title="Load previously saved sketch JSON file"
          >
            <Upload className="w-3 h-3 text-emerald-600" />
            <span>Load</span>
            <input
              type="file"
              accept=".json"
              onChange={loadSketchJSON}
              className="hidden"
            />
          </label>
        </div>

        {/* Workspace Layout Selector - Unified CAD Workspace */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 shrink-0 select-none">
          <button
            onClick={() => setWorkspaceLayout('split')}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition duration-150 flex items-center gap-1 cursor-pointer ${
              workspaceLayout === 'split'
                ? 'bg-white text-orange-600 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'
            }`}
            title="Split Mode (2D Sketch Left, 3D View Right)"
          >
            📊 Split View
          </button>
          <button
            onClick={() => setWorkspaceLayout('2d-only')}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition duration-150 flex items-center gap-1 cursor-pointer ${
              workspaceLayout === '2d-only'
                ? 'bg-white text-orange-600 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'
            }`}
            title="Show only 2D Sketch Editor"
          >
            📐 2D Sketch Only
          </button>
          <button
            onClick={() => setWorkspaceLayout('3d-only')}
            className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition duration-150 flex items-center gap-1 cursor-pointer ${
              workspaceLayout === '3d-only'
                ? 'bg-white text-orange-600 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'
            }`}
            title="Show only 3D solid inspector"
          >
            📦 3D Model Only
          </button>
          <button
            onClick={() => {
              setWorkspaceLayout('drawing-sheet');
              logCommandResponse("Technical Drawing Sheet Mode activated! Modify parameters in Side Panel or export to high-res blueprint PDF.");
            }}
            className={`px-3 py-1 text-[11px] font-bold rounded-md transition duration-150 flex items-center gap-1 cursor-pointer ${
              workspaceLayout === 'drawing-sheet'
                ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-sm font-black border border-orange-655'
                : 'text-orange-650 font-extrabold hover:text-slate-900 hover:bg-slate-200/40'
            }`}
            title="Open standard engineering production/manufacturing drawing paper simulation sheet"
          >
            📄 2D Teknik Resim Anteti Sheet
          </button>
        </div>



        {/* Draw Tools */}
        <div className="flex items-center gap-1 border-r border-slate-200 pr-3 shrink-0">
          <span className="text-[10px] uppercase font-mono text-slate-400 mr-1 font-bold">Draw:</span>
          <button
            onClick={() => setCommand('line')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'line' ? 'bg-orange-500 border-orange-600 text-white font-bold shadow-sm' : 'bg-slate-100 border-slate-250 text-slate-700 hover:bg-slate-200'
            }`}
            title="Line (L)"
          >
            <PenTool className="w-3 h-3" />
            <span>Line</span>
          </button>
          <button
            onClick={() => setCommand('rect')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'rect' ? 'bg-orange-500 border-orange-600 text-white font-bold shadow-sm' : 'bg-slate-100 border-slate-250 text-slate-700 hover:bg-slate-200'
            }`}
            title="Rectangle (R)"
          >
            <Square className="w-3 h-3" />
            <span>Rect</span>
          </button>
          <button
            onClick={() => setCommand('circle')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'circle' ? 'bg-orange-500 border-orange-600 text-white font-bold shadow-sm' : 'bg-slate-100 border-slate-250 text-slate-700 hover:bg-slate-200'
            }`}
            title="Circle (C)"
          >
            <Circle className="w-3 h-3" />
            <span>Circle</span>
          </button>
          <button
            onClick={() => setCommand('polygon')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'polygon' ? 'bg-orange-500 border-orange-600 text-white font-bold shadow-sm' : 'bg-slate-100 border-slate-250 text-slate-700 hover:bg-slate-200'
            }`}
            title="Polygon (POL)"
          >
            <Maximize className="w-3 h-3 rotate-45" />
            <span>Poly</span>
          </button>
          <button
            onClick={() => {
              setCommand('dimension');
              setDimP1(null);
              setDimP2(null);
              setClickCount(0);
              logCommandResponse("Smart dimensioning active. Click starting point.");
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'dimension' ? 'bg-orange-600 border-orange-700 text-white font-bold shadow-sm' : 'bg-slate-100 border-slate-250 text-slate-700 hover:bg-slate-200'
            }`}
            title="Smart dimensioning & constraint tool"
          >
            <Ruler className="w-3 h-3 text-white" />
            <span>Dimension</span>
          </button>

          {finalPoints.length >= 2 && (
            <button
              onClick={() => {
                saveState();
                setLayers((prevLayers) =>
                  prevLayers.map((l) => {
                    if (l.id === activeLayerId) {
                      const currentPaths = l.paths || [];
                      const ptsToCommit = [...l.finalPoints];
                      if (l.isClosed && ptsToCommit.length >= 3 && distance(ptsToCommit[0], ptsToCommit[ptsToCommit.length - 1]) > 0.1) {
                        ptsToCommit.push({ ...ptsToCommit[0] });
                      }
                      return {
                        ...l,
                        paths: [...currentPaths, ptsToCommit],
                        finalPoints: [],
                        isClosed: false
                      };
                    }
                    return l;
                  })
                );
                clearCommand();
                setTempPoint(null);
                logCommandResponse("Drafting shape completed and saved to layer paths.");
              }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-emerald-50 border border-emerald-300 text-emerald-700 hover:bg-emerald-100 transition font-mono font-bold animate-pulse cursor-pointer"
              title="Save active path to layer paths database"
            >
              <CheckCircle className="w-3 h-3" />
              <span>Finish Shape</span>
            </button>
          )}
        </div>

        {/* Dynamic Draw Mode / Operations Switcher */}
        <div className="flex items-center gap-1 border-r border-slate-200 pr-3 shrink-0 font-sans">
          <span className="text-[10px] uppercase font-mono text-slate-400 mr-1 font-bold">Mode:</span>
          <button
            onClick={() => {
              clearCommand();
              setDrawMode('freehand');
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              drawMode === 'freehand' ? 'bg-orange-100 border-orange-400 text-orange-700 font-bold' : 'bg-slate-100 border-slate-250 text-slate-700 hover:bg-slate-200'
            }`}
            title="Freehand Mode"
          >
            <span>✏️ Freehand</span>
          </button>
          <button
            onClick={() => {
              clearCommand();
              setDrawMode('point');
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              drawMode === 'point' ? 'bg-orange-100 border-orange-400 text-orange-700 font-bold' : 'bg-slate-100 border-slate-250 text-slate-700 hover:bg-slate-200'
            }`}
            title="Coordinate Input Mode"
          >
            <span>📐 Coordinate Input</span>
          </button>
          <button
            onClick={() => {
              clearCommand();
              setDrawMode('drag');
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              drawMode === 'drag' ? 'bg-orange-100 border-orange-400 text-orange-700 font-bold' : 'bg-slate-100 border-slate-250 text-slate-700 hover:bg-slate-200'
            }`}
            title="Vertex Edit & Drag Mode"
          >
            <span>👆 Edit Vertex</span>
          </button>
        </div>

        {/* Modifiers */}
        <div className="flex items-center gap-1 border-r border-slate-200 pr-3 shrink-0">
          <span className="text-[10px] uppercase font-mono text-slate-405 mr-1 font-bold">Edit:</span>
          <button
            onClick={() => applyFillet()}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-slate-100 border border-slate-250 hover:bg-slate-200 text-slate-700 hover:text-slate-900 transition font-mono font-bold"
            title="Apply Fillet Rounding (F)"
          >
            <RefreshCw className="w-3 h-3 text-orange-500" />
            <span>Fillet</span>
          </button>
          <button
            onClick={() => applyChamfer()}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-slate-100 border border-slate-250 hover:bg-slate-200 text-slate-700 hover:text-slate-900 transition font-mono font-bold"
            title="Apply Chamfer (CH)"
          >
            <ListFilter className="w-3 h-3 text-orange-500" />
            <span>Chamfer</span>
          </button>
          <button
            onClick={() => {
              clearCommand();
              setCurrentCommand('trim');
              logCommandResponse("TRIM mode activated. Click on any segment to trim it between intersections.");
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'trim' ? 'bg-orange-500 border-orange-600 text-white font-bold' : 'bg-slate-100 border-slate-250 text-slate-700 hover:bg-slate-200'
            }`}
            title="Trim segment (Makas Budama)"
          >
            <Trash2 className="w-3 h-3 text-red-500" />
            <span>Trim</span>
          </button>
          <button
            onClick={() => {
              clearCommand();
              setCurrentCommand('extend');
              logCommandResponse("EXTEND mode activated. Click near an open endpoint to extend it to the next intersection.");
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'extend' ? 'bg-orange-500 border-orange-600 text-white font-bold' : 'bg-slate-100 border-slate-250 text-slate-700 hover:bg-slate-200'
            }`}
            title="Extend segment (Uzatma)"
          >
            <Maximize className="w-3 h-3 text-cyan-600" />
            <span>Extend</span>
          </button>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-slate-105 border border-slate-250 hover:bg-slate-200 text-slate-700 hover:text-orange-500 transition font-mono font-bold"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3 h-3 text-orange-500" />
            <span>Undo</span>
          </button>
        </div>

        {/* Snap Select Toggles */}
        <div className="flex items-center gap-1 border-r border-slate-200 pr-3 shrink-0 font-mono text-[10px]">
          <span className="text-[10px] uppercase text-slate-400 mr-1.5 font-bold">Snaps:</span>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, origin: !prev.origin }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.origin ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Origin Snap (Orijine Kenetlen)"
          >
            Origin
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, end: !prev.end }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.end ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Endpoint Snap (Uç Noktası)"
          >
            End
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, mid: !prev.mid }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.mid ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Midpoint Snap (Orta Nokta)"
          >
            Mid
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, int: !prev.int }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.int ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Intersection Snap (Kesişim)"
          >
            Int
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, tan: !prev.tan }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.tan ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Tangent Snap (Daire Teğetleri)"
          >
            Tan
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, quad: !prev.quad }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.quad ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Quadrant Snap (Çeyrek Daire)"
          >
            Quad
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, near: !prev.near }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.near ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Nearest Snap (En Yakın Çizgi Üstü Nokta)"
          >
            Near
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, extension: !prev.extension }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.extension ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Extension & Angle Track Alignment (Uzantı ve Eksen Hizalama)"
          >
            Extend & Align
          </button>
        </div>

        {/* View settings */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => {
              setViewZoom(1.0);
              setPanX(0);
              setPanY(0);
            }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-slate-100 border border-slate-250 hover:bg-slate-200 text-slate-700 transition font-mono font-bold"
            title="Reset Zoom & Pan View"
          >
            <Maximize className="w-3 h-3 text-orange-500" />
            <span>Sığdır</span>
          </button>
          <button
            onClick={handleClearAll}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-red-50 border border-red-200 text-red-650 hover:bg-red-100 transition font-mono font-bold"
            title="Wipe canvas clean"
          >
            <Trash2 className="w-3 h-3 text-red-500" />
            <span>Temizle</span>
          </button>
        </div>
      </header>

      {/* Main CAD Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* 2. Side Panel Controllers */}
        <aside className={`bg-slate-50 border-r border-slate-200 flex flex-col overflow-y-auto shrink-0 transition-all duration-200 overflow-hidden ${sidebarCollapsed ? 'w-0 border-r-0 pb-0' : 'w-[290px]'}`}>
          
          {/* Elegant Sidebar Tab Bar Toggle */}
          <div className="flex border-b border-slate-200 bg-slate-100/80 p-1 shrink-0 gap-1">
            <button
              onClick={() => setSidebarTab('sketch')}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase transition rounded text-center cursor-pointer ${
                sidebarTab === 'sketch' ? 'bg-white text-orange-600 shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200/50'
              }`}
            >
              🛠 Tools
            </button>
            <button
              onClick={() => setSidebarTab('layers')}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase transition rounded text-center cursor-pointer ${
                sidebarTab === 'layers' ? 'bg-white text-orange-600 shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200/50'
              }`}
            >
              🔍 Layers
            </button>
            <button
              onClick={() => setSidebarTab('dimensions')}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase transition rounded text-center cursor-pointer ${
                sidebarTab === 'dimensions' ? 'bg-white text-orange-600 shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200/50'
              }`}
            >
              📐 Dim/Pos
            </button>
            <button
              onClick={() => setSidebarTab('3d')}
              className={`flex-1 py-1.5 text-[10px] font-bold uppercase transition rounded text-center cursor-pointer ${
                sidebarTab === '3d' ? 'bg-white text-orange-600 shadow-sm border border-slate-200' : 'text-slate-500 hover:bg-slate-200/50'
              }`}
            >
              📦 3D View
            </button>
          </div>
          
          {/* TAB CONTENT: SKETCH SETTINGS */}
          {sidebarTab === 'sketch' && (
            <div className="flex-1 flex flex-col overflow-y-auto divide-y divide-slate-200">
              
              {/* Section A: Active Sketch Sandbox */}
              <div className="p-4">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5 mb-3">
                  <Activity className="w-4 h-4 text-orange-600" />
                  <span>1. Sketch Toolbox</span>
                </h2>

                <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-2 shadow-xs">
                  <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase font-mono block">Active Sketch Mode:</span>
                  <label className="flex items-center gap-2 cursor-pointer text-xs p-1.5 rounded hover:bg-slate-50 transition font-sans font-medium text-slate-700">
                    <input
                      type="radio"
                      name="editMode"
                      checked={drawMode === 'freehand'}
                      onChange={() => {
                        clearCommand();
                        setDrawMode('freehand');
                      }}
                      className="rounded text-orange-500 focus:ring-orange-500 cursor-pointer"
                    />
                    <span>✏️ Freehand Mode</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs p-1.5 rounded hover:bg-slate-50 transition font-sans font-medium text-slate-700">
                    <input
                      type="radio"
                      name="editMode"
                      checked={drawMode === 'point'}
                      onChange={() => {
                        clearCommand();
                        setDrawMode('point');
                      }}
                      className="rounded text-orange-500 focus:ring-orange-500 cursor-pointer"
                    />
                    <span>📐 Coordinate Point Input</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs p-1.5 rounded hover:bg-slate-50 transition font-sans font-medium text-slate-700">
                    <input
                      type="radio"
                      name="editMode"
                      checked={drawMode === 'drag'}
                      onChange={() => {
                        clearCommand();
                        setDrawMode('drag');
                      }}
                      className="rounded text-orange-500 focus:ring-orange-500 cursor-pointer"
                    />
                    <span>👆 Vertex Edit / Drag</span>
                  </label>
                </div>

                {/* Fillet & Chamfer Controls */}
                <div className="mt-3 bg-white p-2.5 rounded-lg border border-slate-200 space-y-2.5 shadow-xs">
                  <span className="text-[10px] font-bold tracking-wider text-slate-400 uppercase font-mono block">Geometry Modifiers</span>
                  
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                      <span>Fillet Radius (r):</span>
                      <span className="text-orange-600 font-bold">{filletRadius} mm</span>
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        value={filletRadius}
                        onChange={(e) => setFilletRadius(Math.max(1, parseInt(e.target.value) || 1))}
                        className="flex-1 min-w-0 bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-800 outline-none focus:border-orange-500 font-mono"
                        min="1"
                        max="500"
                      />
                      <button
                        onClick={() => applyFillet(filletRadius)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-250 hover:border-slate-350 rounded text-xs transition cursor-pointer text-slate-700 font-bold font-mono"
                        title="Apply rounding radius to all corners"
                      >
                        Fillet
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                      <span>Chamfer Distance (d):</span>
                      <span className="text-orange-600 font-bold">{chamferDistance} mm</span>
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        value={chamferDistance}
                        onChange={(e) => setChamferDistance(Math.max(1, parseInt(e.target.value) || 1))}
                        className="flex-1 min-w-0 bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-800 outline-none focus:border-orange-500 font-mono"
                        min="1"
                        max="500"
                      />
                      <button
                        onClick={() => applyChamfer(chamferDistance)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-250 hover:border-slate-350 rounded text-xs transition cursor-pointer text-slate-700 font-bold font-mono"
                        title="Apply corner chamfer to all corners"
                      >
                        Chamfer
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                      <span>Offset Distance (d):</span>
                      <span className="text-orange-600 font-bold">{offsetDistance} mm</span>
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        value={offsetDistance}
                        onChange={(e) => setOffsetDistance(Math.max(1, parseInt(e.target.value) || 1))}
                        className="flex-1 min-w-0 bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-800 outline-none focus:border-orange-500 font-mono"
                        min="1"
                        max="500"
                      />
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => applyOffset(-offsetDistance)}
                          className="px-2.5 py-1 bg-slate-105 hover:bg-slate-200 border border-slate-250 hover:border-slate-350 rounded text-xs transition cursor-pointer text-slate-700 font-bold font-mono"
                          title="Offset selected shape inward"
                        >
                          Inward
                        </button>
                        <button
                          onClick={() => applyOffset(offsetDistance)}
                          className="px-2.5 py-1 bg-slate-105 hover:bg-slate-200 border border-slate-250 hover:border-slate-350 rounded text-xs transition cursor-pointer text-slate-700 font-bold font-mono"
                          title="Offset selected shape outward"
                        >
                          Outward
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 bg-white p-3 rounded-lg border border-slate-200 text-[10px] space-y-1.5 font-mono text-slate-500 shadow-xs">
                  <p className="text-orange-600 font-bold">USEFUL TIPS:</p>
                  <p>• <span className="text-slate-700 font-bold">Double-click</span> on lines to insert a new corner point (vertex).</p>
                  <p>• <span className="text-slate-700 font-bold">Right-click</span> to close and save the active polygon sketch.</p>
                  <p>• Drag vertices to dynamically update and measure coordinates and segment lengths.</p>
                </div>
              </div>
            </div>
          )}
          {sidebarTab === 'dimensions' && (
            <div className="p-4 border-b border-slate-200 flex flex-col shrink-0">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-850 flex items-center gap-1.5 mb-2.5">
                <Ruler className="w-4 h-4 text-orange-600 font-extrabold" />
                <span>2. Dimensions & Coordinates</span>
              </h2>

              {selectedVertexIdx === null ? (
                <div className="space-y-3">
                  <div className="bg-white border border-slate-200 p-3 rounded-lg text-[10.5px] text-slate-500 font-sans leading-relaxed shadow-xs">
                    <p className="font-semibold text-slate-800 mb-1">💡 Parametric Placement & 3D Boolean:</p>
                    In Vertex Selection mode, click any vertex on the screen to view and adjust its precise coordinates, connected lines lengths, or round/bevel parameters. You can also configure circle dimensions precisely here.
                  </div>
                  {renderShapeSolidSettings()}
                </div>
              ) : (() => {
              const data = getSelectedVertexAndNeighbors();
              if (!data) return null;
              
              const { current, prevPt, nextPt, isCircle, circleData } = data;
              const d1 = prevPt ? Math.hypot(current.x - prevPt.x, current.y - prevPt.y) : null;
              const d2 = nextPt ? Math.hypot(current.x - nextPt.x, current.y - nextPt.y) : null;

              return (
                <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-3 font-sans shadow-xs">
                  {/* Selected label */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-450 border-b border-slate-200 pb-2 mb-1">
                    <span>Selected Vertex:</span>
                    <span className="text-orange-600 font-bold bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200 font-mono">Node #{selectedVertexIdx}</span>
                  </div>

                  {isCircle && circleData ? (
                    /* Circle specific dimension inputs */
                    <div className="space-y-3">
                      <div className="text-[10px] font-bold tracking-wider text-slate-700 uppercase font-sans text-left pb-1 border-b border-slate-100">
                        🔵 Circle Parameters
                      </div>
                      
                      {/* Radius */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 block font-sans text-left font-semibold">Radius (R):</span>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="any"
                            value={parseFloat(circleData.radius.toFixed(2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v > 0) handleUpdateCircleRadius(v);
                            }}
                            className="flex-1 min-w-0 bg-white border border-slate-300 text-xs px-2 py-1.5 rounded text-slate-800 outline-none focus:border-orange-500 font-mono"
                          />
                          <span className="text-[10px] font-mono self-center text-slate-400 font-bold">mm</span>
                        </div>
                      </div>

                      {/* Center X */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 block font-sans text-left font-semibold">Center X (Cx):</span>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="any"
                            value={parseFloat(circleData.center.x.toFixed(2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) handleUpdateCircleCenter(v, circleData.center.y);
                            }}
                            className="flex-1 min-w-0 bg-white border border-slate-300 text-xs px-2 py-1.5 rounded text-slate-800 outline-none focus:border-orange-500 font-mono"
                          />
                          <span className="text-[10px] font-mono self-center text-slate-400 font-bold">mm</span>
                        </div>
                      </div>

                      {/* Center Y */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-slate-500 block font-sans text-left font-semibold">Center Y (Cy):</span>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="any"
                            value={parseFloat(circleData.center.y.toFixed(2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) handleUpdateCircleCenter(circleData.center.x, v);
                            }}
                            className="flex-1 min-w-0 bg-white border border-slate-300 text-xs px-2 py-1.5 rounded text-slate-800 outline-none focus:border-orange-500 font-mono"
                          />
                          <span className="text-[10px] font-mono self-center text-slate-400 font-bold">mm</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* General segment path inputs */
                    <div className="space-y-3">
                      <div className="text-[10px] font-bold tracking-wider text-slate-700 uppercase font-sans text-left pb-1 border-b border-slate-100">
                        📍 Vertex Coordinates
                      </div>

                      {/* Direct Absolute Coordinates */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-500 block font-sans text-left font-semibold">Position X:</span>
                          <input
                            type="number"
                            step="any"
                            value={parseFloat(current.x.toFixed(2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) updateVertexCoords(v, current.y);
                            }}
                            className="w-full bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-805 outline-none focus:border-orange-500 font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-500 block font-sans text-left font-semibold">Position Y:</span>
                          <input
                            type="number"
                            step="any"
                            value={parseFloat(current.y.toFixed(2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) updateVertexCoords(current.x, v);
                            }}
                            className="w-full bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-805 outline-none focus:border-orange-500 font-mono"
                          />
                        </div>
                      </div>

                      <label className="flex items-start gap-1.5 cursor-pointer select-none text-left py-1.5 px-2 bg-slate-50 hover:bg-slate-100 rounded border border-slate-200 transition mt-1 shadow-xxs">
                        <input
                          type="checkbox"
                          checked={moveEntireShapeOnCoordChange}
                          onChange={(e) => setMoveEntireShapeOnCoordChange(e.target.checked)}
                          className="w-3.5 h-3.5 mt-0.5 text-orange-600 focus:ring-orange-500 rounded border-slate-300 bg-white"
                        />
                        <div className="flex flex-col">
                          <span className="text-[10px] font-sans font-bold text-slate-700 leading-tight">
                            Şekli Bir Bütün Olarak Taşı (İç Konumlandırma)
                          </span>
                          <span className="text-[8.5px] font-sans text-slate-400 leading-normal mt-0.5">
                            Seçili noktayı ötelere taşırken geometrinin orijinal bütünü korunur, diğer çizimler sabit kalır.
                          </span>
                        </div>
                      </label>

                      <div className="text-[10px] font-bold tracking-wider text-slate-700 uppercase font-sans text-left pt-1.5 border-t border-slate-200">
                        📐 Connected Segment Lengths
                      </div>

                      {/* L1 Length (to previous) */}
                      {d1 !== null && (
                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-500 block font-sans text-left font-semibold">Prev Line Length (L1):</span>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              step="any"
                              value={parseFloat(d1.toFixed(2))}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v) && v > 0) updateSegmentLength('prev', v);
                              }}
                              className="flex-1 min-w-0 bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-805 outline-none focus:border-orange-500 font-mono"
                            />
                            <span className="text-[10px] font-mono self-center text-slate-400 font-bold">mm</span>
                          </div>
                        </div>
                      )}

                      {/* L2 Length (to next) */}
                      {d2 !== null && (
                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-500 block font-sans text-left font-semibold">Next Line Length (L2):</span>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              step="any"
                              value={parseFloat(d2.toFixed(2))}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v) && v > 0) updateSegmentLength('next', v);
                              }}
                              className="flex-1 min-w-0 bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-805 outline-none focus:border-orange-500 font-mono"
                            />
                            <span className="text-[10px] font-mono self-center text-slate-400 font-bold">mm</span>
                          </div>
                        </div>
                      )}

                      {/* Fillet & Chamfer ON selected vertex */}
                      <div className="text-[10px] font-bold tracking-wider text-slate-700 uppercase font-sans text-left pt-1.5 border-t border-slate-200">
                        📐 Corner Round / Bevel
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <span className="text-[9px] text-slate-500 block font-sans text-left font-semibold">Fillet Radius (r):</span>
                          <input
                            type="number"
                            value={filletRadius}
                            onChange={(e) => setFilletRadius(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-805 outline-none focus:border-orange-500 font-mono"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[9px] text-slate-500 block font-sans text-left font-semibold">Chamfer Size (d):</span>
                          <input
                            type="number"
                            value={chamferDistance}
                            onChange={(e) => setChamferDistance(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-805 outline-none focus:border-orange-500 font-mono"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        <button
                          onClick={() => applyFillet(filletRadius, selectedVertexIdx)}
                          className="py-1.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-[10px] font-bold font-sans text-orange-700 rounded transition cursor-pointer text-center"
                          title="Apply rounding fillet to this specific corner corner node"
                        >
                          Fillet Corner
                        </button>
                        <button
                          onClick={() => applyChamfer(chamferDistance, selectedVertexIdx)}
                          className="py-1.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-[10px] font-bold font-sans text-orange-700 rounded transition cursor-pointer text-center"
                          title="Apply chamfer bevel to this specific corner node"
                        >
                          Chamfer Corner
                        </button>
                      </div>
                    </div>
                  )}

                   {/* Coordinate Reference Placement panel */}
                  <div className="pt-2.5 border-t border-slate-200 space-y-2">
                    <div className="text-[10px] font-bold tracking-wider text-orange-650 uppercase font-sans text-left flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                      CAD Ref Positioning
                    </div>
                    <p className="text-[9px] text-slate-400 leading-normal text-left">
                      Place the shapes onto absolute coordinate space using this selected node as reference handle:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <span className="text-[9px] text-slate-500 block font-sans text-left">Target X (Horiz):</span>
                        <input
                          type="number"
                          step="any"
                          value={alignTargetX}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setAlignTargetX(isNaN(val) ? 0 : val);
                          }}
                          className="w-full bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-850 outline-none focus:border-orange-500 font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] text-slate-500 block font-sans text-left">Target Y (Vert):</span>
                        <input
                          type="number"
                          step="any"
                          value={alignTargetY}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setAlignTargetY(isNaN(val) ? 0 : val);
                          }}
                          className="w-full bg-white border border-slate-300 text-xs px-2 py-1 rounded text-slate-850 outline-none focus:border-orange-500 font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 pt-1.5">
                      <button
                        onClick={() => alignSelectedShapeBySelectedVertex(alignTargetX, alignTargetY)}
                        className="w-full py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded font-sans font-bold text-[10px] transition cursor-pointer text-center shadow-xs flex items-center justify-center gap-1"
                        title="İç Konumlandırma: Diğer çizimlere kesinlikle dokunmadan sadece bu seçili şekli/deliği hassas olarak bu koordinata taşır"
                      >
                        📍 Yalnızca Bu Şekli Konumlandır
                      </button>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => alignEntireSketchBySelectedVertex(0, 0)}
                          className="flex-1 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-250 text-[9px] text-slate-600 hover:text-slate-900 rounded font-mono font-bold transition cursor-pointer text-center"
                          title="Tüm skeçi orijine sıfırlar"
                        >
                          Uzaklığı Sıfırla (0,0)
                        </button>
                        <button
                          onClick={() => alignEntireSketchBySelectedVertex(alignTargetX, alignTargetY)}
                          className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-250 text-[9px] text-slate-700 hover:text-slate-950 rounded font-mono font-bold transition cursor-pointer text-center"
                          title="Tüm çizimi bütünüyle bu noktaya göre kaydırır"
                        >
                          Tüm Skeçi Ötele
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Deselect button */}
                  {renderShapeSolidSettings()}
                  <button
                    onClick={() => {
                      setSelectedVertexIdx(null);
                      setSelectedPathIdx(-1);
                    }}
                    className="w-full mt-2 py-1.5 bg-slate-100 hover:bg-slate-250/85 border border-slate-200 text-[10px] text-slate-700 rounded font-sans font-bold transition cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              );
            })()}
          </div>
          )}

          {/* Section B: Layer Manager */}
          {sidebarTab === 'layers' && (
            <div className="p-4 border-b border-slate-200 flex flex-col shrink-0">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-850 flex items-center justify-between mb-3">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-orange-600 font-extrabold" />
                  <span>2. Layer Manager (Layers)</span>
                </span>
                <button
                  onClick={addNewLayer}
                  className="px-2 py-0.5 rounded text-[10px] font-mono bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 font-bold transition flex items-center gap-1 cursor-pointer"
                  title="Create a new CAD draft layer"
                >
                  <Plus className="w-3 h-3 text-orange-600" />
                  <span>Add Layer</span>
                </button>
              </h2>

            <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
              {layers.map((layer) => {
                const isActive = layer.id === activeLayerId;
                return (
                  <div
                    key={layer.id}
                    className={`flex items-center justify-between gap-1.5 p-2 rounded-lg border transition ${
                      isActive
                        ? 'bg-orange-50 border-orange-300 shadow-sm'
                        : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {/* Layer Selector Left Section */}
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Active radio select */}
                      <input
                        type="radio"
                        name="activeLayerChoice"
                        checked={isActive}
                        onChange={() => setActiveLayerId(layer.id)}
                        className="rounded-full w-3 h-3 text-orange-500 bg-white border-slate-300 cursor-pointer focus:ring-0 shrink-0 accent-orange-500"
                      />
                      <input
                        type="text"
                        value={layer.name}
                        onChange={(e) => updateLayerProps(layer.id, { name: e.target.value })}
                        className={`text-xs bg-transparent border-0 outline-none font-semibold font-mono p-0 min-w-0 max-w-[120px] flex-1 truncate ${
                          isActive ? 'text-orange-600' : 'text-slate-600 hover:bg-slate-100 focus:bg-white focus:px-1 rounded'
                        }`}
                        title="Click to rename this layer"
                      />
                    </div>

                    {/* Layer Action Controls Right Section */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Color Palette Input Wrapper */}
                      <div className="relative w-4 h-4 rounded cursor-pointer shrink-0 border border-slate-300" style={{ backgroundColor: layer.color }} title="Change layer color">
                        <input
                          type="color"
                          value={layer.color}
                          onChange={(e) => updateLayerProps(layer.id, { color: e.target.value })}
                          className="bg-transparent border-0 p-0 w-full h-full cursor-pointer absolute inset-0 opacity-0 z-10"
                        />
                        <Palette className="w-2.5 h-2.5 text-zinc-950 absolute inset-0.5 pointer-events-none stroke-[2.5]" />
                      </div>

                      {/* Visible/Hidden Toggles */}
                      <button
                        onClick={() => toggleLayerVisibility(layer.id)}
                        className={`p-1 rounded hover:bg-slate-100 transition shrink-0 ${
                          layer.visible ? 'text-slate-500 hover:text-slate-700' : 'text-slate-300 hover:text-slate-400'
                        }`}
                        title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                      >
                        {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>

                      {/* Locked/Unlocked Toggles */}
                      <button
                        onClick={() => toggleLayerLock(layer.id)}
                        className={`p-1 rounded hover:bg-slate-100 transition shrink-0 ${
                          layer.locked ? 'text-orange-500 hover:text-orange-600' : 'text-slate-300 hover:text-slate-500'
                        }`}
                        title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
                      >
                        {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>

                      {/* Trash Button */}
                      {layers.length > 1 && (
                        <button
                          onClick={() => deleteLayer(layer.id)}
                          className="p-1 rounded text-slate-400 hover:text-red-650 hover:bg-red-500/10 transition shrink-0"
                          title="Delete Layer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Info label */}
            <div className="mt-1.5 text-[9px] font-mono text-slate-400 leading-tight text-center">
              * Hidden layers are excluded from 3D solid model generation *
            </div>
          </div>
          )}

          {/* Section B-2: CAD Core Edit Actions (CAD Düzenleme Menüsü) */}
          {sidebarTab === 'sketch' && (
            <div className="p-4 border-b border-slate-200 space-y-3 shrink-0">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Scissors className="w-4 h-4 text-orange-600" />
                  <span>2. Block Editing & Transform</span>
                </span>
                <span className="text-[10px] font-mono text-orange-650 bg-orange-50 px-1.5 py-0.5 rounded border border-orange-200 font-bold">
                  PRO TOOLS
                </span>
              </h2>

            {/* Current Selection Status Banner */}
            <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-left space-y-1 shadow-xs">
              <div className="text-[9px] font-mono font-bold uppercase text-slate-400">
                SELECTION STATUS
              </div>
              {isFinalPointsSelected || selectedPathIndices.length > 0 ? (
                <div className="text-xs font-bold text-orange-600 flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse" />
                  <span>
                    {isFinalPointsSelected ? "Active Polygon" : ""}
                    {isFinalPointsSelected && selectedPathIndices.length > 0 ? " and " : ""}
                    {selectedPathIndices.length > 0 ? `${selectedPathIndices.length} Shape(s)` : ""} Selected!
                  </span>
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic leading-snug font-medium">
                  No object selected. Click on a shape to select, copy, delete, rotate, or scale it. Or right-click and drag a box. (Del deletes)
                </div>
              )}
            </div>

            {/* Sketch Integrity & Grouping System (Bütünlük ve Bağlantı Kontrolleri) */}
            <div className="p-2.5 rounded-lg bg-orange-50/45 border border-orange-100 text-left space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[9px] font-mono font-bold uppercase text-orange-600 flex items-center gap-1">
                  <Workflow className="w-3.5 h-3.5 text-orange-500" />
                  <span>CAD SKETCH INTEGRITY (BÜTÜNLÜK)</span>
                </div>
                {(() => {
                  const groupStatus = getSelectedShapeGroupStatus();
                  if (groupStatus === 'joined') {
                    return (
                      <span className="text-[9px] font-mono font-bold bg-green-500/10 text-green-700 px-1.5 py-0.5 rounded border border-green-200">
                        BÜTÜNLEŞİK (JOINED)
                      </span>
                    );
                  }
                  if (groupStatus === 'independent') {
                    return (
                      <span className="text-[9px] font-mono font-bold bg-purple-500/10 text-purple-700 px-1.5 py-0.5 rounded border border-purple-200">
                        BAĞIMSIZ (SEPARATE)
                      </span>
                    );
                  }
                  return (
                    <span className="text-[9px] font-mono font-bold bg-slate-105 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">
                      SİSTEM AKTİF
                    </span>
                  );
                })()}
              </div>

              <p className="text-[9.5px] text-slate-600 leading-normal">
                {(() => {
                  const groupStatus = getSelectedShapeGroupStatus();
                  if (groupStatus === 'joined') {
                    return "Bu obje parça bütünlüğüne bağlıdır. Beraber seçilir, kopyalanır, taşınır ve bütünlüğü korunur.";
                  }
                  if (groupStatus === 'independent') {
                    return "Bu obje ana parçadan ayrılmıştır. Bağımsız olarak tek başına konumlandırılabilir.";
                  }
                  return "Yeni eklenen tüm şekiller (daire, poligon, rect vb.) çizerken önceki şekle otomatik join (bağlanıp) olur, parça bütünlüğü korunur.";
                })()}
              </p>

              {(() => {
                const groupStatus = getSelectedShapeGroupStatus();
                if (groupStatus === 'none') return null;
                return (
                  <div className="grid grid-cols-1 gap-1 pt-1">
                    {groupStatus === 'joined' ? (
                      <button
                        onClick={handleSeparateFromSketch}
                        className="w-full py-1.5 bg-white hover:bg-purple-50 border border-purple-200 hover:border-purple-300 rounded text-[10px] font-extrabold font-mono text-purple-700 flex items-center justify-center gap-1 transition cursor-pointer shadow-xs"
                        title="Seçili taze eklenen alt şekli sketç bütünlüğünden kopararak tamamen bağımsız hale getirir."
                      >
                        <Scissors className="w-3.5 h-3.5 text-purple-500" />
                        ✂️ SKETÇTEN AYIR (Separate from Sketch)
                      </button>
                    ) : (
                      <button
                        onClick={handleJoinToSketch}
                        className="w-full py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-250 rounded text-[10px] font-extrabold font-mono text-emerald-850 flex items-center justify-center gap-1 transition cursor-pointer shadow-xs"
                        title="Ayrılmış olan alt şekli tekrar ana sketç bütünlüğüne bağlayarak tek parça yapar."
                      >
                        <Workflow className="w-3.5 h-3.5 text-emerald-600" />
                        🔗 SKETÇE GERİ BAĞLA (Join to Sketch)
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Editing Controls Grid */}
            <div className="space-y-3">
              {/* Row 1: Copy, Paste, Duplicate and Delete */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleCopy}
                  className="py-2 bg-slate-50 hover:bg-slate-100 border border-slate-250 rounded text-xs font-bold font-mono text-slate-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  title="Copy selected items to clipboard (Ctrl + C)"
                >
                  <Copy className="w-3.5 h-3.5 text-orange-500" />
                  Copy (Ctrl+C)
                </button>
                <button
                  onClick={handlePaste}
                  className="py-2 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded text-xs font-bold font-mono text-orange-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  title="Paste copied shapes near mouse cursor (Ctrl + V)"
                >
                  <Clipboard className="w-3.5 h-3.5 text-orange-600" />
                  Paste (Ctrl+V)
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={applyCadEditCopy}
                  className="py-2 bg-slate-50 hover:bg-slate-100 border border-slate-250 rounded text-xs font-bold font-mono text-slate-700 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  title="Duplicate selected assets instantly (Ctrl + D)"
                >
                  <Copy className="w-3.5 h-3.5 text-orange-500 opacity-60" />
                  Duplicate (Ctrl+D)
                </button>
                <button
                  onClick={applyCadEditDelete}
                  className="py-2 bg-red-50 hover:bg-red-100 border border-red-200 rounded text-xs font-bold font-mono text-red-650 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  title="Delete selected CAD items (Delete / Backspace)"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  Delete (Del)
                </button>
              </div>

              {/* Point-Selective Transform Controls */}
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 mt-2 space-y-1.5 shadow-xs">
                <span className="text-[10px] text-slate-400 font-mono font-bold flex items-center gap-1">
                  <Sliders className="w-3 h-3 text-orange-500" />
                  📍 POINT-SELECTIVE TRANSFORMS
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      if (!isFinalPointsSelected && selectedPathIndices.length === 0) {
                        logCommandResponse("Lütfen önce taşımak istediğiniz objeyi/objeleri seçin (Tıklayarak veya kutuyla seçerek).");
                        return;
                      }
                      setMovePointSelectMode(movePointSelectMode ? null : 'base_point');
                      setCopyPointSelectMode(null);
                      setBaseSelectionPoint(null);
                      logCommandResponse(movePointSelectMode ? "Selective Move mode canceled." : "Selective Move: Click a reference BASE point on the canvas (Or snap to a corner/midpoint).");
                    }}
                    className={`py-1.5 border rounded font-mono text-[9px] font-bold text-center transition cursor-pointer flex items-center justify-center gap-1 ${
                      movePointSelectMode 
                        ? 'bg-orange-55 border-orange-500 text-orange-700 animate-pulse font-extrabold' 
                        : 'bg-slate-50 border-slate-250 text-slate-600 hover:text-slate-800 hover:bg-slate-100 font-medium'
                    }`}
                    title="Move selected shapes from a source point to a destination point"
                  >
                    🚀 {movePointSelectMode ? "Base Point..." : "Move by Points"}
                  </button>
                  <button
                    onClick={() => {
                      if (!isFinalPointsSelected && selectedPathIndices.length === 0) {
                        logCommandResponse("Lütfen önce kopyalamak istediğiniz objeyi/objeleri seçin (Tıklayarak veya kutuyla seçerek).");
                        return;
                      }
                      setCopyPointSelectMode(copyPointSelectMode ? null : 'base_point');
                      setMovePointSelectMode(null);
                      setBaseSelectionPoint(null);
                      logCommandResponse(copyPointSelectMode ? "Selective Copy mode canceled." : "Selective Copy: Click a reference BASE point on the canvas (Or snap to a corner/midpoint).");
                    }}
                    className={`py-1.5 border rounded font-mono text-[9px] font-bold text-center transition cursor-pointer flex items-center justify-center gap-1 ${
                      copyPointSelectMode 
                        ? 'bg-orange-55 border-orange-500 text-orange-700 animate-pulse font-extrabold' 
                        : 'bg-slate-50 border-slate-250 text-slate-600 hover:text-slate-800 hover:bg-slate-100 font-medium'
                    }`}
                    title="Copy selected shapes from a source point to a destination point"
                  >
                    ✨ {copyPointSelectMode ? "Base Point..." : "Copy by Points"}
                  </button>
                </div>
                {baseSelectionPoint && (
                  <div className="text-[9px] text-orange-600 font-mono text-center leading-normal animate-fade-in p-1 bg-orange-50 border border-orange-100 rounded">
                    Base: ({baseSelectionPoint.x.toFixed(1)}, {baseSelectionPoint.y.toFixed(1)}) → Select target point!
                  </div>
                )}
              </div>

              {/* Row 2: Mirror / Aynala (Horiz & Vert) */}
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1.5 shadow-xs">
                <span className="text-[10px] text-slate-400 font-mono font-bold flex items-center gap-1">
                  <FlipHorizontal className="w-3 h-3 text-orange-500" />
                  🪞 CAD MIRROR
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => applyCadEditMirror('Y')}
                    className="py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded font-mono text-[9px] font-bold text-slate-600 hover:text-slate-900 transition cursor-pointer text-center"
                    title="Mirror horizontally"
                  >
                    ↔ Mirror Horiz
                  </button>
                  <button
                    onClick={() => applyCadEditMirror('X')}
                    className="py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded font-mono text-[9px] font-bold text-slate-600 hover:text-slate-900 transition cursor-pointer text-center"
                    title="Mirror vertically"
                  >
                    ↕ Mirror Vert
                  </button>
                  <button
                    onClick={() => {
                      setAxisMirrorSelectMode(!axisMirrorSelectMode);
                      setMirrorFirstPoint(null);
                      logCommandResponse(axisMirrorSelectMode ? "Mirror axis selection canceled." : "Mirror by axis selection active. Click any line segment to use as anchor mirror axis or select two points.");
                    }}
                    className={`col-span-2 py-1.5 border rounded font-mono text-[9px] font-bold text-center transition cursor-pointer flex items-center justify-center gap-1.5 ${
                      axisMirrorSelectMode 
                        ? 'bg-orange-55 border-orange-500 text-orange-700 animate-pulse' 
                        : 'bg-slate-50 border-slate-250 text-slate-600 hover:text-slate-800 hover:bg-slate-100'
                    }`}
                    title="Choose drawing segment as mirror axis"
                  >
                    ✨ {axisMirrorSelectMode ? "Selecting Axis..." : "🪄 Mirror by Axis"}
                  </button>
                </div>
              </div>

              {/* Row 3: Rotation Engine */}
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 font-mono font-bold flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 text-orange-600 font-extrabold animate-spin-slow" />
                    🔄 ROTATE
                  </span>
                  <span className="text-[9px] text-slate-550 font-mono font-medium">Deg (°)</span>
                </div>

                {/* Pivot (Rotation Center) controls */}
                <div className="space-y-1">
                  <span className="text-[9px] text-slate-500 font-bold font-sans uppercase block text-left">📍 Rotation Center:</span>
                  {rotationCenter ? (
                    <div className="flex items-center justify-between bg-orange-50/70 border border-orange-200 px-2 py-1 rounded text-[10px] font-mono text-orange-700">
                      <span>X: {rotationCenter.x.toFixed(1)} / Y: {rotationCenter.y.toFixed(1)} mm</span>
                      <button
                        onClick={() => {
                          setRotationCenter(null);
                          logCommandResponse("Rotation center cleared. Standard bounding box center used.");
                        }}
                        className="text-[9px] text-red-600 hover:text-red-700 px-1 rounded bg-red-50 border border-red-200 cursor-pointer font-bold"
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setRotationCenterSelectMode(true);
                        logCommandResponse("Döndürme Eksen Noktası Seçin: Dönme eksenini seçmek için ekranda bir noktaya tıklayın.");
                      }}
                      className={`w-full py-1 rounded text-[9px] font-mono font-bold border transition cursor-pointer text-center ${
                        rotationCenterSelectMode
                          ? 'bg-orange-600/30 border-orange-500 text-orange-700 animate-pulse'
                          : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700 hover:text-slate-900'
                      }`}
                    >
                      {rotationCenterSelectMode ? '📍 Click Canvas...' : '📍 Set Pivot Point'}
                    </button>
                  )}
                </div>

                {/* Dynamic & Precise Stepper Controls */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[9px] text-slate-500 font-bold font-sans uppercase block text-left">⚡ Rotation Step Angle:</span>
                  <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-lg border border-slate-200">
                    {/* CCW Rotate Arrow Button */}
                    <button
                      onClick={() => {
                        const parsed = parseFloat(cadRotateAngle);
                        if (!isNaN(parsed)) applyRelativeRotation(-parsed);
                      }}
                      className="p-1 px-2 pb-1.5 bg-white border border-slate-250 rounded text-orange-600 hover:text-orange-700 hover:bg-slate-100 font-black text-xs transition cursor-pointer shrink-0"
                      title={`Rotate Counter Clockwise -${cadRotateAngle || '0'}°`}
                    >
                      ◀
                    </button>
                    
                    {/* Editable custom step in degrees */}
                    <div className="flex-1 flex items-center justify-center gap-1 bg-white border border-slate-300 px-2 rounded">
                      <input
                        type="text"
                        value={cadRotateAngle}
                        onChange={(e) => setCadRotateAngle(e.target.value)}
                        placeholder="5"
                        className="w-full bg-transparent text-center text-xs text-slate-800 font-mono outline-none border-none py-1"
                        title="Döndürme adım açısını girin"
                      />
                      <span className="text-[10px] text-slate-400 font-mono leading-none">°</span>
                    </div>

                    {/* CW Rotate Arrow Button */}
                    <button
                      onClick={() => {
                        const parsed = parseFloat(cadRotateAngle);
                        if (!isNaN(parsed)) applyRelativeRotation(parsed);
                      }}
                      className="p-1 px-2 pb-1.5 bg-white border border-slate-250 rounded text-orange-600 hover:text-orange-700 hover:bg-slate-100 font-black text-xs transition cursor-pointer shrink-0"
                      title={`Rotate Clockwise +${cadRotateAngle || '0'}°`}
                    >
                      ▶
                    </button>
                  </div>

                  {/* Quick Precisions Stepper Presets */}
                  <div className="grid grid-cols-4 gap-1">
                    {[1, 5, 15, 45].map((step) => (
                      <button
                        key={step}
                        onClick={() => setCadRotateAngle(step.toString())}
                        className={`py-1 rounded text-[8px] font-mono transition cursor-pointer text-center border ${
                          parseFloat(cadRotateAngle) === step
                            ? 'bg-orange-50 border-orange-300 text-orange-700 font-bold shadow-xs'
                            : 'bg-white border-slate-200 text-slate-550 hover:text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        {step}° Step
                      </button>
                    ))}
                  </div>
                </div>

                {/* Legacy absolute rotate prompt as alternative fallback */}
                <button
                  onClick={() => {
                    const parsed = parseFloat(cadRotateAngle);
                    if (!isNaN(parsed)) requestRotateAngle(parsed);
                  }}
                  className="w-full py-1 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded text-[9px] font-bold font-mono text-orange-700 transition cursor-pointer uppercase mt-1"
                  title="Prompt absolute angle input"
                >
                  Absolute Rotate (Once)
                </button>
              </div>

              {/* Row 4: Scaling Engine */}
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 font-mono font-bold flex items-center gap-1">
                    <Maximize className="w-3 h-3 text-orange-500" />
                    📐 SCALE OBJECT
                  </span>
                  <span className="text-[9px] text-slate-550 font-mono font-medium">Factor (x)</span>
                </div>
                {/* Scale Presets */}
                <div className="grid grid-cols-5 gap-1">
                  {[0.5, 0.75, 1.25, 1.5, 2.0].map((fac) => (
                    <button
                      key={fac}
                      onClick={() => applyCadEditScale(fac)}
                      className="py-1 bg-slate-50 hover:bg-slate-100 border border-slate-250 rounded text-[9px] font-bold font-mono text-slate-600 hover:text-slate-900 transition cursor-pointer"
                    >
                      {fac}x
                    </button>
                  ))}
                </div>
                {/* Custom Scale Input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={cadScaleFactor}
                    onChange={(e) => setCadScaleFactor(e.target.value)}
                    placeholder="1.2"
                    className="w-16 bg-white border border-slate-300 rounded text-center text-xs text-slate-800 font-mono outline-none focus:border-orange-500"
                  />
                  <button
                    onClick={() => {
                      const parsed = parseFloat(cadScaleFactor);
                      if (!isNaN(parsed) && parsed > 0) {
                        applyCadEditScale(parsed);
                      } else {
                        logCommandResponse("Hata: Lütfen geçerli bir ölçek katsayısı girin.");
                      }
                    }}
                    className="flex-1 py-1 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded text-[10px] font-bold font-mono text-orange-700 transition cursor-pointer"
                  >
                    Custom Scale Factor
                  </button>
                </div>
              </div>

              {/* Row 5: CAD Array Engine (Linear / Polar Patterns) */}
              <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-3 shadow-xs">
                <div className="flex justify-between items-center border-b border-slate-100 pb-1.5 mb-1">
                  <span className="text-[10px] text-slate-800 font-mono font-bold flex items-center gap-1 uppercase">
                    <Grid className="w-3.5 h-3.5 text-orange-600 animate-pulse" />
                    🌐 Array & Pattern Duplication
                  </span>
                </div>

                {/* Sub-Tabs / Mode Selection or Accordion */}
                <div className="space-y-3">
                  {/* Linear/Rectangular Array Panel */}
                  <div className="bg-slate-50/75 p-2 rounded-md border border-slate-150 space-y-1.5 text-left">
                    <span className="text-[9px] text-slate-500 font-extrabold font-sans uppercase block tracking-wider">
                      📏 Linear (Rectangular) Array:
                    </span>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                      <div>
                        <span className="text-[8px] text-slate-400 font-bold block">X Count (Columns)</span>
                        <input
                          type="text"
                          value={arrayXCount}
                          onChange={(e) => setArrayXCount(e.target.value)}
                          placeholder="3"
                          className="w-full bg-white border border-slate-250 rounded text-center text-xs font-mono py-0.5 outline-none focus:border-orange-500"
                        />
                      </div>
                      <div>
                        <span className="text-[8px] text-slate-400 font-bold block">Y Count (Rows)</span>
                        <input
                          type="text"
                          value={arrayYCount}
                          onChange={(e) => setArrayYCount(e.target.value)}
                          placeholder="1"
                          className="w-full bg-white border border-slate-250 rounded text-center text-xs font-mono py-0.5 outline-none focus:border-orange-500"
                        />
                      </div>
                      <div>
                        <span className="text-[8px] text-slate-400 font-bold block">X Spacing (mm)</span>
                        <input
                          type="text"
                          value={arrayXSpacing}
                          onChange={(e) => setArrayXSpacing(e.target.value)}
                          placeholder="50"
                          className="w-full bg-white border border-slate-250 rounded text-center text-xs font-mono py-0.5 outline-none focus:border-orange-500"
                        />
                      </div>
                      <div>
                        <span className="text-[8px] text-slate-400 font-bold block">Y Spacing (mm)</span>
                        <input
                          type="text"
                          value={arrayYSpacing}
                          onChange={(e) => setArrayYSpacing(e.target.value)}
                          placeholder="50"
                          className="w-full bg-white border border-slate-250 rounded text-center text-xs font-mono py-0.5 outline-none focus:border-orange-500"
                        />
                      </div>
                    </div>
                    
                    <button
                      onClick={() => {
                        const xc = parseInt(arrayXCount);
                        const yc = parseInt(arrayYCount);
                        const xs = parseFloat(arrayXSpacing);
                        const ys = parseFloat(arrayYSpacing);
                        if (!isNaN(xc) && !isNaN(yc) && !isNaN(xs) && !isNaN(ys)) {
                          applyCadEditLinearArray(xc, yc, xs, ys);
                        } else {
                          logCommandResponse("Hata: Çoğaltma parametrelerini lütfen geçerli sayılarla doldurun.");
                        }
                      }}
                      className="w-full py-1 bg-gradient-to-r from-orange-450 to-orange-550 border border-orange-200 text-white rounded text-[9px] font-bold font-mono hover:brightness-105 active:scale-95 transition cursor-pointer text-center uppercase shadow-xs mt-1"
                    >
                      Apply Linear Array
                    </button>
                  </div>

                  {/* Polar/Circular Array Panel */}
                  <div className="bg-slate-50/75 p-2 rounded-md border border-slate-150 space-y-1.5 text-left">
                    <span className="text-[9px] text-slate-550 font-extrabold font-sans uppercase block tracking-wider">
                      🔄 Polar (Circular) Array:
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[8px] text-slate-400 font-bold block">Total Items (Count)</span>
                        <input
                          type="text"
                          value={polarCount}
                          onChange={(e) => setPolarCount(e.target.value)}
                          placeholder="6"
                          className="w-full bg-white border border-slate-250 rounded text-center text-xs font-mono py-0.5 outline-none focus:border-orange-500"
                        />
                      </div>
                      <div>
                        <span className="text-[8px] text-slate-400 font-bold block">Total Angle (Degrees)</span>
                        <div className="relative">
                          <input
                            type="text"
                            value={polarAngle}
                            onChange={(e) => setPolarAngle(e.target.value)}
                            placeholder="360"
                            className="w-full bg-white border border-slate-250 rounded text-center text-xs font-mono py-0.5 pr-3 outline-none focus:border-orange-500"
                          />
                          <span className="absolute right-1 top-0.5 text-[10px] text-slate-400">°</span>
                        </div>
                      </div>
                    </div>

                    {/* Array Center Point Select Controls */}
                    <div className="space-y-1 bg-white p-1.5 rounded border border-slate-200 text-left">
                      <span className="text-[8.5px] text-slate-500 font-bold font-sans uppercase block">🎯 Array Center (Pivot Point):</span>
                      {rotationCenter ? (
                        <div className="flex items-center justify-between bg-orange-50/70 border border-orange-200 px-1.5 py-0.5 rounded text-[9px] font-mono text-orange-700">
                          <span>X: {rotationCenter.x.toFixed(1)} / Y: {rotationCenter.y.toFixed(1)} mm</span>
                          <button
                            onClick={() => {
                              setRotationCenter(null);
                              logCommandResponse("Dairesel çoğaltma merkezi temizlendi.");
                            }}
                            className="text-[8px] text-red-650 hover:text-red-750 px-1 rounded bg-red-50 border border-red-200 cursor-pointer font-bold"
                          >
                            Clear
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setRotationCenterSelectMode(true);
                            logCommandResponse("Dairesel Çoğaltma Merkez Noktası Seçin: Dönme eksenini seçmek için çizim ekranında dilediğiniz bir yere tıklayın.");
                          }}
                          className={`w-full py-0.5 rounded text-[8.5px] font-mono font-bold border transition cursor-pointer text-center ${
                            rotationCenterSelectMode
                              ? 'bg-orange-600/30 border-orange-500 text-orange-700 animate-pulse'
                              : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700 font-bold'
                          }`}
                        >
                          {rotationCenterSelectMode ? '📍 Click Canvas...' : '📍 Click Center Point on Canvas'}
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        const count = parseInt(polarCount);
                        const angleDef = parseFloat(polarAngle);
                        if (!isNaN(count) && !isNaN(angleDef)) {
                          applyCadEditPolarArray(count, angleDef);
                        } else {
                          logCommandResponse("Hata: Dairesel çoğaltma katsayılarını düzgün girin.");
                        }
                      }}
                      className="w-full py-1 bg-gradient-to-r from-orange-450 to-orange-550 border border-orange-200 text-white rounded text-[9px] font-bold font-mono hover:brightness-105 active:scale-95 transition cursor-pointer text-center uppercase shadow-xs"
                    >
                      Apply Polar Array
                    </button>
                  </div>
                </div>
              </div>
            </div>

              {/* AI Refine ve Düzenleme Butonu */}
            <button
              onClick={runDouglasPeucker}
              disabled={rawPoints.length < 3}
              className={`w-full py-2 px-3 rounded text-xs font-bold flex items-center justify-center gap-2 transition border ${
                rawPoints.length >= 3
                  ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white border-orange-400 hover:scale-[1.02] active:scale-95 cursor-pointer shadow-xs'
                  : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
              }`}
            >
              <Flame className="w-4 h-4" />
              <span>Auto-Clean Curve (Douglas-Peucker)</span>
            </button>

            {/* Backplane reference image config */}
            <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">Reference Image Underlay</span>
                <ImageIcon className="w-4 h-4 text-orange-600" />
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleBgImageUpload}
                className="block w-full text-xs text-slate-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[11px] file:font-semibold file:bg-slate-100 file:text-slate-750 hover:file:bg-slate-200 cursor-pointer"
              />
              {bgImage && (
                <div className="space-y-1.5 pt-1 border-t border-slate-200">
                  <div className="flex justify-between items-center text-[10px] font-mono text-slate-500">
                    <span>Opacity: {Math.round(bgOpacity * 100)}%</span>
                    <button onClick={removeBgImage} className="text-red-500 hover:underline cursor-pointer font-bold">
                      Remove
                    </button>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={bgOpacity}
                    onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
                    className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-orange-600"
                  />
                </div>
              )}
            </div>

            {/* Snapping parameters & Ortho toggles */}
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-700 font-medium">🎯 Smart Snaps (1/10mm)</span>
                <input
                  type="checkbox"
                  checked={smartSnap}
                  onChange={(e) => setSmartSnap(e.target.checked)}
                  className="rounded text-orange-500 focus:ring-orange-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-700 font-medium">🧱 Grid Snap</span>
                <input
                  type="checkbox"
                  checked={gridSnap}
                  onChange={(e) => setGridSnap(e.target.checked)}
                  className="rounded text-orange-500 focus:ring-orange-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-700 font-medium">🔒 Ortho Snap (F8)</span>
                <input
                  type="checkbox"
                  checked={orthoSnap}
                  onChange={(e) => setOrthoSnap(e.target.checked)}
                  className="rounded text-orange-500 focus:ring-orange-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between bg-white p-2 rounded border border-slate-200 shadow-xs">
                <span className="text-xs text-slate-700 font-medium">📐 Show Live Dimension Labels</span>
                <input
                  type="checkbox"
                  checked={showDims}
                  onChange={(e) => setShowDims(e.target.checked)}
                  className="rounded text-orange-500 focus:ring-orange-500 cursor-pointer"
                />
              </div>

              {/* Grid Density & Background Dynamic Color */}
              <div className="bg-white p-3 rounded border border-slate-200 space-y-3 shadow-xs text-left">
                {/* Grid spacing (Grid Aralığı) control */}
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px] uppercase font-mono tracking-wider font-extrabold text-slate-500">
                    <span>📏 Grid Gap (Grid Aralığı)</span>
                    <span className="text-orange-650 font-bold">{gridSize} mm</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="5"
                      max="1000"
                      value={gridSize}
                      onChange={(e) => setGridSize(Math.max(5, parseInt(e.target.value) || 5))}
                      className="w-16 bg-white border border-slate-300 text-[11px] px-1.5 py-0.5 rounded text-slate-800 outline-none focus:border-orange-500 font-mono text-center"
                    />
                    <input
                      type="range"
                      min="5"
                      max="200"
                      step="5"
                      value={gridSize}
                      onChange={(e) => setGridSize(parseInt(e.target.value) || 5)}
                      className="flex-1 h-1 bg-slate-200 rounded appearance-none cursor-pointer accent-orange-600"
                    />
                  </div>
                </div>

                {/* Canvas Background Color Selection */}
                <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
                  <span className="text-[10px] uppercase font-mono tracking-wider font-extrabold text-slate-500 block">
                    🎨 Canvas Background (Çizim Alanı Rengi)
                  </span>
                  <div className="grid grid-cols-4 gap-1">
                    <button
                      onClick={() => setCanvasBgColor('#09090b')}
                      className={`py-1 rounded text-[9px] font-mono border transition ${
                        canvasBgColor === '#09090b' 
                          ? 'bg-zinc-950 border-orange-500 text-white font-extrabold shadow-sm' 
                          : 'bg-zinc-900/10 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                      title="Classic CAD Charcoal"
                    >
                      Dark
                    </button>
                    <button
                      onClick={() => setCanvasBgColor('#0c192e')}
                      className={`py-1 rounded text-[9px] font-mono border transition ${
                        canvasBgColor === '#0c192e' 
                          ? 'bg-[#0c192e] border-orange-500 text-white font-extrabold shadow-sm' 
                          : 'bg-[#0c192e]/10 border-slate-200 text-slate-650 hover:text-slate-900 hover:bg-slate-50'
                      }`}
                      title="Blueprint Navy Blue"
                    >
                      Navy
                    </button>
                    <button
                      onClick={() => setCanvasBgColor('#f1f5f9')}
                      className={`py-1 rounded text-[9px] font-mono border transition ${
                        canvasBgColor === '#f1f5f9' 
                          ? 'bg-slate-100 border-orange-500 text-slate-900 font-extrabold shadow-sm' 
                          : 'bg-slate-50 border-slate-200 text-slate-550 hover:text-slate-900 hover:bg-slate-100/50'
                      }`}
                      title="Soft Slate Light"
                    >
                      Slate
                    </button>
                    <button
                      onClick={() => setCanvasBgColor('#ffffff')}
                      className={`py-1 rounded text-[9px] font-mono border transition ${
                        canvasBgColor === '#ffffff' 
                          ? 'bg-white border-orange-500 text-black font-extrabold shadow-sm' 
                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
                      }`}
                      title="Pure White background"
                    >
                      White
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <input
                      type="color"
                      value={canvasBgColor}
                      onChange={(e) => setCanvasBgColor(e.target.value)}
                      className="w-4 h-4 rounded border border-slate-300 cursor-pointer pointer-events-auto shrink-0"
                      title="Custom Color Picker"
                    />
                    <span className="text-[9px] text-slate-450 font-mono">Custom Picker / Özel Renk</span>
                  </div>
                </div>
              </div>

              {/* Advanced Anchor Selector */}
              <div className="bg-white p-2.5 rounded border border-slate-200 space-y-2 text-left shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-800 font-bold uppercase flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-orange-600 animate-pulse" />
                    📍 Custom Anchor Point
                  </span>
                  {customAnchor && (
                    <button
                      onClick={() => setCustomAnchor(null)}
                      className="text-[9px] text-red-600 hover:text-red-700 font-mono px-1 rounded bg-red-50 border border-red-200 cursor-pointer font-bold"
                    >
                      Delete
                    </button>
                  )}
                </div>
                {customAnchor ? (
                  <div className="text-[11px] bg-orange-50 border border-orange-200 p-1.5 rounded text-orange-700 font-mono flex justify-between items-center">
                    <span>X: {customAnchor.x.toFixed(1)} mm, Y: {customAnchor.y.toFixed(1)} mm</span>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setAnchorSelectMode(true);
                      logCommandResponse("Click on screen to define a custom snap reference point (Anchor).");
                    }}
                    className={`w-full py-1 rounded text-[10px] font-mono font-bold border transition cursor-pointer text-center ${
                      anchorSelectMode
                        ? 'bg-orange-600/30 border-orange-500 text-orange-700 animate-pulse'
                        : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700 hover:text-slate-950'
                    }`}
                  >
                    {anchorSelectMode ? 'Click Canvas...' : 'Define Custom Anchor'}
                  </button>
                )}
                <p className="text-[9px] text-slate-400 leading-normal">
                  Origin (0,0) is always automatic. Setting a custom anchor point allows snap verification relative to that coordinate.
                </p>
              </div>
            </div>
          </div>
          )}

          {/* Section D: Real-time Parametric Dimensions Tables */}
          {sidebarTab === 'dimensions' && (
          <div className="p-4 border-b border-slate-200 flex-1 min-h-[180px] flex flex-col bg-slate-50/70">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5 mb-3">
              <MousePointer2 className="w-4 h-4 text-orange-600 font-extrabold" />
              <span>3. Parametrik Segment Sınırlandırma</span>
            </h2>

            {finalPoints.length < 2 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-4 rounded-lg bg-white border border-slate-200 text-center">
                <HelpCircle className="w-8 h-8 text-slate-300 mb-2 animate-pulse" />
                <p className="text-xs text-slate-400 font-sans">Yüklenmiş taslak segmenti bulunmamaktadır.</p>
              </div>
            ) : (
              <div className="flex-1 max-h-[250px] overflow-y-auto space-y-1.5 pr-1">
                <div className="grid grid-cols-12 text-[9px] font-mono text-slate-400 pb-1 border-b border-slate-200 select-none">
                  <span className="col-span-3 text-left">SEGMENT</span>
                  <span className="col-span-5 text-center">UZUNLUK (mm)</span>
                  <span className="col-span-4 text-right">AÇI (°)</span>
                </div>
                {finalPoints.slice(0, -1).map((p, idx) => {
                  const p2 = finalPoints[idx + 1];
                  const len = distance(p, p2);
                  let ang = Math.atan2(-(p2.y - p.y), p2.x - p.x) * (180 / Math.PI);
                  if (ang < 0) ang += 360;

                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-1.5 items-center bg-white p-1.5 rounded border border-slate-200 shadow-xs"
                    >
                      <span className="col-span-3 text-[10px] font-bold text-orange-700 font-mono bg-orange-50 border border-orange-100 text-center rounded py-0.5">K-{idx + 1}</span>
                      <input
                        type="number"
                        className="col-span-5 bg-slate-50 text-slate-800 text-xs border border-slate-250 focus:border-orange-500 outline-none text-center px-1.5 py-1 rounded font-mono font-medium"
                        value={parseFloat(len.toFixed(1))}
                        onChange={(e) => updatePointsFromTable(idx, parseFloat(e.target.value) || 2.0, ang)}
                        step="1"
                        min="1"
                      />
                      <input
                        type="number"
                        className="col-span-4 bg-slate-50 text-slate-800 text-xs border border-slate-250 focus:border-orange-500 outline-none text-right px-1.5 py-1 rounded font-mono font-medium"
                        value={parseFloat(ang.toFixed(0))}
                        onChange={(e) => updatePointsFromTable(idx, len, parseFloat(e.target.value) || 0)}
                        step="5"
                        min="0"
                        max="359"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {/* Section D: 3D Materializing & Exports */}
          {sidebarTab === '3d' && (
          <div className="p-4 bg-slate-50/75 border-t border-slate-200 space-y-3.5 flex-1 flex flex-col justify-between overflow-y-auto">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5 mb-2.5">
                <CheckCircle className="w-4 h-4 text-orange-600 font-extrabold" />
                <span>5. 3D Model & Slicing Control</span>
              </h2>

              <div className="space-y-3 bg-white p-3 rounded-lg border border-slate-200 shadow-xs">
                <div>
                  <label className="block text-[10px] font-sans text-slate-500 font-bold uppercase mb-1">3D Solidification Pattern (Process Type):</label>
                  <select
                    value={opType}
                    onChange={(e) => setOpType(e.target.value as 'extrude' | 'revolve')}
                    className="w-full bg-slate-50 border border-slate-300 text-xs px-2.5 py-1.5 rounded text-slate-800 outline-none focus:border-orange-500 cursor-pointer font-sans"
                  >
                    <option value="extrude">Extrude (Height Wall)</option>
                    <option value="revolve">Revolve (Radial Lathe)</option>
                  </select>
                </div>

                {opType === 'extrude' && (
                  <div>
                    <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 mb-1">
                      <span>Z-Depth (Thickness height):</span>
                      <span className="text-orange-600 font-bold">{depth} mm</span>
                    </div>
                    <input
                      type="number"
                      value={depth}
                      onChange={(e) => setDepth(Math.max(5, parseInt(e.target.value) || 5))}
                      className="w-full bg-slate-50 border border-slate-300 text-xs px-2.5 py-1.5 rounded text-slate-800 outline-none focus:border-orange-500 font-mono"
                      min="5"
                      max="1000"
                    />
                  </div>
                )}

                {opType === 'revolve' && (
                  <div>
                    <div className="flex justify-between items-center text-[10px] font-mono text-slate-500 mb-1">
                      <span>Revolve Axis:</span>
                      <span className="text-orange-600 font-bold uppercase">{revolveAxis}</span>
                    </div>
                    <select
                      value={revolveAxis}
                      onChange={(e) => setRevolveAxis(e.target.value as 'left' | 'center' | 'right' | 'origin-y' | 'origin-x')}
                      className="w-full bg-slate-50 border border-slate-300 text-xs px-2.5 py-1.5 rounded text-slate-800 outline-none focus:border-orange-500 font-sans cursor-pointer"
                    >
                      <option value="left">Left Edge (Min X Boundary)</option>
                      <option value="center">Center Axis</option>
                      <option value="right">Right Edge (Max X Boundary)</option>
                      <option value="origin-y">Vertical Axis (Origin X=0)</option>
                      <option value="origin-x">Horizontal Axis (Origin Y=0)</option>
                    </select>
                  </div>
                )}

                {/* Infill (Doluluk) Settings & Presets */}
                <div className="border-t border-slate-200 pt-2.5 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-sans text-slate-500 uppercase font-bold flex items-center gap-1">
                      <Sliders className="w-3 h-3 text-orange-600" />
                      Infill Density (3D Print Infill):
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={infill}
                        onChange={(e) => setInfill(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                        className="w-12 bg-slate-50 border border-slate-300 text-center text-xs py-0.5 rounded font-mono text-orange-600 font-bold outline-none focus:border-orange-500"
                      />
                      <span className="text-[10px] font-mono text-slate-400 font-bold">%</span>
                    </div>
                  </div>

                  {/* Range Slider for quick drag control */}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={infill}
                    onChange={(e) => setInfill(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-orange-600"
                  />

                  {/* Preset Fast Selection Tabs */}
                  <div className="grid grid-cols-4 gap-1">
                    {[
                      { val: 10, label: '%10', title: 'Visual Fig.' },
                      { val: 20, label: '%20', title: 'Standard' },
                      { val: 40, label: '%40', title: 'Functional' },
                      { val: 75, label: '%75', title: 'Heavy Duty' }
                    ].map((pres, pIdx) => (
                      <button
                        key={pIdx}
                        onClick={() => setInfill(pres.val)}
                        className={`py-1 rounded font-mono text-[9px] text-center border transition-all cursor-pointer ${
                          infill === pres.val
                            ? 'bg-orange-50 border-orange-305 text-orange-600 font-extrabold shadow-2xs'
                            : 'bg-white border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                        }`}
                        title={pres.title}
                      >
                        {pres.label}
                      </button>
                    ))}
                  </div>

                  {/* Dinamik Doluluk Açıklama Kutusu */}
                  <div className="bg-orange-50/60 border border-orange-200/50 rounded-lg p-2 text-[10px] text-slate-700 leading-relaxed font-sans text-left">
                    {infill <= 15 ? (
                      <p>
                        <strong className="text-orange-700">0% - 15% Infill:</strong> Used for visual figurines, display mockups, and cosmetic prototypes. Minimizes filament consumption and prints fast.
                      </p>
                    ) : infill <= 30 ? (
                      <p>
                        <strong className="text-orange-700">15% - 30% Infill:</strong> Ideal standard range for general items, holders, mounts, casing and decorative pieces.
                      </p>
                    ) : infill <= 50 ? (
                      <p>
                        <strong className="text-orange-700">30% - 50% Infill:</strong> Suited for light functional prototypes, brackets, mechanical joints and minor tooling adapters.
                      </p>
                    ) : (
                      <p>
                        <strong className="text-orange-700">50%+ Infill:</strong> Highly robust setting suited for heavy duty components, stress-bearing anchors, and rugged engineering parts.
                      </p>
                    )}
                  </div>
                </div>

                {/* 3D Print Metrics & Estimates Desk */}
                <div className="border-t border-slate-200 pt-2.5 space-y-1.5 font-sans text-[10px] text-slate-500 text-left">
                  <div className="flex justify-between items-center text-[10px] uppercase tracking-wide text-slate-600 pb-0.5 font-bold">
                    <span>3D Slicing & Filament Analytics</span>
                    <span className="text-[8px] px-1 bg-slate-100 rounded text-slate-450 uppercase font-mono">Stats Calc</span>
                  </div>
                  
                  <div className="flex justify-between bg-slate-50/80 p-1.5 rounded border border-slate-200 items-center">
                    <span>Total Solid Volume:</span>
                    <span className="text-slate-800 font-bold font-mono">
                      {volumeCm3 > 0 ? `${volumeCm3.toFixed(2)} cm³ (${volumeMm3.toLocaleString('en-US', { maximumFractionDigits: 0 })} mm³)` : '0.00 cm³'}
                    </span>
                  </div>

                  <div className="flex justify-between bg-slate-50/80 p-1.5 rounded border border-slate-200 items-center">
                    <span>Filament Mass Weight:</span>
                    <span className="text-orange-650 font-extrabold font-mono">
                      {volumeCm3 > 0 ? `${estimatedWeightG.toFixed(1)} grams (PLA)` : '0.0 grams'}
                    </span>
                  </div>

                  <div className="flex justify-between bg-slate-50/80 p-1.5 rounded border border-slate-200 items-center">
                    <span>Estimated Printing Time:</span>
                    <span className="text-amber-600 font-extrabold flex items-center gap-1 font-mono">
                      <Flame className="w-2.5 h-2.5 animate-pulse text-orange-600" />
                      {formatPrintTime(estimatedMinutes)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={executeStlExport}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded text-xs font-bold bg-orange-600 hover:bg-orange-600/90 text-white transition cursor-pointer shadow-sm shadow-orange-50 border border-orange-500"
                  title="Export high fidelity 3D STL mesh file"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export 3D STL</span>
                </button>
                <button
                  onClick={exportToDXF}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-250 transition cursor-pointer"
                  title="Export draft profile lines as 2D DXF format"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export 2D DXF</span>
                </button>
              </div>
              <button
                onClick={exportToPDF}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 px-3 rounded text-xs font-black bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white transition cursor-pointer border border-orange-500 shadow-md shadow-orange-100"
                title="Generate standard workshop drawing layout as blueprint PDF"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Tech PDF Drawing</span>
              </button>
            </div>
          </div>
          )}
        </aside>

        {/* 3. Splitted Dual Viewports */}
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden bg-zinc-950">
          
          {workspaceLayout === 'drawing-sheet' ? (
            <div className="flex-1 flex flex-col lg:flex-row bg-[#111827] text-slate-100 overflow-y-auto select-text min-h-0 w-full">
              
              {/* SHEET EDITING CONTROL SIDE PANEL */}
              <div className="w-full lg:w-[325px] bg-[#1f2937] border-b lg:border-b-0 lg:border-r border-slate-700 p-5 flex flex-col gap-4 font-sans shrink-0 overflow-y-auto">
                <div className="flex items-center gap-1.5 border-b border-slate-700 pb-3">
                  <span className="p-1 px-1.5 rounded bg-orange-600 text-white font-black text-[10px] tracking-widest leading-none">CAD</span>
                  <span className="text-xs font-black tracking-widest text-slate-200 uppercase">SHEET SETTINGS (ANTET)</span>
                </div>

                {/* Form fields */}
                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-400 font-bold mb-1">PARÇA ADI (DRAWING TITLE):</label>
                    <input
                      type="text"
                      value={sheetTitle}
                      onChange={(e) => setSheetTitle(e.target.value.toUpperCase())}
                      className="w-full bg-[#111827] border border-slate-600 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-orange-500 font-bold uppercase"
                      placeholder="MEKANIK PARCA ADI"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-400 font-bold mb-1">MALZEME GENEL SEÇİMİ (MATERIAL):</label>
                    <select
                      value={sheetMaterial}
                      onChange={(e) => setSheetMaterial(e.target.value)}
                      className="w-full bg-[#111827] border border-slate-600 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-orange-500 cursor-pointer font-bold"
                    >
                      <option value="Steel">Çelik (Steel - 7.85 g/cm³)</option>
                      <option value="Aluminum">Alüminyum (Aluminum - 2.70 g/cm³)</option>
                      <option value="Brass">Pirinç (Brass - 8.40 g/cm³)</option>
                      <option value="Copper">Bakır (Copper - 8.96 g/cm³)</option>
                      <option value="Acrylic">Akrilik (Acrylic - 1.18 g/cm³)</option>
                      <option value="PLA (3D Print)">PLA (3D Baskı Plastiği - 1.24 g/cm³)</option>
                      <option value="Oak Wood">Meşe Ahşap (Oak Wood - 0.75 g/cm³)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-400 font-bold mb-1">REVİZYON (REV):</label>
                      <input
                        type="text"
                        value={sheetRevision}
                        onChange={(e) => setSheetRevision(e.target.value.toUpperCase())}
                        className="w-full bg-[#111827] border border-slate-600 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-orange-500 text-center font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-mono uppercase text-slate-400 font-bold mb-1">MODEL REVOLVE/EXP (DEPTH):</label>
                      <div className="flex h-[30px] items-center justify-center bg-[#111827] border border-slate-600 rounded px-2 text-xs text-orange-400 font-mono font-bold leading-none">
                        {depth} mm
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 mb-1">
                      <span>KAĞIT SÖRF/ÖLÇEK ÇARPANIL:</span>
                      <span className="text-orange-400 font-bold">{sheetScaleMultiplier.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.3"
                      max="2.5"
                      step="0.1"
                      value={sheetScaleMultiplier}
                      onChange={(e) => setSheetScaleMultiplier(parseFloat(e.target.value) || 1.0)}
                      className="w-full accent-orange-500 bg-[#111827] rounded-lg appearance-none h-1.5 cursor-pointer mt-1"
                    />
                    <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                      <span>0.3x</span>
                      <span>1.0x (Sığdır)</span>
                      <span>2.5x</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-slate-400 font-bold mb-1">TEKNİK YAPIM ELEMAN NOTLARI:</label>
                    <textarea
                      rows={4}
                      value={sheetNotes}
                      onChange={(e) => setSheetNotes(e.target.value)}
                      className="w-full bg-[#111827] border border-slate-600 rounded p-2 text-[10px] text-slate-300 focus:outline-none focus:border-orange-500 font-mono leading-relaxed resize-none"
                    />
                  </div>

                  {/* Mass / Weight HUD */}
                  <div className="p-3 bg-[#111827] border border-slate-700/60 rounded-lg space-y-1.5 text-slate-300 font-sans shadow-inner">
                    <span className="text-[10px] font-mono uppercase text-slate-400 font-bold tracking-wider block">HESAPLANAN MALZEME RAPORU:</span>
                    <div className="flex justify-between text-xs font-mono">
                      <span>2D Profil Alanı:</span>
                      <span className="text-slate-200 font-bold">
                        {(() => {
                          const list: Array<{ points: Point[]; isClosed: boolean }> = [];
                          layers.forEach(l => {
                            if (!l.visible) return;
                            if (l.finalPoints && l.finalPoints.length > 0) {
                              list.push({ points: l.finalPoints, isClosed: l.isClosed });
                            }
                            if (l.paths) {
                              l.paths.forEach(p => { if (p.length > 0) list.push({ points: p, isClosed: true }); });
                            }
                          });
                          let area = 0;
                          list.forEach(sh => {
                            if (sh.isClosed && sh.points.length >= 3) {
                              let shArea = 0;
                              const poly = sh.points;
                              for (let i = 0; i < poly.length - 1; i++) {
                                shArea += poly[i].x * poly[i + 1].y - poly[i + 1].x * poly[i].y;
                              }
                              shArea += poly[poly.length - 1].x * poly[0].y - poly[0].x * poly[poly.length - 1].y;
                              area += Math.abs(shArea / 2);
                            }
                          });
                          return `${area.toFixed(1)} mm²`;
                        })()}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs font-mono">
                      <span>3D Model Hacmi:</span>
                      <span className="text-slate-200">
                        {(() => {
                          const list: Array<{ points: Point[]; isClosed: boolean }> = [];
                          layers.forEach(l => {
                            if (!l.visible) return;
                            if (l.finalPoints && l.finalPoints.length > 0) list.push({ points: l.finalPoints, isClosed: l.isClosed });
                            if (l.paths) l.paths.forEach(p => { if (p.length > 0) list.push({ points: p, isClosed: true }); });
                          });
                          let area = 0;
                          list.forEach(sh => {
                            if (sh.isClosed && sh.points.length >= 3) {
                              let shArea = 0;
                              const poly = sh.points;
                              for (let i = 0; i < poly.length - 1; i++) {
                                shArea += poly[i].x * poly[i + 1].y - poly[i + 1].x * poly[i].y;
                              }
                              shArea += poly[poly.length - 1].x * poly[0].y - poly[0].x * poly[poly.length - 1].y;
                              area += Math.abs(shArea / 2);
                            }
                          });
                          const volumeCm3 = (area * depth) / 1000;
                          return `${volumeCm3.toFixed(2)} cm³`;
                        })()}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs font-mono pt-1.5 border-t border-slate-700/50">
                      <span className="font-bold">Toplam Net Kütle:</span>
                      <span className="text-orange-400 font-extrabold text-[12px]">
                        {(() => {
                          const list: Array<{ points: Point[]; isClosed: boolean }> = [];
                          layers.forEach(l => {
                            if (!l.visible) return;
                            if (l.finalPoints && l.finalPoints.length > 0) list.push({ points: l.finalPoints, isClosed: l.isClosed });
                            if (l.paths) l.paths.forEach(p => { if (p.length > 0) list.push({ points: p, isClosed: true }); });
                          });
                          let area = 0;
                          list.forEach(sh => {
                            if (sh.isClosed && sh.points.length >= 3) {
                              let shArea = 0;
                              const poly = sh.points;
                              for (let i = 0; i < poly.length - 1; i++) {
                                shArea += poly[i].x * poly[i + 1].y - poly[i + 1].x * poly[i].y;
                              }
                              shArea += poly[poly.length - 1].x * poly[0].y - poly[0].x * poly[poly.length - 1].y;
                              area += Math.abs(shArea / 2);
                            }
                          });
                          const volumeCm3 = (area * depth) / 1000;
                          const densityList = {
                            "Steel": 7.85, "Aluminum": 2.70, "Brass": 8.40, "Copper": 8.96, "Acrylic": 1.18, "PLA (3D Print)": 1.24, "Oak Wood": 0.75
                          };
                          const density = (densityList as any)[sheetMaterial] || 7.85;
                          const massGrams = volumeCm3 * density;
                          return massGrams > 1000 ? `${(massGrams / 1000).toFixed(3)} kg` : `${massGrams.toFixed(1)} g`;
                        })()}
                      </span>
                    </div>
                  </div>

                  {/* Print and Download Blueprint Button */}
                  <button
                    onClick={exportDrawingSheetToPDF}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded text-xs font-black uppercase tracking-wider bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white transition cursor-pointer border border-orange-600 shadow-md"
                    title="Export blueprint sheets to high resolution A4 PDF Document"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Yazdır / PDF İndir</span>
                  </button>
                </div>
              </div>

              {/* SHEET PREVIEW DRAFT BOARD CANVAS */}
              <div id="blueprint-board" className="flex-1 bg-slate-900 overflow-y-auto p-4 md:p-8 flex items-center justify-center min-h-0 select-none">
                {/* Simulated A4 Horizontal sheet */}
                <div 
                  id="a4-sheet-paper"
                  className="bg-white text-slate-900 border border-slate-950 aspect-[297/210] w-full max-w-[900px] shadow-2xl relative p-3 flex flex-col justify-between font-mono"
                  style={{ boxSizing: 'border-box' }}
                >
                  
                  {/* TECHNICAL CAD BORDER */}
                  <div className="absolute inset-2.5 border-2 border-slate-950 pointer-events-none" />
                  <div className="absolute inset-4 border border-slate-950/80 pointer-events-none" />

                  {/* Centermarks around edge */}
                  <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-0.5 h-4 bg-slate-950" />
                  <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 w-0.5 h-4 bg-slate-950" />
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-0.5 bg-slate-950" />
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-0.5 bg-slate-950" />

                  {/* SHEET CONTENT GRID LAYOUT CONTAINING 4 QUADRANTS */}
                  <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-4 p-4 pb-14 mt-2">
                    
                    {/* QUADRANT A (Top Left): FRONT VIEW */}
                    <div className="border border-slate-100 flex flex-col justify-between relative bg-slate-50/10">
                      <div className="absolute top-1 left-2 text-[7px] font-bold text-slate-400 tracking-wider">A: ÖN GÖRÜNÜŞ (FRONT ELEVATION XZ)</div>
                      
                      <div className="flex-1 flex items-center justify-center min-h-0">
                        {(() => {
                          const list: Array<{ points: Point[]; isClosed: boolean }> = [];
                          layers.forEach(l => {
                            if (!l.visible) return;
                            if (l.finalPoints && l.finalPoints.length > 0) list.push({ points: l.finalPoints, isClosed: l.isClosed });
                            if (l.paths) l.paths.forEach(p => { if (p.length > 0) list.push({ points: p, isClosed: true }); });
                          });

                          let min_x = Infinity, max_x = -Infinity;
                          list.forEach(sh => {
                            sh.points.forEach(p => {
                              if (p.x < min_x) min_x = p.x;
                              if (p.x > max_x) max_x = p.x;
                            });
                          });
                          if (min_x === Infinity) { min_x = -50; max_x = 50; }
                          
                          const w_cad = Math.max(1, max_x - min_x);
                          const c_x = (min_x + max_x) / 2;
                          const scaleVal = 175 / Math.max(35, w_cad, depth) * sheetScaleMultiplier;
                          
                          const mapX = (x: number) => 150 + (x - c_x) * scaleVal;
                          const mapZ = (zValue: number) => 135 - zValue * scaleVal;
                          
                          return (
                            <svg viewBox="0 0 300 200" className="w-full h-full max-h-[150px]">
                              <line x1="150" y1="15" x2="150" y2="185" stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="8,2,2,2" />
                              <line x1="15" y1="135" x2="285" y2="135" stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="8,2,2,2" />

                              {/* Base & Top bounds of extrusion plate */}
                              <line x1={mapX(min_x) - 10} x2={mapX(max_x) + 10} y1="135" y2="135" stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="3,3" />
                              <line x1={mapX(min_x)} x2={mapX(max_x)} y1={mapZ(0)} y2={mapZ(0)} stroke="#1e293b" strokeWidth="1.15" />
                              <line x1={mapX(min_x)} x2={mapX(max_x)} y1={mapZ(depth)} y2={mapZ(depth)} stroke="#1e293b" strokeWidth="1.15" />
                              
                              <line x1={mapX(min_x)} y1={mapZ(0)} x2={mapX(min_x)} y2={mapZ(depth)} stroke="#1e293b" strokeWidth="1.15" />
                              <line x1={mapX(max_x)} y1={mapZ(0)} x2={mapX(max_x)} y2={mapZ(depth)} stroke="#1e293b" strokeWidth="1.15" />

                              {/* Minor inner vertex pillars projection trails */}
                              {list[0] && list[0].points.map((pt, i) => (
                                <line 
                                  key={i} 
                                  x1={mapX(pt.x)} 
                                  y1={mapZ(0)} 
                                  x2={mapX(pt.x)} 
                                  y2={mapZ(depth)} 
                                  stroke="#64748b" 
                                  strokeWidth="0.5" 
                                  strokeDasharray="1.5,2" 
                                />
                              ))}

                              {/* Height thickness measures on right */}
                              <g className="text-[7.5px] font-mono fill-blue-600 stroke-blue-600">
                                <line x1={mapX(max_x) + 10} y1={mapZ(0)} x2={mapX(max_x) + 10} y2={mapZ(depth)} stroke="#2563eb" strokeWidth="0.75" />
                                <line x1={mapX(max_x) + 6} y1={mapZ(0)} x2={mapX(max_x) + 14} y2={mapZ(0)} stroke="#2563eb" strokeWidth="0.4" />
                                <line x1={mapX(max_x) + 6} y1={mapZ(depth)} x2={mapX(max_x) + 14} y2={mapZ(depth)} stroke="#2563eb" strokeWidth="0.4" />
                                <text x={mapX(max_x) + 14} y={(mapZ(0) + mapZ(depth))/2 + 2.5} stroke="none" className="font-bold fill-blue-600">
                                  H={depth} mm
                                </text>
                              </g>
                            </svg>
                          );
                        })()}
                      </div>
                    </div>

                    {/* QUADRANT B (Top Right): 3D ISOMETRIC VIEW */}
                    <div className="border border-slate-100 flex flex-col justify-between relative bg-slate-50/10">
                      <div className="absolute top-1 left-2 text-[7px] font-bold text-slate-400 tracking-wider">B: İZOMETRİK BAKIŞ (3D ISOMETRIC WIREFRAME)</div>
                      
                      <div className="flex-1 flex items-center justify-center min-h-0">
                        {(() => {
                          const list: Array<{ points: Point[]; isClosed: boolean }> = [];
                          layers.forEach(l => {
                            if (!l.visible) return;
                            if (l.finalPoints && l.finalPoints.length > 0) list.push({ points: l.finalPoints, isClosed: l.isClosed });
                            if (l.paths) l.paths.forEach(p => { if (p.length > 0) list.push({ points: p, isClosed: true }); });
                          });

                          if (list.length === 0) {
                            return <div className="text-[10px] text-slate-400">Çizim boş, izometrik şema çizilemiyor.</div>;
                          }
                          
                          let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
                          list.forEach(sh => {
                            sh.points.forEach(p => {
                              if (p.x < bMinX) bMinX = p.x;
                              if (p.x > bMaxX) bMaxX = p.x;
                              if (p.y < bMinY) bMinY = p.y;
                              if (p.y > bMaxY) bMaxY = p.y;
                            });
                          });
                          const cx = bMinX === Infinity ? 0 : (bMinX + bMaxX) / 2;
                          const cy = bMinY === Infinity ? 0 : (bMinY + bMaxY) / 2;

                          // Project boundaries to center
                          let boundsMinX = Infinity, boundsMaxX = -Infinity, boundsMinY = Infinity, boundsMaxY = -Infinity;
                          
                          list.forEach(sh => {
                            sh.points.forEach(p => {
                              const x_offset = p.x - cx;
                              const y_offset = p.y - cy;
                              
                              const ix0 = (x_offset - 0) * 0.866025;
                              const iy0 = (x_offset + 0) * 0.5 - y_offset;
                              
                              const ix1 = (x_offset - depth) * 0.866025;
                              const iy1 = (x_offset + depth) * 0.5 - y_offset;

                              boundsMinX = Math.min(boundsMinX, ix0, ix1);
                              boundsMaxX = Math.max(boundsMaxX, ix0, ix1);
                              boundsMinY = Math.min(boundsMinY, iy0, iy1);
                              boundsMaxY = Math.max(boundsMaxY, iy0, iy1);
                            });
                          });

                          const w_proj = Math.max(1, boundsMaxX - boundsMinX);
                          const h_proj = Math.max(1, boundsMaxY - boundsMinY);
                          
                          const mid_proj_x = (boundsMinX + boundsMaxX) / 2;
                          const mid_proj_y = (boundsMinY + boundsMaxY) / 2;
                          
                          const isoScale = 145 / Math.max(30, w_proj, h_proj) * sheetScaleMultiplier;
                          
                          const projectPt = (p: Point, zVal: number) => {
                            const x_val = p.x - cx;
                            const y_val = p.y - cy;
                            const prX = (x_val - zVal) * 0.866025;
                            const prY = (x_val + zVal) * 0.5 - y_val;
                            return {
                              x: 154 + (prX - mid_proj_x) * isoScale,
                              y: 96 + (prY - mid_proj_y) * isoScale
                            };
                          };

                          return (
                            <svg viewBox="0 0 300 200" className="w-full h-full max-h-[150px] text-slate-900">
                              
                              {/* Draw small Axis indicator */}
                              <g transform="translate(25, 160)" className="text-[6.5px] font-mono select-none">
                                <line x1="0" y1="0" x2="15" y2="8" stroke="#ef4444" strokeWidth="0.8" />
                                <text x="18" y="11" className="fill-red-500 font-bold" stroke="none">X</text>
                                
                                <line x1="0" y1="0" x2="-15" y2="8" stroke="#3b82f6" strokeWidth="0.8" />
                                <text x="-24" y="11" className="fill-blue-500 font-bold" stroke="none">Z</text>
                                
                                <line x1="0" y1="0" x2="0" y2="-15" stroke="#10b981" strokeWidth="0.8" />
                                <text x="-3" y="-18" className="fill-emerald-500 font-bold" stroke="none">Y</text>
                              </g>

                              {list.map((sh, sIdx) => {
                                const pts = sh.points;
                                const bottomPts = pts.map(p => projectPt(p, 0));
                                const topPts = pts.map(p => projectPt(p, depth));

                                const buildPathD = (mappedPts: Array<{x: number, y: number}>) => {
                                  if (mappedPts.length < 2) return "";
                                  let d = `M ${mappedPts[0].x} ${mappedPts[0].y}`;
                                  for (let i = 1; i < mappedPts.length; i++) {
                                    d += ` L ${mappedPts[i].x} ${mappedPts[i].y}`;
                                  }
                                  if (sh.isClosed && mappedPts.length >= 3) d += " Z";
                                  return d;
                                };

                                return (
                                  <g key={sIdx}>
                                    {/* Bottom frame cap lines - dashed */}
                                    <path 
                                      d={buildPathD(bottomPts)} 
                                      fill="none" 
                                      stroke="#94a3b8" 
                                      strokeWidth="0.75" 
                                      strokeDasharray="2.5,2" 
                                    />
                                    
                                    {/* Top frame solid accent line */}
                                    <path 
                                      d={buildPathD(topPts)} 
                                      fill="none" 
                                      stroke="#0f172a" 
                                      strokeWidth="1.2" 
                                    />

                                    {/* Columns edge lines */}
                                    {pts.map((p, i) => {
                                      if (p.isCurvePoint && i % 3 !== 0) return null;
                                      const bot = bottomPts[i];
                                      const top = topPts[i];
                                      return (
                                        <line 
                                          key={i} 
                                          x1={bot.x} 
                                          y1={bot.y} 
                                          x2={top.x} 
                                          y2={top.y} 
                                          stroke="#475569" 
                                          strokeWidth="0.8" 
                                        />
                                      );
                                    })}
                                  </g>
                                );
                              })}
                            </svg>
                          );
                        })()}
                      </div>
                    </div>

                    {/* QUADRANT C (Bottom Left): TOP VIEW WITH MEASURES */}
                    <div className="border border-slate-100 flex flex-col justify-between relative bg-slate-50/10">
                      <div className="absolute top-1 left-2 text-[7px] font-bold text-slate-400 tracking-wider">C: ÜST GÖRÜNÜŞ (TOP VIEW XY + ÖLÇÜLER)</div>
                      
                      <div className="flex-1 flex items-center justify-center min-h-0">
                        {(() => {
                          const list: Array<{ points: Point[]; isClosed: boolean; color: string }> = [];
                          layers.forEach(l => {
                            if (!l.visible) return;
                            if (l.finalPoints && l.finalPoints.length > 0) {
                              list.push({ points: l.finalPoints, isClosed: l.isClosed, color: l.color || '#1e293b' });
                            }
                            if (l.paths) {
                              l.paths.forEach(p => { if (p.length > 0) list.push({ points: p, isClosed: true, color: l.color || '#1e293b' }); });
                            }
                          });

                          if (list.length === 0) {
                            return <div className="text-[10px] text-slate-400">Top View for empty sketch.</div>;
                          }

                          let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
                          list.forEach(sh => {
                            sh.points.forEach(p => {
                              if (p.x < bMinX) bMinX = p.x;
                              if (p.x > bMaxX) bMaxX = p.x;
                              if (p.y < bMinY) bMinY = p.y;
                              if (p.y > bMaxY) bMaxY = p.y;
                            });
                          });
                          const cx = bMinX === Infinity ? 0 : (bMinX + bMaxX) / 2;
                          const cy = bMinY === Infinity ? 0 : (bMinY + bMaxY) / 2;
                          const widthCAD = bMinX === Infinity ? 100 : Math.max(1, bMaxX - bMinX);
                          const heightCAD = bMinY === Infinity ? 100 : Math.max(1, bMaxY - bMinY);

                          const scaleVal = 175 / Math.max(35, widthCAD, heightCAD) * sheetScaleMultiplier;
                          
                          const mapX = (x: number) => 150 + (x - cx) * scaleVal;
                          const mapY = (y: number) => 100 - (y - cy) * scaleVal;

                          return (
                            <svg viewBox="0 0 300 200" className="w-full h-full max-h-[150px]">
                              {/* fine guidelines center grids */}
                              <line x1="150" y1="10" x2="150" y2="190" stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="5,3" />
                              <line x1="10" y1="100" x2="290" y2="100" stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="5,3" />

                              {/* Vector paths loop */}
                              {list.map((sh, sIdx) => {
                                let dStr = "";
                                sh.points.forEach((p, pIdx) => {
                                  const sx = mapX(p.x);
                                  const sy = mapY(p.y);
                                  dStr += `${pIdx === 0 ? "M" : "L"} ${sx} ${sy} `;
                                });
                                if (sh.isClosed && sh.points.length >= 3) dStr += " Z";

                                return (
                                  <path 
                                    key={sIdx} 
                                    d={dStr} 
                                    fill="none" 
                                    stroke={sh.color || "#1e293b"} 
                                    strokeWidth="1.25" 
                                  />
                                );
                              })}

                              {/* Live measurement tags representation */}
                              {dimensions.map((d, index) => {
                                const p1Proj = { x: mapX(d.p1.x), y: mapY(d.p1.y) };
                                const p2Proj = { x: mapX(d.p2.x), y: mapY(d.p2.y) };
                                
                                const dx = d.p2.x - d.p1.x;
                                const dy = d.p2.y - d.p1.y;
                                const length = Math.hypot(dx, dy);
                                const ux = length > 0 ? dx / length : 1;
                                const uy = length > 0 ? dy / length : 0;
                                
                                const nx = -uy;
                                const ny = ux;
                                
                                const cadOffset = d.offset || 15;
                                const offsetProjX = nx * cadOffset * scaleVal;
                                const offsetProjY = -ny * cadOffset * scaleVal;
                                
                                const dim1X = p1Proj.x + offsetProjX;
                                const dim1Y = p1Proj.y + offsetProjY;
                                const dim2X = p2Proj.x + offsetProjX;
                                const dim2Y = p2Proj.y + offsetProjY;
                                
                                const textX = (dim1X + dim2X) / 2;
                                const textY = (dim1Y + dim2Y) / 2;
                                
                                return (
                                  <g key={d.id || index} className="text-[6.2px] font-mono fill-pink-650 stroke-pink-650">
                                    <line x1={p1Proj.x} y1={p1Proj.y} x2={dim1X} y2={dim1Y} stroke="#94a3b8" strokeWidth="0.4" strokeDasharray="1.5,1.5" />
                                    <line x1={p2Proj.x} y1={p2Proj.y} x2={dim2X} y2={dim2Y} stroke="#94a3b8" strokeWidth="0.4" strokeDasharray="1.5,1.5" />
                                    
                                    <line x1={dim1X} y1={dim1Y} x2={dim2X} y2={dim2Y} stroke="#db2777" strokeWidth="0.7" />
                                    <circle cx={dim1X} cy={dim1Y} r="1.2" fill="#db2777" />
                                    <circle cx={dim2X} cy={dim2Y} r="1.2" fill="#db2777" />
                                    
                                    <rect x={textX - 13} y={textY - 4} width="26" height="8" fill="#ffffff" stroke="none" />
                                    <text x={textX} y={textY + 2} textAnchor="middle" stroke="none" className="font-extrabold fill-pink-650">
                                      {d.value.toFixed(1)} mm
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          );
                        })()}
                      </div>
                    </div>

                    {/* QUADRANT D (Bottom Right): RIGHT SIDE PROFILE */}
                    <div className="border border-slate-100 flex flex-col justify-between relative bg-slate-50/10">
                      <div className="absolute top-1 left-2 text-[7px] font-bold text-slate-400 tracking-wider">D: SAĞ YAN GÖRÜNÜŞ (SIDE ELEVATION YZ)</div>
                      
                      <div className="flex-1 flex items-center justify-center min-h-0">
                        {(() => {
                          const list: Array<{ points: Point[]; isClosed: boolean }> = [];
                          layers.forEach(l => {
                            if (!l.visible) return;
                            if (l.finalPoints && l.finalPoints.length > 0) list.push({ points: l.finalPoints, isClosed: l.isClosed });
                            if (l.paths) l.paths.forEach(p => { if (p.length > 0) list.push({ points: p, isClosed: true }); });
                          });

                          let min_y = Infinity, max_y = -Infinity;
                          list.forEach(sh => {
                            sh.points.forEach(p => {
                              if (p.y < min_y) min_y = p.y;
                              if (p.y > max_y) max_y = p.y;
                            });
                          });
                          if (min_y === Infinity) { min_y = -50; max_y = 50; }
                          
                          const h_cad = Math.max(1, max_y - min_y);
                          const c_y = (min_y + max_y) / 2;
                          const scaleVal = 175 / Math.max(35, h_cad, depth) * sheetScaleMultiplier;
                          
                          const mapY = (y: number) => 150 + (y - c_y) * scaleVal;
                          const mapZ = (zValue: number) => 135 - zValue * scaleVal;
                          
                          return (
                            <svg viewBox="0 0 300 200" className="w-full h-full max-h-[150px]">
                              <line x1="150" y1="15" x2="150" y2="185" stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="8,2,2,2" />
                              <line x1="15" y1="135" x2="285" y2="135" stroke="#cbd5e1" strokeWidth="0.5" strokeDasharray="8,2,2,2" />

                              {/* Base & Top boundaries of depth profile */}
                              <line x1={mapY(min_y) - 10} x2={mapY(max_y) + 10} y1="135" y2="135" stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="3,3" />
                              <line x1={mapY(min_y)} x2={mapY(max_y)} y1={mapZ(0)} y2={mapZ(0)} stroke="#1e293b" strokeWidth="1.15" />
                              <line x1={mapY(min_y)} x2={mapY(max_y)} y1={mapZ(depth)} y2={mapZ(depth)} stroke="#1e293b" strokeWidth="1.15" />
                              
                              <line x1={mapY(min_y)} y1={mapZ(0)} x2={mapY(min_y)} y2={mapZ(depth)} stroke="#1e293b" strokeWidth="1.15" />
                              <line x1={mapY(max_y)} y1={mapZ(0)} x2={mapY(max_y)} y2={mapZ(depth)} stroke="#1e293b" strokeWidth="1.15" />

                              {/* minor interior node grid projection guides */}
                              {list[0] && list[0].points.map((pt, i) => (
                                <line 
                                  key={i} 
                                  x1={mapY(pt.y)} 
                                  y1={mapZ(0)} 
                                  x2={mapY(pt.y)} 
                                  y2={mapZ(depth)} 
                                  stroke="#64748b" 
                                  strokeWidth="0.5" 
                                  strokeDasharray="1.5,2" 
                                />
                              ))}

                              {/* width specs arrow info list */}
                              <g className="text-[7.5px] font-mono fill-blue-600 stroke-blue-600">
                                <line x1={mapY(min_y)} y1="148" x2={mapY(max_y)} y2="148" stroke="#2563eb" strokeWidth="0.75" />
                                <line x1={mapY(min_y)} y1="144" x2={mapY(min_y)} y2="152" stroke="#2563eb" strokeWidth="0.4" />
                                <line x1={mapY(max_y)} y1="144" x2={mapY(max_y)} y2="152" stroke="#2563eb" strokeWidth="0.4" />
                                <text x={(mapY(min_y) + mapY(max_y))/2} y="157" textAnchor="middle" stroke="none" className="font-bold fill-blue-600">
                                  W={h_cad.toFixed(1)} mm
                                </text>
                              </g>
                            </svg>
                          );
                        })()}
                      </div>
                    </div>

                  </div>

                  {/* BOTTOM OVERLAYS: TECHNICAL NOTES BLOCK */}
                  <div className="absolute bottom-[35px] left-[18px] max-w-[390px] text-left p-0.5 text-[7px] text-slate-400 font-sans tracking-tight block whitespace-pre-line z-10 leading-relaxed max-h-[75px] overflow-hidden border-l border-slate-300 pl-2">
                    <span className="font-bold text-[7.5px] font-mono text-slate-600 block mb-0.5">GENEL TEKNİK YAPIM NOTLARI:</span>
                    {sheetNotes}
                  </div>

                  {/* INTEGRATED CAD ANTET TITLE BLOCK LEGEND BOX (ANTET) */}
                  <div 
                    id="technical-title-block"
                    className="absolute bottom-[16px] right-[16px] w-[375px] h-[92px] bg-slate-50 border-2 border-slate-900 grid grid-cols-4 grid-rows-3 text-left"
                    style={{ boxSizing: 'border-box' }}
                  >
                    {/* Row 1, Col 1-2: Title */}
                    <div className="col-span-2 border-r border-b border-slate-900 p-1 flex flex-col justify-between bg-slate-100/30">
                      <span className="text-[5px] uppercase font-bold text-slate-400 font-sans">PROJE / PARÇA ADI (TITLE)</span>
                      <span className="text-[9px] font-extrabold text-slate-900 tracking-tight whitespace-nowrap overflow-hidden text-ellipsis uppercase">{sheetTitle}</span>
                    </div>

                    {/* Row 1, Col 3: Company */}
                    <div className="border-r border-b border-slate-900 p-0.5 flex flex-col justify-between">
                      <span className="text-[5px] uppercase font-bold text-slate-400 font-sans">ÜRETİCİ / ŞİRKET</span>
                      <span className="text-[7.5px] font-black text-slate-900 whitespace-nowrap overflow-hidden">CADERIM BİLİŞİM</span>
                    </div>

                    {/* Row 1, Col 4: Standard Project type */}
                    <div className="border-b border-slate-900 p-0.5 flex items-center justify-center bg-slate-100/50">
                      <div className="text-center font-bold text-[7.5px] leading-tight text-slate-800 border border-slate-900 p-0.5 px-1 bg-white">
                        ISO-E PROJECT
                      </div>
                    </div>

                    {/* Row 2, Col 1-2: Designer Email */}
                    <div className="col-span-2 border-r border-b border-slate-900 p-0.5 flex flex-col justify-between">
                      <span className="text-[5px] uppercase font-bold text-slate-400 font-sans">TASARIMCI / E-POSTA</span>
                      <span className="text-[7px] font-bold text-slate-600 whitespace-nowrap overflow-hidden text-ellipsis font-mono">peopleonthearth@gmail.com</span>
                    </div>

                    {/* Row 2, Col 3: Material */}
                    <div className="border-r border-b border-slate-900 p-0.5 flex flex-col justify-between bg-amber-50/10">
                      <span className="text-[5px] uppercase font-bold text-slate-400 font-sans">MALZEME (MATERIAL)</span>
                      <span className="text-[7.5px] font-black text-slate-800 uppercase whitespace-nowrap overflow-hidden text-ellipsis">{sheetMaterial}</span>
                    </div>

                    {/* Row 2, Col 4: Weight Indicator */}
                    <div className="border-b border-slate-900 p-0.5 flex flex-col justify-between bg-emerald-50/10">
                      <span className="text-[5px] uppercase font-bold text-emerald-600 font-sans">AĞIRLIK (CALC WEIGHT)</span>
                      <span className="text-[8px] font-black text-emerald-700">
                        {(() => {
                          const list: Array<{ points: Point[]; isClosed: boolean }> = [];
                          layers.forEach(l => {
                            if (!l.visible) return;
                            if (l.finalPoints && l.finalPoints.length > 0) list.push({ points: l.finalPoints, isClosed: l.isClosed });
                            if (l.paths) l.paths.forEach(p => { if (p.length > 0) list.push({ points: p, isClosed: true }); });
                          });
                          let area = 0;
                          list.forEach(sh => {
                            if (sh.isClosed && sh.points.length >= 3) {
                              let shArea = 0;
                              const poly = sh.points;
                              for (let i = 0; i < poly.length - 1; i++) {
                                shArea += poly[i].x * poly[i + 1].y - poly[i + 1].x * poly[i].y;
                              }
                              shArea += poly[poly.length - 1].x * poly[0].y - poly[0].x * poly[poly.length - 1].y;
                              area += Math.abs(shArea / 2);
                            }
                          });
                          const volumeCm3 = (area * depth) / 1000;
                          const densityList = {
                            "Steel": 7.85, "Aluminum": 2.70, "Brass": 8.40, "Copper": 8.96, "Acrylic": 1.18, "PLA (3D Print)": 1.24, "Oak Wood": 0.75
                          };
                          const density = (densityList as any)[sheetMaterial] || 7.85;
                          const massGrams = volumeCm3 * density;
                          return massGrams > 1000 ? `${(massGrams / 1000).toFixed(2)} kg` : `${massGrams.toFixed(1)} g`;
                        })()}
                      </span>
                    </div>

                    {/* Row 3, Col 1: Date */}
                    <div className="border-r p-0.5 flex flex-col justify-between border-slate-900">
                      <span className="text-[5px] uppercase font-bold text-slate-400 font-sans">SAYFA TARİHİ</span>
                      <span className="text-[7px] text-slate-800 font-mono">{new Date().toISOString().split('T')[0]}</span>
                    </div>

                    {/* Row 3, Col 2: Scale Factor */}
                    <div className="border-r p-0.5 flex flex-col justify-between border-slate-900">
                      <span className="text-[5px] uppercase font-bold text-slate-400 font-sans">SAYFA ÖLÇEĞİ</span>
                      <span className="text-[7.5px] font-bold text-slate-800">{sheetScaleMultiplier === 1 ? "1:1 (ISO)" : `${sheetScaleMultiplier.toFixed(1)}:1`}</span>
                    </div>

                    {/* Row 3, Col 3: Revision Code */}
                    <div className="border-r p-0.5 flex flex-col justify-between border-slate-900">
                      <span className="text-[5px] uppercase font-bold text-slate-400 font-sans">REVİZYON</span>
                      <span className="text-[8px] font-black text-amber-700">{sheetRevision}</span>
                    </div>

                    {/* Row 3, Col 4: Software code indicator */}
                    <div className="p-0.5 flex flex-col justify-between">
                      <span className="text-[5px] uppercase font-bold text-slate-400 font-sans">SAYFA BİLGİSİ</span>
                      <span className="text-[6.5px] text-zinc-500 font-bold font-mono">CADERIM v14.1</span>
                    </div>

                  </div>

                </div>
              </div>

            </div>
          ) : (
            <>
              {/* Viewport A: 2D Sketch canvas */}
              <div 
                style={{ flex: workspaceLayout === '2d-only' ? '1 1 100%' : `0 0 ${splitRatio}%`, display: (workspaceLayout === 'split' || workspaceLayout === '2d-only') ? 'flex' : 'none' }}
                className="h-1/2 md:h-full relative border-r border-zinc-800 flex flex-col bg-zinc-950 transition-all duration-75 overflow-hidden"
              >
            <div className="absolute top-3 left-3 bg-zinc-900/85 border border-zinc-850 backdrop-blur px-3 py-1.5 rounded text-xs font-mono text-zinc-300 pointer-events-none flex items-center gap-2 z-10 font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              2D Schematic Sketcher
            </div>

            {/* Stretch / Move Active Placement Banner Overlay */}
            {(activeSegmentStretch || activeSegmentMove) && (
              <div className="absolute top-14 left-3 right-3 z-30 bg-zinc-900/95 border-2 border-orange-500/50 backdrop-blur rounded-lg p-3 shadow-xl flex items-center justify-between gap-3 text-left">
                <div className="flex items-start gap-2.5">
                  <div className="p-1 px-2 rounded font-bold font-mono text-[10px] bg-orange-600/30 text-orange-200 uppercase shrink-0">
                    {activeSegmentStretch ? "📐 STRETCH ACTIVE" : "📦 MOVE ACTIVE"}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-zinc-200 block">
                      {activeSegmentStretch ? "Edge Stretch Interactive Placement" : "Shape Move Interactive Placement"}
                    </span>
                    <span className="text-[10px] text-zinc-500 block">
                      Move mouse cursor to coordinate. Click or select Apply to place onto sketch. Escape cancels.
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setActiveSegmentStretch(null);
                      setActiveSegmentMove(null);
                      setSnapPoint(null);
                      setTrackedLines([]);
                      logCommandResponse("Modification applied.");
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-[10px] font-mono font-bold text-white rounded transition cursor-pointer uppercase text-center"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => {
                      if (activeSegmentStretch) {
                        if (activeSegmentStretch.pathIdx === -1) {
                          setFinalPoints(activeSegmentStretch.originalPoints);
                        } else {
                          const updatedPaths = activeLayer.paths ? [...activeLayer.paths] : [];
                          updatedPaths[activeSegmentStretch.pathIdx] = activeSegmentStretch.originalPoints;
                          setPaths(updatedPaths);
                        }
                      } else if (activeSegmentMove) {
                        if (activeSegmentMove.pathIdx === -1) {
                          setFinalPoints(activeSegmentMove.originalPoints);
                        } else {
                          const updatedPaths = activeLayer.paths ? [...activeLayer.paths] : [];
                          updatedPaths[activeSegmentMove.pathIdx] = activeSegmentMove.originalPoints;
                          setPaths(updatedPaths);
                        }
                      }
                      setActiveSegmentStretch(null);
                      setActiveSegmentMove(null);
                      setSnapPoint(null);
                      setTrackedLines([]);
                      logCommandResponse("Drag operation canceled.");
                    }}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-[10px] font-mono font-bold text-zinc-400 hover:text-white rounded transition cursor-pointer uppercase text-center"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Pending Rotation Point Input Banner Overlay */}
            {pendingRotateAngle !== null && (
              <div className="absolute top-14 left-3 right-3 z-30 bg-zinc-900/95 border-2 border-amber-500/80 backdrop-blur rounded-lg p-3 shadow-xl flex items-center justify-between gap-3 text-left animate-pulse">
                <div className="flex items-start gap-2.5">
                  <div className="p-1 px-2 rounded font-bold font-mono text-[10px] bg-amber-600/30 text-amber-200 uppercase shrink-0">
                    🔄 SELECT ROTATION PIVOT POINT
                  </div>
                  <div>
                    <span className="text-xs font-bold text-zinc-200 block">
                      Rotation will be applied at {pendingRotateAngle}°.
                    </span>
                    <span className="text-[10px] text-zinc-400 block">
                      Please click anywhere on the canvas or a node point to define the rotation center. Click 'Cancel' to abort.
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setPendingRotateAngle(null);
                      logCommandResponse("Rotation operation canceled.");
                    }}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-[10px] font-mono font-bold text-zinc-400 hover:text-white rounded transition cursor-pointer uppercase text-center"
                  >
                    Cancel (ESC)
                  </button>
                </div>
              </div>
            )}

            {/* Dynamic Rotation Center Selection Banner Overlay */}
            {rotationCenterSelectMode && (
              <div className="absolute top-14 left-3 right-3 z-30 bg-zinc-900/95 border-2 border-amber-500/80 backdrop-blur rounded-lg p-3 shadow-xl flex items-center justify-between gap-3 text-left animate-pulse">
                <div className="flex items-start gap-2.5">
                  <div className="p-1 px-2 rounded font-bold font-mono text-[10px] bg-amber-600/30 text-amber-200 uppercase shrink-0">
                    🔄 SELECT ROTATION CENTER
                  </div>
                  <div>
                    <span className="text-xs font-bold text-zinc-200 block">
                      Determine custom rotation center (Pivot Point)
                    </span>
                    <span className="text-[10px] text-zinc-400 block">
                      Click any point to set as pivot rotation center. Rotation steps will rotate selected assets around this point.
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setRotationCenterSelectMode(false);
                      logCommandResponse("Rotation center selection canceled.");
                    }}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-[10px] font-mono font-bold text-zinc-400 hover:text-white rounded transition cursor-pointer uppercase text-center"
                  >
                    Cancel (ESC)
                  </button>
                </div>
              </div>
            )}

            {/* Interactive parametric segment dimension editor popup */}
            {editingSegmentIdx !== null && editingPathIdx !== null && (
              <div className="absolute top-14 left-3 bg-zinc-900/95 border-2 border-amber-500 rounded-lg p-3 text-xs w-[250px] shadow-2xl z-40 space-y-2 backdrop-blur animate-fade-in">
                <div className="flex justify-between items-center pb-1.5 border-b border-zinc-850">
                  <span className="font-bold text-amber-400 font-mono flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    Edit Dimension
                  </span>
                  <button 
                    onClick={() => {
                      setEditingSegmentIdx(null);
                      setEditingPathIdx(null);
                    }}
                    className="text-zinc-500 hover:text-zinc-200 transition text-[11px] font-bold"
                  >
                    ✕
                  </button>
                </div>
                <div>
                  <div className="text-[10px] text-zinc-400 mb-1.5 font-mono">
                    Segment link: <span className="text-zinc-200 font-bold font-mono">L-{editingSegmentIdx + 1}</span> ({editingPathIdx === -1 ? "Active Drawing" : "Layer Shape #" + editingPathIdx})
                  </div>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      value={editingDimensionValue}
                      onChange={(e) => setEditingDimensionValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const lenVal = parseFloat(editingDimensionValue);
                          if (!isNaN(lenVal) && lenVal > 0) {
                            handleApplySegmentDimension(editingPathIdx, editingSegmentIdx, lenVal);
                          }
                        }
                      }}
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-200 text-xs font-mono outline-none focus:border-amber-500"
                      placeholder="e.g. 120"
                      autoFocus
                    />
                    <span className="text-zinc-400 font-mono">mm</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const lenVal = parseFloat(editingDimensionValue);
                      if (!isNaN(lenVal) && lenVal > 0) {
                        handleApplySegmentDimension(editingPathIdx, editingSegmentIdx, lenVal);
                      }
                    }}
                    className="flex-1 py-1 bg-amber-600 hover:bg-amber-500 text-zinc-950 rounded font-bold transition text-center cursor-pointer text-[11px] font-mono"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => {
                      setEditingSegmentIdx(null);
                      setEditingPathIdx(null);
                    }}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 rounded transition text-[11px] font-mono"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Interactive parametric measurement/dimension positioning editor popup */}
            {selectedDimensionId !== null && (
              <div className="absolute top-14 left-3 bg-zinc-900/95 border-2 border-pink-500 rounded-lg p-3 text-xs w-[280px] shadow-2xl z-40 space-y-3 backdrop-blur animate-fade-in text-zinc-100">
                <div className="flex justify-between items-center pb-1.5 border-b border-zinc-850">
                  <span className="font-bold text-pink-400 font-mono flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
                    <span className="inline-block w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
                    {isSelectedDimAnEdge ? "📐 Edge Length & Resizing" : "📐 Smart Positioning"}
                  </span>
                  <button 
                    onClick={() => {
                      setSelectedDimensionId(null);
                    }}
                    className="text-zinc-500 hover:text-zinc-200 transition text-[11px] font-bold"
                  >
                    ✕
                  </button>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-400 mb-2 font-mono leading-relaxed select-none">
                    {isSelectedDimAnEdge 
                      ? "Enter target edge length to resize the shape proportionally or non-proportionally." 
                      : "Adjust distance between snap points to reposition nodes dynamically."}
                  </p>
                  
                  {/* Target Distance Input */}
                  <label className="block text-[10px] text-zinc-400 font-mono mb-1">
                    {isSelectedDimAnEdge ? "New Edge Length:" : "Target Distance:"}
                  </label>
                  <div className="flex gap-1.5 items-center">
                    <input
                      type="number"
                      step="0.1"
                      value={editingDimensionValueInput}
                      onChange={(e) => setEditingDimensionValueInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const distVal = parseFloat(editingDimensionValueInput);
                          if (!isNaN(distVal) && distVal > 0) {
                            handleApplyDimensionValue(selectedDimensionId, distVal);
                          }
                        }
                      }}
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-zinc-100 text-xs font-mono outline-none focus:border-pink-500 font-bold"
                      placeholder="e.g. 150"
                      autoFocus
                    />
                    <span className="text-zinc-400 font-mono font-bold">mm</span>
                  </div>
                </div>

                {/* Positioning Options Toggles */}
                {!isSelectedDimAnEdge && (
                  <div className="p-2 bg-zinc-950 border border-zinc-850 rounded space-y-2">
                    <span className="text-[9px] uppercase font-mono text-zinc-500 block">Positioning Method:</span>
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 cursor-pointer text-[11px] font-mono text-zinc-300">
                        <input
                          type="radio"
                          name="positioning_mode"
                          checked={moveEntireShapeOnDimChange}
                          onChange={() => setMoveEntireShapeOnDimChange(true)}
                          className="rounded-full text-pink-500 focus:ring-0 cursor-pointer"
                        />
                        <span>Shift Entire Shape (Recommended)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-[11px] font-mono text-zinc-300">
                        <input
                          type="radio"
                          name="positioning_mode"
                          checked={!moveEntireShapeOnDimChange}
                          onChange={() => setMoveEntireShapeOnDimChange(false)}
                          className="rounded-full text-pink-500 focus:ring-0 cursor-pointer"
                        />
                        <span>Move Target Node Only</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Apply Actions */}
                <div className="flex gap-2 pt-1 border-t border-zinc-800/60">
                  <button
                    onClick={() => {
                      const distVal = parseFloat(editingDimensionValueInput);
                      if (!isNaN(distVal) && distVal > 0) {
                        handleApplyDimensionValue(selectedDimensionId, distVal);
                      }
                    }}
                    className="flex-1 py-1.5 bg-pink-600 hover:bg-pink-500 text-white rounded font-bold transition text-center cursor-pointer text-[11px] font-mono"
                  >
                    {isSelectedDimAnEdge ? "Resize (Apply)" : "Reposition (Apply)"}
                  </button>
                  <button
                    onClick={() => handleDeleteDimension(selectedDimensionId)}
                    className="px-2 py-1.5 bg-red-950 hover:bg-red-900 border border-red-900 text-red-100 rounded transition text-[11px] font-mono"
                    title="Delete this dimension label from canvas"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => {
                      setSelectedDimensionId(null);
                    }}
                    className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 rounded transition text-[11px] font-mono"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Absolute Origin Coordinate HUD */}
            <div className="absolute bottom-3 left-3 bg-zinc-900/90 border border-zinc-850 backdrop-blur px-3 py-2 rounded text-xs font-mono text-zinc-400 pointer-events-none flex flex-col gap-1 z-10 shadow-lg min-w-[140px]">
              <div className="text-[9px] uppercase text-zinc-500 tracking-wider font-extrabold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Origin X=0, Y=0 (CAD HUD)
              </div>
              <div className="flex flex-col gap-0.5 text-zinc-300 font-bold text-[11px]">
                <div className="flex justify-between gap-4">
                  <span>X (Horizontal):</span>
                  <span className="text-rose-400">{hoverCoords ? hoverCoords.x.toFixed(1) : "0.0"} mm</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Y (Vertical):</span>
                  <span className="text-emerald-400">{hoverCoords ? hoverCoords.y.toFixed(1) : "0.0"} mm</span>
                </div>
                <div className="flex justify-between gap-4 text-zinc-500 text-[9px] pt-1.5 border-t border-zinc-850/50">
                  <span>Scale (Zoom):</span>
                  <span className="text-zinc-400">{Math.round(viewZoom * 100)}%</span>
                </div>
              </div>
            </div>
            
            {/* Legend guide right-top */}
            <div className="absolute top-3 right-3 bg-zinc-900/85 border border-zinc-850 backdrop-blur p-2.5 rounded text-[10px] font-mono text-zinc-400 pointer-events-none z-10 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-zinc-300">
                <span>🖱️ CAD Viewport Guides</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-blue-500 inline-block rounded-sm" />
                Right Click + Drag: Box Selection
              </div>
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-2.5 h-2.5 bg-amber-500 inline-block rounded-sm" />
                Left Click + Drag: Multi-Move
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 border border-rose-600 bg-rose-600/30 inline-block" />
                Endpoint Node Snapping
              </div>
              <div className="text-zinc-500 text-[9px] pt-1 border-t border-zinc-800">
                Wheel: Orbit Zoom • Middle Mouse: Pan
              </div>
            </div>

            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              style={{
                cursor:
                  currentCommand === 'trim'
                    ? 'cell'
                    : currentCommand === 'extend'
                    ? 'crosshair'
                    : drawMode === 'drag'
                    ? 'grab'
                    : 'crosshair',
              }}
              className="w-full flex-1 touch-none bg-zinc-950"
            />
          </div>

          {/* Viewports Splitter Bar */}
          {workspaceLayout === 'split' && (
            <div 
              onMouseDown={() => { isDraggingSplitRef.current = true; }}
              className="hidden md:flex flex-col items-center justify-center w-1 hover:w-2 bg-zinc-900 border-l border-r border-zinc-850 hover:border-amber-500/80 hover:bg-amber-500/20 cursor-col-resize transition-all shrink-0 self-stretch group z-20"
              title="Drag to adjust 2D/3D viewport splitter ratio"
            >
              <div className="w-0.5 h-10 bg-zinc-700 rounded-full group-hover:bg-amber-400 group-hover:h-14 transition-all" />
            </div>
          )}

          {/* Viewport B: 3D ThreeJS renderer */}
          <div 
            style={{ flex: workspaceLayout === '3d-only' ? '1 1 100%' : `0 0 ${100 - splitRatio}%`, display: (workspaceLayout === 'split' || workspaceLayout === '3d-only') ? 'flex' : 'none' }}
            className="h-1/2 md:h-full border-t md:border-t-0 border-zinc-800 flex flex-col bg-zinc-950 transition-all duration-75 overflow-hidden"
          >
            <ThreeViewport
              layers={layers}
              activeLayerId={activeLayerId}
              triggerStlExportRef={triggerStlExportRef}
            />
          </div>
            </>
          )}
        </main>
      </div>

      {/* 4. Lower CAD CLI Console / Logs Command Panel */}
      <footer className="h-28 bg-zinc-950 border-t border-zinc-800 flex flex-col shrink-0 font-mono text-[11px]">
        {/* Terminal outputs history logs */}
        <div className="flex-1 overflow-y-auto px-4 py-2 text-zinc-500 space-y-0.5 scrollbar-thin scrollbar-thumb-zinc-800">
          {cmdLogs.map((log, index) => (
            <div key={index} className="flex gap-2">
              <span className="text-zinc-650 font-bold select-none">{`>`}</span>
              <span className="text-zinc-400">{log}</span>
            </div>
          ))}
        </div>

        {/* Input interface */}
        <form
          onSubmit={handleCommandLineSubmit}
          className="h-10 border-t border-zinc-800 bg-zinc-900/60 px-4 flex items-center gap-2"
        >
          <span className="text-blue-500 font-bold tracking-wider select-none">Command:</span>
          <input
            type="text"
            className="flex-1 bg-transparent px-2 py-1 outline-none text-zinc-100 font-bold placeholder-zinc-600"
            placeholder="Available CAD CLI: L (Line), R (Rect), C (Circle), POL (Polygon), F (Fillet), CHAMFER, CLEAR (Reset)"
            value={cmdText}
            onChange={(e) => setCmdText(e.target.value)}
          />
        </form>
      </footer>

      {/* Polygon Sides Prompt Modal */}
      {showPolygonPrompt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-zinc-900 border border-zinc-805 rounded-lg p-5 w-80 shadow-2xl max-w-[95%]">
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2 mb-3">
              <span className="p-1 rounded bg-blue-500/20 text-blue-400">
                <Maximize className="w-4 h-4 rotate-45" />
              </span>
              Polygon Sketch Options
            </h3>
            <p className="text-xs text-zinc-400 mb-4 font-mono leading-relaxed text-left">
              Enter the number of segments for your regular polygon or select a template preset below:
            </p>
            
            {/* Quick Presets */}
            <div className="grid grid-cols-5 gap-1.5 mb-4">
              {[3, 4, 5, 6, 8].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    handleStartPolygonDrawing(s, polygonTypeInput);
                  }}
                  className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-500 text-zinc-300 font-mono text-[11px] py-1.5 rounded transition font-bold"
                >
                  {s}
                  <div className="text-[7px] text-zinc-500 font-sans tracking-tight leading-none pt-0.5 font-normal animate-fade-in">
                    {s === 3 ? 'Triangle' : s === 4 ? 'Square' : s === 5 ? 'Pentagon' : s === 6 ? 'Hexagon' : 'Octagon'}
                  </div>
                </button>
              ))}
            </div>

            {/* Polygon Construction Type Selector */}
            <div className="space-y-1.5 mb-4 text-left">
              <label className="block text-[10px] text-zinc-500 uppercase tracking-wider font-mono font-bold">Construction Type:</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPolygonTypeInput('corner')}
                  className={`rounded text-xs px-2 py-2 font-mono font-bold border transition text-center cursor-pointer ${
                    polygonTypeInput === 'corner'
                      ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                      : 'bg-zinc-800 hover:bg-zinc-750 border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-300'
                  }`}
                >
                  Inscribed (Corner)
                  <div className="text-[8px] opacity-70 font-sans tracking-tight leading-none mt-0.5 font-normal">
                    Circumscribed Circle
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPolygonTypeInput('midpoint')}
                  className={`rounded text-xs px-2 py-2 font-mono font-bold border transition text-center cursor-pointer ${
                    polygonTypeInput === 'midpoint'
                      ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                      : 'bg-zinc-800 hover:bg-zinc-750 border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-300'
                  }`}
                >
                  Circumscribed (Flat)
                  <div className="text-[8px] opacity-70 font-sans tracking-tight leading-none mt-0.5 font-normal">
                    Inscribed Circle
                  </div>
                </button>
              </div>
            </div>

            {/* Custom Input */}
            <div className="space-y-1.5 mb-5 text-left">
              <label className="block text-[10px] text-zinc-500 uppercase tracking-wider font-mono font-bold">Custom Polygon Sides (3 - 32):</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="3"
                  max="32"
                  value={polygonSidesInput}
                  onChange={(e) => setPolygonSidesInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const val = parseInt(polygonSidesInput);
                      if (!isNaN(val) && val >= 3 && val <= 32) {
                        handleStartPolygonDrawing(val, polygonTypeInput);
                      }
                    } else if (e.key === 'Escape') {
                      setShowPolygonPrompt(false);
                    }
                  }}
                  className="flex-1 bg-zinc-950 border border-zinc-800 focus:border-blue-500 rounded px-2.5 py-1.5 text-zinc-100 font-mono text-sm outline-none font-bold"
                  autoFocus
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 justify-end text-xs font-mono">
              <button
                type="button"
                onClick={() => {
                  setShowPolygonPrompt(false);
                }}
                className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const val = parseInt(polygonSidesInput);
                  if (!isNaN(val) && val >= 3 && val <= 32) {
                    handleStartPolygonDrawing(val, polygonTypeInput);
                  }
                }}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition shadow cursor-pointer"
              >
                Build and Draw
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
