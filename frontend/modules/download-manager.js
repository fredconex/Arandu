// Download Management Module
class DownloadManager {
    constructor(desktop) {
        this.desktop = desktop;
        this.downloads = [];
        this.downloadManagerVisible = false;
        this.completedDownloads = new Set(); // Track completed downloads to prevent multiple refreshes
        this.lastDownloadsJson = ''; // Store the last known state of downloads
        
        // Desktop refresh debouncing
        this.desktopRefreshTimeout = null;
        
        // Initialize Tauri API access
        this.invoke = null;
        this.initTauriAPI();
        
       // Start monitoring Tauri downloads
       this.startTauriDownloadMonitoring();
       this.listenForDownloadCompletion();
       
       // Update the download manager icon on initialization
       setTimeout(() => {
           this.updateDownloadManagerIcon();
       }, 100);
   }
    
    initTauriAPI() {
        try {
            if (window.__TAURI__ && window.__TAURI__.core) {
                this.invoke = window.__TAURI__.core.invoke;
                console.log('Tauri API initialized in DownloadManager');
            } else {
                console.warn('Tauri API not available yet, will retry when needed');
            }
        } catch (error) {
            console.error('Failed to initialize Tauri API:', error);
        }
    }
    
    getInvoke() {
        if (!this.invoke) {
            this.initTauriAPI();
        }
        return this.invoke;
    }
    
    // Debounced desktop refresh to prevent multiple simultaneous refreshes
    debouncedDesktopRefresh() {
        if (this.desktopRefreshTimeout) {
            clearTimeout(this.desktopRefreshTimeout);
        }
        
        this.desktopRefreshTimeout = setTimeout(() => {
            console.log('Refreshing desktop models after download completion');
            this.desktop.loadModels(false); // Don't use animations for automatic refreshes
            // Also update the download manager icon
            this.updateDownloadManagerIcon();
            this.desktopRefreshTimeout = null;
        }, 500); // Debounce to prevent rapid refreshes
    }
    
    
   listenForDownloadCompletion() {
       // Wait for Tauri to be available
       const setupEventListeners = () => {
           if (window.__TAURI__ && window.__TAURI__.event) {
               console.log('Setting up download event listeners...');
               
               window.__TAURI__.event.listen('download-complete', () => {
                   console.log('Download complete event received, refreshing desktop...');
                   this.debouncedDesktopRefresh();
                   // Also update the download manager icon
                   this.updateDownloadManagerIcon();
               });
               
               // Listen for real-time progress updates
               window.__TAURI__.event.listen('download-progress', (event) => {
                   console.log('Download progress event received:', event.payload);
                   console.log('Current downloads before update:', this.downloads.length);
                   this.updateDownloadProgress(event.payload);
                   console.log('Current downloads after update:', this.downloads.length);
               });
               
               // Listen for extraction progress updates
               window.__TAURI__.event.listen('extraction-progress', (event) => {
                   console.log('Extraction progress event received:', event.payload);
                   this.updateExtractionProgress(event.payload);
               });
               
               // Listen for file deletion events
               window.__TAURI__.event.listen('file-deleted', () => {
                   console.log('File deleted event received, refreshing desktop...');
                   this.debouncedDesktopRefresh();
                   // Also update the download manager icon
                   this.updateDownloadManagerIcon();
               });
               
               window.__TAURI__.event.listen('open-download-manager', () => {
                   console.log('Received open-download-manager event');
                   this.showDownloadManager();
               });
               
               console.log('Download event listeners set up successfully');
           } else {
               console.log('Tauri not available yet, retrying in 100ms...');
               setTimeout(setupEventListeners, 100);
           }
       };
       
       setupEventListeners();
   }

    // Update extraction progress in real-time
    updateExtractionProgress(extractionData) {
        console.log('Updating extraction progress for ID:', extractionData.download_id);
        console.log('Extraction progress:', extractionData.extraction_progress);
        console.log('Extraction total files:', extractionData.extraction_total_files);
        console.log('Extraction completed files:', extractionData.extraction_completed_files);
        console.log('Current extracting file:', extractionData.current_extracting_file);
        
        // Find and update the download in our local array
        const downloadIndex = this.downloads.findIndex(d => d.id === extractionData.download_id);
        if (downloadIndex !== -1) {
            console.log('Found existing download at index:', downloadIndex);
            // Update extraction progress fields
            this.downloads[downloadIndex].extraction_progress = extractionData.extraction_progress;
            this.downloads[downloadIndex].extraction_total_files = extractionData.extraction_total_files;
            this.downloads[downloadIndex].extraction_completed_files = extractionData.extraction_completed_files;
            this.downloads[downloadIndex].current_extracting_file = extractionData.current_extracting_file;
        }
        
        this.updateDownloadManager();
    }

