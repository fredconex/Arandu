// Download Management Module
class DownloadManager {
    constructor(desktop) {
        this.desktop = desktop;
        this.downloads = [];
        this.downloadManagerVisible = false;
        this.lastDownloadsJson = '';
        this.desktopRefreshTimeout = null;
        this.invoke = null;

        this.initTauriAPI();
        this.startTauriDownloadMonitoring();
        this.listenForDownloadCompletion();

        setTimeout(() => this.updateDownloadManagerIcon(), 100);
    }

    // ─── Tauri API ────────────────────────────────────────────────────────────

    initTauriAPI() {
        try {
            this.invoke = window.__TAURI__?.core?.invoke ?? null;
            if (!this.invoke) console.warn('Tauri API not available yet, will retry when needed');
        } catch (error) {
            console.error('Failed to initialize Tauri API:', error);
        }
    }

    getInvoke() {
        if (!this.invoke) this.initTauriAPI();
        return this.invoke;
    }

    // ─── Event Listeners ──────────────────────────────────────────────────────

    listenForDownloadCompletion() {
        const setup = () => {
            const ev = window.__TAURI__?.event;
            if (!ev) {
                setTimeout(setup, 100);
                return;
            }

            ev.listen('download-complete', () => {
                this.debouncedDesktopRefresh();
                this.updateDownloadManagerIcon();
            });

            ev.listen('download-progress', (event) => {
                this.updateDownloadProgress(event.payload);
            });

            ev.listen('extraction-progress', (event) => {
                this.updateExtractionProgress(event.payload);
            });

            ev.listen('file-deleted', () => {
                this.debouncedDesktopRefresh();
                this.updateDownloadManagerIcon();
            });

            ev.listen('open-download-manager', () => {
                this.showDownloadManager();
            });
        };

        setup();
    }

    // ─── Desktop Refresh ──────────────────────────────────────────────────────

    debouncedDesktopRefresh() {
        clearTimeout(this.desktopRefreshTimeout);
        this.desktopRefreshTimeout = setTimeout(() => {
            this.desktop?.loadModels(false);
            this.desktop?.refreshFolderViewIfOpen();
            this.updateDownloadManagerIcon();
            this.desktopRefreshTimeout = null;
        }, 500);
    }

    // ─── Polling ──────────────────────────────────────────────────────────────

    async refreshDownloads() {
        const invoke = this.getInvoke();
        if (!invoke) {
            this.updateDownloadManagerIcon();
            return;
        }

        try {
            const allDownloads = await invoke('get_all_downloads_and_history');
            const json = JSON.stringify(allDownloads);
            if (json !== this.lastDownloadsJson) {
                this.downloads = allDownloads;
                this.lastDownloadsJson = json;
                this.updateDownloadManager();
            } else {
                this.updateDownloadManagerIcon();
            }
        } catch (error) {
            console.error('Error refreshing Tauri downloads:', error);
            this.updateDownloadManagerIcon();
        }
    }

    startTauriDownloadMonitoring() {
        setInterval(() => this.refreshDownloads(), 2000);
    }

    // ─── Real-time Progress Updates ───────────────────────────────────────────

    updateDownloadProgress(updatedDownload) {
        const idx = this.downloads.findIndex(d => d.id === updatedDownload.id);
        if (idx !== -1) {
            this.downloads[idx] = updatedDownload;
        } else {
            this.downloads.push(updatedDownload);
        }
        this.updateDownloadManager();
    }

    updateExtractionProgress(extractionData) {
        const idx = this.downloads.findIndex(d => d.id === extractionData.download_id);
        if (idx !== -1) {
            Object.assign(this.downloads[idx], {
                extraction_progress: extractionData.extraction_progress,
                extraction_total_files: extractionData.extraction_total_files,
                extraction_completed_files: extractionData.extraction_completed_files,
                current_extracting_file: extractionData.current_extracting_file,
            });
        }
        this.updateDownloadManager();
    }

    // ─── Download Controls ────────────────────────────────────────────────────

