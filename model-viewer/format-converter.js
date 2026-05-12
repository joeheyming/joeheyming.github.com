/**
 * Convert non-glTF model formats (STL/OBJ/PLY/FBX/3MF) into a `.glb` Blob URL
 * so the page's <model-viewer> can render them with its standard pipeline.
 *
 * Loaders and the exporter are pulled from the `three` and `three/addons/` import
 * specifiers configured in the page's importmap.
 *
 * Public surface:
 *   isSupportedExtension(name) -> boolean
 *   needsConversion(name) -> boolean      (true for non-glTF formats we can convert)
 *   convertToGlbBlobUrl(arrayBuffer, fileName) -> Promise<string>   // blob: URL
 */

import * as THREE from 'three';

const SUPPORTED_EXTS = new Set(['glb', 'gltf', 'stl', 'obj', 'ply', 'fbx', '3mf']);
const CONVERTIBLE_EXTS = new Set(['stl', 'obj', 'ply', 'fbx', '3mf']);

function extOf(name) {
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isSupportedExtension(name) {
  return SUPPORTED_EXTS.has(extOf(name));
}

export function needsConversion(name) {
  return CONVERTIBLE_EXTS.has(extOf(name));
}

/**
 * Wrap a raw `BufferGeometry` (no material) in a `Mesh` with a default
 * physically-based material. Used for STL and PLY (geometry-only formats).
 */
function meshFromGeometry(geometry) {
  geometry.computeVertexNormals();
  const hasColors = !!geometry.getAttribute('color');
  const material = new THREE.MeshStandardMaterial({
    color: hasColors ? 0xffffff : 0xb8b0c8,
    metalness: 0.1,
    roughness: 0.6,
    vertexColors: hasColors,
    flatShading: !geometry.getAttribute('normal')
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * STL/PLY/3MF authoring tools (CAD, slicers, scanners) almost always emit
 * geometry in a Z-up coordinate system, while glTF / <model-viewer> expect Y-up.
 * Apply the canonical -90° X rotation so models stand upright. OBJ/FBX usually
 * already export Y-up so we leave them alone.
 */
const Z_UP_EXTS = new Set(['stl', 'ply', '3mf']);

function fixUpAxis(object3d, ext) {
  if (!Z_UP_EXTS.has(ext)) return object3d;
  const wrapper = new THREE.Group();
  wrapper.rotation.x = -Math.PI / 2;
  wrapper.add(object3d);
  return wrapper;
}

/**
 * Center the object's bounding box at the origin and lift it so the lowest
 * point sits on y=0, similar to <model-viewer>'s default framing for glb files.
 */
function recenter(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  if (!isFinite(box.min.x)) return; // empty scene guard
  const center = new THREE.Vector3();
  box.getCenter(center);
  object3d.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
}

async function loadStl(arrayBuffer) {
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
  const geometry = new STLLoader().parse(arrayBuffer);
  return meshFromGeometry(geometry);
}

async function loadPly(arrayBuffer) {
  const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
  const geometry = new PLYLoader().parse(arrayBuffer);
  return meshFromGeometry(geometry);
}

async function loadObj(arrayBuffer) {
  const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
  const text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
  const root = new OBJLoader().parse(text);
  const fallback = new THREE.MeshStandardMaterial({
    color: 0xb8b0c8,
    metalness: 0.1,
    roughness: 0.6
  });
  root.traverse((child) => {
    if (child.isMesh) {
      // OBJ without MTL gives every mesh `MeshPhongMaterial({color: 0xffffff})`; that
      // looks flat under <model-viewer>'s default lighting, so swap in a PBR default.
      const mat = child.material;
      const isDefaultPhong =
        mat && mat.type === 'MeshPhongMaterial' && (!mat.map || mat.map === null);
      if (isDefaultPhong) child.material = fallback;
    }
  });
  return root;
}

async function loadFbx(arrayBuffer) {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  return new FBXLoader().parse(arrayBuffer, '');
}

async function load3mf(arrayBuffer) {
  const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
  return new ThreeMFLoader().parse(arrayBuffer);
}

const LOADERS = {
  stl: loadStl,
  ply: loadPly,
  obj: loadObj,
  fbx: loadFbx,
  '3mf': load3mf
};

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} fileName
 * @returns {Promise<string>} blob: URL pointing at a freshly-built .glb
 */
export async function convertToGlbBlobUrl(arrayBuffer, fileName) {
  const ext = extOf(fileName);
  const loader = LOADERS[ext];
  if (!loader) throw new Error(`Unsupported model format: .${ext}`);

  const raw = await loader(arrayBuffer);
  if (!raw) throw new Error(`Loader produced no object for .${ext}`);

  const object3d = fixUpAxis(raw, ext);
  recenter(object3d);

  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const exporter = new GLTFExporter();

  const glbBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      object3d,
      (result) => {
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          // Should not happen with binary:true, but guard anyway.
          reject(new Error('GLTFExporter returned non-binary output'));
        }
      },
      (err) => reject(err),
      {
        binary: true,
        embedImages: true,
        // Animations on the root object only — most loaders attach them there.
        animations: object3d.animations || []
      }
    );
  });

  const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
  return URL.createObjectURL(blob);
}
