/**
 * ai-mode.js — AI 模式：风格选择向导 + 本地生成器
 *
 * 设计前提：用户不知道该怎么描述。所以不问参数，只问「想拍什么 / 什么调子 / 多长」，
 * 用选择代替描述；选完立刻给出人话版分镜，并可一键出片（不依赖任何外部 AI）。
 *
 * 三层数据：
 *   1. 片子类型 AI_FILMS  —— 决定分镜骨架（每幕的景别、机位、走法）
 *   2. 调性     AI_TONES  —— 决定机位微调与配景选择
 *   3. 时长     AI_LENGTHS—— 决定节奏（speed）
 *
 * 用户填的那句话只用来命中关键词（AI_KEYWORDS），换主体与配景，不改分镜结构。
 * 同样的选择 + 同样的输入 → 同样的场景（确定性伪随机，可复现）。
 *
 * 必须在 api.js 之后加载（用到 apiBuild / apiManifest / apiDescribe / apiPromptText）。
 */

// ============ 工具 ============

// 确定性伪随机：同样的种子每次给出同样的序列
function aiRand(seed) {
    let h = 2166136261;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return function () {
        h += 0x6D2B79F5;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function aiClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function aiRound2(v) { return Math.round(v * 100) / 100; }
function aiGridSize() { return (typeof gridSize === 'number') ? gridSize : 40; }
function aiInGrid(gx, gz) { return gx >= 0 && gz >= 0 && gx < aiGridSize() && gz < aiGridSize(); }

function aiItemHeight(id) {
    try {
        const it = apiManifest().items.find(i => i.id === id);
        return (it && typeof it.height === 'number' && it.height > 0) ? it.height : 1;
    } catch (e) { return 1; }
}

// ============ 一、片子类型（分镜骨架） ============
// beats[].at    ：途经点相对场景中心的格偏移
// beats[].orbit ：绕中心一圈（r 半径 / count 点数）
// beats[].aim   ：'subject' 锁定主体；'ahead' 看路径前方（一镜到底用）

const AI_FILMS = [
    {
        id: 'product', label: '商品展示', icon: 'fa-box-open', brief: '把一件东西拍得好看',
        subject: 'cube',
        beats: [
            { name: '远景交代', mode: 'overview', h: 4, d: 6, look: 4, at: [-8, -8] },
            { name: '主体全景', mode: 'follow', h: 2.4, d: 4, look: 3, at: [-4.5, -4.5] },
            { name: '细节特写', mode: 'closeup', h: 1.4, d: 2, look: 1.2, at: [-2, -2], aim: 'subject' },
            { name: '环绕收尾', mode: 'follow', h: 2.2, d: 3, look: 3, orbit: { r: 4, count: 6 }, aim: 'subject' }
        ]
    },
    {
        id: 'tvc', label: '商品广告 / TVC', icon: 'fa-bullhorn', brief: '有节奏、有卖点',
        subject: 'cube',
        beats: [
            { name: '悬念近景', mode: 'closeup', h: 1.2, d: 1.6, look: 1.2, at: [-2.5, -2.5], aim: 'subject' },
            { name: '拉开全景', mode: 'follow', h: 3, d: 5, look: 4, at: [-6, -6], aim: 'subject' },
            { name: '环绕展示', mode: 'follow', h: 2.4, d: 3, look: 3, orbit: { r: 4, count: 5 }, aim: 'subject' },
            { name: '定格收尾', mode: 'follow', h: 2.4, d: 3.5, look: 3, at: [4.5, 4.5], aim: 'subject' }
        ]
    },
    {
        id: 'city', label: '城市宣传片', icon: 'fa-city', brief: '宏大、地标',
        subject: 'tower_canton',
        beats: [
            { name: '高空俯瞰', mode: 'overview', h: 6, d: 6, look: 6, at: [-9, -9] },
            { name: '贴地穿行', mode: 'follow', h: 1.8, d: 4, look: 5, at: [-5, -5] },
            { name: '地标仰视', mode: 'closeup', h: 1.4, d: 3, look: 1.2, at: [-2, -2], aim: 'subject' },
            { name: '回望全城', mode: 'overview', h: 5.5, d: 5, look: 6, at: [6.5, 6.5], aim: 'subject' }
        ]
    },
    {
        id: 'arch', label: '建筑漫游', icon: 'fa-building-columns', brief: '空间感、走进去',
        subject: 'villa',
        beats: [
            { name: '正面远景', mode: 'overview', h: 3.5, d: 6, look: 4, at: [-8.5, -8.5], aim: 'subject' },
            { name: '侧向推移', mode: 'follow', h: 2.6, d: 4.5, look: 4, at: [7.5, 0], aim: 'subject' },
            { name: '近景细节', mode: 'closeup', h: 1.6, d: 2.2, look: 1.2, at: [2.5, 2.5], aim: 'subject' },
            { name: '环绕收尾', mode: 'follow', h: 3, d: 3.5, look: 3, orbit: { r: 4.5, count: 6 }, aim: 'subject' }
        ]
    },
    {
        id: 'story', label: '生活叙事', icon: 'fa-person-walking', brief: '一个人做一件事',
        subject: 'person',
        beats: [
            { name: '远景交代', mode: 'overview', h: 4.5, d: 5, look: 5, at: [-9, -9] },
            { name: '跟拍出发', mode: 'follow', h: 2.2, d: 3, look: 4.5, at: [-5, -2.5], aim: 'subject' },
            { name: '中景动作', mode: 'follow', h: 2.2, d: 3, look: 4, at: [0, 4], aim: 'subject' },
            { name: '近景细节', mode: 'closeup', h: 1.6, d: 2.2, look: 1.2, at: [3, 6], aim: 'subject' },
            { name: '收尾全景', mode: 'overview', h: 5, d: 5, look: 6, at: [8, 8] }
        ]
    },
    {
        id: 'onershot', label: '一镜到底', icon: 'fa-video', brief: '镜头不切，一路走完',
        subject: 'tower_canton',
        beats: [
            { name: '起步', mode: 'follow', h: 2.2, d: 3, look: 5, at: [-10, -10], aim: 'ahead' },
            { name: '穿行', mode: 'follow', h: 2.6, d: 3, look: 5, at: [-6, -6], aim: 'ahead' },
            { name: '经过主体', mode: 'follow', h: 2.4, d: 3, look: 5, at: [-2.5, -2.5], aim: 'ahead' },
            { name: '继续前行', mode: 'follow', h: 3, d: 3, look: 5, at: [2, 2], aim: 'ahead' },
            { name: '缓缓升高', mode: 'follow', h: 5, d: 4, look: 6, at: [6, 6], aim: 'ahead' },
            { name: '收尾俯瞰', mode: 'overview', h: 7, d: 5, look: 7, at: [10, 10], aim: 'ahead' }
        ]
    },
    {
        id: 'brand', label: '品牌形象片', icon: 'fa-crown', brief: '氛围、留白、慢',
        subject: 'arch',
        beats: [
            { name: '留白开场', mode: 'overview', h: 6, d: 7, look: 7, at: [-10, -10] },
            { name: '缓慢靠近', mode: 'follow', h: 3, d: 6, look: 4, at: [-5, -5], aim: 'subject' },
            { name: '静默特写', mode: 'closeup', h: 1.5, d: 2.5, look: 1.2, at: [-2, -2], aim: 'subject' },
            { name: '拉远收尾', mode: 'overview', h: 5.5, d: 6, look: 7, at: [8.5, 8.5] }
        ]
    },
    {
        id: 'diorama', label: '微缩沙盘', icon: 'fa-cubes', brief: '俯视、可爱、一览无余',
        subject: 'townhouse',
        beats: [
            { name: '高空定格', mode: 'topdown', h: 14, d: 0.5, look: 2, at: [0, 0] },
            { name: '斜俯视', mode: 'overview', h: 6, d: 6, look: 6, at: [-6, -6] },
            { name: '贴近看', mode: 'closeup', h: 2, d: 3, look: 2, at: [-2.5, -2.5], aim: 'subject' },
            { name: '旋转收尾', mode: 'follow', h: 5, d: 4, look: 4, orbit: { r: 5, count: 6 }, aim: 'subject' }
        ]
    }
];

// ============ 二、调性（机位微调 + 配景 + 场景骨架） ============
// layout: plaza 草坪广场（生活 / 城市片）/ studio 影棚（产品片，暗调无草地）
// sky:    与 layout 配套的天空预设

const AI_TONES = [
    { id: 'premium', label: '高级质感', icon: 'fa-gem', hMul: 0.85, dMul: 1.20, layout: 'studio', sky: 'studio',
      scenery: ['pillar', 'arch', 'light', 'cube', 'fountain'] },
    { id: 'bright', label: '清爽明亮', icon: 'fa-sun', hMul: 1.10, dMul: 1.00, layout: 'plaza', sky: 'day',
      scenery: ['tree', 'flowerbed', 'bench', 'lawn', 'fountain'] },
    { id: 'warm', label: '温暖治愈', icon: 'fa-mug-hot', hMul: 0.95, dMul: 1.05, layout: 'plaza', sky: 'day',
      scenery: ['tree', 'bench', 'flowerbed', 'plant_pot', 'house'] },
    { id: 'living', label: '烟火生活', icon: 'fa-store', hMul: 0.90, dMul: 1.00, layout: 'plaza', sky: 'day',
      scenery: ['shop', 'bench', 'trash_bin', 'street_lamp', 'car'] },
    { id: 'future', label: '未来科技', icon: 'fa-microchip', hMul: 1.05, dMul: 1.15, layout: 'studio', sky: 'studio',
      scenery: ['light', 'office', 'pillar', 'cube', 'billboard'] },
    { id: 'retro', label: '复古胶片', icon: 'fa-film', hMul: 0.90, dMul: 1.15, layout: 'plaza', sky: 'dusk',
      scenery: ['clock_tower', 'arch', 'lighthouse', 'townhouse', 'street_lamp'] }
];

// ============ 三、时长与节奏 ============

const AI_LENGTHS = [
    { id: 's15', sec: 15, label: '15 秒 · 明快', pace: '明快', speed: 11 },
    { id: 's30', sec: 30, label: '30 秒 · 标准', pace: '标准', speed: 8 },
    { id: 's60', sec: 60, label: '60 秒 · 舒缓', pace: '舒缓', speed: 5 }
];

// ============ 四、关键词 → 主体与配景 ============

const AI_KEYWORDS = [
    { keys: ['手提袋', '纸袋', '购物袋', '袋子', '礼品袋', '包装盒', '礼盒'], subject: 'bag',
      items: ['bag', 'pillar', 'arch', 'cube', 'fountain'] },
    { keys: ['商品', '产品', '单品', '展示', '样机'], subject: 'bag',
      items: ['bag', 'pillar', 'arch', 'cube', 'light'] },
    { keys: ['院子', '庭院', '花园', '自家', '住宅', '一家人'], subject: 'house',
      items: ['house', 'lawn', 'fence', 'tree', 'flowerbed', 'bench', 'mower'] },
    { keys: ['割草', '修剪', '除草'], subject: 'mower',
      items: ['lawn', 'mower', 'house', 'fence', 'tree'] },
    { keys: ['咖啡', '奶茶', '饮品', '小店', '门面', '面包'], subject: 'shop',
      items: ['shop', 'table', 'chair', 'plant_pot', 'billboard', 'bench'] },
    { keys: ['商场', '购物', '买东西', '逛街'], subject: 'mall',
      items: ['mall', 'shop', 'billboard', 'bench', 'flowerbed', 'street_lamp'] },
    { keys: ['办公', '上班', '公司', '写字楼', '职场', '加班'], subject: 'office',
      items: ['office', 'table', 'chair_office', 'desk_lamp', 'plant_pot', 'bookshelf'] },
    { keys: ['公园', '广场', '绿地', '散步'], subject: 'fountain',
      items: ['fountain', 'bench', 'flowerbed', 'tree', 'street_lamp', 'trash_bin'] },
    { keys: ['城市', '都市', '夜景', '天际线', '高楼', '繁华'], subject: 'tower_canton',
      items: ['tower_canton', 'office', 'apartment', 'street_lamp', 'billboard', 'car'] },
    { keys: ['塔', '地标', '电视塔', '广州塔'], subject: 'tower_canton',
      items: ['tower_canton', 'flowerbed', 'street_lamp', 'bench', 'tree'] },
    { keys: ['马路', '街道', '街', '道路', '路口'], subject: 'car',
      items: ['road_straight', 'traffic_light', 'street_lamp', 'car', 'bus_stop', 'trash_bin'] },
    { keys: ['公交', '巴士', '车站', '通勤', '坐车'], subject: 'bus',
      items: ['bus', 'bus_stop', 'road_straight', 'traffic_light', 'street_lamp'] },
    { keys: ['汽车', '跑车', '驾驶', '开车'], subject: 'car',
      items: ['car', 'road_straight', 'traffic_light', 'street_lamp'] },
    { keys: ['客厅', '室内', '居家', '家里', '沙发'], subject: 'sofa',
      items: ['sofa', 'table', 'desk_lamp', 'floor_lamp', 'bookshelf', 'plant_pot'] },
    { keys: ['书桌', '工作台', '台灯', '学习'], subject: 'table',
      items: ['table', 'desk_lamp', 'chair_office', 'bookshelf', 'plant_pot'] },
    { keys: ['卧室', '睡觉', '休息', '床'], subject: 'bed',
      items: ['bed', 'floor_lamp', 'bookshelf', 'plant_pot', 'sofa'] },
    { keys: ['人', '人物', '走路', '家庭', '游客', '一家三口'], subject: 'person',
      items: ['person', 'bench', 'tree', 'flowerbed', 'street_lamp', 'house'] },
    { keys: ['体育', '球场', '比赛', '运动'], subject: 'stadium',
      items: ['stadium', 'bench', 'tree', 'fence', 'light'] },
    { keys: ['游乐', '摩天轮', '乐园'], subject: 'ferris',
      items: ['ferris', 'bench', 'flowerbed', 'tree', 'street_lamp'] },
    { keys: ['海边', '海', '灯塔', '码头'], subject: 'lighthouse',
      items: ['lighthouse', 'lawn', 'bench', 'tree', 'fence'] },
    { keys: ['沙漠', '金字塔', '古迹', '遗迹'], subject: 'pyramid',
      items: ['pyramid', 'arch', 'pillar', 'lawn'] },
    { keys: ['工厂', '工业', '制造', '车间'], subject: 'factory',
      items: ['factory', 'road_straight', 'car', 'pillar', 'trash_bin'] },
    { keys: ['别墅', '洋房', '楼盘', '样板间', '地产'], subject: 'villa',
      items: ['villa', 'lawn', 'fence', 'tree', 'flowerbed', 'car'] },
    { keys: ['公寓', '小区', '住宅楼'], subject: 'apartment',
      items: ['apartment', 'lawn', 'tree', 'bench', 'flowerbed', 'fence'] }
];

// 命中评分：匹配到的关键词总长度最大者胜出
function aiMatchKeyword(text) {
    const t = (text || '').trim();
    if (!t) return null;
    let best = null, bestScore = 0;
    AI_KEYWORDS.forEach(entry => {
        let score = 0;
        entry.keys.forEach(k => { if (t.indexOf(k) >= 0) score += k.length; });
        if (score > bestScore) { bestScore = score; best = entry; }
    });
    return best;
}

// ============ 五、人话描述 ============

function aiFind(list, id) { return list.find(x => x.id === id) || list[0]; }

function aiBriefText(ui) {
    const film = aiFind(AI_FILMS, ui.film);
    const tone = aiFind(AI_TONES, ui.tone);
    const len = aiFind(AI_LENGTHS, ui.length);
    const parts = [];
    parts.push(`一支 <b>${len.sec} 秒</b>的<b>${tone.label}${film.label}</b>，节奏${len.pace}。`);
    const sub = (ui.subject || '').trim();
    if (sub) parts.push(`画面里要有：<b>${sub}</b>。`);
    parts.push(`镜头走法：${film.beats.map(b => b.name).join(' → ')}。`);
    return parts.join('');
}

function aiBriefPlain(ui) {
    return aiBriefText(ui).replace(/<[^>]+>/g, '');
}

// ============ 六、生成场景 Spec ============

function aiComposeSpec(ui) {
    const film = aiFind(AI_FILMS, ui.film);
    const tone = aiFind(AI_TONES, ui.tone);
    const len = aiFind(AI_LENGTHS, ui.length);
    const rand = aiRand([ui.film, ui.tone, ui.length, (ui.subject || '').trim()].join('|'));

    const size = aiGridSize();
    const c = Math.floor(size / 2);

    const kw = aiMatchKeyword(ui.subject);
    const subjectId = (kw && kw.subject) ? kw.subject : film.subject;
    const pool = ((kw && kw.items && kw.items.length) ? kw.items : tone.scenery)
        .filter(id => id !== subjectId);
    if (!pool.length) pool.push('tree');

    const items = [];
    const occupied = new Set();
    const put = (id, gx, gz, rot) => {
        if (!aiInGrid(gx, gz)) return;
        const key = gx + ',' + gz;
        if (occupied.has(key)) return;
        occupied.add(key);
        items.push(rot ? { id, grid: [gx, gz], rot } : { id, grid: [gx, gz] });
    };

    // —— 场景骨架：影棚（产品片）走极简对称，广场（生活 / 城市片）走铺陈 ——
    const layout = tone.layout || 'plaza';
    // 影棚里没有铺开的街区，机位要按比例收近，否则主体在画面里只有指甲盖大
    const ls = layout === 'studio' ? 0.5 : 1;    // 水平尺度
    const hs = layout === 'studio' ? 0.7 : 1;    // 机位高度尺度

    if (layout === 'studio') {
        // 影棚：主体居中，一圈柱子 + 两圈拱门，不放草地，靠明暗对比出质感
        items.push({ id: subjectId, grid: [c, c] });
        items.push({ pattern: 'ring', id: 'pillar', center: [c, c], radius: 6, count: 10 });
        items.push({ pattern: 'ring', id: 'arch', center: [c, c], radius: 11, count: 8 });
        items.push({ pattern: 'ring', id: 'arch', center: [c, c], radius: 17, count: 12 });
        // 少量配景点缀在柱廊之间，避免只有柱子太单调
        const accent = pool.filter(id => id !== 'pillar' && id !== 'arch').slice(0, 3);
        accent.forEach((id, k) => {
            const a = (k / Math.max(1, accent.length)) * Math.PI * 2 + 0.4;
            put(id, Math.round(c + Math.cos(a) * 8.5), Math.round(c + Math.sin(a) * 8.5));
        });
    } else {
        // 1. 草坪广场：7×7 铺底，把中心区域填满
        for (let dx = -3; dx <= 3; dx++) {
            for (let dz = -3; dz <= 3; dz++) put('lawn', c + dx, c + dz);
        }

        // 2. 主体压在广场中心（草坪只有 0.02 高，视觉上等于站在地上）
        items.push({ id: subjectId, grid: [c, c] });

        // 3. 花坛环：贴着广场边，10 个，给画面一圈彩色
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 + rand() * 0.12;
            put('flowerbed', Math.round(c + Math.cos(a) * 4.5), Math.round(c + Math.sin(a) * 4.5));
        }

        // 4. 中环：半径 6~7.5，12 件配景
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 + rand() * 0.3;
            const r = 6 + rand() * 1.5;
            put(pool[i % pool.length],
                Math.round(c + Math.cos(a) * r),
                Math.round(c + Math.sin(a) * r),
                Math.round(rand() * 4) * 90);
        }

        // 5. 外环：半径 9~11.5，14 件配景，把远处也填上
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2 + 0.26 + rand() * 0.3;
            const r = 9 + rand() * 2.5;
            put(pool[(i + 3) % pool.length],
                Math.round(c + Math.cos(a) * r),
                Math.round(c + Math.sin(a) * r),
                Math.round(rand() * 4) * 90);
        }

        // 6. 外圈远景：半径 13~17，18 件「看得见」的高个子，撑住中景与远景
        const tall = ['tree', 'street_lamp', 'billboard', 'apartment', 'office', 'bus_stop', 'traffic_light', 'car']
            .filter(id => id !== subjectId);
        for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2 + 0.13 + rand() * 0.25;
            const r = 13 + rand() * 4;
            put(tall[i % tall.length],
                Math.round(c + Math.cos(a) * r),
                Math.round(c + Math.sin(a) * r),
                Math.round(rand() * 4) * 90);
        }

        // 7. 有马路就在广场南侧铺一条双车道
        const roadId = pool.find(id => id.indexOf('road_') === 0);
        if (roadId) {
            const rgz = aiClamp(c + 7, 0, size - 1);
            for (let gx = c - 15; gx <= c + 15; gx++) {
                put(roadId, gx, rgz);
                put(roadId, gx, rgz + 1);
            }
        }
    }

    // 5. 途经点
    const w = apiWorldOf(c, c);
    const lookAt = { x: aiRound2(w.x), y: aiRound2(Math.max(0.8, aiItemHeight(subjectId) * 0.55)), z: aiRound2(w.z) };
    const route = [];

    film.beats.forEach(b => {
        const h = aiRound2(b.h * tone.hMul * hs);
        const d = aiRound2(b.d * tone.dMul * ls);
        if (b.orbit) {
            const or = Math.max(2, b.orbit.r * ls);
            for (let i = 0; i < b.orbit.count; i++) {
                const a = (i / b.orbit.count) * Math.PI * 2;
                route.push({
                    grid: [aiClamp(Math.round(c + Math.cos(a) * or), 0, size - 1),
                           aiClamp(Math.round(c + Math.sin(a) * or), 0, size - 1)],
                    camera: { mode: b.mode, heightTiles: h, distanceTiles: d, lookAheadTiles: b.look, lookAt }
                });
            }
        } else {
            const cam = { mode: b.mode, heightTiles: h, distanceTiles: d, lookAheadTiles: b.look };
            if (b.aim === 'subject') cam.lookAt = lookAt;
            route.push({
                grid: [aiClamp(Math.round(c + b.at[0] * ls), 0, size - 1),
                       aiClamp(Math.round(c + b.at[1] * ls), 0, size - 1)],
                camera: cam
            });
        }
    });

    // 6. 防穿模：路径不能从主体身上穿过去（主体越高越容易穿帮，安全距离跟着涨）
    aiGuardRoute(route, c, aiClamp(1.6 + aiItemHeight(subjectId) * 0.1, 1.6, 4.5));

    const b0 = film.beats[0];
    return {
        sky: tone.sky || 'day',
        items,
        camera: {
            mode: b0.mode,
            heightTiles: aiRound2(b0.h * tone.hMul),
            distanceTiles: aiRound2(b0.d * tone.dMul),
            lookAheadTiles: b0.look
        },
        route,
        play: { autoplay: true, loop: false, speed: len.speed }
    };
}

