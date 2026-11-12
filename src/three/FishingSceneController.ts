import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CaughtFishInstance,
  FishingState,
  FishSpecies,
  LiveFishingHudState,
  SaveSlotData,
  TimeOfDay,
  WaterZoneId,
  WeatherType,
} from '../types/game';
import { LINES, LURES, REELS, RODS, WATER_ZONES } from '../data/gameData';
import { AnimatedFishRig, buildCompositeFishModel } from './proceduralFish';
import { createCaughtInstance, rollFishEncounter } from '../utils/storage';
import { soundEngine } from '../audio/soundEngine';

// Pre-allocated math helpers at module scope (Zero GC in render loop)
const _rodTipWorld = new THREE.Vector3();
const _targetCamPos = new THREE.Vector3();
const _targetLookAt = new THREE.Vector3();
const _dummyObj = new THREE.Object3D();
const _tempColor = new THREE.Color();

interface RippleEntry {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  speed: number;
  maxAge: number;
}

interface DropletEntry {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface UnderwaterSwimmer {
  x: number;
  z: number;
  depth: number;
  angle: number;
  speed: number;
  scale: number;
  turnRate: number;
}

export interface FishingSceneCallbacks {
  onHudUpdate: (hud: LiveFishingHudState) => void;
  onFishCaught: (caught: CaughtFishInstance) => void;
  onNotice: (message: string, tone?: 'info' | 'warning' | 'success') => void;
}

export function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export class FishingSceneController {
  private container: HTMLElement;
  private callbacks: FishingSceneCallbacks;
  private saveData: SaveSlotData;

  private readonly isSoftwareGl: boolean;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock = new THREE.Clock();
  private frameId = 0;
  private isDisposed = false;

  // Lighting & Sky
  private sky: Sky;
  private sunPosition = new THREE.Vector3();
  private dirLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private lanternLight: THREE.PointLight;
  private currentLookAt = new THREE.Vector3(0, 1.0, -15);

  // Water & Biome Groups
  private waterGeo: THREE.PlaneGeometry;
  private waterMat: THREE.MeshPhysicalMaterial;
  private waterMesh: THREE.Mesh;
  private dockGroup = new THREE.Group();
  private biomeGroup = new THREE.Group();
  private woodMat: THREE.MeshStandardMaterial;
  private lanternBulbMat: THREE.MeshBasicMaterial;

  // Weather & Night Starfield / Rain / Fireflies
  private starsPoints: THREE.Points;
  private rainLines: THREE.LineSegments;
  private rainPositions: Float32Array;
  private firefliesPoints: THREE.Points;
  private fireflyPositions: Float32Array;

  // Underwater ambient fish shadows (InstancedMesh)
  private swimmerCount = 22;
  private swimmerInstanced: THREE.InstancedMesh;
  private swimmers: UnderwaterSwimmer[] = [];

  // Rod, Reel, Bobber, Aim Ring & Line
  private rodGroup = new THREE.Group();
  private rodPivot = new THREE.Group();
  private rodSegments: THREE.Group[] = [];
  private rodTipAnchor = new THREE.Object3D();
  private reelCrank = new THREE.Group();
  private rodBlankMat: THREE.MeshPhysicalMaterial;
  private rodAccentMat: THREE.MeshStandardMaterial;
  private rodHandleMat: THREE.MeshStandardMaterial;
  private reelSpoolMat: THREE.MeshStandardMaterial;

  private bobberGroup = new THREE.Group();
  private bobberTopMat: THREE.MeshStandardMaterial;
  private bobberAntennaMat: THREE.MeshBasicMaterial;
  private aimRingMesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  private readonly LINE_POINTS = 40;
  private linePositions: Float32Array;
  private lineGeo: THREE.BufferGeometry;
  private lineMat: THREE.LineBasicMaterial;
  private fishingLine: THREE.Line;

  // Ripples & Splash Droplets Pool
  private rippleGeo: THREE.RingGeometry;
  private ripples: RippleEntry[] = [];
  private dropletCount = 42;
  private dropletInstanced: THREE.InstancedMesh;
  private droplets: DropletEntry[] = [];

  // Active 3D Fish Model (for Reeling Jumps & Caught Showcase)
  private fishMeshGroup = new THREE.Group();
  private activeFishRig: AnimatedFishRig | null = null;

  // Fishing State & Physics Variables
  private gameState: FishingState = FishingState.IDLE;
  private uiBlocked = false;
  private isInputDown = false;
  private aimAngle = 0; // radians, -0.42 to +0.42
  private targetAimAngle = 0;
  private castPower = 0;
  private castChargeDir = 1;

  private bobberVelocity = new THREE.Vector3();
  private biteTimer = 0;
  private nibbleTimer = 0;
  private hookWindowTimer = 0;

  private currentFish: FishSpecies | null = null;
  private pendingCaughtInstance: CaughtFishInstance | null = null;
  private lineTension = 30;
  private fishDistance = 20;
  private maxCastDistance = 20;
  private fishLateralX = 0;
  private fishLateralDir = 1;
  private fishStamina = 100;
  private maxFishStamina = 100;
  private fishBurstTimer = 0;
  private isFishBursting = false;
  private fishJumpPhase = -1; // >= 0 when leaping out of water
  private reelRotationSpeed = 0;
  private hudSyncAccumulator = 0;

  constructor(
    container: HTMLElement,
    initialSave: SaveSlotData,
    callbacks: FishingSceneCallbacks,
  ) {
    this.container = container;
    this.saveData = initialSave;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    // 1. Scene & Camera
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x1e293b, 0.0055);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 900);
    this.camera.position.set(0, 2.35, 6.2);
    this.camera.lookAt(this.currentLookAt);

