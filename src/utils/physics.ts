import * as THREE from 'three';

export interface SolidPhysicsProperties {
  volume: number;              // in mm³
  mass: number;                // in grams
  centerOfMass: THREE.Vector3; // in mm, absolute CAD coordinate system
  inertiaTensorCoM: {          // in g * mm² relative to Center of Mass
    Ixx: number; Iyy: number; Izz: number;
    Ixy: number; Iyz: number; Ixz: number;
  };
  principalMoments: [number, number, number]; // in g * mm² (eigenvalues of inertiaTensorCoM)
}

/**
 * Analytical eigenvalue solver for a 3x3 real symmetric matrix (trigonometric method).
 * Solves the characteristic cubic equation for:
 * [ Ixx  Ixy  Ixz ]
 * [ Ixy  Iyy  Iyz ]
 * [ Ixz  Iyz  Izz ]
 */
export function getEigenvalues3x3(
  Ixx: number, Iyy: number, Izz: number,
  Ixy: number, Iyz: number, Ixz: number
): [number, number, number] {
  const m = (Ixx + Iyy + Izz) / 3;

  // Define matrix B = I - m * Identity
  const bxx = Ixx - m;
  const byy = Iyy - m;
  const bzz = Izz - m;
  const bxy = Ixy;
  const byz = Iyz;
  const bxz = Ixz;

  // Calculate q = det(B) / 2
  const q = (
    bxx * (byy * bzz - byz * byz) -
    bxy * (bxy * bzz - byz * bxz) +
    bxz * (bxy * byz - byy * bxz)
  ) / 2;

  // Calculate p = tr(B^2) / 6
  const p = (
    bxx * bxx + byy * byy + bzz * bzz +
    2 * (bxy * bxy + byz * byz + bxz * bxz)
  ) / 6;

  const p_sqrt = Math.sqrt(p);

  if (p < 1e-12) {
    return [Ixx, Iyy, Izz].sort((x, y) => x - y) as [number, number, number];
  }

  // Define cos(3 * theta) = q / (p ^ 1.5)
  let phi = q / (p * p_sqrt);
  if (phi > 1) phi = 1;
  else if (phi < -1) phi = -1;

  const theta = Math.acos(phi) / 3;

  const eig0 = m + 2 * p_sqrt * Math.cos(theta);
  const eig1 = m + 2 * p_sqrt * Math.cos(theta + (2 * Math.PI) / 3);
  const eig2 = m + 2 * p_sqrt * Math.cos(theta + (4 * Math.PI) / 3);

  return [eig0, eig1, eig2].sort((x, y) => x - y) as [number, number, number];
}

/**
 * Exact analytical integration over 3D watertight triangle mesh.
 * Computes Volume, Mass, Center of Mass, and Moments of Inertia Tensor relative to Center of Mass.
 * 
 * @param geometry The THREE.BufferGeometry of the solid mesh
 * @param density g/cm³ (e.g. 7.85 for steel, 2.70 for aluminum)
 * @param zOffset Z translation offset of the mesh
 * @param cx Midpoint X offset applied under ThreeViewport rendering
 * @param cy Midpoint Y offset applied under ThreeViewport rendering
 */
export function calculateMeshPhysicalProperties(
  geometry: THREE.BufferGeometry,
  densityGcm3: number,
  zOffset: number,
  cx: number,
  cy: number
): SolidPhysicsProperties | null {
  return calculateAssemblyPhysicalProperties([{ geometry, zOffset }], densityGcm3, cx, cy);
}

/**
 * Exact analytical integration over assembly of 3D watertight triangle meshes.
 * Calculates combined Center of Mass (CoM) and Inertia Tensor relative to combined CoM.
 */
