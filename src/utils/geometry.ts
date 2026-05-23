import { Point, SnapPoint, TrackLine, SnapToggles, SnapType } from '../types';

export function distance(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export function douglasPeucker(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return pts;
  let dmax = 0;
  let index = 0;
  const end = pts.length - 1;

  for (let i = 1; i < end; i++) {
    const num = Math.abs(
      (pts[end].y - pts[0].y) * pts[i].x -
      (pts[end].x - pts[0].x) * pts[i].y +
      pts[end].x * pts[0].y -
      pts[end].y * pts[0].x
    );
    const den = Math.hypot(pts[end].y - pts[0].y, pts[end].x - pts[0].x);
    const d = den === 0 ? Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y) : num / den;

    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const recResults1 = douglasPeucker(pts.slice(0, index + 1), epsilon);
    const recResults2 = douglasPeucker(pts.slice(index, end + 1), epsilon);
    return recResults1.slice(0, -1).concat(recResults2);
  } else {
    return [pts[0], pts[end]];
  }
}

export interface CalculateSnapsResult {
  x: number;
  y: number;
  snapPoint: SnapPoint | null;
  trackedLines: TrackLine[];
}

export function calculateSnaps(
  targetX: number,
  targetY: number,
  finalPoints: Point[],
  isClosed: boolean,
  excludeIndex: number = -1,
  smartSnapEnabled: boolean = true,
  snapTol: number = 10,
  allPaths?: Point[][],
  gridSnapEnabled: boolean = false,
  gridSize: number = 50,
  customAnchor?: Point | null,
  snapToggles?: SnapToggles
): CalculateSnapsResult {
  if (gridSnapEnabled) {
    targetX = Math.round(targetX / gridSize) * gridSize;
    targetY = Math.round(targetY / gridSize) * gridSize;
  }

  if (!smartSnapEnabled) {
    return { x: targetX, y: targetY, snapPoint: null, trackedLines: [] };
  }

  // Desired toggling behavior
  const toggles = snapToggles || {
    origin: true,
    int: true,
    end: true,
    mid: true,
    tan: true,
    quad: true
  };

  let finalX = targetX;
  let finalY = targetY;
  let snappedX = false;
  let snappedY = false;
  let snapPoint: SnapPoint | null = null;
  const trackedLines: TrackLine[] = [];

  // Endpoints listesi ve hizada yakalanacak noktalar listesi
  const pointsToTrack: { x: number; y: number; type: SnapType }[] = [];

  // Always include the absolute origin (0, 0)
  if (toggles.origin) {
    pointsToTrack.push({ x: 0, y: 0, type: 'origin' });
  }

  // Include custom anchor point if set by user
  if (customAnchor) {
    pointsToTrack.push({ x: customAnchor.x, y: customAnchor.y, type: 'anchor' });
  }

  // 1. Current active drawing points
  for (let i = 0; i < finalPoints.length; i++) {
    if (i === excludeIndex && excludeIndex !== -1) continue;
    const pt = finalPoints[i];

    // Check if it's a circle
    if (pt.circleData) {
      const { center, radius } = pt.circleData;
      if (toggles.end) {
        pointsToTrack.push({ x: center.x, y: center.y, type: 'end' });
      }
      if (toggles.quad) {
        pointsToTrack.push({ x: center.x, y: center.y - radius, type: 'quad' });
        pointsToTrack.push({ x: center.x, y: center.y + radius, type: 'quad' });
        pointsToTrack.push({ x: center.x - radius, y: center.y, type: 'quad' });
        pointsToTrack.push({ x: center.x + radius, y: center.y, type: 'quad' });
      }
      if (toggles.tan && i > 0) {
        const lastPt = finalPoints[i - 1];
        const d = Math.hypot(lastPt.x - center.x, lastPt.y - center.y);
        if (d > radius) {
          const alpha = Math.atan2(lastPt.y - center.y, lastPt.x - center.x);
          const theta = Math.acos(radius / d);
          pointsToTrack.push({
            x: center.x + radius * Math.cos(alpha + theta),
            y: center.y + radius * Math.sin(alpha + theta),
            type: 'tan'
          });
          pointsToTrack.push({
            x: center.x + radius * Math.cos(alpha - theta),
            y: center.y + radius * Math.sin(alpha - theta),
            type: 'tan'
          });
        }
      }
    } else {
      if (toggles.end) {
        pointsToTrack.push({ x: pt.x, y: pt.y, type: 'end' });
      }
    }

    // Midpoint Hesaplama
    if (toggles.mid && i < finalPoints.length - 1) {
      const nextPt = finalPoints[i + 1];
      if (!pt.circleData && !nextPt.circleData) {
        pointsToTrack.push({
          x: (pt.x + nextPt.x) / 2,
          y: (pt.y + nextPt.y) / 2,
          type: 'mid'
        });
      }
    }
  }

  // Segment kapanış midpointi
  if (toggles.mid && isClosed && finalPoints.length > 2) {
    const pt0 = finalPoints[0];
    const ptN = finalPoints[finalPoints.length - 1];
    if (!pt0.circleData && !ptN.circleData) {
      pointsToTrack.push({
        x: (pt0.x + ptN.x) / 2,
        y: (pt0.y + ptN.y) / 2,
        type: 'mid'
      });
    }
  }

  // 2. Completed paths points
  if (allPaths) {
    allPaths.forEach((path) => {
      // Is this path a circle?
      const circlePt = path.find(p => p.circleData);
      if (circlePt && circlePt.circleData) {
        const { center, radius } = circlePt.circleData;
        if (toggles.end) {
          pointsToTrack.push({ x: center.x, y: center.y, type: 'end' });
        }
        if (toggles.quad) {
          pointsToTrack.push({ x: center.x, y: center.y - radius, type: 'quad' });
          pointsToTrack.push({ x: center.x, y: center.y + radius, type: 'quad' });
          pointsToTrack.push({ x: center.x - radius, y: center.y, type: 'quad' });
          pointsToTrack.push({ x: center.x + radius, y: center.y, type: 'quad' });
        }
        if (toggles.tan && finalPoints && finalPoints.length > 0) {
          const lastPt = finalPoints[finalPoints.length - 1];
          const d = Math.hypot(lastPt.x - center.x, lastPt.y - center.y);
          if (d > radius) {
            const alpha = Math.atan2(lastPt.y - center.y, lastPt.x - center.x);
            const theta = Math.acos(radius / d);
            pointsToTrack.push({
              x: center.x + radius * Math.cos(alpha + theta),
              y: center.y + radius * Math.sin(alpha + theta),
              type: 'tan'
            });
            pointsToTrack.push({
              x: center.x + radius * Math.cos(alpha - theta),
              y: center.y + radius * Math.sin(alpha - theta),
              type: 'tan'
            });
          }
        }
      } else {
        for (let i = 0; i < path.length; i++) {
          if (toggles.end) {
            pointsToTrack.push({ x: path[i].x, y: path[i].y, type: 'end' });
          }
          if (toggles.mid && i < path.length - 1) {
            pointsToTrack.push({
              x: (path[i].x + path[i + 1].x) / 2,
              y: (path[i].y + path[i + 1].y) / 2,
              type: 'mid'
            });
          }
        }
      }
    });
  }

  // Intersection logic within target paths
  let foundIntersection = false;
  let intPt: Point | null = null;
  if (toggles.int && allPaths) {
    const flatLines: { p1: Point; p2: Point }[] = [];
    allPaths.forEach(path => {
      if (path.some(p => p.circleData)) return;
      for (let i = 0; i < path.length - 1; i++) {
        flatLines.push({ p1: path[i], p2: path[i+1] });
      }
    });
    for (let i = 0; i < flatLines.length; i++) {
      for (let j = i + 1; j < flatLines.length; j++) {
        const inter = findSegmentIntersection(flatLines[i].p1, flatLines[i].p2, flatLines[j].p1, flatLines[j].p2);
        if (inter && inter.tAb >= 0 && inter.tAb <= 1 && inter.tCd >= 0 && inter.tCd <= 1) {
          const distInt = Math.hypot(inter.x - targetX, inter.y - targetY);
          if (distInt < snapTol) {
            foundIntersection = true;
            intPt = { x: inter.x, y: inter.y };
            break;
          }
        }
      }
      if (foundIntersection) break;
    }
  }

  if (foundIntersection && intPt) {
    snapPoint = { x: intPt.x, y: intPt.y, type: 'int' };
    return { x: intPt.x, y: intPt.y, snapPoint, trackedLines };
  }

  // Nokta/midpoint snap - Çok yakınsa direkt kilitle
  for (const p of pointsToTrack) {
    if (Math.hypot(p.x - targetX, p.y - targetY) < snapTol) {
      snapPoint = { x: p.x, y: p.y, type: p.type };
      return { x: p.x, y: p.y, snapPoint, trackedLines };
    }
  }

  // Hizalama (Smart Track)
  for (const p of pointsToTrack) {
    // Yatay hizalama
    if (!snappedY && Math.abs(p.y - targetY) < snapTol) {
      finalY = p.y;
      snappedY = true;
      trackedLines.push({ x: p.x, y: p.y, type: 'H' });
    }
    // Dikey hizalama
    if (!snappedX && Math.abs(p.x - targetX) < snapTol) {
      finalX = p.x;
      snappedX = true;
      trackedLines.push({ x: p.x, y: p.y, type: 'V' });
    }
  }

  // Hem X hem Y snaplendiğinde kesişim (Intersection) sayılır
  if (snappedX && snappedY && toggles.int) {
    snapPoint = { x: finalX, y: finalY, type: 'int' };
  }

  return { x: finalX, y: finalY, snapPoint, trackedLines };
}