    // Update download progress in real-time
    updateDownloadProgress(updatedDownload) {
        console.log('Updating download progress for ID:', updatedDownload.id);
        console.log('Download status:', updatedDownload.status);
        console.log('Download progress:', updatedDownload.progress);
        
        // Find and update the download in our local array
        const downloadIndex = this.downloads.findIndex(d => d.id === updatedDownload.id);
        if (downloadIndex !== -1) {
            console.log('Found existing download at index:', downloadIndex);
            this.downloads[downloadIndex] = updatedDownload;
        } else {
            console.log('Adding new download to array');
            // If not found, add it to the array
            this.downloads.push(updatedDownload);
        }
        
        this.updateDownloadManager();
    }

    // Start monitoring Tauri downloads
    startTauriDownloadMonitoring() {
        const monitorDownloads = async () => {
            try {
                const invoke = this.getInvoke();
                if (!invoke) {
                    console.warn('Tauri invoke not available for monitoring');
                    // Still update the icon even if invoke is not available
                    this.updateDownloadManagerIcon();
                    return;
                }
                
                const allDownloads = await invoke('get_all_downloads_and_history');
               const currentDownloadsJson = JSON.stringify(allDownloads);
               if (currentDownloadsJson !== this.lastDownloadsJson) {
                   this.downloads = allDownloads;
                   this.updateDownloadManager();
                   this.lastDownloadsJson = currentDownloadsJson;
               } else {
                   // Even if downloads haven't changed, still update the icon state
                   this.updateDownloadManagerIcon();
               }
                
            } catch (error) {
                console.error('Error monitoring Tauri downloads:', error);
                // Still update the icon even if there's an error
                this.updateDownloadManagerIcon();
            }
        };
        
        // Monitor every 2000ms (increased since we now have real-time updates)
        console.log('Starting Tauri download monitoring every 2000ms');
        setInterval(monitorDownloads, 2000);
    }
    
    

    // Download Control Methods
    async pauseDownload(downloadId) {
        try {
            const invoke = this.getInvoke();
            if (invoke) {
                this.downloads = await invoke('pause_download', { downloadId: downloadId });
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
                this.downloads = await invoke('resume_download', { downloadId: downloadId });
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
                this.downloads = await invoke('cancel_download', { downloadId: downloadId });
                this.updateDownloadManager();
            }
        } catch (error) {
            console.error('Error cancelling download:', error);
        }
    }


    // UI Management Methods
    toggleDownloadHistory() {
        // Toggle the unified download manager
        if (this.downloadManagerVisible) {
            this.hideDownloadManager();
        } else {
            // Hide system info popup if visible
            if (this.desktop) {
                this.desktop.hideSystemInfoPopup();
            }
            this.showDownloadManager();
        }
    }
    
    // Check if there are any active downloads (excluding paused downloads)
    hasActiveDownloads() {
        return this.downloads.some(download => 
            download.status === 'Downloading' || 
            download.status === 'Starting' || 
            download.status === 'Extracting'
        );
    }
    
    // Update the download manager icon state based on active downloads
    updateDownloadManagerIcon() {
        const downloadIcon = document.getElementById('downloads-dock-icon');
        if (!downloadIcon) return;

        const activeDownloads = this.downloads.filter(download => 
            download.status === 'Downloading' || 
            download.status === 'Starting' || 
            download.status === 'Extracting'
        );

        if (activeDownloads.length > 0) {
            downloadIcon.classList.add('pulse');
            
            // Calculate overall progress
            let totalProgress = 0;
            activeDownloads.forEach(d => {
                if (d.status === 'Extracting') {
                    totalProgress += (d.extraction_progress || 0);
                } else {
                    totalProgress += (d.progress || 0);
                }
            });
            const avgProgress = activeDownloads.length > 0 ? totalProgress / activeDownloads.length : 0;

            // Update dock progress bar
            const progressContainer = downloadIcon.querySelector('.dock-progress-container');
            const progressBar = downloadIcon.querySelector('.dock-progress-bar');
            
            if (progressContainer && progressBar) {
                progressContainer.classList.remove('hidden');
                progressBar.style.width = `${avgProgress}%`;
            }
        } else {
            downloadIcon.classList.remove('pulse');
            
            // Hide dock progress bar
            const progressContainer = downloadIcon.querySelector('.dock-progress-container');
            if (progressContainer) {
                progressContainer.classList.add('hidden');
            }
        }
    }
    
