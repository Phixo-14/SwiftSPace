import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const WALL_HEIGHT = 2.7;

function makeMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...options });
}

function addBox(parent, width, height, depth, color, x, y, z, options = {}) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.02, width), Math.max(0.02, height), Math.max(0.02, depth)),
    makeMaterial(color, options),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addFurniture(scene, placement) {
  const item = placement.catalogItem;
  if (!item) return;
  const width = placement.size?.width || item.footprint?.width || 1;
  const depth = placement.size?.length || item.footprint?.length || 1;
  const color = placement.customColor || item.defaultColor || '#b7a58a';
  const group = new THREE.Group();
  group.position.set(placement.gridX + width / 2, 0, placement.gridY + depth / 2);
  group.rotation.y = -((placement.rotation || 0) * Math.PI) / 180;
  scene.add(group);

  if (item.category === 'sleeping') {
    addBox(group, width * 0.94, 0.24, depth * 0.94, '#765b47', 0, 0.18, 0);
    addBox(group, width * 0.9, 0.25, depth * 0.89, color, 0, 0.42, 0.02);
    addBox(group, width * 0.34, 0.1, Math.min(0.32, depth * 0.22), '#f3eee2', 0, 0.61, -depth * 0.28);
  } else if (item.category === 'seating') {
    addBox(group, width * 0.92, 0.32, depth * 0.88, color, 0, 0.36, 0.03);
    addBox(group, width * 0.92, 0.58, Math.max(0.12, depth * 0.18), color, 0, 0.66, -depth * 0.38);
    if (width > 1.25) {
      addBox(group, width * 0.12, 0.42, depth * 0.76, color, -width * 0.43, 0.42, 0);
      addBox(group, width * 0.12, 0.42, depth * 0.76, color, width * 0.43, 0.42, 0);
    }
  } else if (item.category === 'storage') {
    addBox(group, width * 0.9, 1.45, depth * 0.88, color, 0, 0.75, 0);
    addBox(group, width * 0.82, 0.035, depth * 0.035, '#66513e', 0, 0.75, depth * 0.455);
  } else if (item.category === 'surface') {
    addBox(group, width * 0.96, 0.14, depth * 0.96, color, 0, 0.78, 0);
    const legColor = '#73583f';
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      addBox(group, 0.08, 0.74, 0.08, legColor, x * width * 0.4, 0.37, z * depth * 0.4);
    }
  } else if (item.category === 'greenery') {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.34, 12), makeMaterial('#a66e4f'));
    pot.position.y = 0.17;
    pot.castShadow = true;
    group.add(pot);
    const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.43, 1), makeMaterial(color));
    foliage.position.y = 0.68;
    foliage.scale.set(0.85, 1.2, 0.85);
    foliage.castShadow = true;
    group.add(foliage);
  } else if (item.category === 'lighting') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.25, 0.08, 16), makeMaterial('#5f5545'));
    base.position.y = 0.04;
    group.add(base);
    addBox(group, 0.07, 1.15, 0.07, '#746b5b', 0, 0.62, 0);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.36, 0.38, 16), makeMaterial(color, { emissive: color, emissiveIntensity: 0.12 }));
    shade.position.y = 1.34;
    group.add(shade);
  }
}

