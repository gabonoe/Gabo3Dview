/* ============================================
   3D Model Viewer — Main Application Logic
   Three.js + GLTFLoader + EXRLoader
   OrbitControls + TransformControls
   ============================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// ─────────────────────────────────────────────
// Global State
// ─────────────────────────────────────────────
let scene, camera, renderer;
let orbitControls, transformControls;
let gridHelper, axesHelper;
let currentModel = null;
let currentHDRI = null;
let clock = new THREE.Clock();
let autoRotate = true;
let autoRotateSpeed = 0.5;
let modelInitialTransform = null;
let hologramActive = false;
let originalMaterials = new Map();

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────
function init() {
  // --- Scene ---
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // --- Camera ---
  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.01,
    1000
  );
  camera.position.set(3, 2, 5);

  // --- Renderer (4K support, antialias, shadows) ---
  const canvas = document.getElementById('viewer-canvas');
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // --- Default Lighting ---
  setupDefaultLights();

  // --- Grid & Axes Helpers ---
  gridHelper = new THREE.GridHelper(20, 40, 0x444444, 0x222222);
  gridHelper.visible = true;
  scene.add(gridHelper);

  axesHelper = new THREE.AxesHelper(3);
  axesHelper.visible = true;
  scene.add(axesHelper);

  // --- Ground plane for shadow receiving ---
  const groundGeo = new THREE.PlaneGeometry(50, 50);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.001;
  ground.receiveShadow = true;
  ground.name = '__ground__';
  scene.add(ground);

  // --- Orbit Controls ---
  orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.minDistance = 0.1;
  orbitControls.maxDistance = 100;
  orbitControls.target.set(0, 0, 0);

  // --- Transform Controls ---
  transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode('translate');
  transformControls.addEventListener('dragging-changed', (event) => {
    orbitControls.enabled = !event.value;
  });
  scene.add(transformControls);

  // --- Events ---
  window.addEventListener('resize', onWindowResize);
  setupDragAndDrop();
  setupUIListeners();

  // --- Load default EXR environment ---
  loadDefaultEXR();

  // --- Load default model ---
  loadDefaultModel();

  // --- Start render loop ---
  animate();

  // --- Update info bar ---
  updateInfoBar();
}

// ─────────────────────────────────────────────
// Default Lighting Setup
// ─────────────────────────────────────────────
function setupDefaultLights() {
  // Ambient light for base illumination
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  ambient.name = '__ambient__';
  scene.add(ambient);

  // Main directional light with shadows
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.name = '__dirLight__';
  dirLight.position.set(5, 8, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -10;
  dirLight.shadow.camera.right = 10;
  dirLight.shadow.camera.top = 10;
  dirLight.shadow.camera.bottom = -10;
  dirLight.shadow.bias = -0.0001;
  scene.add(dirLight);

  // Fill light
  const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
  fillLight.name = '__fillLight__';
  fillLight.position.set(-3, 4, -3);
  scene.add(fillLight);

  // Hemisphere light for natural feel
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
  hemiLight.name = '__hemiLight__';
  scene.add(hemiLight);
}

// ─────────────────────────────────────────────
// Window Resize
// ─────────────────────────────────────────────
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// ─────────────────────────────────────────────
// Render Loop
// ─────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  // Auto-rotate model slowly around Y axis
  if (currentModel && autoRotate) {
    currentModel.rotation.y += autoRotateSpeed * delta;
  }

  orbitControls.update();
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────
// Shared Model Setup (used by GLB, FBX, and default loaders)
// ─────────────────────────────────────────────
function setupLoadedModel(model, name) {
  // Remove previous model
  if (currentModel) {
    transformControls.detach();
    scene.remove(currentModel);
    disposeObject(currentModel);
  }

  model.name = name || 'LoadedModel';

  // Enable shadows on all meshes
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.envMapIntensity = 1.0;
      }
    }
  });

  // Center and scale model to fit view
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Move model so it sits on the ground
  model.position.sub(center);
  model.position.y += size.y / 2;

  // Scale to reasonable size if too large or too small
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 10 || maxDim < 0.1) {
    const scale = 3 / maxDim;
    model.scale.setScalar(scale);
  }

  scene.add(model);
  currentModel = model;

  // Save initial transform for reset
  modelInitialTransform = {
    position: model.position.clone(),
    rotation: model.rotation.clone(),
    scale: model.scale.clone()
  };

  // Reset hologram state
  hologramActive = false;
  originalMaterials.clear();
  const holoToggle = document.getElementById('toggle-hologram');
  if (holoToggle) holoToggle.checked = false;

  // Attach transform controls
  transformControls.attach(model);

  // Frame model in camera
  frameModel(model);

  // Update info
  updateInfoBar();
}

// ─────────────────────────────────────────────
// GLB Model Loader
// ─────────────────────────────────────────────
function loadGLBModel(fileOrUrl, name) {
  showLoading(true, 'Cargando modelo...');

  const isFile = fileOrUrl instanceof File;
  const url = isFile ? URL.createObjectURL(fileOrUrl) : fileOrUrl;
  const modelName = name || (isFile ? fileOrUrl.name : 'Model');

  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  loader.setDRACOLoader(dracoLoader);

  loader.load(
    url,
    (gltf) => {
      setupLoadedModel(gltf.scene, modelName);
      showLoading(false);
      if (isFile) URL.revokeObjectURL(url);
    },
    (progress) => {
      if (progress.total > 0) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        showLoading(true, `Cargando modelo... ${pct}%`);
      }
    },
    (error) => {
      console.error('Error loading GLB:', error);
      showLoading(false);
      alert('Error al cargar el modelo. Revisa la consola para más detalles.');
      if (isFile) URL.revokeObjectURL(url);
    }
  );
}

// ─────────────────────────────────────────────
// Default Model Loader (Astronaut.glb from assets)
// ─────────────────────────────────────────────
function loadDefaultModel() {
  loadGLBModel('assets/Astronaut.glb', 'Astronaut.glb');
}

// ─────────────────────────────────────────────
// Apply EXR texture to scene (shared logic)
// ─────────────────────────────────────────────
function applyEnvironmentTexture(texture) {
  texture.mapping = THREE.EquirectangularReflectionMapping;

  // Set as environment map and visible background
  scene.environment = texture;
  scene.background = texture;

  // Sync the HDRI background toggle
  const hdriToggle = document.getElementById('toggle-hdri-bg');
  if (hdriToggle) hdriToggle.checked = true;

  // Dispose previous HDRI
  if (currentHDRI) {
    currentHDRI.dispose();
  }
  currentHDRI = texture;

  // Update all materials to use the environment map
  if (currentModel) {
    currentModel.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.envMap = texture;
        child.material.envMapIntensity = 1.0;
        child.material.needsUpdate = true;
      }
    });
  }

  updateInfoBar();
}

// ─────────────────────────────────────────────
// HDRI Loader (from local file)
// ─────────────────────────────────────────────
function loadHDRI(file) {
  showLoading(true, 'Cargando HDRI...');

  const url = URL.createObjectURL(file);
  const loader = new EXRLoader();

  loader.load(
    url,
    (texture) => {
      applyEnvironmentTexture(texture);
      showLoading(false);
      URL.revokeObjectURL(url);
    },
    (progress) => {
      if (progress.total > 0) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        showLoading(true, `Cargando HDRI... ${pct}%`);
      }
    },
    (error) => {
      console.error('Error loading HDRI:', error);
      showLoading(false);
      alert('Error al cargar el archivo HDRI. Revisa la consola para más detalles.');
      URL.revokeObjectURL(url);
    }
  );
}

// ─────────────────────────────────────────────
// Preset Environment Map (Poly Haven free HDRIs)
// ─────────────────────────────────────────────
const ENV_PRESETS = {
  studio:  { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/2k/studio_small_09_2k.exr',  label: 'Estudio Profesional' },
  sunset:  { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/2k/industrial_sunset_02_puresky_2k.exr', label: 'Atardecer Industrial' },
  sky:     { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/2k/kloofendal_48d_partly_cloudy_puresky_2k.exr', label: 'Cielo Despejado' },
  night:   { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/2k/moonless_golf_2k.exr',     label: 'Noche Estrellada' },
  city:    { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/2k/shanghai_bund_2k.exr',     label: 'Ciudad Futurista' },
  evening: { url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/exr/2k/evening_road_01_2k.exr',   label: 'Camino al Atardecer' }
};

// ─────────────────────────────────────────────
// Preset EXR Loader
// ─────────────────────────────────────────────
function loadPresetEXR(key) {
  const preset = ENV_PRESETS[key];
  if (!preset) return;

  const loader = new EXRLoader();
  showLoading(true, `Cargando entorno: ${preset.label}...`);

  loader.load(
    preset.url,
    (texture) => {
      applyEnvironmentTexture(texture);
      showLoading(false);
      console.log(`Environment loaded: ${preset.label}`);
    },
    (progress) => {
      if (progress.total > 0) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        showLoading(true, `Cargando entorno... ${pct}%`);
      }
    },
    (error) => {
      console.warn(`Could not load preset EXR (${preset.label}):`, error);
      showLoading(false);
    }
  );
}

// ─────────────────────────────────────────────
// Default EXR Loader (loads 'studio' preset)
// ─────────────────────────────────────────────
function loadDefaultEXR() {
  loadPresetEXR('evening');
}

// ─────────────────────────────────────────────
// Camera Framing
// ─────────────────────────────────────────────
function frameModel(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2)));
  cameraZ *= 1.2; // Close-up margin

  camera.position.set(center.x + cameraZ * 0.4, center.y + cameraZ * 0.25, center.z + cameraZ * 0.9);
  orbitControls.target.copy(center);
  orbitControls.update();
}

// ─────────────────────────────────────────────
// Reset Model Transform
// ─────────────────────────────────────────────
function resetModelTransform() {
  if (!currentModel || !modelInitialTransform) return;
  currentModel.position.copy(modelInitialTransform.position);
  currentModel.rotation.copy(modelInitialTransform.rotation);
  currentModel.scale.copy(modelInitialTransform.scale);
}

// ─────────────────────────────────────────────
// Hologram Shader
// ─────────────────────────────────────────────
const hologramVertexShader = `
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const hologramFragmentShader = `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    // Subtle fresnel for soft edge highlight
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.0);

    // Light specular reflection
    vec3 lightDir = normalize(vec3(5.0, 8.0, 5.0) - vWorldPosition);
    vec3 halfDir = normalize(lightDir + viewDir);
    float spec = pow(max(dot(vNormal, halfDir), 0.0), 32.0) * 0.5;

    vec3 color = uColor + vec3(spec);
    float alpha = uAlpha + fresnel * 0.15 + spec * 0.2;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.6));
  }
`;

function createHologramMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: hologramVertexShader,
    fragmentShader: hologramFragmentShader,
    uniforms: {
      uColor: { value: new THREE.Color(0x4dd7ef) },
      uAlpha: { value: 0.30 }
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });
}

function toggleHologram(enabled) {
  if (!currentModel) return;
  hologramActive = enabled;

  if (enabled) {
    // Save original materials and apply hologram
    currentModel.traverse((child) => {
      if (child.isMesh) {
        if (!originalMaterials.has(child.uuid)) {
          originalMaterials.set(child.uuid, child.material);
        }
        child.material = createHologramMaterial();
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
  } else {
    // Restore original materials
    currentModel.traverse((child) => {
      if (child.isMesh && originalMaterials.has(child.uuid)) {
        // Dispose hologram material
        if (child.material && child.material.dispose) child.material.dispose();
        child.material = originalMaterials.get(child.uuid);
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }
}

// ─────────────────────────────────────────────
// Reset Camera
// ─────────────────────────────────────────────
function resetCamera() {
  if (currentModel) {
    frameModel(currentModel);
  } else {
    camera.position.set(3, 2, 5);
    orbitControls.target.set(0, 0, 0);
    orbitControls.update();
  }
}

// ─────────────────────────────────────────────
// Dispose Helper
// ─────────────────────────────────────────────
function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => disposeMaterial(m));
      } else {
        disposeMaterial(child.material);
      }
    }
  });
}

function disposeMaterial(material) {
  for (const key of Object.keys(material)) {
    const value = material[key];
    if (value && typeof value === 'object' && typeof value.dispose === 'function') {
      value.dispose();
    }
  }
  material.dispose();
}

// ─────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────
function showLoading(visible, message) {
  const overlay = document.getElementById('loading-overlay');
  const text = overlay.querySelector('p');
  if (message) text.textContent = message;
  overlay.classList.toggle('visible', visible);
}

function updateInfoBar() {
  const bar = document.getElementById('info-bar');
  let info = `Renderer: WebGL | Tone Mapping: ACES Filmic`;
  if (currentModel) {
    let triCount = 0;
    currentModel.traverse((c) => {
      if (c.isMesh && c.geometry) {
        const idx = c.geometry.index;
        triCount += idx ? idx.count / 3 : c.geometry.attributes.position.count / 3;
      }
    });
    info += ` | Triángulos: ${Math.round(triCount).toLocaleString()}`;
    info += ` | Modelo: ${currentModel.name}`;
  }
  if (currentHDRI) {
    info += ` | HDRI: Activo`;
  }
  bar.textContent = info;
}

// ─────────────────────────────────────────────
// Transform Mode Switching
// ─────────────────────────────────────────────
function setTransformMode(mode) {
  transformControls.setMode(mode);

  // Update button active states
  document.querySelectorAll('.btn-transform').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

// ─────────────────────────────────────────────
// Drag & Drop Support
// ─────────────────────────────────────────────
function setupDragAndDrop() {
  const overlay = document.getElementById('drop-zone-overlay');
  let dragCounter = 0;

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    overlay.classList.add('visible');
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      overlay.classList.remove('visible');
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    overlay.classList.remove('visible');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const name = file.name.toLowerCase();
      if (name.endsWith('.glb') || name.endsWith('.gltf')) {
        loadGLBModel(file);
      } else if (name.endsWith('.exr')) {
        loadHDRI(file);
      } else {
        alert('Formato no soportado. Usa archivos .glb o .exr');
      }
    }
  });
}

// ─────────────────────────────────────────────
// UI Event Listeners
// ─────────────────────────────────────────────
function setupUIListeners() {
  // --- File Inputs ---
  const glbInput = document.getElementById('glb-input');
  const hdriInput = document.getElementById('hdri-input');

  document.getElementById('btn-load-model').addEventListener('click', () => {
    glbInput.click();
  });

  glbInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      loadGLBModel(e.target.files[0]);
      e.target.value = ''; // Reset so same file can be reloaded
    }
  });

  // --- Environment Preset Select ---
  const envSelect = document.getElementById('env-select');
  envSelect.addEventListener('change', (e) => {
    const value = e.target.value;
    if (value === 'custom') {
      hdriInput.click();
      // Reset select to previous value after file dialog
      envSelect.value = 'evening';
    } else {
      loadPresetEXR(value);
    }
  });

  hdriInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      loadHDRI(e.target.files[0]);
      e.target.value = '';
    }
  });

  // --- Transform Mode Buttons ---
  document.querySelectorAll('.btn-transform').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTransformMode(btn.dataset.mode);
    });
  });

  // --- Reset Camera ---
  document.getElementById('btn-reset-camera').addEventListener('click', resetCamera);

  // --- Reset Model Transform ---
  document.getElementById('btn-reset-model').addEventListener('click', resetModelTransform);

  // --- Grid Toggle ---
  document.getElementById('toggle-grid').addEventListener('change', (e) => {
    gridHelper.visible = e.target.checked;
  });

  // --- Axes Toggle ---
  document.getElementById('toggle-axes').addEventListener('change', (e) => {
    axesHelper.visible = e.target.checked;
  });

  // --- HDRI Background Toggle ---
  document.getElementById('toggle-hdri-bg').addEventListener('change', (e) => {
    if (e.target.checked && currentHDRI) {
      scene.background = currentHDRI;
    } else {
      scene.background = new THREE.Color(0x000000);
    }
  });

  // --- Auto-Rotate Toggle ---
  document.getElementById('toggle-auto-rotate').addEventListener('change', (e) => {
    autoRotate = e.target.checked;
  });

  // --- Hologram Toggle ---
  document.getElementById('toggle-hologram').addEventListener('change', (e) => {
    toggleHologram(e.target.checked);
  });

  // --- Wireframe Toggle ---
  document.getElementById('toggle-wireframe').addEventListener('change', (e) => {
    if (currentModel) {
      currentModel.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.wireframe = e.target.checked;
        }
      });
    }
  });

  // --- Panel Collapse Toggle ---
  document.getElementById('panel-toggle').addEventListener('click', () => {
    const panel = document.getElementById('side-panel');
    panel.classList.toggle('collapsed');
    const btn = document.getElementById('panel-toggle');
    btn.textContent = panel.classList.contains('collapsed') ? '▶' : '◀';
  });

  // --- Exposure Slider ---
  const exposureSlider = document.getElementById('slider-exposure');
  const exposureValue = document.getElementById('exposure-value');
  exposureSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    renderer.toneMappingExposure = val;
    exposureValue.textContent = val.toFixed(2);
  });

  // --- Keyboard Shortcuts ---
  window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
      case 'g':
        setTransformMode('translate');
        break;
      case 'r':
        setTransformMode('rotate');
        break;
      case 's':
        if (!e.ctrlKey) setTransformMode('scale');
        break;
      case 'escape':
        if (currentModel) transformControls.detach();
        break;
      case 'f':
        if (currentModel) frameModel(currentModel);
        break;
    }
  });
}

// ─────────────────────────────────────────────
// Start Application
// ─────────────────────────────────────────────
init();