    async pauseDownload(downloadId) {
        try {
            const invoke = this.getInvoke();
            if (invoke) {
                this.downloads = await invoke('pause_download', { downloadId });
                this.updateDownloadManager();
            }
        } catch (error) {
            console.error('Error pausing download:', error);
        }
    }

    async resumeDownload(downloadId) {
        try {
            const invoke = this.getInvoke();
            if (invoke) {
                this.downloads = await invoke('resume_download', { downloadId });
                this.updateDownloadManager();
            }
        } catch (error) {
            console.error('Error resuming download:', error);
        }
    }

    async cancelDownload(downloadId) {
        try {
            const invoke = this.getInvoke();
            if (invoke) {
                this.downloads = await invoke('cancel_download', { downloadId });
                this.updateDownloadManager();
            }
        } catch (error) {
            console.error('Error cancelling download:', error);
        }
    }

    async clearDownloadHistory() {
        try {
            const invoke = this.getInvoke();
            if (invoke) {
                this.downloads = await invoke('clear_download_history');
                this.updateDownloadManager();

                const activeStatuses = new Set(['Downloading', 'Starting', 'Extracting', 'Paused']);
                const hasActive = this.downloads.some(d => activeStatuses.has(d.status));
                if (!hasActive) this.hideDownloadManager();
            }
        } catch (error) {
            console.error('Error clearing download history:', error);
        }
    }

    async downloadFromUrl(url, destinationFolder, extract = false) {
        try {
            const invoke = this.getInvoke();
            if (invoke) {
                const result = await invoke('download_from_url', { url, destinationFolder, extract });
                return result;
            }
        } catch (error) {
            console.error('Error starting download:', error);
            throw error;
        }
    }

    // ─── UI Helpers ───────────────────────────────────────────────────────────

    hasActiveDownloads() {
        return this.downloads.some(d =>
            d.status === 'Downloading' || d.status === 'Starting' || d.status === 'Extracting'
        );
    }

    updateDownloadManagerIcon() {
        const downloadIcon = document.getElementById('downloads-dock-icon');
        if (!downloadIcon) return;

        const activeDownloads = this.downloads.filter(d =>
            d.status === 'Downloading' || d.status === 'Starting' || d.status === 'Extracting'
        );

        const progressContainer = downloadIcon.querySelector('.dock-progress-container');
        const progressBar = downloadIcon.querySelector('.dock-progress-bar');

        if (activeDownloads.length > 0) {
            downloadIcon.classList.add('pulse');

            const totalProgress = activeDownloads.reduce((sum, d) => {
                return sum + (d.status === 'Extracting' ? (d.extraction_progress || 0) : (d.progress || 0));
            }, 0);
            const avgProgress = totalProgress / activeDownloads.length;

            if (progressContainer) progressContainer.classList.remove('hidden');
            if (progressBar) progressBar.style.width = `${avgProgress}%`;
        } else {
            downloadIcon.classList.remove('pulse');
            if (progressContainer) progressContainer.classList.add('hidden');
        }
    }

    toggleDownloadHistory() {
        if (this.downloadManagerVisible) {
            this.hideDownloadManager();
        } else {
            this.desktop?.hideSystemInfoPopup();
            this.showDownloadManager();
        }
    }

    showDownloadManager() {
        // Refresh downloads immediately
        this.refreshDownloads();

        // Close open folder views
        const searchFolderView = document.getElementById('search-folder-view');
        if (searchFolderView && !searchFolderView.classList.contains('hidden') && this.desktop) {
            const folderTitle = document.getElementById('search-folder-title');
            this.desktop.hideSearchFolderView(folderTitle?.textContent === 'Models');
        }

        if (this.desktop) {
            this.desktop.updateTaskbarButtonState('downloads-dock-icon', true);
            this.desktop.updateDockFocusedState('download-history-window');
        }

        const folderView = document.getElementById('downloads-folder-view');
        if (!folderView) return;

        this.downloadManagerVisible = true;
        this.updateDownloadManagerIcon();
        this.renderDownloadsFolderView();       // Full render only on open
        this.setupDownloadsFolderListeners();

        folderView.classList.remove('hidden');
        if (this.desktop) folderView.style.zIndex = ++this.desktop.windowZIndex;
    }