/**
 * 机位防穿模。
 *
 * 关键：导览相机的位置是「途经点 − distanceTiles × 行进方向 + 高度」，**不是途经点本身**。
 * 所以只检查途经点离主体多远是不够的 —— 相机可能被后跟距离顶到主体身上。
 * 这里直接算相机落点，不足安全距离就把途经点沿径向外推，迭代几次收敛。
 *
 * 另外把「相邻两点的连线穿过主体」也一并处理：在最近点处插一个绕行点兜过去。
 * 单位：minTiles 是格，其余换算成世界单位。
 */
function aiGuardRoute(route, c, minTiles) {
    if (route.length < 2) return route;
    const size = aiGridSize();
    const cw = apiWorldOf(c, c);
    const safe = minTiles * tileSize;

    const worldOf = (p) => {
        if (Array.isArray(p.grid)) return apiWorldOf(p.grid[0], p.grid[1]);
        if (Array.isArray(p.pos)) return { x: p.pos[0], z: p.pos[1] };
        return null;
    };
    const moveBy = (p, dx, dz) => {
        const w = worldOf(p);
        if (!w) return;
        const x = w.x + dx, z = w.z + dz;
        const half = (size * tileSize) / 2;
        if (Array.isArray(p.grid)) {
            p.grid = [aiClamp(Math.round((x + half - tileSize / 2) / tileSize), 0, size - 1),
                      aiClamp(Math.round((z + half - tileSize / 2) / tileSize), 0, size - 1)];
        } else if (Array.isArray(p.pos)) {
            p.pos = [aiRound2(x), aiRound2(z)];
        }
    };

    // 1. 相机落点外推：迭代收敛，因为挪动途经点会改变行进方向
    for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (let i = 0; i < route.length; i++) {
            const cam = aiCameraSpot(route, i, cw);
            if (!cam) continue;
            const dist = Math.hypot(cam.x - cw.x, cam.z - cw.z);
            if (dist >= safe) continue;
            const ux = dist > 0.01 ? (cam.x - cw.x) / dist : 0.707;
            const uz = dist > 0.01 ? (cam.z - cw.z) / dist : 0.707;
            const need = safe - dist + 0.2;
            moveBy(route[i], ux * need, uz * need);
            moved = true;
        }
        if (!moved) break;
    }

    // 2. 相邻点连线若穿过主体，在最近点处插一个绕行点，让路径从旁边兜过去
    const out = [route[0]];
    for (let i = 1; i < route.length; i++) {
        const a = worldOf(route[i - 1]);
        const b = worldOf(route[i]);
        if (a && b) {
            const dx = b.x - a.x, dz = b.z - a.z;
            const len2 = dx * dx + dz * dz;
            if (len2 > 1e-6) {
                const t = ((cw.x - a.x) * dx + (cw.z - a.z) * dz) / len2;
                if (t > 0.02 && t < 0.98) {
                    const mx = a.x + dx * t, mz = a.z + dz * t;
                    if (Math.hypot(mx - cw.x, mz - cw.z) < safe) {
                        let nx = -dz, nz = dx;
                        const nl = Math.hypot(nx, nz) || 1;
                        nx /= nl; nz /= nl;
                        const side = ((mx - cw.x) * nx + (mz - cw.z) * nz) >= 0 ? 1 : -1;
                        const r = safe * 1.3;
                        const detour = { camera: JSON.parse(JSON.stringify(route[i].camera)), grid: [c, c] };
                        moveBy(detour, (cw.x + nx * side * r) - cw.x, (cw.z + nz * side * r) - cw.z);
                        out.push(detour);
                    }
                }
            }
        }
        out.push(route[i]);
    }

    // 3. 相邻点落在同一格会被 addWaypoint 当重复点丢掉，这里先错开
    for (let i = 1; i < out.length; i++) {
        const a = aiRouteWorld(out[i - 1]);
        const b = aiRouteWorld(out[i]);
        if (!a || !b) continue;
        if (Math.abs(a.x - b.x) < 1.5 && Math.abs(a.z - b.z) < 1.5) {
            let nx = -(a.z - cw.z), nz = a.x - cw.x;
            const nl = Math.hypot(nx, nz) || 1;
            moveBy(out[i], (nx / nl) * tileSize * 1.4, (nz / nl) * tileSize * 1.4);
        }
    }

    // 4. 抽稀到途经点上限（首尾保留）
    if (out.length <= WAYPOINT_MAX) return out;
    const keep = [out[0]];
    for (let i = 1; i < WAYPOINT_MAX - 1; i++) {
        keep.push(out[Math.round((i * (out.length - 1)) / (WAYPOINT_MAX - 1))]);
    }
    keep.push(out[out.length - 1]);
    return keep;
}