export function calculateAssemblyPhysicalProperties(
  items: { geometry: THREE.BufferGeometry; zOffset: number }[],
  densityGcm3: number,
  cx: number,
  cy: number
): SolidPhysicsProperties | null {
  if (items.length === 0) return null;

  const densityGmm3 = densityGcm3 / 1000;
  let totalVolume = 0;
  const comRawSum = new THREE.Vector3(0, 0, 0);

  let Jxx = 0;
  let Jyy = 0;
  let Jzz = 0;
  let Jxy = 0;
  let Jyz = 0;
  let Jxz = 0;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  items.forEach(({ geometry, zOffset }) => {
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!positionAttr || positionAttr.count === 0) return;

    const indexAttr = geometry.getIndex();
    const vertexCount = positionAttr.count;

    const transformToAbs = (v: THREE.Vector3) => {
      v.set(
        v.x + cx,
        cy - v.y,
        v.z + zOffset
      );
    };

    const processTriangle = (v0: THREE.Vector3, v1: THREE.Vector3, v2: THREE.Vector3) => {
      // Signed volume of the tetrahedron with absolute origin
      const signedVol6 = (
        v0.x * (v1.y * v2.z - v1.z * v2.y) -
        v0.y * (v1.x * v2.z - v1.z * v2.x) +
        v0.z * (v1.x * v2.y - v1.y * v2.x)
      );
      const v_tetra = signedVol6 / 6.0;

      totalVolume += v_tetra;

      // Contribution to first moments (for Centroid)
      comRawSum.x += v_tetra * (v0.x + v1.x + v2.x) / 4.0;
      comRawSum.y += v_tetra * (v0.y + v1.y + v2.y) / 4.0;
      comRawSum.z += v_tetra * (v0.z + v1.z + v2.z) / 4.0;

      // Contribution to second moments
      const val20 = v_tetra / 20.0;

      Jxx += val20 * (v0.x * v0.x + v1.x * v1.x + v2.x * v2.x + (v0.x + v1.x + v2.x) * (v0.x + v1.x + v2.x));
      Jyy += val20 * (v0.y * v0.y + v1.y * v1.y + v2.y * v2.y + (v0.y + v1.y + v2.y) * (v0.y + v1.y + v2.y));
      Jzz += val20 * (v0.z * v0.z + v1.z * v1.z + v2.z * v2.z + (v0.z + v1.z + v2.z) * (v0.z + v1.z + v2.z));

      Jxy += val20 * (v0.x * v0.y + v1.x * v1.y + v2.x * v2.y + (v0.x + v1.x + v2.x) * (v0.y + v1.y + v2.y));
      Jyz += val20 * (v0.y * v0.z + v1.y * v1.z + v2.y * v2.z + (v0.y + v1.y + v2.y) * (v0.z + v1.z + v2.z));
      Jxz += val20 * (v0.x * v0.z + v1.x * v1.z + v2.x * v2.z + (v0.x + v1.x + v2.x) * (v0.z + v1.z + v2.z));
    };

    if (indexAttr) {
      const indexCount = indexAttr.count;
      for (let i = 0; i < indexCount; i += 3) {
        const idx0 = indexAttr.array[i];
        const idx1 = indexAttr.array[i + 1];
        const idx2 = indexAttr.array[i + 2];

        a.fromBufferAttribute(positionAttr, idx0);
        b.fromBufferAttribute(positionAttr, idx1);
        c.fromBufferAttribute(positionAttr, idx2);

        transformToAbs(a);
        transformToAbs(b);
        transformToAbs(c);

        processTriangle(a, b, c);
      }
    } else {
      for (let i = 0; i < vertexCount; i += 3) {
        a.fromBufferAttribute(positionAttr, i);
        b.fromBufferAttribute(positionAttr, i + 1);
        c.fromBufferAttribute(positionAttr, i + 2);

        transformToAbs(a);
        transformToAbs(b);
        transformToAbs(c);

        processTriangle(a, b, c);
      }
    }
  });

  if (Math.abs(totalVolume) < 1e-4) {
    return null;
  }

  // Combined center of mass in absolute CAD system
  const centerOfMass = new THREE.Vector3(
    comRawSum.x / totalVolume,
    comRawSum.y / totalVolume,
    comRawSum.z / totalVolume
  );

  const vol = Math.abs(totalVolume);
  const mx = centerOfMass.x;
  const my = centerOfMass.y;
  const mz = centerOfMass.z;

  // Shift second moments from absolute origin to Center of Mass
  const Jxx_com = Jxx - totalVolume * mx * mx;
  const Jyy_com = Jyy - totalVolume * my * my;
  const Jzz_com = Jzz - totalVolume * mz * mz;

  const Jxy_com = Jxy - totalVolume * mx * my;
  const Jyz_com = Jyz - totalVolume * my * mz;
  const Jxz_com = Jxz - totalVolume * mx * mz;

  // Combined Mass in grams
  const mass = vol * densityGmm3;

  // Components of symmetric Inertia Tensor relative to CoM:
  const Ixx = densityGmm3 * (Jyy_com + Jzz_com);
  const Iyy = densityGmm3 * (Jxx_com + Jzz_com);
  const Izz = densityGmm3 * (Jxx_com + Jyy_com);

  const Ixy = -densityGmm3 * Jxy_com;
  const Iyz = -densityGmm3 * Jyz_com;
  const Ixz = -densityGmm3 * Jxz_com;

  // Principal moments of inertia (eigenvalues)
  const principalMoments = getEigenvalues3x3(Ixx, Iyy, Izz, Ixy, Iyz, Ixz);

  return {
    volume: vol,
    mass,
    centerOfMass,
    inertiaTensorCoM: { Ixx, Iyy, Izz, Ixy, Iyz, Ixz },
    principalMoments
  };
}