    showDownloadManager() {
        if (this.downloadManagerVisible) return;
        
        // Update button active state
        if (this.desktop) {
            this.desktop.updateTaskbarButtonState('downloads-dock-icon', true);
            // Update focused state for downloads dock icon
            this.desktop.updateDockFocusedState('download-history-window');
        }
        
        const existingManager = document.getElementById('download-manager');
        if (existingManager) {
            existingManager.classList.remove('hidden');
            this.downloadManagerVisible = true;
            // Update the icon state when showing the manager
            this.updateDownloadManagerIcon();
            return;
        }
        
        const downloadManager = document.createElement('div');
        downloadManager.id = 'download-manager';
        downloadManager.className = 'download-manager';
        downloadManager.innerHTML = `
            <div class="download-manager-header">
                <h4>Downloads</h4>
                <div class="download-manager-controls">
                    <button class="download-history-clear" onclick="downloadManager.clearDownloadHistory()" title="Clear completed downloads">Clear</button>
                    <button class="download-manager-close" onclick="downloadManager.hideDownloadManager()">×</button>
                </div>
            </div>
            <div class="download-manager-content" id="download-manager-content">
                <!-- Downloads will be populated here -->
            </div>
        `;
        
        document.body.appendChild(downloadManager);
        this.downloadManagerVisible = true;
        this.updateDownloadManager();
    }
    
    hideDownloadManager() {
        // Update button active state
        if (this.desktop) {
            this.desktop.updateTaskbarButtonState('downloads-dock-icon', false);
        }
        
        const manager = document.getElementById('download-manager');
        if (manager) {
            manager.classList.add('hidden');
        }
        this.downloadManagerVisible = false;
        
        // Update the icon state even when hiding the manager
        this.updateDownloadManagerIcon();
    }
    
