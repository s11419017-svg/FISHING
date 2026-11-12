import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FishSpecies } from '../types/game';
import { buildCompositeFishModel } from '../three/proceduralFish';
import { detectSoftwareWebGL } from '../three/FishingSceneController';

interface FishPreview3DProps {
  species: FishSpecies;
  unlocked: boolean;
}

export function FishPreview3D({ species, unlocked }: FishPreview3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || 320;
    const height = container.clientHeight || 220;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 50);
    camera.position.set(0, 0.35, 2.35);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const keyLight = new THREE.DirectionalLight(0xfffbeb, unlocked ? 2.4 : 0.25);
    keyLight.position.set(3, 4, 4);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, unlocked ? 1.4 : 0.8);
    rimLight.position.set(-3, 2, -4);
    scene.add(rimLight);

    scene.add(new THREE.HemisphereLight(0xbae6fd, 0x0f172a, unlocked ? 0.85 : 0.15));

    const fishGroup = new THREE.Group();
    scene.add(fishGroup);

    const rig = buildCompositeFishModel(
      fishGroup,
      unlocked
        ? species
        : {
            ...species,
            bodyColor: 0x0f172a,
            bellyColor: 0x090d16,
            finColor: 0x1e293b,
            patternColor: 0x020617,
            glowColor: undefined,
          },
      0.95,
      renderer.capabilities.getMaxAnisotropy(),
    );

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.enablePan = false;
    controls.minDistance = 1.4;
    controls.maxDistance = 3.8;
    controls.autoRotate = !isSoftwareGl;
    controls.autoRotateSpeed = 1.8;

    let disposed = false;
    let frameId = 0;
    const clock = new THREE.Clock();

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;
      const elapsed = clock.getElapsedTime();
      rig.tailPivot.rotation.y = Math.sin(elapsed * 4.2) * 0.22;
      rig.pectoralL.rotation.x = Math.sin(elapsed * 3.2) * 0.14;
      rig.pectoralR.rotation.x = -Math.sin(elapsed * 3.2) * 0.14;
      if (rig.haloRing) {
        rig.haloRing.rotation.z = elapsed * 0.6;
      }
      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };
    tick();

    const handleResize = () => {
      if (disposed || !container) return;
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 220;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [species, unlocked]);

  return (
    <div className="relative w-full h-52 rounded-xl bg-slate-950/90 border border-slate-800/90 overflow-hidden">
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      <div className="pointer-events-none absolute bottom-2.5 right-3 text-xs text-slate-400">
        拖曳旋轉 360° 檢視
      </div>
    </div>
  );
}