function makeRoomScene({ dimensions, floorCells, floorColor, placedItems, architecturalSegments, wallThicknessMm }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#17231e');
  scene.fog = new THREE.Fog('#17231e', 20, 60);
  scene.add(new THREE.HemisphereLight('#f5efe1', '#5f6c5d', 2.1));
  const sun = new THREE.DirectionalLight('#fff5df', 3.2);
  sun.position.set(-dimensions.width * 0.55, 12, dimensions.length * 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  scene.add(sun);

  const floorMaterial = makeMaterial(floorColor || '#bca17a');
  const floor = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 1), floorMaterial, floorCells.length);
  const matrix = new THREE.Matrix4();
  floorCells.forEach(({ x, y }, index) => {
    matrix.makeTranslation(x + 0.5, -0.05, y + 0.5);
    floor.setMatrixAt(index, matrix);
  });
  floor.castShadow = false;
  floor.receiveShadow = true;
  scene.add(floor);

  const edgeCounts = new Map();
  const addEdge = (x1, y1, x2, y2) => {
    const key = [x1, y1, x2, y2].join(',');
    const reverse = [x2, y2, x1, y1].join(',');
    if (edgeCounts.has(reverse)) edgeCounts.delete(reverse);
    else edgeCounts.set(key, { x1, y1, x2, y2 });
  };
  const cells = new Set(floorCells.map(({ x, y }) => `${x},${y}`));
  floorCells.forEach(({ x, y }) => {
    if (!cells.has(`${x - 1},${y}`)) addEdge(x, y, x, y + 1);
    if (!cells.has(`${x + 1},${y}`)) addEdge(x + 1, y, x + 1, y + 1);
    if (!cells.has(`${x},${y - 1}`)) addEdge(x, y, x + 1, y);
    if (!cells.has(`${x},${y + 1}`)) addEdge(x, y + 1, x + 1, y + 1);
  });
  edgeCounts.forEach((edge, key) => {
    const horizontal = Math.abs(edge.y1 - edge.y2) < 0.001;
    const axis = horizontal ? edge.y1 : edge.x1;
    const edgeStart = horizontal ? Math.min(edge.x1, edge.x2) : Math.min(edge.y1, edge.y2);
    const edgeEnd = horizontal ? Math.max(edge.x1, edge.x2) : Math.max(edge.y1, edge.y2);
    const containsOpening = architecturalSegments.some((segment) => {
      if (!['door', 'window'].includes(segment.type)) return false;
      const segmentHorizontal = Math.abs(segment.startY - segment.endY) < 0.001;
      const segmentAxis = segmentHorizontal ? segment.startY : segment.startX;
      if (segmentHorizontal !== horizontal || Math.abs(segmentAxis - axis) > 0.05) return false;
      const start = segmentHorizontal ? Math.min(segment.startX, segment.endX) : Math.min(segment.startY, segment.endY);
      const end = segmentHorizontal ? Math.max(segment.startX, segment.endX) : Math.max(segment.startY, segment.endY);
      return Math.min(edgeEnd, end) - Math.max(edgeStart, start) > 0.25;
    });
    if (containsOpening) edgeCounts.delete(key);
  });
  const thickness = Math.max(0.09, Math.min(0.22, (wallThicknessMm || 150) / 1000));
  const wallColor = makeMaterial('#e7e1d5');
  edgeCounts.forEach(({ x1, y1, x2, y2 }) => {
    const horizontal = y1 === y2;
    const length = Math.hypot(x2 - x1, y2 - y1);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(horizontal ? length : thickness, WALL_HEIGHT, horizontal ? thickness : length),
      wallColor,
    );
    wall.position.set((x1 + x2) / 2, WALL_HEIGHT / 2, (y1 + y2) / 2);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  });

  architecturalSegments.forEach((segment) => {
    const startX = segment.startX;
    const startZ = segment.startY;
    const endX = segment.endX;
    const endZ = segment.endY;
    const horizontal = Math.abs(startZ - endZ) < 0.001;
    const length = Math.hypot(endX - startX, endZ - startZ);
    if (!length) return;
    const x = (startX + endX) / 2;
    const z = (startZ + endZ) / 2;
    const wallDepth = Math.max(0.07, Math.min(0.2, (segment.thicknessMm || wallThicknessMm || 150) / 1000));
    if (segment.type === 'door') {
      const post = Math.max(0.08, wallDepth);
      addBox(scene, horizontal ? post : wallDepth, WALL_HEIGHT, horizontal ? wallDepth : post, '#e7e1d5', startX, WALL_HEIGHT / 2, startZ);
      addBox(scene, horizontal ? post : wallDepth, WALL_HEIGHT, horizontal ? wallDepth : post, '#e7e1d5', endX, WALL_HEIGHT / 2, endZ);
      addBox(scene, horizontal ? length : wallDepth, 0.12, horizontal ? wallDepth : length, '#e7e1d5', x, WALL_HEIGHT - 0.06, z);
    } else if (segment.type === 'window') {
      addBox(scene, horizontal ? length : wallDepth, 0.75, horizontal ? wallDepth : length, '#e7e1d5', x, 0.38, z);
      addBox(scene, horizontal ? length : wallDepth, 0.72, horizontal ? wallDepth : length, '#a9d9df', x, 1.55, z, { transparent: true, opacity: 0.62, metalness: 0.12, roughness: 0.15 });
      addBox(scene, horizontal ? length : wallDepth, 0.16, horizontal ? wallDepth : length, '#e7e1d5', x, 2.35, z);
    } else {
      addBox(scene, horizontal ? length : wallDepth, WALL_HEIGHT, horizontal ? wallDepth : length, '#e7e1d5', x, WALL_HEIGHT / 2, z);
    }
  });

  placedItems.forEach((item) => addFurniture(scene, item));
  return scene;
}

