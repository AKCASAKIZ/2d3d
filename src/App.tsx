import React, { useState, useEffect, useRef } from 'react';
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
} from 'lucide-react';

import { Point, CommandType, DrawModeType, HistoryItem, SnapPoint, TrackLine, CADLayer, PathSettings, SnapToggles } from './types';
import { calculateSnaps, distance, douglasPeucker, getClosestPointOnSegment, findSegmentIntersection, offsetPolygon } from './utils/geometry';
import { ThreeViewport } from './components/ThreeViewport';

export default function App() {
  // Layer state
  const [layers, setLayers] = useState<CADLayer[]>([
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
    quad: true
  });
  const [customAnchor, setCustomAnchor] = useState<Point | null>(null);
  const [anchorSelectMode, setAnchorSelectMode] = useState(false);
  const [editingSegmentIdx, setEditingSegmentIdx] = useState<number | null>(null);
  const [editingPathIdx, setEditingPathIdx] = useState<number | null>(null);
  const [editingDimensionValue, setEditingDimensionValue] = useState<string>("");
  const [splitRatio, setSplitRatio] = useState<number>(50);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [showDims, setShowDims] = useState(true);
  const [polygonSides, setPolygonSides] = useState(6);
  const [filletRadius, setFilletRadius] = useState<number>(24);
  const [chamferDistance, setChamferDistance] = useState<number>(20);
  const [offsetDistance, setOffsetDistance] = useState<number>(15);
  const [cadRotateAngle, setCadRotateAngle] = useState<number>(45);
  const [cadScaleFactor, setCadScaleFactor] = useState<number>(1.2);

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

  // BG Image reference
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [bgOpacity, setBgOpacity] = useState(0.4);

  // History & Command logs
  const [historyStack, setHistoryStack] = useState<HistoryItem[]>([]);
  const [cmdText, setCmdText] = useState('');
  const [cmdLogs, setCmdLogs] = useState<string[]>([
    'Zeki CAD EXEL v14 - Smart Track & Midpoint Snap System online.',
    'Type commands (L: Line, R: Rect, C: Circle, POL: Polygon, F: Fillet, CH: Chamfer, U: Undo, CLEAR: Reset) in Command bar.',
  ]);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragIndexRef = useRef<number>(-1);
  const dragPathIndexRef = useRef<number>(-1);
  const isDrawingRef = useRef(false);
  const triggerStlExportRef = useRef<(() => void) | null>(null);
  const isDraggingSplitRef = useRef<boolean>(false);
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

    // Direction unit vector from p1 to p2
    const ux = dx / currentDist;
    const uy = dy / currentDist;

    // The target coordinate for p2 is:
    const targetP2X = p1.x + ux * targetValue;
    const targetP2Y = p1.y + uy * targetValue;

    // Shift vector for p2
    const shiftX = targetP2X - p2.x;
    const shiftY = targetP2Y - p2.y;

    let pointsShiftedList: Point[] = [];
    
    if (moveEntireShapeOnDimChange) {
      // Find which shape (either finalPoints, or a path in activeLayer.paths) contains the node p2 (proximity check)
      let foundPathIdx = -1;
      let isFinalPts = false;
      const epsilon = 1.0; // vertex proximity limit (1.0 mm)

      // Check finalPoints first
      if (finalPoints.length > 0) {
        const containsP2 = finalPoints.some(pt => Math.hypot(pt.x - p2.x, pt.y - p2.y) < epsilon);
        if (containsP2) {
          isFinalPts = true;
        }
      }

      // Check other layer paths
      if (!isFinalPts && activeLayer.paths) {
        for (let i = 0; i < activeLayer.paths.length; i++) {
          const containsP2 = activeLayer.paths[i].some(pt => Math.hypot(pt.x - p2.x, pt.y - p2.y) < epsilon);
          if (containsP2) {
            foundPathIdx = i;
            break;
          }
        }
      }

      if (isFinalPts) {
        // Shift entire finalPoints
        setFinalPoints(prev => {
          const updated = prev.map(pt => {
            const u = { ...pt, x: pt.x + shiftX, y: pt.y + shiftY };
            if (pt.circleData) {
              u.circleData = {
                center: { x: pt.circleData.center.x + shiftX, y: pt.circleData.center.y + shiftY },
                radius: pt.circleData.radius
              };
            }
            return u;
          });
          pointsShiftedList = updated;
          return updated;
        });
        logCommandResponse(`Konumlandırma: Çizim şekli ${targetValue.toFixed(1)} mm olarak konumlandırıldı.`);
      } else if (foundPathIdx !== -1 && activeLayer.paths) {
        // Shift entire path elements
        setPaths(prev => {
          return prev.map((path, idx) => {
            if (idx === foundPathIdx) {
              const updated = path.map(pt => {
                const u = { ...pt, x: pt.x + shiftX, y: pt.y + shiftY };
                if (pt.circleData) {
                  u.circleData = {
                    center: { x: pt.circleData.center.x + shiftX, y: pt.circleData.center.y + shiftY },
                    radius: pt.circleData.radius
                  };
                }
                return u;
              });
              pointsShiftedList = updated;
              return updated;
            }
            return path;
          });
        });
        logCommandResponse(`Konumlandırma: Şekil #${foundPathIdx + 1} ${targetValue.toFixed(1)} mm olarak konumlandırıldı.`);
      } else {
        // Just shift the single point p2 itself (in the closest shape or raw)
        let closestPt: { ref: Point, pathIdx: number, ptIdx: number } | null = null;
        let minDist = epsilon;

        // Check finalPoints
        finalPoints.forEach((pt, ptIdx) => {
          const d = Math.hypot(pt.x - p2.x, pt.y - p2.y);
          if (d < minDist) {
            minDist = d;
            closestPt = { ref: pt, pathIdx: -1, ptIdx };
          }
        });

        // Check paths
        if (activeLayer.paths) {
          activeLayer.paths.forEach((path, pathIdx) => {
            path.forEach((pt, ptIdx) => {
              const d = Math.hypot(pt.x - p2.x, pt.y - p2.y);
              if (d < minDist) {
                minDist = d;
                closestPt = { ref: pt, pathIdx, ptIdx };
              }
            });
          });
        }

        if (closestPt) {
          const c: any = closestPt;
          if (c.pathIdx === -1) {
            setFinalPoints(prev => prev.map((pt, i) => i === c.ptIdx ? { ...pt, x: pt.x + shiftX, y: pt.y + shiftY } : pt));
          } else {
            setPaths(prev => prev.map((path, pIdx) => pIdx === c.pathIdx ? path.map((pt, i) => i === c.ptIdx ? { ...pt, x: pt.x + shiftX, y: pt.y + shiftY } : pt) : path));
          }
          logCommandResponse(`Konumlandırma: Yakın düğüm ${targetValue.toFixed(1)} mm mesafeye kaydırıldı.`);
        } else {
          logCommandResponse("Konumlandırma yapılamadı: Ölçü noktasına yakın çizim düğümü bulunamadı.");
        }
      }
    } else {
      // Move point only mode
      let closestPt: { ref: Point, pathIdx: number, ptIdx: number } | null = null;
      let minDist = 3.0;

      finalPoints.forEach((pt, ptIdx) => {
        const d = Math.hypot(pt.x - p2.x, pt.y - p2.y);
        if (d < minDist) {
          minDist = d;
          closestPt = { ref: pt, pathIdx: -1, ptIdx };
        }
      });

      if (activeLayer.paths) {
        activeLayer.paths.forEach((path, pathIdx) => {
          path.forEach((pt, ptIdx) => {
            const d = Math.hypot(pt.x - p2.x, pt.y - p2.y);
            if (d < minDist) {
              minDist = d;
              closestPt = { ref: pt, pathIdx, ptIdx };
            }
          });
        });
      }

      if (closestPt) {
        const c: any = closestPt;
        if (c.pathIdx === -1) {
          setFinalPoints(prev => prev.map((pt, i) => i === c.ptIdx ? { ...pt, x: targetP2X, y: targetP2Y } : pt));
        } else {
          setPaths(prev => prev.map((path, pIdx) => pIdx === c.pathIdx ? path.map((pt, i) => i === c.ptIdx ? { ...pt, x: targetP2X, y: targetP2Y } : pt) : path));
        }
        logCommandResponse(`Konumlandırma: Tek nokta ${targetValue.toFixed(1)} mm olarak ayarlandı.`);
      } else {
        logCommandResponse("Konumlandırma: Düğüm noktası bulunamadı.");
      }
    }

    // Update dimensions share endpoints coordinates
    setDimensions(prev => prev.map(d => {
      let up1 = { ...d.p1 };
      let up2 = { ...d.p2 };

      if (Math.hypot(d.p2.x - p2.x, d.p2.y - p2.y) < 1.0) {
        up2 = { ...d.p2, x: targetP2X, y: targetP2Y };
      }
      if (Math.hypot(d.p1.x - p2.x, d.p1.y - p2.y) < 1.0) {
        up1 = { ...d.p1, x: targetP2X, y: targetP2Y };
      }

      if (d.id === dimId) {
        return {
          ...d,
          p1: up1,
          p2: up2,
          value: targetValue
        };
      }
      return { ...d, p1: up1, p2: up2 };
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

  const applyCadEditRotate = (angleInput: number) => {
    saveState();
    let modified = false;
    const rad = (angleInput * Math.PI) / 180;
    const cosVal = Math.cos(rad);
    const sinVal = Math.sin(rad);

    const rotatePoints = (points: Point[]): Point[] => {
      const center = customAnchor ? customAnchor : getSelectedCenter(points);
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
      logCommandResponse(`Döndürüldü: ${angleInput}° Derece Döndürme Tamamlandı.`);
    } else {
      logCommandResponse("Döndürülecek seçili çizgi veya poligon bulunamadı.");
    }
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
  }, [finalPoints, isClosed, historyStack, layers, activeLayerId, activeSegmentStretch, activeSegmentMove, segmentChoicePending, selectedPathIndices, isFinalPointsSelected, copiedPaths, copiedFinalPoints, hoverCoords]);

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
  useEffect(() => {
    drawSketch();
  }, [finalPoints, rawPoints, isClosed, viewZoom, panX, panY, snapPoint, trackedLines, tempPoint, showDims, bgImage, bgOpacity, layers, activeLayerId, selectedPathIndices, isFinalPointsSelected, rightClickStart, rightClickEnd, splitRatio, sidebarCollapsed]);

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

  const setCommand = (cmd: CommandType) => {
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
  const applyFillet = (r: number = filletRadius) => {
    if (activeLayer.locked) {
      logCommandResponse(`Layer "${activeLayer.name}" is locked. Unlock it in the Layer Manager to apply Fillet.`);
      return;
    }
    if (finalPoints.length < 4) {
      logCommandResponse('Need at least 3 segments to apply Fillet (Corner rounding).');
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
    logCommandResponse(`Fillet applied (r: ${r} mm) to corners.`);
  };

  const applyChamfer = (d: number = chamferDistance) => {
    if (activeLayer.locked) {
      logCommandResponse(`Layer "${activeLayer.name}" is locked. Unlock it in the Layer Manager to apply Chamfer.`);
      return;
    }
    if (finalPoints.length < 4) {
      logCommandResponse('Need at least 3 segments to apply Chamfer.');
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
    logCommandResponse(`Chamfer applied (d: ${d} mm) to corners.`);
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
    if (selectedPathIdx === -1) {
      setFinalPoints(prev => {
        const updated = [...prev];
        updated[selectedVertexIdx!] = { ...updated[selectedVertexIdx!], x: newX, y: newY };
        if (isClosed && updated.length > 2) {
          if (selectedVertexIdx === 0) updated[updated.length - 1] = { ...updated[updated.length - 1], x: newX, y: newY };
          if (selectedVertexIdx === updated.length - 1) updated[0] = { ...updated[0], x: newX, y: newY };
        }
        return updated;
      });
    } else {
      setLayers(prev => prev.map(l => {
        if (l.id === activeLayerId && l.paths) {
          const updatedPaths = [...l.paths];
          const updatedPath = [...updatedPaths[selectedPathIdx]];
          updatedPath[selectedVertexIdx!] = { ...updatedPath[selectedVertexIdx!], x: newX, y: newY };
          
          if (updatedPath.length > 2) {
            const isClosedLoop = Math.hypot(updatedPath[0].x - updatedPath[updatedPath.length - 1].x, updatedPath[0].y - updatedPath[updatedPath.length - 1].y) < 0.1;
            if (isClosedLoop) {
              if (selectedVertexIdx === 0) updatedPath[updatedPath.length - 1] = { ...updatedPath[updatedPath.length - 1], x: newX, y: newY };
              if (selectedVertexIdx === updatedPath.length - 1) updatedPath[0] = { ...updatedPath[0], x: newX, y: newY };
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

    // Clear Screen
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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

    // 2. Draw Grid Pattern
    const gridSize = 50;
    const startX = Math.floor(-panX / viewZoom / gridSize) * gridSize;
    const endX = (canvas.width - panX) / viewZoom;
    const startY = Math.floor(-panY / viewZoom / gridSize) * gridSize;
    const endY = (canvas.height - panY) / viewZoom;

    ctx.strokeStyle = '#27272a'; // Zinc-800
    ctx.lineWidth = 0.5 / viewZoom;
    ctx.beginPath();
    for (let x = startX; x < endX; x += gridSize) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += gridSize) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
    }
    ctx.stroke();

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
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 4. Smart snap visual cues (Square / Triangle / Cross)
    if (snapPoint) {
      ctx.lineWidth = 2.0 / viewZoom;
      ctx.strokeStyle = '#e11d48'; // Rose-600
      ctx.fillStyle = '#e11d48';
      const sz = 8 / viewZoom;

      if (snapPoint.type === 'end') {
        // Square for End point
        ctx.strokeStyle = '#e11d48'; // Rose-600
        ctx.fillStyle = '#e11d48';
        ctx.strokeRect(snapPoint.x - sz / 2, snapPoint.y - sz / 2, sz, sz);
      } else if (snapPoint.type === 'mid') {
        // Triangle for Midpoint
        ctx.strokeStyle = '#e11d48'; // Rose-600
        ctx.fillStyle = '#e11d48';
        ctx.beginPath();
        ctx.moveTo(snapPoint.x, snapPoint.y - sz / 2);
        ctx.lineTo(snapPoint.x + sz / 2, snapPoint.y + sz / 2);
        ctx.lineTo(snapPoint.x - sz / 2, snapPoint.y + sz / 2);
        ctx.closePath();
        ctx.stroke();
      } else if (snapPoint.type === 'int') {
        // Cross for intersection
        ctx.strokeStyle = '#e11d48'; // Rose-600
        ctx.fillStyle = '#e11d48';
        ctx.beginPath();
        ctx.moveTo(snapPoint.x - sz / 2, snapPoint.y - sz / 2);
        ctx.lineTo(snapPoint.x + sz / 2, snapPoint.y + sz / 2);
        ctx.moveTo(snapPoint.x + sz / 2, snapPoint.y - sz / 2);
        ctx.lineTo(snapPoint.x - sz / 2, snapPoint.y + sz / 2);
        ctx.stroke();
      } else if (snapPoint.type === 'origin') {
        // Circular crosshairs for Origin Snap - Vibrant Green
        ctx.strokeStyle = '#22c55e'; // Green-500
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(snapPoint.x, snapPoint.y, sz / 1.5, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(snapPoint.x - sz, snapPoint.y);
        ctx.lineTo(snapPoint.x + sz, snapPoint.y);
        ctx.moveTo(snapPoint.x, snapPoint.y - sz);
        ctx.lineTo(snapPoint.x, snapPoint.y + sz);
        ctx.stroke();
      } else if (snapPoint.type === 'anchor') {
        // Double concentric boxes for User Custom Anchor - Vibrant Cyan/Blue
        ctx.strokeStyle = '#06b6d4'; // Cyan-500
        ctx.fillStyle = '#06b6d4';
        ctx.strokeRect(snapPoint.x - sz / 2, snapPoint.y - sz / 2, sz, sz);
        ctx.strokeRect(snapPoint.x - sz / 4, snapPoint.y - sz / 4, sz / 2, sz / 2);
      }
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
        const r = Math.hypot(tempPoint.x - finalPoints[0].x, tempPoint.y - finalPoints[0].y);
        ctx.arc(finalPoints[0].x, finalPoints[0].y, r, 0, 2 * Math.PI);
        ctx.stroke();
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
      customValueText?: string
    ) => {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 0.1) return;

      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;
      const ny = ux;

      const dP1_offX = p1.x + nx * offset;
      const dP1_offY = p1.y + ny * offset;
      const dP2_offX = p2.x + nx * offset;
      const dP2_offY = p2.y + ny * offset;

      // Draw extension lines (faint dashed lines)
      ctx.save();
      ctx.strokeStyle = '#52525b'; // Zinc-600
      ctx.lineWidth = 1.0 / viewZoom;
      ctx.setLineDash([3 / viewZoom, 3 / viewZoom]);
      ctx.beginPath();
      // start slightly offset from vertex
      ctx.moveTo(p1.x + nx * (offset * 0.1), p1.y + ny * (offset * 0.1));
      ctx.lineTo(dP1_offX + nx * (5 / viewZoom * (offset < 0 ? -1 : 1)), dP1_offY + ny * (5 / viewZoom * (offset < 0 ? -1 : 1)));
      ctx.moveTo(p2.x + nx * (offset * 0.1), p2.y + ny * (offset * 0.1));
      ctx.lineTo(dP2_offX + nx * (5 / viewZoom * (offset < 0 ? -1 : 1)), dP2_offY + ny * (5 / viewZoom * (offset < 0 ? -1 : 1)));
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
      const midX = (dP1_offX + dP2_offX) / 2;
      const midY = (dP1_offY + dP2_offY) / 2;
      let textAngle = Math.atan2(dy, dx);
      if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
        textAngle += Math.PI;
      }

      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(textAngle);

      const valText = customValueText || `${len.toFixed(1)} mm`;
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
    if (showDims) {
      // Draw already placed dimensions for current active layer
      dimensions.forEach(d => {
        const isHighlighted = selectedDimensionId === d.id;
        drawCustomDimension(d.p1, d.p2, d.offset, isHighlighted);
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
          const dx = dimP2.x - dimP1.x;
          const dy = dimP2.y - dimP1.y;
          const len = Math.hypot(dx, dy);
          if (len > 0.001) {
            const nx = -dy / len;
            const ny = dx / len;
            const previewOffset = (hoverCoords.x - dimP1.x) * nx + (hoverCoords.y - dimP1.y) * ny;
            drawCustomDimension(dimP1, dimP2, previewOffset, true, `📐 ${len.toFixed(1)} mm`);
          }
        }
      }
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
          const polyRect = [
            { x: p1.x, y: p1.y },
            { x, y: p1.y },
            { x, y },
            { x: p1.x, y },
            { x: p1.x, y: p1.y },
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
          for (let i = 0; i <= sides; i++) {
            points.push({
              x: center.x + radius * Math.cos((i * Math.PI * 2) / sides),
              y: center.y + radius * Math.sin((i * Math.PI * 2) / sides),
              isCurvePoint: currentCommand === 'circle',
              circleData: currentCommand === 'circle' ? { center: { x: center.x, y: center.y }, radius } : undefined
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
        if (clickCount === 0) {
          setDimP1(pt);
          setClickCount(1);
          logCommandResponse(`Ölçülendirme: 1. Nokta seçildi (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}). Bitiş noktasını seçin.`);
        } else if (clickCount === 1) {
          setDimP2(pt);
          setClickCount(2);
          logCommandResponse("Ölçülendirme: 2. Nokta seçildi. Şimdi ölçü çizgisini konumlandırmak için ekranda bir yere tıklayın.");
        } else if (clickCount === 2) {
          // Calculate offset in mm
          if (dimP1 && dimP2) {
            const dx = dimP2.x - dimP1.x;
            const dy = dimP2.y - dimP1.y;
            const len = Math.hypot(dx, dy);
            let finalOffset = 20;
            if (len > 0.001) {
              const nx = -dy / len;
              const ny = dx / len;
              finalOffset = (x - dimP1.x) * nx + (y - dimP1.y) * ny;
            }
            const newDim = {
              id: Math.random().toString(36).substring(2, 9),
              p1: { ...dimP1 },
              p2: { ...dimP2 },
              offset: finalOffset,
              value: len
            };
            saveState();
            setDimensions(prev => [...prev, newDim]);
            logCommandResponse(`Ölçülendirme başarıyla eklendi! Ölçü: ${len.toFixed(1)} mm.`);
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
        const dx = d.p2.x - d.p1.x;
        const dy = d.p2.y - d.p1.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          const nx = -dy / len;
          const ny = dx / len;
          // Midpoint of dimension text placement
          const dP1_offX = d.p1.x + nx * d.offset;
          const dP1_offY = d.p1.y + ny * d.offset;
          const dP2_offX = d.p2.x + nx * d.offset;
          const dP2_offY = d.p2.y + ny * d.offset;
          const midX = (dP1_offX + dP2_offX) / 2;
          const midY = (dP1_offY + dP2_offY) / 2;

          // If click is within 15 virtual units or 18/viewZoom screen units
          if (Math.hypot(midX - x, midY - y) < Math.max(15, 18 / viewZoom)) {
            clickedDim = d;
            break;
          }
        }
      }

      if (clickedDim) {
        setSelectedDimensionId(clickedDim.id);
        const actualLen = Math.hypot(clickedDim.p2.x - clickedDim.p1.x, clickedDim.p2.y - clickedDim.p1.y);
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
              // Drag only the single clicked piece and set it as selected
              if (clickedPathIdx === -1) {
                dragItems.push({
                  type: 'finalPoints',
                  pathIdx: -1,
                  originalPoints: finalPoints.map(p => ({ ...p }))
                });
                setIsFinalPointsSelected(true);
                setSelectedPathIndices([]);
                setSelectedPathIdx(-1);
              } else {
                if (activeLayer.paths && activeLayer.paths[clickedPathIdx]) {
                  dragItems.push({
                    type: 'path',
                    pathIdx: clickedPathIdx,
                    originalPoints: activeLayer.paths[clickedPathIdx].map(p => ({ ...p }))
                  });
                  setIsFinalPointsSelected(false);
                  setSelectedPathIndices([clickedPathIdx]);
                  setSelectedPathIdx(clickedPathIdx);
                }
              }
              logCommandResponse("Taşıma (Move) Aktif: Sürükleyerek konumlandırın.");
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

      const updated = originalPoints.map((p, idx) => {
        if (idx === i || (idx === j && j < originalPoints.length)) {
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
        }
        return p;
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
      const snapData = calculateSnaps(x, y, finalPoints, isClosed, -1, smartSnap, 10 / viewZoom, activeLayer.paths, gridSnap, 50, customAnchor, snapToggles);
      x = snapData.x;
      y = snapData.y;
      setSnapPoint(snapData.snapPoint);
      setTrackedLines(snapData.trackedLines);
      setTempPoint({ x, y });
    } else {
      if (drawMode === 'drag' && dragIndexRef.current !== -1) {
        const pathIdx = dragPathIndexRef.current;

        if (pathIdx === -1) {
          // Compute snapping while dragging vertices
          const snapData = calculateSnaps(x, y, finalPoints, isClosed, dragIndexRef.current, smartSnap, 10 / viewZoom, activeLayer.paths, gridSnap, 50, customAnchor, snapToggles);
          x = snapData.x;
          y = snapData.y;
          setSnapPoint(snapData.snapPoint);
          setTrackedLines(snapData.trackedLines);

          const updated = [...finalPoints];
          updated[dragIndexRef.current] = { x, y };

          // Ensure closed chain remains closed on endpoint movements
          if (dragIndexRef.current === 0) {
            updated[updated.length - 1] = { x, y };
          }
          if (dragIndexRef.current === updated.length - 1) {
            updated[0] = { x, y };
          }
          setFinalPoints(updated);
        } else {
          // Dragging a completed path vertex
          const targetPath = activeLayer.paths ? activeLayer.paths[pathIdx] : [];
          const otherPaths = activeLayer.paths ? activeLayer.paths.filter((_, idx) => idx !== pathIdx) : [];

          const snapData = calculateSnaps(x, y, targetPath, true, dragIndexRef.current, smartSnap, 10 / viewZoom, [finalPoints, ...otherPaths], gridSnap, 50, customAnchor, snapToggles);
          x = snapData.x;
          y = snapData.y;
          setSnapPoint(snapData.snapPoint);
          setTrackedLines(snapData.trackedLines);

          const updatedPaths = activeLayer.paths ? [...activeLayer.paths] : [];
          const updatedPath = [...targetPath];
          updatedPath[dragIndexRef.current] = { x, y };

          const isClosedLoop = distance(targetPath[0], targetPath[targetPath.length - 1]) < 0.1;
          if (isClosedLoop) {
            if (dragIndexRef.current === 0) {
              updatedPath[updatedPath.length - 1] = { x, y };
            }
            if (dragIndexRef.current === updatedPath.length - 1) {
              updatedPath[0] = { x, y };
            }
          }

          updatedPaths[pathIdx] = updatedPath;
          setPaths(updatedPaths);
        }
      } else if (isDrawingRef.current && drawMode === 'freehand') {
        const last = rawPoints[rawPoints.length - 1];
        if (Math.hypot(last.x - x, last.y - y) > 5 / viewZoom) {
          setRawPoints((prev) => [...prev, { x, y }]);
        }
      } else if (drawMode === 'drag') {
        // Hover visual snapping
        const snapData = calculateSnaps(x, y, finalPoints, isClosed, -1, smartSnap, 10 / viewZoom, activeLayer.paths, gridSnap, 50, customAnchor, snapToggles);
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

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
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
    if (finalPoints.length < 2) {
      logCommandResponse('DXF Export requires at least 1 sketch segment.');
      return;
    }
    let dxf = '0\nSECTION\n2\nENTITIES\n';
    for (let i = 0; i < finalPoints.length - 1; i++) {
      dxf += `0\nLINE\n8\n0\n10\n${finalPoints[i].x.toFixed(4)}\n20\n${(-finalPoints[i].y).toFixed(4)}\n30\n0.0\n11\n${finalPoints[i + 1].x.toFixed(4)}\n21\n${(-finalPoints[i + 1].y).toFixed(4)}\n31\n0.0\n`;
    }
    dxf += '0\nENDSEC\n0\nEOF\n';

    const blob = new Blob([dxf], { type: 'application/dxf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'ZekiCAD_2D_Profile.dxf';
    link.click();
    logCommandResponse('2D Profile exported to DXF successfully.');
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

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-950 font-sans text-zinc-100 select-none">
      
      {/* 1. Upper Ribbon Bar (Actions & Quick Toolings) */}
      <header className="flex items-center gap-4 px-3 py-1.5 bg-zinc-900 border-b border-zinc-805 overflow-x-auto shrink-0">
        <div className="flex items-center gap-1.5 pr-3 border-r border-zinc-800 shrink-0">
          <Workflow className="w-4 h-4 text-blue-500" />
          <span className="text-xs font-bold tracking-wider uppercase text-zinc-200">
            Zeki <span className="text-yellow-500">CAD</span> EXEL
          </span>
          <span className="text-[9px] font-mono bg-zinc-800 border border-zinc-700 px-1 py-0.2 rounded text-zinc-400">
            v14.0
          </span>
        </div>

        {/* Sidebar Toggler */}
        <div className="flex items-center border-r border-zinc-800 pr-3 shrink-0">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-300 transition cursor-pointer font-bold font-mono"
            title={sidebarCollapsed ? "Sayısal Değerleri Göster (Show Sidebar)" : "Sayısal Değerleri Gizle (Hide Sidebar)"}
          >
            {sidebarCollapsed ? <ChevronRight className="w-3 h-3 text-amber-400" /> : <ChevronLeft className="w-3 h-3 text-amber-400" />}
            <span>Panel</span>
          </button>
        </div>

        {/* Project Files Save & Load */}
        <div className="flex items-center gap-1 border-r border-zinc-800 pr-3 shrink-0">
          <button
            onClick={saveSketchJSON}
            className="flex items-center gap-1 px-1.5 py-0.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-200 border border-zinc-750 hover:border-zinc-700 rounded text-[11px] transition cursor-pointer font-bold font-mono"
            title="Sketch dosyasını bilgisayarına kaydet (.json)"
          >
            <Save className="w-3 h-3 text-blue-400" />
            <span>Kaydet</span>
          </button>
          <label
            className="flex items-center gap-1 px-1.5 py-0.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-200 border border-zinc-750 hover:border-zinc-700 rounded text-[11px] transition cursor-pointer font-bold font-mono"
            title="Daha önce kaydettiğin sketch dosyasını yükle"
          >
            <Upload className="w-3 h-3 text-emerald-400" />
            <span>Yükle</span>
            <input
              type="file"
              accept=".json"
              onChange={loadSketchJSON}
              className="hidden"
            />
          </label>
        </div>

        {/* Draw Tools */}
        <div className="flex items-center gap-1 border-r border-zinc-800 pr-3 shrink-0">
          <span className="text-[10px] uppercase font-mono text-zinc-500 mr-1">Draw:</span>
          <button
            onClick={() => setCommand('line')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'line' ? 'bg-blue-600/30 border-blue-500 text-blue-400 font-bold' : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Line (L)"
          >
            <PenTool className="w-3 h-3" />
            <span>Line</span>
          </button>
          <button
            onClick={() => setCommand('rect')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'rect' ? 'bg-blue-600/30 border-blue-500 text-blue-400 font-bold' : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Rectangle (R)"
          >
            <Square className="w-3 h-3" />
            <span>Rect</span>
          </button>
          <button
            onClick={() => setCommand('circle')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'circle' ? 'bg-blue-600/30 border-blue-500 text-blue-400 font-bold' : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Circle (C)"
          >
            <Circle className="w-3 h-3" />
            <span>Circle</span>
          </button>
          <button
            onClick={() => setCommand('polygon')}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'polygon' ? 'bg-blue-600/30 border-blue-500 text-blue-400 font-bold' : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
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
              logCommandResponse("Akıllı Ölçülendirme ve Konumlandırma aktif. Ölçülendirmek istediğiniz ilk noktayı seçin.");
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'dimension' ? 'bg-pink-600/30 border-pink-500 text-pink-400 font-bold' : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Akıllı Ölçülendirme ve Konumlandırma (DIM) - Çizim noktalarını seçip konumlandırın"
          >
            <Ruler className="w-3 h-3 text-pink-400" />
            <span>Ölçülendir</span>
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
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-emerald-600/25 border border-emerald-500/50 text-emerald-400 hover:bg-emerald-600 hover:text-white transition font-mono font-bold animate-pulse cursor-pointer"
              title="Save active path to layer paths database"
            >
              <CheckCircle className="w-3 h-3 text-emerald-400" />
              <span>Finish Shape</span>
            </button>
          )}
        </div>

        {/* Dynamic Draw Mode / Operations Switcher */}
        <div className="flex items-center gap-1 border-r border-zinc-800 pr-3 shrink-0 font-sans">
          <span className="text-[10px] uppercase font-mono text-zinc-500 mr-1">Mode:</span>
          <button
            onClick={() => {
              clearCommand();
              setDrawMode('freehand');
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              drawMode === 'freehand' ? 'bg-orange-600/25 border-orange-500 text-orange-400 font-bold' : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
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
              drawMode === 'point' ? 'bg-orange-600/25 border-orange-500 text-orange-400 font-bold' : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Point Entry"
          >
            <span>📐 Point</span>
          </button>
          <button
            onClick={() => {
              clearCommand();
              setDrawMode('drag');
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              drawMode === 'drag' ? 'bg-orange-600/25 border-orange-500 text-orange-400 font-bold' : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Vertex Edit & Drag"
          >
            <span>👆 Edit Vertex</span>
          </button>
        </div>

        {/* Modifiers */}
        <div className="flex items-center gap-1 border-r border-zinc-800 pr-3 shrink-0">
          <span className="text-[10px] uppercase font-mono text-zinc-500 mr-1">Modify:</span>
          <button
            onClick={() => applyFillet()}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:text-white transition font-mono font-bold"
            title="Apply Fillet Rounding (F)"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Fillet</span>
          </button>
          <button
            onClick={() => applyChamfer()}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:text-white transition font-mono font-bold"
            title="Apply Chamfer (CH)"
          >
            <ListFilter className="w-3 h-3 text-red-400" />
            <span>Chamfer</span>
          </button>
          <button
            onClick={() => {
              clearCommand();
              setCurrentCommand('trim');
              logCommandResponse("TRIM mode activated. Click on any segment to trim it between intersections.");
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'trim' ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Trim segment (Makas Budama)"
          >
            <Trash2 className="w-3 h-3 text-red-400" />
            <span>Trim</span>
          </button>
          <button
            onClick={() => {
              clearCommand();
              setCurrentCommand('extend');
              logCommandResponse("EXTEND mode activated. Click near an open endpoint to extend it to the next intersection.");
            }}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition border font-mono ${
              currentCommand === 'extend' ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700'
            }`}
            title="Extend segment (Uzatma)"
          >
            <Maximize className="w-3 h-3 text-cyan-400" />
            <span>Extend</span>
          </button>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-amber-600/15 border border-amber-850 hover:bg-amber-600/25 text-amber-400 transition font-mono"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-3 h-3" />
            <span>Undo</span>
          </button>
        </div>

        {/* Snap Select Toggles */}
        <div className="flex items-center gap-1 border-r border-zinc-800 pr-3 shrink-0 font-mono text-[10px]">
          <span className="text-[10px] uppercase text-zinc-500 mr-1.5">Snaps:</span>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, origin: !prev.origin }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.origin ? 'bg-emerald-600/25 border-emerald-500 text-emerald-300' : 'bg-zinc-850 border-zinc-750 text-zinc-400 hover:bg-zinc-800'
            }`}
            title="Origin Snap (Orijine Kenetlen)"
          >
            Origin
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, end: !prev.end }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.end ? 'bg-emerald-600/25 border-emerald-500 text-emerald-300' : 'bg-zinc-850 border-zinc-750 text-zinc-400 hover:bg-zinc-800'
            }`}
            title="Endpoint Snap (Uç Noktası)"
          >
            End
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, mid: !prev.mid }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.mid ? 'bg-emerald-600/25 border-emerald-500 text-emerald-300' : 'bg-zinc-850 border-zinc-750 text-zinc-400 hover:bg-zinc-800'
            }`}
            title="Midpoint Snap (Orta Nokta)"
          >
            Mid
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, int: !prev.int }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.int ? 'bg-emerald-600/25 border-emerald-500 text-emerald-300' : 'bg-zinc-850 border-zinc-750 text-zinc-400 hover:bg-zinc-800'
            }`}
            title="Intersection Snap (Kesişim)"
          >
            Int
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, tan: !prev.tan }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.tan ? 'bg-emerald-600/25 border-emerald-500 text-emerald-300' : 'bg-zinc-850 border-zinc-750 text-zinc-400 hover:bg-zinc-800'
            }`}
            title="Tangent Snap (Daire Teğetleri)"
          >
            Tan
          </button>
          <button
            onClick={() => setSnapToggles(prev => ({ ...prev, quad: !prev.quad }))}
            className={`px-1.5 py-0.5 rounded border text-[10px] transition font-bold ${
              snapToggles.quad ? 'bg-emerald-600/25 border-emerald-500 text-emerald-300' : 'bg-zinc-850 border-zinc-750 text-zinc-400 hover:bg-zinc-800'
            }`}
            title="Quadrant Snap (Çeyrek Daire)"
          >
            Quad
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
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-300 transition font-mono"
            title="Reset Zoom & Pan View"
          >
            <Maximize className="w-3 h-3 text-emerald-400" />
            <span>Fit</span>
          </button>
          <button
            onClick={handleClearAll}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-rose-600/20 border border-rose-900 text-rose-300 hover:bg-rose-600/30 transition font-mono"
            title="Wipe canvas clean"
          >
            <Trash2 className="w-3 h-3" />
            <span>Wipe</span>
          </button>
        </div>
      </header>

      {/* Main CAD Workspace Layout */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* 2. Side Panel Controllers */}
        <aside className={`bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-y-auto shrink-0 transition-all duration-200 overflow-hidden ${sidebarCollapsed ? 'w-0 border-r-0 pb-0' : 'w-[260px]'}`}>
          
          {/* Section A: Active Sketch Sandbox */}
          <div className="p-4 border-b border-zinc-800">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 mb-3">
              <Activity className="w-4 h-4 text-emerald-400" />
              1. Sketch Toolbox
            </h2>

            <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs p-1.5 rounded hover:bg-zinc-900 transition font-mono">
                <input
                  type="radio"
                  name="editMode"
                  checked={drawMode === 'freehand'}
                  onChange={() => {
                    clearCommand();
                    setDrawMode('freehand');
                  }}
                  className="rounded text-blue-500 focus:ring-0"
                />
                <span className="text-zinc-300">✏️ Freehand Draw</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs p-1.5 rounded hover:bg-zinc-900 transition font-mono">
                <input
                  type="radio"
                  name="editMode"
                  checked={drawMode === 'point'}
                  onChange={() => {
                    clearCommand();
                    setDrawMode('point');
                  }}
                  className="rounded text-blue-500 focus:ring-0"
                />
                <span className="text-zinc-300">📐 Point Entry</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs p-1.5 rounded hover:bg-zinc-900 transition font-mono">
                <input
                  type="radio"
                  name="editMode"
                  checked={drawMode === 'drag'}
                  onChange={() => {
                    clearCommand();
                    setDrawMode('drag');
                  }}
                  className="rounded text-blue-500 focus:ring-0"
                />
                <span className="text-zinc-300">👆 Vertex Edit & Drag</span>
              </label>
            </div>

            {/* Fillet & Chamfer Controls */}
            <div className="mt-3 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 space-y-2.5">
              <span className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase font-mono block">Modifier Parameters</span>
              
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                  <span>Fillet Radius (r):</span>
                  <span className="text-emerald-400 font-bold">{filletRadius} mm</span>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={filletRadius}
                    onChange={(e) => setFilletRadius(Math.max(1, parseInt(e.target.value) || 1))}
                    className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 text-xs px-2 py-1 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                    min="1"
                    max="500"
                  />
                  <button
                    onClick={() => applyFillet(filletRadius)}
                    className="px-2.5 py-1 bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600 hover:text-white rounded text-xs transition cursor-pointer text-emerald-400 font-bold font-mono"
                    title="Apply Fillet to corners with custom radius"
                  >
                    Fillet
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                  <span>Chamfer Distance (d):</span>
                  <span className="text-red-400 font-bold">{chamferDistance} mm</span>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={chamferDistance}
                    onChange={(e) => setChamferDistance(Math.max(1, parseInt(e.target.value) || 1))}
                    className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 text-xs px-2 py-1 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                    min="1"
                    max="500"
                  />
                  <button
                    onClick={() => applyChamfer(chamferDistance)}
                    className="px-2.5 py-1 bg-rose-600/20 border border-rose-500/40 hover:bg-rose-600 hover:text-white rounded text-xs transition cursor-pointer text-red-400 font-bold font-mono"
                    title="Apply Chamfer (Pah) with custom distance"
                  >
                    Chamfer
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                  <span>Offset Distance (offset):</span>
                  <span className="text-indigo-400 font-bold">{offsetDistance} mm</span>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={offsetDistance}
                    onChange={(e) => setOffsetDistance(Math.max(1, parseInt(e.target.value) || 1))}
                    className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 text-xs px-2 py-1 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                    min="1"
                    max="500"
                  />
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => applyOffset(-offsetDistance)}
                      className="px-2.5 py-1 bg-indigo-600/20 border border-indigo-500/40 hover:bg-indigo-600 hover:text-white rounded text-xs transition cursor-pointer text-indigo-400 font-bold font-mono"
                      title="Offset Inward"
                    >
                      In
                    </button>
                    <button
                      onClick={() => applyOffset(offsetDistance)}
                      className="px-2.5 py-1 bg-indigo-600/20 border border-indigo-500/40 hover:bg-indigo-600 hover:text-white rounded text-xs transition cursor-pointer text-indigo-400 font-bold font-mono"
                      title="Offset Outward"
                    >
                      Out
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-3 bg-zinc-950/50 p-3 rounded-lg border border-zinc-800/80 text-[10px] space-y-1.5 font-mono text-zinc-500">
              <p className="text-yellow-600/90 font-bold">PRO-TIPS & SHORTS:</p>
              <p>• <span className="text-zinc-400">Double-Click</span> segment to insert new vertex node (midpoint snap included).</p>
              <p>• <span className="text-zinc-400">Right-Click</span> context closes geometric loop automatically.</p>
              <p>• Drag vertices to update live distances and check matching angles.</p>
            </div>
          </div>

          {/* Section B: Parametric Dimension Constraints & Location (Ölçülendirme ve Konumlandırma) */}
          <div className="p-4 border-b border-zinc-800 flex flex-col shrink-0">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 mb-2.5">
              <Ruler className="w-4 h-4 text-rose-400" />
              2. Dimensions & Coordinates
            </h2>

            {selectedVertexIdx === null ? (
              <div className="space-y-3">
                <div className="bg-zinc-950/40 border border-zinc-850 p-3 rounded-lg text-[10px] text-zinc-500 font-sans leading-relaxed">
                  <p className="font-semibold text-zinc-400 mb-1">💡 Parametrik Konumlandırma & 3D Boolean:</p>
                  Vertex Düzenleme modunda (Vertex Edit & Drag) bir noktanın üzerine tıklayarak koordinatlarını veya bağlı çizgilerin uzunluklarını buradaki kutulardan milimetrik ve hassas olarak değiştirebilirsiniz. Dairelerin yarıçap ve merkezlerini de buradan ayarlayabilirsiniz.
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
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-850/80 space-y-3 font-sans">
                  {/* Selected label */}
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 border-b border-zinc-850 pb-2 mb-1">
                    <span>Selected Vector Pt:</span>
                    <span className="text-blue-400 font-bold">Node #{selectedVertexIdx}</span>
                  </div>

                  {isCircle && circleData ? (
                    /* Circle specific dimension inputs */
                    <div className="space-y-3">
                      <div className="text-[10px] font-bold tracking-wider text-rose-400 uppercase font-mono">
                        Daire Parametreleri (Circle)
                      </div>
                      
                      {/* Radius */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-zinc-400 block font-mono">Yarıçap (R):</span>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="any"
                            value={parseFloat(circleData.radius.toFixed(2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v > 0) handleUpdateCircleRadius(v);
                            }}
                            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-805 text-xs px-2 py-1.5 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                          />
                          <span className="text-[10px] font-mono self-center text-zinc-500 font-bold">mm</span>
                        </div>
                      </div>

                      {/* Center X */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-zinc-400 block font-mono">Merkez X (Cx):</span>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="any"
                            value={parseFloat(circleData.center.x.toFixed(2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) handleUpdateCircleCenter(v, circleData.center.y);
                            }}
                            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-805 text-xs px-2 py-1.5 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                          />
                          <span className="text-[10px] font-mono self-center text-zinc-500 font-bold">mm</span>
                        </div>
                      </div>

                      {/* Center Y */}
                      <div className="space-y-1">
                        <span className="text-[10px] text-zinc-400 block font-mono">Merkez Y (Cy):</span>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="any"
                            value={parseFloat(circleData.center.y.toFixed(2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) handleUpdateCircleCenter(circleData.center.x, v);
                            }}
                            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-805 text-xs px-2 py-1.5 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                          />
                          <span className="text-[10px] font-mono self-center text-zinc-500 font-bold">mm</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* General segment path inputs */
                    <div className="space-y-3">
                      <div className="text-[10px] font-bold tracking-wider text-rose-400 uppercase font-mono">
                        Nokta Koordinatları (Vertex)
                      </div>

                      {/* Direct Absolute Coordinates */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] text-zinc-500 block font-mono">Pozisyon X:</span>
                          <input
                            type="number"
                            step="any"
                            value={parseFloat(current.x.toFixed(2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) updateVertexCoords(v, current.y);
                            }}
                            className="w-full bg-zinc-900 border border-zinc-805 text-xs px-2 py-1 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] text-zinc-500 block font-mono">Pozisyon Y:</span>
                          <input
                            type="number"
                            step="any"
                            value={parseFloat(current.y.toFixed(2))}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) updateVertexCoords(current.x, v);
                            }}
                            className="w-full bg-zinc-900 border border-zinc-805 text-xs px-2 py-1 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                          />
                        </div>
                      </div>

                      <div className="text-[10px] font-bold tracking-wider text-teal-400 uppercase font-mono pt-1.5 border-t border-zinc-900">
                        Bağlı Çizgi Uzunlukları
                      </div>

                      {/* L1 Length (to previous) */}
                      {d1 !== null && (
                        <div className="space-y-1">
                          <span className="text-[10px] text-zinc-400 block font-mono">Önceki Çizgi Boyu (L1):</span>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              step="any"
                              value={parseFloat(d1.toFixed(2))}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v) && v > 0) updateSegmentLength('prev', v);
                              }}
                              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-805 text-xs px-2 py-1 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                            />
                            <span className="text-[10px] font-mono self-center text-zinc-500 font-bold">mm</span>
                          </div>
                        </div>
                      )}

                      {/* L2 Length (to next) */}
                      {d2 !== null && (
                        <div className="space-y-1">
                          <span className="text-[10px] text-zinc-400 block font-mono">Sonraki Çizgi Boyu (L2):</span>
                          <div className="flex gap-2">
                            <input
                              type="number"
                              step="any"
                              value={parseFloat(d2.toFixed(2))}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                if (!isNaN(v) && v > 0) updateSegmentLength('next', v);
                              }}
                              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-805 text-xs px-2 py-1 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                            />
                            <span className="text-[10px] font-mono self-center text-zinc-500 font-bold">mm</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                   {/* Coordinate Reference Placement panel */}
                  <div className="pt-2.5 border-t border-zinc-850 space-y-2">
                    <div className="text-[10px] font-bold tracking-wider text-rose-500 uppercase font-mono flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                      CAD Referans Konumlandırma
                    </div>
                    <p className="text-[9px] text-zinc-500 leading-normal">
                      Seçili noktayı referans alarak bütün sketch'i X/Y koordinat sistemine yerleştirin:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <span className="text-[9px] text-zinc-400 block font-mono">Hedef X (Mod):</span>
                        <input
                          type="number"
                          step="any"
                          value={alignTargetX}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setAlignTargetX(isNaN(val) ? 0 : val);
                          }}
                          className="w-full bg-zinc-900 border border-zinc-805 text-xs px-2 py-1 rounded text-zinc-200 outline-none focus:border-red-500 font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] text-zinc-400 block font-mono">Hedef Y (Düşey):</span>
                        <input
                          type="number"
                          step="any"
                          value={alignTargetY}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setAlignTargetY(isNaN(val) ? 0 : val);
                          }}
                          className="w-full bg-zinc-900 border border-zinc-805 text-xs px-2 py-1 rounded text-zinc-200 outline-none focus:border-emerald-500 font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex gap-1.5 pt-1">
                      <button
                        onClick={() => alignEntireSketchBySelectedVertex(0, 0)}
                        className="flex-1 py-1.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-[9px] text-zinc-300 hover:text-white rounded font-mono font-bold transition cursor-pointer text-center"
                        title="Seçili noktayı doğrudan mutlak (0,0) orijinal merkezine taşır"
                      >
                        Orijine Sıfırla (0,0)
                      </button>
                      <button
                        onClick={() => alignEntireSketchBySelectedVertex(alignTargetX, alignTargetY)}
                        className="flex-1 py-1.5 bg-blue-600/30 hover:bg-blue-600 border border-blue-500/55 text-[9px] text-blue-200 hover:text-white rounded font-mono font-bold transition cursor-pointer text-center"
                        title="Tüm skeçi seçili nokta o koordinatlara gelecek şekilde öteler"
                      >
                        Hizala & Taşı
                      </button>
                    </div>
                  </div>

                  {/* Deselect button */}
                  {renderShapeSolidSettings()}
                  <button
                    onClick={() => {
                      setSelectedVertexIdx(null);
                      setSelectedPathIdx(-1);
                    }}
                    className="w-full mt-2 py-1.5 bg-zinc-850 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-[10px] text-zinc-300 rounded font-mono font-bold transition cursor-pointer"
                  >
                    Seçimi Kaldır
                  </button>
                </div>
              );
            })()}
          </div>

          {/* Section B: Layer Manager */}
          <div className="p-4 border-b border-zinc-800 flex flex-col shrink-0">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between mb-3">
              <span className="flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-cyan-400" />
                2. Layer Manager
              </span>
              <button
                onClick={addNewLayer}
                className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-600/30 border border-blue-500/50 text-blue-350 hover:bg-blue-600 transition flex items-center gap-1 cursor-pointer"
                title="Create a new draft CAD Layer"
              >
                <Plus className="w-3 h-3" />
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
                        ? 'bg-zinc-850/80 border-blue-500/70 shadow-[0_0_8px_rgba(59,130,246,0.06)]'
                        : 'bg-zinc-950/40 border-zinc-850/60 hover:bg-zinc-900/50'
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
                        className="rounded-full w-3 h-3 text-blue-500 bg-zinc-900 border-zinc-700 cursor-pointer focus:ring-0 shrink-0 accent-blue-500"
                      />
                      <input
                        type="text"
                        value={layer.name}
                        onChange={(e) => updateLayerProps(layer.id, { name: e.target.value })}
                        className={`text-xs bg-transparent border-0 outline-none font-semibold font-mono p-0 min-w-0 max-w-[120px] flex-1 truncate ${
                          isActive ? 'text-blue-400' : 'text-zinc-300 hover:bg-zinc-900/50 focus:bg-zinc-900/90 focus:px-1 rounded'
                        }`}
                        title="Click to rename this layer"
                      />
                    </div>

                    {/* Layer Action Controls Right Section */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Color Palette Input Wrapper */}
                      <div className="relative w-4 h-4 rounded cursor-pointer shrink-0 border border-zinc-700/50" style={{ backgroundColor: layer.color }} title="Change layer custom color">
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
                        className={`p-1 rounded hover:bg-zinc-800 transition shrink-0 ${
                          layer.visible ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-700 hover:text-zinc-500'
                        }`}
                        title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                      >
                        {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>

                      {/* Locked/Unlocked Toggles */}
                      <button
                        onClick={() => toggleLayerLock(layer.id)}
                        className={`p-1 rounded hover:bg-zinc-800 transition shrink-0 ${
                          layer.locked ? 'text-amber-500 hover:text-amber-400' : 'text-zinc-600 hover:text-zinc-400'
                        }`}
                        title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
                      >
                        {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                      </button>

                      {/* Trash Button */}
                      {layers.length > 1 && (
                        <button
                          onClick={() => deleteLayer(layer.id)}
                          className="p-1 rounded text-zinc-600 hover:text-rose-450 hover:bg-rose-500/10 transition shrink-0"
                          title="Delete CAD Layer"
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
            <div className="mt-1.5 text-[9px] font-mono text-zinc-500/80 leading-tight text-center">
              * Hidden layers are bypassed from the 3D generation *
            </div>
          </div>

          {/* Section B-2: CAD Core Edit Actions (CAD Düzenleme Menüsü) */}
          <div className="p-4 border-b border-zinc-800 space-y-3 shrink-0">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-orange-400">
                <Scissors className="w-4 h-4 text-orange-450 animate-pulse" />
                <span>3. CAD Edit & Modify</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-905 px-1.5 py-0.5 rounded border border-zinc-850">
                PRO TOOLKIT
              </span>
            </h2>

            {/* Current Selection Status Banner */}
            <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-850 text-left space-y-1">
              <div className="text-[9px] font-mono font-bold uppercase text-zinc-500">
                SEÇİM DURUMU (SELECTION)
              </div>
              {isFinalPointsSelected || selectedPathIndices.length > 0 ? (
                <div className="text-xs font-semibold text-orange-400 flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse" />
                  <span>
                    {isFinalPointsSelected ? "Aktif Poligon" : ""}
                    {isFinalPointsSelected && selectedPathIndices.length > 0 ? " ve " : ""}
                    {selectedPathIndices.length > 0 ? `${selectedPathIndices.length} adet Şekil` : ""} Seçili!
                  </span>
                </div>
              ) : (
                <div className="text-xs text-zinc-500 italic leading-snug">
                  Seçili nesne yok. Nesneyi seçip kopyalamak, silmek, döndürmek veya ölçeklemek için üzerine tıklayın ya da sağ tıklayıp kutu içine alın. (Del tuşu siler)
                </div>
              )}
            </div>

            {/* Editing Controls Grid */}
            <div className="space-y-3">
              {/* Row 1: Copy, Paste, Duplicate and Delete */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleCopy}
                  className="py-2 bg-indigo-650 hover:bg-indigo-550 border border-indigo-600 rounded text-xs font-bold font-mono text-indigo-100 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  title="Seçili tüm nesneleri panoya kopyalar (Ctrl + C)"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Kopyala (Ctrl+C)
                </button>
                <button
                  onClick={handlePaste}
                  className="py-2 bg-emerald-700 hover:bg-emerald-650 border border-emerald-600 rounded text-xs font-bold font-mono text-emerald-100 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  title="Kopyalanmış nesneleri mouse imlecinin olduğu yere yapıştırır (Ctrl + V)"
                >
                  <Clipboard className="w-3.5 h-3.5 text-emerald-300" />
                  Yapıştır (Ctrl+V)
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={applyCadEditCopy}
                  className="py-2 bg-cyan-750 hover:bg-cyan-650 border border-cyan-700 rounded text-xs font-bold font-mono text-cyan-100 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  title="Seçili tüm nesneleri hemen yanına çoğaltır (Ctrl + D)"
                >
                  <Copy className="w-3.5 h-3.5 opacity-60" />
                  Çoğalt (Ctrl+D)
                </button>
                <button
                  onClick={applyCadEditDelete}
                  className="py-2 bg-rose-950/45 hover:bg-rose-900/80 border border-rose-900 rounded text-xs font-bold font-mono text-rose-200 flex items-center justify-center gap-1.5 transition cursor-pointer"
                  title="Seçili tüm nesneleri temizler (Delete / Backspace)"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  Sil (Delete)
                </button>
              </div>

              {/* Row 2: Mirror / Aynala (Horiz & Vert) */}
              <div className="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-850 space-y-1.5">
                <span className="text-[10px] text-zinc-400 font-mono font-bold flex items-center gap-1">
                  <FlipHorizontal className="w-3 h-3 text-cyan-400" />
                  🪞 CAD AYNALAMA (MIRROR)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => applyCadEditMirror('Y')}
                    className="py-1.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded font-mono text-[9px] font-bold text-zinc-200 hover:text-white transition cursor-pointer text-center"
                    title="Yatay eksene göre simetriğini alır"
                  >
                    ↔ Yatay Aynala
                  </button>
                  <button
                    onClick={() => applyCadEditMirror('X')}
                    className="py-1.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded font-mono text-[9px] font-bold text-zinc-200 hover:text-white transition cursor-pointer text-center"
                    title="Düşey eksene göre simetriğini alır"
                  >
                    ↕ Dikey Aynala
                  </button>
                </div>
              </div>

              {/* Row 3: Rotation Engine */}
              <div className="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-850 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-zinc-400 font-mono font-bold flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 text-amber-500 animate-spin-slow" />
                    🔄 DÖNDÜRME (ROTATE)
                  </span>
                  <span className="text-[9px] text-zinc-500 font-mono">Derece (°)</span>
                </div>
                {/* Degree Presets */}
                <div className="grid grid-cols-5 gap-1">
                  {[-90, -45, 45, 90, 180].map((deg) => (
                    <button
                      key={deg}
                      onClick={() => applyCadEditRotate(deg)}
                      className="py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 rounded text-[9px] font-bold font-mono text-zinc-400 hover:text-white transition cursor-pointer"
                    >
                      {deg > 0 ? `+${deg}` : deg}°
                    </button>
                  ))}
                </div>
                {/* Arbitrary rotation input */}
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={cadRotateAngle}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setCadRotateAngle(isNaN(val) ? 0 : val);
                    }}
                    placeholder="45"
                    className="w-16 bg-zinc-900 border border-zinc-800 rounded text-center text-xs text-white font-mono outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={() => applyCadEditRotate(cadRotateAngle)}
                    className="flex-1 py-1 bg-amber-600/20 hover:bg-amber-600 border border-amber-500 rounded text-[10px] font-bold font-mono text-amber-300 hover:text-white transition cursor-pointer"
                  >
                    Özel Açıyla Döndür
                  </button>
                </div>
              </div>

              {/* Row 4: Scaling Engine */}
              <div className="bg-zinc-950/60 p-2.5 rounded-lg border border-zinc-850 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-zinc-400 font-mono font-bold flex items-center gap-1">
                    <Maximize className="w-3 h-3 text-emerald-500" />
                    📐 BOYUTLANDIR & ÖLÇEKLE (SCALE)
                  </span>
                  <span className="text-[9px] text-zinc-500 font-mono">Oran (x)</span>
                </div>
                {/* Scale Presets */}
                <div className="grid grid-cols-5 gap-1">
                  {[0.5, 0.75, 1.25, 1.5, 2.0].map((fac) => (
                    <button
                      key={fac}
                      onClick={() => applyCadEditScale(fac)}
                      className="py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-850 rounded text-[9px] font-bold font-mono text-zinc-400 hover:text-white transition cursor-pointer"
                    >
                      {fac}x
                    </button>
                  ))}
                </div>
                {/* Custom Scale Input */}
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.05"
                    value={cadScaleFactor}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setCadScaleFactor(isNaN(val) ? 1.0 : val);
                    }}
                    placeholder="1.2"
                    className="w-16 bg-zinc-900 border border-zinc-800 rounded text-center text-xs text-white font-mono outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={() => applyCadEditScale(cadScaleFactor)}
                    className="flex-1 py-1 bg-emerald-600/20 hover:bg-emerald-500 border border-emerald-500 rounded text-[10px] font-bold font-mono text-emerald-300 hover:text-white transition cursor-pointer"
                  >
                    Özel Oranda Ölçekle
                  </button>
                </div>
              </div>

              {/* Advanced info label inside Edit module */}
              <div className="text-[9px] font-mono text-zinc-500 leading-normal pl-1 border-l border-zinc-800">
                💡 **CAD İpucu:** Eğer yeşil/mavi renkteki **Özel Referans Noktasını (Anchor Point)** belirlerseniz; Aynalama, Döndürme ve Ölçeklendirme işlemleri o referans noktasını merkez alarak gerçekleşir! Özel referans noktası yoksa şeklin kendi merkezi baz alınır.
              </div>
            </div>
          </div>

          {/* Section C: References & AI Optimization */}
          <div className="p-4 border-b border-zinc-800 space-y-4 shrink-0">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-yellow-400 animate-pulse" />
              3. AI Opt & Reference
            </h2>

            {/* AI Refine button */}
            <button
              onClick={runDouglasPeucker}
              disabled={rawPoints.length < 3}
              className={`w-full py-2 px-3 rounded text-xs font-bold flex items-center justify-center gap-2 transition border ${
                rawPoints.length >= 3
                  ? 'bg-gradient-to-r from-yellow-500 to-amber-600 text-zinc-950 border-yellow-400 hover:scale-105 active:scale-95 cursor-pointer'
                  : 'bg-zinc-800 text-zinc-600 border-zinc-700 cursor-not-allowed'
              }`}
            >
              <Flame className="w-4 h-4" />
              <span>AI Refine Sketch</span>
            </button>

            {/* Backplane reference image config */}
            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-400 font-mono">Technical Design BG</span>
                <ImageIcon className="w-4 h-4 text-zinc-500" />
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={handleBgImageUpload}
                className="block w-full text-xs text-zinc-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[11px] file:font-semibold file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700"
              />
              {bgImage && (
                <div className="space-y-1.5 pt-1 border-t border-zinc-800">
                  <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500">
                    <span>Opacity: {Math.round(bgOpacity * 100)}%</span>
                    <button onClick={removeBgImage} className="text-rose-400 hover:underline">
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
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>
              )}
            </div>

            {/* Snapping parameters & Ortho toggles */}
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-zinc-950 p-2 rounded border border-zinc-800">
                <span className="text-xs text-zinc-400 font-mono">🎯 Smart Snaps (F9)</span>
                <input
                  type="checkbox"
                  checked={smartSnap}
                  onChange={(e) => setSmartSnap(e.target.checked)}
                  className="rounded text-emerald-500 focus:ring-0 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between bg-zinc-950 p-2 rounded border border-zinc-800">
                <span className="text-xs text-zinc-400 font-mono">🧱 Izgara Snap (Grid Lock)</span>
                <input
                  type="checkbox"
                  checked={gridSnap}
                  onChange={(e) => setGridSnap(e.target.checked)}
                  className="rounded text-emerald-500 focus:ring-0 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between bg-zinc-950 p-2 rounded border border-zinc-800">
                <span className="text-xs text-zinc-400 font-mono">🔒 Ortho Snap (F8)</span>
                <input
                  type="checkbox"
                  checked={orthoSnap}
                  onChange={(e) => setOrthoSnap(e.target.checked)}
                  className="rounded text-emerald-500 focus:ring-0 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between bg-zinc-950 p-2 rounded border border-zinc-800">
                <span className="text-xs text-zinc-400 font-mono">📐 Uzunluk Ölçüleri</span>
                <input
                  type="checkbox"
                  checked={showDims}
                  onChange={(e) => setShowDims(e.target.checked)}
                  className="rounded text-emerald-500 focus:ring-0 cursor-pointer"
                />
              </div>

              {/* Advanced Anchor Selector */}
              <div className="bg-zinc-950 p-2.5 rounded border border-zinc-800 space-y-2 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400 font-mono font-bold uppercase flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-cyan-400 animate-pulse" />
                    📍 Özel Referans Noktası
                  </span>
                  {customAnchor && (
                    <button
                      onClick={() => setCustomAnchor(null)}
                      className="text-[9px] text-rose-400 hover:text-rose-300 font-mono px-1 rounded bg-rose-950/45 border border-rose-900/40 cursor-pointer"
                    >
                      Sil
                    </button>
                  )}
                </div>
                {customAnchor ? (
                  <div className="text-[11px] bg-cyan-950/20 border border-cyan-800/50 p-1.5 rounded text-cyan-300 font-mono flex justify-between items-center">
                    <span>X: {customAnchor.x.toFixed(1)} mm, Y: {customAnchor.y.toFixed(1)} mm</span>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setAnchorSelectMode(true);
                      logCommandResponse("Herhangi bir boşluğa tıklayarak veya mevcut bir çizgi noktasına tıklayarak özel referans noktası (Anchor) seçin.");
                    }}
                    className={`w-full py-1 rounded text-[10px] font-mono font-bold border transition cursor-pointer text-center ${
                      anchorSelectMode
                        ? 'bg-amber-600/30 border-amber-500 text-amber-200 animate-pulse'
                        : 'bg-zinc-900 hover:bg-zinc-850 border-zinc-800 text-zinc-300 hover:text-white'
                    }`}
                  >
                    {anchorSelectMode ? 'Ekrana Tıkla...' : 'Özel Referans Noktası Belirle'}
                  </button>
                )}
                <p className="text-[9px] text-zinc-500 leading-normal">
                  Origin (0,0) her zaman otomatiktir. Yukarıdaki butona tıklayıp ekrandan özel bir referans noktası belirlerseniz, o koordinat da yeşil/mavi CAD sembolüyle yakalanabilir hale gelir.
                </p>
              </div>
            </div>
          </div>

          {/* Section D: Real-time Parametric Dimensions Tables */}
          <div className="p-4 border-b border-zinc-800 flex-1 min-h-[180px] flex flex-col">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 mb-3">
              <MousePointer2 className="w-4 h-4 text-blue-400" />
              4. Parametric Constraints
            </h2>

            {finalPoints.length < 2 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-4 rounded-lg bg-zinc-950 border border-zinc-850/80 text-center">
                <HelpCircle className="w-8 h-8 text-zinc-600 mb-2 animate-pulse" />
                <p className="text-xs text-zinc-500 font-mono">No sketch segments loaded yet.</p>
              </div>
            ) : (
              <div className="flex-1 max-h-[250px] overflow-y-auto space-y-1.5 pr-1">
                <div className="grid grid-cols-12 text-[10px] font-mono text-zinc-500 pb-1 border-b border-zinc-800">
                  <span className="col-span-3">SEG</span>
                  <span className="col-span-5 text-center">LENGTH (mm)</span>
                  <span className="col-span-4 text-right">ANGLE (°)</span>
                </div>
                {finalPoints.slice(0, -1).map((p, idx) => {
                  const p2 = finalPoints[idx + 1];
                  const len = distance(p, p2);
                  let ang = Math.atan2(-(p2.y - p.y), p2.x - p.x) * (180 / Math.PI);
                  if (ang < 0) ang += 360;

                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-1.5 items-center bg-zinc-950 p-1.5 rounded border border-zinc-850"
                    >
                      <span className="col-span-3 text-xs font-bold text-blue-400 font-mono">K-{idx + 1}</span>
                      <input
                        type="number"
                        className="col-span-5 bg-zinc-900 text-white text-xs border border-zinc-800 focus:border-blue-500 outline-none text-center px-1 rounded"
                        value={parseFloat(len.toFixed(1))}
                        onChange={(e) => updatePointsFromTable(idx, parseFloat(e.target.value) || 2.0, ang)}
                        step="1"
                        min="1"
                      />
                      <input
                        type="number"
                        className="col-span-4 bg-zinc-900 text-white text-xs border border-zinc-800 focus:border-blue-500 outline-none text-right px-1 rounded"
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

          {/* Section D: 3D Materializing & Exports */}
          <div className="p-4 bg-zinc-950 border-t border-zinc-800 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-blue-500" />
              5. 3D Model & Export
            </h2>

            <div className="space-y-2">
              <div>
                <label className="block text-[10px] font-mono text-zinc-500 mb-1">Process Type:</label>
                <select
                  value={opType}
                  onChange={(e) => setOpType(e.target.value as 'extrude' | 'revolve')}
                  className="w-full bg-zinc-900 border border-zinc-800 text-xs px-2.5 py-1.5 rounded text-zinc-200 outline-none focus:border-blue-500"
                >
                  <option value="extrude">Katılaştır (Extrude)</option>
                  <option value="revolve">Döndür (Revolve)</option>
                </select>
              </div>

              {opType === 'extrude' && (
                <div>
                  <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 mb-1">
                    <span>Thickness (Z-Depth):</span>
                    <span className="text-blue-400 font-bold">{depth} mm</span>
                  </div>
                  <input
                    type="number"
                    value={depth}
                    onChange={(e) => setDepth(Math.max(5, parseInt(e.target.value) || 5))}
                    className="w-full bg-zinc-900 border border-zinc-800 text-xs px-2.5 py-1.5 rounded text-zinc-200 outline-none focus:border-blue-500 font-mono"
                    min="5"
                    max="1000"
                  />
                </div>
              )}

              {opType === 'revolve' && (
                <div>
                  <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 mb-1">
                    <span>Revolve Axis (Eksen):</span>
                    <span className="text-indigo-400 font-bold uppercase">{revolveAxis}</span>
                  </div>
                  <select
                    value={revolveAxis}
                    onChange={(e) => setRevolveAxis(e.target.value as 'left' | 'center' | 'right' | 'origin-y' | 'origin-x')}
                    className="w-full bg-zinc-900 border border-zinc-800 text-xs px-2.5 py-1.5 rounded text-zinc-200 outline-none focus:border-blue-500 font-sans cursor-pointer"
                  >
                    <option value="left">Sol Sınır (Left Edge - Min X)</option>
                    <option value="center">Merkez Aks (Center Axis)</option>
                    <option value="right">Sağ Sınır (Right Edge - Max X)</option>
                    <option value="origin-y">Y-Ekseni (Origin X=0 vertical)</option>
                    <option value="origin-x">X-Ekseni (Origin Y=0 horizontal)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={executeStlExport}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded text-xs font-bold bg-blue-600 hover:bg-blue-500 transition cursor-pointer"
                title="Download production ready 3D solid STL"
              >
                <Download className="w-3.5 h-3.5" />
                <span>STL Model</span>
              </button>
              <button
                onClick={exportToDXF}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded text-xs font-bold bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:text-white transition cursor-pointer"
                title="Download 2D profile keyline DXF"
              >
                <Download className="w-3.5 h-3.5" />
                <span>DXF Profile</span>
              </button>
            </div>
          </div>
        </aside>

        {/* 3. Splitted Dual Viewports */}
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden bg-zinc-950">
          
          {/* Viewport A: 2D Sketch canvas */}
          <div 
            style={{ flex: `0 0 ${splitRatio}%` }}
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
                    {activeSegmentStretch ? "📐 STRETCH AKTİF" : "📦 MOVE AKTİF"}
                  </div>
                  <div>
                    <span className="text-xs font-bold text-zinc-200 block">
                      {activeSegmentStretch ? "Kenar Esnetme (Edge Stretch) Konumlandırması" : "Şekil Taşıma (Shape Move) Konumlandırması"}
                    </span>
                    <span className="text-[10px] text-zinc-500 block">
                      Fareyi oynatarak konumu ayarlayın. Yerleştirmek için ekrana veya Uygula tuşuna tıklayın. İptal için ESC.
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
                      logCommandResponse("Değişiklik kaydedildi.");
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-[10px] font-mono font-bold text-white rounded transition cursor-pointer uppercase text-center"
                  >
                    Uygula
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
                      logCommandResponse("Sürükleme işlemi iptal edildi.");
                    }}
                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-[10px] font-mono font-bold text-zinc-400 hover:text-white rounded transition cursor-pointer uppercase text-center"
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            )}

            {/* Interactive parametric segment dimension editor popup */}
            {editingSegmentIdx !== null && editingPathIdx !== null && (
              <div className="absolute top-14 left-3 bg-zinc-900/95 border-2 border-amber-500 rounded-lg p-3 text-xs w-[250px] shadow-2xl z-40 space-y-2 backdrop-blur animate-fade-in">
                <div className="flex justify-between items-center pb-1.5 border-b border-zinc-805">
                  <span className="font-bold text-amber-400 font-mono flex items-center gap-1.5 uppercase tracking-wide text-[10px]">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    Ölçülendirme Düzenle
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
                    Küme segmenti: <span className="text-zinc-200 font-bold font-mono">K-{editingSegmentIdx + 1}</span> ({editingPathIdx === -1 ? "Aktif Çizim" : "Katman Şekli #" + editingPathIdx})
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
                      placeholder="Örn: 120"
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
                    Uygula (Apply)
                  </button>
                  <button
                    onClick={() => {
                      setEditingSegmentIdx(null);
                      setEditingPathIdx(null);
                    }}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 rounded transition text-[11px] font-mono"
                  >
                    İptal
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
                    📐 Akıllı Konumlandırma
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
                  <p className="text-[10px] text-zinc-400 mb-2 font-mono leading-relaxed">
                    Noktalar arası mesafeyi ayarlayarak şekli veya düğüm noktasını konumlandırın.
                  </p>
                  
                  {/* Target Distance Input */}
                  <label className="block text-[10px] text-zinc-400 font-mono mb-1">Hedef Mesafe:</label>
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
                      placeholder="Örn: 150"
                      autoFocus
                    />
                    <span className="text-zinc-400 font-mono font-bold font-bold">mm</span>
                  </div>
                </div>

                {/* Positioning Options Toggles */}
                <div className="p-2 bg-zinc-950 border border-zinc-850 rounded space-y-2">
                  <span className="text-[9px] uppercase font-mono text-zinc-500 block">Konumlandırma Modu:</span>
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 cursor-pointer text-[11px] font-mono text-zinc-300">
                      <input
                        type="radio"
                        name="positioning_mode"
                        checked={moveEntireShapeOnDimChange}
                        onChange={() => setMoveEntireShapeOnDimChange(true)}
                        className="rounded-full text-pink-500 focus:ring-0 cursor-pointer"
                      />
                      <span>Tüm Şekli Kaydır (Önerilen)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-[11px] font-mono text-zinc-300">
                      <input
                        type="radio"
                        name="positioning_mode"
                        checked={!moveEntireShapeOnDimChange}
                        onChange={() => setMoveEntireShapeOnDimChange(false)}
                        className="rounded-full text-pink-500 focus:ring-0 cursor-pointer"
                      />
                      <span>Sadece Bu Noktayı Taşı</span>
                    </label>
                  </div>
                </div>

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
                    Konumlandır (Apply)
                  </button>
                  <button
                    onClick={() => handleDeleteDimension(selectedDimensionId)}
                    className="px-2 py-1.5 bg-red-950 hover:bg-red-900 border border-red-900 text-red-100 rounded transition text-[11px] font-mono"
                    title="Ölçülendirmeyi çizimden siler"
                  >
                    Sil
                  </button>
                  <button
                    onClick={() => {
                      setSelectedDimensionId(null);
                    }}
                    className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 rounded transition text-[11px] font-mono"
                  >
                    Vazgeç
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
                  <span>X (Hizalama):</span>
                  <span className="text-rose-400">{hoverCoords ? hoverCoords.x.toFixed(1) : "0.0"} mm</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Y (Düşey):</span>
                  <span className="text-emerald-400">{hoverCoords ? hoverCoords.y.toFixed(1) : "0.0"} mm</span>
                </div>
                <div className="flex justify-between gap-4 text-zinc-500 text-[9px] pt-1.5 border-t border-zinc-850/50">
                  <span>Ölçek (Zoom):</span>
                  <span className="text-zinc-400">{Math.round(viewZoom * 100)}%</span>
                </div>
              </div>
            </div>
            
            {/* Legend guide right-top */}
            <div className="absolute top-3 right-3 bg-zinc-900/85 border border-zinc-850 backdrop-blur p-2.5 rounded text-[10px] font-mono text-zinc-400 pointer-events-none z-10 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-zinc-300">
                <span>🖱️ CAD Kontrolleri</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-blue-500 inline-block rounded-sm" />
                Sağ Tık + Sürükle: Seçim Kutusu
              </div>
              <div className="flex items-center gap-1.5 text-zinc-300">
                <span className="w-2.5 h-2.5 bg-amber-500 inline-block rounded-sm" />
                Sol Tık + Sürükle: Çoklu Taşıma
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 border border-rose-600 bg-rose-600/30 inline-block" />
                Endpoint Yakalama
              </div>
              <div className="text-zinc-500 text-[9px] pt-1 border-t border-zinc-800">
                Wheel: Sahnede Yakınlaşma • Orta Tuş: Pan
              </div>
            </div>

            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              onWheel={handleCanvasWheel}
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
          <div 
            onMouseDown={() => { isDraggingSplitRef.current = true; }}
            className="hidden md:flex flex-col items-center justify-center w-1 hover:w-2 bg-zinc-900 border-l border-r border-zinc-850 hover:border-amber-500/80 hover:bg-amber-500/20 cursor-col-resize transition-all shrink-0 self-stretch group z-20"
            title="Sürükleyerek 2D/3D ekran oranını değiştirin"
          >
            <div className="w-0.5 h-10 bg-zinc-700 rounded-full group-hover:bg-amber-400 group-hover:h-14 transition-all" />
          </div>

          {/* Viewport B: 3D ThreeJS renderer */}
          <div 
            style={{ flex: `0 0 ${100 - splitRatio}%` }}
            className="h-1/2 md:h-full border-t md:border-t-0 border-zinc-800 flex flex-col bg-zinc-950 transition-all duration-75 overflow-hidden"
          >
            <ThreeViewport
              layers={layers}
              activeLayerId={activeLayerId}
              triggerStlExportRef={triggerStlExportRef}
            />
          </div>
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
            placeholder="Şu komutları girin: L (Line), R (Rect), C (Circle), POL (Polygon), F (Fillet), CLEAR (Sıfırla)"
            value={cmdText}
            onChange={(e) => setCmdText(e.target.value)}
          />
        </form>
      </footer>
    </div>
  );
}
