import {
    buildHistoryCardMarkup,
    escapeHistoryHtml,
    formatHistoryExactDate,
    groupHistoryItems
} from './history-utils.js';

/**
 * 面向超大量历史记录的全屏浏览面板。
 */
export function createHistoryFullscreenApi({
    state,
    getHistory,
    clearHistory,
    deleteHistoryEntry,
    deleteHistoryItems,
    openHistoryPreview,
    downloadImage,
    showToast,
    documentRef = document,
    confirmRef = confirm
}) {
    const viewState = {
        items: [],
        groups: [],
        activeGroupId: null,
        scrollHandlerBound: false
    };

    function getEls() {
        return {
            modal: documentRef.getElementById('history-fullscreen-modal'),
            scroll: documentRef.getElementById('history-fullscreen-scroll'),
            list: documentRef.getElementById('history-fullscreen-list'),
            timeline: documentRef.getElementById('history-fullscreen-timeline'),
            tooltip: documentRef.getElementById('history-fullscreen-rail-tooltip'),
            count: documentRef.getElementById('history-fullscreen-count'),
            summary: documentRef.getElementById('history-fullscreen-summary'),
            batchToolbar: documentRef.getElementById('history-fullscreen-batch-toolbar'),
            selectedCount: documentRef.getElementById('history-fullscreen-selected-count')
        };
    }

    function syncSelectionCount() {
        const { selectedCount } = getEls();
        if (selectedCount) selectedCount.textContent = String(state.selectedHistoryIds.size);
    }

    function renderEmptyState() {
        const { list, timeline, count, summary } = getEls();
        if (count) count.textContent = '0';
        if (summary) summary.textContent = '按大概时间分组浏览历史记录';
        if (list) list.innerHTML = '<div class="history-fullscreen-empty">暂无历史记录</div>';
        if (timeline) timeline.innerHTML = '';
    }

    function renderTimeline(groups) {
        const { timeline } = getEls();
        if (!timeline) return;

        timeline.innerHTML = groups.map((group) => `
            <button class="history-timeline-marker ${viewState.activeGroupId === group.id ? 'active' : ''}"
                type="button"
                data-group-id="${group.id}"
                data-label="${escapeHistoryHtml(group.label)}">
                <span class="history-timeline-marker-line"></span>
                <span class="history-timeline-marker-dot"></span>
            </button>
        `).join('');

        timeline.querySelectorAll('.history-timeline-marker').forEach((button) => {
            button.addEventListener('mouseenter', () => showTimelineTooltip(button));
            button.addEventListener('focus', () => showTimelineTooltip(button));
            button.addEventListener('mouseleave', hideTimelineTooltip);
            button.addEventListener('blur', hideTimelineTooltip);
            button.addEventListener('click', () => jumpToGroup(button.dataset.groupId));
        });
    }

    function renderGroups() {
        const { list, count, summary } = getEls();
        if (!list) return;
        if (!viewState.items.length) {
            renderEmptyState();
            return;
        }

        if (count) count.textContent = String(viewState.items.length);
        if (summary) summary.textContent = '按大概时间分组浏览历史记录';

        list.innerHTML = viewState.groups.map((group) => `
            <section class="history-fullscreen-group" id="${group.id}" data-group-id="${group.id}">
                <header class="history-fullscreen-group-header">
                    <div class="history-fullscreen-group-title">
                        <h3>${escapeHistoryHtml(group.label)}</h3>
                        <span>${group.items.length} 条</span>
                    </div>
                </header>
                <div class="history-fullscreen-group-grid">
                    ${group.items.map((item) => buildHistoryCardMarkup({
                        item,
                        selected: state.selectedHistoryIds.has(item.id),
                        multiSelectMode: state.historySelectionMode,
                        compact: false
                    })).join('')}
                </div>
            </section>
        `).join('');

        bindCardEvents();
        renderTimeline(viewState.groups);
        updateActiveGroupFromScroll();
    }

    function bindCardEvents() {
        const { list } = getEls();
        if (!list) return;

        list.querySelectorAll('.history-card').forEach((card) => {
            card.draggable = true;
            card.addEventListener('dragstart', (event) => {
                const itemId = Number(card.dataset.id);
                const item = viewState.items.find((entry) => entry.id === itemId);
                if (!item?.image) return;
                state.draggedHistoryImage = { id: item.id, image: item.image };
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('application/x-cainflow-history-image', String(item.id));
            });

            card.addEventListener('dragend', () => {
                setTimeout(() => {
                    state.draggedHistoryImage = null;
                }, 0);
            });

            card.addEventListener('click', () => {
                const itemId = Number(card.dataset.id);
                const item = viewState.items.find((entry) => entry.id === itemId);
                if (!item) return;

                if (state.historySelectionMode) {
                    if (state.selectedHistoryIds.has(itemId)) state.selectedHistoryIds.delete(itemId);
                    else state.selectedHistoryIds.add(itemId);
                    syncSelectionCount();
                    renderGroups();
                } else {
                    openHistoryPreview(item);
                }
            });
        });

        list.querySelectorAll('.delete-btn').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                const id = Number(button.dataset.id);
                if (!confirmRef('确定要删除这条历史记录吗？')) return;
                await deleteHistoryEntry(id);
                await refresh();
            });
        });
    }

    async function refresh() {
        viewState.items = await getHistory();
        viewState.groups = groupHistoryItems(viewState.items);
        if (!viewState.activeGroupId && viewState.groups[0]) {
            viewState.activeGroupId = viewState.groups[0].id;
        }
        syncSelectionCount();
        renderGroups();
    }

    function showTimelineTooltip(button) {
        const { tooltip, timeline } = getEls();
        if (!tooltip || !timeline || !button) return;
        tooltip.textContent = button.dataset.label || '';
        tooltip.classList.remove('hidden');
        const timelineRect = timeline.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        tooltip.style.top = `${buttonRect.top - timelineRect.top - 8}px`;
    }

    function hideTimelineTooltip() {
        const { tooltip } = getEls();
        tooltip?.classList.add('hidden');
    }

    function jumpToGroup(groupId) {
        const { scroll } = getEls();
        const groupEl = documentRef.getElementById(groupId);
        if (!scroll || !groupEl) return;
        const top = groupEl.offsetTop - 24;
        scroll.scrollTo({ top, behavior: 'smooth' });
        viewState.activeGroupId = groupId;
        renderTimeline(viewState.groups);
    }

    function updateActiveGroupFromScroll() {
        const { scroll } = getEls();
        if (!scroll) return;
        const groups = Array.from(scroll.querySelectorAll('.history-fullscreen-group'));
        const scrollTop = scroll.scrollTop;
        let activeId = groups[0]?.dataset.groupId || null;
        groups.forEach((group) => {
            if (group.offsetTop - 80 <= scrollTop) activeId = group.dataset.groupId;
        });
        if (activeId && activeId !== viewState.activeGroupId) {
            viewState.activeGroupId = activeId;
            renderTimeline(viewState.groups);
        }
    }

    function open() {
        const { modal } = getEls();
        if (!modal) return;
        modal.classList.remove('hidden');
        refresh();
    }

    function close() {
        const { modal } = getEls();
        modal?.classList.add('hidden');
        hideTimelineTooltip();
        state.historySelectionMode = false;
        state.selectedHistoryIds.clear();
    }

    function enterBatchMode() {
        const { batchToolbar } = getEls();
        state.historySelectionMode = true;
        state.selectedHistoryIds.clear();
        batchToolbar?.classList.remove('hidden');
        syncSelectionCount();
        renderGroups();
    }

    function exitBatchMode() {
        const { batchToolbar } = getEls();
        state.historySelectionMode = false;
        state.selectedHistoryIds.clear();
        batchToolbar?.classList.add('hidden');
        syncSelectionCount();
        renderGroups();
    }

    async function selectAll() {
        viewState.items.forEach((item) => state.selectedHistoryIds.add(item.id));
        syncSelectionCount();
        renderGroups();
    }

    async function deleteSelected() {
        if (state.selectedHistoryIds.size === 0) {
            showToast('请先选择要删除的历史记录', 'warn');
            return;
        }
        if (!confirmRef(`确定要删除选中的 ${state.selectedHistoryIds.size} 条历史记录吗？`)) return;
        await deleteHistoryItems(Array.from(state.selectedHistoryIds));
        state.selectedHistoryIds.clear();
        await refresh();
        exitBatchMode();
        showToast('已删除选中的历史记录', 'success');
    }

    async function downloadSelected() {
        if (state.selectedHistoryIds.size === 0) {
            showToast('请先选择要下载的历史记录', 'warn');
            return;
        }
        const selected = viewState.items.filter((item) => state.selectedHistoryIds.has(item.id));
        for (const item of selected) {
            downloadImage(item.image, `cainflow_${item.id}.png`);
            await new Promise((resolve) => setTimeout(resolve, 180));
        }
        showToast(`已开始下载 ${selected.length} 条历史记录`, 'success');
    }

    async function handleClearHistory() {
        if (!confirmRef('确定要清空全部历史记录吗？此操作无法撤销。')) return;
        await clearHistory();
        await refresh();
        showToast('历史记录已清空', 'info');
    }

    function bindStaticEvents() {
        if (viewState.scrollHandlerBound) return;
        const { scroll, modal } = getEls();

        documentRef.getElementById('btn-expand-history')?.addEventListener('click', open);
        documentRef.getElementById('btn-close-history-fullscreen')?.addEventListener('click', close);
        documentRef.getElementById('btn-history-fullscreen-batch')?.addEventListener('click', enterBatchMode);
        documentRef.getElementById('btn-history-fullscreen-cancel')?.addEventListener('click', exitBatchMode);
        documentRef.getElementById('btn-history-fullscreen-select-all')?.addEventListener('click', selectAll);
        documentRef.getElementById('btn-history-fullscreen-delete')?.addEventListener('click', deleteSelected);
        documentRef.getElementById('btn-history-fullscreen-download')?.addEventListener('click', downloadSelected);
        documentRef.getElementById('btn-history-fullscreen-clear')?.addEventListener('click', handleClearHistory);

        modal?.addEventListener('click', (event) => {
            if (event.target === modal) close();
        });

        scroll?.addEventListener('scroll', updateActiveGroupFromScroll, { passive: true });

        documentRef.addEventListener('keydown', (event) => {
            const { modal: currentModal } = getEls();
            if (event.key === 'Escape' && currentModal && !currentModal.classList.contains('hidden')) {
                close();
            }
        });

        viewState.scrollHandlerBound = true;
    }

    return {
        initHistoryFullscreen() {
            bindStaticEvents();
        },
        open,
        close,
        refresh,
        isOpen: () => !getEls().modal?.classList.contains('hidden')
    };
}
