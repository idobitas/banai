// Interactive Three.js viewer. Renders ONLY from store state: it rebuilds the wardrobe
// whenever the committed design changes, and never edits state except through
// store.select(). Door visibility is animated (doors swing or slide open) rather than
// rebuilt, and the camera glides between named views (see motion.js).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { buildWardrobe, disposeWardrobe } from './buildWardrobe.js';
import { frameOf } from './builders/frame.js';
import { createDimensions } from './dimensions.js';
import { createHighlighter } from './highlight.js';
import { createMaterials } from './materials.js';
import { createTween, doorPose, isView, MOTION, stepToward, viewPose } from './motion.js';
import { attachPicking } from './picking.js';

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const BACKGROUND = '#eceeec';

function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.add(new THREE.HemisphereLight('#ffffff', '#c9c4b8', 2.2));
  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#ffffff', 0.9);
  fill.position.set(-2, 2, 5);
  scene.add(fill);
  const grid = new THREE.GridHelper(12, 24, '#c9ccc8', '#dcdfdb');
  grid.position.y = -0.0005;
  scene.add(grid);
  return scene;
}

/** Map a raycast hit to a selectable component id (the back panel selects its compartment). */
function componentAt(hit, design) {
  if (!hit) return null;
  const { componentId, part } = hit.object.userData;
  if (part !== 'back') return componentId;
  const frame = frameOf(design);
  const xMm = hit.point.x * 1000;
  const index = frame.ranges.findIndex(([x0, x1]) => xMm >= x0 && xMm <= x1);
  return index >= 0 ? design.compartments[index].id : componentId;
}

