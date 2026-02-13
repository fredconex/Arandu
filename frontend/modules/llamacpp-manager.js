// Llama.cpp Releases Management Module
class LlamaCppReleasesManager {
    constructor(desktop) {
        this.desktop = desktop;
        
        // Initialize Tauri API access
        this.invoke = null;
        this.initTauriAPI();

        // UI state
        // Detect current platform and default to it
        const userAgent = navigator.userAgent.toLowerCase();
        let defaultPlatform = 'windows';
        if (userAgent.includes('linux')) defaultPlatform = 'linux';
        else if (userAgent.includes('mac') || userAgent.includes('darwin')) defaultPlatform = 'macos';
        else if (userAgent.includes('win')) defaultPlatform = 'windows';
        this.platformFilter = defaultPlatform;
        this.lastReleases = null; // cache latest fetched releases for re-rendering
    }
    
    initTauriAPI() {
        try {
            if (window.__TAURI__ && window.__TAURI__.core) {
                this.invoke = window.__TAURI__.core.invoke;
                console.log('Tauri API initialized in LlamaCppReleasesManager');
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

    // Escape a string for safe inclusion inside single-quoted JS in HTML attributes
    // - Escape backslashes first, then single quotes
    // - Remove newlines to avoid breaking attributes
    escapeForOnclick(str) {
        if (str == null) return '';
        return String(str)
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'")
            .replace(/\r?\n/g, ' ');
    }

    // Normalize filesystem paths for reliable matching on Windows
    normalizePath(pathValue) {
        if (!pathValue || typeof pathValue !== 'string') return '';
        let normalized = pathValue.replace(/\\/g, '/');
        normalized = normalized.replace(/\/+$/g, '');
        return normalized.toLowerCase();
    }

    switchTopTab(tabButton, tabName) {
        const tabs = document.querySelectorAll('.llamacpp-top-tabs .top-tab');
        tabs.forEach(tab => tab.classList.remove('active'));
        if (tabButton) tabButton.classList.add('active');

        const releasesEl = document.getElementById('llamacpp-manager-content');
        const installedEl = document.getElementById('llamacpp-installed-content');
        if (!releasesEl || !installedEl) return;
        if (tabName === 'releases') {
            releasesEl.classList.remove('hidden');
            installedEl.classList.add('hidden');
        } else {
            releasesEl.classList.add('hidden');
            installedEl.classList.remove('hidden');
            this.loadInstalledVersions();
        }
    }

    async loadInstalledVersions() {
        const container = document.getElementById('llamacpp-installed-content');
        if (!container) return;
        try {
            container.innerHTML = '<div class="loading-installed">Loading installed versions...</div>';
            const invoke = this.getInvoke();
            if (!invoke) throw new Error('Tauri API not available');
            const [versions, cfg] = await Promise.all([
                invoke('list_llamacpp_versions'),
                invoke('get_config')
            ]);
            this.renderInstalledVersions(versions, cfg);
            this.updateLatestInstalledBuildDisplay();
        } catch (e) {
            console.error('Failed to load installed versions:', e);
            container.innerHTML = `<div class="error-installed">${e?.message || 'Failed to load installed versions'}</div>`;
        }
    }

    renderInstalledVersions(versions, cfg) {
        const container = document.getElementById('llamacpp-installed-content');
        if (!container) return;
        if (!Array.isArray(versions) || versions.length === 0) {
            container.innerHTML = '<div class="no-installed">No versions installed yet.</div>';
            return;
        }
        
        // Group versions by base version (ignoring backend suffix)
        const versionGroups = {};
        versions.forEach(v => {
            // Handle both new nested format (b7779-cuda) and old flat format
            const baseName = v.name.includes('-') ? v.name.split('-')[0] : v.name;
            if (!versionGroups[baseName]) {
                versionGroups[baseName] = [];
            }
            versionGroups[baseName].push(v);
        });
        
        // Sort version groups by numeric version descending
        const extractVersionNumber = (name) => {
            const match = String(name).match(/(\d+)/);
            return match ? parseInt(match[1], 10) : -Infinity;
        };
        const sortedGroupNames = Object.keys(versionGroups).sort((a, b) => 
            extractVersionNumber(b) - extractVersionNumber(a)
        );

        const activePath = cfg?.active_executable_folder || null;
        const activeNorm = this.normalizePath(activePath);
        
        const rows = sortedGroupNames.map(baseName => {
            const groupVersions = versionGroups[baseName];
            
            // Sort backends within group: CPU first, then others alphabetically
            groupVersions.sort((a, b) => {
                const aBackend = a.backend_type || 'cpu';
                const bBackend = b.backend_type || 'cpu';
                
                if (aBackend === 'cpu' && bBackend !== 'cpu') return -1;
                if (bBackend === 'cpu' && aBackend !== 'cpu') return 1;
                
                return aBackend.localeCompare(bBackend);
            });
            
            return `
                <div class="version-group">
                    <div class="version-group-header">
                        <h4>${baseName}</h4>
                        <span class="version-count">${groupVersions.length} backend${groupVersions.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="backend-list">
                        ${groupVersions.map(v => {
                            const isActive = !!activeNorm && this.normalizePath(v.path) === activeNorm;
                            const backendType = v.backend_type || 'cpu';
                            const backendDisplay = this.getBackendDisplayName(backendType);
                            const status = isActive ? '<span class="badge active">Active</span>' : 
                                         (v.has_server ? '<span class="badge ok">Ready</span>' : 
                                         '<span class="badge warn">Missing server</span>');
                            const escapedPath = this.escapeForOnclick(v.path || '');
                            
                            const isReady = v.has_server;
                            const activateButtonDisabled = !isReady;
                            const activateButtonClass = `installed-activate${activateButtonDisabled ? ' disabled' : ''}`;
                            const activateButtonTitle = activateButtonDisabled ? 
                                'Cannot activate: server executable is missing' : 
                                `Set ${backendDisplay} as active backend`;

                            return `
                                <div class="backend-item ${isActive ? 'active' : ''}">
                                    <div class="backend-info">
                                        <div class="backend-name">
                                            <span class="backend-type">${backendDisplay}</span>
                                        </div>
                                        <div class="backend-path">${v.path}</div>
                                    </div>
                                    <div class="backend-status">
                                        ${isActive ? '' : (v.has_server ? '' : '<span class="badge warn">Missing server</span>')}
                                    </div>
                                    <div class="backend-activate">
                                        ${isActive ? '<span class="badge active">Active</span>' : `
                                            <span
                                                class="badge activate ${activateButtonDisabled ? 'disabled' : ''}"
                                                onclick="if(!${activateButtonDisabled}) { llamacppReleasesManager.setActiveVersion('${escapedPath}'); }"
                                                title="${activateButtonTitle}">
                                                Activate
                                            </span>
                                        `}
                                    </div>
                                    <div class="backend-actions">
                                        <button 
                                            class="installed-delete" 
                                            onclick="llamacppReleasesManager.deleteVersion('${escapedPath}')"
                                            title="Delete this backend">
                                            <span class="material-icons">delete</span>
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = `
            <div class="installed-list">${rows}</div>
        `;
    }

    getBackendDisplayName(backendType) {
        const displayNames = {
            'cpu': 'CPU',
            'cuda': 'CUDA',
            'rocm': 'ROCm',
            'vulkan': 'Vulkan',
            'opencl': 'OpenCL',
            'metal': 'Metal'
        };
        return displayNames[backendType] || backendType.toUpperCase();
    }

    async setActiveVersion(path) {
        try {
            const invoke = this.getInvoke();
            if (!invoke) throw new Error('Tauri API not available');
            await invoke('set_active_llamacpp_version', { path });
            this.loadInstalledVersions();
            this.updateLatestInstalledBuildDisplay();
        } catch (e) {
            alert(`Failed to set active version: ${e.message || e}`);
        }
    }

    async deleteVersion(path) {
        let confirmed = false;
        try {
            confirmed = await ModalDialog.showConfirmation({
                title: 'Delete Build',
                message: 'Are you sure you want to delete this installed version? This action cannot be undone.',
                confirmText: 'Delete',
                cancelText: 'Cancel',
                type: 'danger'
            });
        } catch (e) {
            // Fallback if modal not available
            confirmed = confirm('Delete this installed version folder?');
        }
        if (!confirmed) return;
        try {
            const invoke = this.getInvoke();
            if (!invoke) throw new Error('Tauri API not available');
            await invoke('delete_llamacpp_version', { path });
            this.loadInstalledVersions();
            this.updateLatestInstalledBuildDisplay();
        } catch (e) {
            alert(`Failed to delete version: ${e.message || e}`);
        }
    }
    // Llama.cpp release methods
    async getLlamaCppReleases() {
        try {
            const invoke = this.getInvoke();
            if (!invoke) {
                // Tauri API not ready yet, try to initialize it
                this.initTauriAPI();
                // Wait a bit and try again
                await new Promise(resolve => setTimeout(resolve, 100));
                const retryInvoke = this.getInvoke();
                if (!retryInvoke) {
                    throw new Error('Tauri API not available. Please try again in a moment.');
                }
                const releases = await retryInvoke('get_llamacpp_releases');
                return releases;
            }
            const releases = await invoke('get_llamacpp_releases');
            return releases;
        } catch (error) {
            console.error('Error fetching llama.cpp releases:', error);
            // Provide a more user-friendly error message
            if (error.message && error.message.includes('Tauri API not available')) {
                throw new Error('Application not ready yet. Please try again in a moment.');
            }
            throw error;
        }
    }

    async downloadLlamaCppAsset(asset) {
        try {
            const invoke = this.getInvoke();
            if (invoke) {
                const result = await invoke('download_llamacpp_asset', { asset });
                console.log('Llama.cpp asset download started:', result);
                return result;
            }
        } catch (error) {
            console.error('Error downloading llama.cpp asset:', error);
            throw error;
        }
    }

    async handleAssetDownload(assetId, name, downloadUrl, size, tagName) {
        const asset = {
            id: assetId, // Pass the assetId
            name: name,
            download_url: downloadUrl,
            size: size,
            content_type: 'application/octet-stream' // Default content type since GitHub API sometimes returns unexpected values
        };
        
        // Detect backend type from asset name
        const backendType = this.detectBackendType(name);
        
        // Choose version folder using tag name and backend type
        let baseVersion = (tagName || '').toString().trim().replace(/^v/, '');
        if (!baseVersion) {
            baseVersion = (name || '').replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._-]/g, '_');
        }
        
        // Create nested folder structure: baseVersion/backendType
        let versionFolder = `${baseVersion}/${backendType}`;

        try {
            const invoke = this.getInvoke();
            if (!invoke) throw new Error('Tauri API not available');
            await invoke('download_llamacpp_asset_to_version', { asset, versionFolder: versionFolder });
            console.log(`Started download of ${name} (${backendType}) to ${versionFolder}`);
            // Auto-switch to Installed tab only when the downloaded version becomes Ready
            this.autoSwitchWhenVersionReady(versionFolder);
        } catch (error) {
            console.error(`Failed to start download of ${name}:`, error);
            alert(`Failed to start download: ${error.message}`);
        }
    }

    detectBackendType(assetName) {
        const name = assetName.toLowerCase();
        
        if (name.includes('cuda') || name.includes('cudart')) {
            return 'cuda';
        } else if (name.includes('rocm') || name.includes('hip')) {
            return 'rocm';
        } else if (name.includes('vulkan')) {
            return 'vulkan';
        } else if (name.includes('opencl')) {
            return 'opencl';
        } else if (name.includes('metal')) {
            return 'metal';
        } else {
            return 'cpu';
        }
    }

    // Start listening/polling, and switch to Installed when the specific version is detected as Ready
    async autoSwitchWhenVersionReady(versionFolder, timeoutMs = 180000) {
        const start = Date.now();
        const invoke = this.getInvoke();
        if (!invoke) return;

        const matchesTarget = (v) => {
            const folderName = (v?.name || (v?.path ? v.path.split(/[\\/]/).pop() : '') || '').trim();
            // Check if the installed version name matches the expected versionFolder format (e.g., "b7779/cpu")
            // Or if the base name matches the version part (for cross-checking)
            const normalizedExpected = String(versionFolder).trim().toLowerCase();
            const normalizedActual = folderName.toLowerCase();
            
            // Direct match of folder name
            if (normalizedActual === normalizedExpected) {
                return true;
            }
            
            // Check if installed version base name matches the expected version part
            // e.g., installed version name is "b7779-cpu" and expected folder is "b7779/cpu"
            const installedBaseName = v.name.includes('-') ? v.name.split('-')[0] : v.name;
            const expectedVersionPart = normalizedExpected.split('/')[0];
            
            return installedBaseName.toLowerCase() === expectedVersionPart;
        };

        const check = async () => {
            try {
                const [versions] = await Promise.all([
                    invoke('list_llamacpp_versions')
                ]);
                const found = Array.isArray(versions) ? versions.find(v => matchesTarget(v) && v.has_server) : null;
                if (found) {
                    const installedTab = document.querySelector('.llamacpp-top-tabs .top-tab[data-top-tab="installed"]');
                    if (installedTab) this.switchTopTab(installedTab, 'installed');
                    
                    // Refresh the releases to show the "Installed" tag
                    this.loadLlamaCppReleases();
                    
                    // Update the latest installed build display
                    this.updateLatestInstalledBuildDisplay();
                    
                    return true;
                }
            } catch (e) {
                // ignore transient errors
            }
            return false;
        };

        // Quick checks after a download-complete event; also poll until timeout
        let intervalId = null;
        const stop = () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } };

        // Attach one-time listener to react promptly when download completes
        if (window.__TAURI__ && window.__TAURI__.event) {
            const unlistenPromise = window.__TAURI__.event.listen('download-complete', async () => {
                if (await check()) {
                    try { const unlisten = await unlistenPromise; if (typeof unlisten === 'function') unlisten(); } catch (_) {}
                    stop();
                }
            });
        }

        // Begin polling until timeout
        intervalId = setInterval(async () => {
            if (Date.now() - start > timeoutMs) {
                stop();
                return;
            }
            if (await check()) stop();
        }, 2000);
    }

    // Toggle release expansion when clicking on header
    async toggleReleaseExpansion(headerElement) {
        const releaseItem = headerElement.closest('.release-item');
        if (releaseItem) {
            const isExpanded = releaseItem.classList.contains('expanded');
            releaseItem.classList.toggle('expanded');
            
            // If expanding and release has no body, try to load commit info
            if (!isExpanded && releaseItem.classList.contains('expanded')) {
                const releaseTag = releaseItem.querySelector('.release-tag').textContent;
                const releaseBody = releaseItem.querySelector('.release-body');
                
                // Check if we need to load commit info
                if (releaseBody && (releaseBody.textContent.trim() === 'No release notes available for this release.' || releaseBody.textContent.trim() === '')) {
                    await this.loadCommitInfoForRelease(releaseItem, releaseTag);
                }
            }
        }
    }

    // Load commit info for a specific release
    async loadCommitInfoForRelease(releaseItem, tagName) {
        try {
            const releaseBody = releaseItem.querySelector('.release-body');
            if (!releaseBody) return;
            
            // Show loading state
            releaseBody.innerHTML = '<div class="loading-commit-info">Loading commit information...</div>';
            
            const invoke = this.getInvoke();
            if (!invoke) {
                throw new Error('Tauri API not available');
            }
            
            // Fetch commit info using the tag name
            const commitInfo = await invoke('get_llamacpp_commit_info', { tagName: tagName });
            
            // Update the release body with commit info
            releaseBody.innerHTML = this.formatCommitInfo(commitInfo);
            
        } catch (error) {
            console.error('Error loading commit info for release:', error);
            const releaseBody = releaseItem.querySelector('.release-body');
            if (releaseBody) {
                releaseBody.innerHTML = '<div class="error-commit-info">Failed to load commit information. Please try again later.</div>';
            }
        }
    }

    // Switch between release tabs
    switchReleaseTab(tabButton, tabName) {
        const releaseItem = tabButton.closest('.release-item');
        if (!releaseItem) return;

        // Remove active class from all tabs and panes in this release
        const allTabs = releaseItem.querySelectorAll('.release-tab');
        const allPanes = releaseItem.querySelectorAll('.release-tab-pane');
        
        allTabs.forEach(tab => tab.classList.remove('active'));
        allPanes.forEach(pane => pane.classList.remove('active'));

        // Add active class to clicked tab and corresponding pane
        tabButton.classList.add('active');
        const targetPane = releaseItem.querySelector(`[data-pane="${tabName}"]`);
        if (targetPane) {
            targetPane.classList.add('active');
        }
    }

    // Show llama.cpp release manager
    showLlamaCppManager() {
        const windowId = 'llamacpp-manager-window';
        
        // Mark dock icon as active
        const llamacppDockIcon = document.getElementById('llamacpp-dock-icon');
        
        // Check if window already exists
        if (this.desktop.windows.has(windowId)) {
            const existingWindow = this.desktop.windows.get(windowId);
            // Toggle window visibility
            if (existingWindow.classList.contains('hidden') || existingWindow.style.display === 'none') {
                existingWindow.style.display = 'block';
                existingWindow.classList.remove('hidden');
                existingWindow.style.zIndex = ++this.desktop.windowZIndex;
                // Update focused state
                this.desktop.updateDockFocusedState(windowId);
                if (llamacppDockIcon) {
                    llamacppDockIcon.classList.add('active');
                }
            } else {
                existingWindow.classList.add('hidden');
                if (llamacppDockIcon) {
                    llamacppDockIcon.classList.remove('active');
                }
            }
            return;
        }

        // Mark dock icon as active for new window
        if (llamacppDockIcon) {
            llamacppDockIcon.classList.add('active');
        }

        const content = `
            <div class="llamacpp-manager-container">
                <div class="llamacpp-manager-header">
                    <div class="llamacpp-manager-info">
                        <p>Download and manage llama.cpp releases from GitHub</p>
                    </div>
                    <div class="llamacpp-manager-controls">
                        <button class="llamacpp-refresh" onclick="llamacppReleasesManager.refreshLlamaCppReleases()" title="Refresh Releases">
                            <span class="material-icons">refresh</span> Refresh Releases
                        </button>
                        <button class="llamacpp-refresh platform-toggle" id="llamacpp-platform-toggle-ctrl" style="display: none;" onclick="llamacppReleasesManager.togglePlatformFilter()" title="Toggle platform visibility">
                            <span class="material-icons">layers</span> Windows only
                        </button>
                    </div>
                </div>
                <div class="llamacpp-top-tabs">
                    <button class="top-tab active" data-top-tab="releases" onclick="llamacppReleasesManager.switchTopTab(this, 'releases')">
                        <span class="material-icons">new_releases</span> Releases
                    </button>
                    <button class="top-tab" data-top-tab="installed" onclick="llamacppReleasesManager.switchTopTab(this, 'installed')">
                        <span class="material-icons">inventory_2</span> Installed Versions
                    </button>
                    <div class="latest-installed-build" id="latest-installed-build">Loading latest build...</div>
                </div>
                <div class="llamacpp-manager-content" id="llamacpp-manager-content">
                    <div class="loading-releases">Loading releases...</div>
                </div>
                <div class="llamacpp-installed-content hidden" id="llamacpp-installed-content">
                    <div class="loading-installed">Loading installed versions...</div>
                </div>
            </div>
        `;
        
        // Create window using desktop's createWindow method
        const windowElement = this.desktop.createWindow(windowId, 'Llama.cpp Release Manager', 'llamacpp-manager-window', content);
        
        // Don't add to taskbar - use permanent dock icon instead
        
        // Load releases after window is created
        this.loadLlamaCppReleases();
        this.loadInstalledVersions();
        this.updateLatestInstalledBuildDisplay();
    }

    async loadLlamaCppReleases() {
        const content = document.getElementById('llamacpp-manager-content');
        if (!content) return;

        try {
            content.innerHTML = '<div class="loading-releases">Loading releases...</div>';
            
            // Fetch both releases and installed versions in parallel
            const [releases, installedVersions] = await Promise.all([
                this.getLlamaCppReleases(),
                this.getInvoke()('list_llamacpp_versions')
            ]);

            this.lastReleases = releases;
            this.renderLlamaCppReleases(releases, installedVersions);
        } catch (error) {
            const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
            content.innerHTML = `<div class="error-releases">Failed to load releases: ${errorMessage}</div>`;
            console.error('Failed to load llama.cpp releases:', error);
        }
    }

    async refreshLlamaCppReleases() {
        await this.loadLlamaCppReleases();
        this.updateLatestInstalledBuildDisplay();
    }

    renderLlamaCppReleases(releases, installedVersions = []) {
     const content = document.getElementById('llamacpp-manager-content');
     if (!content) return;

     if (releases.length === 0) {
         content.innerHTML = '<div class="no-releases">No releases found</div>';
         return;
     }

     // Create a mapping from release tag names to installed versions
     // Handle both formats: 'b7779-cuda' (new) and 'b7779' (old)
     const installedByVersionTag = new Map();
     installedVersions.forEach(v => {
         // Extract the base version from the installed version name
         // For 'b7779-cuda', extract 'b7779'
         // For 'b7779', use as is
         const baseName = v.name.includes('-') ? v.name.split('-')[0] : v.name;
         installedByVersionTag.set(baseName.toLowerCase(), v);
     });

        const isWindowsAsset = (name) => {
            const n = String(name);
            const isWin = /(win|windows|win64|win32|x64|amd64)/i.test(n);
            const isOther = /(mac|darwin|osx|linux|ubuntu|debian|arch|fedora|arm64|aarch64|raspi|rpi)/i.test(n);
            return isWin && !isOther;
        };
        const isMacAsset = (name) => /mac|darwin|osx|apple|macos/i.test(name);
        const isLinuxAsset = (name) => /linux|ubuntu|debian|arch|fedora/i.test(name);
        const shouldShowAsset = (name) => {
            if (this.platformFilter === 'all') return true;
            // Filter by selected platform
            if (this.platformFilter === 'windows') return isWindowsAsset(name);
            if (this.platformFilter === 'macos') return isMacAsset(name);
            if (this.platformFilter === 'linux') return isLinuxAsset(name);
            return true;
        };

        const releasesHTML = releases.map(release => {
            const releaseDate = new Date(release.published_at).toLocaleDateString();
            const relativeTime = this.formatRelativeTime(release.published_at);
            // Extract the tag name without the 'v' prefix for comparison
            const tagNameWithoutPrefix = release.tag_name.toLowerCase().replace(/^v/, '');
            const isInstalled = installedByVersionTag.has(tagNameWithoutPrefix);
            const installedBadge = isInstalled ? '<span class="badge installed">Installed</span>' : '';

            // Preserve expansion state by not altering release-item class outside
            // Sort assets: preferred platform first when filter is on; keep stable otherwise
            const assetsSorted = [...release.assets].sort((a, b) => {
                const aWin = isWindowsAsset(a.name || '');
                const bWin = isWindowsAsset(b.name || '');
                const aMac = isMacAsset(a.name || '');
                const bMac = isMacAsset(b.name || '');
                const aLin = isLinuxAsset(a.name || '');
                const bLin = isLinuxAsset(b.name || '');
                
                // Get matching platform for current filter
                const getMatchScore = (asset) => {
                    if (this.platformFilter === 'all') return 0;
                    if (this.platformFilter === 'windows' && isWindowsAsset(asset)) return 1;
                    if (this.platformFilter === 'macos' && isMacAsset(asset)) return 1;
                    if (this.platformFilter === 'linux' && isLinuxAsset(asset)) return 1;
                    return 0;
                };
                
                const aScore = getMatchScore(a.name || '');
                const bScore = getMatchScore(b.name || '');
                if (this.platformFilter !== 'all' && aScore !== bScore) return bScore - aScore;
                
                return String(a.name || '').localeCompare(String(b.name || ''));
            });

            const assetsHTML = assetsSorted
                .map(asset => {
                    const name = asset.name || '';
                    const warnCuda = /cudart/i.test(name);
                    const warningHTML = warnCuda ? '<span class="asset-note" style="margin-left: 8px; color: rgba(255,255,255,0.6);">Required for CUDA</span>' : '';
                    const isWin = isWindowsAsset(name);
                    const isMac = isMacAsset(name);
                    const isLin = isLinuxAsset(name);
                    const isMatch = (this.platformFilter === 'all') || 
                        (this.platformFilter === 'windows' && isWin) ||
                        (this.platformFilter === 'macos' && isMac) ||
                        (this.platformFilter === 'linux' && isLin);
                    const grayClass = !isMatch ? ' dim-asset' : '';
                    return `
                        <div class="release-asset${grayClass}">
                            <div class="asset-info">
                                <span class="asset-name">${name}</span>
                                ${warningHTML}
                            </div>
                            <button class="asset-download" onclick="llamacppReleasesManager.handleAssetDownload(${asset.id}, '${name}', '${asset.download_url}', ${asset.size}, '${release.tag_name}')" title="Download ${name} (${this.formatFileSize(asset.size)})">
                                <span class="material-icons">download</span> Download (${this.formatFileSize(asset.size)})
                            </button>
                        </div>
                    `;
                })
                .join('');

            return `
                <div class="release-item">
                    <div class="release-header" onclick="llamacppReleasesManager.toggleReleaseExpansion(this)" title="Click to expand/collapse">
                        <div class="release-info">
                            <h5 class="release-name">${release.name || release.tag_name}</h5>
                            <span class="release-tag">${release.tag_name}</span>
                            <span class="release-date">${releaseDate}</span>
                           <span class="release-time">${relativeTime}</span>
                           ${installedBadge}
                       </div>
                       <div class="release-actions">
                           <button class="github-view-btn" onclick="event.stopPropagation(); desktop.openUrl('${release.html_url}')" title="View on GitHub">
                               <span class="material-icons">open_in_new</span>
                            </button>
                            <span class="release-arrow">
                                <span class="material-icons">expand_more</span>
                            </span>
                        </div>
                    </div>
                    <div class="release-details">
                        <div class="release-tabs">
                            <button class="release-tab active" onclick="llamacppReleasesManager.switchReleaseTab(this, 'notes')" data-tab="notes">
                                <span class="material-icons">description</span> Release Notes
                            </button>
                            <button class="release-tab" onclick="llamacppReleasesManager.switchReleaseTab(this, 'downloads')" data-tab="downloads">
                                <span class="material-icons">download</span> Downloads (${release.assets.length})
                            </button>
                        </div>
                        <div class="release-tab-content">
                            <div class="release-tab-pane active" data-pane="notes">
                                <div class="release-body">${release.body || 'No release notes available for this release.'}</div>
                            </div>
                            <div class="release-tab-pane" data-pane="downloads">
                                ${assetsHTML}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        // Capture current expanded items, active tab, and scroll to restore after re-render
        const expandedTags = Array.from(document.querySelectorAll('#llamacpp-manager-content .release-item.expanded .release-tag')).map(el => el.textContent);
        const activeTabsByTag = {};
        document.querySelectorAll('#llamacpp-manager-content .release-item').forEach(item => {
            const tagEl = item.querySelector('.release-tag');
            const activeTab = item.querySelector('.release-tab.active');
            if (tagEl && activeTab) activeTabsByTag[tagEl.textContent] = activeTab.getAttribute('data-tab');
        });
        const scrollY = content.scrollTop;

        content.innerHTML = `
            <div class="releases-header">
                <p>Found ${releases.length} llama.cpp releases</p>
                <button class="platform-badge" id="llamacpp-platform-badge" onclick="llamacppReleasesManager.togglePlatformFilter()" title="Toggle platform visibility">
                    ${(this.platformFilter === 'all' ? 'All platforms' : this.platformFilter.charAt(0).toUpperCase() + this.platformFilter.slice(1))}
                </button>
            </div>
            ${releasesHTML}
        `;

        // Restore expanded state and active tab; also restore scroll position
        if (expandedTags && expandedTags.length) {
            const items = document.querySelectorAll('#llamacpp-manager-content .release-item');
            items.forEach(item => {
                const tagEl = item.querySelector('.release-tag');
                if (tagEl && expandedTags.includes(tagEl.textContent)) {
                    item.classList.add('expanded');
                    const desiredTab = activeTabsByTag[tagEl.textContent];
                    if (desiredTab) {
                        const btn = item.querySelector(`.release-tab[data-tab="${desiredTab}"]`);
                        if (btn) this.switchReleaseTab(btn, desiredTab);
                    }
                }
            });
        }
        content.scrollTop = scrollY;
    }

    togglePlatformFilter() {
        // Cycle through platforms: windows -> linux -> macos -> all -> windows
        const platforms = ['windows', 'linux', 'macos', 'all'];
        const currentIndex = platforms.indexOf(this.platformFilter);
        this.platformFilter = platforms[(currentIndex + 1) % platforms.length];
        
        const platformLabels = {
            'windows': 'Windows',
            'linux': 'Linux', 
            'macos': 'macOS',
            'all': 'All platforms'
        };
        
        const btn = document.getElementById('llamacpp-platform-toggle-ctrl');
        if (btn) {
            btn.innerHTML = `<span class="material-icons">layers</span> ${platformLabels[this.platformFilter]}`;
        }
        const badge = document.getElementById('llamacpp-platform-badge');
        if (badge) {
            badge.textContent = platformLabels[this.platformFilter];
        }
        if (this.lastReleases) {
            // Re-render with cached releases and newly fetched installed versions
            this.getInvoke()('list_llamacpp_versions').then(installed => {
                // Use the same logic as loadLlamaCppReleases to get both releases and installed versions
                // but use cached releases to avoid refetching
                this.renderLlamaCppReleases(this.lastReleases, installed);
                this.updateLatestInstalledBuildDisplay();
            });
        }
    }

    // Utility Methods
    formatFileSize(bytes) {
        if (!bytes) return 'Unknown size';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    formatRelativeTime(dateString) {
        const now = new Date();
        const date = new Date(dateString);
        const diffInSeconds = Math.floor((now - date) / 1000);
        
        if (diffInSeconds < 60) {
            return `${diffInSeconds} second${diffInSeconds !== 1 ? 's' : ''} ago`;
        }
        
        const diffInMinutes = Math.floor(diffInSeconds / 60);
        if (diffInMinutes < 60) {
            return `${diffInMinutes} minute${diffInMinutes !== 1 ? 's' : ''} ago`;
        }
        
        const diffInHours = Math.floor(diffInMinutes / 60);
        if (diffInHours < 24) {
            return `${diffInHours} hour${diffInHours !== 1 ? 's' : ''} ago`;
        }
        
        const diffInDays = Math.floor(diffInHours / 24);
        if (diffInDays < 30) {
            return `${diffInDays} day${diffInDays !== 1 ? 's' : ''} ago`;
        }
        
        const diffInMonths = Math.floor(diffInDays / 30);
        if (diffInMonths < 12) {
            return `${diffInMonths} month${diffInMonths !== 1 ? 's' : ''} ago`;
        }
        
        const diffInYears = Math.floor(diffInMonths / 12);
        return `${diffInYears} year${diffInYears !== 1 ? 's' : ''} ago`;
    }
    
    formatNumber(num) {
        if (!num) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }
    
    formatCommitInfo(commitInfo) {
        if (!commitInfo) return null;
        
        return commitInfo.message;
    }
    
    // Extract version number from name
    extractVersionNumber(name) {
        const match = String(name).match(/(\d+)/);
        return match ? parseInt(match[1], 10) : -Infinity;
    }
    
    // Get the latest installed build
    async updateLatestInstalledBuildDisplay() {
        try {
            const invoke = this.getInvoke();
            if (!invoke) throw new Error('Tauri API not available');
            
            const versions = await invoke('list_llamacpp_versions');
            
            if (!Array.isArray(versions) || versions.length === 0) {
                const latestBuildElement = document.getElementById('latest-installed-build');
                if (latestBuildElement) {
                    latestBuildElement.textContent = 'No builds installed';
                    latestBuildElement.title = 'No builds installed';
                }
                return;
            }
            
            // Group versions by base version (ignoring backend suffix)
            const versionGroups = {};
            versions.forEach(v => {
                // Handle both new nested format (b7779-cuda) and old flat format
                const baseName = v.name.includes('-') ? v.name.split('-')[0] : v.name;
                if (!versionGroups[baseName]) {
                    versionGroups[baseName] = [];
                }
                versionGroups[baseName].push(v);
            });
            
            // Sort version groups by numeric version descending
            const sortedGroupNames = Object.keys(versionGroups).sort((a, b) =>
                this.extractVersionNumber(b) - this.extractVersionNumber(a)
            );
            
            // Get the latest build name (without backend suffix)
            const latestBuildName = sortedGroupNames.length > 0 ? sortedGroupNames[0] : 'None';
            
            const latestBuildElement = document.getElementById('latest-installed-build');
            if (latestBuildElement) {
                latestBuildElement.textContent = `Latest installed: ${latestBuildName}`;
                latestBuildElement.title = `Latest installed build: ${latestBuildName}`;
            }
        } catch (error) {
            console.error('Failed to update latest installed build display:', error);
            const latestBuildElement = document.getElementById('latest-installed-build');
            if (latestBuildElement) {
                latestBuildElement.textContent = 'Error loading build';
                latestBuildElement.title = 'Error loading build information';
            }
        }
    }
}