export interface IntersectionResult {
  x: number;
  y: number;
  tAb: number; // position on AB
  tCd: number; // position on CD
}

// Line intersection
export function findSegmentIntersection(p1: Point, p2: Point, p3: Point, p4: Point): IntersectionResult | null {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-8) return null; // parallel

  const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;

  return {
    x: p1.x + u * (p2.x - p1.x),
    y: p1.y + u * (p2.y - p1.y),
    tAb: u,
    tCd: v
  };
}

// Sharp Miter Polygon Offset Algorithm
export function offsetPolygon(polygon: Point[], d: number): Point[] {
  if (polygon.length < 3) return polygon;
  
  // Detect duplicate endpoint
  const isClosed = distance(polygon[0], polygon[polygon.length - 1]) < 0.1;
  const n = isClosed ? polygon.length - 1 : polygon.length;
  const result: Point[] = [];

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];

    // Incoming normal (rotate counterclockwise)
    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.hypot(dx1, dy1) || 1;
    const nx1 = -dy1 / len1;
    const ny1 = dx1 / len1;

    // Outgoing normal
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.hypot(dx2, dy2) || 1;
    const nx2 = -dy2 / len2;
    const ny2 = dx2 / len2;

    // Average normal
    let nx = (nx1 + nx2) / 2;
    let ny = (ny1 + ny2) / 2;
    const nLen = Math.hypot(nx, ny) || 1;
    nx /= nLen;
    ny /= nLen;

    // Miter scaling factor
    const cosAngle = nx1 * nx2 + ny1 * ny2;
    let factor = 1.0;
    if (cosAngle > -0.99) {
      factor = 1.0 / Math.sqrt((1.0 + cosAngle) / 2.0);
    }
    factor = Math.min(factor, 3.0); // Safe limit to prevent wild spikes at sharper-than-normal joints

    result.push({
      x: curr.x + nx * d * factor,
      y: curr.y + ny * d * factor
    });
  }

  if (isClosed) {
    result.push({ ...result[0] });
  }

  return result;
}

export function getClosestPointOnSegment(p: Point, s1: Point, s2: Point): { x: number; y: number; dist: number; t: number } {
  const l2 = Math.pow(s2.x - s1.x, 2) + Math.pow(s2.y - s1.y, 2);
  if (l2 === 0) return { x: s1.x, y: s1.y, dist: Math.hypot(p.x - s1.x, p.y - s1.y), t: 0 };
  
  const t = Math.max(0, Math.min(1, ((p.x - s1.x) * (s2.x - s1.x) + (p.y - s1.y) * (s2.y - s1.y)) / l2));
  const projX = s1.x + t * (s2.x - s1.x);
  const projY = s1.y + t * (s2.y - s1.y);
  
  return {
    x: projX,
    y: projY,
    dist: Math.hypot(p.x - projX, p.y - projY),
    t
  };
}
