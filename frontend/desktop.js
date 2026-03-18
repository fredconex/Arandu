// LlamaOS Interface
const { invoke } = window.__TAURI__.core;

class DesktopManager {
    constructor() {
        this.windows = new Map();
        this.selectedIcon = null;
        this.windowZIndex = 1000;
        this.iconPositions = new Map(); // Store custom icon positions
        this.hintTimer = null; // Timer for model hint
        this.hideArchTimer = null; // Timer for hiding architecture list
        this.currentArchIcon = null; // Track which architecture icon has the list open
        this.sortType = null;
        this.sortDirection = 'asc';
        this.sessionSyncTimer = null;
        this.folderSortType = null;
        this.folderSortDirection = 'asc';
        this.folderSortFavoritesFirst = true; // Toggle to keep favorites on top
        this.hideSuppressedModels = true; // Hide CLIP models from All Models view by default
        this.isLoaded = false;
        this.sessionData = null; // Store session data for deferred restoration
        this.restorationInProgress = false; // Flag to prevent duplicate restoration
        this.modelsByArchitecture = {}; // Store models grouped by architecture
        this.favorites = this.loadFavorites(); // Load favorites from localStorage
        this.searchFolderInputValue = ''; // Store search input value when closing folder view

        this.init();
    }

    init() {
        // Update system stats every 2 seconds
        this.updateSystemStats();
        setInterval(() => this.updateSystemStats(), 1000);

        // Set up system monitor icon click event
        this.setupSystemMonitorIcon();

        // Wait for DOM to be fully loaded before showing content
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.initializeSession();
                this.setupEventListeners();
            });
        } else {
            this.setupEventListeners();
            // DOM is already loaded
            setTimeout(() => this.initializeSession(), 100);
        }

        // Auto-save session state periodically
        this.sessionSyncTimer = setInterval(() => this.syncSessionState(), 5000);

        // Save session state before page unload
        window.addEventListener('beforeunload', () => this.syncSessionState());

        // Handle page load complete
        this.handlePageLoad();
    }

    handlePageLoad() {
        // Wait for all resources to load
        if (document.readyState === 'complete') {
            this.hideLoadingScreen();
        } else {
            window.addEventListener('load', () => {
                // Add a small delay to ensure everything is ready
                setTimeout(() => {
                    this.hideLoadingScreen();
                }, 500);
            });
        }
    }

    hideLoadingScreen() {
        if (this.isLoaded) return;
        this.isLoaded = true;

        const loadingScreen = document.getElementById('loading-screen');
        const desktop = document.getElementById('desktop');

        if (loadingScreen && desktop) {
            // Start fade out of loading screen
            loadingScreen.classList.add('fade-out');

            // Start fade in of desktop after a short delay
            setTimeout(() => {
                desktop.classList.add('fade-in');
                this.animateDesktopElements();

                // Restore session windows after desktop is visible
                setTimeout(() => {
                    this.restoreSessionWindows();
                }, 500);
            }, 200);

            // Remove loading screen from DOM after fade out completes
            setTimeout(() => {
                if (loadingScreen.parentNode) {
                    loadingScreen.parentNode.removeChild(loadingScreen);
                }
            }, 600);
        }
    }

    animateDesktopElements() {
        // Animate taskbar
        const taskbar = document.querySelector('.taskbar');
        if (taskbar) {
            setTimeout(() => {
                taskbar.classList.add('fade-in');
            }, 100);
        }

        // Animate all desktop icons simultaneously
        const icons = document.querySelectorAll('.desktop-icon');
        setTimeout(() => {
            icons.forEach((icon) => {
                icon.classList.add('fade-in');
            });
        }, 200); // All icons appear at the same time

        // Ensure all interactive elements are properly initialized after animations
        setTimeout(() => {
            this.ensureDesktopInteractivity();
        }, 1000); // Fixed delay since no staggering
    }

    ensureDesktopInteractivity() {
        console.log('Ensuring desktop interactivity...');

        // Re-setup any event listeners that might have been affected
        this.setupIconDragging();

        // Ensure start menu functionality
        const startMenu = document.getElementById('start-menu');
        if (startMenu) {
            startMenu.classList.add('hidden'); // Ensure it starts hidden
        }

        // Ensure context menu is hidden
        const contextMenu = document.getElementById('context-menu');
        if (contextMenu) {
            contextMenu.classList.add('hidden');
        }

        // Initialize HuggingFace app if not already done in DOMContentLoaded
        if (!huggingFaceApp && typeof HuggingFaceApp !== 'undefined') {
            try {
                huggingFaceApp = new HuggingFaceApp(this);
                console.log('HuggingFace app initialized (fallback)');
            } catch (error) {
                console.error('Failed to initialize HuggingFace app (fallback):', error);
            }
        }

        // Initialize Properties Manager if not already done in DOMContentLoaded
        if (!propertiesManager && typeof PropertiesManager !== 'undefined') {
            try {
                propertiesManager = new PropertiesManager(this);
                console.log('Properties manager initialized (fallback)');
            } catch (error) {
                console.error('Failed to initialize Properties manager (fallback):', error);
            }
        }

        // Initialize Download Manager if not already done in DOMContentLoaded
        if (!downloadManager && typeof DownloadManager !== 'undefined') {
            try {
                downloadManager = new DownloadManager(this);
                window.downloadManager = downloadManager; // Make globally accessible
                console.log('Download manager initialized (fallback)');
            } catch (error) {
                console.error('Failed to initialize Download manager (fallback):', error);
            }
        }

        // Initialize Llama.cpp Releases Manager if not already done in DOMContentLoaded
        if (!llamacppReleasesManager && typeof LlamaCppReleasesManager !== 'undefined') {
            try {
                llamacppReleasesManager = new LlamaCppReleasesManager(this);
                window.llamacppReleasesManager = llamacppReleasesManager; // Make globally accessible
                console.log('Llama.cpp releases manager initialized (fallback)');
            } catch (error) {
                console.error('Failed to initialize Llama.cpp releases manager (fallback):', error);
            }
        }

        // Initialize Terminal Manager if not already done in DOMContentLoaded
        if (!terminalManager) {
            if (typeof TerminalManager !== 'undefined') {
                try {
                    terminalManager = new TerminalManager(this);
                    console.log('Terminal manager initialized (fallback)');
                    // Restore terminals and windows now that the manager is ready
                    setTimeout(() => terminalManager.restoreTerminalsAndWindows(), 100);
                } catch (error) {
                    console.error('Failed to initialize Terminal manager (fallback):', error);
                }
            } else {
                console.warn('TerminalManager class not available in fallback, will retry');
            }
        }

        // Log the final status of all managers
        console.log('Module manager status after ensureDesktopInteractivity:', {
            terminalManager: terminalManager ? 'initialized' : 'not initialized',
            propertiesManager: propertiesManager ? 'initialized' : 'not initialized',
            downloadManager: downloadManager ? 'initialized' : 'not initialized',
            llamacppReleasesManager: llamacppReleasesManager ? 'initialized' : 'not initialized',
            huggingFaceApp: huggingFaceApp ? 'initialized' : 'not initialized'
        });

        console.log('Desktop interactivity ensured');
    }

    async initializeSession() {
        // Load folder sort settings from localStorage
        this.folderSortType = localStorage.getItem('folderSortType') || null;
        this.folderSortDirection = localStorage.getItem('folderSortDirection') || 'asc';
        this.folderSortFavoritesFirst = localStorage.getItem('folderSortFavoritesFirst') !== 'false';
        this.hideSuppressedModels = localStorage.getItem('hideSuppressedModels') !== 'false'; // Load suppressed models preference
        
        // Load session state first to restore desktop settings
        await this.loadSessionState();

        // Load configuration first (this will populate form fields)
        await this.loadConfiguration();

        // Load models and populate desktop
        await this.loadModels();

        // Update custom arguments indicators
        setTimeout(() => {
            this.updateCustomArgsIndicators();
        }, 500);
    }

    async loadConfiguration() {
        try {
            const config = await invoke('get_config');
            if (config) {
                this.updateConfigUI(config);
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            this.showNotification('Error loading configuration', 'error');
        }
    }

    async loadModels(useAnimation = true) {
        try {
            const result = await invoke('scan_models_command');
            if (result && result.success && result.models) {
                this.refreshDesktopIcons(result.models, useAnimation);
            } else {
                console.log('No models found or scan failed');
                this.refreshDesktopIcons([], useAnimation);
            }
        } catch (error) {
            console.error('Error loading models:', error);
            this.showNotification('Error loading models', 'error');
            this.refreshDesktopIcons([], useAnimation);
        }
    }

    updateConfigUI(config) {
        const modelsDir = document.getElementById('models-directory');
        const execFolder = document.getElementById('executable-folder');
        const themeColor = document.getElementById('theme-color');
        const backgroundColor = document.getElementById('background-color');
        const themeSyncButton = document.getElementById('theme-sync-button');

        if (modelsDir && config.models_directory) {
            modelsDir.value = config.models_directory;
        }
        if (execFolder && config.executable_folder) {
            execFolder.value = config.executable_folder;
        }
        if (themeColor && config.theme_color) {
            themeColor.value = config.theme_color;
        }
        if (backgroundColor && config.background_color) {
            backgroundColor.value = config.background_color;
        }

        const themeIsSynced = config.theme_is_synced ?? true;
        if (themeSyncButton) {
            themeSyncButton.classList.toggle('active', themeIsSynced);
        }

        this.applyTheme(config.theme_color || 'dark-gray', config.background_color || 'dark-gray');
        document.body.dataset.theme = config.theme_color || 'dark-gray';
        document.body.dataset.background = config.background_color || 'dark-gray';
    }

    updateDockAutoHidingStatus() {
        const maximizedWindows = document.querySelectorAll('.window.maximized:not([style*="display: none"])');
        if (maximizedWindows.length > 0) {
            document.body.classList.add('has-maximized-window');
            // If we just entered maximized mode, hide the dock immediately unless hovered
            const dock = document.querySelector('.dock');
            if (dock && !dock.matches(':hover')) {
                dock.classList.remove('visible');
            }
        } else {
            document.body.classList.remove('has-maximized-window');
            // If leaving maximized mode, ensure dock is visible
            const dock = document.querySelector('.dock');
            if (dock) dock.classList.add('visible');
        }
    }

    setupDockBehavior() {
        // Dock is now a persistent sidebar, autohide behavior removed.
    }

    handleGlobalClickInteraction() {
        this.hideContextMenu();
        this.hideDockContextMenu();
        
        // Close downloads folder view if clicking on the overlay
        const downloadsFolderView = document.getElementById('downloads-folder-view');
        const downloadsOverlay = downloadsFolderView?.querySelector('.search-folder-overlay');
        if (downloadsFolderView && !downloadsFolderView.classList.contains('hidden') && downloadsOverlay) {
            // Don't hide here - the overlay click should close it via the download manager
            // Just make sure it's handled properly
        }

        // Collapse memory monitor
        const memoryMonitor = document.getElementById('desktop-memory-monitor');
        if (memoryMonitor) {
            memoryMonitor.classList.remove('expanded');
            memoryMonitor.classList.remove('active');
        }

        // Close search balloon
        const searchBalloon = document.getElementById('search-balloon');
        const searchDockIcon = document.getElementById('search-dock-icon');
        if (searchBalloon && searchDockIcon) {
            searchBalloon.classList.add('hidden');
            searchDockIcon.classList.remove('active');

            // Also hide history dropdown
            const dropdown = document.getElementById('search-history-dropdown');
            if (dropdown) {
                dropdown.classList.remove('show');
            }
        }

        this.deselectAllIcons();
    }

    setupEventListeners() {
        this.setupDockBehavior();
        const themeColor = document.getElementById('theme-color');
        const backgroundColor = document.getElementById('background-color');
        const themeSyncButton = document.getElementById('theme-sync-button');

        if (themeColor && backgroundColor && themeSyncButton) {
            themeColor.addEventListener('change', () => {
                if (themeSyncButton.classList.contains('active')) {
                    backgroundColor.value = themeColor.value;
                }
                this.applyTheme(themeColor.value, backgroundColor.value);
            });

            backgroundColor.addEventListener('change', () => {
                // Turn off sync when background color is changed
                themeSyncButton.classList.remove('active');
                this.applyTheme(themeColor.value, backgroundColor.value);
            });

            themeSyncButton.addEventListener('click', () => {
                themeSyncButton.classList.toggle('active');
                if (themeSyncButton.classList.contains('active')) {
                    backgroundColor.value = themeColor.value;
                    this.applyTheme(themeColor.value, backgroundColor.value);
                }
            });
        }
        // Global clicks
        document.addEventListener('click', (e) => {
            // Don't hide folder view if clicking inside it
            const folderView = document.getElementById('search-folder-view');
            const folderContent = folderView?.querySelector('.search-folder-content');
            if (folderView && !folderView.classList.contains('hidden') && folderContent && folderContent.contains(e.target)) {
                // Clicking inside folder view content - don't close anything
                return;
            }

            // Close folder view if clicking on the background (overlay, content container, or grid)
            if (folderView && !folderView.classList.contains('hidden') &&
                (e.target.classList.contains('search-folder-overlay') ||
                    e.target.classList.contains('search-folder-content') ||
                    e.target.id === 'search-folder-grid')) {
                // Check if we're in "All Models" folder
                const folderTitle = document.getElementById('search-folder-title');
                const isAllModels = folderTitle && folderTitle.textContent === 'Models';
                this.hideSearchFolderView(isAllModels);
                return;
            }

            // Don't hide architecture list if clicking inside it or on an architecture icon
            const archList = document.getElementById('architecture-models-list');
            const clickedArchIcon = e.target.closest('.desktop-icon.architecture-icon');

            if ((archList && archList.contains(e.target)) || clickedArchIcon) {
                // Don't hide anything if clicking on arch list or arch icon
                return;
            }

            this.hideContextMenu();
            this.hideDockContextMenu();
            // Don't hide folder view here - it should only close via back button or overlay click

            // Collapse memory monitor when clicking outside
            const memoryMonitor = document.getElementById('desktop-memory-monitor');
            if (memoryMonitor && !memoryMonitor.contains(e.target)) {
                memoryMonitor.classList.remove('expanded');
                memoryMonitor.classList.remove('active');
            }

            // Close search balloon when clicking outside
            const searchBalloon = document.getElementById('search-balloon');
            const searchDockIcon = document.getElementById('search-dock-icon');
            const searchInput = document.getElementById('search-input');

            if (searchBalloon && !searchBalloon.contains(e.target) &&
                searchDockIcon && !searchDockIcon.contains(e.target)) {
                searchBalloon.classList.add('hidden');
                searchDockIcon.classList.remove('active');
                // Also hide history dropdown
                const dropdown = document.getElementById('search-history-dropdown');
                if (dropdown) {
                    dropdown.classList.remove('show');
                }
            }

            // Close history dropdown when clicking outside
            const historyDropdown = document.getElementById('search-history-dropdown');
            if (historyDropdown && !historyDropdown.contains(e.target) &&
                searchInput && !searchInput.contains(e.target)) {
                historyDropdown.classList.remove('show');
            }

            if (!e.target.closest('.desktop-icon') && !e.target.closest('#context-menu')) {
                this.deselectAllIcons();
            }
        });

        // Context menu
        document.addEventListener('contextmenu', (e) => {
            // Allow default context menu for inputs and textareas
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }

            e.preventDefault();
            const icon = e.target.closest('.desktop-icon');
            const taskbar = e.target.closest('.taskbar');

            if (icon) {
                this.selectIcon(icon);
                // Check if it's an architecture icon
                if (icon.classList.contains('architecture-icon')) {
                    this.showContextMenu(e.clientX, e.clientY, 'architecture');
                } else {
                    this.showContextMenu(e.clientX, e.clientY, 'icon');
                }
            } else if (e.target.closest('.desktop') && !taskbar) {
                // Only show desktop context menu if not clicking on taskbar
                this.showContextMenu(e.clientX, e.clientY, 'desktop');
            }
        });

        // setupSearchFolderListeners is called here to handle the new integrated search in models view
        this.setupSearchFolderListeners();

        // Icon interactions
        const iconsContainer = document.getElementById('desktop-icons');
        if (iconsContainer) {
            iconsContainer.addEventListener('click', (e) => {
                const icon = e.target.closest('.desktop-icon');
                if (icon) {
                    if (icon.classList.contains('architecture-icon')) {
                        // Toggle architecture list
                        this.toggleArchitectureModels(icon);
                    } else {
                        this.selectIcon(icon);
                    }
                }
            });

            iconsContainer.addEventListener('dblclick', async (e) => {
                const icon = e.target.closest('.desktop-icon');
                if (icon) {
                    // Check if it's an architecture icon
                    if (icon.classList.contains('architecture-icon')) {
                        // For architecture icons, just show the list (already shown on hover)
                        return;
                    }

                    // Check if this is a clip model - clip models cannot be launched
                    const modelArchitecture = icon.dataset.architecture;
                    if (modelArchitecture && modelArchitecture.toLowerCase() === 'clip') {
                        this.showNotification('Clip models cannot be launched', 'info');
                        return;
                    }

                    // Check if we have presets and use default/single preset
                    const modelPath = icon.dataset.path;
                    try {
                        const presets = await invoke('get_model_presets', { modelPath: modelPath });
                        if (presets && presets.length > 0) {
                            // Find default preset or use the first one if only one exists
                            const defaultPreset = presets.find(p => p.is_default) || (presets.length === 1 ? presets[0] : null);
                            if (defaultPreset) {
                                await this.launchModelWithPreset(icon, defaultPreset.id);
                                return;
                            }
                        }
                    } catch (error) {
                        console.error('Error loading presets for double-click launch:', error);
                    }

                    // Fallback to default launch if no presets or error
                    this.launchModel(icon);
                }
            });

            // Add drag functionality
            this.setupIconDragging();
        }

        // Hint functionality - only for regular model icons
        iconsContainer.addEventListener('mouseover', (e) => {
            const icon = e.target.closest('.desktop-icon');
            if (icon && !icon.classList.contains('architecture-icon')) {
                this.showModelHint(icon);
            }
        });

        iconsContainer.addEventListener('mouseout', (e) => {
            const icon = e.target.closest('.desktop-icon');
            if (icon && !icon.classList.contains('architecture-icon')) {
                this.hideModelHint();
            }
        });

        // Context menu actions
        const contextMenu = document.getElementById('context-menu');
        if (contextMenu) {
            contextMenu.addEventListener('click', async (e) => {
                const actionElement = e.target.closest('[data-action]');
                const action = actionElement?.dataset.action;

                if (action) {
                    // Don't trigger action if clicking on a menu item with submenu (unless it's a submenu item itself)
                    const hasSubmenu = actionElement?.classList.contains('has-submenu');
                    const isSubmenuItem = actionElement?.closest('.context-menu-submenu');

                    if (action === 'expand-architecture' && this.selectedIcon) {
                        // Show the architecture models list
                        this.showArchitectureModels(this.selectedIcon);
                    } else if (action === 'open' && this.selectedIcon) {
                        if (!hasSubmenu || isSubmenuItem) {
                            // Check if we have exactly one preset and should use it
                            const modelPath = this.selectedIcon.dataset.path;
                            try {
                                const presets = await invoke('get_model_presets', { modelPath: modelPath });
                                if (presets && presets.length === 1) {
                                    // Single preset - launch with it
                                    await this.launchModelWithPreset(this.selectedIcon, presets[0].id);
                                } else {
                                    // No presets or multiple presets - use default launch
                                    this.launchModel(this.selectedIcon);
                                }
                            } catch (error) {
                                console.error('Error loading presets for launch:', error);
                                // Fallback to default launch
                                this.launchModel(this.selectedIcon);
                            }
                        } else {
                            // Just show submenu, don't hide context menu
                            return;
                        }
                    } else if (action === 'launch-preset' && this.selectedIcon) {
                        const presetId = e.target.closest('[data-preset-id]')?.dataset.presetId;
                        await this.launchModelWithPreset(this.selectedIcon, presetId);
                    } else if (action === 'launch-external' && this.selectedIcon) {
                        if (!hasSubmenu || isSubmenuItem) {
                            // Check if we have exactly one preset and should use it
                            const modelPath = this.selectedIcon.dataset.path;
                            try {
                                const presets = await invoke('get_model_presets', { modelPath: modelPath });
                                if (presets && presets.length === 1) {
                                    // Single preset - launch with it
                                    await this.launchModelWithPresetExternal(this.selectedIcon, presets[0].id);
                                } else {
                                    // No presets or multiple presets - use default launch
                                    this.launchModelExternal(this.selectedIcon);
                                }
                            } catch (error) {
                                console.error('Error loading presets for external launch:', error);
                                // Fallback to default launch
                                this.launchModelExternal(this.selectedIcon);
                            }
                        } else {
                            // Just show submenu, don't hide context menu
                            return;
                        }
                    } else if (action === 'launch-preset-external' && this.selectedIcon) {
                        const presetId = e.target.closest('[data-preset-id]')?.dataset.presetId;
                        await this.launchModelWithPresetExternal(this.selectedIcon, presetId);
                    } else if (action === 'open-folder' && this.selectedIcon) {
                        this.openModelFolder(this.selectedIcon);
                    } else if (action === 'properties' && this.selectedIcon) {
                        this.showProperties(this.selectedIcon);
                    } else if (action === 'delete' && this.selectedIcon) {
                        this.deleteModelFile(this.selectedIcon);
                    } else if (action === 'refresh') {
                        this.refreshDesktop();
                    }
                }
                this.hideContextMenu();
            });
        }

        // Dock permanent app icons
        const searchDockIcon = document.getElementById('search-dock-icon');
        if (searchDockIcon) {
            searchDockIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                
                // Toggle folder view - if already open, close it
                const folderView = document.getElementById('search-folder-view');
                if (folderView && !folderView.classList.contains('hidden')) {
                    // Check if we're in "All Models" folder
                    const folderTitle = document.getElementById('search-folder-title');
                    const isAllModels = folderTitle && folderTitle.textContent === 'Models';
                    this.hideSearchFolderView(isAllModels);
                    return;
                }
                
                // Close search balloon if open (folder view takes priority)
                const searchBalloon = document.getElementById('search-balloon');
                if (searchBalloon && !searchBalloon.classList.contains('hidden')) {
                    searchBalloon.classList.add('hidden');
                }
                
                // Don't auto-display recent searches when opening All Models
                this.showArchitectureFolderView('All', false);
            });
        }

        const downloadsDockIcon = document.getElementById('downloads-dock-icon');
        if (downloadsDockIcon) {
            downloadsDockIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                if (downloadManager) {
                    downloadManager.toggleDownloadHistory();
                }
            });
        }

        const settingsDockIcon = document.getElementById('settings-dock-icon');
        if (settingsDockIcon) {
            settingsDockIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSettingsPanel();
            });
        }

        const huggingfaceDockIcon = document.getElementById('huggingface-dock-icon');
        if (huggingfaceDockIcon) {
            huggingfaceDockIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                if (huggingFaceApp) {
                    huggingFaceApp.openHuggingFaceSearch().catch(error => {
                        console.error('Error opening HuggingFace search:', error);
                        this.showNotification('Error opening HuggingFace app', 'error');
                    });
                }
            });
        }

        const llamacppDockIcon = document.getElementById('llamacpp-dock-icon');
        if (llamacppDockIcon) {
            llamacppDockIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                if (llamacppReleasesManager) {
                    llamacppReleasesManager.showLlamaCppManager();
                }
            });
        }

        // Dock context menu
        document.addEventListener('contextmenu', (e) => {
            const dockItem = e.target.closest('.dock-item, .taskbar-item');
            if (dockItem && dockItem.closest('.dock')) {
                e.preventDefault();
                e.stopPropagation();
                this.showDockContextMenu(e.clientX, e.clientY, dockItem);
                return;
            }
        });

        // Search balloon - hide hint when mouse enters
        const searchBalloon = document.getElementById('search-balloon');
        if (searchBalloon) {
            searchBalloon.addEventListener('mouseenter', () => {
                this.hideModelHint();
            });
        }

        // Search input
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            // Hide model hint when search input gets focus
            searchInput.addEventListener('focus', () => {
                this.hideModelHint();
            });

            // Toggle dropdown when clicking the input
            searchInput.addEventListener('click', (e) => {
                e.stopPropagation();
                const dropdown = document.getElementById('search-history-dropdown');
                if (dropdown) {
                    this.updateSearchHistoryDropdown(searchInput.value);
                    if (dropdown.classList.contains('show')) {
                        dropdown.classList.remove('show');
                    } else if (searchHistory.hasHistory()) {
                        dropdown.classList.add('show');
                    }
                }
            });

            // Hide dropdown when typing
            searchInput.addEventListener('input', (e) => {
                this.filterDesktopIcons(e.target.value);
                const dropdown = document.getElementById('search-history-dropdown');
                if (dropdown) {
                    // Update dropdown with filtered results but keep it shown if it was already shown
                    this.updateSearchHistoryDropdown(e.target.value);

                    // Only show dropdown if there are matching results and input is not empty
                    if (e.target.value.trim() !== '' && searchHistory.hasHistory()) {
                        dropdown.classList.add('show');
                    } else {
                        dropdown.classList.remove('show');
                    }
                }
            });

            // Handle Enter key to save to history
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const term = searchInput.value.trim();
                    if (term) {
                        searchHistory.addSearch(term);
                        this.updateSearchHistoryDropdown();
                    }
                }
            });
        }

        // Search history dropdown
        const searchHistoryList = document.getElementById('search-history-list');
        if (searchHistoryList) {
            searchHistoryList.addEventListener('click', (e) => {
                const item = e.target.closest('.search-history-item');
                if (item) {
                    const deleteBtn = e.target.closest('.search-history-delete');
                    if (deleteBtn) {
                        // Delete individual history item
                        const term = deleteBtn.dataset.term;
                        searchHistory.removeSearch(term);
                        this.updateSearchHistoryDropdown();
                    } else {
                        // Click on history item - populate search
                        const term = item.dataset.term;
                        if (searchInput) {
                            searchInput.value = term;
                            this.filterDesktopIcons(term);
                            const dropdown = document.getElementById('search-history-dropdown');
                            if (dropdown) {
                                dropdown.classList.remove('show');
                            }
                        }
                    }
                }
            });
        }

        // Clear all history button
        const clearAllBtn = document.getElementById('search-history-clear-all');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', async () => {
                // Show confirmation dialog before clearing history
                const confirmed = await ModalDialog.showConfirmation({
                    title: 'Clear Search History',
                    message: 'Are you sure you want to clear all search history? This action cannot be undone.',
                    confirmText: 'Clear History',
                    cancelText: 'Cancel',
                    type: 'danger'
                });

                if (confirmed) {
                    searchHistory.clearHistory();
                    this.updateSearchHistoryDropdown();
                }
            });
        }

        // Search clear button
        const searchClear = document.getElementById('search-clear');
        if (searchClear) {
            searchClear.addEventListener('click', () => {
                if (searchInput) {
                    if (searchInput.value === '') {
                        this.toggleSearchBalloon();
                    } else {
                        searchInput.value = '';
                        this.filterDesktopIcons('');
                        // Don't auto-show history when clearing
                    }
                }
            });
        }

        // Search folder back button
        const searchFolderBack = document.getElementById('search-folder-back');
        if (searchFolderBack) {
            searchFolderBack.addEventListener('click', () => {
                // Check if we're in "All Models" folder
                const folderTitle = document.getElementById('search-folder-title');
                const isAllModels = folderTitle && folderTitle.textContent === 'Models';
                this.hideSearchFolderView(isAllModels);
            });
        }

        // Search folder filter input
        const searchFolderInput = document.getElementById('search-folder-input');
        if (searchFolderInput) {
            searchFolderInput.addEventListener('input', (e) => {
                this.filterFolderViewModels(e.target.value);
            });
        }

        // Search folder clear button
        const searchFolderClear = document.getElementById('search-folder-clear');
        if (searchFolderClear) {
            searchFolderClear.addEventListener('click', () => {
                if (searchFolderInput) {
                    searchFolderInput.value = '';
                    this.filterFolderViewModels('');
                    searchFolderInput.focus();
                }
            });
        }

        // Search Hugging Face button
        const searchHf = document.getElementById('search-hf');
        if (searchHf) {
            searchHf.addEventListener('click', () => {
                if (searchInput) {
                    const searchTerm = searchInput.value.trim();
                    if (searchTerm) {
                        // Save to history
                        searchHistory.addSearch(searchTerm);

                        // Open Hugging Face search with the search term
                        if (huggingFaceApp) {
                            huggingFaceApp.openHuggingFaceSearch().then(() => {
                                // After opening the Hugging Face window, perform the search
                                setTimeout(() => {
                                    const hfSearchInput = document.querySelector('#hf-search-input');
                                    if (hfSearchInput) {
                                        hfSearchInput.value = searchTerm;
                                        // Trigger search in Hugging Face app
                                        huggingFaceApp.performHuggingFaceSearch();
                                    }
                                }, 300);
                            }).catch(error => {
                                console.error('Error opening HuggingFace search:', error);
                                this.showNotification('Error opening HuggingFace app', 'error');
                            });
                        } else {
                            console.error('HuggingFace app not initialized');
                            this.showNotification('HuggingFace app not available', 'error');
                        }

                        // Clear the search input and close the search balloon
                        searchInput.value = '';
                        this.filterDesktopIcons('');
                        this.toggleSearchBalloon();
                    } else {
                        this.showNotification('Please enter a search term', 'info');
                    }
                }
            });
        }

        // Save config
        const saveConfig = document.getElementById('save-config');
        if (saveConfig) {
            saveConfig.addEventListener('click', () => this.saveConfiguration());
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideContextMenu();
                this.hideDockContextMenu();
            }
            if (e.key === 'Enter' && this.selectedIcon) {
                // Check if this is a clip model - clip models cannot be launched
                const modelArchitecture = this.selectedIcon.dataset.architecture;
                if (modelArchitecture && modelArchitecture.toLowerCase() === 'clip') {
                    this.showNotification('Clip models cannot be launched', 'info');
                    return;
                }
                this.launchModel(this.selectedIcon);
            }
        });
    }

    selectIcon(icon) {
        this.deselectAllIcons();
        icon.classList.add('selected');
        this.selectedIcon = icon;
    }

    deselectAllIcons() {
        document.querySelectorAll('.desktop-icon.selected').forEach(icon => {
            icon.classList.remove('selected');
        });
        this.selectedIcon = null;
    }

    async showPresetMenuForCard(button, icon, presets, isExternal = false) {
        const contextMenu = document.getElementById('context-menu');
        if (!contextMenu) return;

        // Hide any existing context menus first to clear menu-open classes
        this.hideContextMenu();

        // Add menu-open class to the card to keep it highlighted and action tab visible
        const modelCard = button.closest('.model-card');
        if (modelCard) modelCard.classList.add('menu-open');

        this.selectedIcon = icon;
        
        // Sort presets to move default to top
        const sortedPresets = [...presets].sort((a, b) => {
            if (a.is_default && !b.is_default) return -1;
            if (!a.is_default && b.is_default) return 1;
            return 0;
        });

        // Build preset menu items - No "Default" (base model) item anymore
        let menuItems = `
            <div class="context-menu-title" style="padding: 8px 12px; font-size: 11px; color: var(--theme-text-muted); text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8;">Select Preset</div>
        `;
        
        sortedPresets.forEach(preset => {
            // If it's a default preset, show the home icon
            const iconName = preset.is_default ? 'home' : 'tune';
            menuItems += `
                <div class="context-menu-item" data-action="${isExternal ? 'launch-preset-external' : 'launch-preset'}" data-preset-id="${preset.id}">
                    <span class="material-icons">${iconName}</span> ${preset.name}
                </div>
            `;
        });

        contextMenu.innerHTML = menuItems;
        contextMenu.classList.remove('hidden');

        // Close menu when mouse leaves it
        contextMenu.onmouseleave = () => {
            this.hideContextMenu();
            contextMenu.onmouseleave = null;
        };

        const rect = button.getBoundingClientRect();
        const menuRect = contextMenu.getBoundingClientRect();
        
        let left = rect.left;
        let top = rect.bottom + 5;

        // Keep on screen
        if (left + menuRect.width > window.innerWidth) {
            left = window.innerWidth - menuRect.width - 10;
        }
        if (top + menuRect.height > window.innerHeight) {
            top = rect.top - menuRect.height - 5;
        }

        contextMenu.style.left = `${left}px`;
        contextMenu.style.top = `${top}px`;
    }

    async showContextMenu(x, y, type = 'icon') {
        const contextMenu = document.getElementById('context-menu');
        if (!contextMenu) return;

        // Dynamically build the context menu
        let menuItems = '';
        if (type === 'desktop') {
            menuItems = `
                <div class="context-menu-item" data-action="refresh"><span class="material-icons">refresh</span> Refresh Desktop</div>
            `;
        } else if (type === 'architecture') {
            // Context menu for architecture icons - removed since we now use folder view
            menuItems = ``;
        } else { // 'icon'
            // Get presets for this model
            let presetsHTML = '';
            let presetsHTMLExternal = '';
            let hasMultiplePresets = false;
            
            // Check if this is a clip model - clip models cannot be launched or have properties edited
            const isClipModel = this.selectedIcon && this.selectedIcon.dataset.architecture && 
                               this.selectedIcon.dataset.architecture.toLowerCase() === 'clip';
            
            if (this.selectedIcon && !isClipModel) {
                const modelPath = this.selectedIcon.dataset.path;
                try {
                    const presets = await invoke('get_model_presets', { modelPath: modelPath });
                    if (presets && presets.length > 1) {
                        // Multiple presets - show submenu
                        hasMultiplePresets = true;
                        presetsHTML = '<div class="context-menu-submenu">';
                        presetsHTMLExternal = '<div class="context-menu-submenu">';
                        presets.forEach(preset => {
                            const defaultBadge = preset.is_default ? ' <span class="material-icons" style="font-size: 12px; vertical-align: middle;">home</span>' : '';
                            presetsHTML += `<div class="context-menu-item" data-action="launch-preset" data-preset-id="${preset.id}">${preset.name}${defaultBadge}</div>`;
                            presetsHTMLExternal += `<div class="context-menu-item" data-action="launch-preset-external" data-preset-id="${preset.id}">${preset.name}${defaultBadge}</div>`;
                        });
                        presetsHTML += '</div>';
                        presetsHTMLExternal += '</div>';
                    }
                    // For single preset or no presets, we don't show submenu - clicking directly launches
                } catch (error) {
                    console.error('Error loading presets:', error);
                }
            }

            // Build menu items - hide launch and properties for clip models
            let menuItemsContent = '';
            
            if (!isClipModel) {
                // Show launch options for non-clip models
                menuItemsContent = `
                    <div class="context-menu-item${hasMultiplePresets ? ' has-submenu' : ''}" data-action="open">
                        <div class="menu-item-content">
                            <span class="material-icons">rocket_launch</span>
                            <span>Launch Model</span>
                        </div>
                        ${hasMultiplePresets ? '<span class="material-icons submenu-arrow">chevron_right</span>' : ''}
                    </div>
                    ${presetsHTML}
                    <div class="context-menu-item${hasMultiplePresets ? ' has-submenu' : ''}" data-action="launch-external">
                        <div class="menu-item-content">
                            <span class="material-icons">computer</span>
                            <span>Launch as External Terminal</span>
                        </div>
                        ${hasMultiplePresets ? '<span class="material-icons submenu-arrow">chevron_right</span>' : ''}
                    </div>
                    ${presetsHTMLExternal}
                    <div class="context-menu-separator"></div>
                `;
            }
            
            menuItems = menuItemsContent + `
                <div class="context-menu-item" data-action="delete">
                    <div class="menu-item-content">
                        <span class="material-icons" style="color: #e74c3c;">delete</span>
                        <span style="color: #e74c3c;">Delete</span>
                    </div>
                </div>
                <div class="context-menu-item" data-action="open-folder">
                    <div class="menu-item-content">
                        <span class="material-icons">folder_open</span>
                        <span>Open Model Folder</span>
                    </div>
                </div>
                ${!isClipModel ? `
                <div class="context-menu-item" data-action="properties">
                    <div class="menu-item-content">
                        <span class="material-icons">settings</span>
                        <span>Properties</span>
                    </div>
                </div>
                ` : ''}
            `;
        }

        // Don't show menu if there are no items
        if (!menuItems || menuItems.trim() === '') {
            return;
        }

        contextMenu.innerHTML = menuItems;

        // Show the menu temporarily to get its dimensions
        contextMenu.style.visibility = 'hidden';
        contextMenu.classList.remove('hidden');

        const menuRect = contextMenu.getBoundingClientRect();
        const menuWidth = menuRect.width;
        const menuHeight = menuRect.height;

        // Hide it again
        contextMenu.classList.add('hidden');
        contextMenu.style.visibility = 'visible';

        // Calculate position with proper boundary checking
        let left = x;
        let top = y;

        // Check right boundary
        if (left + menuWidth > window.innerWidth) {
            left = window.innerWidth - menuWidth - 10;
        }

        // Check bottom boundary - this is the key fix
        if (top + menuHeight > window.innerHeight - 48) { // 48px for taskbar
            top = y - menuHeight; // Position above cursor
            // If still too high, position at top of available space
            if (top < 10) {
                top = 10;
            }
        }

        // Ensure minimum margins
        left = Math.max(10, left);
        top = Math.max(10, top);

        contextMenu.style.left = left + 'px';
        contextMenu.style.top = top + 'px';
        contextMenu.classList.remove('hidden');

        // Close menu when mouse leaves it
        const hideMenuOnLeave = () => {
            this.hideContextMenu();
            contextMenu.removeEventListener('mouseleave', hideMenuOnLeave);
        };
        contextMenu.addEventListener('mouseleave', hideMenuOnLeave);

        // Setup submenu hover behavior for Launch Model
        const launchItem = contextMenu.querySelector('[data-action="open"]');
        const submenu = launchItem?.nextElementSibling;
        if (launchItem && submenu && submenu.classList.contains('context-menu-submenu')) {
            this.setupSubmenuBehavior(launchItem, submenu);
        }

        // Setup submenu hover behavior for Launch External
        const launchExternalItem = contextMenu.querySelector('[data-action="launch-external"]');
        const submenuExternal = launchExternalItem?.nextElementSibling;
        if (launchExternalItem && submenuExternal && submenuExternal.classList.contains('context-menu-submenu')) {
            this.setupSubmenuBehavior(launchExternalItem, submenuExternal);
        }
    }

    setupSubmenuBehavior(menuItem, submenu) {
        // Calculate the proper position for the submenu based on the parent item's position
        // Use position: absolute relative to the context menu container
        const updateSubmenuPosition = () => {
            const contextMenu = document.getElementById('context-menu');
            if (!contextMenu) return;
            
            const contextMenuRect = contextMenu.getBoundingClientRect();
            const menuItemRect = menuItem.getBoundingClientRect();
            
            // Calculate position relative to the context menu
            const left = menuItemRect.right - contextMenuRect.left;
            let top = menuItemRect.top - contextMenuRect.top;
            
            const submenuHeight = submenu.offsetHeight || 150;
            
            // Check if submenu would go below the context menu
            if (top + submenuHeight > contextMenu.offsetHeight) {
                top = contextMenu.offsetHeight - submenuHeight;
            }
            
            // Ensure minimum top position
            top = Math.max(0, top);
            
            submenu.style.position = 'absolute';
            submenu.style.left = left + 'px';
            submenu.style.top = top + 'px';
        };
        
        menuItem.addEventListener('mouseenter', () => {
            updateSubmenuPosition();
            submenu.classList.add('show');
        });
        menuItem.addEventListener('mouseleave', (e) => {
            if (!submenu.contains(e.relatedTarget)) {
                setTimeout(() => {
                    if (!submenu.matches(':hover')) {
                        submenu.classList.remove('show');
                    }
                }, 100);
            }
        });
        submenu.addEventListener('mouseleave', () => {
            submenu.classList.remove('show');
        });
    }

    hideContextMenu() {
        const contextMenu = document.getElementById('context-menu');
        if (contextMenu) contextMenu.classList.add('hidden');
        
        // Remove menu-open class from all model cards
        document.querySelectorAll('.model-card.menu-open').forEach(card => {
            card.classList.remove('menu-open');
        });
    }

    hideDockContextMenu() {
        const dockContextMenu = document.getElementById('dock-context-menu');
        if (dockContextMenu) dockContextMenu.classList.add('hidden');
    }

    showDockContextMenu(x, y, dockItem) {
        const dockContextMenu = document.getElementById('dock-context-menu');
        if (!dockContextMenu) return;

        // Hide other menus
        this.hideContextMenu();

        const windowId = dockItem.id.replace('taskbar-', '');
        const isPermanent = dockItem.classList.contains('permanent');
        const window = this.windows.get(windowId);

        let menuItems = '';

        if (isPermanent) {
            // Permanent app icons (Search, Settings, HuggingFace, Llama.cpp, Downloads)
            const appType = dockItem.dataset.app;
            menuItems = `
                <div class="context-menu-item" data-action="open-app" data-app="${appType}">
                    <span class="material-icons">open_in_new</span>
                    <span class="menu-item-content">Open</span>
                </div>
            `;
        } else if (window) {
            // Running application
            const isMinimized = window.style.display === 'none' || window.classList.contains('hidden');
            const isMaximized = window.classList.contains('maximized');

            menuItems = `
                <div class="context-menu-item" data-action="show-window" data-window-id="${windowId}">
                    <span class="material-icons">${isMinimized ? 'visibility' : 'visibility_off'}</span>
                    <span class="menu-item-content">${isMinimized ? 'Show' : 'Hide'}</span>
                </div>
                <div class="context-menu-item" data-action="minimize-window" data-window-id="${windowId}">
                    <span class="material-icons">minimize</span>
                    <span class="menu-item-content">Minimize</span>
                </div>
                <div class="context-menu-item" data-action="maximize-window" data-window-id="${windowId}">
                    <span class="material-icons">${isMaximized ? 'fullscreen_exit' : 'fullscreen'}</span>
                    <span class="menu-item-content">${isMaximized ? 'Restore' : 'Maximize'}</span>
                </div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="close-window" data-window-id="${windowId}">
                    <span class="material-icons">close</span>
                    <span class="menu-item-content">Close</span>
                </div>
            `;
        }

        dockContextMenu.innerHTML = menuItems;

        // Show menu temporarily to get its height
        dockContextMenu.style.visibility = 'hidden';
        dockContextMenu.classList.remove('hidden');

        // Position the menu above the cursor
        const rect = dockContextMenu.getBoundingClientRect();
        let menuX = x;
        let menuY = y - rect.height - 10; // 10px gap above cursor

        // Adjust horizontal position if menu goes off screen
        if (menuX + rect.width > window.innerWidth) {
            menuX = window.innerWidth - rect.width - 10;
        }
        if (menuX < 10) {
            menuX = 10;
        }

        // If menu would go above screen, show it below cursor instead
        if (menuY < 10) {
            menuY = y + 10;
        }

        dockContextMenu.style.left = `${menuX}px`;
        dockContextMenu.style.top = `${menuY}px`;
        dockContextMenu.style.visibility = 'visible';

        // Add click handler for menu items
        const handleMenuClick = (e) => {
            const actionElement = e.target.closest('[data-action]');
            if (!actionElement) return;

            const action = actionElement.dataset.action;

            if (action === 'open-app') {
                const appType = actionElement.dataset.app;
                if (appType === 'search') {
                    this.toggleSearchBalloon();
                } else if (appType === 'downloads') {
                    if (downloadManager) {
                        downloadManager.toggleDownloadHistory();
                    }
                } else if (appType === 'settings') {
                    this.toggleSettingsPanel();
                } else if (appType === 'huggingface') {
                    if (huggingFaceApp) {
                        huggingFaceApp.openHuggingFaceSearch().catch(error => {
                            console.error('Error opening HuggingFace search:', error);
                            this.showNotification('Error opening HuggingFace app', 'error');
                        });
                    }
                } else if (appType === 'llamacpp') {
                    if (llamacppReleasesManager) {
                        llamacppReleasesManager.showLlamaCppManager();
                    }
                }
            } else if (action === 'show-window') {
                const winId = actionElement.dataset.windowId;
                const win = this.windows.get(winId);
                if (win) {
                    const isHidden = win.style.display === 'none' || win.classList.contains('hidden');
                    if (isHidden) {
                        win.style.display = 'block';
                        win.classList.remove('hidden');
                        win.style.zIndex = ++this.windowZIndex;
                    } else {
                        this.minimizeWindow(winId);
                    }
                }
            } else if (action === 'minimize-window') {
                const winId = actionElement.dataset.windowId;
                this.minimizeWindow(winId);
            } else if (action === 'maximize-window') {
                const winId = actionElement.dataset.windowId;
                this.maximizeWindow(winId);
            } else if (action === 'close-window') {
                const winId = actionElement.dataset.windowId;
                this.closeWindow(winId);
            }

            this.hideDockContextMenu();
            dockContextMenu.removeEventListener('click', handleMenuClick);
        };

        dockContextMenu.addEventListener('click', handleMenuClick);
    }

    showModelHint(icon) {
        if (this.hintTimer) {
            clearTimeout(this.hintTimer);
        }

        this.hintTimer = setTimeout(() => {
            const hint = document.getElementById('model-hint');
            if (!hint) return;

            const name = icon.dataset.name.replace('.gguf', '');
            const sizeRaw = icon.dataset.size;
            const arch = icon.dataset.architecture;
            const quant = icon.dataset.quantization;
            const dateTime = new Date(parseFloat(icon.dataset.date) * 1000).toLocaleString(undefined, { hour12: false });

            // Format the size properly - round to 2 decimal places and ensure it's a number
            const sizeGB = parseFloat(sizeRaw);
            const formattedSize = isNaN(sizeGB) ? 'Unknown' : sizeGB.toFixed(2);

            hint.innerHTML = `
                <strong>${name}</strong>
                <hr>
                <span>Architecture:</span> ${arch}<br>
                <span>Quantization:</span> ${quant}<br>
                <span>Size:</span> ${formattedSize} GB<br>
                <span>Modified:</span> ${dateTime}
            `;

            const rect = icon.getBoundingClientRect();
            hint.style.left = `${rect.right + 10}px`;
            hint.style.top = `${rect.top}px`;
            hint.classList.remove('hidden');
        }, 500);
    }

    hideModelHint() {
        if (this.hintTimer) {
            clearTimeout(this.hintTimer);
        }
        const hint = document.getElementById('model-hint');
        if (hint) {
            hint.classList.add('hidden');
        }
    }

    toggleArchitectureModels(icon) {
        const arch = icon.dataset.architecture;
        if (!arch) return;

        // Show the folder view for this architecture
        this.showArchitectureFolderView(arch);
    }

    async showArchitectureFolderView(arch, openWithSearchHistory = false) {
        // Close downloads folder view if open
        if (window.downloadManager) {
            window.downloadManager.hideDownloadManager();
        }
        
        const folderView = document.getElementById('search-folder-view');
        const folderGrid = document.getElementById('search-folder-grid');
        const folderTitle = document.getElementById('search-folder-title');
        const folderStats = document.getElementById('search-folder-stats');
        const searchFolderInput = document.getElementById('search-folder-input');

        if (!folderView || !folderGrid) return;

        // Get models for this architecture
        let models;
        if (arch === 'All') {
            models = [];
            Object.values(this.modelsByArchitecture).forEach(m => {
                // Avoid duplicates if 'All' was already in modelsByArchitecture
                // (though we expect to filter it out or not have it)
                // Filter out CLIP models if hideSuppressedModels is enabled
                if (this.hideSuppressedModels) {
                    m.filter(model => {
                        const modelArch = (model.architecture || '').toLowerCase();
                        return modelArch !== 'clip';
                    }).forEach(model => models.push(model));
                } else {
                    models.push(...m);
                }
            });
        } else {
            models = this.modelsByArchitecture[arch] || [];
        }

        const modelCount = models.length;
        let totalSize = 0;
        models.forEach(m => totalSize += parseFloat(m.size_gb) || 0);

        // Update header
        folderTitle.textContent = arch === 'All' ? 'Models' : arch;
        folderStats.textContent = `${modelCount} model${modelCount !== 1 ? 's' : ''} • ${totalSize.toFixed(2)} GB`;

        // Build model cards
        const buildCardsHTML = async () => {
            const cardsHTMLPromises = models.map(async (model) => {
                const sizeGB = parseFloat(model.size_gb).toFixed(2);
                let hasCustomArgs = false;
                try {
                    hasCustomArgs = await this.hasCustomArguments(model.path);
                } catch (error) {
                    console.error(`Error checking custom args for ${model.name}:`, error);
                }
                const customArgsIndicator = hasCustomArgs ? '<div class="model-card-custom-indicator"></div>' : '';

                // Check if this is a clip model
                const isClipModel = model.architecture && model.architecture.toLowerCase() === 'clip';
                const clipModelClass = isClipModel ? ' clip-model' : '';

                // Format the date
                const formattedDate = this.formatDate(parseFloat(model.date));

                // Get model_name (general.name from GGUF) if available
                // Only show if it's different from the filename
                const fileName = model.name.replace('.gguf', '');
                const modelName = model.model_name || '';
                const displayModelName = (modelName && modelName !== fileName && modelName !== model.name) 
                    ? `<span class="model-card-general-name">${modelName}</span>` 
                    : '';

                // Action buttons HTML based on model type
                let actionButtonsHTML = '';
                if (isClipModel) {
                    // Reduced options for CLIP/faint models - no divider needed
                    actionButtonsHTML = `
                        <div class="action-buttons-right no-divider">
                            <button class="action-btn open-folder" data-action="open-folder" title="Open Folder">
                                <span class="material-icons">folder</span>
                            </button>
                            <button class="action-btn delete" data-action="delete" title="Delete Model">
                                <span class="material-icons">delete</span>
                            </button>
                        </div>
                    `;
                } else {
                    // Full options for standard models
                    actionButtonsHTML = `
                        <div class="action-buttons-left">
                            <button class="action-btn launch" data-action="launch-internal" title="Launch Model">
                                <span class="material-icons">rocket_launch</span>
                            </button>
                            <button class="action-btn launch-external" data-action="launch-external" title="Launch External">
                                <span class="material-icons">computer</span>
                            </button>
                            <button class="action-btn properties" data-action="properties" title="Model Properties">
                                <span class="material-icons">settings</span>
                            </button>
                        </div>
                        <div class="action-buttons-right">
                            <button class="action-btn open-folder" data-action="open-folder" title="Open Folder">
                                <span class="material-icons">folder</span>
                            </button>
                            <button class="action-btn delete" data-action="delete" title="Delete Model">
                                <span class="material-icons">delete</span>
                            </button>
                        </div>
                    `;
                }

                return `
                    <div class="model-card${clipModelClass}" data-path="${model.path}" data-name="${model.name}"
                         data-size="${model.size_gb}" data-architecture="${model.architecture}"
                         data-quantization="${model.quantization}" data-date="${model.date}">
                        <div class="model-card-content">
                            <div class="model-card-icon">
                                <img src="./assets/gguf.png">
                                ${customArgsIndicator}
                            </div>
                            <div class="model-card-info">
                                <h3 class="model-card-name">
                                    ${fileName}
                                    ${displayModelName}
                                </h3>
                                <div class="model-card-details">
                                    <span class="model-card-tag">${model.architecture}</span>
                                    <span class="model-card-tag">${model.quantization}</span>
                                    <span class="model-card-tag">${sizeGB} GB</span>
                                    <span class="model-card-detail-separator">•</span>
                                    <span class="model-card-detail-value date-modified">${formattedDate}</span>
                                </div>
                            </div>
                        </div>
                        <div class="model-card-action-tab">
                            ${actionButtonsHTML}
                        </div>
                        <button class="model-card-favorite-btn ${this.isFavorite(model.path) ? 'active' : ''}" data-action="favorite" title="${this.isFavorite(model.path) ? 'Remove from favorites' : 'Add to favorites'}">
                            <span class="material-icons">${this.isFavorite(model.path) ? 'star' : 'star_border'}</span>
                        </button>
                    </div>
                `;
            });

            const cardsHTMLArray = await Promise.all(cardsHTMLPromises);
            return cardsHTMLArray.join('');
        };

        // Build and set the HTML
        const cardsHTML = await buildCardsHTML();
        folderGrid.innerHTML = cardsHTML || '<div style="grid-column: 1/-1; padding: 60px; text-align: center; color: rgba(255,255,255,0.5); font-size: 18px;">No models found</div>';

        // Restore the search input value only for "All Models" folder
        if (arch === 'All' && searchFolderInput && this.searchFolderInputValue && this.searchFolderInputValue.trim() !== '') {
            searchFolderInput.value = this.searchFolderInputValue;
            // Trigger the filter function after cards are rendered
            this.filterFolderViewModels(this.searchFolderInputValue);
        } else {
            // Clear the filter input for architecture folders or no saved value
            if (searchFolderInput) {
                searchFolderInput.value = '';
            }
        }

        // Update sort button states
        this.updateFolderSortButtons();
        this.updateHideSuppressedButton();

        // Add click handlers for model cards
        folderGrid.querySelectorAll('.model-card').forEach(card => {
            card.addEventListener('click', async (e) => {
                // Hide any open context/preset menus
                this.hideContextMenu();
                e.stopPropagation();
                
                // Check if clicking on action tab buttons
                const actionBtn = e.target.closest('.action-btn');
                if (actionBtn) {
                    const action = actionBtn.dataset.action;
                    const tempIcon = document.createElement('div');
                    tempIcon.dataset.path = card.dataset.path;
                    tempIcon.dataset.name = card.dataset.name;
                    tempIcon.dataset.size = card.dataset.size;
                    tempIcon.dataset.architecture = card.dataset.architecture;
                    tempIcon.dataset.quantization = card.dataset.quantization;
                    tempIcon.dataset.date = card.dataset.date;
                    
                    if (action === 'launch-internal') {
                        // Check for presets and launch
                        const modelPath = card.dataset.path;
                        try {
                            const presets = await invoke('get_model_presets', { modelPath: modelPath });
                            if (presets && presets.length > 1) {
                                // Show preset menu
                                this.showPresetMenuForCard(actionBtn, tempIcon, presets, false);
                            } else if (presets && presets.length === 1) {
                                // Exactly one preset, launch it directly
                                await this.launchModelWithPreset(tempIcon, presets[0].id);
                            } else {
                                // No presets, launch directly
                                await this.launchModel(tempIcon);
                            }
                        } catch (error) {
                            console.error('Error loading presets:', error);
                            await this.launchModel(tempIcon);
                        }
                    } else if (action === 'launch-external') {
                        // Check for presets and launch external
                        const modelPath = card.dataset.path;
                        try {
                            const presets = await invoke('get_model_presets', { modelPath: modelPath });
                            if (presets && presets.length > 1) {
                                // Show preset menu
                                this.showPresetMenuForCard(actionBtn, tempIcon, presets, true);
                            } else if (presets && presets.length === 1) {
                                // Exactly one preset, launch it directly
                                await this.launchModelWithPresetExternal(tempIcon, presets[0].id);
                            } else {
                                // No presets, launch directly
                                await this.launchModelExternal(tempIcon);
                            }
                        } catch (error) {
                            console.error('Error loading presets:', error);
                            await this.launchModelExternal(tempIcon);
                        }
                    } else if (action === 'properties') {
                        this.showProperties(tempIcon);
                    } else if (action === 'delete') {
                        this.deleteModelFile(tempIcon);
                    } else if (action === 'open-folder') {
                        this.openModelFolder(tempIcon);
                    }
                    return;
                }
                
                // Don't show tab if clicking on the favorite button
                if (e.target.closest('.model-card-favorite-btn')) return;

                // Selection is now handled by hover in CSS
                });
            // Add click handler for favorite button
            const favBtn = card.querySelector('.model-card-favorite-btn');
            if (favBtn) {
                favBtn.addEventListener('click', (e) => {
                    this.toggleFavorite(card.dataset.path, e);
                });
            }
        });

        // Apply current sort settings BEFORE showing to avoid blinking/jumping
        this.applyFolderSort();

        // Update model indicators (both running status and custom args)
        await this.updateCustomArgsIndicators();

        // Show the folder view
        folderView.classList.remove('hidden');

        // Ensure folder view is always on top of all windows
        folderView.style.zIndex = ++this.windowZIndex;

        // Set active state on the search dock icon
        this.updateTaskbarButtonState('search-dock-icon', true);

        // Click outside to close (since overlay is removed)
        const closeOnOutsideClick = (e) => {
            if (e.target === folderView) {
                const folderTitle = document.getElementById('search-folder-title');
                const isAllModels = folderTitle && folderTitle.textContent === 'Models';
                this.hideSearchFolderView(isAllModels);
                folderView.removeEventListener('click', closeOnOutsideClick);
            }
        };
        folderView.addEventListener('click', closeOnOutsideClick);

        // Focus the filter input
        if (searchFolderInput) {
            setTimeout(() => {
                searchFolderInput.focus();
                // Show history automatically only if explicitly requested (e.g. from dock search)
                if (openWithSearchHistory && searchHistory.hasHistory()) {
                    const dropdown = document.getElementById('search-folder-history-dropdown');
                    if (dropdown) {
                        this.updateSearchHistoryDropdown(null, 'search-folder-history-list');
                        dropdown.classList.add('show');
                    }
                }
            }, 300);
        }

        console.log(`Architecture folder view: ${modelCount} models in ${arch}`);
    }

    setupSearchFolderListeners() {
        const searchInput = document.getElementById('search-folder-input');
        const dropdown = document.getElementById('search-folder-history-dropdown');
        const historyList = document.getElementById('search-folder-history-list');
        const clearAllBtn = document.getElementById('search-folder-history-clear-all');
        const hfBtn = document.getElementById('search-folder-hf');
        const clearBtn = document.getElementById('search-folder-clear');
        const backBtn = document.getElementById('search-folder-back');
        const overlay = document.querySelector('.search-folder-overlay');
        const sortButtons = document.querySelectorAll('.search-folder-sort-controls .sort-btn');

        if (searchInput) {
            searchInput.addEventListener('click', (e) => {
                e.stopPropagation();
                if (dropdown) {
                    this.updateSearchHistoryDropdown(searchInput.value, 'search-folder-history-list');
                    if (dropdown.classList.contains('show')) {
                        dropdown.classList.remove('show');
                    } else if (searchHistory.hasHistory()) {
                        dropdown.classList.add('show');
                    }
                }
            });

            searchInput.addEventListener('input', (e) => {
                const term = e.target.value;
                this.filterFolderModels(term);
                if (dropdown) {
                    this.updateSearchHistoryDropdown(term, 'search-folder-history-list');
                    if (term.trim() !== '' && searchHistory.hasHistory()) {
                        dropdown.classList.add('show');
                    } else {
                        dropdown.classList.remove('show');
                    }
                }
            });

            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const term = searchInput.value.trim();
                    if (term) {
                        searchHistory.addSearch(term);
                        this.updateSearchHistoryDropdown(null, 'search-folder-history-list');
                        if (dropdown) dropdown.classList.remove('show');
                    }
                }
            });
        }

        if (historyList) {
            historyList.addEventListener('click', (e) => {
                const item = e.target.closest('.search-history-item');
                if (item) {
                    const deleteBtn = e.target.closest('.search-history-delete');
                    if (deleteBtn) {
                        const term = deleteBtn.dataset.term;
                        searchHistory.removeSearch(term);
                        this.updateSearchHistoryDropdown(searchInput.value, 'search-folder-history-list');
                    } else {
                        const term = item.dataset.term;
                        if (searchInput) {
                            searchInput.value = term;
                            this.filterFolderModels(term);
                            if (dropdown) dropdown.classList.remove('show');
                        }
                    }
                }
            });
        }

        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', async () => {
                const confirmed = await ModalDialog.showConfirmation({
                    title: 'Clear Search History',
                    message: 'Are you sure you want to clear your entire search history?',
                    confirmLabel: 'Clear All',
                    cancelLabel: 'Cancel',
                    type: 'warning'
                });
                if (confirmed) {
                    searchHistory.clearHistory();
                    this.updateSearchHistoryDropdown(null, 'search-folder-history-list');
                    if (dropdown) dropdown.classList.remove('show');
                }
            });
        }

        if (hfBtn) {
            hfBtn.addEventListener('click', async () => {
                const term = searchInput ? searchInput.value.trim() : '';
                if (typeof huggingFaceApp !== 'undefined' && huggingFaceApp) {
                    try {
                        // Close search folder view if needed
                        const folderTitle = document.getElementById('search-folder-title');
                        const isAllModels = folderTitle && folderTitle.textContent === 'Models';
                        this.hideSearchFolderView(isAllModels);

                        await huggingFaceApp.openHuggingFaceSearch();
                        if (term) {
                            setTimeout(() => {
                                const hfWindow = this.windows.get('huggingface-search');
                                if (hfWindow) {
                                    const hfInput = hfWindow.querySelector('#hf-search-input');
                                    if (hfInput) {
                                        hfInput.value = term;
                                        huggingFaceApp.performHuggingFaceSearch();
                                    }
                                }
                            }, 200);
                        }
                    } catch (error) {
                        console.error('Error opening HuggingFace search:', error);
                        this.showNotification('Error opening HuggingFace app', 'error');
                    }
                } else {
                    const url = term ? `https://huggingface.co/models?search=${encodeURIComponent(term)}` : 'https://huggingface.co';
                    invoke('open_external_link', { url });
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (searchInput) {
                    searchInput.value = '';
                    this.filterFolderModels('');
                    if (dropdown) dropdown.classList.remove('show');
                }
            });
        }

        if (backBtn) {
            backBtn.addEventListener('click', () => {
                // Check if we're in "All Models" folder
                const folderTitle = document.getElementById('search-folder-title');
                const isAllModels = folderTitle && folderTitle.textContent === 'Models';
                this.hideSearchFolderView(isAllModels);
            });
        }

        if (overlay) {
            overlay.addEventListener('click', () => {
                // Check if we're in "All Models" folder
                const folderTitle = document.getElementById('search-folder-title');
                const isAllModels = folderTitle && folderTitle.textContent === 'Models';
                this.hideSearchFolderView(isAllModels);
            });
        }

        // Sort buttons
        sortButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const sortType = btn.dataset.sort;
                const isFavoritesToggle = btn.dataset.action === 'toggle-favorites';
                const isHideSuppressedToggle = btn.id === 'hide-suppressed-btn';
                
                if (isHideSuppressedToggle) {
                    // Toggle hiding of suppressed (CLIP) models
                    this.hideSuppressedModels = !this.hideSuppressedModels;
                    localStorage.setItem('hideSuppressedModels', this.hideSuppressedModels);
                    // Update button icon and refresh the view if showing All Models
                    this.updateHideSuppressedButton();
                    const folderTitle = document.getElementById('search-folder-title');
                    if (folderTitle && folderTitle.textContent === 'Models') {
                        this.showArchitectureFolderView('All');
                    }
                } else if (isFavoritesToggle) {
                    // Toggle favorites on top
                    this.folderSortFavoritesFirst = !this.folderSortFavoritesFirst;
                    localStorage.setItem('folderSortFavoritesFirst', this.folderSortFavoritesFirst);
                    // Re-sort with new setting
                    this.applyFolderSort();
                    this.updateFolderSortButtons();
                } else if (sortType) {
                    this.sortFolderView(sortType);
                }
            });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (dropdown && !dropdown.contains(e.target) && searchInput && !searchInput.contains(e.target)) {
                dropdown.classList.remove('show');
            }
        });
    }

    filterFolderModels(term) {
        const grid = document.getElementById('search-folder-grid');
        if (!grid) return;

        const lowerTerm = term.toLowerCase().trim();
        const cards = grid.querySelectorAll('.model-card');

        cards.forEach(card => {
            const name = card.dataset.name.toLowerCase();
            const arch = card.dataset.architecture.toLowerCase();

            // Use fuzzy search for better matching
            if (lowerTerm === '' || this.fuzzyMatch(lowerTerm, name) || this.fuzzyMatch(lowerTerm, arch)) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    }

    showArchitectureModels(icon) {
        // Deprecated - now using showArchitectureFolderView
        const arch = icon.dataset.architecture;
        if (arch) {
            this.showArchitectureFolderView(arch);
        }
    }

    hideArchitectureModels() {
        // Deprecated - this used to hide the old popup list view
        // Now we don't automatically hide the folder view since it's a full-screen experience
        // The folder view should only be closed by the back button or clicking the overlay
    }

    toggleStartMenu() {
        const startMenu = document.getElementById('start-menu');
        if (startMenu) {
            startMenu.classList.toggle('hidden');
        }
    }

    toggleSearchBalloon() {
        const searchBalloon = document.getElementById('search-balloon');
        const searchDockIcon = document.getElementById('search-dock-icon');
        const searchInput = document.getElementById('search-input');

        if (searchBalloon) {
            const isHidden = searchBalloon.classList.contains('hidden');

            // Hide all other popups
            this.hideContextMenu();

            // Collapse memory monitor
            const memoryMonitor = document.getElementById('desktop-memory-monitor');
            if (memoryMonitor) {
                memoryMonitor.classList.remove('expanded');
                memoryMonitor.classList.remove('active');
            }

            // Close downloads folder view if open
            if (window.downloadManager) {
                window.downloadManager.hideDownloadManager();
            }

            // Close search folder view if open (search balloon takes priority)
            const folderView = document.getElementById('search-folder-view');
            if (folderView && !folderView.classList.contains('hidden')) {
                folderView.classList.add('hidden');
                this.updateTaskbarButtonState('search-dock-icon', false);
            }

            if (isHidden) {
                // Show search balloon centered above dock
                searchBalloon.classList.remove('hidden');
                if (searchDockIcon) {
                    searchDockIcon.classList.add('active');
                }
                // Hide model hint if visible
                this.hideModelHint();
                // Focus the input field
                if (searchInput) {
                    setTimeout(() => searchInput.focus(), 300);
                }
            } else {
                // Hide search balloon
                if (searchDockIcon) {
                    searchDockIcon.classList.remove('active');
                }
                // Clear search when hiding
                if (searchInput) {
                    searchInput.value = '';
                    this.filterDesktopIcons('');
                }
                searchBalloon.classList.add('hidden');
                // Hide history dropdown
                const dropdown = document.getElementById('search-history-dropdown');
                if (dropdown) {
                    dropdown.classList.remove('show');
                }
            }
        }
    }

    updateSearchHistoryDropdown(filterTerm = null, listId = 'search-history-list') {
        const historyList = document.getElementById(listId);
        if (!historyList) return;

        let history = searchHistory.getHistory(30); // Show up to 30 items

        // Filter history based on the current search term if provided
        if (filterTerm && filterTerm.trim() !== '') {
            const lowerFilterTerm = filterTerm.toLowerCase().trim();
            history = history.filter(term =>
                term.toLowerCase().includes(lowerFilterTerm)
            );
        } else {
            // If no filter, limit to 10 for display purposes
            history = history.slice(0, 10);
        }

        if (history.length === 0) {
            historyList.innerHTML = '<li class="search-history-empty">No matching searches</li>';
            return;
        }

        historyList.innerHTML = history.map(term => `
            <li class="search-history-item" data-term="${this.escapeHtml(term)}">
                <span class="search-history-text">${this.escapeHtml(term)}</span>
                <button class="search-history-delete" data-term="${this.escapeHtml(term)}" title="Remove">
                    <span class="material-icons">close</span>
                </button>
            </li>
        `).join('');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Fuzzy search - checks if all characters in the search term appear in order in the target string
    fuzzyMatch(searchTerm, target) {
        const searchLower = searchTerm.toLowerCase().replace(/\s+/g, '');
        const targetLower = target.toLowerCase();
        
        let searchIndex = 0;
        for (let i = 0; i < targetLower.length && searchIndex < searchLower.length; i++) {
            if (targetLower[i] === searchLower[searchIndex]) {
                searchIndex++;
            }
        }
        
        return searchIndex === searchLower.length;
    }

    filterDesktopIcons(searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        const cleanTerm = term.replace(/[^a-z0-9]/g, '');

        if (cleanTerm === '') {
            // No search term - hide search folder view and show desktop
            const folderTitle = document.getElementById('search-folder-title');
            const isAllModels = folderTitle && folderTitle.textContent === 'Models';
            this.hideSearchFolderView(isAllModels);
        } else {
            // Search term present - show search folder view
            this.showSearchFolderView(cleanTerm);
        }
    }

    async showSearchFolderView(cleanTerm) {
        // Close downloads folder view if open
        if (window.downloadManager) {
            window.downloadManager.hideDownloadManager();
        }
        
        const folderView = document.getElementById('search-folder-view');
        const folderGrid = document.getElementById('search-folder-grid');
        const folderTitle = document.getElementById('search-folder-title');
        const folderStats = document.getElementById('search-folder-stats');
        const searchFolderInput = document.getElementById('search-folder-input');

        if (!folderView || !folderGrid) return;

        // Collect all matching models
        const matchingModels = [];
        Object.keys(this.modelsByArchitecture).forEach(arch => {
            const archModels = this.modelsByArchitecture[arch];
            // Filter out CLIP models if hideSuppressedModels is enabled
            const filteredModels = this.hideSuppressedModels 
                ? archModels.filter(model => (model.architecture || '').toLowerCase() !== 'clip')
                : archModels;
            filteredModels.forEach(model => {
                const modelName = (model.name || '').toLowerCase();
                const cleanModelName = modelName.replace(/[^a-z0-9]/g, '');
                if (cleanModelName.includes(cleanTerm)) {
                    matchingModels.push(model);
                }
            });
        });

        const modelCount = matchingModels.length;
        let totalSize = 0;
        matchingModels.forEach(m => totalSize += parseFloat(m.size_gb) || 0);

        // Update header
        folderTitle.textContent = 'Search Results';
        folderStats.textContent = `${modelCount} model${modelCount !== 1 ? 's' : ''} • ${totalSize.toFixed(2)} GB`;

        // Build model cards
        const buildCardsHTML = async () => {
            const cardsHTMLPromises = matchingModels.map(async (model) => {
                const sizeGB = parseFloat(model.size_gb).toFixed(2);
                let hasCustomArgs = false;
                try {
                    hasCustomArgs = await this.hasCustomArguments(model.path);
                } catch (error) {
                    console.error(`Error checking custom args for ${model.name}:`, error);
                }
                const customArgsIndicator = hasCustomArgs ? '<div class="model-card-custom-indicator"></div>' : '';

                // Check if this is a clip model
                const isClipModel = model.architecture && model.architecture.toLowerCase() === 'clip';
                const clipModelClass = isClipModel ? ' clip-model' : '';

                // Format the date
                const formattedDate = this.formatDate(parseFloat(model.date));

                // Action buttons HTML based on model type
                let actionButtonsHTML = '';
                if (isClipModel) {
                    // Reduced options for CLIP/faint models
                    actionButtonsHTML = `
                        <div class="action-buttons-left">
                        </div>
                        <div class="action-buttons-right">
                            <button class="action-btn open-folder" data-action="open-folder" title="Open Folder">
                                <span class="material-icons">folder</span>
                            </button>
                            <button class="action-btn delete" data-action="delete" title="Delete Model">
                                <span class="material-icons">delete</span>
                            </button>
                        </div>
                    `;
                } else {
                    // Full options for standard models
                    actionButtonsHTML = `
                        <div class="action-buttons-left">
                            <button class="action-btn launch" data-action="launch-internal" title="Launch Model">
                                <span class="material-icons">rocket_launch</span>
                            </button>
                            <button class="action-btn launch-external" data-action="launch-external" title="Launch External">
                                <span class="material-icons">computer</span>
                            </button>
                            <button class="action-btn properties" data-action="properties" title="Model Properties">
                                <span class="material-icons">settings</span>
                            </button>
                        </div>
                        <div class="action-buttons-right">
                            <button class="action-btn open-folder" data-action="open-folder" title="Open Folder">
                                <span class="material-icons">folder</span>
                            </button>
                            <button class="action-btn delete" data-action="delete" title="Delete Model">
                                <span class="material-icons">delete</span>
                            </button>
                        </div>
                    `;
                }

                return `
                    <div class="model-card${clipModelClass}" data-path="${model.path}" data-name="${model.name}"
                         data-size="${model.size_gb}" data-architecture="${model.architecture}"
                         data-quantization="${model.quantization}" data-date="${model.date}">
                        <div class="model-card-content">
                            <div class="model-card-icon">
                                <img src="./assets/gguf.png">
                                ${customArgsIndicator}
                            </div>
                            <div class="model-card-info">
                                <h3 class="model-card-name">${model.name.replace('.gguf', '')}</h3>
                                <div class="model-card-details">
                                    <span class="model-card-detail-item">
                                        <span class="model-card-detail-label">Quant:</span>
                                        <span class="model-card-detail-value">${model.quantization}</span>
                                    </span>
                                    <span class="model-card-detail-separator">•</span>
                                    <span class="model-card-detail-item">
                                        <span class="model-card-detail-value">${sizeGB} GB</span>
                                    </span>
                                    <span class="model-card-detail-separator">•</span>
                                    <span class="model-card-detail-item">
                                        <span class="model-card-detail-value date-modified">${formattedDate}</span>
                                    </span>
                                </div>
                            </div>
                            <button class="model-card-favorite-btn ${this.isFavorite(model.path) ? 'active' : ''}" data-action="favorite" title="${this.isFavorite(model.path) ? 'Remove from favorites' : 'Add to favorites'}">
                                <span class="material-icons">${this.isFavorite(model.path) ? 'star' : 'star_border'}</span>
                            </button>
                        </div>
                        <div class="model-card-action-tab">
                            ${actionButtonsHTML}
                        </div>
                    </div>
                `;
            });

            const cardsHTMLArray = await Promise.all(cardsHTMLPromises);
            return cardsHTMLArray.join('');
        };

        // Build and set the HTML
        const cardsHTML = await buildCardsHTML();
        folderGrid.innerHTML = cardsHTML || '<div style="padding: 60px; text-align: center; color: rgba(255,255,255,0.5); font-size: 18px;">No models found</div>';

        // Restore the search input value only when opening "All Models" folder (no search term)
        if (cleanTerm === '' && searchFolderInput && this.searchFolderInputValue && this.searchFolderInputValue.trim() !== '') {
            searchFolderInput.value = this.searchFolderInputValue;
            // Trigger the filter function after cards are rendered
            this.filterFolderModels(this.searchFolderInputValue);
        } else {
            // Clear the filter input for other cases or no saved value
            if (searchFolderInput) {
                searchFolderInput.value = '';
            }
        }

        // Update sort button states
        this.updateFolderSortButtons();
        this.updateHideSuppressedButton();

        // Add click handlers for model cards
        folderGrid.querySelectorAll('.model-card').forEach(card => {
            card.addEventListener('click', async (e) => {
                // Hide any open context/preset menus
                this.hideContextMenu();
                e.stopPropagation();
                
                // Check if clicking on action tab buttons
                const actionBtn = e.target.closest('.action-btn');
                if (actionBtn) {
                    const action = actionBtn.dataset.action;
                    const tempIcon = document.createElement('div');
                    tempIcon.dataset.path = card.dataset.path;
                    tempIcon.dataset.name = card.dataset.name;
                    tempIcon.dataset.size = card.dataset.size;
                    tempIcon.dataset.architecture = card.dataset.architecture;
                    tempIcon.dataset.quantization = card.dataset.quantization;
                    tempIcon.dataset.date = card.dataset.date;
                    
                    if (action === 'launch-internal') {
                        // Check for presets and launch
                        const modelPath = card.dataset.path;
                        try {
                            const presets = await invoke('get_model_presets', { modelPath: modelPath });
                            if (presets && presets.length > 1) {
                                // Show preset menu
                                this.showPresetMenuForCard(actionBtn, tempIcon, presets, false);
                            } else if (presets && presets.length === 1) {
                                // Exactly one preset, launch it directly
                                await this.launchModelWithPreset(tempIcon, presets[0].id);
                            } else {
                                // No presets, launch directly
                                await this.launchModel(tempIcon);
                            }
                        } catch (error) {
                            console.error('Error loading presets:', error);
                            await this.launchModel(tempIcon);
                        }
                    } else if (action === 'launch-external') {
                        // Check for presets and launch external
                        const modelPath = card.dataset.path;
                        try {
                            const presets = await invoke('get_model_presets', { modelPath: modelPath });
                            if (presets && presets.length > 1) {
                                // Show preset menu
                                this.showPresetMenuForCard(actionBtn, tempIcon, presets, true);
                            } else if (presets && presets.length === 1) {
                                // Exactly one preset, launch it directly
                                await this.launchModelWithPresetExternal(tempIcon, presets[0].id);
                            } else {
                                // No presets, launch directly
                                await this.launchModelExternal(tempIcon);
                            }
                        } catch (error) {
                            console.error('Error loading presets:', error);
                            await this.launchModelExternal(tempIcon);
                        }
                    } else if (action === 'properties') {
                        this.showProperties(tempIcon);
                    } else if (action === 'delete') {
                        this.deleteModelFile(tempIcon);
                    } else if (action === 'open-folder') {
                        this.openModelFolder(tempIcon);
                    }
                    return;
                }
                
                // Don't show tab if clicking on the favorite button
                if (e.target.closest('.model-card-favorite-btn')) return;

                // Selection is now handled by hover in CSS
                });
            // Add click handler for favorite button
            const favBtn = card.querySelector('.model-card-favorite-btn');
            if (favBtn) {
                favBtn.addEventListener('click', (e) => {
                    this.toggleFavorite(card.dataset.path, e);
                });
            }
        });

        // Update sort button states
        this.updateFolderSortButtons();

        // Apply current sort settings BEFORE showing to avoid blinking/jumping
        this.applyFolderSort();

        // Update model indicators (both running status and custom args)
        await this.updateCustomArgsIndicators();

        // Show the folder view
        folderView.classList.remove('hidden');
        
        // Ensure search folder view is always on top of all windows
        folderView.style.zIndex = ++this.windowZIndex;

        // Set active state on the search dock icon
        this.updateTaskbarButtonState('search-dock-icon', true);

        // Click outside to close (since overlay is removed)
        const closeOnOutsideClick = (e) => {
            if (e.target === folderView) {
                const folderTitle = document.getElementById('search-folder-title');
                const isAllModels = folderTitle && folderTitle.textContent === 'Models';
                this.hideSearchFolderView(isAllModels);
                folderView.removeEventListener('click', closeOnOutsideClick);
            }
        };
        folderView.addEventListener('click', closeOnOutsideClick);

        // Focus the filter input
        if (searchFolderInput) {
            setTimeout(() => searchFolderInput.focus(), 300);
        }

        console.log(`Search folder view: ${modelCount} models found`);
    }

    hideSearchFolderView(isAllModels = false) {
        const folderView = document.getElementById('search-folder-view');
        const searchFolderInput = document.getElementById('search-folder-input');

        if (folderView) {
            folderView.classList.add('hidden');
        }

        // Remove active state from search dock icon
        this.updateTaskbarButtonState('search-dock-icon', false);

        // Save the search input value only when closing "All Models" folder
        if (isAllModels && searchFolderInput && searchFolderInput.value.trim() !== '') {
            this.searchFolderInputValue = searchFolderInput.value;
        } else {
            this.searchFolderInputValue = '';
        }
    }

    filterFolderViewModels(filterTerm) {
        const folderGrid = document.getElementById('search-folder-grid');
        if (!folderGrid) return;

        const cards = folderGrid.querySelectorAll('.model-card');
        const term = filterTerm.toLowerCase().trim();

        cards.forEach(card => {
            const modelName = (card.dataset.name || '').toLowerCase();
            const arch = (card.dataset.architecture || '').toLowerCase();

            // Use fuzzy search for better matching
            if (term === '' || this.fuzzyMatch(term, modelName) || this.fuzzyMatch(term, arch)) {
                card.style.display = 'flex';
            } else {
                card.style.display = 'none';
            }
        });
    }

    displayArchitectureFolders() {
        const desktopIcons = document.getElementById('desktop-icons');
        if (!desktopIcons || !this.modelsByArchitecture) return;

        // Create architecture folder icons
        Object.keys(this.modelsByArchitecture).sort().forEach(arch => {
            const archModels = this.modelsByArchitecture[arch];

            // Calculate folder stats for sorting
            let totalSize = 0;
            let latestDate = 0;

            archModels.forEach(m => {
                const s = parseFloat(m.size_gb) || 0;
                totalSize += s;

                const d = parseFloat(m.date) || 0;
                if (d > latestDate) latestDate = d;
            });

            // Check if this is a clip architecture folder
            const isClipArch = arch.toLowerCase() === 'clip';
            const clipModelClass = isClipArch ? ' clip-model' : '';

            const archElement = document.createElement('div');
            archElement.className = 'desktop-icon architecture-icon' + clipModelClass;
            archElement.setAttribute('data-architecture', arch);
            archElement.setAttribute('data-model-count', archModels.length);
            archElement.setAttribute('data-name', arch);
            archElement.setAttribute('data-size', totalSize);
            archElement.setAttribute('data-date', latestDate);

            archElement.innerHTML = `
                <div class="icon-image">
                    <span class="material-icons">folder</span>
                    <div class="model-count-badge">${archModels.length}</div>
                </div>
                <div class="icon-label">${arch}</div>
            `;

            desktopIcons.appendChild(archElement);
        });

        // Re-setup event listeners
        this.setupIconDragging();
    }

    displaySearchResults(cleanTerm) {
        // Deprecated - now using showSearchFolderView
        console.log('displaySearchResults is deprecated, use showSearchFolderView instead');
    }

    hideStartMenu() {
        const startMenu = document.getElementById('start-menu');
        if (startMenu) {
            startMenu.classList.add('hidden');
        }
    }

    handleStartMenuAction(action) {
        switch (action) {
            case 'settings':
                this.toggleSettingsPanel();
                break;
            case 'huggingface':
                if (huggingFaceApp) {
                    huggingFaceApp.openHuggingFaceSearch().catch(error => {
                        console.error('Error opening HuggingFace search:', error);
                        this.showNotification('Error opening HuggingFace app', 'error');
                    });
                } else {
                    console.error('HuggingFace app not initialized');
                    // Try to initialize it on demand
                    if (typeof window.HuggingFaceApp !== 'undefined') {
                        console.log('Attempting to initialize HuggingFace app on demand...');
                        huggingFaceApp = new window.HuggingFaceApp(this);
                        if (huggingFaceApp) {
                            huggingFaceApp.openHuggingFaceSearch().catch(error => {
                                console.error('Error opening HuggingFace search after initialization:', error);
                                this.showNotification('Error opening HuggingFace app', 'error');
                            });
                        } else {
                            this.showNotification('Failed to initialize HuggingFace app', 'error');
                        }
                    } else {
                        this.showNotification('HuggingFace app module not loaded', 'error');
                    }
                }
                break;
            case 'llamacpp-manager':
                if (llamacppReleasesManager) {
                    llamacppReleasesManager.showLlamaCppManager();
                } else {
                    console.error('Llama.cpp releases manager not initialized');
                }
                break;
            case 'restart':
                this.restartServer();
                break;
            case 'refresh':
                this.refreshDesktop();
                break;
            case 'about':
                this.showAboutDialog();
                break;
            default:
                console.log('Unknown start menu action:', action);
        }
    }


    async openUrl(url) {
        try {
            // Use our custom Tauri command to open URL in external browser
            if (window.__TAURI__ && window.__TAURI__.core) {
                const { invoke } = window.__TAURI__.core;
                await invoke('open_url', { url });
                console.log('Successfully opened URL in external browser:', url);
            } else {
                // Fallback to window.open for development or if Tauri API not available
                console.log('Tauri API not available, using window.open fallback');
                window.open(url, '_blank');
            }
        } catch (error) {
            console.error('Error opening URL with Tauri command:', error);
            // Fallback to window.open if Tauri command fails
            try {
                console.log('Tauri command failed, using window.open fallback');
                window.open(url, '_blank');
            } catch (fallbackError) {
                console.error('Fallback window.open also failed:', fallbackError);
                this.showNotification('Failed to open URL in browser', 'error');
            }
        }
    }

    async showAboutDialog() {
        // Get the app version from Rust
        let version = "Unknown"; // Default fallback
        try {
            version = await invoke('get_app_version');
        } catch (error) {
            console.error("Failed to get app version:", error);
        }

        const content = `
            <div style="text-align: center; padding: 25px 20px; background: linear-gradient(135deg, var(--theme-surface) 0%, var(--theme-surface-light) 100%); border-radius: 0; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center;">
                <div style="margin-bottom: 18px; display: flex; flex-direction: column; align-items: center;">
                    <img src="./assets/logo.png" style="width: 128px;">
                    <h2 style="margin: 0; font-size: 22px; font-weight: 600; color: var(--theme-text);">Arandu</h2>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--theme-text-muted);">Version ${version}</p>
                </div>
                <div style="border-top: 1px solid var(--theme-border); padding-top: 16px;">
                    <p style="margin: 0 0 8px 0; font-size: 13px; color: var(--theme-text); font-weight: 500;">Created by</p>
                    <p style="margin: 0 0 14px 0; font-size: 15px; color: var(--theme-accent); font-weight: 600;">Alfredo Fernandes</p>
                    <a href="#" onclick="desktop.openUrl('https://github.com/fredconex/Arandu')" style="display: inline-flex; align-items: center; gap: 5px; color: var(--theme-accent); text-decoration: none; font-size: 13px; font-weight: 500; padding: 6px 10px; border: 1px solid var(--theme-accent); border-radius: 5px; transition: all 0.2s ease; cursor: pointer;" onmouseover="this.style.background='var(--theme-accent)'; this.style.color='var(--theme-surface)';" onmouseout="this.style.background='transparent'; this.style.color='var(--theme-accent)';">
                        <span class="material-icons" style="font-size: 14px;">code</span>
                        GitHub
                    </a>
                </div>
            </div>
        `;

        // Create a smaller, card-sized window
        const windowId = 'about_' + Date.now();
        const windowElement = this.createWindow(windowId, 'About', 'properties-window', content);

        // Apply custom styling to make the window smaller and card-like
        if (windowElement) {
            // Set specific dimensions for the card
            windowElement.style.width = '280px';
            windowElement.style.height = '380px';
            windowElement.style.minWidth = '280px';
            windowElement.style.minHeight = '380px';
            windowElement.style.maxWidth = '280px';
            windowElement.style.maxHeight = '380px';

            // Center the window on screen
            const rect = windowElement.getBoundingClientRect();
            const centerX = (window.innerWidth - 280) / 2;
            const centerY = (window.innerHeight - 320) / 2;
            windowElement.style.left = centerX + 'px';
            windowElement.style.top = centerY + 'px';

            // Remove padding from window content to make the card fill the entire window
            const windowContent = windowElement.querySelector('.window-content');
            if (windowContent) {
                windowContent.style.padding = '0';
                windowContent.style.height = '100%';
                windowContent.style.background = 'transparent';
            }

            // Add custom styling for a more card-like appearance
            windowElement.style.borderRadius = '12px';
            windowElement.style.overflow = 'hidden';
            windowElement.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4)';
        }
    }


    async restartServer() {
        console.log('🔄 [APPLICATION RESTART] User clicked application restart button');
        console.log('📪 [ACTION] This will close ALL terminals and restart the entire app');

        // Use reusable modal dialog for consistent styling
        let confirmed = false;
        try {
            confirmed = await ModalDialog.showConfirmation({
                title: 'Restart Server',
                message: 'Are you sure you want to restart the server? This will close all running models and reload the application.',
                confirmText: 'Restart',
                cancelText: 'Cancel',
                type: 'warning'
            });
        } catch (error) {
            console.error('Modal dialog error, trying native dialog:', error);
            // Fallback to Tauri native dialog
            try {
                if (window.__TAURI__ && window.__TAURI__.dialog) {
                    const { ask } = window.__TAURI__.dialog;
                    confirmed = await ask('Are you sure you want to restart the server? This will close all running models and reload the application.', {
                        title: 'Restart Server',
                        kind: 'warning',
                        okLabel: 'Restart',
                        cancelLabel: 'Cancel'
                    });
                } else {
                    // Final fallback to browser confirm
                    confirmed = confirm('Are you sure you want to restart the server? This will close all running models and reload the application.');
                }
            } catch (dialogError) {
                console.error('All dialog methods failed, using fallback:', dialogError);
                confirmed = confirm('Are you sure you want to restart the server? This will close all running models and reload the application.');
            }
        }

        if (confirmed) {
            try {
                // Close all open terminal sessions first
                if (terminalManager) {
                    console.log('Closing all terminal sessions before restart...');
                    await terminalManager.closeAllTerminalSessions();
                }

                // Clear session state to prevent restoration of closed terminals
                console.log('Clearing session state to prevent terminal restoration...');
                await this.clearSessionStateForRestart();

                // Show full-screen loading overlay similar to the Arandu loading page
                const loadingOverlay = document.createElement('div');
                loadingOverlay.id = 'restart-loading-screen';
                loadingOverlay.className = 'loading-screen';
                loadingOverlay.innerHTML = `
                    <div class="loading-content">
                        <h1 class="loading-title">Restarting</h1>
                        <div class="loading-spinner"></div>
                    </div>
                `;
                loadingOverlay.style.cssText = `
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: var(--theme-bg);
                    z-index: 10000;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                document.body.appendChild(loadingOverlay);

                // Add fade-in animation
                setTimeout(() => {
                    loadingOverlay.classList.add('fade-in');
                }, 10);

                // Restart the application properly
                try {
                    console.log('🔄 [APPLICATION RESTART] Starting restart sequence...');

                    // Use Tauri restart command if available to clean up processes
                    if (window.__TAURI__ && window.__TAURI__.core) {
                        console.log('💮 [CLEANUP] Using Tauri restart command for cleanup...');
                        await window.__TAURI__.core.invoke('restart_application');
                        console.log('✅ [CLEANUP COMPLETE] Process cleanup finished');
                    }

                    console.log('🔄 [RELOAD] Reloading application...');
                    // Reload the window to restart the app with fresh state
                    window.location.reload();

                } catch (error) {
                    console.error('🔄 [RESTART ERROR] Failed to restart application:', error);
                    // Fallback to direct reload
                    console.log('🔄 [FALLBACK] Falling back to direct reload...');
                    window.location.reload();
                }
            } catch (error) {
                console.error('Error restarting server:', error);
                // Remove loading overlay if it exists
                const loadingOverlay = document.getElementById('restart-loading-screen');
                if (loadingOverlay) {
                    loadingOverlay.remove();
                }
                // Use custom notification for error message to match UI style
                this.showNotification('Failed to restart server. Please restart manually by pressing Ctrl+C in the terminal and running launch.bat again.', 'error');
            }
        }
    }


    async clearSessionStateForRestart() {
        try {
            // Clear terminal session data from local state
            if (this.sessionData && this.sessionData.terminals) {
                this.sessionData.terminals = {};
            }

            // Clear window state for terminals
            Object.keys(this.windows).forEach(windowId => {
                const window = this.windows[windowId];
                if (window && (window.type === 'terminal' || windowId.includes('terminal'))) {
                    delete this.windows[windowId];
                }
            });

            // Clear session state on the server side
            const sessionStateToClear = {
                terminals: {},
                windows: Object.fromEntries(
                    Object.entries(this.windows).filter(([id, window]) =>
                        window && window.type !== 'terminal' && !id.includes('terminal')
                    )
                ),
                desktop_state: {
                    icon_positions: {},
                    sort_type: null,
                    sort_direction: 'asc',
                    theme: 'dark-gray',
                    background: 'dark-gray'
                }
            };

            // Save the cleared state to server
            await fetch('/api/session/desktop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(sessionStateToClear)
            });

            // Also explicitly clear each terminal session on server
            const terminalSessions = await fetch('/api/session/state');
            if (terminalSessions.ok) {
                const sessionData = await terminalSessions.json();
                if (sessionData.terminals) {
                    for (const terminalId of Object.keys(sessionData.terminals)) {
                        try {
                            await fetch(`/api/session/terminal/${terminalId}`, {
                                method: 'DELETE'
                            });
                        } catch (error) {
                            console.error(`Error clearing terminal session ${terminalId}:`, error);
                        }
                    }
                }
            }

            console.log('Session state cleared for restart');

        } catch (error) {
            console.error('Error clearing session state:', error);
            // Don't throw - we want restart to continue even if session clearing fails
        }
    }

    // Utility methods used by multiple modules
    formatFileSize(bytes) {
        if (!bytes) return 'Unknown size';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Favorites management
    loadFavorites() {
        try {
            const saved = localStorage.getItem('Arandu-favorites');
            return saved ? JSON.parse(saved) : [];
        } catch (error) {
            console.error('Error loading favorites:', error);
            return [];
        }
    }

    saveFavorites() {
        try {
            localStorage.setItem('Arandu-favorites', JSON.stringify(this.favorites));
        } catch (error) {
            console.error('Error saving favorites:', error);
        }
    }

    isFavorite(modelPath) {
        return this.favorites.includes(modelPath);
    }

    toggleFavorite(modelPath, event) {
        if (event) {
            event.stopPropagation();
        }
        
        const index = this.favorites.indexOf(modelPath);
        if (index === -1) {
            this.favorites.push(modelPath);
        } else {
            this.favorites.splice(index, 1);
        }
        this.saveFavorites();
        
        // Update the UI
        const card = document.querySelector(`.model-card[data-path="${CSS.escape(modelPath)}"]`);
        if (card) {
            const favBtn = card.querySelector('.model-card-favorite-btn');
            const isFav = this.isFavorite(modelPath);
            
            if (favBtn) {
                favBtn.classList.toggle('active', isFav);
                favBtn.innerHTML = isFav ? '<span class="material-icons">star</span>' : '<span class="material-icons">star_border</span>';
            }
        }
        
        // Re-sort the folder view based on current settings
        const folderGrid = document.getElementById('search-folder-grid');
        if (folderGrid && !folderGrid.classList.contains('hidden')) {
            this.applyFolderSort();
        }
    }

    sortFolderViewByFavorites() {
        const folderGrid = document.getElementById('search-folder-grid');
        if (!folderGrid) return;

        const cards = Array.from(folderGrid.querySelectorAll('.model-card'));
        
        cards.sort((a, b) => {
            const aPath = a.dataset.path;
            const bPath = b.dataset.path;
            const aFav = this.isFavorite(aPath);
            const bFav = this.isFavorite(bPath);
            
            // Favorites first (only if enabled)
            if (this.folderSortFavoritesFirst) {
                if (aFav && !bFav) return -1;
                if (!aFav && bFav) return 1;
            }
            return 0;
        });

        // Re-append in sorted order
        cards.forEach(card => folderGrid.appendChild(card));
    }

    applyFolderSort() {
        const folderGrid = document.getElementById('search-folder-grid');
        if (!folderGrid) return;

        // If no sorting criteria are active, skip sorting
        if (!this.folderSortFavoritesFirst && !this.folderSortType) {
            return;
        }

        const cards = Array.from(folderGrid.querySelectorAll('.model-card'));

        cards.sort((a, b) => {
            // Favorites first (if enabled)
            if (this.folderSortFavoritesFirst) {
                const aPath = a.dataset.path;
                const bPath = b.dataset.path;
                const aFav = this.isFavorite(aPath);
                const bFav = this.isFavorite(bPath);
                if (aFav && !bFav) return -1;
                if (!aFav && bFav) return 1;
            }

            // If no sort type selected, keep current order (among favorites/non-favorites)
            if (!this.folderSortType) return 0;

            // Apply selected sort
            let aValue = a.dataset[this.folderSortType];
            let bValue = b.dataset[this.folderSortType];

            // Handle undefined values
            if (!aValue && !bValue) return 0;
            if (!aValue) return 1;
            if (!bValue) return -1;

            let comparison = 0;

            switch (this.folderSortType) {
                case 'date':
                case 'size':
                    comparison = parseFloat(aValue) - parseFloat(bValue);
                    break;
                case 'name':
                case 'architecture':
                case 'quantization':
                default:
                    comparison = aValue.localeCompare(bValue, undefined, { numeric: true });
                    break;
            }

            return this.folderSortDirection === 'asc' ? comparison : -comparison;
        });

        // Re-append in sorted order
        cards.forEach(card => folderGrid.appendChild(card));
    }

    sortFolderView(sortType) {
        // Toggle direction if same sort type
        if (this.folderSortType === sortType) {
            this.folderSortDirection = this.folderSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.folderSortType = sortType;
            // Default to descending for date (newest first), ascending for others
            this.folderSortDirection = sortType === 'date' ? 'desc' : 'asc';
        }

        this.applyFolderSort();
        this.updateFolderSortButtons();
        localStorage.setItem('folderSortType', this.folderSortType);
        localStorage.setItem('folderSortDirection', this.folderSortDirection);
    }

    updateFolderSortButtons() {
        const sortButtons = document.querySelectorAll('.search-folder-sort-controls .sort-btn');
        sortButtons.forEach(btn => {
            const sortType = btn.dataset.sort;
            const isFavoritesToggle = btn.dataset.action === 'toggle-favorites';
            const isHideSuppressedToggle = btn.id === 'hide-suppressed-btn';
            
            btn.classList.remove('active');
            
            if (sortType && sortType === this.folderSortType) {
                btn.classList.add('active');
            }
            
            if (isFavoritesToggle) {
                btn.classList.toggle('active', this.folderSortFavoritesFirst);
            }
            
            if (isHideSuppressedToggle) {
                btn.classList.toggle('active', this.hideSuppressedModels);
            }
        });
    }

    updateHideSuppressedButton() {
        const btn = document.getElementById('hide-suppressed-btn');
        if (btn) {
            const icon = btn.querySelector('.material-icons');
            if (this.hideSuppressedModels) {
                icon.textContent = 'visibility';
                btn.title = 'CLIP models hidden - click to show';
            } else {
                icon.textContent = 'visibility';
                btn.title = 'CLIP models shown - click to hide';
            }
            btn.classList.toggle('active', this.hideSuppressedModels);
        }
    }

    formatNumber(num) {
        if (!num) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
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

    formatDate(timestamp) {
        if (!timestamp) return 'Unknown';
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return 'Today';
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return `${diffDays} days ago`;
        } else if (diffDays < 30) {
            const weeks = Math.floor(diffDays / 7);
            return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
        } else if (diffDays < 365) {
            const months = Math.floor(diffDays / 30);
            return `${months} month${months !== 1 ? 's' : ''} ago`;
        } else {
            const years = Math.floor(diffDays / 365);
            return `${years} year${years !== 1 ? 's' : ''} ago`;
        }
    }

    setupIconDragging() {
        const icons = document.querySelectorAll('.desktop-icon');
        icons.forEach(icon => {
            icon.draggable = true;

            icon.addEventListener('dragstart', (e) => {
                icon.classList.add('dragging');
                e.dataTransfer.setData('text/plain', icon.dataset.path);
                e.dataTransfer.effectAllowed = 'move';
            });

            icon.addEventListener('dragend', (e) => {
                icon.classList.remove('dragging');
                document.querySelectorAll('.desktop-icon').forEach(i => {
                    i.classList.remove('drag-over');
                });
            });

            icon.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (!icon.classList.contains('dragging')) {
                    icon.classList.add('drag-over');
                }
            });

            icon.addEventListener('dragleave', (e) => {
                icon.classList.remove('drag-over');
            });

            icon.addEventListener('drop', (e) => {
                e.preventDefault();
                icon.classList.remove('drag-over');

                const draggedPath = e.dataTransfer.getData('text/plain');
                const draggedIcon = document.querySelector(`[data-path="${draggedPath}"]`);

                if (draggedIcon && draggedIcon !== icon) {
                    // Swap positions by swapping the DOM elements
                    const container = icon.parentNode;
                    const draggedNext = draggedIcon.nextSibling;
                    const targetNext = icon.nextSibling;

                    container.insertBefore(draggedIcon, targetNext);
                    container.insertBefore(icon, draggedNext);

                    this.showNotification('Icons rearranged', 'info');
                }
            });
        });
    }

    sortIcons(sortType, save = true, toggleDirection = true) {
        const iconsContainer = document.getElementById('desktop-icons');
        let icons = Array.from(iconsContainer.querySelectorAll('.desktop-icon'));

        console.log('sortIcons called with:', { sortType, save, toggleDirection, currentSort: this.sortType, currentDirection: this.sortDirection, iconCount: icons.length });

        // Toggle direction if sorting by the same type and toggleDirection is true
        if (toggleDirection && this.sortType === sortType) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else if (toggleDirection) {
            this.sortDirection = 'asc'; // Default to ascending for new sort types
        }
        // If toggleDirection is false, keep current sortDirection
        this.sortType = sortType;

        console.log('Sorting icons by:', sortType, 'direction:', this.sortDirection);

        icons.sort((a, b) => {
            // Handle architecture icons - they should always come first
            const aIsArch = a.classList.contains('architecture-icon');
            const bIsArch = b.classList.contains('architecture-icon');

            if (aIsArch && !bIsArch) return -1;
            if (!aIsArch && bIsArch) return 1;

            // Both are architecture icons or both are regular icons
            let aValue = a.dataset[sortType];
            let bValue = b.dataset[sortType];

            // Handle undefined values
            if (!aValue && !bValue) return 0;
            if (!aValue) return 1;
            if (!bValue) return -1;

            let comparison = 0;

            switch (sortType) {
                case 'date':
                case 'size':
                    comparison = parseFloat(aValue) - parseFloat(bValue);
                    break;
                case 'quantization':
                    const getQuantValue = (s) => {
                        if (s === 'Unknown' || !s) return -1;
                        const match = s.match(/(\d+)/);
                        return match ? parseInt(match[0], 10) : -1;
                    };
                    comparison = getQuantValue(aValue) - getQuantValue(bValue);
                    break;
                case 'name':
                case 'architecture':
                default:
                    comparison = aValue.localeCompare(bValue, undefined, { numeric: true });
                    break;
            }

            // Fallback to sorting by name if values are identical
            if (comparison === 0 && sortType !== 'name') {
                const aName = a.dataset.name || '';
                const bName = b.dataset.name || '';
                comparison = aName.localeCompare(bName, undefined, { numeric: true });
            }

            return this.sortDirection === 'asc' ? comparison : -comparison;
        });

        this.reorderIcons(icons);

        if (save) {
            localStorage.setItem('iconSortOrder', sortType);
            localStorage.setItem('iconSortDirection', this.sortDirection);
            this.saveDesktopState(); // Save to server session
            this.showNotification(`Sorted by ${sortType} (${this.sortDirection})`, 'info');
        }
    }

    reorderIcons(sortedIcons) {
        const iconsContainer = document.getElementById('desktop-icons');
        // Clear the container and append sorted icons
        iconsContainer.innerHTML = '';
        sortedIcons.forEach(icon => {
            iconsContainer.appendChild(icon);
        });
    }

    applySavedSort() {
        const savedSort = localStorage.getItem('iconSortOrder');
        const savedDirection = localStorage.getItem('iconSortDirection');
        if (savedSort) {
            this.sortType = savedSort;
            this.sortDirection = savedDirection || 'asc'; // Use saved direction directly
            this.sortIcons(this.sortType, false, false); // Don't toggle direction
        }
    }

    async toggleSettingsPanel() {
        const windowElement = document.getElementById('settings-window');
        const settingsDockIcon = document.getElementById('settings-dock-icon');

        if (windowElement) {
            const isHidden = windowElement.classList.contains('hidden') || windowElement.style.display === 'none';
            
            if (isHidden) {
                // Restore window
                windowElement.classList.remove('hidden');
                windowElement.style.display = 'block';
                this.windows.set('settings-window', windowElement);
                // Always ensure proper window behavior
                this.makeDraggable(windowElement);
                windowElement.style.zIndex = ++this.windowZIndex;
                // Update focused state
                this.updateDockFocusedState('settings-window');
                // Center the window if it's the first time opening
                if (!windowElement.style.left || windowElement.style.left === 'auto') {
                    windowElement.style.left = '50%';
                    windowElement.style.top = '50%';
                    windowElement.style.transform = 'translate(-50%, -50%)';
                }

                // Fetch and display app version
                this.updateAppVersion();

                // Populate theme selectors dynamically
                const themeColorSelect = document.getElementById('theme-color');
                const backgroundColorSelect = document.getElementById('background-color');

                if (themeColorSelect && backgroundColorSelect) {
                    // Populate both selectors with the same options
                    const themeOptions = generateThemeOptions(document.body.dataset.theme || 'dark-gray');
                    themeColorSelect.innerHTML = themeOptions;
                    backgroundColorSelect.innerHTML = themeOptions;

                    // Set the current values
                    themeColorSelect.value = document.body.dataset.theme || 'dark-gray';
                    backgroundColorSelect.value = document.body.dataset.background || 'dark-gray';
                }

                // Mark dock icon as active
                if (settingsDockIcon) {
                    settingsDockIcon.classList.add('active');
                    settingsDockIcon.classList.remove('minimized');
                }

                // Don't add to taskbar - use permanent dock icon instead
            } else if (windowElement.style.zIndex < this.windowZIndex) {
                // Window is visible but not on top - bring it to front
                windowElement.style.zIndex = ++this.windowZIndex;
                this.updateDockFocusedState('settings-window');
            } else {
                // Window is already on top - minimize it
                this.minimizeWindow('settings-window');
            }
        }
    }

    hideSettingsPanel() {
        const windowElement = document.getElementById('settings-window');
        const settingsDockIcon = document.getElementById('settings-dock-icon');

        if (windowElement) {
            windowElement.classList.add('hidden');
            // Don't remove from windows map to allow reopening
        }
        if (settingsDockIcon) {
            settingsDockIcon.classList.remove('active');
        }
    }

    async closeSettingsPanel() {
        const windowElement = document.getElementById('settings-window');
        const settingsDockIcon = document.getElementById('settings-dock-icon');

        if (windowElement) {
            windowElement.classList.add('hidden');
            this.windows.delete('settings-window');

            // Mark dock icon as inactive
            if (settingsDockIcon) {
                settingsDockIcon.classList.remove('active');
            }

            // Revert theme to saved settings
            try {
                const config = await invoke('get_config');
                if (config) {
                    this.applyTheme(config.theme_color || 'dark-gray', config.background_color || 'dark-gray');
                    document.body.dataset.theme = config.theme_color || 'dark-gray';
                    document.body.dataset.background = config.background_color || 'dark-gray';
                }
            } catch (error) {
                console.error('Error reverting theme settings:', error);
            }
        }
    }

    async updateAppVersion() {
        const versionBadge = document.getElementById('app-version-badge');
        if (!versionBadge) return;

        try {
            const version = await invoke('get_app_version');
            versionBadge.textContent = `v${version}`;
        } catch (error) {
            console.error('Failed to get app version:', error);
            versionBadge.textContent = 'Unknown';
        }
    }

    async ensureTerminalManager() {
        if (terminalManager) {
            console.log('Terminal manager already available');
            return true;
        }

        console.log('Terminal manager not available, attempting immediate initialization...');

        // Check if TerminalManager class is available
        if (typeof TerminalManager === 'undefined') {
            console.error('TerminalManager class not loaded! Checking script loading...');

            // Wait for scripts to load
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (typeof TerminalManager === 'undefined') {
                console.error('TerminalManager class still not available after waiting');
                return false;
            }
        }

        // Force immediate initialization attempts with more aggressive retry
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                console.log(`Attempting to initialize terminal manager (attempt ${attempt + 1})...`);
                terminalManager = new TerminalManager(this);
                console.log(`Terminal manager initialized successfully on attempt ${attempt + 1}`);

                // Verify the terminal manager is functional
                if (typeof terminalManager.openServerTerminal === 'function') {
                    console.log('Terminal manager functionality verified');
                    return true;
                } else {
                    console.error('Terminal manager missing required methods');
                    terminalManager = null;
                }
            } catch (error) {
                console.error(`Failed to initialize terminal manager on attempt ${attempt + 1}:`, error);
                terminalManager = null;
            }

            // Progressive delay between attempts
            if (attempt < 4) {
                const delay = Math.min(200 * Math.pow(2, attempt), 2000); // Exponential backoff up to 2s
                console.log(`Waiting ${delay}ms before next attempt...`);
                await new Promise(resolve => setTimeout(resolve, delay));

                // Try to force module reinitialization
                this.ensureDesktopInteractivity();
            }
        }

        console.error('Failed to ensure terminal manager availability after all attempts');
        return false;
    }

    async launchModel(icon) {
        // Close search folder view if open (always clear saved search value)
        this.hideSearchFolderView(false);

        const modelPath = icon.dataset.path;
        const modelName = icon.dataset.name;

        console.log('=== Launch Model Started ===');
        console.log('Model details:', { modelPath, modelName });
        console.log('Terminal manager status before check:', terminalManager ? 'initialized' : 'not initialized');
        console.log('TerminalManager class available:', typeof TerminalManager !== 'undefined');

        // Show loading notification
        // this.showNotification(`Initializing terminal for ${modelName}...`, 'info');

        // Ensure terminal manager is available with detailed logging
        console.log('Attempting to ensure terminal manager...');
        const terminalManagerReady = await this.ensureTerminalManager();

        console.log('Terminal manager ready result:', terminalManagerReady);
        console.log('Terminal manager after ensure:', terminalManager ? 'initialized' : 'not initialized');

        if (!terminalManagerReady || !terminalManager) {
            console.error('Terminal manager not ready after ensure attempt');
            console.log('Available modules:', {
                TerminalManager: typeof TerminalManager,
                PropertiesManager: typeof PropertiesManager,
                DownloadManager: typeof DownloadManager,
                HuggingFaceApp: typeof HuggingFaceApp
            });
            this.showNotification('Terminal system not ready. Please try again in a moment.', 'error');
            return;
        }

        // Verify terminal manager has required methods
        if (typeof terminalManager.openServerTerminal !== 'function') {
            console.error('Terminal manager missing openServerTerminal method');
            this.showNotification('Terminal system malfunction. Please refresh the page.', 'error');
            return;
        }

        // Check if there's already a terminal for this model
        const existingTerminal = terminalManager.getExistingTerminal ? terminalManager.getExistingTerminal(modelPath) : null;

        if (existingTerminal) {
            const [windowId] = existingTerminal;
            const window = this.windows.get(windowId);
            if (window) {
                // Focus existing terminal window
                window.style.display = 'block';
                window.style.zIndex = ++this.windowZIndex;
                const taskbarItem = document.getElementById(`taskbar-${windowId}`);
                if (taskbarItem) taskbarItem.classList.add('active');
                this.showNotification(`${modelName} terminal already open`, 'info');
                return;
            }
        }

        try {
            console.log('Invoking launch_model command...');

            // Show progress notification
            // this.showNotification(`Starting ${modelName}...`, 'info');

            const result = await invoke('launch_model', { modelPath: modelPath });
            console.log('Launch model result:', result);

            if (result.success) {
                console.log('Opening server terminal...');
                console.log('Terminal manager methods:', Object.getOwnPropertyNames(terminalManager.__proto__));

                // Open server terminal window immediately
                // Get active llama.cpp version
                const config = await invoke('get_config');
                let activeVersion = 'N/A';
                if (config.active_executable_folder) {
                    // Extract version and backend from path like "versions/b7779/cuda" or "versions/b7779-cuda"
                    const pathParts = config.active_executable_folder.replace(/\\/g, '/').split('/');
                    if (pathParts.length >= 2) {
                        const versionPart = pathParts[pathParts.length - 2]; // Second to last part
                        const backendPart = pathParts[pathParts.length - 1]; // Last part

                        // Check if it's nested structure (version/backend) or flat (version-backend)
                        if (versionPart === 'versions') {
                            // Flat structure: versions/b7779-cuda
                            activeVersion = backendPart;
                        } else {
                            // Nested structure: versions/b7779/cuda -> format as b7779-cuda
                            activeVersion = `${versionPart}-${backendPart}`;
                        }
                    }
                } else if (config.active_executable_version) {
                    activeVersion = config.active_executable_version;
                }

                const terminal = await terminalManager.openServerTerminal(
                    result.process_id,
                    result.model_name,
                    result.server_host,
                    result.server_port,
                    modelPath,
                    activeVersion,
                    result.command
                );

                console.log('Terminal created:', terminal ? 'success' : 'failed');

                if (terminal) {
                    console.log('Terminal window details:', {
                        id: terminal.id,
                        display: terminal.style.display,
                        visibility: terminal.style.visibility,
                        zIndex: terminal.style.zIndex,
                        classList: Array.from(terminal.classList)
                    });
                    // this.showNotification(`${modelName} launched successfully!`, 'success');
                } else {
                    console.error('Failed to create terminal window');
                    this.showNotification(`Failed to create terminal window for ${modelName}`, 'error');
                }
            } else {
                console.error('Launch failed with result:', result);
                throw new Error(result.error || result.message || 'Launch failed with unknown error');
            }
        } catch (error) {
            console.error('=== Launch Model Error ===');
            console.error('Error details:', error);
            console.error('Error stack:', error.stack);

            const errorMessage = error.message || (typeof error === 'string' ? error : 'An unknown error occurred');

            if (errorMessage.includes("No such file or directory") || errorMessage.includes("failed to find") || errorMessage.includes("Server executable not found")) {
                this.showNotification(`Launch failed: No llama.cpp executable found.`, 'error');

                // Open the Llama.cpp manager to the installed tab
                if (llamacppReleasesManager) {
                    llamacppReleasesManager.showLlamaCppManager();

                    // Ensure the "Installed Versions" tab is active
                    const installedTabButton = document.querySelector('.llamacpp-top-tabs .top-tab[data-top-tab="installed"]');
                    if (installedTabButton) {
                        llamacppReleasesManager.switchTopTab(installedTabButton, 'installed');
                    }
                }
            } else {
                this.showNotification(`Failed to launch ${modelName}: ${errorMessage}`, 'error');
            }
        }

        console.log('=== Launch Model Completed ===');
    }

    async launchModelExternal(icon) {
        const modelPath = icon.dataset.path;
        const modelName = icon.dataset.name;

        try {
            const result = await invoke('launch_model_external', { modelPath: modelPath });

            if (result.success) {
                // this.showNotification(`${modelName} launched in external terminal`, 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            this.showNotification(`Failed to launch ${modelName} externally: ${error.message}`, 'error');
        }
    }

    async launchModelWithPreset(icon, presetId) {
        const modelPath = icon.dataset.path;
        const modelName = icon.dataset.name;

        console.log('=== Launch Model With Preset Started ===');
        console.log('Model details:', { modelPath, modelName, presetId });

        // Get the preset arguments before launching
        let presetArgs = null;
        try {
            const presets = await invoke('get_model_presets', { modelPath: modelPath });
            const preset = presets.find(p => p.id === presetId);
            if (preset) {
                presetArgs = preset.custom_args;
                console.log('Using preset arguments:', presetArgs);
            }
        } catch (error) {
            console.error('Error getting preset arguments:', error);
        }

        // Ensure terminal manager is available
        const terminalManagerReady = await this.ensureTerminalManager();
        if (!terminalManagerReady || !terminalManager) {
            this.showNotification('Terminal system not ready. Please try again in a moment.', 'error');
            return;
        }

        // Check if there's already a terminal for this model
        const existingTerminal = terminalManager.getExistingTerminal ? terminalManager.getExistingTerminal(modelPath) : null;
        if (existingTerminal) {
            const [windowId] = existingTerminal;
            const window = this.windows.get(windowId);
            if (window) {
                window.style.display = 'block';
                window.style.zIndex = ++this.windowZIndex;
                const taskbarItem = document.getElementById(`taskbar-${windowId}`);
                if (taskbarItem) taskbarItem.classList.add('active');
                this.showNotification(`${modelName} terminal already open`, 'info');
                return;
            }
        }

        try {
            console.log('Invoking launch_model_with_preset command...');

            const result = await invoke('launch_model_with_preset', {
                modelPath: modelPath,
                presetId: presetId
            });
            console.log('Launch model with preset result:', result);

            if (result.success) {
                console.log('Opening server terminal...');

                // Get active llama.cpp version
                const config = await invoke('get_config');
                let activeVersion = 'N/A';
                if (config.active_executable_folder) {
                    // Extract version and backend from path like "versions/b7779/cuda" or "versions/b7779-cuda"
                    const pathParts = config.active_executable_folder.replace(/\\/g, '/').split('/');
                    if (pathParts.length >= 2) {
                        const versionPart = pathParts[pathParts.length - 2]; // Second to last part
                        const backendPart = pathParts[pathParts.length - 1]; // Last part

                        // Check if it's nested structure (version/backend) or flat (version-backend)
                        if (versionPart === 'versions') {
                            // Flat structure: versions/b7779-cuda
                            activeVersion = backendPart;
                        } else {
                            // Nested structure: versions/b7779/cuda -> format as b7779-cuda
                            activeVersion = `${versionPart}-${backendPart}`;
                        }
                    }
                } else if (config.active_executable_version) {
                    activeVersion = config.active_executable_version;
                }

                const terminal = await terminalManager.openServerTerminal(
                    result.process_id,
                    result.model_name,
                    result.server_host,
                    result.server_port,
                    modelPath,
                    activeVersion,
                    result.command
                );

                if (!terminal) {
                    console.error('Failed to create terminal window');
                    this.showNotification(`Failed to create terminal window for ${modelName}`, 'error');
                }
            } else {
                console.error('Launch failed with result:', result);
                throw new Error(result.error || result.message || 'Launch failed with unknown error');
            }
        } catch (error) {
            console.error('=== Launch Model With Preset Error ===');
            console.error('Error details:', error);

            const errorMessage = error.message || (typeof error === 'string' ? error : 'An unknown error occurred');

            if (errorMessage.includes("No such file or directory") || errorMessage.includes("failed to find") || errorMessage.includes("Server executable not found")) {
                this.showNotification(`Launch failed: No llama.cpp executable found.`, 'error');

                if (llamacppReleasesManager) {
                    llamacppReleasesManager.showLlamaCppManager();
                    const installedTabButton = document.querySelector('.llamacpp-top-tabs .top-tab[data-top-tab="installed"]');
                    if (installedTabButton) {
                        llamacppReleasesManager.switchTopTab(installedTabButton, 'installed');
                    }
                }
            } else {
                this.showNotification(`Failed to launch ${modelName}: ${errorMessage}`, 'error');
            }
        }

        console.log('=== Launch Model With Preset Completed ===');
    }

    async launchModelWithPresetExternal(icon, presetId) {
        const modelPath = icon.dataset.path;
        const modelName = icon.dataset.name;

        try {
            const result = await invoke('launch_model_with_preset_external', {
                modelPath: modelPath,
                presetId: presetId
            });

            if (result.success) {
                // this.showNotification(`${modelName} launched in external terminal`, 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            this.showNotification(`Failed to launch ${modelName} externally: ${error.message}`, 'error');
        }
    }

    showProperties(icon) {
        if (propertiesManager) {
            propertiesManager.showProperties(icon);
        } else {
            console.error('Properties manager not initialized');
        }
    }

    async openModelFolder(icon) {
        const modelPath = icon.dataset.path;
        if (!modelPath) {
            console.error('No model path available');
            return;
        }

        try {
            await invoke('open_model_folder', { modelPath: modelPath });
        } catch (error) {
            console.error('Error opening model folder:', error);
            this.showNotification('Failed to open model folder', 'error');
        }
    }

    async deleteModelFile(icon) {
        const filename = icon.dataset.name;
        const modelPath = icon.dataset.path;

        // Show confirmation dialog using reusable modal
        const confirmed = await ModalDialog.showConfirmation({
            title: 'Delete File',
            message: `Are you sure you want to delete "${filename}"?\n\nThis action cannot be undone.`,
            confirmText: 'Delete',
            cancelText: 'Cancel',
            type: 'danger'
        });

        if (!confirmed) {
            return;
        }

        try {
            // Call Tauri command to delete the file
            const result = await invoke('delete_model_file', {
                modelPath: modelPath
            });

            // Check if the deletion was successful
            if (!result.success) {
                throw new Error(result.error || 'Unknown error occurred');
            }

            // If we get here, the deletion was successful
            this.showNotification(`Successfully deleted "${filename}"`, 'success');
            
            // Refresh the desktop to update the view
            await this.loadModels(false);
            

        } catch (error) {
            console.error('Error deleting file:', error);
            this.showNotification(`Failed to delete file: ${error}`, 'error');
        }
    }

    async showConfirmationDialog(title, message, confirmText = 'Confirm', cancelText = 'Cancel') {
        return new Promise((resolve) => {
            const dialogContent = `
                <div class="confirmation-dialog">
                    <div class="dialog-header">
                        <h3>${title}</h3>
                    </div>
                    <div class="dialog-body">
                        <p style="white-space: pre-line; margin-bottom: 20px;">${message}</p>
                    </div>
                    <div class="dialog-footer">
                        <button class="btn btn-secondary" onclick="desktop.closeConfirmationDialog(false)">${cancelText}</button>
                        <button class="btn btn-danger" onclick="desktop.closeConfirmationDialog(true)" style="margin-left: 10px;">${confirmText}</button>
                    </div>
                </div>
            `;

            const windowId = 'confirmation_' + Date.now();
            this.createWindow(windowId, title, 'confirmation-window', dialogContent);

            // Store the resolve function for the dialog
            this.confirmationResolve = resolve;
        });
    }

    closeConfirmationDialog(confirmed) {
        if (this.confirmationResolve) {
            this.confirmationResolve(confirmed);
            this.confirmationResolve = null;
        }

        // Close the confirmation window
        const confirmationWindow = document.querySelector('.confirmation-window');
        if (confirmationWindow) {
            confirmationWindow.closest('.window').remove();
        }
    }

    showNotification(message, type = 'info') {
        // Create or update notification element
        let notification = document.getElementById('desktop-notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'desktop-notification';
            notification.className = 'desktop-notification';
            document.body.appendChild(notification);
        }

        notification.className = `desktop-notification ${type}`;
        notification.textContent = message;
        notification.style.display = 'block';

        // Auto-hide after 3 seconds
        setTimeout(() => {
            notification.style.display = 'none';
        }, 3000);
    }

















    async parseArgumentsToSettings(customArgs) {
        const settings = {};
        if (!customArgs || !customArgs.trim()) return settings;

        // Load settings configuration
        const settingsConfig = await this.loadSettingsConfig();

        // Create argument to setting mapping (including aliases and argumentMap keys)
        const argToSetting = {};
        settingsConfig.forEach(setting => {
            // Map the main argument
            argToSetting[setting.argument] = setting;

            // Map all aliases if they exist
            if (setting.aliases && Array.isArray(setting.aliases)) {
                setting.aliases.forEach(alias => {
                    argToSetting[alias] = setting;
                });
            }

            // Map all keys from argumentMap if it exists (the CLI arguments themselves)
            if (setting.argumentMap) {
                Object.keys(setting.argumentMap).forEach(arg => {
                    argToSetting[arg] = setting;
                });
            }
        });

        // Split arguments respecting quotes
        const args = this.parseArguments(customArgs);

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            let settingConfig = argToSetting[arg];
            let value = null;

            // Check for equals-separated arguments (e.g., --ctx-size=4096)
            if (!settingConfig && arg.includes('=')) {
                const [argName, argValue] = arg.split('=', 2);
                settingConfig = argToSetting[argName];
                if (settingConfig) {
                    value = argValue;
                }
            }

            if (settingConfig) {
                // Check if this setting uses argumentMap
                if (settingConfig.argumentMap) {
                    // For argumentMap, check if this argument is a key in argumentMap
                    if (settingConfig.argumentMap[arg]) {
                        // Get the internal value (on/off) from argumentMap
                        const internalValue = settingConfig.argumentMap[arg];
                        // Find the canonical CLI argument for this internal value
                        // The canonical is the one that starts with "--" (not short form "-")
                        const canonicalArg = Object.keys(settingConfig.argumentMap).find(key => 
                            settingConfig.argumentMap[key] === internalValue && key.startsWith('--')
                        ) || Object.keys(settingConfig.argumentMap).find(key => 
                            settingConfig.argumentMap[key] === internalValue
                        );
                        settings[settingConfig.id] = canonicalArg || arg;
                        settings[settingConfig.id + '_enabled'] = true;
                    }
                } else if (settingConfig.isFlag || settingConfig.type === 'toggle') {
                    settings[settingConfig.id] = true;
                    settings[settingConfig.id + '_enabled'] = true;
                } else {
                    // Use the value from equals-separated arg, or get next argument
                    if (value === null) {
                        const nextArg = args[i + 1];
                        // Accept the next argument as a value if it exists and either:
                        // 1. Doesn't start with '-', OR
                        // 2. Starts with '-' but is a negative number (e.g., -1, -0.5)
                        if (nextArg && (!nextArg.startsWith('-') || /^-\d+(\.\d+)?$/.test(nextArg))) {
                            value = nextArg;
                            i++; // Skip the value
                        }
                    }

                    if (value !== null) {
                        settings[settingConfig.id] = value;
                        settings[settingConfig.id + '_enabled'] = true;
                    }
                }
            }
        }

        return settings;
    }

    parseArguments(argsString) {
        const args = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';

        for (let i = 0; i < argsString.length; i++) {
            const char = argsString[i];

            if ((char === '"' || char === "'") && !inQuotes) {
                inQuotes = true;
                quoteChar = char;
            } else if (char === quoteChar && inQuotes) {
                inQuotes = false;
                quoteChar = '';
            } else if (char === ' ' && !inQuotes) {
                if (current.trim()) {
                    args.push(current.trim());
                    current = '';
                }
            } else {
                current += char;
            }
        }

        if (current.trim()) {
            args.push(current.trim());
        }

        return args;
    }

    async getSettingAliases(settingConfig) {
        return settingConfig.aliases || [];
    }

    async replaceOrAddArgument(argsString, argName, newValue, isFlag = false, aliases = []) {
        if (!argsString) argsString = '';

        const args = this.parseArguments(argsString);
        const result = [];
        let i = 0;
        let found = false;

        // Create a set of all possible argument names (including aliases)
        const allArgNames = new Set([argName, ...aliases]);

        while (i < args.length) {
            const arg = args[i];
            let currentArgName = arg;
            let currentArgValue = null;

            // Check for equals-separated arguments (e.g., --ctx-size=4096)
            if (arg.includes('=')) {
                const [name, value] = arg.split('=', 2);
                currentArgName = name;
                currentArgValue = value;
            }

            if (allArgNames.has(currentArgName)) {
                found = true;
                if (isFlag) {
                    // For flags, only add if newValue is true, skip entirely if false
                    if (newValue) {
                        result.push(argName); // Use the primary argument name
                    }
                    i++;
                } else {
                    // For value arguments, only add if newValue is not false/empty
                    if (newValue !== false && newValue !== null && newValue !== undefined) {
                        // Wrap in quotes if it contains spaces, backslashes, or is empty
                        let val = newValue.toString();
                        const needsQuotes = val === "" || /[\s\\/\(\)\&\;\!\?\*\<\>\|]/.test(val);
                        if (needsQuotes && !val.startsWith('"') && !val.startsWith("'")) {
                            val = `"${val}"`;
                        }
                        result.push(argName, val); // Use the primary argument name
                        // Skip the old value if it exists and wasn't part of equals syntax
                        if (currentArgValue === null && i + 1 < args.length &&
                            (!args[i + 1].startsWith('-') || /^-\d+(\.\d+)?$/.test(args[i + 1]))) {
                            i += 2;
                        } else {
                            i++;
                        }
                    } else {
                        // Skip both the argument and its value when removing
                        if (currentArgValue === null && i + 1 < args.length &&
                            (!args[i + 1].startsWith('-') || /^-\d+(\.\d+)?$/.test(args[i + 1]))) {
                            i += 2; // Skip argument and its value
                        } else {
                            i++; // Skip just the argument (for equals syntax or flags)
                        }
                    }
                }
            } else {
                result.push(arg);
                i++;
            }
        }

        // If argument wasn't found and we want to add it
        if (!found && newValue !== false) {
            if (isFlag) {
                if (newValue) result.push(argName);
            } else {
                // Wrap in quotes if it contains spaces, backslashes, or is empty
                let val = (newValue !== null && newValue !== undefined) ? newValue.toString() : "";
                const needsQuotes = val === "" || /[\s\\/\(\)\&\;\!\?\*\<\>\|]/.test(val);
                if (needsQuotes && !val.startsWith('"') && !val.startsWith("'")) {
                    val = `"${val}"`;
                }
                result.push(argName, val);
            }
        }

        return result.join(' ');
    }

    async settingsToArguments(settings, existingArgs = '') {
        let result = existingArgs || '';

        // Load settings configuration
        const settingsConfig = await this.loadSettingsConfig();

        // Process each setting
        for (const settingConfig of settingsConfig) {
            const isEnabled = settings[settingConfig.id + '_enabled'];
            const value = settings[settingConfig.id];
            const aliases = await this.getSettingAliases(settingConfig);

            if (isEnabled) {
                // Check if this setting uses argumentMap (dynamic argument based on value)
                if (settingConfig.argumentMap) {
                    // For argumentMap, the option values are the CLI arguments themselves
                    // So we use the value directly as the argument
                    const selectedArg = value;
                    if (selectedArg) {
                        // Get all possible arguments from the map for removal purposes
                        const mapKeys = Object.keys(settingConfig.argumentMap);
                        // Add the selected argument
                        result = await this.replaceOrAddArgument(result, selectedArg, true, true, []);
                        // Remove other arguments from the map (only keep the selected one)
                        for (const argToRemove of mapKeys) {
                            if (argToRemove !== selectedArg) {
                                result = await this.replaceOrAddArgument(result, argToRemove, false, true, []);
                            }
                        }
                    }
                } else if (settingConfig.isFlag || settingConfig.type === 'toggle') {
                    // For flags and toggles, just add the argument (no value needed)
                    result = await this.replaceOrAddArgument(result, settingConfig.argument, true, true, aliases);
                } else {
                    // For value arguments, add if value exists and is not empty
                    // Exception: model-select, select, and text should be added even if empty (as an empty string)
                    // Also handle numeric values including 0
                    if ((value !== undefined && value !== null && value.toString().trim() !== '') ||
                        settingConfig.type === 'model-select' ||
                        settingConfig.type === 'select' ||
                        settingConfig.type === 'text' ||
                        (typeof value === 'number' && !isNaN(value))) {
                        result = await this.replaceOrAddArgument(result, settingConfig.argument, value, false, aliases);
                    } else {
                        result = await this.replaceOrAddArgument(result, settingConfig.argument, false, false, aliases);
                    }
                }
            } else {
                // Remove the argument if it's disabled
                // Check if this setting uses argumentMap
                if (settingConfig.argumentMap) {
                    // Remove all arguments in the map keys
                    const mapKeys = Object.keys(settingConfig.argumentMap);
                    for (const argToRemove of mapKeys) {
                        result = await this.replaceOrAddArgument(result, argToRemove, false, true, []);
                    }
                } else {
                    const isFlag = settingConfig.isFlag || settingConfig.type === 'toggle';
                    result = await this.replaceOrAddArgument(result, settingConfig.argument, false, isFlag, aliases);
                }
            }
        }

        return result.trim();
    }

    async loadSettingsConfig() {
        try {
            // For Tauri, we'll load the config file as a static resource
            const response = await fetch('model-settings-config.json');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const config = await response.json();
            console.log('Loaded settings config:', config);
            return config.settings || [];
        } catch (error) {
            console.error('Failed to load settings config:', error);
            // Return fallback basic settings if config fails to load
            return [
                {
                    id: "context_length",
                    name: "Context Length",
                    type: "slider",
                    argument: "-c",
                    aliases: ["--ctx-size"],
                    isFlag: false,
                    min: 512,
                    max: 131072,
                    step: 512,
                    default: 4096,
                    unit: "tokens",
                    category: "Context",
                    description: "Maximum number of tokens the model can process at once"
                },
                {
                    id: "temperature",
                    name: "Temperature",
                    type: "slider",
                    argument: "--temp",
                    aliases: ["--temperature"],
                    isFlag: false,
                    min: 0.1,
                    max: 2.0,
                    step: 0.01,
                    default: 0.8,
                    unit: "",
                    category: "Generation",
                    description: "Sampling temperature for text generation"
                },
                {
                    id: "gpu_offload",
                    name: "GPU Offload",
                    type: "slider",
                    argument: "-ngl",
                    aliases: ["--n-gpu-layers", "--gpu-layers"],
                    isFlag: false,
                    min: 0,
                    max: 99,
                    step: 1,
                    default: 99,
                    unit: "layers",
                    category: "Hardware",
                    description: "Number of model layers to offload to GPU"
                },
                {
                    id: "cpu_threads",
                    name: "CPU Thread Pool Size",
                    type: "slider",
                    argument: "--threads",
                    aliases: ["-t"],
                    isFlag: false,
                    min: 1,
                    max: 32,
                    step: 1,
                    default: 6,
                    unit: "",
                    category: "Hardware",
                    description: "Number of CPU threads to use for processing"
                },
                {
                    id: "flash_attention",
                    name: "Flash Attention",
                    type: "select",
                    argument: "-fa",
                    aliases: ["--flash-attn"],
                    isFlag: false,
                    options: [
                        { value: "auto", label: "Auto" },
                        { value: "on", label: "Enabled" },
                        { value: "off", label: "Disabled" }
                    ],
                    default: "auto",
                    category: "Hardware",
                    description: "Enable Flash Attention for faster inference"
                },
                {
                    id: "batch_size",
                    name: "Batch Size (Logical)",
                    type: "slider",
                    argument: "-b",
                    aliases: ["--batch-size"],
                    isFlag: false,
                    min: 1,
                    max: 8192,
                    step: 1,
                    default: 2048,
                    unit: "",
                    category: "Context",
                    description: "Batch size for prompt evaluation"
                },
                {
                    id: "ubatch_size",
                    name: "Batch Size (Physical)",
                    type: "slider",
                    argument: "-ub",
                    aliases: ["--ubatch-size"],
                    isFlag: false,
                    min: 1,
                    max: 8192,
                    step: 1,
                    default: 512,
                    unit: "",
                    category: "Context",
                    description: "Batch size for prompt evaluation"
                },
                {
                    id: "offload_kv_cache",
                    name: "Offload KV Cache to GPU Memory",
                    type: "toggle",
                    argument: "--kv-offload",
                    isFlag: true,
                    default: true,
                    category: "Hardware",
                    description: "Store key-value cache in GPU memory instead of RAM"
                },
                {
                    id: "continuous_batching",
                    name: "Continuous Batching",
                    type: "toggle",
                    argument: "--cont-batching",
                    isFlag: true,
                    default: true,
                    category: "Context",
                    description: "Enable continuous (dynamic) batching for better throughput"
                }
            ];
        }
    }


    createWindow(id, title, className, content) {
        const window = document.createElement('div');
        window.className = `window ${className}`;
        window.id = id;
        window.style.zIndex = ++this.windowZIndex;
        // Center the window initially
        window.style.left = '50%';
        window.style.top = '50%';
        window.style.transform = 'translate(-50%, -50%)';

        window.innerHTML = `
            <div class="window-header">
                <span class="window-title">${title}</span>
                <div class="window-controls">
                    <button class="window-control minimize" onclick="desktop.minimizeWindow('${id}')"></button>
                    <button class="window-control maximize" onclick="desktop.maximizeWindow('${id}')"></button>
                    <button class="window-control close" onclick="desktop.closeWindow('${id}')"></button>
                </div>
            </div>
            <div class="window-content">${content}</div>
        `;

        document.body.appendChild(window);
        this.windows.set(id, window);
        this.makeDraggable(window);

        // Update focused state for the new window
        this.updateDockFocusedState(id);

        // Initialize saved dimensions for proper size tracking
        const rect = window.getBoundingClientRect();
        window.dataset.savedWidth = rect.width.toString();
        window.dataset.savedHeight = rect.height.toString();

        return window;
    }

    makeDraggable(window) {
        // Check if already draggable to prevent duplicate event listeners
        if (window.dataset.draggable === 'true') {
            return;
        }
        window.dataset.draggable = 'true';

        const header = window.querySelector('.window-header');
        let isDragging = false;
        let isResizing = false;
        let initialX, initialY, initialWidth, initialHeight, initialLeft, initialTop;
        let resizeDirection = '';

        // Add resize handles
        this.addResizeHandles(window);

        // Add double-click handler to window header for maximize/restore
        if (header) {
            header.addEventListener('dblclick', (e) => {
                // Only handle double-click on header, not on window controls
                if (!e.target.closest('.window-controls')) {
                    this.toggleMaximizeWindow(window.id);
                    e.preventDefault();
                }
            });
        }

        // Mouse move handler
        const handleMouseMove = (e) => {
            if (isResizing) {
                const deltaX = e.clientX - initialX;
                const deltaY = e.clientY - initialY;

                switch (resizeDirection) {
                    case 'se': // Southeast
                        const seWidth = Math.max(300, initialWidth + deltaX);
                        const seHeight = Math.max(200, initialHeight + deltaY);
                        window.style.width = seWidth + 'px';
                        window.style.height = seHeight + 'px';
                        // Update stored dimensions
                        window.dataset.savedWidth = seWidth.toString();
                        window.dataset.savedHeight = seHeight.toString();
                        break;
                    case 'sw': // Southwest
                        const newWidth = Math.max(300, initialWidth - deltaX);
                        const swHeight = Math.max(200, initialHeight + deltaY);
                        window.style.width = newWidth + 'px';
                        window.style.height = swHeight + 'px';
                        window.style.left = (initialLeft + (initialWidth - newWidth)) + 'px';
                        // Update stored dimensions
                        window.dataset.savedWidth = newWidth.toString();
                        window.dataset.savedHeight = swHeight.toString();
                        break;
                    case 'ne': // Northeast
                        const newHeight = Math.max(200, initialHeight - deltaY);
                        const neWidth = Math.max(300, initialWidth + deltaX);
                        window.style.width = neWidth + 'px';
                        window.style.height = newHeight + 'px';
                        window.style.top = (initialTop + (initialHeight - newHeight)) + 'px';
                        // Update stored dimensions
                        window.dataset.savedWidth = neWidth.toString();
                        window.dataset.savedHeight = newHeight.toString();
                        break;
                    case 'nw': // Northwest
                        const newW = Math.max(300, initialWidth - deltaX);
                        const newH = Math.max(200, initialHeight - deltaY);
                        window.style.width = newW + 'px';
                        window.style.height = newH + 'px';
                        window.style.left = (initialLeft + (initialWidth - newW)) + 'px';
                        window.style.top = (initialTop + (initialHeight - newH)) + 'px';
                        // Update stored dimensions
                        window.dataset.savedWidth = newW.toString();
                        window.dataset.savedHeight = newH.toString();
                        break;
                    case 'e': // East
                        const eWidth = Math.max(300, initialWidth + deltaX);
                        window.style.width = eWidth + 'px';
                        // Update stored dimensions
                        window.dataset.savedWidth = eWidth.toString();
                        break;
                    case 'w': // West
                        const newWestWidth = Math.max(300, initialWidth - deltaX);
                        window.style.width = newWestWidth + 'px';
                        window.style.left = (initialLeft + (initialWidth - newWestWidth)) + 'px';
                        // Update stored dimensions
                        window.dataset.savedWidth = newWestWidth.toString();
                        break;
                    case 'n': // North
                        const newNorthHeight = Math.max(200, initialHeight - deltaY);
                        window.style.height = newNorthHeight + 'px';
                        window.style.top = (initialTop + (initialHeight - newNorthHeight)) + 'px';
                        // Update stored dimensions
                        window.dataset.savedHeight = newNorthHeight.toString();
                        break;
                    case 's': // South
                        const sHeight = Math.max(200, initialHeight + deltaY);
                        window.style.height = sHeight + 'px';
                        // Update stored dimensions
                        window.dataset.savedHeight = sHeight.toString();
                        break;
                }
            } else if (isDragging) {
                window.style.left = (e.clientX - initialX) + 'px';
                window.style.top = (e.clientY - initialY) + 'px';
            }
        };

        // Mouse up handler
        const handleMouseUp = () => {
            if (isDragging || isResizing) {
                isDragging = false;
                isResizing = false;
                resizeDirection = '';
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            }
        };

        // Single mousedown handler for the entire window
        window.addEventListener('mousedown', (e) => {
            // Bring window to front first
            window.style.zIndex = ++this.windowZIndex;

            // Update focused state for dock items
            this.updateDockFocusedState(window.id);

            // Check if clicking on resize handle
            if (e.target.classList.contains('resize-handle')) {
                isResizing = true;
                resizeDirection = e.target.dataset.direction;

                // Remove transform if it exists (from initial centering)
                if (window.style.transform) {
                    const rect = window.getBoundingClientRect();
                    window.style.left = rect.left + 'px';
                    window.style.top = rect.top + 'px';
                    window.style.transform = '';
                }

                initialX = e.clientX;
                initialY = e.clientY;
                initialWidth = parseInt(window.offsetWidth);
                initialHeight = parseInt(window.offsetHeight);
                initialLeft = parseInt(window.style.left) || window.offsetLeft;
                initialTop = parseInt(window.style.top) || window.offsetTop;

                // Add global listeners for resize
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);

                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // Check if clicking on header (for dragging)
            if (e.target.closest('.window-header') && !e.target.closest('.window-controls')) {
                isDragging = true;

                // Remove transform if it exists (from initial centering)
                if (window.style.transform) {
                    const rect = window.getBoundingClientRect();
                    window.style.left = rect.left + 'px';
                    window.style.top = rect.top + 'px';
                    window.style.transform = '';
                }

                initialX = e.clientX - (parseInt(window.style.left) || window.offsetLeft);
                initialY = e.clientY - (parseInt(window.style.top) || window.offsetTop);

                // Add global listeners for dragging
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);

                e.preventDefault();
                return;
            }
        });
    }

    addResizeHandles(window) {
        // Check if resize handles already exist
        if (window.querySelector('.resize-handle')) {
            return;
        }

        const directions = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

        directions.forEach(direction => {
            const handle = document.createElement('div');
            handle.className = `resize-handle resize-${direction}`;
            handle.dataset.direction = direction;

            // Set cursor styles and ensure proper z-index
            const cursors = {
                'n': 'n-resize', 'ne': 'ne-resize', 'e': 'e-resize', 'se': 'se-resize',
                's': 's-resize', 'sw': 'sw-resize', 'w': 'w-resize', 'nw': 'nw-resize'
            };
            handle.style.cursor = cursors[direction];
            handle.style.zIndex = '20'; // Ensure handles are above window content

            // Add debug background for testing (remove in production)
            // handle.style.background = 'rgba(255, 0, 0, 0.1)';

            window.appendChild(handle);
        });
    }

    closeWindow(id) {
        if (id === 'chat-application') {
            if (typeof chatApp !== 'undefined' && chatApp) {
                chatApp.hide();
            }
            const taskbarItem = document.getElementById(`taskbar-${id}`);
            if (taskbarItem) {
                taskbarItem.remove();
            }
            return;
        }
        const window = this.windows.get(id);
        if (window) {
            // If this is a server terminal, stop the server first and disconnect related chats
            const terminalInfo = terminalManager ? terminalManager.getTerminalData(id) : null;
            if (terminalInfo && (terminalInfo.status === 'running' || terminalInfo.status === 'starting') && terminalManager) {
                // Stop the server
                terminalManager.stopServer(terminalInfo.processId, id, terminalInfo.modelPath, terminalInfo.modelName);

                // Disconnect any chat sessions connected to this server
                if (typeof chatApp !== 'undefined' && chatApp && terminalInfo.host && terminalInfo.port) {
                    chatApp.disconnectChatsForServer(terminalInfo.host, terminalInfo.port);
                } else if (window.chatApp && terminalInfo.host && terminalInfo.port) {
                    // Fallback to window.chatApp if global chatApp is not available
                    window.chatApp.disconnectChatsForServer(terminalInfo.host, terminalInfo.port);
                }
            }

            window.remove();
            this.windows.delete(id);

            // Remove from taskbar
            const taskbarItem = document.getElementById(`taskbar-${id}`);
            if (taskbarItem) {
                taskbarItem.remove();
            }

            // Update permanent dock icons active state
            if (id === 'settings-window') {
                const settingsDockIcon = document.getElementById('settings-dock-icon');
                if (settingsDockIcon) settingsDockIcon.classList.remove('active');
            } else if (id === 'huggingface-search-window' || id === 'huggingface-search') {
                const huggingfaceDockIcon = document.getElementById('huggingface-dock-icon');
                if (huggingfaceDockIcon) huggingfaceDockIcon.classList.remove('active');
            } else if (id === 'llamacpp-manager-window') {
                const llamacppDockIcon = document.getElementById('llamacpp-dock-icon');
                if (llamacppDockIcon) llamacppDockIcon.classList.remove('active');
            }

            // Clean up terminal data
            if (terminalManager && terminalManager.terminals.has(id)) {
                terminalManager.removeTerminal(id);
            }

            // Remove from session storage
            this.removeWindowFromSession(id);

            this.updateDockAutoHidingStatus();
        }
    }

    minimizeWindow(id) {
        if (id === 'chat-application') {
            chatApp.hide();
        } else {
            const window = this.windows.get(id);
            const taskbarItem = document.getElementById(`taskbar-${id}`);

            if (window) {
                // Store current dimensions before minimizing
                const rect = window.getBoundingClientRect();
                window.dataset.savedWidth = rect.width.toString();
                window.dataset.savedHeight = rect.height.toString();

                window.style.display = 'none';
                window.classList.add('hidden');
                if (taskbarItem) {
                    taskbarItem.classList.remove('active');
                    taskbarItem.classList.add('minimized');
                }
                
                // Also update permanent dock icons
                if (id === 'settings-window') {
                    const settingsDockIcon = document.getElementById('settings-dock-icon');
                    if (settingsDockIcon) {
                        settingsDockIcon.classList.remove('active');
                        settingsDockIcon.classList.add('minimized');
                    }
                } else if (id === 'huggingface-search') {
                    const huggingfaceDockIcon = document.getElementById('huggingface-dock-icon');
                    if (huggingfaceDockIcon) {
                        huggingfaceDockIcon.classList.remove('active');
                        huggingfaceDockIcon.classList.add('minimized');
                    }
                } else if (id === 'llamacpp-manager-window') {
                    const llamacppDockIcon = document.getElementById('llamacpp-dock-icon');
                    if (llamacppDockIcon) {
                        llamacppDockIcon.classList.remove('active');
                        llamacppDockIcon.classList.add('minimized');
                    }
                }
                
                this.updateDockAutoHidingStatus();
            }
        }
    }

    updateDockFocusedState(focusedWindowId) {
        // Remove focused class from all dock items
        const allDockItems = document.querySelectorAll('.dock-item, .taskbar-item');
        allDockItems.forEach(item => item.classList.remove('focused'));

        // Add focused class to the corresponding dock item
        if (focusedWindowId === 'settings-window') {
            const settingsDockIcon = document.getElementById('settings-dock-icon');
            if (settingsDockIcon) settingsDockIcon.classList.add('focused');
        } else if (focusedWindowId === 'huggingface-search') {
            const huggingfaceDockIcon = document.getElementById('huggingface-dock-icon');
            if (huggingfaceDockIcon) huggingfaceDockIcon.classList.add('focused');
        } else if (focusedWindowId === 'llamacpp-manager-window') {
            const llamacppDockIcon = document.getElementById('llamacpp-dock-icon');
            if (llamacppDockIcon) llamacppDockIcon.classList.add('focused');
        } else if (focusedWindowId === 'download-history-window') {
            const downloadsDockIcon = document.getElementById('downloads-dock-icon');
            if (downloadsDockIcon) downloadsDockIcon.classList.add('focused');
        } else {
            // For other windows, find the corresponding taskbar item
            const taskbarItem = document.getElementById(`taskbar-${focusedWindowId}`);
            if (taskbarItem) taskbarItem.classList.add('focused');
        }
    }

    maximizeWindow(id) {
        const window = this.windows.get(id);
        if (window) {
            if (!window.classList.contains('maximized')) {
                // Store current position and size before maximizing
                const rect = window.getBoundingClientRect();
                window.dataset.preMaxPosition = JSON.stringify({
                    left: window.style.left || rect.left + 'px',
                    top: window.style.top || rect.top + 'px',
                    width: window.style.width || rect.width + 'px',
                    height: window.style.height || rect.height + 'px'
                });
            }
            window.classList.toggle('maximized');
            this.updateDockAutoHidingStatus();
        }
    }

    toggleMaximizeWindow(id) {
        const window = this.windows.get(id);
        if (window) {
            if (window.classList.contains('maximized')) {
                // Restore to previous position
                window.classList.remove('maximized');
                const savedPosition = window.dataset.preMaxPosition;
                if (savedPosition) {
                    try {
                        const pos = JSON.parse(savedPosition);
                        window.style.left = pos.left;
                        window.style.top = pos.top;
                        window.style.width = pos.width;
                        window.style.height = pos.height;
                    } catch (e) {
                        console.warn('Failed to restore window position:', e);
                    }
                }
                this.updateDockAutoHidingStatus();
            } else {
                // Maximize
                this.maximizeWindow(id);
            }
        }
    }

    checkWindowVisibility(windowElement) {
        return this.getWindowVisibilityPercentage(windowElement) >= 0.1; // 10% minimum visibility
    }

    repositionWindowToVisible(windowElement) {
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

        const rect = windowElement.getBoundingClientRect();
        const currentLeft = parseInt(windowElement.style.left) || rect.left;
        const currentTop = parseInt(windowElement.style.top) || rect.top;

        // Check current visibility percentage
        const visibilityPercentage = this.getWindowVisibilityPercentage(windowElement);

        let newLeft = currentLeft;
        let newTop = currentTop;

        // If window has very low visibility (< 5%), center it
        if (visibilityPercentage < 0.05) {
            // Center the window in the viewport
            newLeft = Math.max(20, (viewportWidth - rect.width) / 2);
            newTop = Math.max(20, (viewportHeight - rect.height) / 2);
        } else {
            // Otherwise, just ensure minimum visibility at edges
            const margin = 50; // Minimum visible margin

            // Check and adjust horizontal position
            if (currentLeft + rect.width < margin) {
                newLeft = margin - rect.width + 100; // Show at least 100px of window
            } else if (currentLeft > viewportWidth - margin) {
                newLeft = viewportWidth - margin;
            }

            // Check and adjust vertical position
            if (currentTop + rect.height < margin) {
                newTop = margin - rect.height + 100; // Show at least 100px of window
            } else if (currentTop > viewportHeight - margin) {
                newTop = viewportHeight - margin;
            }
        }

        // Apply new position
        windowElement.style.left = newLeft + 'px';
        windowElement.style.top = newTop + 'px';

        const moved = (newLeft !== currentLeft) || (newTop !== currentTop);
        return { moved, centered: visibilityPercentage < 0.05 };
    }

    getWindowVisibilityPercentage(windowElement) {
        const rect = windowElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

        // Calculate visible area
        const visibleLeft = Math.max(0, rect.left);
        const visibleTop = Math.max(0, rect.top);
        const visibleRight = Math.min(viewportWidth, rect.right);
        const visibleBottom = Math.min(viewportHeight, rect.bottom);

        const visibleWidth = Math.max(0, visibleRight - visibleLeft);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        const visibleArea = visibleWidth * visibleHeight;

        const totalArea = rect.width * rect.height;
        return totalArea > 0 ? (visibleArea / totalArea) : 0;
    }

    addTaskbarItem(name, id, icon) {
        const dock = document.getElementById('dock');
        // Find the separator after Llama.cpp to insert new items after it
        const separators = dock.querySelectorAll('.dock-separator');
        const rightSeparator = separators[separators.length - 1]; // Get the last separator (after Llama.cpp)

        // Check if item already exists
        let item = document.getElementById(`taskbar-${id}`);
        if (!item) {
            item = document.createElement('button');
            item.className = 'taskbar-item';
            item.id = `taskbar-${id}`;
            // Add after the separator (after Llama.cpp)
            if (rightSeparator) {
                rightSeparator.parentNode.insertBefore(item, rightSeparator.nextSibling);
            } else {
                dock.appendChild(item);
            }
        }

        item.innerHTML = `${icon}`;
        // Add title attribute for hover tooltip showing full name
        item.title = name;

        // Add click handler to focus/minimize window
        item.addEventListener('click', () => {
            if (id === 'chat-application') {
                chatApp.toggle();
            } else {
                const window = this.windows.get(id);
                if (window) {
                    if (window.style.display === 'none' || window.classList.contains('hidden')) {
                        // Restore window
                        window.style.display = 'block';
                        window.classList.remove('hidden');
                        window.style.zIndex = ++this.windowZIndex;
                        item.classList.add('active');
                        item.classList.remove('minimized');

                        // Check if window is visible enough, reposition if needed
                        setTimeout(() => {
                            if (!this.checkWindowVisibility(window)) {
                                const result = this.repositionWindowToVisible(window);
                                if (result.moved) {
                                    const message = result.centered ?
                                        'Window was off-screen and has been centered' :
                                        'Window repositioned to visible area';
                                    this.showNotification(message, 'info');
                                }
                            }
                        }, 10); // Small delay to ensure display:block takes effect
                    } else if (window.style.zIndex < this.windowZIndex) {
                        // Window is visible but not on top - bring it to front
                        window.style.zIndex = ++this.windowZIndex;

                        // Update active states
                        document.querySelectorAll('.window').forEach(w => w.classList.remove('active'));
                        window.classList.add('active');

                        document.querySelectorAll('.taskbar-item').forEach(t => t.classList.remove('active'));
                        item.classList.add('active');
                        item.classList.remove('minimized');
                    } else {
                        // Window is already on top - minimize it
                        this.minimizeWindow(id);
                    }
                }
            }
        });

        item.classList.add('active');
    }

    async openExternalLink(url) {
        try {
            await invoke('open_url', { url: url });
        } catch (error) {
            console.error('Error opening external link:', error);
            this.showNotification('Failed to open link', 'error');
        }
    }

    async browseFolder(inputId) {
        try {
            // Get current value from input field to use as initial directory
            const inputElement = document.getElementById(inputId);
            const currentPath = inputElement?.value?.trim() || '';

            const result = await invoke('browse_folder', {
                initialDir: currentPath || null
            });

            if (result) {
                // Update the input field with the selected path
                if (inputElement) {
                    inputElement.value = result;
                    // Trigger change event to notify any listeners
                    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
                }
                this.showNotification('Folder selected successfully', 'success');
            } else {
                // User cancelled the dialog
                this.showNotification('Folder selection cancelled', 'info');
            }
        } catch (error) {
            console.error('Error browsing folder:', error);
            this.showNotification('Failed to open folder browser', 'error');
        }
    }

    async saveConfiguration() {
        const modelsDir = document.getElementById('models-directory').value;
        const execFolder = document.getElementById('executable-folder').value;
        const themeColor = document.getElementById('theme-color').value;
        const backgroundColor = document.getElementById('background-color').value;
        const themeSyncButton = document.getElementById('theme-sync-button');
        const themeIsSynced = themeSyncButton ? themeSyncButton.classList.contains('active') : true;

        try {
            const result = await invoke('save_config', {
                modelsDirectory: modelsDir,
                executableFolder: execFolder,
                themeColor: themeColor,
                backgroundColor: backgroundColor,
                themeIsSynced: themeIsSynced
            });

            if (result.success) {
                this.showNotification('Configuration saved!', 'success');
                this.applyTheme(themeColor, backgroundColor);
                document.body.dataset.theme = themeColor;
                document.body.dataset.background = backgroundColor;
                // Also update localStorage for immediate persistence on next load
                localStorage.setItem('Arandu-theme', themeColor);
                localStorage.setItem('Arandu-background', backgroundColor);
                localStorage.setItem('Arandu-theme-synced', themeIsSynced.toString());

                if (result.models) {
                    this.refreshDesktopIcons(result.models);
                }

                // Close the settings window after saving
                this.hideSettingsPanel();
            } else {
                this.showNotification('Failed to save configuration: ' + (result.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            console.error('Error saving configuration:', error);
            this.showNotification('Error saving configuration: ' + error.toString(), 'error');
        }
    }

    refreshDesktopIcons(models, useAnimation = true) {
        const desktopIcons = document.getElementById('desktop-icons');
        if (!desktopIcons) return;

        // Clear existing icons
        desktopIcons.innerHTML = '';

        // Group models by architecture
        const modelsByArch = {};
        models.forEach(model => {
            const arch = model.architecture || 'Unknown';
            if (!modelsByArch[arch]) {
                modelsByArch[arch] = [];
            }
            modelsByArch[arch].push(model);
        });

        // Store models data for search functionality
        this.modelsByArchitecture = modelsByArch;

        // Display architecture folders
        this.displayArchitectureFolders();

        // Add fade-in animation to all new icons simultaneously if requested
        if (useAnimation) {
            setTimeout(() => {
                const newIcons = document.querySelectorAll('.desktop-icon:not(.fade-in)');
                newIcons.forEach((icon) => {
                    icon.classList.add('fade-in');
                });
            }, 50); // Brief delay to ensure DOM updates
        } else {
            // Add fade-in class immediately without animation
            const newIcons = document.querySelectorAll('.desktop-icon:not(.fade-in)');
            newIcons.forEach((icon) => {
                icon.classList.add('fade-in');
            });
        }

        // Apply saved sort if any
        console.log('Checking saved sort state:', { sortType: this.sortType, sortDirection: this.sortDirection });
        if (this.sortType) {
            console.log('Applying saved sort:', this.sortType, this.sortDirection);
            setTimeout(() => {
                this.sortIcons(this.sortType, false, false); // Don't save or toggle direction
            }, 100);
        } else {
            console.log('No saved sort type found, icons will remain in default order');
        }

        // Update custom arguments indicators
        setTimeout(() => {
            this.updateCustomArgsIndicators();
        }, 150);

        //this.showNotification(`Desktop refreshed with ${models.length} model(s)`, 'success');
    }

    async refreshDesktop() {
        try {
            this.showNotification('Refreshing desktop...', 'info');

            // Add a small delay to ensure file system has processed any recent changes
            await new Promise(resolve => setTimeout(resolve, 100));

            const result = await invoke('scan_models_command');

            if (result.success && result.models) {
                this.refreshDesktopIcons(result.models, true); // Use animations for manual refresh
                
                // If folder view is open, refresh it too
                this.refreshFolderViewIfOpen();
            } else {
                throw new Error(result.error || 'Failed to scan models');
            }
        } catch (error) {
            console.error('Error refreshing desktop:', error);
            this.showNotification('Error refreshing desktop: ' + error.message, 'error');
        }
    }
    
    refreshFolderViewIfOpen() {
        const folderView = document.getElementById('search-folder-view');
        if (!folderView || folderView.classList.contains('hidden')) {
            return;
        }
        
        // Get the current folder title to know which view to refresh
        const folderTitle = document.getElementById('search-folder-title');
        if (!folderTitle) return;
        
        const title = folderTitle.textContent;
        
        if (title === 'Search Results') {
            // Re-run the search with current filter
            const searchInput = document.getElementById('search-folder-input');
            if (searchInput && searchInput.value.trim()) {
                this.filterFolderViewModels(searchInput.value);
            }
        } else if (title === 'Models') {
            // Refresh All Models view
            this.showArchitectureFolderView('All');
        } else {
            // Refresh architecture-specific view
            this.showArchitectureFolderView(title);
        }
    }

    async hasCustomArguments(modelPath) {
        if (!modelPath) return false;

        try {
            // Normalize path for consistent lookup (Windows backslashes)
            const normalizedPath = modelPath.replace(/\//g, '\\');
            const config = await invoke('get_model_settings', { modelPath: normalizedPath });
            if (!config) return false;

            // 1. Check main custom_args
            if (config.custom_args && config.custom_args.trim() !== '') return true;

            // 2. Check if ANY preset has non-empty custom arguments
            // This is more robust as it catches models with saved presets that aren't marked as default
            if (config.presets && Array.isArray(config.presets)) {
                if (config.presets.some(p => p.custom_args && p.custom_args.trim() !== '')) {
                    return true;
                }
            }

            // 3. Check for specific customized fields
            if (config.server_port && config.server_port !== 8080) return true;
            if (config.server_host && config.server_host !== '127.0.0.1') return true;

            return false;
        } catch (error) {
            console.error('Error checking custom arguments for', modelPath, ':', error);
            return false;
        }
    }

    // Update custom arguments indicators for all icons
    async updateCustomArgsIndicators() {
        // Desktop icons
        const icons = document.querySelectorAll('.desktop-icon:not(.architecture-icon)');
        const iconPromises = Array.from(icons).map(async (icon) => {
            const modelPath = icon.dataset.path;
            if (modelPath) {
                await this.updateSingleIconIndicator(icon, modelPath);
            }
        });

        // Folder view cards
        const cards = document.querySelectorAll('.model-card');
        const cardPromises = Array.from(cards).map(async (card) => {
            const modelPath = card.dataset.path;
            if (modelPath) {
                const hasCustomArgs = await this.hasCustomArguments(modelPath);
                const iconContainer = card.querySelector('.model-card-icon');
                if (iconContainer) {
                    // Add/remove has-custom-args class for the border indicator
                    if (hasCustomArgs) {
                        iconContainer.classList.add('has-custom-args');
                    } else {
                        iconContainer.classList.remove('has-custom-args');
                    }
                    
                    const existingIndicator = iconContainer.querySelector('.model-card-custom-indicator');
                    if (hasCustomArgs && !existingIndicator) {
                        const indicator = document.createElement('div');
                        indicator.className = 'model-card-custom-indicator';
                        iconContainer.appendChild(indicator);
                    } else if (!hasCustomArgs && existingIndicator) {
                        existingIndicator.remove();
                    }
                }
            }
        });

        await Promise.all([...iconPromises, ...cardPromises]);

        // Also update running model indicators
        await this.updateRunningModelIndicators();
    }

    // Check if a model is currently running in a terminal
    isModelRunning(modelPath) {
        if (!terminalManager || !modelPath) return false;
        
        // Check if there's an existing terminal for this model
        const existingTerminal = terminalManager.getExistingTerminal ? terminalManager.getExistingTerminal(modelPath) : null;
        if (existingTerminal) {
            const [windowId, terminalInfo] = existingTerminal;
            // Check if the terminal is actually running or starting (not stopped)
            return terminalInfo && (terminalInfo.status === 'running' || terminalInfo.status === 'starting');
        }
        return false;
    }

    // Update running model indicators for folder view cards
    async updateRunningModelIndicators() {
        const cards = document.querySelectorAll('.model-card');
        
        cards.forEach(card => {
            const modelPath = card.dataset.path;
            const iconContainer = card.querySelector('.model-card-icon');
            if (!iconContainer || !modelPath) return;

            const isRunning = this.isModelRunning(modelPath);
            
            if (isRunning) {
                iconContainer.classList.add('running');
            } else {
                iconContainer.classList.remove('running');
            }
        });
    }

    // Public method to refresh all indicators (called by terminal manager)
    refreshModelIndicators() {
        this.updateCustomArgsIndicators();
    }

    // Update custom arguments indicator for a single icon
    async updateSingleIconIndicator(icon, modelPath) {
        const hasCustomArgs = await this.hasCustomArguments(modelPath);
        const iconImage = icon.querySelector('.icon-image');

        if (!iconImage) {
            console.warn('No icon-image found for icon:', icon);
            return;
        }

        const existingIndicator = iconImage.querySelector('.custom-args-indicator');

        if (hasCustomArgs && !existingIndicator) {
            // Add indicator to the icon-image element
            const indicator = document.createElement('div');
            indicator.className = 'custom-args-indicator';
            iconImage.appendChild(indicator);
        } else if (!hasCustomArgs && existingIndicator) {
            // Remove indicator
            existingIndicator.remove();
        }
    }

    applyTheme(theme, background) {
        const root = document.documentElement;

        // Use centralized theme definitions
        const selectedTheme = themeDefinitions[theme] || themeDefinitions['dark-gray'];
        const selectedBackground = themeDefinitions[background] || themeDefinitions['dark-gray'];

        root.style.setProperty('--theme-primary', selectedTheme.primary);
        root.style.setProperty('--theme-light', selectedTheme.light);
        root.style.setProperty('--theme-dark', selectedTheme.dark);
        root.style.setProperty('--theme-accent', selectedTheme.accent);
        root.style.setProperty('--theme-surface', selectedTheme.surface);
        root.style.setProperty('--theme-surface-light', selectedTheme.surfaceLight);
        root.style.setProperty('--theme-text', selectedTheme.text);
        root.style.setProperty('--theme-text-muted', selectedTheme.textMuted);
        root.style.setProperty('--theme-border', selectedTheme.border);
        root.style.setProperty('--theme-hover', selectedTheme.hover);
        root.style.setProperty('--theme-glow', selectedTheme.glow);
        root.style.setProperty('--theme-glow-light', selectedTheme.glowLight);
        root.style.setProperty('--theme-glow-strong', selectedTheme.glowStrong);
        root.style.setProperty('--theme-bg-light', selectedTheme.bgLight);
        root.style.setProperty('--theme-bg-medium', selectedTheme.bgMedium);
        root.style.setProperty('--theme-bg-strong', selectedTheme.bgStrong);
        root.style.setProperty('--theme-error', selectedTheme.error);
        root.style.setProperty('--theme-error-bg', selectedTheme.errorBg);
        root.style.setProperty('--theme-warning', selectedTheme.warning);
        root.style.setProperty('--theme-warning-bg', selectedTheme.warningBg);
        root.style.setProperty('--theme-success', selectedTheme.success);
        root.style.setProperty('--theme-success-bg', selectedTheme.successBg);

        root.style.setProperty('--theme-bg', selectedBackground.bg);
        root.style.setProperty('--theme-gradient-start', selectedBackground.gradientStart);
        root.style.setProperty('--theme-gradient-middle', selectedBackground.gradientMiddle);
        root.style.setProperty('--theme-gradient-end', selectedBackground.gradientEnd);

        document.body.dataset.theme = theme;
        document.body.dataset.background = background;
        this.saveDesktopState();
    }



    showSettingsMenu(event) {
        event.stopPropagation();

        const menu = document.getElementById('settings-popup-menu');
        if (!menu) return;

        // Get button position and size
        const button = event.target;
        const buttonRect = button.getBoundingClientRect();

        // Position menu below and to the right of the button
        let left = buttonRect.right + 5; // 5px offset from button
        let top = buttonRect.top;

        // Ensure menu doesn't go off screen
        const menuWidth = 200; // approximate menu width
        const menuHeight = 300; // approximate max menu height

        // Adjust horizontal position if menu would go off right edge
        if (left + menuWidth > window.innerWidth) {
            left = buttonRect.left - menuWidth - 5; // Show to the left of button instead
        }

        // Adjust vertical position if menu would go off bottom edge
        if (top + menuHeight > window.innerHeight) {
            top = window.innerHeight - menuHeight - 10;
        }

        // Ensure menu doesn't go above viewport
        if (top < 10) {
            top = 10;
        }

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        // Show menu
        menu.classList.remove('hidden');

        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!e.target.closest('#settings-popup-menu')) {
                menu.classList.add('hidden');
                document.removeEventListener('click', closeMenu);
            }
        };

        // Add click listener after a small delay to prevent immediate closing
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    async addSettingFromMenu(settingId) {
        if (propertiesManager) {
            await propertiesManager.addSettingFromMenu(settingId);
        } else {
            console.error('Properties manager not initialized');
        }
    }

    async addSettingById(settingId) {
        if (propertiesManager) {
            await propertiesManager.addSettingById(settingId);
        } else {
            console.error('Properties manager not initialized');
        }
    }

    async removeSetting(settingId) {
        if (propertiesManager) {
            await propertiesManager.removeSetting(settingId);
        } else {
            console.error('Properties manager not initialized');
        }
    }





    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showNotification(message, type = 'info') {
        // Limit to one notification at a time to prevent performance issues
        let notification = document.getElementById('notification');
        if (notification) {
            // Update existing notification
            notification.textContent = message;
            // Reset animation
            notification.style.transform = 'translateX(400px)';
        } else {
            // Create new notification
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.style.cssText = `
                position: fixed; top: 20px; right: 20px; padding: 12px 20px;
                border-radius: 6px; color: rgba(255, 255, 255, 0.9); z-index: 9999;
                transform: translateX(400px); transition: transform 0.3s ease;
                background: rgba(0, 0, 0, 0.375); backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1); font-size: 13px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            `;
            document.body.appendChild(notification);
        }

        // Use same discrete dark background for all notification types
        notification.style.background = 'rgba(0, 0, 0, 0.375)';
        notification.style.borderColor = 'rgba(255, 255, 255, 0.1)';
        notification.textContent = message;

        // Use requestAnimationFrame for better performance
        requestAnimationFrame(() => {
            notification.style.transform = 'translateX(0)';
        });

        setTimeout(() => {
            notification.style.transform = 'translateX(400px)';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    async updateSystemStats() {
        try {
            const stats = await invoke('get_system_stats');

            // Update memory bars with current stats
            this.updateMemoryBars(stats);

            // Update expanded details if visible
            const memoryMonitor = document.getElementById('desktop-memory-monitor');
            if (memoryMonitor && memoryMonitor.classList.contains('expanded')) {
                this.updateMemoryMonitorDetails(stats);
            }
        } catch (error) {
            console.error('Failed to update system stats:', error);
        }
    }

    setupSystemMonitorIcon() {
        const monitorIcon = document.getElementById('desktop-memory-monitor');
        if (monitorIcon) {
            // Add click event listener to toggle expanded state
            monitorIcon.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    // Fetch fresh system stats each time
                    const stats = await invoke('get_system_stats');
                    this.toggleMemoryMonitorExpanded(stats, monitorIcon);
                } catch (error) {
                    console.error('Failed to fetch system stats:', error);
                }
            });
        }
    }

    toggleMemoryMonitorExpanded(stats, monitorElement) {
        const isExpanded = monitorElement.classList.contains('expanded');

        if (isExpanded) {
            // Collapse
            monitorElement.classList.remove('expanded');
            monitorElement.classList.remove('active');
        } else {
            // Expand and show details
            monitorElement.classList.add('expanded');
            monitorElement.classList.add('active');
            this.updateMemoryMonitorDetails(stats);
        }
    }

    updateMemoryMonitorDetails(stats) {
        const detailsContainer = document.getElementById('memory-monitor-details');
        if (!detailsContainer) return;

        const ramUsedGB = stats.memory_used_gb.toFixed(2);
        const ramTotalGB = stats.memory_total_gb.toFixed(2);
        const vramUsedGB = stats.gpu_memory_used_gb.toFixed(2);
        const vramTotalGB = stats.gpu_memory_total_gb.toFixed(2);
        const cpuUsage = stats.cpu_usage.toFixed(1);
        const gpuUsage = stats.gpu_usage.toFixed(1);
        const modelsFolderSizeGB = stats.models_folder_size_gb.toFixed(2);
        const modelsCount = stats.models_count;

        let content = `
            <div class="system-section">
                <div class="section-header">
                    <span class="material-icons">computer</span>
                    <span>System</span>
                </div>
                <div class="info-grid">
                    <div class="info-cell">
                        <div class="label">CPU Usage</div>
                        <div class="value">${cpuUsage}<span class="unit">%</span></div>
                    </div>
                    <div class="info-cell">
                        <div class="label">RAM Used</div>
                        <div class="value">${ramUsedGB}<span class="unit">GB</span></div>
                    </div>
                    <div class="info-cell">
                        <div class="label">RAM Total</div>
                        <div class="value">${ramTotalGB}<span class="unit">GB</span></div>
                    </div>
                </div>
            </div>
        `;

        if (stats.gpu_name && stats.gpu_name !== 'Unknown' && stats.gpu_name !== 'No NVIDIA GPU detected' && stats.gpu_name !== 'No GPU detected') {
            content += `
                <div class="system-section">
                    <div class="section-header">
                        <span class="material-icons">videogame_asset</span>
                        <span>Graphics</span>
                    </div>
                    <div class="gpu-name">${stats.gpu_name}</div>
                    <div class="info-grid">
                        <div class="info-cell">
                            <div class="label">GPU Usage</div>
                            <div class="value">${gpuUsage}<span class="unit">%</span></div>
                        </div>
                        <div class="info-cell">
                            <div class="label">VRAM Used</div>
                            <div class="value">${vramUsedGB}<span class="unit">GB</span></div>
                        </div>
                        <div class="info-cell">
                            <div class="label">VRAM Total</div>
                            <div class="value">${vramTotalGB}<span class="unit">GB</span></div>
                        </div>
                    </div>
                </div>
            `;
        }

        content += `
            <div class="system-section">
                <div class="section-header">
                    <span class="material-icons">folder</span>
                    <span>Models Storage</span>
                </div>
                <div class="info-grid">
                    <div class="info-cell">
                        <div class="label">Total Size</div>
                        <div class="value">${modelsFolderSizeGB}<span class="unit">GB</span></div>
                    </div>
                    <div class="info-cell">
                        <div class="label">Model Count</div>
                        <div class="value">${modelsCount}<span class="unit"></span></div>
                    </div>
                </div>
            </div>
        `;

        detailsContainer.innerHTML = content;
    }

    hideSystemInfoPopup() {
        // Update icon active state
        const monitorIcon = document.getElementById('desktop-memory-monitor');
        if (monitorIcon) {
            monitorIcon.classList.remove('active');
        }

        const popup = document.getElementById('system-info-popup');
        if (popup) {
            popup.style.opacity = '0';
            setTimeout(() => {
                if (popup.parentNode) {
                    popup.parentNode.removeChild(popup);
                }
            }, 200);
        }
    }

    updateTaskbarButtonState(buttonId, isActive) {
        const button = document.getElementById(buttonId);
        if (button) {
            if (isActive) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        }
    }

    // Session Management Methods
    async loadSessionState() {
        // For Tauri version, try to load from server session first, then fallback to localStorage
        try {
            // First try to load from server session API
            let sessionData = null;
            try {
                const response = await fetch('/api/session/state');
                if (response.ok) {
                    sessionData = await response.json();
                    console.log('Loaded session data from server:', sessionData);
                }
            } catch (error) {
                console.log('Server session not available, using localStorage');
            }

            // Fallback to localStorage if server session fails
            if (!sessionData) {
                sessionData = JSON.parse(localStorage.getItem('Arandu-session') || '{}');
                console.log('Loaded session data from localStorage:', sessionData);
            }

            this.sessionData = sessionData;

            // Restore desktop state from session data or localStorage
            const desktopState = sessionData.desktop_state || {};

            // Try to get sorting state from session data first, then localStorage as fallback
            this.sortType = desktopState.sort_type || localStorage.getItem('iconSortOrder');
            this.sortDirection = desktopState.sort_direction || localStorage.getItem('iconSortDirection') || 'asc';

            // Load folder view sort state
            this.folderSortType = localStorage.getItem('folderSortType');
            this.folderSortDirection = localStorage.getItem('folderSortDirection') || 'asc';

            // Initialize hide suppressed button state
            this.updateHideSuppressedButton();

            console.log('Restored sorting state:', { sortType: this.sortType, sortDirection: this.sortDirection });
            console.log('Restored folder sorting state:', { folderSortType: this.folderSortType, folderSortDirection: this.folderSortDirection });

            // Update localStorage with session data if we got it from server
            if (sessionData.desktop_state) {
                if (this.sortType) {
                    localStorage.setItem('iconSortOrder', this.sortType);
                }
                if (this.sortDirection) {
                    localStorage.setItem('iconSortDirection', this.sortDirection);
                }
            }

        } catch (error) {
            console.error('Error loading session state:', error);
        }
    }


    async syncSessionState() {
        try {
            // Sync desktop state
            await this.saveDesktopState();

            // Sync all windows
            for (const [windowId, windowElement] of this.windows) {
                await this.saveWindowState(windowId, windowElement);
            }

            // Sync terminals
            if (terminalManager) {
                for (const [windowId, terminalData] of terminalManager.getAllTerminals()) {
                    await terminalManager.saveTerminalState(windowId, terminalData);
                }
            }

            // Sync chats through chat app
            if (window.chatApp && window.chatApp.chats) {
                for (const [windowId, chatData] of window.chatApp.chats) {
                    await window.chatApp.saveChatState(windowId, chatData);
                }
            }

        } catch (error) {
            console.error('Error syncing session state:', error);
        }
    }

    async saveWindowState(windowId, windowElement) {
        try {
            const rect = windowElement.getBoundingClientRect();
            const isMinimized = windowElement.style.display === 'none';

            // For minimized windows, use stored dimensions or fall back to computed style
            let windowSize;
            if (isMinimized) {
                // Try to get stored dimensions from the element's data attributes or default values
                const storedWidth = windowElement.dataset.savedWidth || windowElement.style.width;
                const storedHeight = windowElement.dataset.savedHeight || windowElement.style.height;
                windowSize = {
                    width: parseInt(storedWidth) || 800,  // Default width
                    height: parseInt(storedHeight) || 600  // Default height
                };
            } else {
                windowSize = { width: rect.width, height: rect.height };
            }

            const windowData = {
                windowId,
                type: windowElement.classList.contains('server-terminal-window') ? 'terminal' :
                    windowElement.classList.contains('properties-window') ? 'properties' :
                        windowElement.classList.contains('chat-application-window') ? 'chat-app' : 'unknown',
                title: windowElement.querySelector('.window-title')?.textContent || '',
                position: { x: parseInt(windowElement.style.left) || rect.left, y: parseInt(windowElement.style.top) || rect.top },
                size: windowSize,
                visible: !isMinimized && !windowElement.classList.contains('hidden'),
                zIndex: parseInt(windowElement.style.zIndex) || 1000
            };

            const response = await fetch('/api/session/window', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(windowData)
            });

            if (!response.ok) {
                console.error('Failed to save window state:', response.statusText);
            }
        } catch (error) {
            console.error('Error saving window state:', error);
        }
    }




    async saveDesktopState() {
        try {
            const desktopState = {
                sort_type: this.sortType,
                sort_direction: this.sortDirection,
                theme: document.body.dataset.theme || 'dark-gray',
                background: document.body.dataset.background || 'dark-gray',
                theme_synced: document.getElementById('theme-sync-button')?.classList.contains('active') ?? true,
                icon_positions: Object.fromEntries(this.iconPositions)
            };

            // Save to server session API (if available)
            try {
                const response = await fetch('/api/session/desktop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(desktopState)
                });

                if (!response.ok) {
                    console.error('Failed to save desktop state to server:', response.statusText);
                }
            } catch (error) {
                console.log('Server session API not available, saving to localStorage only');
            }

            // Also save to localStorage as backup and for Tauri version
            const currentSession = JSON.parse(localStorage.getItem('Arandu-session') || '{}');
            currentSession.desktop_state = desktopState;
            localStorage.setItem('Arandu-session', JSON.stringify(currentSession));

            // Also save individual sort settings to localStorage for backward compatibility
            if (this.sortType) {
                localStorage.setItem('iconSortOrder', this.sortType);
                localStorage.setItem('iconSortDirection', this.sortDirection);
            }

        } catch (error) {
            console.error('Error saving desktop state:', error);
        }
    }

    getSessionDesktopState() {
        return {
            sort_type: this.sortType,
            sort_direction: this.sortDirection,
            theme: document.body.dataset.theme || 'blue'
        };
    }

    restoreSessionWindows() {
        // This method is called after the UI is fully loaded to ensure windows restore properly
        // The actual restoration logic is already handled in loadSessionState
        console.log('Session windows restoration complete');
    }

    restoreWindow(windowId, windowData) {
        console.log('Restoring window type:', windowData.type, 'for windowId:', windowId);

        // Create window based on type
        switch (windowData.type) {
            case 'chat':
                // Chat functionality moved to separate chat application
                console.log('Chat window restoration skipped - using new chat application');
                break;
            case 'chat-app':
                // Chat app windows are managed by the chat application
                console.log('Chat-app window restoration skipped - managed by chat application');
                break;
            case 'terminal':
                const terminalData = terminalManager ? terminalManager.getTerminalData(windowId) : null;
                console.log('Terminal data for restoration:', terminalData);
                if (terminalData) {
                    terminalManager.restoreTerminalWindow(windowId, terminalData, windowData);
                } else {
                    console.warn('No terminal data found for window:', windowId);
                }
                break;
            case 'properties':
                // Properties windows are recreated on demand
                console.log('Properties window restoration skipped');
                break;
            default:
                console.warn('Unknown window type for restoration:', windowData.type);
        }
    }




    async removeWindowFromSession(windowId) {
        try {
            await fetch(`/api/session/window/${windowId}`, { method: 'DELETE' });

            // Also remove from terminals and chats if applicable
            if (terminalManager && terminalManager.terminals.has(windowId)) {
                await fetch(`/api/session/terminal/${windowId}`, { method: 'DELETE' });
                terminalManager.removeTerminal(windowId);
            }

            if (window.chatApp && window.chatApp.chats && window.chatApp.chats.has(windowId)) {
                await window.chatApp.removeChatFromSession(windowId);
            }
        } catch (error) {
            console.error('Error removing window from session:', error);
        }
    }

    // Method to open URL in default browser
    async openUrl(url) {
        try {
            // Use Tauri command to open URL in external browser
            if (window.__TAURI__ && window.__TAURI__.core) {
                const { invoke } = window.__TAURI__.core;
                await invoke('open_url', { url });
            } else {
                // Fallback to window.open
                window.open(url, '_blank');
            }
        } catch (error) {
            console.error('Error opening URL:', error);
            // Fallback to window.open
            window.open(url, '_blank');
        }
    }

    // Update memory bars with current system stats
    updateMemoryBars(stats) {
        // Calculate RAM usage percentage
        const ramPercent = stats.memory_total_gb > 0 ?
            (stats.memory_used_gb / stats.memory_total_gb) * 100 : 0;

        // Calculate VRAM usage percentage (if GPU is detected)
        const vramPercent = stats.gpu_memory_total_gb > 0 &&
            stats.gpu_name !== "Unknown" &&
            stats.gpu_name !== "No NVIDIA GPU detected" &&
            stats.gpu_name !== "No GPU detected" ?
            (stats.gpu_memory_used_gb / stats.gpu_memory_total_gb) * 100 : 0;

        // Helper to get color from gray to red
        function getBarColor(percent) {
            // 0-80%: gray (#888), 80-100%: transition to red (#e74c3c)
            const start = { r: 136, g: 136, b: 136 };
            const end = { r: 231, g: 76, b: 60 };
            if (percent <= 80) {
                return `rgb(${start.r},${start.g},${start.b})`;
            } else {
                // t goes from 0 (at 80%) to 1 (at 100%)
                const t = Math.min(Math.max(percent - 80, 0), 20) / 20;
                const r = Math.round(start.r + (end.r - start.r) * t);
                const g = Math.round(start.g + (end.g - start.g) * t);
                const b = Math.round(start.b + (end.b - start.b) * t);
                return `rgb(${r},${g},${b})`;
            }
        }

        // Update RAM bar
        const ramFill = document.querySelector('.memory-bar-ram .memory-fill');
        if (ramFill) {
            ramFill.style.width = `${ramPercent}%`;
            ramFill.style.background = getBarColor(ramPercent);
        }

        // Update VRAM bar
        const vramFill = document.querySelector('.memory-bar-vram .memory-fill');
        if (vramFill) {
            vramFill.style.width = `${vramPercent}%`;
            vramFill.style.background = getBarColor(vramPercent);
        }

        // Update the title attributes for hover tooltips
        const memoryMonitor = document.getElementById('desktop-memory-monitor');
        if (memoryMonitor) {
            const containers = memoryMonitor.querySelectorAll('.memory-bar-container');
            const ramContainer = containers[0];
            const vramContainer = containers[1];

            if (ramContainer) {
                ramContainer.title = `RAM: ${stats.memory_used_gb.toFixed(2)}GB / ${stats.memory_total_gb.toFixed(2)}GB (${ramPercent.toFixed(1)}%)`;
            }

            if (vramContainer) {
                if (stats.gpu_name !== "Unknown" && stats.gpu_name !== "No NVIDIA GPU detected" && stats.gpu_name !== "No GPU detected") {
                    vramContainer.title = `VRAM: ${stats.gpu_memory_used_gb.toFixed(2)}GB / ${stats.gpu_memory_total_gb.toFixed(2)}GB (${vramPercent.toFixed(1)}%)`;
                } else {
                    vramContainer.title = 'VRAM: Not available';
                    // If no GPU, set VRAM bar to 0%
                    if (vramFill) {
                        vramFill.style.width = '0%';
                        vramFill.style.background = getBarColor(0);
                    }
                }
            }
        }
    }
}

// Global manager instances
let terminalManager;
let huggingFaceApp;
let propertiesManager;
let downloadManager;
let llamacppReleasesManager;

// Initialize the desktop
const desktop = new DesktopManager();


// Initialize module manager and other modules after desktop is created
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded: Starting module initialization...');

    // Initialize module manager first
    if (typeof ModuleManager !== 'undefined') {
        window.moduleManager = new ModuleManager(desktop);
        console.log('✓ Module manager initialized');
    }

    // Initialize other modules with simple error handling
    const initializeModule = (ManagerClass, managerName, globalVar) => {
        try {
            if (typeof ManagerClass !== 'undefined') {
                const manager = new ManagerClass(desktop);
                window[globalVar] = manager;
                console.log(`✓ ${managerName} initialized`);
                return true;
            } else {
                console.warn(`⚠ ${managerName} class not available`);
                return false;
            }
        } catch (error) {
            console.error(`✗ Error initializing ${managerName}:`, error);
            return false;
        }
    };

    // Initialize all modules
    initializeModule(window.TerminalManager, 'Terminal Manager', 'terminalManager');
    initializeModule(window.PropertiesManager, 'Properties Manager', 'propertiesManager');
    initializeModule(window.DownloadManager, 'Download Manager', 'downloadManager');
    initializeModule(window.LlamaCppReleasesManager, 'Llama.cpp Releases Manager', 'llamacppReleasesManager');
    initializeModule(window.HuggingFaceApp, 'HuggingFace App', 'huggingFaceApp');

    console.log('Module initialization complete');
});