/**
 * 算出第 i 个途经点上导览相机的实际水平落点。
 * 与 camera.js 的 desiredStateForWaypoint 同一套几何：
 *   相机 = 途经点 − distanceTiles × (朝向下一个途经点的单位向量)
 * 最后一个点沿用上一段的方向。
 */
function aiCameraSpot(route, i, cw) {
    const cur = aiRouteWorld(route[i]);
    if (!cur) return null;
    const cam = route[i].camera || {};
    if (cam.mode === 'pose' && cam.pose && cam.pose.pos) {
        return { x: cam.pose.pos.x, z: cam.pose.pos.z };
    }
    const d = (typeof cam.distanceTiles === 'number' ? cam.distanceTiles : 2.5) * tileSize;
    let nx, nz;
    const nxt = aiRouteWorld(route[i + 1] || route[i]);
    if (nxt && (Math.abs(nxt.x - cur.x) > 1e-4 || Math.abs(nxt.z - cur.z) > 1e-4)) {
        nx = nxt.x - cur.x; nz = nxt.z - cur.z;
    } else if (i > 0) {
        const prv = aiRouteWorld(route[i - 1]);
        nx = cur.x - prv.x; nz = cur.z - prv.z;
    } else {
        nx = cw.x - cur.x; nz = cw.z - cur.z;
    }
    const nl = Math.hypot(nx, nz) || 1;
    return { x: cur.x - (nx / nl) * d, z: cur.z - (nz / nl) * d };
}

