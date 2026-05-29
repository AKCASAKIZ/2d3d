import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { Eye, EyeOff, Sliders, Scissors, RotateCcw, FlipHorizontal, MousePointer2, Sparkles, Compass, HelpCircle } from 'lucide-react';
import { Point, CADLayer } from '../types';

function getPolygonArea(poly: Point[]): number {
  if (poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    area += poly[i].x * poly[i + 1].y - poly[i + 1].x * poly[i].y;
  }
  return Math.abs(area / 2);
}

function isPointInPolygon(pt: Point, poly: Point[]): boolean {
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
}

interface ThreeViewportProps {
  layers: CADLayer[];
  activeLayerId: string;
  triggerStlExportRef: React.MutableRefObject<(() => void) | null>;
  onSelectFace?: (params: { zHeight: number; layerId: string; faceName: string }) => void;
}

export function ThreeViewport({ layers, activeLayerId, triggerStlExportRef, onSelectFace }: ThreeViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const activeGroupRef = useRef<THREE.Group | null>(null);

  // 3D face selection states
  const [faceSelectionMode, setFaceSelectionMode] = useState(false);
  const [hoveredFace, setHoveredFace] = useState<{ zHeight: number; layerName: string; layerId: string } | null>(null);
  const hoverIndicatorRef = useRef<THREE.Mesh | null>(null);

  // 3D Clipping section view state
  const [clipEnabled, setClipEnabled] = useState(false);
  const [clipAxis, setClipAxis] = useState<'X' | 'Y' | 'Z'>('X');
  const [clipConstant, setClipConstant] = useState(0);
  const [clipInverted, setClipInverted] = useState(false);
  const [showHelper, setShowHelper] = useState(true);

  // Camera preset selection states
  const [activePreset, setActivePreset] = useState<'iso' | 'top' | 'front' | 'left' | 'right' | null>('iso');

  // Auto-Orbit turnable states
  const [autoRotate, setAutoRotate] = useState(false);
  const [autoRotateSpeed, setAutoRotateSpeed] = useState(2.0);

  // ThreeJS Plane objects reference
  const clipPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0));
  const planeHelperRef = useRef<THREE.PlaneHelper | null>(null);

  // Synchronize auto rotation settings with OrbitControls in real-time
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = autoRotateSpeed;
    controls.update();
  }, [autoRotate, autoRotateSpeed]);

  const orbitCameraIncrementally = (direction: 'left' | 'right' | 'up' | 'down') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    // Rotate camera position around target point vector coordinates
    const target = controls.target;
    const offset = camera.position.clone().sub(target);

    // Coordinate state using Spherical coords around target pivot
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const angleDelta = 15 * (Math.PI / 180); // Rotate by 15 degrees per click

    if (direction === 'left') {
      spherical.theta -= angleDelta;
    } else if (direction === 'right') {
      spherical.theta += angleDelta;
    } else if (direction === 'up') {
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi - angleDelta));
    } else if (direction === 'down') {
      spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + angleDelta));
    }

    const newOffset = new THREE.Vector3().setFromSpherical(spherical);
    camera.position.copy(target).add(newOffset);
    camera.lookAt(target);
    controls.update();
    setActivePreset(null);
  };

  // Smooth cinematic gliding motion for preset camera transitions
  const animateCameraTo = (targetPos: THREE.Vector3) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    // Temporarily turn off user interaction during movement to make transition stable
    controls.enabled = false;

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const endTarget = new THREE.Vector3(0, 0, 0);

    // Adjust up vector to handle top-down extreme poles smoothly without flip locking
    const targetUp = new THREE.Vector3(0, 1, 0);
    if (Math.abs(targetPos.x) < 1 && Math.abs(targetPos.z) < 1) {
      targetUp.set(0, 0, -1);
    }

    const duration = 600; // ms
    const startTime = performance.now();

    const animateGliding = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Beautiful cubic-out easing formula
      const ease = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPos, targetPos, ease);
      controls.target.lerpVectors(startTarget, endTarget, ease);
      camera.up.lerpVectors(camera.up, targetUp, ease);

      camera.lookAt(controls.target);
      controls.update();

      if (progress < 1) {
        requestAnimationFrame(animateGliding);
      } else {
        controls.enabled = true;
      }
    };

    requestAnimationFrame(animateGliding);
  };

  // STL Export handler
  useEffect(() => {
    triggerStlExportRef.current = () => {
      if (!activeGroupRef.current || activeGroupRef.current.children.length === 0) return;
      try {
        const exporter = new STLExporter();
        const result = exporter.parse(activeGroupRef.current, { binary: false });
        const blob = new Blob([result], { type: 'text/plain' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'ZekiCAD_Unified_3D_Model.stl';
        link.click();
      } catch (err) {
        console.error('STL Export Error:', err);
      }
    };
    return () => {
      triggerStlExportRef.current = null;
    };
  }, [layers, triggerStlExportRef]);

  // Scene setup
  useEffect(() => {
    if (!containerRef.current) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x18181b); // Zinc-900 background
    sceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      1,
      5000
    );
    camera.position.set(300, 300, 450);
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Reset active camera preset when manually dragging/interacting
    controls.addEventListener('start', () => {
      setActivePreset(null);
    });

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 0.85);
    mainLight.position.set(200, 500, 300);
    scene.add(mainLight);

    const fillLight = new THREE.DirectionalLight(0x0e639c, 0.35);
    fillLight.position.set(-200, -300, -200);
    scene.add(fillLight);

    // Helpers
    const gridHelper = new THREE.GridHelper(800, 32, 0x3f3f46, 0x27272a);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(100);
    scene.add(axesHelper);

    // Resize Handler
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Animation loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      if (renderer && renderer.domElement && containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  // Surface hover & Selection click detection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let clickStartX = 0;
    let clickStartY = 0;

    const onPointerDown = (event: PointerEvent) => {
      clickStartX = event.clientX;
      clickStartY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!faceSelectionMode || !cameraRef.current || !sceneRef.current || !activeGroupRef.current) {
        setHoveredFace(null);
        if (hoverIndicatorRef.current) {
          hoverIndicatorRef.current.visible = false;
        }
        return;
      }

      const rect = container.getBoundingClientRect();
      const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), cameraRef.current);

      const solidMeshes: THREE.Mesh[] = [];
      activeGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          solidMeshes.push(child);
        }
      });

      const intersects = raycaster.intersectObjects(solidMeshes);
      if (intersects.length > 0) {
        const hit = intersects[0];
        const userData = hit.object.userData;

        // Visual feedback indicator positioning
        if (!hoverIndicatorRef.current) {
          const indicatorGeom = new THREE.RingGeometry(2, 6, 16);
          const indicatorMat = new THREE.MeshBasicMaterial({
            color: 0xf97316, // Radiant Orange
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            depthTest: false
          });
          const indicatorMesh = new THREE.Mesh(indicatorGeom, indicatorMat);
          indicatorMesh.renderOrder = 2000;
          sceneRef.current.add(indicatorMesh);
          hoverIndicatorRef.current = indicatorMesh;
        }

        // Align the hovering indicator plane flat relative to face normal
        const hitNormal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 0, 1);
        hitNormal.transformDirection(hit.object.matrixWorld);

        // Position indicators slightly above clicked surface to avoid depth-fighting artifacts
        const hoverPoint = hit.point.clone().add(hitNormal.clone().multiplyScalar(0.5));
        hoverIndicatorRef.current.position.copy(hoverPoint);
        hoverIndicatorRef.current.lookAt(hit.point.clone().add(hitNormal));
        hoverIndicatorRef.current.visible = true;

        const roundedZ = Math.round(hit.point.z * 10) / 10;
        setHoveredFace({
          zHeight: roundedZ,
          layerName: userData.layerName || 'Unknown Block',
          layerId: userData.layerId || 'unknown'
        });
      } else {
        setHoveredFace(null);
        if (hoverIndicatorRef.current) {
          hoverIndicatorRef.current.visible = false;
        }
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!faceSelectionMode) return;
      const diffX = Math.abs(event.clientX - clickStartX);
      const diffY = Math.abs(event.clientY - clickStartY);
      // Filter out orbits dragging
      if (diffX > 6 || diffY > 6) return;

      if (hoveredFace && onSelectFace) {
        onSelectFace(hoveredFace);
        setFaceSelectionMode(false); // Reset/disable mode after successful face selection
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove, { passive: true });
    container.addEventListener('pointerup', onPointerUp);

    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      if (hoverIndicatorRef.current && sceneRef.current) {
        sceneRef.current.remove(hoverIndicatorRef.current);
        hoverIndicatorRef.current.geometry.dispose();
        if (Array.isArray(hoverIndicatorRef.current.material)) {
          hoverIndicatorRef.current.material.forEach((m: any) => m.dispose());
        } else {
          hoverIndicatorRef.current.material.dispose();
        }
        hoverIndicatorRef.current = null;
      }
    };
  }, [faceSelectionMode, hoveredFace, onSelectFace]);

  // Update clipping plane parameters & helper in real-time
  useEffect(() => {
    const plane = clipPlaneRef.current;
    
    // Determine clip normal direction
    const normal = new THREE.Vector3();
    if (clipAxis === 'X') {
      normal.set(clipInverted ? 1 : -1, 0, 0);
    } else if (clipAxis === 'Y') {
      normal.set(0, clipInverted ? 1 : -1, 0);
    } else {
      normal.set(0, 0, clipInverted ? 1 : -1);
    }
    
    plane.normal.copy(normal);
    plane.constant = clipConstant;

    // Direct scene rendering helper integration
    const scene = sceneRef.current;
    if (scene) {
      if (planeHelperRef.current) {
        scene.remove(planeHelperRef.current);
        if (planeHelperRef.current.geometry) planeHelperRef.current.geometry.dispose();
        if (planeHelperRef.current.material) {
          if (Array.isArray(planeHelperRef.current.material)) {
            planeHelperRef.current.material.forEach((m) => m.dispose());
          } else {
            planeHelperRef.current.material.dispose();
          }
        }
        planeHelperRef.current = null;
      }

      if (clipEnabled && showHelper) {
        const helperColor = clipAxis === 'X' ? 0x10b981 : clipAxis === 'Y' ? 0xef4444 : 0x3b82f6;
        const helper = new THREE.PlaneHelper(plane, 400, helperColor);
        if (helper.material) {
          (helper.material as THREE.Material).transparent = true;
          (helper.material as THREE.Material).opacity = 0.3;
        }
        scene.add(helper);
        planeHelperRef.current = helper;
      }
    }
  }, [clipEnabled, clipAxis, clipConstant, clipInverted, showHelper]);

  // Update Geometry whenever layers change
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old group
    if (activeGroupRef.current) {
      scene.remove(activeGroupRef.current);
      activeGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        } else if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      activeGroupRef.current = null;
    }

    // Filter layers that have enough geometry or sketch lines to display
    const visibleDrawnLayers = layers.filter(
      (ly) => ly.visible && (ly.finalPoints.length >= 2 || (ly.paths && ly.paths.length > 0))
    );

    if (visibleDrawnLayers.length === 0) return;

    // Calculate unified centroid across all points of all visible layers
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let pointCount = 0;

    visibleDrawnLayers.forEach((ly) => {
      const allPointsOnLayer = [...ly.finalPoints];
      if (ly.paths) {
        ly.paths.forEach((p) => allPointsOnLayer.push(...p));
      }
      allPointsOnLayer.forEach((p) => {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        pointCount++;
      });
    });

    const cx = pointCount > 0 ? (minX + maxX) / 2 : 0;
    const cy = pointCount > 0 ? (minY + maxY) / 2 : 0;

    const group = new THREE.Group();

    visibleDrawnLayers.forEach((ly) => {
      // Create separate loop structures with individual shape properties
      interface LoopConfig {
        points: Point[];
        opType: 'extrude' | 'revolve';
        depth: number;
        revolveAxis: 'left' | 'center' | 'right' | 'origin-y' | 'origin-x';
        booleanType: 'union' | 'cut';
        name: string;
        index: number;
      }

      const configs: LoopConfig[] = [];

      if (ly.finalPoints.length >= 3 && ly.isClosed) {
        const s = ly.finalPointsSettings;
        configs.push({
          points: ly.finalPoints,
          opType: s?.opType || ly.opType || 'extrude',
          depth: s?.depth !== undefined ? s.depth : (ly.depth !== undefined ? ly.depth : 30),
          revolveAxis: s?.revolveAxis || ly.revolveAxis || 'center',
          booleanType: s?.booleanType || 'union',
          name: 'Active Sketch',
          index: -1
        });
      }

      if (ly.paths) {
        ly.paths.forEach((p, idx) => {
          if (p.length >= 3) {
            const s = ly.pathSettings?.[idx];
            configs.push({
              points: p,
              opType: s?.opType || ly.opType || 'extrude',
              depth: s?.depth !== undefined ? s.depth : (ly.depth !== undefined ? ly.depth : 30),
              revolveAxis: s?.revolveAxis || ly.revolveAxis || 'center',
              booleanType: s?.booleanType || 'union',
              name: `Shape #${idx + 1}`,
              index: idx
            });
          }
        });
      }

      if (configs.length === 0) return;

      // Group loops into Outer boundaries (unions) and Holes (cuts)
      const sortedConfigs = [...configs].sort((a, b) => getPolygonArea(b.points) - getPolygonArea(a.points));
      const unions: { outer: LoopConfig; holes: LoopConfig[] }[] = [];

      sortedConfigs.forEach((cfg) => {
        let nestedIndex = -1;
        for (let i = 0; i < unions.length; i++) {
          if (isPointInPolygon(cfg.points[0], unions[i].outer.points)) {
            nestedIndex = i;
            break;
          }
        }

        // Check if there is an explicit user specification for union/cut
        const hasExplicitBoolean = cfg.index === -1
          ? !!ly.finalPointsSettings?.booleanType
          : !!ly.pathSettings?.[cfg.index]?.booleanType;

        const isCut = cfg.booleanType === 'cut' || (nestedIndex !== -1 && !hasExplicitBoolean);

        if (isCut) {
          if (nestedIndex !== -1) {
            unions[nestedIndex].holes.push(cfg);
          } else {
            unions.push({ outer: cfg, holes: [] });
          }
        } else {
          unions.push({ outer: cfg, holes: [] });
        }
      });

      // Generate a mesh for each union shape (islands with respective holes)
      unions.forEach(({ outer, holes }) => {
        let geometry: THREE.BufferGeometry;

        try {
          if (outer.opType === 'extrude') {
            const shape = new THREE.Shape();
            shape.moveTo(outer.points[0].x - cx, cy - outer.points[0].y);
            for (let i = 1; i < outer.points.length; i++) {
              shape.lineTo(outer.points[i].x - cx, cy - outer.points[i].y);
            }

            holes.forEach((hole) => {
              const path = new THREE.Path();
              path.moveTo(hole.points[0].x - cx, cy - hole.points[0].y);
              for (let i = 1; i < hole.points.length; i++) {
                path.lineTo(hole.points[i].x - cx, cy - hole.points[i].y);
              }
              shape.holes.push(path);
            });

            geometry = new THREE.ExtrudeGeometry(shape, {
              depth: outer.depth,
              bevelEnabled: true,
              bevelThickness: 1.5,
              bevelSize: 0.8,
              bevelOffset: 0,
              bevelSegments: 3,
            });
            geometry.computeVertexNormals();
          } else {
            // Revolve around custom chosen axis
            let lMinX = Infinity;
            let lMaxX = -Infinity;
            outer.points.forEach((p) => {
              if (p.x < lMinX) lMinX = p.x;
              if (p.x > lMaxX) lMaxX = p.x;
            });
            const lCx = (lMinX + lMaxX) / 2;

            const axis = outer.revolveAxis;
            const points2D = outer.points.map((pt) => {
              let r = 0;
              let height = cy - pt.y;
              if (axis === 'left') {
                r = pt.x - lMinX;
              } else if (axis === 'right') {
                r = lMaxX - pt.x;
              } else if (axis === 'origin-y') {
                r = Math.abs(pt.x - cx);
              } else if (axis === 'origin-x') {
                r = Math.abs(cy - pt.y);
                height = pt.x - cx;
              } else {
                r = Math.abs(pt.x - lCx);
              }
              return new THREE.Vector2(r, height);
            });
            geometry = new THREE.LatheGeometry(points2D, 32, 0, Math.PI * 2);
            geometry.computeVertexNormals();
          }

          const baseColor = new THREE.Color(ly.color || '#3b82f6');

          // Create metallic/glossy materials with custom colors
          const meshMaterial = new THREE.MeshStandardMaterial({
            color: baseColor,
            roughness: 0.3,
            metalness: 0.5,
            side: THREE.DoubleSide,
            clippingPlanes: clipEnabled ? [clipPlaneRef.current] : [],
            clipShadows: true,
          });

          // Highlight line with darker/richer shade (use threshold angle of 25° so cylinder faces aren't lines)
          const wireframeMaterial = new THREE.LineBasicMaterial({
            color: baseColor.clone().multiplyScalar(0.55),
            linewidth: 1.5,
            clippingPlanes: clipEnabled ? [clipPlaneRef.current] : [],
          });

          const mesh = new THREE.Mesh(geometry, meshMaterial);
          mesh.position.z = ly.zOffset || 0;
          mesh.userData = {
            layerId: ly.id,
            layerName: ly.name,
            zOffset: ly.zOffset || 0,
            depth: outer.depth,
            opType: outer.opType,
          };

          const edges = new THREE.EdgesGeometry(geometry, 25);
          const line = new THREE.LineSegments(edges, wireframeMaterial);
          mesh.add(line);

          group.add(mesh);
        } catch (e) {
          console.error(`Error generating 3D component for outer loop ${outer.name}:`, e);
        }
      });

      // Render 2D Helper Sketches (Outline Wireframes)
      const isCurrentActive = ly.id === activeLayerId;

      const renderHelperLine = (pts: Point[], isClosed: boolean, isCurrentActive: boolean) => {
        if (pts.length < 2) return;
        const linePoints: THREE.Vector3[] = [];
        pts.forEach((pt) => {
          linePoints.push(new THREE.Vector3(pt.x - cx, cy - pt.y, 1.2 + (ly.zOffset || 0)));
        });
        if (isClosed && pts.length >= 3) {
          linePoints.push(new THREE.Vector3(pts[0].x - cx, cy - pts[0].y, 1.2 + (ly.zOffset || 0)));
        }

        const lineGeom = new THREE.BufferGeometry().setFromPoints(linePoints);
        const lineMat = new THREE.LineBasicMaterial({
          color: isCurrentActive ? 0xf97316 : 0xa1a1aa, // Radiant Orange or Zinc
          linewidth: isCurrentActive ? 3.0 : 1.5,
          transparent: true,
          opacity: isCurrentActive ? 0.95 : 0.40,
          depthTest: false, // Draw on top of solids
        });

        const lineObj = new THREE.Line(lineGeom, lineMat);
        lineObj.renderOrder = 1000; // Force draw on top
        group.add(lineObj);

         // Render vertices as small dots/squares (skip curve points like circle edges to prevent node cloud)
         pts.forEach((pt) => {
           if (pt.isCurvePoint) return;
           const vertGeom = new THREE.BoxGeometry(2.5, 2.5, 2.5);
           const vertMat = new THREE.MeshBasicMaterial({
             color: isCurrentActive ? 0x38bdf8 : 0x71717a, // Radiant sky blue or gray nodes
             depthTest: false,
           });
           const vertMesh = new THREE.Mesh(vertGeom, vertMat);
           vertMesh.position.set(pt.x - cx, cy - pt.y, 1.5 + (ly.zOffset || 0));
           vertMesh.renderOrder = 1001;
           group.add(vertMesh);
         });
      };

      if (ly.finalPoints && ly.finalPoints.length >= 2) {
        renderHelperLine(ly.finalPoints, ly.isClosed, isCurrentActive);
      }
      if (ly.paths) {
        ly.paths.forEach((p) => {
          renderHelperLine(p, true, isCurrentActive);
        });
      }
    });

    scene.add(group);
    activeGroupRef.current = group;
  }, [layers, clipEnabled, activeLayerId]);

  return (
    <div className="w-full h-full relative overflow-hidden bg-zinc-950">
      <div ref={containerRef} className="w-full h-full" />
      
      {/* 3D Viewport Title Indicator */}
      <div className="absolute top-3 left-3 bg-zinc-900/80 border border-zinc-800 backdrop-blur px-3 py-1.5 rounded text-xs font-mono text-zinc-300 pointer-events-none flex items-center gap-2 z-10">
        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
        3D Viewport
      </div>

      {/* 3D Surface Selector Controls Overlay */}
      <div className="absolute top-12 left-3 flex flex-col gap-2 z-10">
        <button
          id="toggle-face-select"
          onClick={() => setFaceSelectionMode(!faceSelectionMode)}
          className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-sans font-bold shadow-lg border transition-all cursor-pointer ${
            faceSelectionMode
              ? 'bg-orange-600 border-orange-500 text-white animate-pulse'
              : 'bg-zinc-900/90 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
          }`}
          title="3D model üzerinde düzlemsel bir yüzey seçerek yeni çizim (sketç) katmanı başlatın."
        >
          <MousePointer2 className={`w-3.5 h-3.5 ${faceSelectionMode ? 'text-white' : 'text-orange-500'}`} />
          <span>{faceSelectionMode ? 'Sınır Yüzeyi Seçin (Click Face)' : 'Yüzey Seçerek Yeni Sketç Başlat'}</span>
        </button>

        {faceSelectionMode && hoveredFace && (
          <div className="bg-orange-650/95 text-white border border-orange-500 backdrop-blur-md p-3 rounded-lg text-xs font-mono shadow-xl max-w-[240px] animate-fade-in z-20">
            <div className="font-extrabold flex items-center gap-1.5 border-b border-orange-500/50 pb-1.5 mb-1.5 text-[10px] uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 animate-spin text-yellow-300" />
              <span>Yüzey Algılandı</span>
            </div>
            <div className="space-y-1">
              <div><span className="opacity-80">Gövde:</span> <strong className="font-sans font-extrabold">{hoveredFace.layerName}</strong></div>
              <div><span className="opacity-80">Z Seviyesi:</span> <strong className="text-sm font-semibold text-yellow-300">{hoveredFace.zHeight} mm</strong></div>
            </div>
            <div className="mt-2.5 text-[10px] bg-black/30 p-1.5 rounded text-orange-200 leading-relaxed">
              Bu düz bir çalışma düzlemidir. Seçip isimlendirmek için sol tıklayın!
            </div>
          </div>
        )}
      </div>

      {/* 3D Section Cut Plane Floating Utility Panel */}
      <div 
        id="section-cut-card"
        className="absolute top-3 right-3 z-10 w-64 bg-zinc-900/90 border border-zinc-800/80 backdrop-blur rounded-lg shadow-xl text-zinc-200 text-xs font-sans transition-all duration-205 overflow-hidden"
      >
        {/* Panel Header */}
        <div className="px-3.5 py-2.5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/40">
          <div className="flex items-center gap-1.5 font-bold text-zinc-200">
            <Scissors className="w-3.5 h-3.5 text-rose-450 rotate-90" />
            <span>Section Analysis</span>
          </div>
          <button
            id="section-cut-toggle"
            onClick={() => setClipEnabled(!clipEnabled)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
              clipEnabled 
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' 
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700'
            }`}
          >
            {clipEnabled ? 'ACTIVE' : 'OFF'}
          </button>
        </div>

        {/* Expandable Plane Parameters */}
        {clipEnabled && (
          <div className="p-3.5 space-y-3.5">
            {/* 1. Axis Selection */}
            <div className="space-y-1.5 flex flex-col">
              <span className="text-[10px] font-mono text-zinc-400 font-medium">CUT ORIENTATION:</span>
              <div className="grid grid-cols-3 gap-1">
                <button
                  id="section-axis-x"
                  onClick={() => setClipAxis('X')}
                  className={`py-1.5 rounded font-mono font-bold text-xs transition border cursor-pointer ${
                    clipAxis === 'X'
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400'
                      : 'bg-zinc-800/40 border-zinc-800 hover:bg-zinc-800 text-zinc-400'
                  }`}
                  title="Cut Vertically (along Horizontal coordinate)"
                >
                  X-Axis
                </button>
                <button
                  id="section-axis-y"
                  onClick={() => setClipAxis('Y')}
                  className={`py-1.5 rounded font-mono font-bold text-xs transition border cursor-pointer ${
                    clipAxis === 'Y'
                      ? 'bg-rose-600/20 border-rose-500 text-rose-400'
                      : 'bg-zinc-800/40 border-zinc-800 hover:bg-zinc-800 text-zinc-400'
                  }`}
                  title="Cut Horizontally (along Vertical coordinate)"
                >
                  Y-Axis
                </button>
                <button
                  id="section-axis-z"
                  onClick={() => setClipAxis('Z')}
                  className={`py-1.5 rounded font-mono font-bold text-xs transition border cursor-pointer ${
                    clipAxis === 'Z'
                      ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                      : 'bg-zinc-800/40 border-zinc-800 hover:bg-zinc-800 text-zinc-400'
                  }`}
                  title="Cut Depthwise (along Extruded Depth)"
                >
                  Z-Axis
                </button>
              </div>
            </div>

            {/* 2. Offset Range & Precision Controls */}
            <div className="space-y-1.5 flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-zinc-400 font-medium">PLANE OFFSET (D):</span>
                <div className="flex items-center gap-1.5">
                  <input
                    id="section-cut-offset-input"
                    type="number"
                    value={clipConstant}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val)) {
                        setClipConstant(Math.max(-250, Math.min(250, val)));
                      } else {
                        setClipConstant(0);
                      }
                    }}
                    className="w-12 bg-zinc-950 border border-zinc-800 text-zinc-200 text-center rounded px-1 py-0.5 text-[11px] font-mono outline-none focus:border-blue-500"
                  />
                  <span className="text-[10px] font-mono text-zinc-500 font-bold">mm</span>
                </div>
              </div>

              {/* Slider */}
              <input
                id="section-cut-slider"
                type="range"
                min="-250"
                max="250"
                value={clipConstant}
                onChange={(e) => setClipConstant(parseInt(e.target.value) || 0)}
                className="w-full accent-blue-500 bg-zinc-950 rounded-lg appearance-none h-1 cursor-pointer mt-1"
              />

              {/* Quick incremental fine-tuning clicks */}
              <div className="flex gap-1">
                <button
                  id="section-cut-dec"
                  onClick={() => setClipConstant(prev => Math.max(-250, prev - 10))}
                  className="px-1.5 py-1 bg-zinc-800 border border-zinc-700/60 text-[10px] text-zinc-400 hover:text-white rounded text-center cursor-pointer transition font-mono hover:bg-zinc-750 flex-1"
                  title="Decrease offset by 10mm"
                >
                  -10
                </button>
                <button
                  id="section-cut-dec2"
                  onClick={() => setClipConstant(prev => Math.max(-250, prev - 2))}
                  className="px-1.5 py-1 bg-zinc-800 border border-zinc-700/60 text-[10px] text-zinc-400 hover:text-white rounded text-center cursor-pointer transition font-mono hover:bg-zinc-750 flex-1"
                  title="Decrease offset by 2mm"
                >
                  -2
                </button>
                <button
                  id="section-cut-reset"
                  onClick={() => setClipConstant(0)}
                  className="px-1.5 py-1 bg-zinc-800 border border-zinc-700/60 text-[10px] text-zinc-400 hover:text-white rounded text-center cursor-pointer transition flex items-center justify-center gap-1 font-mono hover:bg-zinc-750 flex-[2]"
                  title="Reset offset cutting location to centroid (0)"
                >
                  <RotateCcw className="w-2.5 h-2.5 text-zinc-400" />
                  <span>Center</span>
                </button>
                <button
                  id="section-cut-inc1"
                  onClick={() => setClipConstant(prev => Math.min(250, prev + 2))}
                  className="px-1.5 py-1 bg-zinc-800 border border-zinc-700/60 text-[10px] text-zinc-400 hover:text-white rounded text-center cursor-pointer transition font-mono hover:bg-zinc-750 flex-1"
                  title="Increase offset by 2mm"
                >
                  +2
                </button>
                <button
                  id="section-cut-inc"
                  onClick={() => setClipConstant(prev => Math.min(250, prev + 10))}
                  className="px-1.5 py-1 bg-zinc-800 border border-zinc-700/60 text-[10px] text-zinc-400 hover:text-white rounded text-center cursor-pointer transition font-mono hover:bg-zinc-750 flex-1"
                  title="Increase offset by 10mm"
                >
                  +10
                </button>
              </div>
            </div>

            {/* 3. Helper Grid & direction flip toggles */}
            <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-mono text-zinc-400 cursor-pointer select-none" htmlFor="toggle-section-helper">
                  SHOW CUTTER GUIDE PLANE
                </label>
                <input
                  id="toggle-section-helper"
                  type="checkbox"
                  checked={showHelper}
                  onChange={() => setShowHelper(!showHelper)}
                  className="w-3.5 h-3.5 rounded bg-zinc-950 accent-blue-500 border-zinc-850 cursor-pointer"
                />
              </div>

              <button
                id="toggle-section-direction"
                onClick={() => setClipInverted(!clipInverted)}
                className="w-full py-1.5 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 rounded text-center transition flex items-center justify-center gap-1.5 font-mono text-zinc-300 font-bold text-[10px]"
                title="Flips the normal face representing cut model visible part"
              >
                <FlipHorizontal className="w-3.5 h-3.5 text-zinc-450" />
                <span>INVERT FACE CUT</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3D Camera Angles Controls */}
      <div className="absolute bottom-3 left-3 z-10 bg-zinc-900/90 border border-zinc-800/85 backdrop-blur-md p-2 rounded-lg flex flex-col gap-1.5 shadow-xl min-w-[150px]">
        <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-400 flex items-center gap-1 font-mono">
          <Eye className="w-3.5 h-3.5 text-blue-500" />
          <span>Camera View Angle</span>
        </div>
        <div className="grid grid-cols-2 gap-1 pt-1.5 border-t border-zinc-800/60 font-mono">
          <button
            onClick={() => {
              setActivePreset('top');
              animateCameraTo(new THREE.Vector3(0, 550, 0.01));
            }}
            className={`px-2 py-1 rounded text-[10px] font-bold transition flex justify-center items-center gap-1 border cursor-pointer ${
              activePreset === 'top'
                ? 'bg-blue-600/25 border-blue-500 text-blue-400 font-bold'
                : 'bg-zinc-850 hover:bg-zinc-800 border-zinc-750 text-zinc-300 hover:text-white'
            }`}
            title="Top View (2D Sketch Plane)"
          >
            <span>TOP</span>
          </button>
          
          <button
            onClick={() => {
              setActivePreset('front');
              animateCameraTo(new THREE.Vector3(0, 0, 550));
            }}
            className={`px-2 py-1 rounded text-[10px] font-bold transition flex justify-center items-center gap-1 border cursor-pointer ${
              activePreset === 'front'
                ? 'bg-blue-600/25 border-blue-500 text-blue-400 font-bold'
                : 'bg-zinc-850 hover:bg-zinc-800 border-zinc-750 text-zinc-300 hover:text-white'
            }`}
            title="Front View"
          >
            <span>FRONT</span>
          </button>

          <button
            onClick={() => {
              setActivePreset('left');
              animateCameraTo(new THREE.Vector3(-550, 0, 0));
            }}
            className={`px-2 py-1 rounded text-[10px] font-bold transition flex justify-center items-center gap-1 border cursor-pointer ${
              activePreset === 'left'
                ? 'bg-blue-600/25 border-blue-500 text-blue-400 font-bold'
                : 'bg-zinc-850 hover:bg-zinc-800 border-zinc-750 text-zinc-300 hover:text-white'
            }`}
            title="Left View"
          >
            <span>LEFT</span>
          </button>

          <button
            onClick={() => {
              setActivePreset('right');
              animateCameraTo(new THREE.Vector3(550, 0, 0));
            }}
            className={`px-2 py-1 rounded text-[10px] font-bold transition flex justify-center items-center gap-1 border cursor-pointer ${
              activePreset === 'right'
                ? 'bg-blue-600/25 border-blue-500 text-blue-400 font-bold'
                : 'bg-zinc-850 hover:bg-zinc-800 border-zinc-750 text-zinc-300 hover:text-white'
            }`}
            title="Right View"
          >
            <span>RIGHT</span>
          </button>
        </div>
        
        <button
          onClick={() => {
            setActivePreset('iso');
            animateCameraTo(new THREE.Vector3(300, 300, 450));
          }}
          className={`w-full mt-0.5 py-1.5 rounded text-[10px] font-mono font-bold transition flex justify-center items-center gap-1 border cursor-pointer ${
            activePreset === 'iso'
              ? 'bg-emerald-600/25 border-emerald-500 text-emerald-400 font-bold'
              : 'bg-zinc-800 hover:bg-zinc-750 border-zinc-700 text-zinc-200'
          }`}
          title="Isometric Perspective 3D View"
        >
          <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
          <span>ISO (Isometric)</span>
        </button>
      </div>

      {/* 3D Orbit, Auto rotation & Mouse guide Controls - Bottom Right Panel */}
      <div className="absolute bottom-3 right-3 z-10 bg-zinc-900/90 border border-zinc-800/85 backdrop-blur-md p-3 rounded-lg flex flex-col gap-2.5 shadow-xl min-w-[200px] max-w-[245px] animate-fade-in font-sans">
        <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-450 flex items-center justify-between border-b border-zinc-800/80 pb-1.5">
          <div className="flex items-center gap-1.5 font-mono text-zinc-300">
            <Compass className="w-4 h-4 text-orange-500 animate-pulse" />
            <span>3D Orbit Controls</span>
          </div>
          <span className="text-[8px] px-1 py-0.5 bg-orange-950/40 text-orange-400 border border-orange-900/40 rounded uppercase font-bold text-right">Interactive</span>
        </div>

        {/* Incremental Manual Orbit Section & Buttons Grid */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] text-zinc-500 font-mono font-bold uppercase tracking-wide">Manual Orbit Keys:</span>
          <div className="grid grid-cols-3 gap-1">
            <div />
            <button
              onClick={() => orbitCameraIncrementally('up')}
              className="py-1 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-zinc-550 text-zinc-200 hover:text-white rounded text-center cursor-pointer transition flex items-center justify-center"
              title="Rotate View Up"
            >
              <span className="text-xs font-bold font-mono">▲</span>
            </button>
            <div />

            <button
              onClick={() => orbitCameraIncrementally('left')}
              className="py-1 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-zinc-550 text-zinc-200 hover:text-white rounded text-center cursor-pointer transition flex items-center justify-center"
              title="Rotate View Left"
            >
              <span className="text-xs font-bold font-mono">◀</span>
            </button>
            <button
              onClick={() => {
                // Reset/Recut the controls target to model origin
                const controls = controlsRef.current;
                const camera = cameraRef.current;
                if (controls && camera) {
                  controls.target.set(0, 0, 0);
                  camera.lookAt(0, 0, 0);
                  controls.update();
                }
              }}
              className="py-0.5 bg-zinc-850 hover:bg-zinc-805 border border-zinc-750 text-[9px] text-zinc-450 hover:text-zinc-250 rounded text-center cursor-pointer transition font-mono uppercase tracking-tight flex items-center justify-center leading-none"
              title="Reset view rotation center-point pivot back to coordinate center"
            >
              Pivot
            </button>
            <button
              onClick={() => orbitCameraIncrementally('right')}
              className="py-1 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-zinc-550 text-zinc-200 hover:text-white rounded text-center cursor-pointer transition flex items-center justify-center"
              title="Rotate View Right"
            >
              <span className="text-xs font-bold font-mono">▶</span>
            </button>

            <div />
            <button
              onClick={() => orbitCameraIncrementally('down')}
              className="py-1 bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-zinc-550 text-zinc-200 hover:text-white rounded text-center cursor-pointer transition flex items-center justify-center"
              title="Rotate View Down"
            >
              <span className="text-xs font-bold font-mono">▼</span>
            </button>
            <div />
          </div>
        </div>

        {/* Automatic turntable Rotation Settings */}
        <div className="border-t border-zinc-800/80 pt-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="toggle-auto-orbit" className="text-[9px] font-mono font-bold text-zinc-450 uppercase cursor-pointer select-none">
              Auto Turntable (Pitch):
            </label>
            <button
              id="toggle-auto-orbit"
              onClick={() => setAutoRotate(!autoRotate)}
              className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono border transition-all cursor-pointer ${
                autoRotate
                  ? 'bg-orange-650/40 border-orange-500 text-orange-400 animate-pulse'
                  : 'bg-zinc-800 hover:bg-zinc-750 border-zinc-700 text-zinc-400 hover:text-white'
              }`}
            >
              {autoRotate ? 'RUNNING' : 'DISABLED'}
            </button>
          </div>

          {autoRotate && (
            <div className="flex flex-col gap-0.5 animate-fade-in pl-1">
              <div className="flex justify-between items-center text-[8px] font-mono text-zinc-500">
                <span>ROTATION SPEED:</span>
                <span className="text-orange-400 font-bold">{autoRotateSpeed.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="8.0"
                step="0.5"
                value={autoRotateSpeed}
                onChange={(e) => setAutoRotateSpeed(parseFloat(e.target.value) || 2.0)}
                className="w-full accent-orange-500 bg-zinc-950 rounded-lg appearance-none h-1 cursor-pointer"
              />
            </div>
          )}
        </div>

        {/* Interactive Guide Mouse Help area */}
        <div className="border-t border-zinc-800/80 pt-1.5 flex flex-col gap-1 select-none">
          <div className="flex items-center gap-1.5 text-[8.5px] font-mono font-bold text-zinc-500 uppercase tracking-wide">
            <HelpCircle className="w-3 h-3 text-zinc-505 shrink-0" />
            <span>Mouse Gestures Guide</span>
          </div>
          <div className="space-y-0.5 pl-1.5 text-[8.5px] font-mono text-zinc-450 leading-relaxed">
            <div className="flex items-center gap-1">
              <span className="text-orange-500">左</span>
              <span>Left Click + Drag : Orbit (Döndür)</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-orange-500">右</span>
              <span>Right Click + Drag : Pan (Kaydır)</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-orange-500">輪</span>
              <span>Scroll Wheel : Zoom (Yakınlaş)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