    hideDownloadManager() {
        this.desktop?.updateTaskbarButtonState('downloads-dock-icon', false);

        const folderView = document.getElementById('downloads-folder-view');
        if (folderView) folderView.classList.add('hidden');

        this.downloadManagerVisible = false;
        this.updateDownloadManagerIcon();
    }

    setupDownloadsFolderListeners() {
        const folderView = document.getElementById('downloads-folder-view');

        const backBtn = document.getElementById('downloads-folder-back');
        if (backBtn) backBtn.onclick = () => this.hideDownloadManager();

        // Click outside to close (since overlay is removed)
        const closeOnOutsideClick = (e) => {
            if (e.target === folderView) {
                this.hideDownloadManager();
                folderView.removeEventListener('click', closeOnOutsideClick);
            }
        };
        if (folderView) folderView.addEventListener('click', closeOnOutsideClick);

        const clearBtn = document.getElementById('downloads-folder-clear-history');
        if (clearBtn) clearBtn.onclick = (e) => {
            e.stopPropagation();
            this.clearDownloadHistory();
        };
    }

    filterDownloads(term) {
        const grid = document.getElementById('downloads-folder-grid');
        if (!grid) return;

        const lowerTerm = term.toLowerCase().trim();
        grid.querySelectorAll('.download-card').forEach(card => {
            const name   = (card.dataset.name   || '').toLowerCase();
            const source = (card.dataset.source || '').toLowerCase();
            const visible = !lowerTerm || name.includes(lowerTerm) || source.includes(lowerTerm);
            card.style.display = visible ? 'flex' : 'none';
        });
    }

    // ─── Core Update Dispatcher ───────────────────────────────────────────────

    updateDownloadManager() {
        const folderView = document.getElementById('downloads-folder-view');
        if (folderView && !folderView.classList.contains('hidden')) {
            this.patchDownloadsFolderView();   // ← in-place patch, no full re-render
        } else {
            // Legacy popup fallback
            const content = document.getElementById('download-manager-content');
            if (content) this.renderLegacyPopup(content);
        }
        this.updateDownloadManagerIcon();
    }

    // ─── Folder View: Full Render (on open only) ──────────────────────────────

    renderDownloadsFolderView() {
        const grid    = document.getElementById('downloads-folder-grid');
        const statsEl = document.getElementById('downloads-folder-stats');
        if (!grid) return;

        this.updateStatsEl(statsEl);

        if (this.downloads.length === 0) {
            grid.innerHTML = '<div class="downloads-empty" style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;padding:60px;color:rgba(255,255,255,0.5);font-size:18px;">No downloads</div>';
            return;
        }

        grid.innerHTML = this.downloads.map(d => this.buildCardHTML(d)).join('');
    }

    // ─── Folder View: In-place Patch (on every update) ───────────────────────
    // Mutates only the specific fields that change — no cards are destroyed,
    // so CSS :hover states are preserved and there is no blinking.

