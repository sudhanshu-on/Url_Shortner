/**
 * SwiftURL — Shared Animation Utilities
 * Provides: Toast, PageTransition, ProgressBar, SkeletonSwap, ButtonState
 */

(function (global) {
    'use strict';

    /* ── Toast System ─────────────────────────────────────────── */

    const TOAST_ICONS = {
        success: '✓',
        error:   '✗',
        info:    '◈',
        copy:    '⧉',
        default: '●'
    };

    let toastContainer = null;

    function getToastContainer() {
        if (toastContainer) return toastContainer;
        toastContainer = document.createElement('div');
        toastContainer.id = 'sw-toast-container';
        document.body.appendChild(toastContainer);
        return toastContainer;
    }

    function showToast(message, type = 'info', duration = 2800) {
        const container = getToastContainer();
        const toast = document.createElement('div');
        toast.className = `sw-toast sw-toast-${type}`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'polite');

        const icon = document.createElement('span');
        icon.className = 'sw-toast-icon';
        icon.textContent = TOAST_ICONS[type] || TOAST_ICONS.default;

        const text = document.createElement('span');
        text.textContent = message;

        toast.appendChild(icon);
        toast.appendChild(text);

        // Dismiss on click
        toast.addEventListener('click', () => dismissToast(toast));

        container.appendChild(toast);

        const timer = setTimeout(() => dismissToast(toast), duration);
        toast._timer = timer;
    }

    function dismissToast(toast) {
        if (toast._dismissed) return;
        toast._dismissed = true;
        clearTimeout(toast._timer);
        toast.classList.add('sw-exiting');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }

    /* ── Progress Bar ─────────────────────────────────────────── */

    let progressBar = null;
    let progressValue = 0;
    let progressTimer = null;

    function getProgressBar() {
        if (progressBar) return progressBar;
        progressBar = document.createElement('div');
        progressBar.id = 'sw-progress-bar';
        document.body.appendChild(progressBar);
        return progressBar;
    }

    function startProgress() {
        const bar = getProgressBar();
        progressValue = 0;
        bar.style.width = '0%';
        bar.classList.add('sw-progress-active');

        // Simulate progress up to 85%
        clearInterval(progressTimer);
        progressTimer = setInterval(() => {
            if (progressValue < 85) {
                progressValue += (85 - progressValue) * 0.12;
                bar.style.width = progressValue + '%';
            }
        }, 80);
    }

    function finishProgress() {
        const bar = getProgressBar();
        clearInterval(progressTimer);
        bar.style.width = '100%';
        setTimeout(() => {
            bar.classList.remove('sw-progress-active');
            bar.style.width = '0%';
        }, 350);
    }

    /* ── Page Transition Curtain ──────────────────────────────── */

    let curtain = null;

    function getCurtain() {
        if (curtain) return curtain;
        curtain = document.createElement('div');
        curtain.id = 'sw-page-curtain';
        document.body.appendChild(curtain);
        return curtain;
    }

    function navigateTo(url) {
        if (global._swNavigating) return;
        global._swNavigating = true;
        const c = getCurtain();
        c.className = 'sw-curtain-exit';

        const onEnd = () => {
            window.location.href = url;
        };
        c.addEventListener('animationend', onEnd, { once: true });
        // Fallback
        setTimeout(onEnd, 400);
    }

    /* ── Button Loading State ─────────────────────────────────── */

    function setButtonLoading(btn, originalText) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = originalText || btn.textContent;
        btn.classList.add('sw-btn-loading');
    }

    function clearButtonLoading(btn) {
        btn.disabled = false;
        if (btn.dataset.originalText) {
            btn.textContent = btn.dataset.originalText;
        }
        btn.classList.remove('sw-btn-loading');
    }

    /* ── Shake Error ──────────────────────────────────────────── */

    function shakeElement(el) {
        el.classList.remove('sw-shake');
        void el.offsetWidth; // reflow
        el.classList.add('sw-shake');
        el.addEventListener('animationend', () => el.classList.remove('sw-shake'), { once: true });
    }

    /* ── Skeleton Loaders ─────────────────────────────────────── */

    function createSkeletonRows(count, className = 'sw-skeleton sw-skeleton-row') {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = className;
            el.style.animationDelay = `${i * 0.07}s`;
            frag.appendChild(el);
        }
        return frag;
    }

    function createSkeletonStatValue() {
        const el = document.createElement('div');
        el.className = 'sw-skeleton sw-skeleton-value';
        return el;
    }

    /* ── Animate Count Update ─────────────────────────────────── */

    function animateValueUpdate(el, newValue) {
        el.classList.remove('sw-count-appear');
        void el.offsetWidth;
        el.textContent = newValue;
        el.classList.add('sw-count-appear');
        el.addEventListener('animationend', () => el.classList.remove('sw-count-appear'), { once: true });
    }

    /* ── Animate List Items (stagger) ─────────────────────────── */

    function animateListItems(containerEl, itemClass = '') {
        const items = containerEl.children;
        Array.from(items).forEach((item, i) => {
            item.classList.add('sw-link-enter');
            item.style.animationDelay = `${i * 0.06}s`;
            item.addEventListener('animationend', () => {
                item.classList.remove('sw-link-enter');
                item.style.animationDelay = '';
            }, { once: true });
        });
    }

    /* ── Page Entry Animation ─────────────────────────────────── */

    function runPageEntry() {
        const c = getCurtain();
        // After initial load, cover with curtain then reveal
        c.style.transform = 'scaleX(0)';
        c.className = '';

        // Animate main container in
        document.documentElement.style.opacity = '0';
        requestAnimationFrame(() => {
            document.documentElement.style.transition = 'opacity 0.25s ease';
            document.documentElement.style.opacity = '1';
        });
    }

    /* ── Add active state to all submit buttons ───────────────── */

    function applyButtonActiveStates() {
        document.querySelectorAll('button, .btn-submit, .btn-copy, .btn-logout, .signout').forEach(btn => {
            btn.classList.add('sw-btn-active');
        });
    }

    /* ── ShortURL Creature ────────────────────────────────────── */

function initShortURLCreature() {
    const creature = document.getElementById('shorturl-creature');

    if (!creature) return;

    // Start at a random position
    moveCreature(creature);

    // Move again every few seconds
    setInterval(() => {
        moveCreature(creature);
    }, 2500);
}

function moveCreature(creature) {
    const padding = 40;

    const maxX = window.innerWidth - creature.offsetWidth - padding;
    const maxY = window.innerHeight - creature.offsetHeight - padding;

    const x = padding + Math.random() * Math.max(0, maxX - padding);
    const y = padding + Math.random() * Math.max(0, maxY - padding);

    creature.style.setProperty('--creature-x', `${x}px`);
    creature.style.setProperty('--creature-y', `${y}px`);
}

    /* ── Auto-init on DOM ready ───────────────────────────────── */

    function init() {
    getToastContainer();
    getProgressBar();
    getCurtain();
    applyButtonActiveStates();
    runPageEntry();

    // ShortURL creature
    initShortURLCreature();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    /* ── Export to global SwAnim namespace ────────────────────── */

    global.SwAnim = {
        toast:               showToast,
        startProgress:       startProgress,
        finishProgress:      finishProgress,
        navigateTo:          navigateTo,
        setButtonLoading:    setButtonLoading,
        clearButtonLoading:  clearButtonLoading,
        shake:               shakeElement,
        skeletonRows:        createSkeletonRows,
        skeletonStatValue:   createSkeletonStatValue,
        animateValue:        animateValueUpdate,
        animateList:         animateListItems,
    };

})(window);
