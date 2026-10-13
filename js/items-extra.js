/**
 * items-extra.js — 扩展物品工厂（建筑 / 地标 / 家具 / 城市配套）
 *
 * 通过 ITEM_BUILDERS 按 tool.id 注册建模函数，由 items.js 的 createItemMesh 分发调用。
 * 约定（与 items.js 一致）：
 *   - 每个物品 Group 的底面位于局部 y = 0
 *   - 在 group.userData.itemHeight 记录总高度（供堆叠与相机使用）
 *
 * 性能约定：材质与几何体全部走缓存（同类物品共享实例），避免大量放置时显存爆炸；
 * 窗户一律用 CanvasTexture 贴图，不使用独立 mesh。
 */

// ============ 材质 / 几何缓存 ============

const _matCache = {};
const _geoCache = {};

function _m(color, roughness, metalness) {
    const key = `${color}|${roughness === undefined ? 0.75 : roughness}|${metalness === undefined ? 0.05 : metalness}`;
    if (!_matCache[key]) {
        _matCache[key] = new THREE.MeshStandardMaterial({
            color,
            roughness: roughness === undefined ? 0.75 : roughness,
            metalness: metalness === undefined ? 0.05 : metalness
        });
    }
    return _matCache[key];
}

// 半透明玻璃
function _glass() {
    if (!_matCache.glass) {
        _matCache.glass = new THREE.MeshStandardMaterial({
            color: 0x9FD3F0, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.5
        });
    }
    return _matCache.glass;
}

// 自发光（灯罩 / 招牌 / 灯箱）
function _glow(color, intensity) {
    const key = `glow|${color}|${intensity}`;
    if (!_matCache[key]) {
        _matCache[key] = new THREE.MeshStandardMaterial({
            color, emissive: color, emissiveIntensity: intensity === undefined ? 0.85 : intensity, roughness: 0.35
        });
    }
    return _matCache[key];
}

/**
 * 楼体立面材质：Canvas 生成 2x2 窗格并平铺
 * repX / repY 控制横向窗列数与纵向楼层密度
 */
function _facade(baseColor, winColor, repX, repY) {
    const key = `facade|${baseColor}|${winColor}|${repX}|${repY}`;
    if (_matCache[key]) return _matCache[key];

    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const ctx = cv.getContext('2d');
    const hex = c => '#' + c.toString(16).padStart(6, '0');
    ctx.fillStyle = hex(baseColor);
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = hex(winColor);
    [[8, 8], [38, 8], [8, 36], [38, 36]].forEach(([x, y]) => ctx.fillRect(x, y, 18, 20));

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repX, repY);

    _matCache[key] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.25 });
    return _matCache[key];
}

