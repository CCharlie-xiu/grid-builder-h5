/**
 * scene.js — 3D 场景核心
 * 渲染器 / 相机 / 控制器 / 灯光 / 地面网格 / 动画循环
 * 天空 / 雾 / 远景地面 / 天际线由 sky.js 提供，统一通过 initSky() 挂载
 */

// Three.js core variables
let scene, camera, renderer, controls;
let gridHelper, raycaster, mouse;
const gridSize = 40; // 40x40 grid（版图 80x80 世界单位）
const tileSize = 2; // Each tile is 2x2 units
let plane; // Invisible raycast plane
// Key: "x,z", Value: 该格子已放置物品数组（栈结构，索引 0 为最底层）
let placedItems = new Map();

// Initialize Application
function init() {
    const container = document.getElementById('canvas-container');

    scene = new THREE.Scene();

    // 天空 / 大气雾 / 远景地面 / 天际线（sky.js）
    initSky();

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 1500);
    camera.position.set(80, 34, 108);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    refreshCursor();

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below ground
    controls.minDistance = 5;
    controls.maxDistance = 170;
    controls.target.set(0, 0, 0);

    // 环境光 + 半球光（天空色 → 地面色的自然反弹）
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(SKY.hemiSky, SKY.hemiGround, 0.65);
    scene.add(hemiLight);

    // 平行光（投射阴影）——太阳角度抬高，缩短阴影、贴近晴天观感
    const dirLight = new THREE.DirectionalLight(SKY.sun, 1.0);
    dirLight.position.set(50, 110, 35);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 220; // 收紧阴影深度范围，减少远处阴影抖动
    const d = 52;                     // 覆盖放大后的版图
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    dirLight.shadow.normalBias = 0.02; // 抵消平面自阴影噪点
    scene.add(dirLight);

    // 顶部冷色补光
    const pointLight = new THREE.PointLight(0x3b82f6, 1, 90);
    pointLight.position.set(0, 30, 0);
    scene.add(pointLight);

    createFloorAndGrid();

    // 独立导览相机（与编辑器相机分离）
    initTourCamera();

    // Setup Raycasting & Mouse tracking
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // 分类页签 + 物品栏
    buildCategoryTabs();
    renderPalette();

    // Create preview ghost item
    updatePreviewMesh();

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onClick);
    bindCanvasGestures();

    document.getElementById('btn-clear').addEventListener('click', clearScene);
    document.getElementById('btn-reset-cam').addEventListener('click', resetCamera);
    document.getElementById('btn-save-scene').addEventListener('click', saveSceneToStorage);
    document.getElementById('btn-load-scene').addEventListener('click', loadSceneFromStorage);

    // Start loop
    animate();
    showToast("欢迎使用3D网格建造器！点击地面放置物品。");
}

function createFloorAndGrid() {
    const totalWidth = gridSize * tileSize;

    // Floor base plane for raycasting
    const planeGeo = new THREE.PlaneGeometry(totalWidth, totalWidth);
    planeGeo.rotateX(-Math.PI / 2);
    const planeMat = new THREE.MeshBasicMaterial({ visible: false });
    plane = new THREE.Mesh(planeGeo, planeMat);
    scene.add(plane);

    // Visual Grid Helper with custom styling
    gridHelper = new THREE.GridHelper(totalWidth, gridSize, 0x60a5fa, 0x334155);
    gridHelper.position.y = 0.02; // 抬高 2cm，与地板保持深度间距，避免 z-fighting 闪烁
    scene.add(gridHelper);

    // Base ground plate with subtle aesthetics
    const baseGeo = new THREE.PlaneGeometry(totalWidth, totalWidth);
    baseGeo.rotateX(-Math.PI / 2);
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0x111a29,
        roughness: 0.8,
        metalness: 0.2,
        polygonOffset: true,          // 把地板在深度上稍微推远，让网格线/物体底面稳定压在它上面
        polygonOffsetFactor: 1.5,
        polygonOffsetUnits: 1.5
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.receiveShadow = true;
    scene.add(baseMesh);

    // Perimeter boundary frame
    const boxGeo = new THREE.BoxGeometry(totalWidth + 0.5, 0.6, totalWidth + 0.5);
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x24334a, roughness: 0.5 });
    const borderMesh = new THREE.Mesh(boxGeo, boxMat);
    borderMesh.position.y = -0.31; // 顶面降到 -0.01，不再与地板 y=0 共面（共面会整片闪烁）
    borderMesh.receiveShadow = true;
    scene.add(borderMesh);
}

// Window resize handler
function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    if (tourCamera) {
        tourCamera.aspect = aspect;
        tourCamera.updateProjectionMatrix();
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Animation Loop
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    // 导览：固定步长推进（与帧率解耦，重复播放结果一致）
    if (typeof advanceTour === 'function') advanceTour(dt);

    // 编辑器控制器只在编辑器相机渲染时驱动，避免与导览相机互相干扰
    if (renderCameraMode === 'editor') controls.update();

    // 镜头调试可视化与读数
    if (typeof updateCameraDebug === 'function') updateCameraDebug();

    // 选中高亮呼吸闪烁
    if (typeof updateSelectionPulse === 'function') updateSelectionPulse();

    // Optional subtle animation for magic crystals or lights
    placedItems.forEach(col => col.forEach(mesh => {
        // If it contains a light/gem, make it gently rotate
        if (mesh.children.length > 0 && mesh.children[0].geometry && mesh.children[0].geometry.type === 'OctahedronGeometry') {
            mesh.children[0].rotation.y += 0.01;
        }
    }));

    renderer.render(scene, getRenderCamera());
}
