import * as THREE from 'three';
import { FishSpecies } from '../types/game';

const scaleTextureCache = new Map<string, THREE.CanvasTexture>();

function createProceduralFishTexture(
  species: FishSpecies,
  maxAnisotropy = 4,
): THREE.CanvasTexture {
  const cacheKey = `${species.id}_${species.bodyColor}_${species.bellyColor}_${species.patternColor}`;
  const existing = scaleTextureCache.get(cacheKey);
  if (existing) return existing;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const topHex = `#${species.bodyColor.toString(16).padStart(6, '0')}`;
  const midHex = `#${species.patternColor.toString(16).padStart(6, '0')}`;
  const bellyHex = `#${species.bellyColor.toString(16).padStart(6, '0')}`;

  // Dorsal-to-ventral natural countershading gradient
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0.0, midHex);
  grad.addColorStop(0.38, topHex);
  grad.addColorStop(0.76, bellyHex);
  grad.addColorStop(1.0, bellyHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle overlapping fish scale arcs
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1.2;
  for (let row = 0; row < 10; row++) {
    const y = 10 + row * 11;
    const offset = (row % 2) * 8;
    for (let col = 0; col < 18; col++) {
      const x = offset + col * 16;
      ctx.beginPath();
      ctx.arc(x, y, 7, -Math.PI * 0.45, Math.PI * 0.45);
      ctx.stroke();
    }
  }

  // Lateral line & natural markings (parr marks / starry spots)
  ctx.fillStyle = midHex;
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 9; i++) {
    const sx = 30 + i * 24;
    const sy = 44 + Math.sin(i * 1.3) * 8;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 6, 12, 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  if (species.glowColor) {
    ctx.fillStyle = `#${species.glowColor.toString(16).padStart(6, '0')}`;
    ctx.globalAlpha = 0.65;
    for (let i = 0; i < 14; i++) {
      const gx = 20 + ((i * 37) % 215);
      const gy = 22 + ((i * 29) % 52);
      ctx.beginPath();
      ctx.arc(gx, gy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;

  scaleTextureCache.set(cacheKey, tex);
  return tex;
}

export interface AnimatedFishRig {
  root: THREE.Group;
  tailPivot: THREE.Group;
  pectoralL: THREE.Mesh;
  pectoralR: THREE.Mesh;
  haloRing?: THREE.Mesh;
}

/**
 * Builds an 8–11 part composite procedural 3D fish model with distinct roughness/metalness contrast,
 * anatomical body taper, extruded beveled fins, 3D eyes, gill plates, and species-specific traits.
 */
export function buildCompositeFishModel(
  targetGroup: THREE.Group,
  species: FishSpecies,
  weightScale = 1.0,
  maxAnisotropy = 4,
): AnimatedFishRig {
  // Dispose previous children safely (except cached textures)
  while (targetGroup.children.length > 0) {
    targetGroup.remove(targetGroup.children[0]);
  }

  const root = new THREE.Group();
  const isRay = species.bodyStyle === 'ray';
  const isLeviathan = species.bodyStyle === 'leviathan';
  const isCarp = species.bodyStyle === 'carp';
  const isTuna = species.bodyStyle === 'tuna';

  const bodyTexture = createProceduralFishTexture(species, maxAnisotropy);

  // 1. Primary Silhouette: Sculpted Fuselage (wet clearcoat PBR scales)
  const bodyMat = new THREE.MeshPhysicalMaterial({
    map: bodyTexture,
    roughness: 0.22,
    metalness: species.isGuardian ? 0.45 : 0.18,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    emissive: species.glowColor ?? 0x000000,
    emissiveIntensity: species.rarity === 'UR' ? 0.28 : species.isGuardian ? 0.14 : 0.04,
  });

  //Fin Material (contrasting roughness >= 0.25 from glossy body per Three.js studio directive)
  const finMat = new THREE.MeshStandardMaterial({
    color: species.finColor,
    roughness: 0.52,
    metalness: 0.08,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    emissive: species.glowColor ?? 0x000000,
    emissiveIntensity: species.glowColor ? 0.22 : 0,
  });

  const gillMat = new THREE.MeshStandardMaterial({
    color: species.patternColor,
    roughness: 0.35,
    metalness: 0.4,
  });

  // Construct anatomical fish torso by tapering a high-segment sphere along X (length)
  const bodyGeo = new THREE.SphereGeometry(0.32, 32, 24);
  const posAttr = bodyGeo.attributes.position;
  const lengthMul = isLeviathan ? 2.75 : isTuna ? 2.25 : isRay ? 1.55 : 2.05;
  const heightMul = isRay ? 0.28 : isCarp || species.bodyStyle === 'bass' ? 1.12 : 0.88;
  const widthMul = isRay ? 1.95 : 0.52;

  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i); // -0.32 (tail) to +0.32 (head)
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const normX = x / 0.32; // -1 to +1

    // Taper sharply toward caudal peduncle (-1) and smoothly toward snout (+1)
    const tailTaper = normX < 0 ? THREE.MathUtils.lerp(1.0, 0.28, Math.pow(-normX, 1.35)) : 1.0;
    const headTaper = normX > 0.35 ? THREE.MathUtils.lerp(1.0, 0.55, (normX - 0.35) / 0.65) : 1.0;
    const profile = tailTaper * headTaper;

    posAttr.setXYZ(
      i,
      x * lengthMul,
      y * heightMul * profile,
      z * widthMul * profile,
    );
  }
  bodyGeo.computeVertexNormals();

  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  root.add(bodyMesh);

  const headX = 0.32 * lengthMul;
  const tailX = -0.32 * lengthMul;

  // 2. Lower Jaw Accent
  const jawGeo = new THREE.ConeGeometry(0.08, 0.22, 12);
  jawGeo.rotateZ(-Math.PI / 2);
  jawGeo.scale(1, 0.55, 0.85);
  const jawMesh = new THREE.Mesh(jawGeo, gillMat);
  jawMesh.position.set(headX - 0.04, -0.055 * heightMul, 0);
  root.add(jawMesh);

  // 3 & 4. Sculpted Bilateral Gill Plates (Operculum)
  [-1, 1].forEach((side) => {
    const gillGeo = new THREE.SphereGeometry(0.11, 14, 12, 0, Math.PI);
    gillGeo.scale(0.85, 1.15 * heightMul, 0.22);
    const gill = new THREE.Mesh(gillGeo, gillMat);
    gill.position.set(headX * 0.52, -0.01, side * (0.145 * (isRay ? 1.5 : 1.0)));
    gill.rotation.y = side > 0 ? 0.18 : -0.18;
    root.add(gill);
  });

  // 5 & 6. Bilateral Glossy 3D Eyes (Gold/Silver Rim + Obsidian Pupil)
  const scleraMat = new THREE.MeshStandardMaterial({
    color: 0xfde047,
    roughness: 0.15,
    metalness: 0.75,
  });
  const pupilMat = new THREE.MeshPhysicalMaterial({
    color: 0x020617,
    roughness: 0.05,
    clearcoat: 1.0,
  });

  [-1, 1].forEach((side) => {
    const eyeGroup = new THREE.Group();
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 12), scleraMat);
    iris.scale.z = 0.45;
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 12), pupilMat);
    pupil.position.z = side * 0.012;
    eyeGroup.add(iris, pupil);

    const eyeZ = isRay ? side * 0.24 : side * 0.115;
    const eyeY = isRay ? 0.065 : 0.055 * heightMul;
    eyeGroup.position.set(headX * 0.68, eyeY, eyeZ);
    root.add(eyeGroup);
  });

  // 7. Extruded Beveled Dorsal Fin (Secondary Read)
  const dorsalShape = new THREE.Shape();
  dorsalShape.moveTo(0.16, 0);
  dorsalShape.quadraticCurveTo(0.02, isLeviathan ? 0.36 : 0.24, -0.22, isTuna ? 0.28 : 0.16);
  dorsalShape.lineTo(-0.26, 0);
  dorsalShape.closePath();

  const dorsalGeo = new THREE.ExtrudeGeometry(dorsalShape, {
    depth: 0.014,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 2,
  });
  dorsalGeo.center();
  const dorsalMesh = new THREE.Mesh(dorsalGeo, finMat);
  dorsalMesh.position.set(-0.04, 0.26 * heightMul, 0);
  dorsalMesh.castShadow = true;
  root.add(dorsalMesh);

  // 8. Anal / Ventral Fin
  const analShape = new THREE.Shape();
  analShape.moveTo(0.08, 0);
  analShape.quadraticCurveTo(-0.04, -0.15, -0.14, -0.09);
  analShape.lineTo(-0.16, 0);
  analShape.closePath();
  const analGeo = new THREE.ExtrudeGeometry(analShape, {
    depth: 0.01,
    bevelEnabled: false,
  });
  const analMesh = new THREE.Mesh(analGeo, finMat);
  analMesh.position.set(-0.18 * lengthMul, -0.18 * heightMul, -0.005);
  root.add(analMesh);

  // 9 & 10. Animated Left & Right Pectoral Fins (or Manta Wings for Ray)
  const pecShape = new THREE.Shape();
  if (isRay) {
    pecShape.moveTo(0.24, 0);
    pecShape.quadraticCurveTo(0.05, 0.62, -0.28, 0.42);
    pecShape.quadraticCurveTo(-0.22, 0.14, -0.24, 0);
    pecShape.closePath();
  } else {
    pecShape.moveTo(0.08, 0);
    pecShape.quadraticCurveTo(-0.02, 0.22, -0.14, 0.16);
    pecShape.lineTo(-0.1, 0);
    pecShape.closePath();
  }
  const pecGeo = new THREE.ExtrudeGeometry(pecShape, {
    depth: 0.01,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 1,
  });
  pecGeo.rotateX(Math.PI / 2);

  const pectoralL = new THREE.Mesh(pecGeo, finMat);
  pectoralL.position.set(headX * 0.25, -0.05 * heightMul, 0.11);
  pectoralL.rotation.z = -0.2;

  const pectoralR = new THREE.Mesh(pecGeo.clone(), finMat);
  pectoralR.scale.z = -1;
  pectoralR.position.set(headX * 0.25, -0.05 * heightMul, -0.11);
  pectoralR.rotation.z = -0.2;

  root.add(pectoralL, pectoralR);

  // 11. Animated Forked Caudal (Tail) Fin on Hinge Pivot
  const tailPivot = new THREE.Group();
  tailPivot.position.set(tailX + 0.04, 0, 0);

  const tailShape = new THREE.Shape();
  const tailSpan = isLeviathan ? 0.42 : isTuna ? 0.36 : 0.28;
  const tailLen = isLeviathan ? 0.46 : 0.32;
  tailShape.moveTo(0, 0.04);
  tailShape.quadraticCurveTo(-tailLen * 0.55, tailSpan, -tailLen, tailSpan * 0.92);
  tailShape.quadraticCurveTo(-tailLen * 0.52, 0, -tailLen, -tailSpan * 0.92);
  tailShape.quadraticCurveTo(-tailLen * 0.55, -tailSpan, 0, -0.04);
  tailShape.closePath();

  const tailGeo = new THREE.ExtrudeGeometry(tailShape, {
    depth: 0.014,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
  });
  tailGeo.translate(0, 0, -0.007);
  const tailMesh = new THREE.Mesh(tailGeo, finMat);
  tailMesh.castShadow = true;
  tailPivot.add(tailMesh);
  root.add(tailPivot);

  // Optional 12. Dragon Whiskers (Barbels) for Carp / Leviathan + Sacred Crest Halo for UR
  let haloRing: THREE.Mesh | undefined;
  if (isCarp || isLeviathan) {
    const whiskerMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.25,
      metalness: 0.8,
      emissive: species.glowColor ?? 0xb45309,
      emissiveIntensity: 0.3,
    });
    [-1, 1].forEach((side) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(headX * 0.92, -0.02, side * 0.06),
        new THREE.Vector3(headX * 0.75, -0.1, side * 0.16),
        new THREE.Vector3(headX * 0.42, -0.16, side * 0.24),
      ]);
      const whiskerGeo = new THREE.TubeGeometry(curve, 14, 0.008, 6, false);
      const whisker = new THREE.Mesh(whiskerGeo, whiskerMat);
      root.add(whisker);
    });
  }

  if (species.rarity === 'UR' || species.isGuardian) {
    const ringMat = new THREE.MeshBasicMaterial({
      color: species.glowColor ?? 0xfbbf24,
      transparent: true,
      opacity: species.rarity === 'UR' ? 0.55 : 0.28,
      side: THREE.DoubleSide,
    });
    haloRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.455, 40), ringMat);
    haloRing.rotation.y = Math.PI / 2;
    haloRing.position.set(headX * 0.3, 0.06, 0);
    root.add(haloRing);
  }

  const finalScale = THREE.MathUtils.clamp(weightScale, 0.65, 2.15);
  root.scale.setScalar(finalScale);
  targetGroup.add(root);

  return {
    root,
    tailPivot,
    pectoralL,
    pectoralR,
    haloRing,
  };
}
