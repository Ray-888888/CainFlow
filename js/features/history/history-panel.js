import { buildHistoryCardMarkup } from './history-utils.js';

/**
 * 管理轻量级历史侧栏。
 */
export function createHistoryPanelApi({
    state,
    getHistory,
    createThumbnail,
    openDB,
    openHistoryPreview,
    deleteHistoryEntry,
    storeHistoryName = 'imageHistory'
}) {
    function applyHistoryGridCols(cols) {
        let normalized = Number(cols) || 2;
        if (normalized < 2) normalized = 2;
        if (normalized > 5) normalized = 5;
        state.historyGridCols = normalized;
        const sidebar = document.getElementById('history-sidebar');
        const label = document.getElementById('history-grid-cols-label');
        if (sidebar) sidebar.style.setProperty('--history-grid-cols', normalized);
        if (label) label.textContent = normalized;
    }

    async function ensureThumb(item) {
        if (item.thumb || !item.image) return;
        setTimeout(async () => {
            const thumb = await createThumbnail(item.image);
            const db = await openDB();
            const tx = db.transaction(storeHistoryName, 'readwrite');
            tx.objectStore(storeHistoryName).put({ ...item, thumb });
        }, 0);
    }

    async function renderHistoryList() {
        const list = document.getElementById('history-list');
        const countBadge = document.getElementById('history-total-count');
        const items = await getHistory();
        if (!list) return;

        if (!items.length) {
            list.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding: 40px 0; font-size:13px;">暂无历史记录</div>';
            if (countBadge) countBadge.textContent = '';
            return;
        }

        if (countBadge) countBadge.textContent = `共 ${items.length} 张`;

        const displayItems = items.slice(0, 100);
        const hasMore = items.length > 100;

        await Promise.all(displayItems.map((item) => ensureThumb(item)));

        let html = displayItems.map((item) => buildHistoryCardMarkup({
            item,
            selected: state.selectedHistoryIds.has(item.id),
            multiSelectMode: state.historySelectionMode,
            compact: true
        })).join('');

        if (hasMore) {
            html += '<div style="grid-column: 1/-1; color:var(--text-dim); text-align:center; padding: 20px; font-size:12px;">侧栏仅显示最近 100 条记录，完整历史请使用全屏历史面板查看。</div>';
        }

        list.innerHTML = html;

        const countEl = document.getElementById('selected-count');
        if (countEl) countEl.textContent = state.selectedHistoryIds.size;

        list.querySelectorAll('.history-card').forEach((card) => {
            card.draggable = true;
            card.addEventListener('dragstart', (event) => {
                const itemId = Number(card.dataset.id);
                const item = items.find((entry) => entry.id === itemId);
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
                const item = items.find((entry) => entry.id === itemId);
                if (!item) return;

                if (state.historySelectionMode) {
                    if (state.selectedHistoryIds.has(itemId)) state.selectedHistoryIds.delete(itemId);
                    else state.selectedHistoryIds.add(itemId);
                    renderHistoryList();
                } else {
                    openHistoryPreview(item);
                }
            });
        });

        list.querySelectorAll('.delete-btn').forEach((button) => {
            button.addEventListener('click', async (event) => {
                event.stopPropagation();
                if (!confirm('确定要删除这条历史记录吗？')) return;
                await deleteHistoryEntry(Number(button.dataset.id));
                renderHistoryList();
            });
        });
    }

    return {
        applyHistoryGridCols,
        renderHistoryList
    };
}