function _g(key, make) {
    if (!_geoCache[key]) _geoCache[key] = make();
    return _geoCache[key];
}
function _boxGeo(w, h, d) { return _g(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)); }
function _cylGeo(rt, rb, h, seg) { return _g(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)); }
function _coneGeo(r, h, seg) { return _g(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)); }
function _sphGeo(r, w, h) { return _g(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)); }
function _torGeo(r, t, rs, ts, arc) { return _g(`t${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc)); }
function _circleGeo(r, seg) { return _g(`ci${r},${seg}`, () => new THREE.CircleGeometry(r, seg)); }

// 添加一个带阴影的网格到 group
function _add(group, geo, mat, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x || 0, y || 0, z || 0);
    if (rx) mesh.rotation.x = rx;
    if (ry) mesh.rotation.y = ry;
    if (rz) mesh.rotation.z = rz;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
}

// ============ 物品建模 ============

const ITEM_BUILDERS = {

    // ---------- 家具 ----------

    table(group) {
        const wood = _m(0x9A6B3F, 0.75);
        const metal = _m(0x8A94A3, 0.35, 0.7);
        _add(group, _boxGeo(1.5, 0.1, 0.9), wood, 0, 0.72, 0);
        [[-0.62, -0.35], [0.62, -0.35], [-0.62, 0.35], [0.62, 0.35]].forEach(([x, z]) =>
            _add(group, _cylGeo(0.045, 0.045, 0.72, 8), metal, x, 0.36, z));
        group.userData.itemHeight = 0.77;
    },

    chair_office(group) {
        const fabric = _m(0x4B5563, 0.9);
        const metal = _m(0x8A94A3, 0.35, 0.7);
        _add(group, _boxGeo(0.78, 0.12, 0.78), fabric, 0, 0.62, 0);
        const back = _add(group, _boxGeo(0.74, 0.8, 0.1), fabric, 0, 1.02, -0.36);
        back.rotation.x = -0.12;
        _add(group, _cylGeo(0.05, 0.05, 0.44, 8), metal, 0, 0.36, 0);
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const arm = _add(group, _boxGeo(0.42, 0.05, 0.07), metal,
                Math.cos(a) * 0.21, 0.12, Math.sin(a) * 0.21);
            arm.rotation.y = -a;
            _add(group, _sphGeo(0.06, 8, 6), _m(0x2B3444, 0.7), Math.cos(a) * 0.42, 0.07, Math.sin(a) * 0.42);
        }
        group.userData.itemHeight = 1.42;
    },

    desk_lamp(group) {
        const dark = _m(0x2B3444, 0.5, 0.3);
        _add(group, _cylGeo(0.26, 0.3, 0.06, 16), dark, 0, 0.03, 0);
        _add(group, _cylGeo(0.03, 0.03, 0.72, 8), dark, 0, 0.4, 0);
        _add(group, _sphGeo(0.09, 10, 8), _glow(0xFFF3C4, 1.0), 0, 0.78, 0);
        _add(group, _cylGeo(0.09, 0.3, 0.32, 16), _glow(0xFAC775), 0, 0.9, 0);
        group.userData.itemHeight = 1.06;
    },

    floor_lamp(group) {
        const dark = _m(0x2B3444, 0.5, 0.3);
        _add(group, _cylGeo(0.32, 0.36, 0.08, 16), dark, 0, 0.04, 0);
        _add(group, _cylGeo(0.035, 0.035, 1.6, 8), dark, 0, 0.84, 0);
        _add(group, _cylGeo(0.2, 0.2, 0.04, 18), _glow(0xFFF7DC, 0.9), 0, 1.66, 0);
        _add(group, _cylGeo(0.22, 0.44, 0.44, 18), _glow(0xF5D78E), 0, 1.86, 0);
        group.userData.itemHeight = 2.08;
    },

    sofa(group) {
        const body = _m(0x6D7F95, 0.9);
        const cushion = _m(0x8A9BAE, 0.9);
        _add(group, _boxGeo(1.9, 0.4, 0.9), body, 0, 0.3, 0);
        _add(group, _boxGeo(1.9, 0.55, 0.22), body, 0, 0.75, -0.34);
        _add(group, _boxGeo(0.22, 0.42, 0.9), body, -0.84, 0.62, 0);
        _add(group, _boxGeo(0.22, 0.42, 0.9), body, 0.84, 0.62, 0);
        _add(group, _boxGeo(0.82, 0.14, 0.78), cushion, -0.44, 0.57, 0.02);
        _add(group, _boxGeo(0.82, 0.14, 0.78), cushion, 0.44, 0.57, 0.02);
        group.userData.itemHeight = 1.03;
    },

    bookshelf(group) {
        const wood = _m(0x5B3A21, 0.8);
        const back = _m(0x4A2F1C, 0.9);
        const bookColors = [0xD9534F, 0x4E9A5F, 0x3E7BB8, 0xE0B24A, 0x8A6BB8, 0xD97C3F];
        _add(group, _boxGeo(1.4, 1.9, 0.04), back, 0, 0.95, -0.23);
        _add(group, _boxGeo(0.08, 1.9, 0.5), wood, -0.66, 0.95, 0);
        _add(group, _boxGeo(0.08, 1.9, 0.5), wood, 0.66, 0.95, 0);

        const shelfY = [0.3, 0.8, 1.3, 1.8];
        shelfY.forEach(y => _add(group, _boxGeo(1.4, 0.06, 0.5), wood, 0, y, 0));
        shelfY.slice(0, 3).forEach((y, row) => {
            let x = -0.58;
            let k = row * 4;
            while (x < 0.5) {
                const w = 0.07 + (k % 3) * 0.03;
                _add(group, _boxGeo(w, 0.32, 0.34), _m(bookColors[k % bookColors.length], 0.85),
                    x + w / 2, y + 0.19, 0.02);
                x += w + 0.03;
                k++;
            }
        });
        group.userData.itemHeight = 1.9;
    },

    bed(group) {
        const frame = _m(0x5B3A21, 0.8);
        const sheet = _m(0xE4EAF2, 0.9);
        const pillow = _m(0xF7FAFC, 0.95);
        const blanket = _m(0x4E6E9A, 0.9);
        _add(group, _boxGeo(1.5, 0.3, 2.0), frame, 0, 0.15, 0);
        _add(group, _boxGeo(1.42, 0.22, 1.9), sheet, 0, 0.41, 0);
        _add(group, _boxGeo(1.5, 0.7, 0.12), frame, 0, 0.5, -1.0);
        _add(group, _boxGeo(0.56, 0.16, 0.34), pillow, -0.34, 0.6, -0.66);
        _add(group, _boxGeo(0.56, 0.16, 0.34), pillow, 0.34, 0.6, -0.66);
        _add(group, _boxGeo(1.42, 0.1, 1.0), blanket, 0, 0.57, 0.4);
        group.userData.itemHeight = 0.85;
    },

    plant_pot(group) {
        const pot = _m(0xB4685A, 0.9);
        const soil = _m(0x3B2A1C, 0.95);
        const leaf = _m(0x4E9A5F, 0.7);
        _add(group, _cylGeo(0.3, 0.22, 0.42, 14), pot, 0, 0.21, 0);
        _add(group, _cylGeo(0.27, 0.27, 0.06, 14), soil, 0, 0.42, 0);
        _add(group, _sphGeo(0.3, 10, 8), leaf, 0, 0.68, 0);
        _add(group, _sphGeo(0.22, 10, 8), leaf, 0.22, 0.85, 0.1);
        _add(group, _sphGeo(0.2, 10, 8), leaf, -0.2, 0.88, -0.12);
        group.userData.itemHeight = 1.08;
    },

    // ---------- 基础地形 ----------

    lawn(group) {
        const grass = _m(0x4E9A5F, 0.95);
        const stripe = _m(0x3E7D4C, 0.95);
        _add(group, _boxGeo(tileSize * 0.98, 0.06, tileSize * 0.98), grass, 0, 0.03, 0);
        // 修剪条纹，让平面有草地质感
        _add(group, _boxGeo(tileSize * 0.9, 0.02, tileSize * 0.4), stripe, 0, 0.065, -tileSize * 0.25);
        _add(group, _boxGeo(tileSize * 0.9, 0.02, tileSize * 0.4), stripe, 0, 0.065, tileSize * 0.25);
        group.userData.itemHeight = 0.08;
    },

    // ---------- 建筑 ----------

    house(group) {
        const wall = _m(0xE8E2D8, 0.85);
        const roof = _m(0xA9503F, 0.8);
        const glass = _glass();
        _add(group, _boxGeo(1.6, 1.5, 1.6), wall, 0, 0.75, 0);
        const r = _add(group, _coneGeo(1.45, 0.95, 4), roof, 0, 1.97, 0);
        r.rotation.y = Math.PI / 4;
        _add(group, _boxGeo(0.5, 0.85, 0.06), _m(0x5B3A21, 0.8), 0, 0.43, 0.82);
        _add(group, _boxGeo(0.42, 0.42, 0.06), glass, -0.5, 1.05, 0.82);
        _add(group, _boxGeo(0.42, 0.42, 0.06), glass, 0.5, 1.05, 0.82);
        _add(group, _boxGeo(0.06, 0.42, 0.42), glass, -0.82, 1.05, 0);
        _add(group, _boxGeo(0.06, 0.42, 0.42), glass, 0.82, 1.05, 0);
        _add(group, _boxGeo(0.24, 0.62, 0.24), _m(0xD3CBBC, 0.85), 0.45, 2.05, -0.42);
        group.userData.itemHeight = 2.45;
    },

    townhouse(group) {
        const wall = _m(0xD3CBBC, 0.85);
        const roof = _m(0x7C4A3A, 0.8);
        const glass = _glass();
        for (let i = -1; i <= 1; i++) {
            const x = i * 1.15;
            _add(group, _boxGeo(1.1, 1.35, 1.35), wall, x, 0.675, 0);
            const r = _add(group, _coneGeo(1.0, 0.7, 4), roof, x, 1.7, 0);
            r.rotation.y = Math.PI / 4;
            _add(group, _boxGeo(0.4, 0.7, 0.06), _m(0x5B3A21, 0.8), x, 0.35, 0.7);
            _add(group, _boxGeo(0.34, 0.34, 0.06), glass, x, 1.05, 0.7);
        }
        group.userData.itemHeight = 2.05;
    },

    apartment(group) {
        const facade = _facade(0xC9D2DC, 0x5C7A99, 2, 7);
        const line = _m(0x9AA7B4, 0.8);
        const cap = _m(0xB9BFC8, 0.9);
        _add(group, _boxGeo(1.8, 7.0, 1.8), facade, 0, 3.5, 0);
        for (let i = 1; i <= 6; i++) _add(group, _boxGeo(1.88, 0.08, 1.88), line, 0, i, 0);
        _add(group, _boxGeo(1.9, 0.14, 1.9), cap, 0, 7.07, 0);
        _add(group, _boxGeo(1.2, 0.5, 1.2), cap, 0, 7.35, 0);
        group.userData.itemHeight = 7.6;
    },

    villa(group) {
        const wall = _m(0xF0E6D2, 0.85);
        const slab = _m(0xB9BFC8, 0.9);
        const glass = _glass();
        _add(group, _boxGeo(1.8, 1.5, 1.5), wall, 0, 0.75, 0);
        _add(group, _boxGeo(1.9, 0.12, 1.6), slab, 0, 1.56, 0);
        _add(group, _boxGeo(1.0, 1.1, 1.0), wall, -0.35, 2.17, 0.1);
        _add(group, _boxGeo(1.2, 0.1, 1.2), slab, -0.35, 2.77, 0.1);
        _add(group, _boxGeo(0.5, 0.8, 0.05), _m(0x5B3A21, 0.8), 0.45, 0.4, 0.76);
        _add(group, _boxGeo(0.5, 0.5, 0.05), glass, -0.5, 0.95, 0.76);
        _add(group, _boxGeo(0.45, 0.45, 0.05), glass, -0.35, 2.25, 0.61);
        group.userData.itemHeight = 2.82;
    },

    shop(group) {
        const wall = _m(0xD3CBBC, 0.85);
        const awning = _m(0x2F8F7F, 0.8);
        const metal = _m(0x8A94A3, 0.35, 0.7);
        _add(group, _boxGeo(2.0, 1.5, 1.5), wall, 0, 0.75, 0);
        _add(group, _boxGeo(1.2, 1.0, 0.06), _glass(), 0, 0.55, 0.76);
        _add(group, _boxGeo(2.2, 0.12, 0.7), awning, 0, 1.56, 0.85);
        _add(group, _boxGeo(2.0, 0.42, 0.12), _glow(0x5EEAD4), 0, 1.83, 0.8);
        _add(group, _cylGeo(0.05, 0.05, 1.5, 8), metal, -0.9, 0.75, 1.12);
        _add(group, _cylGeo(0.05, 0.05, 1.5, 8), metal, 0.9, 0.75, 1.12);
        group.userData.itemHeight = 2.05;
    },

    mall(group) {
        const facade = _facade(0xD8DEE6, 0x7FA8C8, 2, 3);
        const slab = _m(0xB9BFC8, 0.9);
        const metal = _m(0x8A94A3, 0.35, 0.7);
        _add(group, _boxGeo(1.9, 3.4, 1.9), facade, 0, 1.7, 0);
        _add(group, _boxGeo(2.0, 0.22, 2.0), slab, 0, 3.51, 0);
        _add(group, _boxGeo(0.8, 0.45, 0.8), slab, 0.3, 3.85, -0.3);
        // 底层橱窗与入口
        _add(group, _boxGeo(1.6, 1.1, 0.06), _glass(), 0, 0.6, 0.96);
        _add(group, _boxGeo(2.0, 0.12, 0.6), _m(0x3E7BB8, 0.7), 0, 1.35, 1.15);
        _add(group, _boxGeo(1.6, 0.5, 0.12), _glow(0xFBBF24, 0.7), 0, 1.75, 1.0);
        _add(group, _cylGeo(0.06, 0.06, 1.3, 8), metal, -0.85, 0.65, 1.3);
        _add(group, _cylGeo(0.06, 0.06, 1.3, 8), metal, 0.85, 0.65, 1.3);
        group.userData.itemHeight = 4.08;
    },

    office(group) {
        const facade = _facade(0x8FB8D8, 0x3E6E96, 2, 12);
        const cap = _m(0x6E7C8C, 0.6);
        _add(group, _boxGeo(1.8, 12.0, 1.8), facade, 0, 6.0, 0);
        _add(group, _boxGeo(1.9, 0.16, 1.9), cap, 0, 12.08, 0);
        _add(group, _boxGeo(1.0, 0.7, 1.0), _m(0x8A94A3, 0.5, 0.4), 0, 12.5, 0);
        _add(group, _cylGeo(0.05, 0.05, 1.4, 6), _m(0x8A94A3, 0.35, 0.7), 0, 13.5, 0);
        group.userData.itemHeight = 14.2;
    },

    factory(group) {
        const wall = _m(0xB9BFC8, 0.9);
        const roof = _m(0x7C8798, 0.85);
        const stack = _m(0xB0A79A, 0.9);
        _add(group, _boxGeo(2.4, 1.5, 1.6), wall, 0, 0.75, 0);
        const r1 = _add(group, _boxGeo(1.45, 0.1, 1.7), roof, -0.58, 1.83, 0);
        r1.rotation.z = 0.42;
        const r2 = _add(group, _boxGeo(1.45, 0.1, 1.7), roof, 0.58, 1.83, 0);
        r2.rotation.z = -0.42;
        _add(group, _boxGeo(0.9, 1.1, 0.06), _m(0x4B5563, 0.7), 0, 0.55, 0.82);
        _add(group, _cylGeo(0.16, 0.2, 1.5, 12), stack, 1.0, 2.0, -0.5);
        group.userData.itemHeight = 2.78;
    },

    // ---------- 地标 ----------

    tower_tv(group) {
        const shaft = _m(0xC3CDD8, 0.5, 0.35);
        const base = _m(0x9AA7B4, 0.85);
        const metal = _m(0x8A94A3, 0.35, 0.7);
        _add(group, _cylGeo(0.9, 1.25, 0.5, 18), base, 0, 0.25, 0);
        _add(group, _cylGeo(0.34, 0.82, 5.0, 16), shaft, 0, 3.0, 0);
        _add(group, _cylGeo(0.42, 0.42, 0.12, 18), _m(0xD9E2EC, 0.5, 0.4), 0, 5.62, 0);
        _add(group, _sphGeo(0.72, 18, 14), _glass(), 0, 6.1, 0);
        _add(group, _cylGeo(0.16, 0.28, 3.0, 12), shaft, 0, 8.1, 0);
        _add(group, _cylGeo(0.05, 0.05, 2.4, 6), metal, 0, 10.8, 0);
        _add(group, _sphGeo(0.11, 8, 8), _glow(0xEF4444, 1.2), 0, 12.0, 0);
        group.userData.itemHeight = 12.1;
    },

    tower_canton(group) {
        const profile = [1.15, 0.86, 0.62, 0.46, 0.36, 0.30, 0.28, 0.30, 0.36, 0.45, 0.58, 0.74, 0.88, 0.96];
        const H = 11.0;
        const pts = profile.map((r, i) => new THREE.Vector2(r, (i / (profile.length - 1)) * H));
        const geo = new THREE.LatheGeometry(pts, 20);

        const body = new THREE.Mesh(geo, _m(0xB9C9D6, 0.35, 0.6));
        body.castShadow = true;
        group.add(body);

        if (!_matCache.cantonLattice) {
            _matCache.cantonLattice = new THREE.MeshBasicMaterial({
                color: 0xEAF2F8, wireframe: true, transparent: true, opacity: 0.26
            });
        }
        group.add(new THREE.Mesh(geo, _matCache.cantonLattice));

        _add(group, _cylGeo(0.9, 1.2, 0.35, 18), _m(0x9AA7B4, 0.85), 0, 0.175, 0);
        _add(group, _cylGeo(0.04, 0.04, 2.6, 6), _m(0x8A94A3, 0.35, 0.7), 0, 12.3, 0);
        group.userData.itemHeight = 13.6;
    },

    stadium(group) {
        const base = _m(0x9AA7B4, 0.85);
        const shell = _m(0xBFCBD6, 0.45, 0.4);
        _add(group, _cylGeo(1.7, 1.85, 0.45, 28), base, 0, 0.225, 0).scale.set(1.25, 1, 1);
        _add(group, _cylGeo(1.45, 1.45, 0.06, 28), _m(0x3E8F53, 0.9), 0, 0.48, 0).scale.set(1.25, 1, 1);
        for (let i = 0; i < 3; i++) {
            const ring = _add(group, _torGeo(1.5 + i * 0.06, 0.07, 6, 30), shell, 0, 0.78 + i * 0.26, 0);
            ring.rotation.x = Math.PI / 2;
            ring.scale.set(1.25, 0.78, 1);
        }
        group.userData.itemHeight = 1.4;
    },

    ferris(group) {
        const frame = _m(0xD9E2EC, 0.4, 0.5);
        const hub = _m(0x8A94A3, 0.35, 0.7);
        const cabin = _m(0xE0B24A, 0.6, 0.3);
        [-1, 1].forEach(sx => {
            const leg = _add(group, _boxGeo(0.12, 2.9, 0.12), frame, sx * 0.62, 1.45, 0);
            leg.rotation.z = -sx * 0.24;
        });
        _add(group, _cylGeo(0.16, 0.16, 0.3, 12), hub, 0, 2.8, 0);
        _add(group, _torGeo(1.5, 0.08, 8, 36), frame, 0, 2.8, 0);
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const x = Math.cos(a) * 1.5;
            const y = Math.sin(a) * 1.5;
            const spoke = _add(group, _boxGeo(0.05, 1.5, 0.05), frame, x / 2, 2.8 + y / 2, 0);
            spoke.rotation.z = a - Math.PI / 2;
            _add(group, _boxGeo(0.26, 0.24, 0.24), cabin, x, 2.8 + y - 0.22, 0);
        }
        group.userData.itemHeight = 4.4;
    },

    arch(group) {
        const stone = _m(0xCFC9BE, 0.9);
        _add(group, _boxGeo(0.55, 1.7, 0.7), stone, -1.3, 0.85, 0);
        _add(group, _boxGeo(0.55, 1.7, 0.7), stone, 1.3, 0.85, 0);
        _add(group, _boxGeo(0.8, 0.22, 0.85), stone, -1.3, 1.8, 0);
        _add(group, _boxGeo(0.8, 0.22, 0.85), stone, 1.3, 1.8, 0);
        _add(group, _torGeo(1.3, 0.28, 8, 26, Math.PI), stone, 0, 1.7, 0);
        _add(group, _boxGeo(0.7, 0.22, 0.85), stone, 0, 3.32, 0);
        group.userData.itemHeight = 3.45;
    },

    pyramid(group) {
        const stone = _m(0xD9C08A, 0.95);
        const step = _m(0xC7AE79, 0.95);
        _add(group, _boxGeo(2.6, 0.16, 2.6), step, 0, 0.08, 0);
        const p = _add(group, _coneGeo(1.75, 2.0, 4), stone, 0, 1.16, 0);
        p.rotation.y = Math.PI / 4;
        group.userData.itemHeight = 2.16;
    },

    clock_tower(group) {
        const wall = _m(0xC9B79A, 0.85);
        const face = _m(0xF7FAFC, 0.6);
        const roof = _m(0x7C4A3A, 0.8);
        const dark = _m(0x2B3444, 0.6, 0.2);
        _add(group, _boxGeo(1.0, 5.4, 1.0), wall, 0, 2.7, 0);
        _add(group, _boxGeo(1.16, 0.22, 1.16), _m(0xB0A08A, 0.85), 0, 5.51, 0);
        [[0, 0.52, 0], [0, -0.52, Math.PI], [0.52, 0, Math.PI / 2], [-0.52, 0, -Math.PI / 2]]
            .forEach(([x, z, ry]) => {
                _add(group, _circleGeo(0.3, 16), face, x, 4.55, z, 0, ry, 0);
                _add(group, _boxGeo(0.05, 0.22, 0.02), dark,
                    x + Math.sin(ry) * 0.02, 4.6, z + Math.cos(ry) * 0.02, 0, ry, 0);
            });
        const spire = _add(group, _coneGeo(0.78, 1.3, 4), roof, 0, 6.27, 0);
        spire.rotation.y = Math.PI / 4;
        _add(group, _sphGeo(0.1, 8, 8), _m(0x8A94A3, 0.35, 0.7), 0, 7.0, 0);
        group.userData.itemHeight = 7.1;
    },

    lighthouse(group) {
        const white = _m(0xF2F5F8, 0.85);
        const red = _m(0xD9534F, 0.85);
        const dark = _m(0x2B3444, 0.5, 0.3);
        for (let i = 0; i < 5; i++) {
            const rTop = 0.5 - i * 0.05;
            const rBot = 0.55 - i * 0.05;
            _add(group, _cylGeo(rTop, rBot, 0.9, 16), i % 2 === 0 ? white : red, 0, 0.45 + i * 0.9, 0);
        }
        _add(group, _cylGeo(0.32, 0.32, 0.08, 16), dark, 0, 4.54, 0);
        _add(group, _cylGeo(0.28, 0.28, 0.5, 16), _glow(0xFFF3C4, 1.0), 0, 4.83, 0);
        _add(group, _coneGeo(0.4, 0.5, 16), dark, 0, 5.33, 0);
        _add(group, _sphGeo(0.08, 8, 8), _m(0x8A94A3, 0.35, 0.7), 0, 5.62, 0);
        group.userData.itemHeight = 5.7;
    },

    // ---------- 城市配套 ----------

    street_lamp(group) {
        const metal = _m(0x4B5563, 0.4, 0.6);
        _add(group, _cylGeo(0.16, 0.2, 0.24, 12), _m(0x374151, 0.6), 0, 0.12, 0);
        _add(group, _cylGeo(0.06, 0.08, 4.2, 10), metal, 0, 2.34, 0);
        const arm = _add(group, _boxGeo(0.9, 0.09, 0.09), metal, 0.42, 4.5, 0);
        arm.rotation.z = 0.18;
        _add(group, _boxGeo(0.5, 0.12, 0.24), _glow(0xFDE68A), 0.86, 4.44, 0);
        group.userData.itemHeight = 4.6;
    },

    bench(group) {
        const wood = _m(0xB07A4A, 0.85);
        const metal = _m(0x4B5563, 0.5, 0.6);
        _add(group, _boxGeo(1.8, 0.1, 0.5), wood, 0, 0.45, 0);
        const back = _add(group, _boxGeo(1.8, 0.42, 0.08), wood, 0, 0.75, -0.23);
        back.rotation.x = 0.14;
        _add(group, _boxGeo(0.08, 0.45, 0.46), metal, -0.74, 0.225, 0);
        _add(group, _boxGeo(0.08, 0.45, 0.46), metal, 0.74, 0.225, 0);
        group.userData.itemHeight = 0.98;
    },

    trash_bin(group) {
        const body = _m(0x4B5563, 0.7, 0.2);
        const lid = _m(0x374151, 0.6, 0.3);
        _add(group, _cylGeo(0.26, 0.22, 0.72, 14), body, 0, 0.36, 0);
        _add(group, _cylGeo(0.3, 0.3, 0.1, 14), lid, 0, 0.77, 0);
        _add(group, _boxGeo(0.3, 0.12, 0.18), lid, 0, 0.86, 0);
        group.userData.itemHeight = 0.92;
    },

    bus_stop(group) {
        const metal = _m(0x6B7280, 0.4, 0.6);
        _add(group, _boxGeo(2.4, 0.1, 1.0), _m(0x2F8F7F, 0.7), 0, 2.5, 0);
        _add(group, _cylGeo(0.06, 0.06, 2.5, 8), metal, -1.1, 1.25, 0.4);
        _add(group, _cylGeo(0.06, 0.06, 2.5, 8), metal, 1.1, 1.25, 0.4);
        _add(group, _boxGeo(2.2, 1.6, 0.06), _glass(), 0, 1.35, -0.4);
        _add(group, _boxGeo(1.6, 0.08, 0.36), _m(0xB07A4A, 0.85), 0, 0.5, -0.28);
        group.userData.itemHeight = 2.55;
    },

    billboard(group) {
        const metal = _m(0x4B5563, 0.5, 0.6);
        _add(group, _boxGeo(0.18, 2.6, 0.18), metal, -0.8, 1.3, 0);
        _add(group, _boxGeo(0.18, 2.6, 0.18), metal, 0.8, 1.3, 0);
        _add(group, _boxGeo(2.6, 1.5, 0.14), _m(0x1F2937, 0.6), 0, 3.35, 0);
        _add(group, _boxGeo(2.4, 1.3, 0.08), _glow(0x38BDF8, 0.7), 0, 3.35, 0.1);
        group.userData.itemHeight = 4.1;
    },

    fence(group) {
        const metal = _m(0xB9C2CC, 0.5, 0.6);
        _add(group, _boxGeo(2.0, 0.07, 0.07), metal, 0, 0.5, 0);
        _add(group, _boxGeo(2.0, 0.07, 0.07), metal, 0, 0.95, 0);
        [-1.0, 0, 1.0].forEach(x => {
            _add(group, _boxGeo(0.09, 1.15, 0.09), metal, x, 0.575, 0);
            const tip = _add(group, _coneGeo(0.09, 0.18, 4), metal, x, 1.24, 0);
            tip.rotation.y = Math.PI / 4;
        });
        group.userData.itemHeight = 1.33;
    },

    fountain(group) {
        const stone = _m(0xCFC9BE, 0.9);
        const water = _water();
        _add(group, _cylGeo(1.3, 1.4, 0.4, 22), stone, 0, 0.2, 0);
        _add(group, _cylGeo(1.15, 1.15, 0.06, 22), water, 0, 0.42, 0);
        _add(group, _cylGeo(0.22, 0.3, 0.7, 14), stone, 0, 0.75, 0);
        _add(group, _cylGeo(0.62, 0.62, 0.1, 18), stone, 0, 1.15, 0);
        _add(group, _cylGeo(0.42, 0.42, 0.05, 18), water, 0, 1.22, 0);
        _add(group, _cylGeo(0.05, 0.05, 0.5, 8), water, 0, 1.45, 0);
        _add(group, _sphGeo(0.12, 10, 8), water, 0, 1.72, 0);
        group.userData.itemHeight = 1.85;
    },

    flowerbed(group) {
        const stone = _m(0xCFC9BE, 0.9);
        const leaf = _m(0x4E9A5F, 0.8);
        const colors = [0xEF93B1, 0xFAC775, 0xE24B4A, 0xD4537E, 0xF0997B];
        _add(group, _boxGeo(1.8, 0.4, 1.2), stone, 0, 0.2, 0);
        _add(group, _boxGeo(1.62, 0.06, 1.02), _m(0x3B2A1C, 0.95), 0, 0.4, 0);
        _add(group, _sphGeo(0.26, 10, 8), leaf, 0, 0.5, 0);
        for (let i = 0; i < 8; i++) {
            const x = -0.62 + (i % 4) * 0.41;
            const z = -0.28 + Math.floor(i / 4) * 0.56;
            _add(group, _sphGeo(0.13, 8, 6), _m(colors[i % colors.length], 0.75), x, 0.6, z);
        }
        group.userData.itemHeight = 0.75;
    },

    // ---------- 人物 / 载具 ----------

    person(group) {
        const cloth = _m(0x4E7BB8, 0.85);
        const pants = _m(0x2B3444, 0.85);
        const skin = _m(0xE8C4A0, 0.8);
        const hair = _m(0x2A2118, 0.9);
        _add(group, _boxGeo(0.13, 0.72, 0.14), pants, -0.11, 0.36, 0);
        _add(group, _boxGeo(0.13, 0.72, 0.14), pants, 0.11, 0.36, 0);
        _add(group, _boxGeo(0.42, 0.56, 0.24), cloth, 0, 1.0, 0);
        _add(group, _boxGeo(0.1, 0.5, 0.1), cloth, -0.26, 1.0, 0);
        _add(group, _boxGeo(0.1, 0.5, 0.1), cloth, 0.26, 1.0, 0);
        _add(group, _sphGeo(0.15, 12, 10), skin, 0, 1.42, 0);
        const h = _add(group, _sphGeo(0.16, 12, 10), hair, 0, 1.46, -0.02);
        h.scale.set(1, 0.75, 1);
        group.userData.itemHeight = 1.6;
    },

    // 手提袋：袋身 + 袋口折边 + 双提手 + 正面品牌面板
    // 造型要点：袋身用一整块盒子（分两段会出现「盒子上叠盒子」的错觉），
    //           提手用半圆环（TorusGeometry arc=π），尺寸要够大才认得出是袋子
    bag(group) {
        const paper = _m(0xEDE4D4, 0.88, 0.02);   // 米白纸感
        const fold = _m(0xD6C8AF, 0.92, 0.02);    // 折边 / 压痕
        const gold = _m(0xC9A15A, 0.28, 0.85);    // 提手与烫金
        const label = _m(0x2B2620, 0.5, 0.15);    // 品牌面板

        _add(group, _boxGeo(1.18, 1.42, 0.52), paper, 0, 0.71, 0);    // 袋身
        _add(group, _boxGeo(1.24, 0.08, 0.58), fold, 0, 1.44, 0);     // 袋口折边
        _add(group, _boxGeo(1.22, 0.04, 0.56), fold, 0, 0.02, 0);     // 底部压痕

        _add(group, _boxGeo(0.66, 0.46, 0.02), label, 0, 0.86, 0.27); // 品牌面板
        _add(group, _boxGeo(0.34, 0.05, 0.02), gold, 0, 0.86, 0.285); // 烫金横条

        [-0.32, 0.32].forEach(x => {
            _add(group, _torGeo(0.26, 0.035, 8, 20, Math.PI), gold, x, 1.44, 0);
        });

        group.userData.itemHeight = 1.75;
    },

    bus(group) {
        const body = _m(0xF0B429, 0.55, 0.25);
        const dark = _m(0x1F2937, 0.4, 0.3);
        const glass = _glass();
        _add(group, _boxGeo(2.4, 1.5, 1.0), body, 0, 1.0, 0);
        _add(group, _boxGeo(2.1, 0.5, 0.06), glass, 0, 1.25, 0.51);
        _add(group, _boxGeo(2.1, 0.5, 0.06), glass, 0, 1.25, -0.51);
        _add(group, _boxGeo(0.06, 0.55, 0.86), glass, 1.21, 1.25, 0);
        _add(group, _boxGeo(0.06, 0.4, 0.86), glass, -1.21, 1.3, 0);
        _add(group, _boxGeo(0.05, 1.0, 0.42), dark, 0, 0.7, 0.51);
        _add(group, _boxGeo(0.9, 0.16, 0.6), _m(0xD8DEE6, 0.6), -0.2, 1.83, 0);
        const wheelGeo = _cylGeo(0.28, 0.28, 0.16, 14);
        [[0.75, 0.5], [0.75, -0.5], [-0.75, 0.5], [-0.75, -0.5]].forEach(([x, z]) => {
            _add(group, wheelGeo, dark, x, 0.28, z).rotation.x = Math.PI / 2;
        });
        group.userData.itemHeight = 1.91;
    },

    mower(group) {
        const body = _m(0xD9534F, 0.6, 0.2);
        const dark = _m(0x1F2937, 0.6);
        const metal = _m(0x8A94A3, 0.4, 0.6);
        _add(group, _boxGeo(0.72, 0.28, 0.52), body, 0, 0.42, 0);
        _add(group, _boxGeo(0.6, 0.34, 0.34), _m(0x2F8F7F, 0.7), 0, 0.5, -0.38);
        _add(group, _boxGeo(0.05, 0.8, 0.05), metal, -0.24, 0.82, -0.42).rotation.x = 0.42;
        _add(group, _boxGeo(0.05, 0.8, 0.05), metal, 0.24, 0.82, -0.42).rotation.x = 0.42;
        _add(group, _boxGeo(0.56, 0.05, 0.05), metal, 0, 1.18, -0.58);
        const wheelGeo = _cylGeo(0.12, 0.12, 0.1, 12);
        [[-0.32, 0.28], [0.32, 0.28], [-0.32, -0.3], [0.32, -0.3]].forEach(([x, z]) => {
            _add(group, wheelGeo, dark, x, 0.12, z).rotation.z = Math.PI / 2;
        });
        group.userData.itemHeight = 1.22;
    }
};

// 水体材质（喷泉共用）
function _water() {
    if (!_matCache.water) {
        _matCache.water = new THREE.MeshStandardMaterial({
            color: 0x7DD3FC, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.6
        });
    }
    return _matCache.water;
}