export function createViewer(container, store, { onViewChange = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', '3D wardrobe view');
  container.appendChild(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'viewer-labels';
  container.appendChild(labels.domElement);

  const scene = createScene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, minDistance: 0.6, maxDistance: 14, maxPolarAngle: Math.PI / 2 - 0.02 });

  const materials = createMaterials(store.getState().catalog);
  const highlighter = createHighlighter(scene);
  const dimensions = createDimensions(scene);
  let group = null;
  let rendered = { design: null, selection: undefined, dimsKey: null };

  // --- Camera: named views, glided with a tween; a user drag cancels the glide. ---
  let view = 'angle';
  let cameraTween = null;
  const applyCamera = ({ position, target }) => {
    camera.position.fromArray(position);
    controls.target.fromArray(target);
  };
  const goTo = (name, { animate = true } = {}) => {
    view = name;
    const to = viewPose(store.getState().design, name, camera.fov);
    if (!animate || prefersReducedMotion()) {
      cameraTween = null;
      applyCamera(to);
      controls.update();
    } else {
      const from = { position: camera.position.toArray(), target: controls.target.toArray() };
      cameraTween = createTween({ from, to, durationMs: MOTION.cameraDurationMs, startMs: performance.now() });
    }
    onViewChange(view);
  };
  controls.addEventListener('start', () => {
    cameraTween = null;
    if (view !== null) {
      view = null; // a free orbit no longer matches a named view
      onViewChange(view);
    }
  });

  // --- Doors: always built; opened by animating `openness` toward 0 (closed) or 1 (open). ---
  let doorOpenness = store.getState().ui.doorsVisible ? 0 : 1;
  let doorTarget = doorOpenness;
  let doorMeshes = [];
  let fadeMaterials = [];
  const poseDoors = () => {
    doorMeshes.forEach((mesh) => {
      const pose = doorPose(mesh.userData.motion, doorOpenness);
      mesh.position.fromArray(pose.position);
      mesh.rotation.y = pose.rotationY;
      mesh.visible = pose.visible;
      if (mesh.material.transparent) mesh.material.opacity = pose.opacity;
    });
  };
  const adoptDoors = () => {
    fadeMaterials.forEach((material) => material.dispose());
    fadeMaterials = [];
    doorMeshes = group.children.filter((mesh) => mesh.userData.kind === 'door');
    // Sliding panels fade, so each gets its own transparent copy (cached materials are shared).
    doorMeshes.filter((mesh) => mesh.userData.motion.type === 'sliding').forEach((mesh) => {
      mesh.material = mesh.material.clone();
      mesh.material.transparent = true;
      fadeMaterials.push(mesh.material);
    });
    poseDoors();
  };

  const sync = (state) => {
    const { design, ui, selection } = state;
    const geometryChanged = design !== rendered.design;
    doorTarget = ui.doorsVisible ? 0 : 1;
    if (prefersReducedMotion()) doorOpenness = doorTarget;
    if (geometryChanged) {
      if (group) {
        scene.remove(group);
        disposeWardrobe(group);
      }
      group = buildWardrobe(design, materials, { doorsVisible: true });
      scene.add(group);
      materials.retainOnly(new Set(group.children.map((mesh) => mesh.material)));
      adoptDoors();
      const { width, height, depth } = design.dimensions;
      const dimsKey = `${width}x${height}x${depth}`;
      if (dimsKey !== rendered.dimsKey) goTo(view ?? 'angle', { animate: rendered.dimsKey !== null });
      rendered = { ...rendered, design, dimsKey };
    }
    if (geometryChanged || selection !== rendered.selection) {
      highlighter.update(group, design, selection);
      dimensions.update(group, design, selection);
      rendered = { ...rendered, selection };
    }
  };

  // Floating panels cover the canvas edges: shift the projection centre into the free area.
  let insets = { left: 0, right: 0 };
  const resize = () => {
    const { clientWidth, clientHeight } = container;
    renderer.setSize(clientWidth, clientHeight);
    labels.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / Math.max(clientHeight, 1);
    camera.setViewOffset(clientWidth, Math.max(clientHeight, 1), (insets.right - insets.left) / 2, 0, clientWidth, Math.max(clientHeight, 1));
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const detachPicking = attachPicking({
    dom: renderer.domElement,
    camera,
    getTargets: () => (group ? group.children.filter((mesh) => mesh.visible) : []),
    onPick: (hit) => store.select(componentAt(hit, store.getState().design)),
  });
  const unsubscribe = store.subscribe(sync);
  sync(store.getState());

  let lastFrame = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(now - lastFrame, 100); // a background tab must not jump a whole animation
    lastFrame = now;
    if (doorOpenness !== doorTarget) {
      doorOpenness = stepToward(doorOpenness, doorTarget, dt, MOTION.doorDurationMs);
      poseDoors();
    }
    if (cameraTween) {
      const { value, done } = cameraTween.at(now);
      applyCamera(value);
      if (done) cameraTween = null;
    }
    controls.update();
    highlighter.follow();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });

  return {
    camera,
    controls,
    canvas: renderer.domElement,
    /** Glide to a named view ('front' | 'angle' | 'top'); fit() re-frames the current one. */
    setView(name) {
      if (isView(name)) goTo(name);
    },
    fit: () => goTo(view ?? 'angle'),
    get view() {
      return view;
    },
    /** Pixels covered by floating panels on each side of the canvas. */
    setInsets(next) {
      insets = { left: Math.max(0, next.left), right: Math.max(0, next.right) };
      resize();
    },
    doorOpenness: () => doorOpenness,
    meshOf: (componentId) => group?.children.find((mesh) => mesh.userData.componentId === componentId) ?? null,
    /** Client (page) coordinates of a component's centre, for tests and tooling. */
    screenPointOf(componentId) {
      const mesh = this.meshOf(componentId);
      if (!mesh) return null;
      const projected = mesh.position.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + ((projected.x + 1) / 2) * rect.width, y: rect.top + ((1 - projected.y) / 2) * rect.height };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      unsubscribe();
      detachPicking();
      resizeObserver.disconnect();
      if (group) disposeWardrobe(group);
      fadeMaterials.forEach((material) => material.dispose());
      highlighter.dispose();
      dimensions.dispose();
      materials.dispose();
      controls.dispose();
      renderer.dispose();
    },
  };
}