    patchDownloadsFolderView() {
        const grid    = document.getElementById('downloads-folder-grid');
        const statsEl = document.getElementById('downloads-folder-stats');
        if (!grid) return;

        this.updateStatsEl(statsEl);

        if (this.downloads.length === 0) {
            grid.innerHTML = '<div class="downloads-empty" style="grid-column:1/-1;display:flex;align-items:center;justify-content:center;padding:60px;color:rgba(255,255,255,0.5);font-size:18px;">No downloads</div>';
            return;
        }

        // If the grid currently shows the empty state, wipe it so cards render fresh
        if (grid.querySelector('.downloads-empty')) {
            grid.innerHTML = '';
        }

        const existingIds = new Set(
            [...grid.querySelectorAll('.download-card[data-id]')].map(el => el.dataset.id)
        );
        const currentIds = new Set(this.downloads.map(d => d.id));

        // Remove cards that no longer exist
        existingIds.forEach(id => {
            if (!currentIds.has(id)) {
                grid.querySelector(`.download-card[data-id="${id}"]`)?.remove();
            }
        });

        this.downloads.forEach((download, index) => {
            let card = grid.querySelector(`.download-card[data-id="${download.id}"]`);

            if (!card) {
                // New download — insert card at correct position
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = this.buildCardHTML(download);
                const newCard = tempDiv.firstElementChild;

                const cards = grid.querySelectorAll('.download-card');
                if (cards[index]) {
                    grid.insertBefore(newCard, cards[index]);
                } else {
                    grid.appendChild(newCard);
                }
                return; // Nothing else to patch for new cards
            }

            // Patch status class
            const statusClass = download.status.toLowerCase();
            const statusClasses = ['starting', 'downloading', 'paused', 'extracting', 'completed', 'failed', 'cancelled'];
            statusClasses.forEach(c => card.classList.toggle(c, c === statusClass));

            // Patch icon
            const iconEl = card.querySelector('.download-card-icon');
            if (iconEl) iconEl.innerHTML = this.getStatusIcon(download.status);

            // Patch name & source
            const nameEl = card.querySelector('.download-card-name');
            if (nameEl) nameEl.textContent = this.getDownloadName(download);

            const sourceEl = card.querySelector('.download-card-source');
            if (sourceEl) sourceEl.textContent = download.source_url || 'Unknown Source';

            // Patch time / progress info
            const timeEl = card.querySelector('.download-card-time');
            if (timeEl) timeEl.textContent = this.getTimeDisplay(download);

            const progressInfoEl = card.querySelector('.download-card-progress-info');
            const progressInfoText = this.getProgressInfo(download);
            if (progressInfoText) {
                if (progressInfoEl) {
                    progressInfoEl.textContent = progressInfoText;
                } else {
                    const metaEl = card.querySelector('.download-card-meta');
                    if (metaEl) {
                        const span = document.createElement('span');
                        span.className = 'download-card-progress-info';
                        span.textContent = progressInfoText;
                        metaEl.appendChild(span);
                    }
                }
            } else if (progressInfoEl) {
                progressInfoEl.remove();
            }

            // Patch progress bar
            const isActive = this.isActiveDownload(download);
            let progressBar = card.querySelector('.download-card-progress-bar');
            if (isActive) {
                const pct = this.getProgressPercent(download);
                if (!progressBar) {
                    progressBar = document.createElement('div');
                    progressBar.className = 'download-card-progress-bar';
                    progressBar.innerHTML = '<div class="download-card-progress-fill"></div>';
                    card.querySelector('.download-card-info')?.appendChild(progressBar);
                }
                const fill = progressBar.querySelector('.download-card-progress-fill');
                if (fill) fill.style.width = `${pct}%`;
            } else if (progressBar) {
                progressBar.remove();
            }

            // Patch error message
            let errorEl = card.querySelector('.download-error');
            if (download.status === 'Failed') {
                if (!errorEl) {
                    errorEl = document.createElement('div');
                    errorEl.className = 'download-error';
                    card.querySelector('.download-card-info')?.appendChild(errorEl);
                }
                errorEl.textContent = download.error || 'Download failed';
            } else if (errorEl) {
                errorEl.remove();
            }

            // Patch control buttons (only replace if controls actually changed)
            const controlsEl = card.querySelector('.download-card-controls');
            if (controlsEl) {
                const newControls = this.buildControlsHTML(download);
                if (controlsEl.innerHTML !== newControls) {
                    controlsEl.innerHTML = newControls;
                }
            }
        });
    }

    // ─── Build Helpers ────────────────────────────────────────────────────────

    getStatusIcon(status) {
        const icons = {
            Starting:    'hourglass_top',
            Downloading: 'download',
            Paused:      'pause',
            Extracting:  'folder_zip',
            Completed:   'check_circle',
            Failed:      'error',
            Cancelled:   'cancel',
        };
        return `<span class="material-icons">${icons[status] || 'help'}</span>`;
    }

