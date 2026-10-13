/**
 * sky.js — 天际线天空系统（高德 3D 风格）
 *
 * 四层结构，由远及近：
 *   1. 渐变天穹   天顶 → 中层 → 地平线，地平线处叠加一条亮带
 *   2. 大气雾     线性雾，颜色取地平线色，远景统一淡出成雾色（大气透视）
 *   3. 远景地面   大圆盘，边缘正好落在雾的远端，无缝融进地平线
 *   4. 天际线剪影 一圈低多边形楼群，越远越淡，形成"城市天际线"
 *
 * 切换配色：改 SKY_PRESET 为 'day' 或 'dusk'
 */

const SKY_PRESETS = {
    // 高德日间：浅蓝渐变 + 白色地平线雾带
    day: {
        top: 0x2E6FB4,
        mid: 0x7FAFD8,
        horizon: 0xDCEAF6,
        band: 0xFFFFFF,
        fog: 0xCFE0EF,
        ground: 0x1E2A38,
        skyline: 0x6E93B8,
        hemiSky: 0xBFD8EF,
        hemiGround: 0x1A2433,
        sun: 0xFFF4E2
    },
    // 蓝调时刻：深蓝天顶 + 暖色地平线
    dusk: {
        top: 0x0A1730,
        mid: 0x27466E,
        horizon: 0xE0A870,
        band: 0xFFD9A0,
        fog: 0x35506E,
        ground: 0x121A26,
        skyline: 0x2E4460,
        hemiSky: 0x6E8CB0,
        hemiGround: 0x14181F,
        sun: 0xFFD9A8
    }
};

const SKY_PRESET = 'day';
const SKY = SKY_PRESETS[SKY_PRESET] || SKY_PRESETS.day;

// 各层尺度（世界单位）
const SKY_RADIUS = 700;         // 天穹半径，需小于相机 far
const FAR_GROUND_RADIUS = 520;  // 远景地面半径，应 ≈ 雾的远端
const SKYLINE_NEAR = 300;       // 天际线内圈半径
const SKYLINE_SPAN = 120;       // 天际线外扩范围
const FOG_NEAR = 170;           // 雾的起点略大于相机到建造台的距离，保证台面清晰
const FOG_FAR = 520;            // 与远景地面半径一致，边缘无缝融进地平线

// 远景地面与天穹的垂直位置（低于建造台面，形成台座落差）
const FAR_GROUND_Y = -0.8;
const SKYLINE_BASE_Y = -3;

let skyMesh = null;
let skylineGroup = null;
let farGroundMesh = null;

// ============ 天穹 ============

function createSky() {
    const geo = new THREE.SphereGeometry(SKY_RADIUS, 32, 20);
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            topColor: { value: new THREE.Color(SKY.top) },
            midColor: { value: new THREE.Color(SKY.mid) },
            horizonColor: { value: new THREE.Color(SKY.horizon) },
            bandColor: { value: new THREE.Color(SKY.band) }
        },
        vertexShader: `
            varying vec3 vPos;
            void main() {
                vPos = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 topColor;
            uniform vec3 midColor;
            uniform vec3 horizonColor;
            uniform vec3 bandColor;
            varying vec3 vPos;

            void main() {
                float h = normalize(vPos).y;

                // 地平线 → 中层 → 天顶 两段渐变（区间压得较窄，低视角也能看到层次）
                vec3 c = mix(horizonColor, midColor, smoothstep(0.0, 0.16, h));
                c = mix(c, topColor, smoothstep(0.14, 0.50, h));

                // 地平线亮带（高斯带状）
                float band = exp(-pow((h - 0.012) * 34.0, 2.0));
                c = mix(c, bandColor, band * 0.75);

                // 地平线以下统一压向雾色，避免看到生硬的下半球
                float below = 1.0 - smoothstep(-0.20, 0.02, h);
                c = mix(c, horizonColor, below * 0.9);

                gl_FragColor = vec4(c, 1.0);
            }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
    });

    skyMesh = new THREE.Mesh(geo, mat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -1;
    scene.add(skyMesh);
    return skyMesh;
}

// ============ 远景地面 ============

function createFarGround() {
    const geo = new THREE.CircleGeometry(FAR_GROUND_RADIUS, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: SKY.ground, roughness: 0.95, metalness: 0.0 });
    farGroundMesh = new THREE.Mesh(geo, mat);
    farGroundMesh.position.y = FAR_GROUND_Y;
    farGroundMesh.receiveShadow = false;
    scene.add(farGroundMesh);
    return farGroundMesh;
}

// ============ 天际线剪影 ============

// 确定性伪随机（保证每次刷新天际线一致，便于回归对比）
function skylineRand(seedRef) {
    seedRef.v = (seedRef.v * 1664525 + 1013904223) % 4294967296;
    return seedRef.v / 4294967296;
}

function createSkyline() {
    skylineGroup = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: SKY.skyline, fog: true });
    const seed = { v: 20261013 };
    const count = 96;

    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + skylineRand(seed) * 0.06;
        const radius = SKYLINE_NEAR + skylineRand(seed) * SKYLINE_SPAN;
        const w = 6 + skylineRand(seed) * 13;
        const d = 6 + skylineRand(seed) * 13;
        const h = 18 + skylineRand(seed) * 50;

        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.set(Math.cos(angle) * radius, SKYLINE_BASE_Y + h / 2, Math.sin(angle) * radius);
        mesh.rotation.y = angle;
        skylineGroup.add(mesh);
    }

    scene.add(skylineGroup);
    return skylineGroup;
}

// ============ 统一入口 ============

function initSky() {
    scene.background = new THREE.Color(SKY.horizon);
    scene.fog = new THREE.Fog(SKY.fog, FOG_NEAR, FOG_FAR);
    createSky();
    createFarGround();
    createSkyline();
}