    // 2. Renderer with Software-WebGL Guard & ACES Filmic Pipeline
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Context loss safety
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
    });

    // 3. Studio Environment Reflection + Sky
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmremGenerator.dispose();

    this.sky = new Sky();
    this.sky.scale.setScalar(900);
    this.scene.add(this.sky);

    // 4. Balanced 3-Point Outdoor Lighting Rig
    this.dirLight = new THREE.DirectionalLight(0xffdfa5, 2.6);
    this.dirLight.castShadow = !this.isSoftwareGl;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 150;
    const d = 26;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight);

    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x0f172a, 0.7);
    this.scene.add(this.hemiLight);

    this.lanternLight = new THREE.PointLight(0xfbbf24, 1.8, 12, 1.8);
    this.lanternLight.position.set(-1.55, 1.95, 2.2);
    this.scene.add(this.lanternLight);

    // 5. High-Precision Dynamic Water Surface
    const segs = this.isSoftwareGl ? 96 : 160;
    this.waterGeo = new THREE.PlaneGeometry(300, 300, segs, segs);
    this.waterGeo.rotateX(-Math.PI / 2);

    this.waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x064e3b,
      emissive: 0x022c22,
      emissiveIntensity: 0.22,
      roughness: 0.12,
      metalness: 0.12,
      transmission: this.isSoftwareGl ? 0 : 0.62,
      transparent: true,
      opacity: this.isSoftwareGl ? 0.88 : 1.0,
      ior: 1.333,
      reflectivity: 0.9,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    });
    this.waterMesh = new THREE.Mesh(this.waterGeo, this.waterMat);
    this.waterMesh.receiveShadow = true;
    this.scene.add(this.waterMesh);

    // 6. Wooden Pier & Lantern Prop
    this.woodMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a21,
      roughness: 0.85,
      metalness: 0.05,
    });
    this.lanternBulbMat = new THREE.MeshBasicMaterial({ color: 0xfde68a });
    this.buildDock();
    this.scene.add(this.dockGroup);
    this.scene.add(this.biomeGroup);

    // 7. Stars, Rain & Fireflies
    const starGeo = new THREE.BufferGeometry();
    const starCount = 450;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 280 + Math.random() * 120;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.46;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi) + 12;
      starPos[i * 3 + 2] = -Math.abs(r * Math.sin(phi) * Math.sin(theta));
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starsPoints = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xf8fafc,
        size: 1.4,
        transparent: true,
        opacity: 0,
      }),
    );
    this.scene.add(this.starsPoints);

    const rainCount = 320;
    this.rainPositions = new Float32Array(rainCount * 6);
    for (let i = 0; i < rainCount; i++) {
      const rx = (Math.random() - 0.5) * 48;
      const ry = Math.random() * 24;
      const rz = 8 - Math.random() * 55;
      this.rainPositions[i * 6] = rx;
      this.rainPositions[i * 6 + 1] = ry;
      this.rainPositions[i * 6 + 2] = rz;
      this.rainPositions[i * 6 + 3] = rx - 0.08;
      this.rainPositions[i * 6 + 4] = ry - 0.75;
      this.rainPositions[i * 6 + 5] = rz;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    this.rainLines = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.42,
      }),
    );
    this.rainLines.visible = false;
    this.scene.add(this.rainLines);

    const ffCount = 55;
    this.fireflyPositions = new Float32Array(ffCount * 3);
    for (let i = 0; i < ffCount; i++) {
      this.fireflyPositions[i * 3] = (Math.random() - 0.5) * 34;
      this.fireflyPositions[i * 3 + 1] = 0.5 + Math.random() * 3.5;
      this.fireflyPositions[i * 3 + 2] = 4 - Math.random() * 38;
    }
    const ffGeo = new THREE.BufferGeometry();
    ffGeo.setAttribute('position', new THREE.BufferAttribute(this.fireflyPositions, 3));
    this.firefliesPoints = new THREE.Points(
      ffGeo,
      new THREE.PointsMaterial({
        color: 0x5eead4,
        size: 0.22,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.scene.add(this.firefliesPoints);

    // 8. Underwater Swimming Fish Shadows (InstancedMesh)
    const shadowGeo = new THREE.ConeGeometry(0.16, 0.85, 8);
    shadowGeo.rotateX(Math.PI / 2);
    shadowGeo.scale(1, 0.35, 1);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x021713,
      transparent: true,
      opacity: 0.45,
    });
    this.swimmerInstanced = new THREE.InstancedMesh(
      shadowGeo,
      shadowMat,
      this.swimmerCount,
    );
    this.swimmerInstanced.frustumCulled = false;
    for (let i = 0; i < this.swimmerCount; i++) {
      this.swimmers.push({
        x: (Math.random() - 0.5) * 36,
        z: -4 - Math.random() * 38,
        depth: -0.45 - Math.random() * 0.7,
        angle: Math.random() * Math.PI * 2,
        speed: 0.7 + Math.random() * 1.1,
        scale: 0.7 + Math.random() * 1.15,
        turnRate: (Math.random() - 0.5) * 0.6,
      });
    }
    this.scene.add(this.swimmerInstanced);

    // 9. Composite 12-Segment Rod & Spinning Reel
    this.rodHandleMat = new THREE.MeshStandardMaterial({
      color: 0xd4a373,
      roughness: 0.75,
    });
    this.rodBlankMat = new THREE.MeshPhysicalMaterial({
      color: 0x111827,
      roughness: 0.2,
      metalness: 0.8,
      clearcoat: 1.0,
    });
    this.rodAccentMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.25,
      metalness: 0.9,
    });
    this.reelSpoolMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.22,
      metalness: 0.9,
    });
    this.buildRodAndReel();

    // 10. Bobber, Aim Ring, Catenary Line, Ripples & Droplets
    this.bobberTopMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.2,
    });
    this.bobberAntennaMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    this.buildBobber();

    const aimGeo = new THREE.RingGeometry(0.32, 0.42, 32);
    aimGeo.rotateX(-Math.PI / 2);
    this.aimRingMesh = new THREE.Mesh(
      aimGeo,
      new THREE.MeshBasicMaterial({
        color: 0x2dd4bf,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      }),
    );
    this.scene.add(this.aimRingMesh);

    this.linePositions = new Float32Array(this.LINE_POINTS * 3);
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.linePositions, 3),
    );
    this.lineMat = new THREE.LineBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.86,
    });
    this.fishingLine = new THREE.Line(this.lineGeo, this.lineMat);
    this.fishingLine.frustumCulled = false;
    this.scene.add(this.fishingLine);

    this.rippleGeo = new THREE.RingGeometry(0.12, 0.18, 32);
    this.rippleGeo.rotateX(-Math.PI / 2);

    const dropGeo = new THREE.SphereGeometry(0.042, 6, 6);
    const dropMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.85,
    });
    this.dropletInstanced = new THREE.InstancedMesh(
      dropGeo,
      dropMat,
      this.dropletCount,
    );
    this.dropletInstanced.frustumCulled = false;
    for (let i = 0; i < this.dropletCount; i++) {
      this.droplets.push({
        pos: new THREE.Vector3(0, -50, 0),
        vel: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
      });
    }
    this.scene.add(this.dropletInstanced);

    this.fishMeshGroup.visible = false;
    this.scene.add(this.fishMeshGroup);

    // Apply initial save configuration
    this.applyEnvironmentAndGear(initialSave, true);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindEvents();
    this.emitHud(true);
    this.startLoop();
  }

  private buildDock(): void {
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: 0x3b2313,
      roughness: 0.9,
    });
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.45,
      metalness: 0.75,
    });

    for (let i = 0; i < 16; i++) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(3.6, 0.12, 0.42),
        this.woodMat,
      );
      plank.position.set(0, 0.75, 7.0 - i * 0.46);
      plank.castShadow = true;
      plank.receiveShadow = true;
      this.dockGroup.add(plank);
    }

    // Side rails & pilings
    [-1.62, 1.62].forEach((px) => {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.16, 7.4),
        darkWoodMat,
      );
      beam.position.set(px, 0.66, 3.5);
      this.dockGroup.add(beam);

      [0.6, 3.6, 6.6].forEach((pz) => {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.14, 0.15, 3.4, 12),
          darkWoodMat,
        );
        post.position.set(px, 0.15, pz);
        post.castShadow = true;
        this.dockGroup.add(post);
      });
    });

    // Composite 6-part Dockside Sanctuary Lantern (Left Front Post)
    const lanternPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 1.35, 10),
      darkWoodMat,
    );
    lanternPost.position.set(-1.62, 1.5, 1.8);
    const lanternArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.06, 0.06),
      darkWoodMat,
    );
    lanternArm.position.set(-1.46, 2.12, 1.8);
    const lanternCap = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.14, 6),
      ironMat,
    );
    lanternCap.position.set(-1.32, 2.02, 1.8);
    const lanternBulb = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.07, 0.2, 8),
      this.lanternBulbMat,
    );
    lanternBulb.position.set(-1.32, 1.88, 1.8);
    this.lanternLight.position.set(-1.32, 1.88, 1.8);

    // Woven Bamboo Creel Basket on Right Side of Pier
    const creelBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 0.38, 14),
      new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.88 }),
    );
    creelBody.position.set(1.28, 0.99, 2.35);
    creelBody.castShadow = true;
    const creelRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.025, 8, 16),
      darkWoodMat,
    );
    creelRim.rotation.x = Math.PI / 2;
    creelRim.position.set(1.28, 1.18, 2.35);

    this.dockGroup.add(
      lanternPost,
      lanternArm,
      lanternCap,
      lanternBulb,
      creelBody,
      creelRim,
    );
  }

  private buildRodAndReel(): void {
    this.rodGroup.position.set(0.65, 1.55, 5.2);
    this.scene.add(this.rodGroup);
    this.rodGroup.add(this.rodPivot);

    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.038, 0.85, 16),
      this.rodHandleMat,
    );
    handle.rotation.x = -Math.PI / 2;
    handle.position.z = -0.3;
    this.rodPivot.add(handle);

    const buttCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 14, 12),
      this.rodAccentMat,
    );
    buttCap.position.z = 0.12;
    this.rodPivot.add(buttCap);

    // Reel Assembly
    const reelGroup = new THREE.Group();
    reelGroup.position.set(0, -0.08, -0.55);
    this.rodPivot.add(reelGroup);

    const reelStem = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.07, 0.08),
      this.rodBlankMat,
    );
    reelStem.position.y = 0.04;
    reelGroup.add(reelStem);

    const reelBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.1, 20),
      this.rodBlankMat,
    );
    reelBody.rotation.z = Math.PI / 2;
    reelGroup.add(reelBody);

    const reelSpool = new THREE.Mesh(
      new THREE.CylinderGeometry(0.053, 0.053, 0.072, 20),
      this.reelSpoolMat,
    );
    reelSpool.rotation.z = Math.PI / 2;
    reelGroup.add(reelSpool);

    this.reelCrank.position.set(-0.065, 0, 0);
    const crankArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.11, 0.022),
      this.rodAccentMat,
    );
    crankArm.position.y = 0.045;
    const crankKnob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.045, 10),
      this.rodHandleMat,
    );
    crankKnob.rotation.z = Math.PI / 2;
    crankKnob.position.set(-0.022, 0.095, 0);
    this.reelCrank.add(crankArm, crankKnob);
    reelGroup.add(this.reelCrank);

    // 12-Segment Flexible Rod Blank
    const ROD_SEGMENTS = 12;
    let parentNode: THREE.Object3D = this.rodPivot;
    for (let i = 0; i < ROD_SEGMENTS; i++) {
      const segGroup = new THREE.Group();
      const segLen = 0.26;
      segGroup.position.z = i === 0 ? -0.7 : -segLen;

      const rBottom = THREE.MathUtils.lerp(0.026, 0.005, i / ROD_SEGMENTS);
      const rTop = THREE.MathUtils.lerp(0.026, 0.005, (i + 1) / ROD_SEGMENTS);
      const segMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(rTop, rBottom, segLen, 12),
        this.rodBlankMat,
      );
      segMesh.rotation.x = -Math.PI / 2;
      segMesh.position.z = -segLen / 2;
      segMesh.castShadow = true;
      segGroup.add(segMesh);

      if (i % 2 === 1 || i === ROD_SEGMENTS - 1) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(rTop * 1.8 + 0.006, 0.0025, 8, 16),
          this.rodAccentMat,
        );
        ring.position.set(0, -rTop - 0.012, -segLen);
        segGroup.add(ring);
      }

      parentNode.add(segGroup);
      this.rodSegments.push(segGroup);
      parentNode = segGroup;
    }

    this.rodTipAnchor.position.set(0, -0.015, -0.26);
    parentNode.add(this.rodTipAnchor);
  }

  private buildBobber(): void {
    const bobberTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      this.bobberTopMat,
    );
    const bobberBottom = new THREE.Mesh(
      new THREE.SphereGeometry(
        0.11,
        20,
        16,
        0,
        Math.PI * 2,
        Math.PI / 2,
        Math.PI / 2,
      ),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2 }),
    );
    const bobberCollar = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.012, 8, 20),
      this.rodAccentMat,
    );
    bobberCollar.rotation.x = Math.PI / 2;

    const bobberAntenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.015, 0.28, 8),
      this.bobberAntennaMat,
    );
    bobberAntenna.position.y = 0.2;

    this.bobberGroup.add(bobberTop, bobberBottom, bobberCollar, bobberAntenna);
    this.bobberGroup.position.set(0.65, 0.7, 2.2);
    this.scene.add(this.bobberGroup);
  }

  private rebuildBiomeEnvironment(zoneId: WaterZoneId): void {
    // Clean old biome meshes
    while (this.biomeGroup.children.length > 0) {
      const child = this.biomeGroup.children[0];
      this.biomeGroup.remove(child);
    }

    const zone = WATER_ZONES.find((z) => z.id === zoneId) ?? WATER_ZONES[0];
    this.waterMat.color.setHex(zone.waterColor);
    this.waterMat.emissive.setHex(zone.waterEmissive);
    this.woodMat.color.setHex(zone.dockWoodColor);

    // Distant Mountains / Horizon Formations
    const mountainMat = new THREE.MeshStandardMaterial({
      color: zone.mountainColor,
      roughness: 0.92,
    });
    for (let i = 0; i < 11; i++) {
      const radius = 14 + ((i * 7) % 24);
      const height = zoneId === 'cloud_sanctuary' ? 18 + (i % 4) * 8 : 12 + ((i * 11) % 22);
      const segs = zoneId === 'coral_cove' ? 5 : 7;
      const mountain = new THREE.Mesh(
        new THREE.ConeGeometry(radius, height, segs),
        mountainMat,
      );
      const angle = Math.PI * 0.14 + (i / 10) * (Math.PI * 0.72);
      const dist = 92 + (i % 3) * 18;
      mountain.position.set(
        Math.cos(angle) * dist,
        height * 0.36 - 2.2,
        -Math.sin(angle) * dist,
      );
      mountain.rotation.y = i * 0.8;
      this.biomeGroup.add(mountain);
    }

    // Zone-Specific Midground Landmarks & Instanced Flora
    if (zoneId === 'alpine_lake') {
      // Pine / Cedar Island Outcrops on Left & Right Flanks
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
      const pineMat = new THREE.MeshStandardMaterial({ color: 0x064e3b, roughness: 0.82 });
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 });

      const treeCount = 28;
      const canopyInst = new THREE.InstancedMesh(
        new THREE.ConeGeometry(1.4, 4.6, 7),
        pineMat,
        treeCount,
      );
      const trunkInst = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.22, 0.32, 1.8, 6),
        trunkMat,
        treeCount,
      );

      [-1, 1].forEach((side, sIdx) => {
        const island = new THREE.Mesh(
          new THREE.CylinderGeometry(10, 14, 2.6, 9),
          rockMat,
        );
        island.position.set(side * 28, -0.4, -26 - sIdx * 8);
        this.biomeGroup.add(island);

        for (let t = 0; t < 14; t++) {
          const idx = sIdx * 14 + t;
          const a = (t / 14) * Math.PI * 2;
          const r = 2.5 + (t % 3) * 2.6;
          const tx = side * 28 + Math.cos(a) * r;
          const tz = -26 - sIdx * 8 + Math.sin(a) * r;
          const sc = 0.85 + (t % 4) * 0.14;

          _dummyObj.position.set(tx, 1.5 * sc, tz);
          _dummyObj.rotation.set(0, t * 0.7, 0);
          _dummyObj.scale.setScalar(sc);
          _dummyObj.updateMatrix();
          trunkInst.setMatrixAt(idx, _dummyObj.matrix);

          _dummyObj.position.set(tx, 3.6 * sc, tz);
          _dummyObj.updateMatrix();
          canopyInst.setMatrixAt(idx, _dummyObj.matrix);
          _tempColor.setHex(t % 2 === 0 ? 0x065f46 : 0x0f766e);
          canopyInst.setColorAt(idx, _tempColor);
        }
      });
      canopyInst.instanceMatrix.needsUpdate = true;
      if (canopyInst.instanceColor) canopyInst.instanceColor.needsUpdate = true;
      trunkInst.instanceMatrix.needsUpdate = true;
      canopyInst.computeBoundingSphere();
      trunkInst.computeBoundingSphere();
      this.biomeGroup.add(trunkInst, canopyInst);
    } else if (zoneId === 'bamboo_brook') {
      // Towering Jade Bamboo Stalks & Mossy River Boulders
      const stalkMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.45 });
      const mossRockMat = new THREE.MeshStandardMaterial({ color: 0x365314, roughness: 0.92 });
      const bambooCount = 44;
      const bambooInst = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.16, 0.22, 11, 8),
        stalkMat,
        bambooCount,
      );

      for (let i = 0; i < bambooCount; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const bx = side * (14 + (i % 7) * 2.4);
        const bz = -6 - Math.floor(i / 2) * 2.3;
        const sc = 0.85 + (i % 5) * 0.1;
        _dummyObj.position.set(bx, 4.5 * sc, bz);
        _dummyObj.rotation.set((i % 3 - 1) * 0.06, i * 0.5, side * -0.05);
        _dummyObj.scale.setScalar(sc);
        _dummyObj.updateMatrix();
        bambooInst.setMatrixAt(i, _dummyObj.matrix);
        _tempColor.setHex(i % 3 === 0 ? 0x22c55e : 0x166534);
        bambooInst.setColorAt(i, _tempColor);
      }
      bambooInst.instanceMatrix.needsUpdate = true;
      if (bambooInst.instanceColor) bambooInst.instanceColor.needsUpdate = true;
      bambooInst.computeBoundingSphere();
      this.biomeGroup.add(bambooInst);

      // Mossy boulders & Stone Shrine Lanterns in the brook
      [-12, 13, -16, 17].forEach((rx, idx) => {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2.6, 1), mossRockMat);
        rock.scale.set(1.4, 0.7, 1.2);
        rock.position.set(rx, 0.2, -12 - idx * 7);
        this.biomeGroup.add(rock);
      });
    } else if (zoneId === 'coral_cove') {
      // Sacred Sunken Crimson/Stone Torii Shrine Gate in Distance + Glowing Coral Reefs
      const toriiGroup = new THREE.Group();
      const vermilionMat = new THREE.MeshStandardMaterial({
        color: 0xb91c1c,
        roughness: 0.55,
      });
      const stoneCapMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.75,
      });

      [-4.6, 4.6].forEach((px) => {
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.45, 0.55, 11.5, 14),
          vermilionMat,
        );
        pillar.position.set(px, 4.5, 0);
        pillar.castShadow = true;
        toriiGroup.add(pillar);
      });
      const kasagi = new THREE.Mesh(
        new THREE.BoxGeometry(13.2, 0.65, 0.9),
        stoneCapMat,
      );
      kasagi.position.set(0, 10.2, 0);
      const shimaki = new THREE.Mesh(
        new THREE.BoxGeometry(12.2, 0.45, 0.7),
        vermilionMat,
      );
      shimaki.position.set(0, 9.65, 0);
      const nuki = new THREE.Mesh(
        new THREE.BoxGeometry(10.8, 0.42, 0.5),
        vermilionMat,
      );
      nuki.position.set(0, 7.6, 0);
      toriiGroup.add(kasagi, shimaki, nuki);
      toriiGroup.position.set(0, -0.5, -42);
      this.biomeGroup.add(toriiGroup);

      // Luminous Coral Clusters along flanks
      const coralCount = 30;
      const coralInst = new THREE.InstancedMesh(
        new THREE.DodecahedronGeometry(1.1, 0),
        new THREE.MeshStandardMaterial({
          color: 0xf472b6,
          roughness: 0.4,
          emissive: 0x831843,
          emissiveIntensity: 0.35,
        }),
        coralCount,
      );
      for (let i = 0; i < coralCount; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        _dummyObj.position.set(
          side * (12 + (i % 6) * 3.2),
          -0.25 + (i % 3) * 0.25,
          -8 - i * 1.4,
        );
        _dummyObj.rotation.set(i * 0.4, i * 0.8, 0);
        _dummyObj.scale.set(1.2, 0.8 + (i % 3) * 0.4, 1.2);
        _dummyObj.updateMatrix();
        coralInst.setMatrixAt(i, _dummyObj.matrix);
        _tempColor.setHex(i % 2 === 0 ? 0xf472b6 : 0x38bdf8);
        coralInst.setColorAt(i, _tempColor);
      }
      coralInst.instanceMatrix.needsUpdate = true;
      if (coralInst.instanceColor) coralInst.instanceColor.needsUpdate = true;
      coralInst.computeBoundingSphere();
      this.biomeGroup.add(coralInst);
    } else if (zoneId === 'cloud_sanctuary') {
      // Celestial Marble Ruin Columns & Golden Astral Ring
      const marbleMat = new THREE.MeshPhysicalMaterial({
        color: 0xf8fafc,
        roughness: 0.25,
        metalness: 0.1,
        clearcoat: 0.6,
      });
      const goldTrimMat = new THREE.MeshStandardMaterial({
        color: 0xfacc15,
        roughness: 0.2,
        metalness: 0.9,
        emissive: 0xb45309,
        emissiveIntensity: 0.25,
      });

      for (let i = 0; i < 8; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const colGroup = new THREE.Group();
        const h = 7 + (i % 3) * 3.2;
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(0.65, 0.75, h, 14),
          marbleMat,
        );
        shaft.position.y = h / 2 - 1;
        const plinth = new THREE.Mesh(
          new THREE.BoxGeometry(1.9, 0.8, 1.9),
          marbleMat,
        );
        plinth.position.y = -0.6;
        const goldRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.76, 0.08, 8, 24),
          goldTrimMat,
        );
        goldRing.rotation.x = Math.PI / 2;
        goldRing.position.y = h - 1.2;
        colGroup.add(plinth, shaft, goldRing);
        colGroup.position.set(
          side * (13 + Math.floor(i / 2) * 3.5),
          0,
          -14 - Math.floor(i / 2) * 10,
        );
        this.biomeGroup.add(colGroup);
      }

      const astralHalo = new THREE.Mesh(
        new THREE.TorusGeometry(9.5, 0.18, 12, 64),
        goldTrimMat,
      );
      astralHalo.position.set(0, 8.5, -48);
      this.biomeGroup.add(astralHalo);
    }
  }

  public applyEnvironmentAndGear(save: SaveSlotData, forceRebuildZone = false): void {
    const prevZone = this.saveData.currentZoneId;
    this.saveData = save;

    if (forceRebuildZone || prevZone !== save.currentZoneId) {
      this.rebuildBiomeEnvironment(save.currentZoneId);
    }

    // Update Rod / Reel / Line / Lure 3D visuals
    const rod = RODS.find((r) => r.id === save.equippedRodId) ?? RODS[0];
    const reel = REELS.find((r) => r.id === save.equippedReelId) ?? REELS[0];
    const line = LINES.find((l) => l.id === save.equippedLineId) ?? LINES[0];
    const lure = LURES.find((l) => l.id === save.equippedLureId) ?? LURES[0];

    this.rodBlankMat.color.setHex(rod.blankColor);
    this.rodAccentMat.color.setHex(rod.accentColor);
    this.rodHandleMat.color.setHex(rod.handleColor);
    this.reelSpoolMat.color.setHex(reel.spoolColor);
    this.lineMat.color.setHex(line.lineColor);
    this.bobberTopMat.color.setHex(lure.bobberTopColor);
    this.bobberAntennaMat.color.setHex(lure.antennaColor);

    // Update Time of Day & Weather Sky/Lighting
    this.updateAtmosphere(save.timeOfDay, save.weather);
    soundEngine.setWeather(save.weather);
  }

  private updateAtmosphere(timeOfDay: TimeOfDay, weather: WeatherType): void {
    const skyUniforms = this.sky.material.uniforms;
    let elevationDeg = 12;
    let azimuthDeg = 195;
    let dirColor = 0xffdfa5;
    let dirIntensity = 2.6;
    let hemiSky = 0x87ceeb;
    let hemiGround = 0x0f172a;
    let fogHex = 0x1e293b;
    let fogDensity = 0.0055;
    let starOpacity = 0;

    if (timeOfDay === 'dawn') {
      elevationDeg = 9;
      azimuthDeg = 162;
      dirColor = 0xfde68a;
      dirIntensity = 2.4;
      hemiSky = 0xbae6fd;
      hemiGround = 0x1e293b;
      fogHex = 0x334155;
      skyUniforms['turbidity'].value = 6;
      skyUniforms['rayleigh'].value = 1.8;
    } else if (timeOfDay === 'dusk') {
      elevationDeg = 11;
      azimuthDeg = 198;
      dirColor = 0xffb36b;
      dirIntensity = 2.7;
      hemiSky = 0x7dd3fc;
      hemiGround = 0x0f172a;
      fogHex = 0x1e293b;
      skyUniforms['turbidity'].value = 8.5;
      skyUniforms['rayleigh'].value = 2.7;
    } else {
      // Starry Night
      elevationDeg = -8;
      azimuthDeg = 205;
      dirColor = 0x93c5fd;
      dirIntensity = 1.15;
      hemiSky = 0x1e3a8a;
      hemiGround = 0x020617;
      fogHex = 0x090d16;
      starOpacity = weather === 'clear' ? 0.88 : 0.35;
      skyUniforms['turbidity'].value = 2.5;
      skyUniforms['rayleigh'].value = 0.45;
    }

    if (weather === 'rain') {
      dirIntensity *= 0.68;
      fogDensity = 0.011;
      fogHex = timeOfDay === 'night' ? 0x0f172a : 0x334155;
    } else if (weather === 'mist') {
      dirIntensity *= 0.82;
      fogDensity = 0.0155;
      fogHex = timeOfDay === 'night' ? 0x132a2e : 0x3b5259;
    }

    const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    this.sunPosition.setFromSphericalCoords(1, phi, theta);
    skyUniforms['sunPosition'].value.copy(this.sunPosition);

    // Keep moon/sun directional light above horizon even at night for crisp water speculars
    const lightPhi = THREE.MathUtils.degToRad(
      90 - (timeOfDay === 'night' ? 24 : elevationDeg),
    );
    this.dirLight.position.setFromSphericalCoords(80, lightPhi, theta);
    this.dirLight.color.setHex(dirColor);
    this.dirLight.intensity = dirIntensity;

    this.hemiLight.color.setHex(hemiSky);
    this.hemiLight.groundColor.setHex(hemiGround);
    this.lanternLight.intensity = timeOfDay === 'night' ? 3.2 : 1.6;

    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(fogHex);
      this.scene.fog.density = fogDensity;
    }

    (this.starsPoints.material as THREE.PointsMaterial).opacity = starOpacity;
    this.rainLines.visible = weather === 'rain';
    this.firefliesPoints.visible =
      timeOfDay === 'night' ||
      weather === 'mist' ||
      this.saveData.currentZoneId === 'bamboo_brook' ||
      this.saveData.currentZoneId === 'cloud_sanctuary';
  }

  public setUiBlocked(blocked: boolean): void {
    this.uiBlocked = blocked;
    if (blocked && this.gameState === FishingState.CHARGING) {
      this.isInputDown = false;
      this.castPower = 0;
      this.gameState = FishingState.IDLE;
      this.emitHud(true);
    }
  }

  public dismissCaughtShowcase(): void {
    if (this.gameState === FishingState.CAUGHT) {
      this.fishMeshGroup.visible = false;
      this.pendingCaughtInstance = null;
      this.currentFish = null;
      this.gameState = FishingState.IDLE;
      this.emitHud(true);
    }
  }

  private getWaterHeight(x: number, z: number, time: number): number {
    const weatherAmp = this.saveData.weather === 'rain' ? 1.35 : 1.0;
    const w1 =
      Math.sin(x * 0.25 + time * 1.8) * Math.cos(z * 0.2 + time * 1.4) * 0.11 * weatherAmp;
    const w2 = Math.sin(x * 0.6 - z * 0.4 + time * 2.6) * 0.038 * weatherAmp;
    const w3 = Math.cos(z * 0.8 + time * 3.2) * 0.018;
    return w1 + w2 + w3;
  }

  private updateWaterGeometry(time: number): void {
    const pos = this.waterGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      pos.setY(i, this.getWaterHeight(vx, vz, time));
    }
    pos.needsUpdate = true;
    this.waterGeo.computeVertexNormals();
  }

  private spawnRipple(x: number, z: number, scaleSpeed = 1.8, colorHex = 0xe2e8f0): void {
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.rippleGeo, mat);
    mesh.position.set(x, this.getWaterHeight(x, z, this.clock.elapsedTime) + 0.035, z);
    this.scene.add(mesh);
    this.ripples.push({ mesh, age: 0, speed: scaleSpeed, maxAge: 1.25 });
  }

  private spawnSplashDroplets(x: number, y: number, z: number, count = 18, speed = 4.2): void {
    let spawned = 0;
    for (let i = 0; i < this.dropletCount && spawned < count; i++) {
      const d = this.droplets[i];
      if (d.life <= 0) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.4 + Math.random() * 0.8;
        d.pos.set(x + Math.cos(a) * 0.15, y + 0.08, z + Math.sin(a) * 0.15);
        d.vel.set(
          Math.cos(a) * r * speed * 0.45,
          (0.65 + Math.random() * 0.65) * speed,
          Math.sin(a) * r * speed * 0.45,
        );
        d.maxLife = 0.55 + Math.random() * 0.35;
        d.life = d.maxLife;
        spawned++;
      }
    }
  }

  private handlePressDown = (): void => {
    if (this.uiBlocked || this.isDisposed) return;
    soundEngine.init();
    this.isInputDown = true;

    if (this.gameState === FishingState.IDLE) {
      this.gameState = FishingState.CHARGING;
      this.castPower = 8;
      this.castChargeDir = 1;
      this.emitHud(true);
    } else if (this.gameState === FishingState.WAITING) {
      // Early retrieve
      this.gameState = FishingState.IDLE;
      soundEngine.playSplash(0.6);
      this.callbacks.onNotice('提早收回了釣線，靜待浮標完全沒入水中再揚竿吧。', 'info');
      this.emitHud(true);
    } else if (this.gameState === FishingState.BITE) {
      // Hook strike!
      this.startReelingBattle();
    }
  };

  private handlePressUp = (): void => {
    this.isInputDown = false;
    if (this.uiBlocked || this.isDisposed) return;

    if (this.gameState === FishingState.CHARGING) {
      this.launchCast();
    }
  };

  private launchCast(): void {
    const rod = RODS.find((r) => r.id === this.saveData.equippedRodId) ?? RODS[0];
    const powerRatio = Math.max(0.18, this.castPower / 100);
    const targetDist = 8 + powerRatio * rod.maxCastDist;

    this.maxCastDistance = targetDist;
    this.fishDistance = targetDist;

    this.rodPivot.updateMatrixWorld(true);
    this.rodTipAnchor.getWorldPosition(_rodTipWorld);
    this.bobberGroup.position.copy(_rodTipWorld);

    const flightTime = 0.75 + powerRatio * 0.45;
    const targetX = Math.sin(this.aimAngle) * targetDist;
    const targetZ = 4.2 - Math.cos(this.aimAngle) * targetDist;

    const vx = (targetX - _rodTipWorld.x) / flightTime;
    const vz = (targetZ - _rodTipWorld.z) / flightTime;
    const vy = (0 - _rodTipWorld.y + 0.5 * 16.5 * flightTime * flightTime) / flightTime;

    this.bobberVelocity.set(vx, vy, vz);
    this.gameState = FishingState.CASTING;
    soundEngine.playCastWhoosh(powerRatio);
    this.emitHud(true);
  }

  private startReelingBattle(): void {
    const powerRatio = Math.max(0.2, this.castPower / 100);
    const species = rollFishEncounter(
      this.saveData.currentZoneId,
      this.saveData.timeOfDay,
      this.saveData.weather,
      this.saveData.equippedLureId,
      powerRatio,
      this.saveData,
    );

    this.currentFish = species;
    this.pendingCaughtInstance = createCaughtInstance(species, this.saveData);

    const weightNorm =
      (this.pendingCaughtInstance.weight - species.minWeight) /
      Math.max(0.05, species.maxWeight - species.minWeight);
    const visualScale = 0.78 + weightNorm * 0.55 + (species.isGuardian ? 0.25 : 0);

    this.activeFishRig = buildCompositeFishModel(
      this.fishMeshGroup,
      species,
      visualScale,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.fishMeshGroup.visible = false;

    this.lineTension = 42;
    this.maxFishStamina = species.stamina * (0.9 + weightNorm * 0.35);
    this.fishStamina = this.maxFishStamina;
    this.fishBurstTimer = 1.6 + Math.random() * 1.8;
    this.isFishBursting = false;
    this.fishJumpPhase = -1;
    this.fishLateralX = this.bobberGroup.position.x;
    this.fishLateralDir = Math.random() < 0.5 ? -1 : 1;

    this.spawnRipple(this.bobberGroup.position.x, this.bobberGroup.position.z, 3.2, 0xfef08a);
    this.spawnSplashDroplets(
      this.bobberGroup.position.x,
      0.1,
      this.bobberGroup.position.z,
      24,
      5.2,
    );
    soundEngine.playSplash(1.35);
    soundEngine.setCombatMode(true);

    this.gameState = FishingState.REELING;
    this.emitHud(true);
  }

  private finishCatchSuccess(): void {
    if (!this.currentFish || !this.pendingCaughtInstance) return;
    soundEngine.setCombatMode(false);
    soundEngine.playCatchFanfare(this.currentFish.rarity);

    this.isInputDown = false;
    this.gameState = FishingState.CAUGHT;
    this.fishMeshGroup.visible = true;

    this.emitHud(true);
    this.callbacks.onFishCaught(this.pendingCaughtInstance);
  }

  private failReeling(reason: 'snap' | 'escape'): void {
    soundEngine.setCombatMode(false);
    soundEngine.playEscapeOrSnap();
    this.isInputDown = false;
    this.fishMeshGroup.visible = false;
    this.currentFish = null;
    this.pendingCaughtInstance = null;
    this.gameState = FishingState.IDLE;

    if (reason === 'snap') {
      this.callbacks.onNotice('釣線張力過載斷裂！面對暴衝巨物時記得適時放開按鍵卸力，或升級釣線與釣竿。', 'warning');
    } else {
      this.callbacks.onNotice('釣線過於鬆弛，大魚趁機掙脫了魚鉤！請維持張力在中央安全區間。', 'warning');
    }
    this.emitHud(true);
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      this.handlePressDown();
    };
    const onPointerUp = () => {
      this.handlePressUp();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (this.uiBlocked) return;
      if (this.gameState === FishingState.IDLE || this.gameState === FishingState.CHARGING) {
        const rect = canvas.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
        this.targetAimAngle = THREE.MathUtils.clamp(-nx * 0.38, -0.38, 0.38);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        if (this.uiBlocked) return;
        e.preventDefault();
        this.handlePressDown();
      } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        this.targetAimAngle = THREE.MathUtils.clamp(this.targetAimAngle + 0.06, -0.38, 0.38);
      } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        this.targetAimAngle = THREE.MathUtils.clamp(this.targetAimAngle - 0.06, -0.38, 0.38);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.handlePressUp();
      }
    };
    const onResize = () => {
      if (this.isDisposed) return;
      const w = this.container.clientWidth || window.innerWidth;
      const h = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);

    this.cleanupListeners = () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
    };
  }

  private cleanupListeners: () => void = () => {};

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    gl.flush();
    const poll = () => {
      if (this.isDisposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop(): void {
    const tick = () => {
      if (this.isDisposed) return;
      const rawDelta = this.clock.getDelta();
      const delta = Math.min(rawDelta, 0.08);
      const elapsed = this.clock.elapsedTime;

      this.stepSimulation(delta, elapsed);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };
    tick();
  }

  private stepSimulation(delta: number, elapsed: number): void {
    // 1. Update Dynamic Water & Ambient Effects
    this.updateWaterGeometry(elapsed);
    this.aimAngle = THREE.MathUtils.damp(this.aimAngle, this.targetAimAngle, 8, delta);

    // Rain animation
    if (this.rainLines.visible) {
      const rAttr = this.rainLines.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < rAttr.count / 2; i++) {
        let y = this.rainPositions[i * 6 + 1] - delta * 26;
        let x = this.rainPositions[i * 6] - delta * 2.2;
        const z = this.rainPositions[i * 6 + 2];
        if (y < 0.1) {
          if (Math.random() < 0.04 && z > -32) {
            this.spawnRipple(x, z, 1.1, 0xbae6fd);
          }
          y = 22 + Math.random() * 4;
          x = (Math.random() - 0.5) * 48;
        }
        this.rainPositions[i * 6] = x;
        this.rainPositions[i * 6 + 1] = y;
        this.rainPositions[i * 6 + 3] = x - 0.08;
        this.rainPositions[i * 6 + 4] = y - 0.75;
      }
      rAttr.needsUpdate = true;
    }

    // Fireflies gentle drift
    if (this.firefliesPoints.visible) {
      const fAttr = this.firefliesPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < fAttr.count; i++) {
        this.fireflyPositions[i * 3] += Math.sin(elapsed * 0.8 + i) * delta * 0.35;
        this.fireflyPositions[i * 3 + 1] =
          0.9 + Math.sin(elapsed * 1.4 + i * 1.7) * 0.65 + (i % 3) * 0.55;
      }
      fAttr.needsUpdate = true;
    }

    // Underwater Swimmer Silhouettes
    for (let i = 0; i < this.swimmerCount; i++) {
      const s = this.swimmers[i];
      if (i === 0 && (this.gameState === FishingState.WAITING || this.gameState === FishingState.BITE)) {
        // Lead curious fish shadow circles around the bobber!
        const bx = this.bobberGroup.position.x;
        const bz = this.bobberGroup.position.z;
        const orbitR = this.gameState === FishingState.BITE ? 0.25 : 1.4;
        s.angle += delta * 2.2;
        s.x = THREE.MathUtils.damp(s.x, bx + Math.cos(s.angle) * orbitR, 3, delta);
        s.z = THREE.MathUtils.damp(s.z, bz + Math.sin(s.angle) * orbitR, 3, delta);
      } else {
        s.angle += s.turnRate * delta;
        s.x += Math.cos(s.angle) * s.speed * delta;
        s.z += Math.sin(s.angle) * s.speed * delta;
        if (s.x < -22 || s.x > 22) s.angle = Math.PI - s.angle;
        if (s.z > -2 || s.z < -45) s.angle = -s.angle;
      }

      const wy = this.getWaterHeight(s.x, s.z, elapsed) + s.depth;
      _dummyObj.position.set(s.x, wy, s.z);
      _dummyObj.rotation.set(0, -s.angle + Math.PI / 2 + Math.sin(elapsed * 6 + i) * 0.08, 0);
      _dummyObj.scale.setScalar(s.scale);
      _dummyObj.updateMatrix();
      this.swimmerInstanced.setMatrixAt(i, _dummyObj.matrix);
    }
    this.swimmerInstanced.instanceMatrix.needsUpdate = true;

    // 2. Step Fishing State Machine
    const rod = RODS.find((r) => r.id === this.saveData.equippedRodId) ?? RODS[0];
    const reel = REELS.find((r) => r.id === this.saveData.equippedReelId) ?? REELS[0];
    const line = LINES.find((l) => l.id === this.saveData.equippedLineId) ?? LINES[0];
    const lure = LURES.find((l) => l.id === this.saveData.equippedLureId) ?? LURES[0];

    let targetRodPitch = 0.28;
    let targetRodYaw = this.aimAngle * 0.85;
    let bendAmount = 0.012;
    let bendLateral = 0;

    // Aim indicator preview when IDLE or CHARGING
    if (this.gameState === FishingState.IDLE || this.gameState === FishingState.CHARGING) {
      this.aimRingMesh.visible = !this.uiBlocked;
      const previewPower =
        this.gameState === FishingState.CHARGING ? Math.max(0.18, this.castPower / 100) : 0.45;
      const previewDist = 8 + previewPower * rod.maxCastDist;
      const ax = Math.sin(this.aimAngle) * previewDist;
      const az = 4.2 - Math.cos(this.aimAngle) * previewDist;
      this.aimRingMesh.position.set(ax, this.getWaterHeight(ax, az, elapsed) + 0.05, az);
      const pulseScale = 1 + Math.sin(elapsed * 3.5) * 0.08;
      this.aimRingMesh.scale.setScalar(pulseScale);
    } else {
      this.aimRingMesh.visible = false;
    }

    if (this.gameState === FishingState.IDLE) {
      targetRodPitch = 0.32 + Math.sin(elapsed * 1.5) * 0.02;
      this.reelRotationSpeed = THREE.MathUtils.damp(this.reelRotationSpeed, 0, 6, delta);
    } else if (this.gameState === FishingState.CHARGING) {
      this.castPower += this.castChargeDir * delta * 92;
      if (this.castPower >= 100) {
        this.castPower = 100;
        this.castChargeDir = -1;
      } else if (this.castPower <= 12) {
        this.castPower = 12;
        this.castChargeDir = 1;
      }
      targetRodPitch = 0.32 + (this.castPower / 100) * 0.65;
      bendAmount = -0.025 * (this.castPower / 100);
    } else if (this.gameState === FishingState.CASTING) {
      targetRodPitch = 0.08;
      bendAmount = 0.02;

      this.bobberVelocity.y -= 16.5 * delta;
      this.bobberGroup.position.addScaledVector(this.bobberVelocity, delta);

      const waterY = this.getWaterHeight(
        this.bobberGroup.position.x,
        this.bobberGroup.position.z,
        elapsed,
      );
      if (this.bobberGroup.position.y <= waterY) {
        this.bobberGroup.position.y = waterY;
        this.spawnRipple(this.bobberGroup.position.x, this.bobberGroup.position.z, 2.4);
        this.spawnSplashDroplets(
          this.bobberGroup.position.x,
          waterY,
          this.bobberGroup.position.z,
          14,
          3.4,
        );
        soundEngine.playSplash(0.95);

        this.biteTimer = (2.4 + Math.random() * 3.8) / lure.biteSpeedBonus;
        this.nibbleTimer = 0.9 + Math.random() * 0.9;
        this.gameState = FishingState.WAITING;
        this.emitHud(true);
      }
    } else if (this.gameState === FishingState.WAITING) {
      targetRodPitch = 0.22;
      const bx = this.bobberGroup.position.x;
      const bz = this.bobberGroup.position.z;
      const baseWaterY = this.getWaterHeight(bx, bz, elapsed);

      this.nibbleTimer -= delta;
      let nibbleDip = 0;
      if (this.nibbleTimer <= 0) {
        this.nibbleTimer = 1.1 + Math.random() * 1.3;
        this.spawnRipple(bx, bz, 1.35);
        soundEngine.playNibble();
        nibbleDip = -0.09;
      }

      this.bobberGroup.position.y = THREE.MathUtils.damp(
        this.bobberGroup.position.y,
        baseWaterY + nibbleDip,
        10,
        delta,
      );
      this.bobberGroup.rotation.z = Math.sin(elapsed * 2.8) * 0.12;

      this.biteTimer -= delta;
      if (this.biteTimer <= 0) {
        this.gameState = FishingState.BITE;
        this.hookWindowTimer = 1.65;
        this.spawnRipple(bx, bz, 3.0, 0xfca5a5);
        soundEngine.playBiteAlert();
        this.emitHud(true);
      }
    } else if (this.gameState === FishingState.BITE) {
      targetRodPitch = 0.18;
      bendAmount = 0.032 + Math.sin(elapsed * 28) * 0.008;
      const bx = this.bobberGroup.position.x;
      const bz = this.bobberGroup.position.z;
      const baseWaterY = this.getWaterHeight(bx, bz, elapsed);

      // Plunge bobber underwater vigorously
      this.bobberGroup.position.y = THREE.MathUtils.damp(
        this.bobberGroup.position.y,
        baseWaterY - 0.34 + Math.sin(elapsed * 24) * 0.06,
        14,
        delta,
      );

      this.hookWindowTimer -= delta;
      if (this.hookWindowTimer <= 0) {
        soundEngine.playEscapeOrSnap();
        this.gameState = FishingState.IDLE;
        this.callbacks.onNotice('錯失揚竿時機，魚兒吐鉤游走了！看到浮標急沉請立即點擊或按空白鍵。', 'warning');
        this.emitHud(true);
      }
    } else if (this.gameState === FishingState.REELING && this.currentFish) {
      const fish = this.currentFish;
      const staminaRatio = Math.max(0, this.fishStamina / this.maxFishStamina);

      // Burst / Leap AI
      this.fishBurstTimer -= delta;
      if (this.fishBurstTimer <= 0) {
        this.isFishBursting = !this.isFishBursting;
        this.fishBurstTimer = this.isFishBursting
          ? 1.1 + Math.random() * 1.1
          : 1.8 + Math.random() * 2.0;
        this.fishLateralDir = Math.random() < 0.5 ? -1 : 1;

        // Trigger dramatic 3D leap out of water during burst!
        if (this.isFishBursting && this.fishJumpPhase < 0 && this.fishDistance > 5.5) {
          this.fishJumpPhase = 0;
          this.fishMeshGroup.visible = true;
          this.spawnSplashDroplets(
            this.bobberGroup.position.x,
            0.15,
            this.bobberGroup.position.z,
            22,
            5.0,
          );
          soundEngine.playSplash(1.25);
        }
      }

      const pullFactor =
        fish.pullStrength *
        (0.55 + 0.45 * staminaRatio) *
        (this.isFishBursting ? 1.55 : 0.85);

      if (this.isInputDown) {
        // Player actively reeling in
        const gainRate = (27 * pullFactor) / (rod.tensionBuffer * line.maxTensionLimit);
        this.lineTension += gainRate * delta;
        this.fishDistance -= reel.reelSpeed * (this.isFishBursting ? 0.48 : 1.05) * delta;
        this.fishStamina -= 15 * reel.staminaDrain * delta;
        this.reelRotationSpeed = 16;
      } else {
        // Player easing tension
        const dropRate = 30 - (this.isFishBursting ? 11 * pullFactor : 0);
        this.lineTension -= dropRate * delta;
        const retreat =
          (fish.speed * (this.isFishBursting ? 1.65 : 0.45) * (0.4 + 0.6 * staminaRatio)) /
          reel.dragSmoothness;
        this.fishDistance = Math.min(this.maxCastDistance + 8, this.fishDistance + retreat * delta);
        this.fishStamina -= 4.5 * delta;
        this.reelRotationSpeed = THREE.MathUtils.damp(this.reelRotationSpeed, -4, 6, delta);
      }

      // Bonus stamina drain when keeping tension inside the Golden Safe Zone
      const safeMin = Math.max(12, 24 - rod.safeZoneBonus * 0.5);
      const safeMax = Math.min(90, 80 + rod.safeZoneBonus * 0.5);
      if (this.lineTension >= safeMin && this.lineTension <= safeMax) {
        this.fishStamina -= 9 * reel.staminaDrain * delta;
      }

      this.fishStamina = Math.max(0, this.fishStamina);
      soundEngine.tickReelRatchet(delta, this.isInputDown, this.lineTension);

      // Lateral struggle across water
      const maxLat = Math.min(12, this.fishDistance * 0.48);
      this.fishLateralX +=
        this.fishLateralDir *
        fish.speed *
        (this.isFishBursting ? 3.6 : 1.7) *
        delta;
      if (this.fishLateralX > maxLat) {
        this.fishLateralX = maxLat;
        this.fishLateralDir = -1;
      } else if (this.fishLateralX < -maxLat) {
        this.fishLateralX = -maxLat;
        this.fishLateralDir = 1;
      }

      const fz = 4.2 - this.fishDistance;
      const waterY = this.getWaterHeight(this.fishLateralX, fz, elapsed);
      this.bobberGroup.position.set(
        this.fishLateralX,
        waterY - 0.08 + Math.sin(elapsed * 18) * 0.05,
        fz,
      );

      if (Math.random() < (this.isFishBursting ? 0.35 : 0.14)) {
        this.spawnRipple(
          this.fishLateralX,
          fz,
          this.isFishBursting ? 2.6 : 1.6,
          this.isFishBursting ? 0xfef08a : 0xe2e8f0,
        );
      }

      // Animate 3D Fish Leap Arc if active
      if (this.fishJumpPhase >= 0 && this.activeFishRig) {
        this.fishJumpPhase += delta * 1.55;
        if (this.fishJumpPhase <= 1.0) {
          const jumpH = Math.sin(this.fishJumpPhase * Math.PI) * (1.5 + (fish.isGuardian ? 0.8 : 0));
          this.fishMeshGroup.position.set(this.fishLateralX, waterY + jumpH - 0.1, fz);
          this.fishMeshGroup.rotation.set(
            0,
            this.fishLateralDir > 0 ? 0.25 : Math.PI - 0.25,
            Math.cos(this.fishJumpPhase * Math.PI) * 0.65 * this.fishLateralDir,
          );
          this.activeFishRig.tailPivot.rotation.y = Math.sin(elapsed * 26) * 0.48;
        } else {
          this.fishJumpPhase = -1;
          this.fishMeshGroup.visible = false;
          this.spawnSplashDroplets(this.fishLateralX, waterY, fz, 20, 4.6);
          soundEngine.playSplash(1.1);
        }
      }

      // Rod bend kinematics driven by real tension!
      const tensionNorm = THREE.MathUtils.clamp(this.lineTension / 100, 0, 1.1);
      targetRodPitch = 0.48 + (this.isInputDown ? 0.16 : 0.02) + Math.sin(elapsed * 16) * 0.025 * tensionNorm;
      targetRodYaw = THREE.MathUtils.clamp(-this.fishLateralX * 0.035, -0.45, 0.45);
      bendAmount = 0.022 + tensionNorm * 0.095;
      bendLateral = THREE.MathUtils.clamp(this.fishLateralX * 0.0045, -0.04, 0.04);

      // Win / Lose checks
      if (this.lineTension >= 100) {
        this.failReeling('snap');
      } else if (this.lineTension <= 0) {
        this.failReeling('escape');
      } else if (this.fishDistance <= 2.4) {
        this.finishCatchSuccess();
      }
    } else if (this.gameState === FishingState.CAUGHT && this.activeFishRig) {
      targetRodPitch = 0.55;
      targetRodYaw = 0.25;
      bendAmount = 0.025;
      this.reelRotationSpeed = 0;

      // Present hero 3D fish swimming gracefully in front of camera left-of-modal or above water
      this.fishMeshGroup.visible = true;
      this.fishMeshGroup.position.set(
        -1.35,
        1.82 + Math.sin(elapsed * 2.2) * 0.08,
        2.85,
      );
      this.fishMeshGroup.rotation.set(
        0.08,
        elapsed * 0.65,
        Math.sin(elapsed * 1.8) * 0.05,
      );
      this.activeFishRig.tailPivot.rotation.y = Math.sin(elapsed * 6.5) * 0.28;
      this.activeFishRig.pectoralL.rotation.x = Math.sin(elapsed * 5) * 0.18;
      this.activeFishRig.pectoralR.rotation.x = -Math.sin(elapsed * 5) * 0.18;
      if (this.activeFishRig.haloRing) {
        this.activeFishRig.haloRing.rotation.z = elapsed * 0.8;
      }
    }

    // 3. Apply Smooth Rod & Segment Kinematics
    this.rodPivot.rotation.x = THREE.MathUtils.damp(
      this.rodPivot.rotation.x,
      targetRodPitch,
      10,
      delta,
    );
    this.rodPivot.rotation.y = THREE.MathUtils.damp(
      this.rodPivot.rotation.y,
      targetRodYaw,
      8,
      delta,
    );
    this.reelCrank.rotation.x += this.reelRotationSpeed * delta;

    for (let i = 0; i < this.rodSegments.length; i++) {
      const segWeight = (i + 1) / this.rodSegments.length;
      const targetSegX = -bendAmount * segWeight * 1.35;
      const targetSegY = -bendLateral * segWeight;
      this.rodSegments[i].rotation.x = THREE.MathUtils.damp(
        this.rodSegments[i].rotation.x,
        targetSegX,
        14,
        delta,
      );
      this.rodSegments[i].rotation.y = THREE.MathUtils.damp(
        this.rodSegments[i].rotation.y,
        targetSegY,
        14,
        delta,
      );
    }

    this.rodPivot.updateMatrixWorld(true);
    this.rodTipAnchor.getWorldPosition(_rodTipWorld);

    // Keep bobber dangling gently beneath rod tip when IDLE / CHARGING / CAUGHT
    if (
      this.gameState === FishingState.IDLE ||
      this.gameState === FishingState.CHARGING ||
      this.gameState === FishingState.CAUGHT
    ) {
      const targetBobX = _rodTipWorld.x + Math.sin(elapsed * 2.1) * 0.04;
      const targetBobY = _rodTipWorld.y - 0.85;
      const targetBobZ = _rodTipWorld.z;
      this.bobberGroup.position.x = THREE.MathUtils.damp(
        this.bobberGroup.position.x,
        targetBobX,
        14,
        delta,
      );
      this.bobberGroup.position.y = THREE.MathUtils.damp(
        this.bobberGroup.position.y,
        targetBobY,
        14,
        delta,
      );
      this.bobberGroup.position.z = THREE.MathUtils.damp(
        this.bobberGroup.position.z,
        targetBobZ,
        14,
        delta,
      );
      this.bobberGroup.rotation.z = Math.sin(elapsed * 2.5) * 0.08;
    }

    // 4. Update 40-Point Catenary / Tension Fishing Line
    const endPos = this.bobberGroup.position;
    const sagAmount =
      this.gameState === FishingState.REELING
        ? THREE.MathUtils.lerp(0.42, 0.0, THREE.MathUtils.clamp(this.lineTension / 75, 0, 1))
        : this.gameState === FishingState.WAITING
          ? 0.35
          : 0.12;

    for (let i = 0; i < this.LINE_POINTS; i++) {
      const t = i / (this.LINE_POINTS - 1);
      const lx = THREE.MathUtils.lerp(_rodTipWorld.x, endPos.x, t);
      const lyBase = THREE.MathUtils.lerp(_rodTipWorld.y, endPos.y + 0.08, t);
      const lz = THREE.MathUtils.lerp(_rodTipWorld.z, endPos.z, t);
      const sag = Math.sin(t * Math.PI) * sagAmount;
      this.linePositions[i * 3] = lx;
      this.linePositions[i * 3 + 1] = lyBase - sag;
      this.linePositions[i * 3 + 2] = lz;
    }
    this.lineGeo.attributes.position.needsUpdate = true;

    // 5. Update Ripples & Splash Droplets
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += delta;
      if (r.age >= r.maxAge) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.ripples.splice(i, 1);
      } else {
        const s = 1 + r.age * r.speed * 4.2;
        r.mesh.scale.setScalar(s);
        r.mesh.material.opacity = 0.82 * (1 - r.age / r.maxAge);
      }
    }

    for (let i = 0; i < this.dropletCount; i++) {
      const d = this.droplets[i];
      if (d.life > 0) {
        d.life -= delta;
        d.vel.y -= 14.5 * delta;
        d.pos.addScaledVector(d.vel, delta);
        _dummyObj.position.copy(d.pos);
        _dummyObj.scale.setScalar(Math.max(0.01, d.life / d.maxLife));
      } else {
        _dummyObj.position.set(0, -50, 0);
        _dummyObj.scale.setScalar(0.001);
      }
      _dummyObj.updateMatrix();
      this.dropletInstanced.setMatrixAt(i, _dummyObj.matrix);
    }
    this.dropletInstanced.instanceMatrix.needsUpdate = true;

    // 6. Smooth Camera Choreography
    if (this.gameState === FishingState.REELING) {
      const shake =
        this.lineTension > 78
          ? Math.sin(elapsed * 42) * 0.035 * ((this.lineTension - 78) / 22)
          : 0;
      _targetCamPos.set(shake, 2.42, 6.05);
      _targetLookAt.set(
        this.bobberGroup.position.x * 0.45,
        0.65,
        Math.max(-28, this.bobberGroup.position.z),
      );
    } else if (this.gameState === FishingState.CHARGING) {
      _targetCamPos.set(0, 2.48, 6.55);
      _targetLookAt.set(Math.sin(this.aimAngle) * 8, 0.9, -16);
    } else if (this.gameState === FishingState.WAITING || this.gameState === FishingState.BITE) {
      _targetCamPos.set(0, 2.28, 5.95);
      _targetLookAt.set(
        this.bobberGroup.position.x * 0.55,
        0.4,
        Math.max(-26, this.bobberGroup.position.z),
      );
    } else {
      _targetCamPos.set(
        Math.sin(elapsed * 0.45) * 0.06,
        2.35 + Math.cos(elapsed * 0.6) * 0.03,
        6.2,
      );
      _targetLookAt.set(Math.sin(this.aimAngle) * 6, 1.0, -15);
    }

    this.camera.position.lerp(_targetCamPos, 1 - Math.exp(-5 * delta));
    this.currentLookAt.lerp(_targetLookAt, 1 - Math.exp(-5 * delta));
    this.camera.lookAt(this.currentLookAt);

    // 7. Throttled HUD Sync (30 Hz during active states)
    this.hudSyncAccumulator += delta;
    if (this.hudSyncAccumulator >= 0.033) {
      this.hudSyncAccumulator = 0;
      this.emitHud(false);
    }
  }

  private emitHud(force: boolean): void {
    if (
      !force &&
      this.gameState !== FishingState.CHARGING &&
      this.gameState !== FishingState.REELING &&
      this.gameState !== FishingState.BITE
    ) {
      return;
    }

    let statusMessage = '滑鼠微調拋投方向 · 按住 [滑鼠左鍵] 或 [空白鍵] 蓄力拋竿';
    if (this.gameState === FishingState.CHARGING) {
      statusMessage = '蓄力中 — 放開按鍵拋出浮標';
    } else if (this.gameState === FishingState.CASTING) {
      statusMessage = '浮標劃破長空...';
    } else if (this.gameState === FishingState.WAITING) {
      statusMessage = '靜觀漣漪 — 待浮標猛然沒入水中時點擊刺魚';
    } else if (this.gameState === FishingState.BITE) {
      statusMessage = '魚兒咬鉤！立即點擊或按 [空白鍵] 揚竿刺魚！';
    } else if (this.gameState === FishingState.REELING) {
      statusMessage = this.isFishBursting
        ? '巨物暴衝中！適時放開按鍵防止斷線！'
        : '搏魚拉鋸中 — 按住收線、放開降張力，維持在安全區間';
    } else if (this.gameState === FishingState.CAUGHT) {
      statusMessage = '成功起魚！請選擇收入魚護或放流祈福';
    }

    this.callbacks.onHudUpdate({
      state: this.gameState,
      statusMessage,
      isBiteUrgent: this.gameState === FishingState.BITE,
      castPower: Math.round(this.castPower),
      aimAngleDeg: Math.round(THREE.MathUtils.radToDeg(-this.aimAngle)),
      lineTension: Math.round(THREE.MathUtils.clamp(this.lineTension, 0, 100)),
      fishDistance: Number(Math.max(0, this.fishDistance).toFixed(1)),
      maxCastDistance: Number(this.maxCastDistance.toFixed(1)),
      fishStamina: Math.round(
        (this.fishStamina / Math.max(1, this.maxFishStamina)) * 100,
      ),
      isFishBursting: this.isFishBursting,
      activeFishRarity: this.currentFish?.rarity,
    });
  }

  public dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.cleanupListeners();

    this.waterGeo.dispose();
    this.waterMat.dispose();
    this.lineGeo.dispose();
    this.lineMat.dispose();
    this.rippleGeo.dispose();
    this.renderer.dispose();

    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