function aiRouteWorld(p) {
    if (!p) return null;
    if (Array.isArray(p.grid)) return apiWorldOf(p.grid[0], p.grid[1]);
    if (Array.isArray(p.pos)) return { x: p.pos[0], z: p.pos[1] };
    return null;
}

// ============ 七、对外接口（供 GridBuilder 挂载 / 脚本调用） ============

// 风格清单：片子类型 / 调性 / 时长
function aiStyles() {
    return {
        films: AI_FILMS.map(f => ({ id: f.id, label: f.label, brief: f.brief, defaultSubject: f.subject, beats: f.beats.map(b => b.name) })),
        tones: AI_TONES.map(t => ({ id: t.id, label: t.label })),
        lengths: AI_LENGTHS.map(l => ({ id: l.id, label: l.label, sec: l.sec, speed: l.speed })),
        keywords: AI_KEYWORDS.map(k => ({ keys: k.keys, subject: k.subject }))
    };
}

// 只拼描述，不生成
function aiDescribeChoice(choice) {
    return aiBriefPlain(choice);
}

// 拼描述 + 生成 Spec
function aiCompose(choice) {
    const ui = {
        film: choice.film || aiUI.film,
        tone: choice.tone || aiUI.tone,
        length: choice.length || aiUI.length,
        subject: choice.subject || ''
    };
    return { brief: aiBriefPlain(ui), spec: aiComposeSpec(ui) };
}