    getDownloadName(download) {
        let name = 'Unknown Download';
        if (download.files?.length > 0) {
            name = download.files[0];
        } else if (download.source_url) {
            const parts = download.source_url.split('/');
            name = parts[parts.length - 1] || 'Unknown File';
        }
        return name.replace(/\.download$/, '').replace(/\.gguf$/, '');
    }

    isActiveDownload(download) {
        return ['Downloading', 'Starting', 'Paused', 'Extracting'].includes(download.status);
    }

    getProgressPercent(download) {
        if (download.status === 'Extracting') return download.extraction_progress || 0;
        if (download.status === 'Completed')  return 100;
        return download.progress || 0;
    }

    getProgressInfo(download) {
        if (download.status === 'Extracting') {
            return `${download.extraction_completed_files || 0}/${download.extraction_total_files || 0} files`;
        }
        if (this.isActiveDownload(download) && download.total_bytes > 0) {
            let info = `${this.formatFileSize(download.downloaded_bytes || 0)} / ${this.formatFileSize(download.total_bytes)}`;
            if (download.speed > 0) info += ` • ${this.formatFileSize(download.speed)}/s`;
            return info;
        }
        if (download.status === 'Completed' && download.total_bytes > 0) {
            return this.formatFileSize(download.total_bytes);
        }
        return '';
    }

    getTimeDisplay(download) {
        if (download.status === 'Downloading' && download.speed > 0 && download.total_bytes > 0) {
            const remaining = (download.total_bytes - (download.downloaded_bytes || 0)) / download.speed;
            return `ETA: ${this.formatTime(Math.ceil(remaining))}`;
        }
        if (download.status === 'Completed') return `Completed in ${this.formatTime(download.elapsed_time)}`;
        if (download.status === 'Failed' || download.status === 'Cancelled') return download.status;
        return `Running for ${this.formatTime(download.elapsed_time)}`;
    }

    buildControlsHTML(download) {
        if (download.status === 'Downloading' || download.status === 'Starting' || download.status === 'Extracting') {
            return `
                <button class="download-pause" onclick="downloadManager.pauseDownload('${download.id}')" title="Pause download">
                    <span class="material-icons">pause</span>
                </button>
                <button class="download-cancel" onclick="downloadManager.cancelDownload('${download.id}')" title="Cancel download">
                    <span class="material-icons">close</span>
                </button>`;
        }
        if (download.status === 'Paused') {
            return `
                <button class="download-resume" onclick="downloadManager.resumeDownload('${download.id}')" title="Resume download">
                    <span class="material-icons">play_arrow</span>
                </button>
                <button class="download-cancel" onclick="downloadManager.cancelDownload('${download.id}')" title="Cancel download">
                    <span class="material-icons">close</span>
                </button>`;
        }
        return '';
    }

    buildCardHTML(download) {
        const name         = this.getDownloadName(download);
        const source       = download.source_url || 'Unknown Source';
        const statusClass  = download.status.toLowerCase();
        const isActive     = this.isActiveDownload(download);
        const progressPct  = this.getProgressPercent(download);
        const progressInfo = this.getProgressInfo(download);
        const timeDisplay  = this.getTimeDisplay(download);

        const progressBarHTML = (isActive) ? `
            <div class="download-card-progress-bar">
                <div class="download-card-progress-fill" style="width: ${progressPct}%"></div>
            </div>` : '';

        const errorHTML = download.status === 'Failed'
            ? `<div class="download-error">${download.error || 'Download failed'}</div>` : '';

        return `
            <div class="download-card ${statusClass}" data-id="${download.id}" data-name="${name}" data-source="${source}">
                <div class="download-card-icon">${this.getStatusIcon(download.status)}</div>
                <div class="download-card-info">
                    <h3 class="download-card-name">${name}</h3>
                    <div class="download-card-details">
                        <span class="download-card-source">${source}</span>
                    </div>
                    <div class="download-card-meta">
                        <span class="download-card-time">${timeDisplay}</span>
                        ${progressInfo ? `<span class="download-card-progress-info">${progressInfo}</span>` : ''}
                    </div>
                    ${progressBarHTML}
                    ${errorHTML}
                </div>
                <div class="download-card-controls">
                    ${this.buildControlsHTML(download)}
                </div>
            </div>`;
    }