export default function RoomPreview3D({ dimensions, floorCells, floorColor, placedItems, architecturalSegments, wallThicknessMm }) {
  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const orbitRef = useRef(null);
  const walkRef = useRef(null);
  const walkingRef = useRef(false);
  const keysRef = useRef(new Set());
  const [walkActive, setWalkActive] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !floorCells.length) return undefined;
    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 600;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const scene = makeRoomScene({ dimensions, floorCells, floorColor, placedItems, architecturalSegments, wallThicknessMm });
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 100);
    cameraRef.current = camera;
    const maxDimension = Math.max(dimensions.width, dimensions.length);
    const target = new THREE.Vector3(dimensions.width / 2, 0.8, dimensions.length / 2);
    camera.position.set(dimensions.width + maxDimension * 0.55, maxDimension * 0.72, dimensions.length + maxDimension * 0.72);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.copy(target);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.075;
    orbit.maxPolarAngle = Math.PI * 0.49;
    orbit.minDistance = 2;
    orbit.maxDistance = maxDimension * 3;
    orbitRef.current = orbit;

    const walk = new PointerLockControls(camera, renderer.domElement);
    walkRef.current = walk;
    const onLockChange = () => {
      const active = document.pointerLockElement === renderer.domElement;
      walkingRef.current = active;
      setWalkActive(active);
      orbit.enabled = !active;
    };
    walk.addEventListener('lock', onLockChange);
    walk.addEventListener('unlock', onLockChange);
    const onKeyDown = (event) => keysRef.current.add(event.code);
    const onKeyUp = (event) => keysRef.current.delete(event.code);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const clock = new THREE.Clock();
    let frame = 0;
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      if (walkingRef.current) {
        const speed = 2.4 * delta;
        if (keysRef.current.has('KeyW') || keysRef.current.has('ArrowUp')) walk.moveForward(speed);
        if (keysRef.current.has('KeyS') || keysRef.current.has('ArrowDown')) walk.moveForward(-speed);
        if (keysRef.current.has('KeyA') || keysRef.current.has('ArrowLeft')) walk.moveRight(-speed);
        if (keysRef.current.has('KeyD') || keysRef.current.has('ArrowRight')) walk.moveRight(speed);
      } else {
        orbit.update();
      }
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = mount.clientWidth;
      const nextHeight = mount.clientHeight;
      if (!nextWidth || !nextHeight) return;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    });
    resizeObserver.observe(mount);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      walk.removeEventListener('lock', onLockChange);
      walk.removeEventListener('unlock', onLockChange);
      walk.dispose();
      orbit.dispose();
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      orbitRef.current = null;
      walkRef.current = null;
      cameraRef.current = null;
      walkingRef.current = false;
    };
  }, [architecturalSegments, dimensions, floorCells, floorColor, placedItems, wallThicknessMm]);

  function startWalkthrough() {
    const camera = cameraRef.current;
    if (camera) {
      camera.position.set(dimensions.width / 2, 1.62, Math.max(0.35, dimensions.length - 0.8));
      camera.lookAt(dimensions.width / 2, 1.62, dimensions.length / 2);
    }
    walkRef.current?.lock();
  }

  function exitWalkthrough() {
    walkRef.current?.unlock();
  }

  return (
    <section className="room-preview-3d" aria-label="Interactive 3D room preview">
      <div className="room-preview-toolbar">
        <button type="button" className={!walkActive ? 'active' : ''} onClick={exitWalkthrough}>Orbit view</button>
        <button type="button" className={walkActive ? 'active' : ''} onClick={startWalkthrough}>Walk through</button>
        <span>{walkActive ? 'WASD or arrow keys to move · Esc to exit' : 'Drag to orbit · Scroll to zoom · Walk through for first-person view'}</span>
      </div>
      <div ref={mountRef} className="room-preview-canvas" />
    </section>
  );
}