// ============ 八、面板 ============

const aiUI = {
    film: 'product',
    tone: 'premium',
    length: 's30',
    subject: ''
};

function aiPanelEl() { return document.getElementById('ai-panel'); }

function openAiPanel() {
    const p = aiPanelEl();
    if (!p) return;
    p.classList.remove('hidden');
    p.classList.add('flex');
    aiFlash('', true);
}

function closeAiPanel() {
    const p = aiPanelEl();
    if (!p) return;
    p.classList.add('hidden');
    p.classList.remove('flex');
}

function aiFlash(text, ok) {
    const msg = document.getElementById('ai-msg');
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'text-[11px] ' + (ok ? 'text-emerald-300' : 'text-rose-300');
}

// 生成一排可点选的风格卡
function aiBuildChips(host, list, current, onPick) {
    if (!host) return;
    host.innerHTML = '';
    list.forEach(item => {
        const b = document.createElement('button');
        b.className = 'ai-chip' + (item.id === current ? ' active' : '');
        b.dataset.id = item.id;
        b.innerHTML = '<i class="fa-solid ' + item.icon + '"></i>' + item.label;
        b.title = item.brief || '';
        b.addEventListener('click', () => {
            host.querySelectorAll('.ai-chip').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
            onPick(item.id);
        });
        host.appendChild(b);
    });
}