    updateStatsEl(statsEl) {
        if (!statsEl) return;
        const activeCount    = this.downloads.filter(d => this.isActiveDownload(d)).length;
        const completedCount = this.downloads.filter(d => d.status === 'Completed').length;

        if (this.downloads.length === 0)  statsEl.textContent = 'No downloads';
        else if (activeCount > 0)         statsEl.textContent = `${activeCount} active • ${completedCount} completed`;
        else                              statsEl.textContent = `${completedCount} completed`;
    }

    // ─── Legacy Popup Renderer ────────────────────────────────────────────────
    // Kept for backward compatibility only. Not used when folder view is open.

    renderLegacyPopup(content) {
        if (this.downloads.length === 0) {
            content.innerHTML = '<div class="no-downloads">No downloads</div>';
            return;
        }

        content.innerHTML = this.downloads.map(download => {
            const isActive     = this.isActiveDownload(download);
            const name         = this.getDownloadName(download);
            const source       = download.source_url || 'Unknown Source';
            const timeDisplay  = this.getTimeDisplay(download);
            const extracting   = download.status === 'Extracting';

            const progressBar = (isActive && download.status !== 'Failed') ? `
                <div class="download-progress">
                    <div class="download-progress-bar">
                        <div class="download-progress-fill" style="width: ${extracting ? (download.extraction_progress || 0) : (download.progress || 0)}%"></div>
                    </div>
                    <div class="download-progress-info">
                        <span class="download-progress-text">${extracting ? (download.extraction_progress || 0) : (download.progress || 0)}%</span>
                        ${download.status === 'Downloading' && download.total_bytes > 0 ? `<span class="download-size">${this.formatFileSize(download.downloaded_bytes || 0)} / ${this.formatFileSize(download.total_bytes)}</span>` : ''}
                        ${download.status === 'Downloading' && download.speed > 0    ? `<span class="download-speed">${this.formatFileSize(download.speed)}/s</span>` : ''}
                        ${download.status === 'Paused'      ? '<span class="download-paused-text">Paused</span>'     : ''}
                        ${extracting                        ? '<span class="download-extracting-text">Extracting</span>' : ''}
                    </div>
                    ${download.status === 'Downloading' && download.total_files > 1 ? `
                        <div class="download-files-progress">
                            <span class="files-progress">${download.files_completed || 0}/${download.total_files} files</span>
                            ${download.current_file ? `<span class="current-file">Downloading: ${download.current_file}</span>` : ''}
                        </div>` : ''}
                    ${extracting && download.extraction_total_files ? `
                        <div class="download-files-progress">
                            <span class="files-progress">${download.extraction_completed_files || 0}/${download.extraction_total_files} files</span>
                            ${download.current_extracting_file ? `<span class="current-file">Extracting: ${download.current_extracting_file}</span>` : ''}
                        </div>` : ''}
                </div>` : '';

            const errorMsg = download.status === 'Failed'
                ? `<div class="download-error">${download.error || 'Download failed'}</div>` : '';

            return `
                <div class="download-item ${download.status}">
                    <div class="download-info">
                        <div class="download-header">
                            <div class="download-icon">${this.getStatusIcon(download.status)}</div>
                            <div class="download-title">
                                <span class="download-name">${name}</span>
                                <span class="download-model">${source}</span>
                            </div>
                        </div>
                        <div class="download-controls">${this.buildControlsHTML(download)}</div>
                        <div class="download-details">
                            <span class="download-time">${timeDisplay}</span>
                        </div>
                        ${progressBar}
                        ${errorMsg}
                    </div>
                </div>`;
        }).join('');
    }

    // ─── Formatters ───────────────────────────────────────────────────────────

    formatTime(seconds) {
        if (!seconds || seconds < 0) return '0s';
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const secs    = seconds % 60;
        if (minutes < 60) return `${minutes}m ${secs}s`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h ${minutes % 60}m`;
    }

    formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k     = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i     = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }
}