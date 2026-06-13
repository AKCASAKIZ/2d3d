import { Point, CADLayer } from '../types';
import { distance } from './geometry';

export const getDimensionLinePoints = (
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

export const getAutoDimensionDetails = (
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

export const computeFilletPoints = (p0: Point, p1: Point, p2: Point, r: number): Point[] => {
  const dx1 = p0.x - p1.x;
  const dy1 = p0.y - p1.y;
  const len1 = Math.hypot(dx1, dy1);

  const dx2 = p2.x - p1.x;
  const dy2 = p2.y - p1.y;
  const len2 = Math.hypot(dx2, dy2);

  if (len1 < 0.1 || len2 < 0.1) {
    return [p1];
  }

  const u1 = { x: dx1 / len1, y: dy1 / len1 };
  const u2 = { x: dx2 / len2, y: dy2 / len2 };

  const cosTheta = u1.x * u2.x + u1.y * u2.y;
  if (cosTheta > 0.999 || cosTheta < -0.999) {
    // Nearly parallel edges, cannot fillet
    return [p1];
  }

  const theta = Math.acos(Math.max(-1, Math.min(1, cosTheta)));
  let T = r / Math.tan(theta / 2);

  // Proportional Auto-Scaling to prevent self-intersection of adjacent edges:
  const maxT = Math.min(len1, len2) * 0.45;
  if (T > maxT) {
    T = maxT;
  }

  // Turn angle
  const phi = Math.PI - theta;
  const k = (4 / 3) * Math.tan(phi / 4);

  const A = { x: p1.x + u1.x * T, y: p1.y + u1.y * T };
  const B = { x: p1.x + u2.x * T, y: p1.y + u2.y * T };

  return [
    { x: A.x, y: A.y, isCurvePoint: false },
    { x: A.x + u2.x * T * k, y: A.y + u2.y * T * k, isCurvePoint: true },
    { x: B.x + u1.x * T * k, y: B.y + u1.y * T * k, isCurvePoint: true },
    { x: B.x, y: B.y, isCurvePoint: false }
  ];
};

export const computeChamferPoints = (p0: Point, p1: Point, p2: Point, d: number): Point[] => {
  const dx1 = p0.x - p1.x;
  const dy1 = p0.y - p1.y;
  const len1 = Math.hypot(dx1, dy1);

  const dx2 = p2.x - p1.x;
  const dy2 = p2.y - p1.y;
  const len2 = Math.hypot(dx2, dy2);

  if (len1 < 0.1 || len2 < 0.1) {
    return [p1];
  }

  const u1 = { x: dx1 / len1, y: dy1 / len1 };
  const u2 = { x: dx2 / len2, y: dy2 / len2 };

  let T = d;
  const maxT = Math.min(len1, len2) * 0.45;
  if (T > maxT) {
    T = maxT;
  }

  return [
    { x: p1.x + u1.x * T, y: p1.y + u1.y * T },
    { x: p1.x + u2.x * T, y: p1.y + u2.y * T }
  ];
};

export interface PointAnchor {
  type: 'finalPoints' | 'path';
  pathIdx?: number;
  vertexIdx: number;
  isCircleCenter?: boolean;
}

export const findAnchorForPointInLayer = (
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

export const resolveAnchorInLayer = (
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

export const adjustRectangleVertices = (pts: Point[], targetPtIdx: number, newX: number, newY: number): Point[] => {
  const draggedPt = pts[targetPtIdx];
  if (!draggedPt || !draggedPt.rectData) return pts;

  const rId = draggedPt.rectData.id;
  const dragVIdx = draggedPt.rectData.vertexIndex;

  const rectIndices: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].rectData?.id === rId) {
      rectIndices.push(i);
    }
  }

  if (rectIndices.length === 5) {
    const idxMap: { [key: number]: number } = {};
    rectIndices.forEach(idx => {
      idxMap[pts[idx].rectData!.vertexIndex] = idx;
    });

    if (idxMap[0] !== undefined && idxMap[1] !== undefined && idxMap[2] !== undefined && idxMap[3] !== undefined && idxMap[4] !== undefined) {
      const dragIndexMapped = dragVIdx === 4 ? 0 : dragVIdx;

      const origIdxMap: { [key: number]: Point } = {};
      rectIndices.forEach(idx => {
        origIdxMap[pts[idx].rectData!.vertexIndex] = pts[idx];
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

      const d = { x: newX - P_opp.x, y: newY - P_opp.y };

      const proj_u = d.x * u.x + d.y * u.y;
      const proj_v = d.x * v.x + d.y * v.y;

      const P_drag_new = { x: newX, y: newY };
      const P_prev_new = { x: P_opp.x + proj_u * u.x, y: P_opp.y + proj_u * u.y };
      const P_next_new = { x: P_opp.x + proj_v * v.x, y: P_opp.y + proj_v * v.y };

      const updated = [...pts];
      
      const updateV = (vIdx: number, newPt: { x: number; y: number }) => {
        const idx = idxMap[vIdx];
        updated[idx] = { ...updated[idx], x: newPt.x, y: newPt.y };
      };

      updateV(dragIndexMapped, P_drag_new);
      updateV(prevVIdx, P_prev_new);
      updateV(nextVIdx, P_next_new);

      updated[idxMap[4]] = { ...updated[idxMap[4]], x: updated[idxMap[0]].x, y: updated[idxMap[0]].y };

      return updated;
    }
  }
  return pts;
};

export const weldToExistingSketchPoints = (newPts: Point[], activeLayer: CADLayer): Point[] => {
  const tolerance = 2.5; // matching tolerance in mm
  const existingPts: Point[] = [];
  
  if (activeLayer.finalPoints && activeLayer.finalPoints.length > 0) {
    existingPts.push(...activeLayer.finalPoints);
  }
  if (activeLayer.paths) {
    activeLayer.paths.forEach(p => {
      p.forEach(pt => {
        existingPts.push(pt);
      });
    });
  }

  if (existingPts.length === 0) return newPts;

  let modified = false;
  const updated = newPts.map((pt) => {
    // Do not distort individual circle curve approximation points to preserve pure circular geometries
    if (pt.isCurvePoint && pt.circleData) {
      return pt;
    }

    let closest: Point | null = null;
    let minDist = tolerance;

    for (const exp of existingPts) {
      if (exp.isCurvePoint && exp.circleData) {
        continue;
      }
      const d = Math.hypot(pt.x - exp.x, pt.y - exp.y);
      if (d < minDist) {
        minDist = d;
        closest = exp;
      }
    }

    if (closest) {
      modified = true;
      return { ...pt, x: closest.x, y: closest.y };
    }
    return pt;
  });

  if (modified && updated.length > 0) {
    if (updated[0].rectData && updated[updated.length - 1].rectData && updated[0].rectData.id === updated[updated.length - 1].rectData.id) {
      const idx4 = updated.length - 1;
      updated[idx4] = { ...updated[idx4], x: updated[0].x, y: updated[0].y };
    } else if (distance(updated[0], updated[updated.length - 1]) < 0.1) {
      updated[updated.length - 1] = { ...updated[updated.length - 1], x: updated[0].x, y: updated[0].y };
    }
  }

  return updated;
};

export const weldArcEndpoints = (arcPts: Point[], activeLayer: CADLayer): Point[] => {
  if (arcPts.length < 2) return arcPts;
  const first = weldToExistingSketchPoints([arcPts[0]], activeLayer)[0];
  const last = weldToExistingSketchPoints([arcPts[arcPts.length - 1]], activeLayer)[0];
  const updated = [...arcPts];
  updated[0] = { ...updated[0], x: first.x, y: first.y };
  updated[updated.length - 1] = { ...updated[updated.length - 1], x: last.x, y: last.y };
  return updated;
};

export const syncLayerDimensions = (layer: CADLayer): CADLayer => {
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

export const syncAllLayersDimensions = (layersList: CADLayer[]): CADLayer[] => {
  return layersList.map((l) => {
    return syncLayerDimensions(l);
  });
};

export const isColorDark = (color: string): boolean => {
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