function aiRefreshScript() {
    const box = document.getElementById('ai-script');
    if (box) box.innerHTML = aiBriefText(aiUI);
}

(function bindAiMode() {
    if (!aiPanelEl()) return;

    aiBuildChips(document.getElementById('ai-film'), AI_FILMS, aiUI.film, id => {
        aiUI.film = id; aiRefreshScript();
    });
    aiBuildChips(document.getElementById('ai-tone'), AI_TONES, aiUI.tone, id => {
        aiUI.tone = id; aiRefreshScript();
    });
    aiBuildChips(document.getElementById('ai-length'), AI_LENGTHS, aiUI.length, id => {
        aiUI.length = id; aiRefreshScript();
    });

    const subject = document.getElementById('ai-subject');
    if (subject) {
        subject.value = aiUI.subject;
        subject.addEventListener('input', () => {
            aiUI.subject = subject.value;
            aiRefreshScript();
        });
    }

    document.querySelectorAll('.ai-example').forEach(btn => {
        btn.addEventListener('click', () => {
            aiUI.subject = btn.dataset.fill || '';
            if (subject) subject.value = aiUI.subject;
            aiRefreshScript();
            if (subject) subject.focus();
        });
    });

    aiRefreshScript();

    document.getElementById('ai-close').addEventListener('click', closeAiPanel);
    aiPanelEl().addEventListener('click', e => { if (e.target === aiPanelEl()) closeAiPanel(); });

    // 一键出片：本地生成，不依赖任何外部 AI
    document.getElementById('ai-run').addEventListener('click', () => {
        let spec;
        try {
            spec = aiComposeSpec(aiUI);
        } catch (e) {
            aiFlash('生成失败：' + e.message, false);
            return;
        }
        try {
            const rep = apiBuild(spec, { autoplay: true });
            const parts = [`已放置 ${rep.items} 件（${rep.cells} 格）`, `${rep.route} 个途经点`];
            if (rep.playing) parts.push('正在播放');
            if (rep.skipped.length) parts.push(`${rep.skipped.length} 条未落地`);
            aiFlash(parts.join(' · '), rep.skipped.length === 0);
            if (!rep.skipped.length) setTimeout(closeAiPanel, 700);
        } catch (e) {
            aiFlash('生成失败：' + e.message, false);
        }
    });

    // 把当前选择拼成人话描述，交给更强的 AI 做更复杂的分镜
    document.getElementById('ai-copy-brief').addEventListener('click', async () => {
        const ok = await apiCopy(apiPromptText(aiBriefPlain(aiUI)));
        aiFlash(ok ? '已复制，粘给任意 AI 即可' : '复制失败，请手动复制', ok);
    });

    // —— 高级：直接用 AI 写的 Spec ——
    document.getElementById('ai-copy-prompt').addEventListener('click', async () => {
        const ok = await apiCopy(apiPromptText(aiBriefPlain(aiUI)));
        aiFlash(ok ? '提示词已复制，粘给任意 AI 即可' : '复制失败，请手动全选复制', ok);
    });

    document.getElementById('ai-copy-spec').addEventListener('click', async () => {
        const ok = await apiCopy(apiSpecGuide() + '\n\n## 物品目录\n' +
            apiManifest().items.map(i => `${i.id}\t${i.name}\t高${i.height}`).join('\n'));
        aiFlash(ok ? 'Spec 规范与物品目录已复制' : '复制失败', ok);
    });

    document.getElementById('ai-copy-scene').addEventListener('click', async () => {
        const spec = apiDescribe();
        const text = JSON.stringify(spec, null, 2);
        document.getElementById('ai-spec').value = text;
        const ok = await apiCopy(text);
        aiFlash(ok ? `已导出当前场景（${spec.items.length} 件物品 / ${spec.route.length} 个途经点）` : '复制失败，已填入下方输入框', ok);
    });

    document.getElementById('ai-generate').addEventListener('click', () => {
        const raw = document.getElementById('ai-spec').value.trim();
        if (!raw) { aiFlash('请先粘贴场景 Spec', false); return; }
        let spec;
        try {
            spec = JSON.parse(raw);
        } catch (e) {
            aiFlash('JSON 解析失败：' + e.message, false);
            return;
        }
        try {
            const rep = apiBuild(spec, { autoplay: true });
            const parts = [`已放置 ${rep.items} 件（${rep.cells} 格）`, `${rep.route} 个途经点`];
            if (rep.playing) parts.push('正在播放');
            if (rep.skipped.length) parts.push(`${rep.skipped.length} 条未落地`);
            aiFlash(parts.join(' · '), rep.skipped.length === 0);
            if (!rep.skipped.length) setTimeout(closeAiPanel, 900);
        } catch (e) {
            aiFlash('生成失败：' + e.message, false);
        }
    });

    // Esc 关闭（选择/移动的 Esc 处理在 interaction.js，这里只处理面板）
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !aiPanelEl().classList.contains('hidden')) closeAiPanel();
    });
})();
