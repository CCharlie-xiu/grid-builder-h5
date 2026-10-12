/**
 * ui.js — 全局提示 Toast
 * showToast(message)：顶部弹出提示，2.5 秒后自动淡出
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