    updateDownloadManager() {
        const content = document.getElementById('download-manager-content');
        if (!content) return;

        if (this.downloads.length === 0) {
            content.innerHTML = '<div class="no-downloads">No downloads</div>';
            return;
        }

        // Update the download manager icon state
        this.updateDownloadManagerIcon();

       const downloadsHTML = this.downloads.map(download => {
           const statusIcon = {
               'Starting': '<span class="material-icons">hourglass_top</span>',
                'Downloading': '<span class="material-icons">download</span>',
                'Paused': '<span class="material-icons">pause</span>',
                'Extracting': '<span class="material-icons">folder_zip</span>',
                'Completed': '<span class="material-icons">check_circle</span>',
                'Failed': '<span class="material-icons">error</span>',
                'Cancelled': '<span class="material-icons">cancel</span>',
            }[download.status] || '<span class="material-icons">help</span>';

            const isActiveDownload = download.status === 'Downloading' || download.status === 'Starting' || download.status === 'Paused' || download.status === 'Extracting';

            const progressBar = (isActiveDownload && download.status !== 'Failed') ? `
                <div class="download-progress">
                    <div class="download-progress-bar">
                        <div class="download-progress-fill" style="width: ${download.status === 'Extracting' ? (download.extraction_progress || 0) : (download.progress || 0)}%"></div>
                    </div>
                    <div class="download-progress-info">
                        <span class="download-progress-text">${download.status === 'Extracting' ? (download.extraction_progress || 0) : (download.progress || 0)}%</span>
                        ${download.status === 'Downloading' && download.total_bytes > 0 ? `<span class="download-size">${this.formatFileSize(download.downloaded_bytes || 0)} / ${this.formatFileSize(download.total_bytes)}</span>` : ''}
                        ${download.status === 'Downloading' && download.speed > 0 ? `<span class="download-speed">${this.formatFileSize(download.speed)}/s</span>` : ''}
                        ${download.status === 'Paused' ? `<span class="download-paused-text">Paused</span>` : ''}
                        ${download.status === 'Extracting' ? `<span class="download-extracting-text">Extracting</span>` : ''}
                    </div>
                    ${download.status === 'Downloading' && download.total_files > 1 ? `
                        <div class="download-files-progress">
                            <span class="files-progress">${download.files_completed || 0}/${download.total_files} files</span>
                            ${download.current_file ? `<span class="current-file">Downloading: ${download.current_file}</span>` : ''}
                        </div>
                    ` : ''}
                    ${download.status === 'Extracting' && download.extraction_total_files ? `
                        <div class="download-files-progress">
                            <span class="files-progress">${download.extraction_completed_files || 0}/${download.extraction_total_files} files</span>
                            ${download.current_extracting_file ? `<span class="current-file">Extracting: ${download.current_extracting_file}</span>` : ''}
                        </div>
                    ` : ''}

                </div>
            ` : '';

            const errorMsg = download.status === 'Failed' ? `
                <div class="download-error">${download.error || 'Download failed'}</div>
            ` : '';

            let timeDisplay;
            if (download.status === 'Downloading' && download.speed > 0 && download.total_bytes > 0) {
                const remainingBytes = download.total_bytes - (download.downloaded_bytes || 0);
                const remainingSeconds = remainingBytes / download.speed;
                timeDisplay = `ETA: ${this.formatTime(Math.ceil(remainingSeconds))}`;
            } else if (download.status === 'Completed') {
                timeDisplay = `Completed in ${this.formatTime(download.elapsed_time)}`;
            } else {
                timeDisplay = `Running for ${this.formatTime(download.elapsed_time)}`;
            }

            // Extract meaningful information from the download
            let downloadName = 'Unknown Download';
            let downloadSource = download.source_url || 'Unknown Source';
            
            // Try to extract filename from URL or files
            if (download.files && download.files.length > 0) {
                downloadName = download.files[0];
            } else if (download.source_url) {
                // Extract filename from URL
                const urlParts = download.source_url.split('/');
                downloadName = urlParts[urlParts.length - 1] || 'Unknown File';
            }
            
            // Clean up the name for display
            downloadName = downloadName.replace(/\.download$/, '').replace(/\.gguf$/, '');

            return `
                <div class="download-item ${download.status}">
                    <div class="download-info">
                        <div class="download-header">
                            <div class="download-icon">${statusIcon}</div>
                            <div class="download-title">
                                <span class="download-name">${downloadName}</span>
                                <span class="download-model">${downloadSource}</span>
                            </div>
                        </div>
                        <div class="download-controls">
                            ${(() => {
                                if (isActiveDownload) {
                                    if (download.status === 'Downloading' || download.status === 'Starting' || download.status === 'Extracting') {
                                        return `
                                            <button class="download-pause" onclick="downloadManager.pauseDownload('${download.id}')" title="Pause download">
                                                <span class="material-icons">pause</span>
                                            </button>
                                            <button class="download-cancel" onclick="downloadManager.cancelDownload('${download.id}')" title="Cancel download">
                                                <span class="material-icons">close</span>
                                            </button>
                                        `;
                                    } else if (download.status === 'Paused') {
                                        return `
                                            <button class="download-resume" onclick="downloadManager.resumeDownload('${download.id}')" title="Resume download">
                                                <span class="material-icons">play_arrow</span>
                                            </button>
                                            <button class="download-cancel" onclick="downloadManager.cancelDownload('${download.id}')" title="Cancel download">
                                                <span class="material-icons">close</span>
                                            </button>
                                        `;
                                    }
                                }
                                return '';
                            })()}
                        </div>
                        <div class="download-details">
                            <span class="download-time">${timeDisplay}</span>
                        </div>
                        ${progressBar}
                        ${errorMsg}
                    </div>
                </div>
            `;
        }).join('');

        content.innerHTML = downloadsHTML;
    }

    async clearDownloadHistory() {
        try {
            const invoke = this.getInvoke();
            if (invoke) {
                this.downloads = await invoke('clear_download_history');
                this.updateDownloadManager();
            }
        } catch (error) {
            console.error('Error clearing download history:', error);
        }
    }

    // Generic download methods
    async downloadFromUrl(url, destinationFolder, extract = false) {
        try {
            const invoke = this.getInvoke();
            if (invoke) {
                const result = await invoke('download_from_url', { 
                    url, 
                    destinationFolder, 
                    extract 
                });
                console.log('Download started:', result);
                return result;
            }
        } catch (error) {
            console.error('Error starting download:', error);
            throw error;
        }
    }


    
    formatTime(seconds) {
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}