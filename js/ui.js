/**
 * ui.js — 全局提示 Toast + 面板折叠
 * showToast(message)：顶部弹出提示，2.5 秒后自动淡出
 * bindCollapsePanel(btnId, bodyId, chevronId)：通用折叠开关
 *
 * 折叠面板的「初始状态」由 HTML 决定：body 加 hidden，chevron 内联 rotate(-90deg)。
 * 本文件在全部 DOM 就绪后加载，负责为所有折叠面板绑定点击开关。
 */

let toastTimeout;

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%, 0)';

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -16px)';
    }, 2500);
}

/**
 * 通用面板折叠绑定
 * @param {string} btnId      触发按钮
 * @param {string} bodyId     折叠主体
 * @param {string} chevronId  箭头图标（可省略）
 */
function bindCollapsePanel(btnId, bodyId, chevronId) {
    const btn = document.getElementById(btnId);
    const body = document.getElementById(bodyId);
    const chevron = chevronId ? document.getElementById(chevronId) : null;
    if (!btn || !body) return;
    btn.addEventListener('click', () => {
        const collapsed = body.classList.toggle('hidden');
        if (chevron) chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    });
}

// 折叠面板（初始均为折叠态，见 index.html）
// 路线游览面板由 tour.js 自行绑定（toggleRoutePanel），此处不重复绑定
bindCollapsePanel('btn-cam-collapse', 'cam-body', 'cam-chevron');
bindCollapsePanel('btn-hint-collapse', 'hint-body', 'hint-chevron');
