// Properties Management Module
class PropertiesManager {
    constructor(desktop) {
        this.desktop = desktop;
        // Initialize Tauri API access
        this.invoke = null;
        this.initTauriAPI();
    }

    initTauriAPI() {
        try {
            if (window.__TAURI__ && window.__TAURI__.core) {
                this.invoke = window.__TAURI__.core.invoke;
                console.log('Tauri API initialized in PropertiesManager');
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

    showProperties(icon) {
        const modelPath = icon.dataset.path;
        const modelName = icon.dataset.name;

        // Extract metadata from icon dataset
        const metadata = {
            size: icon.dataset.size,
            architecture: icon.dataset.architecture,
            quantization: icon.dataset.quantization,
            date: icon.dataset.date
        };

        console.log('Opening properties for:', modelPath);
        this.openPropertiesWindow(modelName, modelPath, metadata);
    }

    openPropertiesWindow(modelName, modelPath, metadata = null) {
        // Use consistent window ID based on model path to prevent multiple windows
        const windowId = 'props_' + btoa(modelPath).replace(/[^a-zA-Z0-9]/g, '');

        // Check if properties window is already open for this model
        const existingWindow = this.desktop.windows.get(windowId);
        if (existingWindow && !existingWindow.classList.contains('hidden')) {
            // Focus existing window
            existingWindow.style.zIndex = ++this.desktop.windowZIndex;
            return;
        }

        // Use Tauri command instead of fetch
        const invoke = this.getInvoke();
        if (!invoke) {
            console.error('Tauri invoke not available for loading model settings');
            return;
        }

        Promise.all([
            invoke('get_model_settings', { modelPath: modelPath }),
            invoke('get_model_presets', { modelPath: modelPath })
        ])
            .then(async ([config, presets]) => {
                console.log('Loaded config for', modelPath, ':', config);
                console.log('Loaded presets for', modelPath, ':', presets);
                
                // If no presets exist, create a default one
                if (!presets || presets.length === 0) {
                    const defaultPreset = {
                        id: 'preset_' + Date.now(),
                        name: 'Default',
                        custom_args: config.custom_args || '',
                        is_default: true
                    };
                    await invoke('save_model_preset', { modelPath: modelPath, preset: defaultPreset });
                    presets = [defaultPreset];
                }
                
                const content = await this.generatePropertiesContent(config, modelPath, metadata, presets);
                const window = this.desktop.createWindow(windowId, `Properties - ${modelName}`, 'properties-window', content);
                // Add to taskbar
                this.desktop.addTaskbarItem(`Properties - ${modelName}`, windowId, '<span class="material-icons">settings</span>');
                this.setupPropertiesSync(window);
                
                // Setup drag and drop for initial content
                const visualizer = window.querySelector('#arguments-visualizer');
                if (visualizer) {
                    this.initDragAndDrop(visualizer);
                }
                
                // Setup preset list interactions
                this.setupPresetListeners(window, modelPath);
                
                // Initialize working presets
                window.workingPresets = [...presets]; // Create a copy for editing
                
                // Auto-select default preset or first preset
                const defaultPreset = presets.find(p => p.is_default) || presets[0];
                if (defaultPreset) {
                    // Trigger click on the default preset
                    setTimeout(() => {
                        const presetItem = window.querySelector(`[data-preset-id="${defaultPreset.id}"]`);
                        if (presetItem) {
                            presetItem.click();
                        }
                    }, 100);
                }
            })
            .catch(error => {
                console.error('Error loading model settings:', error);
            });
    }

    async generatePropertiesContent(config, modelPath, metadata = null, presets = []) {
        try {
            // Load settings configuration
            const settingsConfig = await this.desktop.loadSettingsConfig();
            console.log('Settings config loaded:', settingsConfig.length, 'settings');

            // Generate Visualizer HTML
            const visualizerHTML = await this.generateArgumentsVisualizer(config.custom_args || '', settingsConfig);

            // Generate file info HTML if metadata is available
            let fileInfoHTML = '';
            if (metadata) {
                const sizeGB = parseFloat(metadata.size);
                const formattedSize = isNaN(sizeGB) ? 'Unknown' : sizeGB.toFixed(2);
                const dateTime = new Date(parseFloat(metadata.date) * 1000).toLocaleString(undefined, { hour12: false });

                fileInfoHTML = `
                    <div class="file-info-inline">
                        <div class="file-info-group">
                            <span class="file-info-label">Arch:</span>
                            <span class="file-info-value">${metadata.architecture || 'Unknown'}</span>
                        </div>
                        <div class="file-info-separator"></div>
                        <div class="file-info-group">
                            <span class="file-info-label">Quant:</span>
                            <span class="file-info-value">${metadata.quantization || 'Unknown'}</span>
                        </div>
                        <div class="file-info-separator"></div>
                        <div class="file-info-group">
                            <span class="file-info-label">Size:</span>
                            <span class="file-info-value">${formattedSize} GB</span>
                        </div>
                        <div class="file-info-separator"></div>
                        <div class="file-info-group">
                            <span class="file-info-label">Modified:</span>
                            <span class="file-info-value">${dateTime}</span>
                        </div>
                    </div>
                `;
            }

            // Generate presets list HTML
            const presetsListHTML = this.generatePresetsListHTML(presets);

            // Generate settings list HTML
            const settingsListHTML = await this.generateSettingsListHTML(config.custom_args || '', settingsConfig);

            return `
                <div class="properties-container">
                    <div class="properties-sidebar">
                        <div class="presets-header">
                            <h4>Presets</h4>
                            <button class="preset-add-btn" onclick="propertiesManager.createNewPreset()" title="Create new preset">
                                <span class="material-icons">add</span>
                            </button>
                        </div>
                        <div class="presets-list" id="presets-list">
                            ${presetsListHTML}
                        </div>
                    </div>
                    <div class="properties-main">
                        <div class="properties-header-row">
                            <div class="header-buttons">
                                <button class="open-folder-btn" onclick="propertiesManager.openModelFolder('${btoa(modelPath)}')" title="Open model folder in file explorer">
                                    <span class="material-icons">folder_open</span>
                                </button>
                            </div>
                            ${fileInfoHTML}
                        </div>
                        
                        <div class="arguments-header">
                            <h4 id="arguments-title">Arguments</h4>
                            <div class="view-toggle">
                                <button class="toggle-btn active" onclick="propertiesManager.switchView('visual')" id="btn-visual">Visual</button>
                                <button class="toggle-btn" onclick="propertiesManager.switchView('raw')" id="btn-raw">Raw</button>
                            </div>
                        </div>

                        <div id="view-visual" class="arguments-content">
                            <div class="property-group" data-model-path="${btoa(modelPath)}">
                                <div class="arguments-visualizer" id="arguments-visualizer">
                                    ${visualizerHTML}
                                </div>
                                <div class="drag-hint">Drag to reorganize, Click to edit.</div>
                                <div class="copy-args-container">
                                    <button class="copy-args-btn" onclick="propertiesManager.copyArgumentsAsRaw()" title="Copy all arguments as raw text">
                                        <span class="material-icons">content_copy</span>
                                    </button>
                                    <button class="paste-args-btn" onclick="propertiesManager.pasteArgumentsAsRaw()" title="Paste arguments from clipboard">
                                        <span class="material-icons">content_paste</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div id="view-raw" class="arguments-content hidden">
                            <div class="property-group">
                                 <div class="custom-args-section">
                                    <textarea class="property-textarea" data-field="custom_args" placeholder="Additional custom arguments will be preserved" spellcheck="false">${config.custom_args || ''}</textarea>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="settings-sidebar">
                        <div class="settings-header">
                            <h4>Available Settings</h4>
                        </div>
                        <div class="settings-search-container">
                            <input type="text" class="settings-search-input" placeholder="Search settings..." 
                                   oninput="propertiesManager.filterSettingsList(this.value)" 
                                   onclick="event.stopPropagation()">
                            <button class="settings-search-clear" onclick="propertiesManager.clearSettingsSearch()" title="Clear search">
                                <span class="material-icons">close</span>
                            </button>
                        </div>
                        <div class="settings-list" id="settings-list">
                            ${settingsListHTML}
                        </div>
                    </div>
                    
                    <div class="properties-button-container">
                        <div class="properties-bottom-section">
                            <div class="button-section">
                                <div class="button-left">
                                    <button class="delete-file-btn" onclick="propertiesManager.deleteModelFile('${btoa(modelPath)}')" title="Delete this model file">
                                        <span class="material-icons">delete</span>
                                        Delete File
                                    </button>
                                </div>
                                <div class="button-note">
                                </div>
                                <div class="button-group">
                                    <button class="properties-btn cancel-btn" onclick="propertiesManager.closePropertiesWindow()">Cancel</button>
                                    <button class="properties-btn save-btn" onclick="propertiesManager.saveProperties()">Save</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error generating properties content:', error);
            return `<div class="properties-container"><div class="properties-main"><p>Error loading properties</p></div></div>`;
        }
    }

    generatePresetsListHTML(presets) {
        if (!presets || presets.length === 0) {
            return '<div class="preset-empty">No presets yet</div>';
        }

        return presets.map(preset => `
            <div class="preset-item ${preset.is_default ? 'default' : ''}" data-preset-id="${preset.id}">
                <div class="preset-content">
                    <div class="preset-name" contenteditable="false" data-original-name="${preset.name}">${preset.name}</div>
                    <div class="preset-indicator">
                        ${preset.is_default ? '<span class="material-icons">home</span>' : ''}
                    </div>
                </div>
                <button class="preset-action-btn" onclick="propertiesManager.showPresetMenu(event, '${preset.id}')" title="More actions">
                    <span class="material-icons">more_vert</span>
                </button>
            </div>
        `).join('');
    }

    async generateSettingsListHTML(customArgs, settingsConfig) {
        const parsedSettings = customArgs && customArgs.trim() ? await this.desktop.parseArgumentsToSettings(customArgs) : {};

        // Group by category
        const categories = {};
        settingsConfig.forEach(setting => {
            const cat = setting.category || 'Other';
            if (!categories[cat]) categories[cat] = [];
            
            // Mark if setting is already enabled
            setting.isEnabled = parsedSettings[setting.id + '_enabled'] || false;
            categories[cat].push(setting);
        });

        let html = '';
        const sortedCats = Object.keys(categories).sort();
        
        for (const cat of sortedCats) {
            html += `
                <div class="settings-category collapsed" data-category="${cat}">
                    <div class="settings-category-header" onclick="propertiesManager.toggleSettingsCategory(this.parentNode)">
                        <span class="material-icons arrow-icon">expand_more</span>
                        ${cat}
                        <span class="category-count">(${categories[cat].length})</span>
                    </div>
                    <div class="settings-category-items">
            `;
            
            categories[cat].forEach(setting => {
                const searchText = `${setting.name} ${setting.description} ${setting.argument} ${setting.aliases ? setting.aliases.join(' ') : ''}`.toLowerCase();
                const isEnabled = setting.isEnabled;
                const itemClass = isEnabled ? 'settings-item in-use' : 'settings-item';
                const onclick = `onclick="propertiesManager.toggleSetting('${setting.id}')"`;
                const title = setting.description;
                
                html += `
                    <div class="${itemClass}"
                         ${onclick}
                         title="${title}"
                         data-search-text="${searchText}">
                        <div class="setting-info">
                            <div class="setting-name">${setting.name}</div>
                            <div class="setting-description">${setting.description}</div>
                        </div>
                    </div>
                `;
            });
            
            html += `</div></div>`;
        }
        
        // Add custom argument option at the bottom - outside any category
        html += `
            <div class="settings-item custom-arg-item" onclick="propertiesManager.addCustomArgument()" title="Add a custom argument" style="margin-top: 8px;">
                <div class="setting-info">
                    <div class="setting-name">+ Custom Argument</div>
                    <div class="setting-description">Add a custom command line argument</div>
                </div>
            </div>
        `;
        
        return html;
    }

    setupPresetListeners(window, modelPath) {
        const presetsList = window.querySelector('#presets-list');
        if (!presetsList) return;

        // Store the currently selected preset ID on the window
        window.dataset.selectedPresetId = '';
        
        // Initialize working presets list - this is the single source of truth
        if (!window.workingPresets) {
            window.workingPresets = [];
        }

        // Click on preset to load it
        presetsList.addEventListener('click', async (e) => {
            const presetItem = e.target.closest('.preset-item');
            if (presetItem && !e.target.closest('.preset-action-btn')) {
                // Don't handle click if we're clicking on an editable preset name
                const presetName = e.target.closest('.preset-name');
                if (presetName && presetName.contentEditable === 'true') {
                    return;
                }

                const presetId = presetItem.dataset.presetId;
                
                // Save current preset's arguments to temp storage before switching
                await this.saveCurrentPresetToTemp(window, modelPath);
                
                // Update visual selection
                presetsList.querySelectorAll('.preset-item').forEach(item => {
                    item.classList.remove('selected');
                });
                presetItem.classList.add('selected');
                
                // Store selected preset ID
                window.dataset.selectedPresetId = presetId;
                
                await this.loadPreset(presetId, modelPath, window);
            }
        });
    }

    async saveCurrentPresetToTemp(window, modelPath) {
        const currentPresetId = window.dataset.selectedPresetId;
        if (!currentPresetId) {
            return; // No preset selected yet
        }

        // Initialize working presets if not exists
        if (!window.workingPresets) {
            const invoke = this.getInvoke();
            if (!invoke) return;
            window.workingPresets = await invoke('get_model_presets', { modelPath: modelPath });
        }

        // Update the preset in working list directly
        const textarea = window.querySelector('[data-field="custom_args"]');
        if (textarea) {
            const preset = window.workingPresets.find(p => p.id === currentPresetId);
            if (preset) {
                preset.custom_args = textarea.value.trim();
                console.log(`Updated preset ${currentPresetId} in working list:`, preset.custom_args);
            }
        }
    }

    async loadPreset(presetId, modelPath, window) {
        try {
            const activeWindow = window || document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            // Initialize working presets if not exists
            if (!activeWindow.workingPresets) {
                const invoke = this.getInvoke();
                if (!invoke) throw new Error('Tauri API not available');
                activeWindow.workingPresets = await invoke('get_model_presets', { modelPath: modelPath });
            }

            // Find the preset in working list
            const preset = activeWindow.workingPresets.find(p => p.id === presetId);
            if (!preset) {
                return;
            }

            console.log(`Loading preset ${presetId} from working list:`, preset.custom_args);

            // Update the textarea with preset arguments
            const textarea = activeWindow.querySelector('[data-field="custom_args"]');
            if (textarea) {
                textarea.value = preset.custom_args;
                
                // Update visualizer
                await this.regenerateVisualizer(activeWindow, preset.custom_args);
            }

            // Update preset label
            const presetLabel = activeWindow.querySelector('#current-preset-label');
            if (presetLabel) {
                presetLabel.textContent = preset.name;
                presetLabel.dataset.presetId = presetId;
            }

            // Update the Arguments title to show preset name
            const argumentsTitle = activeWindow.querySelector('#arguments-title');
            if (argumentsTitle) {
                argumentsTitle.textContent = `Arguments (${preset.name})`;
            }
        } catch (error) {
            console.error('Error loading preset:', error);
        }
    }

    async createNewPreset() {
        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        if (!activeWindow) return;

        const propertyGroup = activeWindow.querySelector('.property-group[data-model-path]');
        if (!propertyGroup) return;

        const modelPath = atob(propertyGroup.dataset.modelPath);
        // New presets should start empty
        const customArgs = '';

        try {
            // Initialize working presets if not exists
            if (!activeWindow.workingPresets) {
                const invoke = this.getInvoke();
                if (!invoke) throw new Error('Tauri API not available');
                activeWindow.workingPresets = await invoke('get_model_presets', { modelPath: modelPath });
            }

            const preset = {
                id: 'preset_' + Date.now(),
                name: 'New Preset',
                custom_args: customArgs,
                is_default: false
            };

            // Add to working presets list
            activeWindow.workingPresets.push(preset);

            // Update presets list UI
            const presetsList = activeWindow.querySelector('#presets-list');
            if (presetsList) {
                presetsList.innerHTML = this.generatePresetsListHTML(activeWindow.workingPresets);
            }

            // Select the new preset manually
            const newPresetItem = activeWindow.querySelector(`[data-preset-id="${preset.id}"]`);
            if (newPresetItem) {
                // Update visual selection
                presetsList.querySelectorAll('.preset-item').forEach(item => {
                    item.classList.remove('selected');
                });
                newPresetItem.classList.add('selected');
                
                // Store selected preset ID
                activeWindow.dataset.selectedPresetId = preset.id;
                
                // Load the preset
                await this.loadPreset(preset.id, modelPath, activeWindow);

                // Start inline editing immediately
                const presetNameElement = newPresetItem.querySelector('.preset-name');
                if (presetNameElement) {
                    this.startInlineEdit(presetNameElement, preset.id, modelPath);
                }
            }

            // this.desktop.showNotification(`Preset "${name}" created (save to confirm)`, 'info');
        } catch (error) {
            console.error('Error creating preset:', error);
        }
    }

    async showPresetMenu(event, presetId) {
        event.stopPropagation();
        
        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        if (!activeWindow) return;

        const propertyGroup = activeWindow.querySelector('.property-group[data-model-path]');
        if (!propertyGroup) return;

        const modelPath = atob(propertyGroup.dataset.modelPath);

        // Initialize working presets if not exists
        if (!activeWindow.workingPresets) {
            const invoke = this.getInvoke();
            if (!invoke) return;
            activeWindow.workingPresets = await invoke('get_model_presets', { modelPath: modelPath });
        }

        // Find the current preset to check if it's already default
        const currentPreset = activeWindow.workingPresets.find(p => p.id === presetId);
        const isDefault = currentPreset && currentPreset.is_default;
        
        // Check if delete should be shown (more than one preset)
        const canDelete = activeWindow.workingPresets.length > 1;

        // Build menu items conditionally
        let menuItems = [];
        
        // Only show "Set as Default" if not already default
        if (!isDefault) {
            menuItems.push('<div class="context-menu-item" data-action="set-default">Set as Default</div>');
        }
        
        menuItems.push('<div class="context-menu-item" data-action="duplicate">Duplicate</div>');
        menuItems.push('<div class="context-menu-item" data-action="rename">Rename</div>');
        
        // Only show delete if there's more than one preset
        if (canDelete) {
            menuItems.push('<div class="context-menu-separator"></div>');
            menuItems.push('<div class="context-menu-item danger" data-action="delete">Delete</div>');
        }

        // Create context menu
        const menu = document.createElement('div');
        menu.className = 'preset-context-menu';
        menu.innerHTML = menuItems.join('');

        document.body.appendChild(menu);

        // Position menu
        const rect = event.target.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.left = rect.left + 'px';
        menu.style.top = (rect.bottom + 5) + 'px';

        // Handle menu actions
        menu.addEventListener('click', async (e) => {
            const action = e.target.dataset.action;
            if (!action) return;

            menu.remove();

            switch (action) {
                case 'set-default':
                    await this.setDefaultPreset(presetId, modelPath);
                    break;
                case 'duplicate':
                    await this.duplicatePreset(presetId, modelPath);
                    break;
                case 'rename':
                    await this.renamePreset(presetId, modelPath);
                    break;
                case 'delete':
                    await this.deletePreset(presetId, modelPath);
                    break;
            }
        });

        // Close menu on click outside
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 0);
    }

    async setDefaultPreset(presetId, modelPath) {
        try {
            const invoke = this.getInvoke();
            if (!invoke) throw new Error('Tauri API not available');

            await invoke('set_default_preset', { modelPath: modelPath, presetId: presetId });

            // Update working presets to match backend
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (activeWindow) {
                // Reload working presets from backend to ensure sync
                activeWindow.workingPresets = await invoke('get_model_presets', { modelPath: modelPath });
                
                // Update UI with working presets
                const presetsList = activeWindow.querySelector('#presets-list');
                if (presetsList) {
                    presetsList.innerHTML = this.generatePresetsListHTML(activeWindow.workingPresets);
                }
            }
        } catch (error) {
            console.error('Error setting default preset:', error);
        }
    }

    async duplicatePreset(presetId, modelPath) {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            // Initialize working presets if not exists
            if (!activeWindow.workingPresets) {
                const invoke = this.getInvoke();
                if (!invoke) throw new Error('Tauri API not available');
                activeWindow.workingPresets = await invoke('get_model_presets', { modelPath: modelPath });
            }

            // Find the original preset
            const original = activeWindow.workingPresets.find(p => p.id === presetId);
            if (!original) return;

            const newPreset = {
                id: 'preset_' + Date.now(),
                name: original.name + ' (Copy)',
                custom_args: original.custom_args,
                is_default: false
            };

            // Add to working presets list
            activeWindow.workingPresets.push(newPreset);

            // Update presets list UI
            const presetsList = activeWindow.querySelector('#presets-list');
            if (presetsList) {
                presetsList.innerHTML = this.generatePresetsListHTML(activeWindow.workingPresets);
            }

            // this.desktop.showNotification('Preset duplicated (save to confirm)', 'info');
        } catch (error) {
            console.error('Error duplicating preset:', error);
        }
    }

    async renamePreset(presetId, modelPath) {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            // Find the preset item and start inline editing
            const presetItem = activeWindow.querySelector(`[data-preset-id="${presetId}"]`);
            if (!presetItem) return;

            const presetNameElement = presetItem.querySelector('.preset-name');
            if (presetNameElement) {
                this.startInlineEdit(presetNameElement, presetId, modelPath);
            }
        } catch (error) {
            console.error('Error starting rename:', error);
        }
    }

    startInlineEdit(presetNameElement, presetId, modelPath) {
        // Store original name for cancellation
        const originalName = presetNameElement.dataset.originalName || presetNameElement.textContent;
        
        // Make element editable
        presetNameElement.contentEditable = true;
        presetNameElement.classList.add('editing');
        
        // Select all text
        presetNameElement.focus();
        const range = document.createRange();
        range.selectNodeContents(presetNameElement);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        // Handle completion of editing
        const finishEdit = async (save = true) => {
            presetNameElement.contentEditable = false;
            presetNameElement.classList.remove('editing');
            
            if (save) {
                const newName = presetNameElement.textContent.trim();
                if (newName && newName !== originalName) {
                    await this.updatePresetName(presetId, newName, modelPath);
                } else if (!newName) {
                    // Restore original name if empty
                    presetNameElement.textContent = originalName;
                }
            } else {
                // Cancel - restore original name
                presetNameElement.textContent = originalName;
            }
        };

        // Event listeners for finishing edit
        const keydownHandler = async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                await finishEdit(true);
                cleanup();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                await finishEdit(false);
                cleanup();
            }
        };

        const blurHandler = async () => {
            await finishEdit(true);
            cleanup();
        };

        const cleanup = () => {
            presetNameElement.removeEventListener('keydown', keydownHandler);
            presetNameElement.removeEventListener('blur', blurHandler);
        };

        presetNameElement.addEventListener('keydown', keydownHandler);
        presetNameElement.addEventListener('blur', blurHandler);
    }

    async updatePresetName(presetId, newName, modelPath) {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            // Initialize working presets if not exists
            if (!activeWindow.workingPresets) {
                const invoke = this.getInvoke();
                if (!invoke) throw new Error('Tauri API not available');
                activeWindow.workingPresets = await invoke('get_model_presets', { modelPath: modelPath });
            }

            // Update the preset name in working list
            const preset = activeWindow.workingPresets.find(p => p.id === presetId);
            if (preset) {
                preset.name = newName;
                
                // Update the data attribute for future reference
                const presetNameElement = activeWindow.querySelector(`[data-preset-id="${presetId}"] .preset-name`);
                if (presetNameElement) {
                    presetNameElement.dataset.originalName = newName;
                }

                // Update the Arguments title if this is the currently selected preset
                if (activeWindow.dataset.selectedPresetId === presetId) {
                    const argumentsTitle = activeWindow.querySelector('#arguments-title');
                    if (argumentsTitle) {
                        argumentsTitle.textContent = `Arguments (${newName})`;
                    }
                }
            }
        } catch (error) {
            console.error('Error updating preset name:', error);
        }
    }

    async deletePreset(presetId, modelPath) {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            // Initialize working presets if not exists
            if (!activeWindow.workingPresets) {
                const invoke = this.getInvoke();
                if (!invoke) throw new Error('Tauri API not available');
                activeWindow.workingPresets = await invoke('get_model_presets', { modelPath: modelPath });
            }

            // Check if this is the last preset - don't allow deletion
            if (activeWindow.workingPresets.length <= 1) {
                return;
            }

            // Show confirmation dialog using reusable modal
            const confirmed = await ModalDialog.showConfirmation({
                title: 'Delete Preset',
                message: 'Are you sure you want to delete this preset?\n\nThis action cannot be undone.',
                confirmText: 'Delete',
                cancelText: 'Cancel',
                type: 'danger'
            });

            if (!confirmed) return;

            // Check if we're deleting the default preset
            const deletingPreset = activeWindow.workingPresets.find(p => p.id === presetId);
            const wasDefault = deletingPreset && deletingPreset.is_default;

            // Remove from working presets list
            const presetIndex = activeWindow.workingPresets.findIndex(p => p.id === presetId);
            if (presetIndex !== -1) {
                activeWindow.workingPresets.splice(presetIndex, 1);
            }

            // If we deleted the default preset, assign default to another preset
            if (wasDefault && activeWindow.workingPresets.length > 0) {
                // Clear any existing default flags (safety measure)
                activeWindow.workingPresets.forEach(p => p.is_default = false);
                
                // Try to use the next preset, or the previous one if we deleted the last preset
                let newDefaultIndex = presetIndex;
                if (newDefaultIndex >= activeWindow.workingPresets.length) {
                    newDefaultIndex = activeWindow.workingPresets.length - 1;
                }
                
                // Set the new default
                activeWindow.workingPresets[newDefaultIndex].is_default = true;
                console.log(`Assigned default to preset: ${activeWindow.workingPresets[newDefaultIndex].name}`);
            }

            // Update presets list UI
            const presetsList = activeWindow.querySelector('#presets-list');
            if (presetsList) {
                presetsList.innerHTML = this.generatePresetsListHTML(activeWindow.workingPresets);
            }

            // If we deleted the currently selected preset, select another one
            const currentPresetId = activeWindow.dataset.selectedPresetId;
            if (currentPresetId === presetId && activeWindow.workingPresets.length > 0) {
                let newPresetToSelect;
                
                // If we deleted the default, select the new default preset
                if (wasDefault) {
                    newPresetToSelect = activeWindow.workingPresets.find(p => p.is_default);
                    if (!newPresetToSelect) {
                        newPresetToSelect = activeWindow.workingPresets[0];
                    }
                } else {
                    newPresetToSelect = activeWindow.workingPresets[0];
                }
                
                // Update visual selection
                const presetsList = activeWindow.querySelector('#presets-list');
                if (presetsList) {
                    presetsList.querySelectorAll('.preset-item').forEach(item => {
                        item.classList.remove('selected');
                    });
                    const newPresetItem = presetsList.querySelector(`[data-preset-id="${newPresetToSelect.id}"]`);
                    if (newPresetItem) {
                        newPresetItem.classList.add('selected');
                    }
                }
                
                // Store selected preset ID
                activeWindow.dataset.selectedPresetId = newPresetToSelect.id;
                
                // Load the preset
                await this.loadPreset(newPresetToSelect.id, modelPath, activeWindow);
            }

            // this.desktop.showNotification('Preset deleted (save to confirm)', 'info');
        } catch (error) {
            console.error('Error deleting preset:', error);
        }
    }

    setupPropertiesSync(window) {
        const customArgsTextarea = window.querySelector('[data-field="custom_args"]');

        // Listen for manual edits in textarea
        customArgsTextarea.addEventListener('input', async () => {
            await this.regenerateVisualizer(window, customArgsTextarea.value);
        });

        // Setup initial drag and drop
        const visualizer = window.querySelector('#arguments-visualizer');
        if (visualizer) {
            this.initDragAndDrop(visualizer);
        }
    }

    initDragAndDrop(container) {
        let draggedElement = null;
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let draggedClone = null;
        let placeholder = null;

        // Add mouse event listeners to all draggable chips
        const chips = container.querySelectorAll('.arg-chip:not(.add-arg-btn)');
        
        chips.forEach(chip => {
            chip.style.cursor = 'grab';
            
            chip.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return; // Only left mouse button
                
                // Don't start drag if clicking on popover elements or select elements
                if (e.target.closest('.setting-popover') || e.target.tagName === 'SELECT') return;
                
                draggedElement = chip;
                startX = e.clientX;
                startY = e.clientY;
                
                // Prevent text selection and default drag
                e.preventDefault();
                
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
            });
        });

        const handleMouseMove = (e) => {
            if (!draggedElement) return;
            
            // Only start dragging if mouse moved enough (prevents accidental drags)
            const deltaX = Math.abs(e.clientX - startX);
            const deltaY = Math.abs(e.clientY - startY);
            
            if (!isDragging && (deltaX > 5 || deltaY > 5)) {
                isDragging = true;
                
                // Create a clone that follows the cursor
                draggedClone = draggedElement.cloneNode(true);
                draggedClone.style.position = 'fixed';
                draggedClone.style.pointerEvents = 'none';
                draggedClone.style.zIndex = '9999';
                draggedClone.style.opacity = '0.9';
                draggedClone.style.transform = 'scale(1.05)';
                draggedClone.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.3)';
                draggedClone.classList.add('dragging-clone');
                document.body.appendChild(draggedClone);
                
                // Create placeholder
                placeholder = document.createElement('div');
                placeholder.className = 'drag-placeholder';
                placeholder.style.width = draggedElement.offsetWidth + 'px';
                placeholder.style.height = draggedElement.offsetHeight + 'px';
                placeholder.style.display = 'inline-block';
                placeholder.style.margin = '2px';
                placeholder.style.border = '2px dashed var(--theme-primary)';
                placeholder.style.borderRadius = '4px';
                placeholder.style.opacity = '0.5';
                placeholder.style.backgroundColor = 'rgba(30, 136, 229, 0.1)';
                
                // Replace original with placeholder
                draggedElement.parentNode.insertBefore(placeholder, draggedElement);
                draggedElement.style.display = 'none';
            }
            
            if (!isDragging) return;
            
            // Update clone position to follow cursor
            if (draggedClone) {
                draggedClone.style.left = (e.clientX - draggedElement.offsetWidth / 2) + 'px';
                draggedClone.style.top = (e.clientY - draggedElement.offsetHeight / 2) + 'px';
            }
            
            // Find the element we're hovering over (excluding the clone and placeholder)
            const elementBelow = document.elementFromPoint(e.clientX, e.clientY);
            const visualizer = container;
            
            // Get all chips except the dragged one, placeholder, and add button
            const allChips = Array.from(visualizer.querySelectorAll('.arg-chip:not(.add-arg-btn)'))
                .filter(chip => chip !== draggedElement && !chip.classList.contains('drag-placeholder'));
            
            let insertPosition = null;
            let insertBefore = null;
            
            // Check if we're over a specific chip
            const targetChip = elementBelow?.closest('.arg-chip:not(.add-arg-btn):not(.dragging-clone)');
            
            if (targetChip && targetChip !== draggedElement && !targetChip.classList.contains('drag-placeholder')) {
                const rect = targetChip.getBoundingClientRect();
                const midpoint = rect.left + rect.width / 2;
                
                if (e.clientX < midpoint) {
                    // Insert before this chip
                    insertBefore = targetChip;
                } else {
                    // Insert after this chip
                    insertBefore = targetChip.nextElementSibling;
                }
            } else if (elementBelow?.closest('#arguments-visualizer')) {
                // If we're in the visualizer but not over a chip, determine position based on mouse location
                const visualizerRect = visualizer.getBoundingClientRect();
                
                if (allChips.length === 0) {
                    // No other chips, place before add button
                    insertBefore = visualizer.querySelector('.add-arg-btn');
                } else {
                    // Find the best position based on mouse X coordinate
                    let bestPosition = null;
                    let minDistance = Infinity;
                    
                    // Check position before first chip
                    const firstChip = allChips[0];
                    if (firstChip) {
                        const firstRect = firstChip.getBoundingClientRect();
                        const distanceToFirst = Math.abs(e.clientX - firstRect.left);
                        if (distanceToFirst < minDistance) {
                            minDistance = distanceToFirst;
                            bestPosition = firstChip;
                        }
                    }
                    
                    // Check positions between chips and after last chip
                    for (let i = 0; i < allChips.length; i++) {
                        const chip = allChips[i];
                        const rect = chip.getBoundingClientRect();
                        
                        // Check position after this chip
                        const nextChip = allChips[i + 1];
                        const nextRect = nextChip ? nextChip.getBoundingClientRect() : null;
                        
                        let targetX;
                        if (nextRect) {
                            // Position between this chip and next chip
                            targetX = (rect.right + nextRect.left) / 2;
                        } else {
                            // Position after last chip
                            targetX = rect.right + 20; // Add some padding
                        }
                        
                        const distance = Math.abs(e.clientX - targetX);
                        if (distance < minDistance) {
                            minDistance = distance;
                            bestPosition = nextChip; // Insert before next chip (or null for end)
                        }
                    }
                    
                    insertBefore = bestPosition;
                }
            }
            
            // Only move placeholder if position changed
            if (insertBefore !== placeholder.nextElementSibling) {
                if (insertBefore) {
                    visualizer.insertBefore(placeholder, insertBefore);
                } else {
                    // Insert at the end, before add button
                    const addBtn = visualizer.querySelector('.add-arg-btn');
                    if (addBtn) {
                        visualizer.insertBefore(placeholder, addBtn);
                    } else {
                        visualizer.appendChild(placeholder);
                    }
                }
            }
        };

        const handleMouseUp = (e) => {
            if (!draggedElement) return;
            
            if (isDragging) {
                // Ensure placeholder exists and is in the DOM
                if (placeholder && placeholder.parentNode) {
                    // Get the exact position where placeholder is
                    const placeholderParent = placeholder.parentNode;
                    const placeholderNextSibling = placeholder.nextElementSibling;
                    
                    // Remove placeholder first
                    placeholderParent.removeChild(placeholder);
                    
                    // Insert dragged element at the exact same position
                    if (placeholderNextSibling) {
                        placeholderParent.insertBefore(draggedElement, placeholderNextSibling);
                    } else {
                        placeholderParent.appendChild(draggedElement);
                    }
                }
                
                // Show original element
                draggedElement.style.display = '';
                
                // Remove clone
                if (draggedClone && draggedClone.parentNode) {
                    draggedClone.parentNode.removeChild(draggedClone);
                }
                
                // Final update of arguments order
                this.updateArgumentsFromChipOrder();
                
                // Reset any transforms
                setTimeout(() => {
                    if (draggedElement) {
                        draggedElement.style.transform = '';
                        draggedElement.style.transition = 'all 0.15s ease';
                    }
                }, 50);
            } else {
                // If not dragging, just show the element
                draggedElement.style.display = '';
            }
            
            // Clean up
            draggedElement = null;
            isDragging = false;
            draggedClone = null;
            placeholder = null;
            
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }

    switchView(view) {
        const visualBtn = document.getElementById('btn-visual');
        const rawBtn = document.getElementById('btn-raw');
        const visualContent = document.getElementById('view-visual');
        const rawContent = document.getElementById('view-raw');

        if (!visualBtn || !rawBtn || !visualContent || !rawContent) return;

        if (view === 'visual') {
            visualBtn.classList.add('active');
            rawBtn.classList.remove('active');
            visualContent.classList.remove('hidden');
            rawContent.classList.add('hidden');
        } else {
            visualBtn.classList.remove('active');
            rawBtn.classList.add('active');
            visualContent.classList.add('hidden');
            rawContent.classList.remove('hidden');
        }
    }

    async addSettingToArguments(settingId, customArgsTextarea) {
        try {
            // Load settings configuration
            const settingsConfig = await this.desktop.loadSettingsConfig();
            const setting = settingsConfig.find(s => s.id === settingId);

            if (!setting) {
                console.error('Setting not found:', settingId);
                return;
            }

            // Parse current arguments to get settings object
            const currentArgs = customArgsTextarea.value || '';
            const parsedSettings = await this.desktop.parseArgumentsToSettings(currentArgs);

            // Enable the setting with default value if not already present
            parsedSettings[settingId + '_enabled'] = true;
            if (parsedSettings[settingId] === undefined || parsedSettings[settingId] === null) {
                if (setting.isFlag || setting.type === 'toggle') {
                    parsedSettings[settingId] = true;
                } else if (setting.type === 'model-select') {
                    parsedSettings[settingId] = ''; // Keep it empty, but we'll fix settingsToArguments to allow it
                } else {
                    parsedSettings[settingId] = setting.default !== undefined ? setting.default : '';
                }
            }

            // Update the custom args textarea
            const newArgs = await this.desktop.settingsToArguments(parsedSettings, currentArgs);
            customArgsTextarea.value = newArgs;

            // Update visualizer
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (activeWindow) {
                await this.regenerateVisualizer(activeWindow, newArgs);
            }

            console.log('Added setting:', settingId);

        } catch (error) {
            console.error('Error adding setting to arguments:', error);
        }
    }

    async saveProperties() {
        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        if (!activeWindow) {
            return;
        }

        const propertyGroup = activeWindow.querySelector('.property-group[data-model-path]');
        if (!propertyGroup) {
            return;
        }

        const modelPath = atob(propertyGroup.dataset.modelPath);
        
        // Save current preset changes to working list
        await this.saveCurrentPresetToTemp(activeWindow, modelPath);

        console.log('Saving all preset changes for', modelPath);

        try {
            const invoke = this.getInvoke();
            if (!invoke) {
                throw new Error('Tauri API not available');
            }

            // Initialize working presets if not exists
            if (!activeWindow.workingPresets) {
                activeWindow.workingPresets = await invoke('get_model_presets', { modelPath: modelPath });
            }

            console.log('Final presets to save:', activeWindow.workingPresets);

            // Save all presets in one call
            await invoke('update_model_presets', { 
                modelPath: modelPath, 
                presets: activeWindow.workingPresets 
            });

            console.log(`Saved ${activeWindow.workingPresets.length} presets total`);
            
            // Update custom arguments indicators
            await this.desktop.updateCustomArgsIndicators();

            this.closePropertiesWindow();
        } catch (error) {
            console.error('Error saving settings:', error);
        }
    }

    closePropertiesWindow() {
        // Also close any open popover
        this.closePopover();

        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        if (activeWindow) {
            // Clear working presets when closing without saving (Cancel button)
            if (activeWindow.workingPresets) {
                activeWindow.workingPresets = null;
            }
            
            this.desktop.closeWindow(activeWindow.id);
        }
    }

    async removeSetting(settingId) {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) {
                console.error('No active properties window found');
                return;
            }

            const customArgsTextarea = activeWindow.querySelector('[data-field="custom_args"]');
            if (!customArgsTextarea) {
                console.error('Custom args textarea not found');
                return;
            }

            // Parse current arguments and disable the setting
            const currentArgs = customArgsTextarea.value || '';
            const parsedSettings = await this.desktop.parseArgumentsToSettings(currentArgs);

            // Disable the setting
            parsedSettings[settingId + '_enabled'] = false;
            delete parsedSettings[settingId];

            // Update the custom args textarea
            const newArgs = await this.desktop.settingsToArguments(parsedSettings, currentArgs);
            customArgsTextarea.value = newArgs;

            // Load settings configuration and regenerate visualizer
            await this.regenerateVisualizer(activeWindow, newArgs);

            console.log('Removed setting:', settingId);

        } catch (error) {
            console.error('Error removing setting:', error);
        }
    }

    // DEPRECATED: Use toggleSetting instead
    async addSettingById(settingId) {
        return this.toggleSetting(settingId);
    }

    async deleteModelFile(encodedModelPath) {
        // Decode the base64-encoded model path
        const modelPath = atob(encodedModelPath);
        const filename = modelPath.split(/[\\/]/).pop(); // Get filename from path

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
            // Use Tauri command instead of fetch
            const invoke = this.getInvoke();
            if (!invoke) {
                throw new Error('Tauri API not available');
            }

            const result = await invoke('delete_model_file', {
                modelPath: modelPath
            });

            // Check if the deletion was successful
            if (!result.success) {
                throw new Error(result.error || 'Unknown error occurred');
            }

            // The file-deleted event will handle updating the desktop icons without animations

            // Close the properties window
            this.closePropertiesWindow();

        } catch (error) {
            console.error('Error deleting model file:', error);
        }
    }

    async openModelFolder(encodedModelPath) {
        try {
            // Decode the base64-encoded model path
            const modelPath = atob(encodedModelPath);
            
            // Use Tauri command to open the folder
            const invoke = this.getInvoke();
            if (!invoke) {
                throw new Error('Tauri API not available');
            }

            await invoke('open_model_folder', {
                modelPath: modelPath
            });

            console.log('Opened folder for model:', modelPath);

        } catch (error) {
            console.error('Error opening model folder:', error);
        }
    }

    async generateArgumentsVisualizer(argsString, settingsConfig) {
        let html = '';
        const args = (!argsString || !argsString.trim()) ? [] : this.desktop.parseArguments(argsString);

        // If no arguments, show empty state message
        if (args.length === 0) {
            return `
                <div class="arguments-empty-state">
                    <p>It feels empty here, add some settings</p>
                </div>
            `;
        }

        // Create lookup map for settings - ensure all argument forms are mapped
        const argToSetting = {};
        settingsConfig.forEach(s => {
            // Map the main argument
            argToSetting[s.argument] = s;
            
            // Map all aliases
            if (s.aliases && Array.isArray(s.aliases)) {
                s.aliases.forEach(alias => {
                    argToSetting[alias] = s;
                });
            }
        });

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            let setting = argToSetting[arg];
            let value = null;

            // Handle key=value
            if (!setting && arg.includes('=')) {
                const parts = arg.split('=');
                const key = parts[0];
                const val = parts.slice(1).join('=');
                setting = argToSetting[key];
                if (setting) {
                    value = val;
                }
            } else if (setting) {
                // Check if flag
                if (setting.isFlag || setting.type === 'toggle') {
                    value = 'On';
                } else {
                    // Next arg is value
                    if (i + 1 < args.length && (!args[i + 1].startsWith('-') || /^-\d+(\.\d+)?$/.test(args[i + 1]))) {
                        value = args[i + 1];
                        i++;
                    }
                }
            }

            if (setting) {
                // Known setting - create raw argument string for tooltip
                let rawArgument = arg;
                if (value && !setting.isFlag && setting.type !== 'toggle') {
                    // For arguments with values, reconstruct the full argument
                    if (arg.includes('=')) {
                        // Already in key=value format
                        rawArgument = arg;
                    } else {
                        // In --flag value format, reconstruct as --argument value (with space)
                        rawArgument = `${arg} ${value}`;
                    }
                } else if (setting.isFlag || setting.type === 'toggle') {
                    // For flags, just use the argument as-is
                    rawArgument = arg;
                }

                html += `
                    <div class="arg-chip" 
                         title="${rawArgument}" 
                         data-setting-id="${setting.id}" 
                         data-value="${value !== null && value !== undefined ? value : ''}" 
                         data-raw-arg="${rawArgument}"
                         draggable="true"
                         onclick="propertiesManager.openSettingPopover(this, '${setting.id}')">
                        <span class="arg-label">${setting.name}</span>
                        <span class="arg-value">${value !== null && value !== undefined ? value : ''}</span>
                    </div>
                `;
            } else {
                // Unknown argument - show raw argument as tooltip
                let displayArg = arg;
                // If the unknown arg starts with - or -- and the next item doesn't, it's likely a value
                if (arg.startsWith('-') && i + 1 < args.length && (!args[i + 1].startsWith('-') || /^-\d+(\.\d+)?$/.test(args[i + 1]))) {
                    displayArg = `${arg} ${args[i + 1]}`;
                    i++;
                }

                html += `
                    <div class="arg-chip unknown" 
                         title="${displayArg}" 
                         data-unknown-arg="${arg}"
                         data-raw-arg="${displayArg}"
                         draggable="true"
                         onclick="propertiesManager.openUnknownArgPopover(this, '${encodeURIComponent(displayArg)}')">
                        <span class="arg-value">${displayArg}</span>
                    </div>
                `;
            }
        }

        return html;
    }

    scrollToSettingsList() {
        const settingsList = document.querySelector('.settings-sidebar');
        if (settingsList) {
            settingsList.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            
            // Focus the search input
            const searchInput = settingsList.querySelector('.settings-search-input');
            if (searchInput) {
                setTimeout(() => {
                    searchInput.focus();
                }, 300);
            }
        }
    }

    toggleSettingsCategory(categoryElement) {
        const wasCollapsed = categoryElement.classList.contains('collapsed');
        
        // Collapse all other categories (accordion behavior)
        const allCategories = categoryElement.parentElement.querySelectorAll('.settings-category');
        allCategories.forEach(cat => {
            if (cat !== categoryElement) {
                cat.classList.add('collapsed');
            }
        });
        
        // Toggle the clicked category
        if (wasCollapsed) {
            categoryElement.classList.remove('collapsed');
        } else {
            categoryElement.classList.add('collapsed');
        }
    }

    filterSettingsList(query) {
        const settingsList = document.getElementById('settings-list');
        if (!settingsList) return;

        const q = query.toLowerCase();
        const categories = settingsList.querySelectorAll('.settings-category');

        // Show/hide clear button based on query
        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        const clearButton = activeWindow?.querySelector('.settings-search-clear');
        if (clearButton) {
            clearButton.style.display = q.length > 0 ? 'flex' : 'none';
        }

        categories.forEach(cat => {
            const items = cat.querySelectorAll('.settings-item');
            let hasVisibleItems = false;

            items.forEach(item => {
                const text = item.dataset.searchText;
                if (text && text.includes(q)) {
                    item.style.display = 'block';
                    hasVisibleItems = true;
                } else {
                    item.style.display = 'none';
                }
            });

            if (hasVisibleItems) {
                cat.style.display = 'block';
                // Expand if searching, otherwise keep collapsed
                if (q.length > 0) {
                    cat.classList.remove('collapsed');
                } else {
                    cat.classList.add('collapsed');
                }
            } else {
                cat.style.display = 'none';
            }
        });
    }

    async refreshSettingsList() {
        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        if (!activeWindow) return;

        const settingsList = activeWindow.querySelector('#settings-list');
        if (!settingsList) return;

        // Store the current expanded/collapsed state of categories
        const expandedCategories = new Set();
        const existingCategories = settingsList.querySelectorAll('.settings-category');
        existingCategories.forEach(cat => {
            if (!cat.classList.contains('collapsed')) {
                const categoryName = cat.dataset.category || 
                    cat.querySelector('.settings-category-header')?.textContent?.trim()?.split('(')[0]?.trim();
                if (categoryName) {
                    expandedCategories.add(categoryName);
                }
            }
        });

        // Store the current search query
        const searchInput = activeWindow.querySelector('.settings-search-input');
        const currentSearchQuery = searchInput ? searchInput.value : '';

        const textarea = activeWindow.querySelector('[data-field="custom_args"]');
        const settingsConfig = await this.desktop.loadSettingsConfig();
        const settingsListHTML = await this.generateSettingsListHTML(textarea.value, settingsConfig);
        
        settingsList.innerHTML = settingsListHTML;

        // Restore the expanded state of categories
        const newCategories = settingsList.querySelectorAll('.settings-category');
        newCategories.forEach(cat => {
            const categoryName = cat.dataset.category || 
                cat.querySelector('.settings-category-header')?.textContent?.trim()?.split('(')[0]?.trim();
            if (categoryName && expandedCategories.has(categoryName)) {
                cat.classList.remove('collapsed');
            }
        });

        // Restore the search query and apply filtering
        const newSearchInput = activeWindow.querySelector('.settings-search-input');
        if (newSearchInput && currentSearchQuery) {
            newSearchInput.value = currentSearchQuery;
            this.filterSettingsList(currentSearchQuery);
        }
    }

    clearSettingsSearch() {
        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        if (!activeWindow) return;

        const searchInput = activeWindow.querySelector('.settings-search-input');
        if (searchInput) {
            searchInput.value = '';
            this.filterSettingsList('');
            searchInput.focus();
        }
    }

    async addCustomArgument() {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            const customArgsTextarea = activeWindow.querySelector('[data-field="custom_args"]');
            if (!customArgsTextarea) return;

            // Add a placeholder custom argument
            const currentArgs = customArgsTextarea.value || '';
            const newArgs = currentArgs ? `${currentArgs} --custom-arg value` : '--custom-arg value';
            customArgsTextarea.value = newArgs;

            // Update visualizer
            await this.regenerateVisualizer(activeWindow, newArgs);

            // Find the newly added custom argument chip and open its popover
            setTimeout(() => {
                const customChips = activeWindow.querySelectorAll('.arg-chip.unknown');
                if (customChips.length > 0) {
                    const lastChip = customChips[customChips.length - 1];
                    const rawArg = lastChip.dataset.rawArg;
                    if (rawArg) {
                        this.openUnknownArgPopover(lastChip, encodeURIComponent(rawArg));
                    }
                }
            }, 100);

        } catch (error) {
            console.error('Error adding custom argument:', error);
        }
    }

    async toggleSetting(settingId) {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            const customArgsTextarea = activeWindow.querySelector('[data-field="custom_args"]');
            if (!customArgsTextarea) return;

            // Parse current arguments to check if setting is enabled
            const currentArgs = customArgsTextarea.value || '';
            const parsedSettings = await this.desktop.parseArgumentsToSettings(currentArgs);
            const isCurrentlyEnabled = parsedSettings[settingId + '_enabled'] || false;

            if (isCurrentlyEnabled) {
                // Remove the setting
                await this.removeSetting(settingId);
            } else {
                // Add the setting
                await this.addSettingToArguments(settingId, customArgsTextarea);

                // Refresh the settings list to update the "in use" status
                await this.refreshSettingsList();

                // Automatically show the popover for the newly added setting
                setTimeout(() => {
                    const newChip = activeWindow.querySelector(`[data-setting-id="${settingId}"]`);
                    if (newChip) {
                        this.openSettingPopover(newChip, settingId);
                    }
                }, 100);
            }

        } catch (error) {
            console.error('Error toggling setting:', error);
        }
    }

    

    toggleCategory(categoryElement) {
        categoryElement.classList.toggle('collapsed');
    }

    filterAddMenu(query) {
        const popover = document.getElementById('setting-popover');
        if (!popover) return;

        const q = query.toLowerCase();
        const categories = popover.querySelectorAll('.menu-category');
        let firstVisibleItem = null;

        // Clear previous selection
        popover.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('auto-selected');
        });

        categories.forEach(cat => {
            const items = cat.querySelectorAll('.menu-item');
            let hasVisibleItems = false;

            items.forEach(item => {
                const text = item.dataset.searchText;
                if (text && text.includes(q)) {
                    item.style.display = 'block';
                    hasVisibleItems = true;
                    
                    // Track the first visible, non-disabled item
                    if (!firstVisibleItem && !item.classList.contains('disabled')) {
                        firstVisibleItem = item;
                    }
                } else {
                    item.style.display = 'none';
                }
            });

            if (hasVisibleItems) {
                cat.style.display = 'block';
                // Expand if searching, otherwise respect collapsed state
                if (q.length > 0) {
                    cat.classList.remove('collapsed');
                } else {
                    cat.classList.add('collapsed');
                }
            } else {
                cat.style.display = 'none';
            }
        });

        // Auto-select the first visible item
        if (firstVisibleItem) {
            firstVisibleItem.classList.add('auto-selected');
            // Store reference for Enter key handling
            popover.dataset.selectedItem = firstVisibleItem.getAttribute('onclick') || '';
        } else {
            popover.dataset.selectedItem = '';
        }

        // Update the visible items list for keyboard navigation
        this.updateVisibleMenuItems(popover);
    }

    updateVisibleMenuItems(popover) {
        // Get all visible, non-disabled menu items for keyboard navigation
        const visibleItems = Array.from(popover.querySelectorAll('.menu-item'))
            .filter(item => item.style.display !== 'none' && !item.classList.contains('disabled'));
        
        // Store for keyboard navigation
        popover.visibleMenuItems = visibleItems;
        
        // Find current selected index
        const selectedItem = popover.querySelector('.menu-item.auto-selected');
        popover.selectedIndex = selectedItem ? visibleItems.indexOf(selectedItem) : -1;
    }

    navigateMenuItem(popover, direction) {
        if (!popover.visibleMenuItems || popover.visibleMenuItems.length === 0) return;

        // Clear current selection
        popover.querySelectorAll('.menu-item').forEach(item => {
            item.classList.remove('auto-selected');
        });

        // Calculate new index
        let newIndex = popover.selectedIndex + direction;
        
        // Wrap around
        if (newIndex < 0) {
            newIndex = popover.visibleMenuItems.length - 1;
        } else if (newIndex >= popover.visibleMenuItems.length) {
            newIndex = 0;
        }

        // Update selection
        popover.selectedIndex = newIndex;
        const selectedItem = popover.visibleMenuItems[newIndex];
        
        if (selectedItem) {
            selectedItem.classList.add('auto-selected');
            popover.dataset.selectedItem = selectedItem.getAttribute('onclick') || '';
            
            // Scroll item into view if needed
            selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    handleSearchKeydown(event) {
        // Prevent default behavior for arrow keys to avoid cursor movement in input
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
        }
    }

    async openSettingPopover(chipElement, settingId) {
        // Close existing popover
        this.closePopover();

        const settingsConfig = await this.desktop.loadSettingsConfig();
        const setting = settingsConfig.find(s => s.id === settingId);
        if (!setting) return;

        // Get current value from chip or parsed args
        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        const textarea = activeWindow.querySelector('[data-field="custom_args"]');
        const parsedSettings = await this.desktop.parseArgumentsToSettings(textarea.value);

        // Create popover element
        const popover = document.createElement('div');
        popover.className = 'setting-popover';
        popover.id = 'setting-popover';

        // Generate content (slider/input)
        let controlsHTML = '';
        const currentValue = parsedSettings[setting.id] || setting.default || '';

        if (setting.type === 'slider') {
            controlsHTML = `
                <div class="popover-content">
                    <span class="value-display" contenteditable="true" data-setting-id="${setting.id}">${currentValue}</span>
                    <input type="range" class="setting-slider" data-setting="${setting.id}"
                           min="${setting.min || 0}" max="${setting.max || 100}" step="${setting.step || 1}" value="${currentValue}">
                    <div class="slider-labels">
                        <span>${setting.min || 0}</span>
                        <span>${(setting.max || 100) > 1000 ? Math.round((setting.max || 100) / 1000) + 'K' : (setting.max || 100)}</span>
                    </div>
                </div>
            `;
        } else if (setting.type === 'select') {
            controlsHTML = `
                <div class="popover-content">
                    <select class="property-select" data-setting="${setting.id}" style="width: 100%; padding: 8px;">
                        ${setting.options.map(opt =>
                `<option value="${opt.value}" ${currentValue == opt.value ? 'selected' : ''}>${opt.label}</option>`
            ).join('')}
                    </select>
                </div>
            `;
        } else if (setting.type === 'number') {
            controlsHTML = `
                <div class="popover-content">
                    <input type="number" class="property-input" data-setting="${setting.id}"
                           value="${currentValue}" placeholder="${setting.placeholder || ''}"
                           style="font-size: 16px; padding: 8px;">
                </div>
            `;
        } else if (setting.type === 'text') {
            controlsHTML = `
                <div class="popover-content">
                    <input type="text" class="property-input" data-setting="${setting.id}"
                           value="${currentValue}" placeholder="${setting.placeholder || ''}"
                           style="font-size: 16px; padding: 8px; width: 100%;">
                </div>
            `;
        } else if (setting.type === 'toggle') {
            controlsHTML = `
                <div class="popover-content">
                    <p>This flag is enabled.</p>
                </div>
            `;
        } else if (setting.type === 'model-select') {
            controlsHTML = `
                <div class="popover-content">
                    <div class="loading-spinner" style="text-align: center; padding: 10px;">
                        <span class="material-icons rotating">sync</span> Loading models...
                    </div>
                </div>
            `;

            // Fetch models asynchronously
            const invoke = this.getInvoke();
            if (invoke) {
                invoke('scan_mmproj_files_command').then(result => {
                    if (result && result.success && result.files) {
                        const files = result.files;
                        const selectHTML = `
                            <select class="property-select" data-setting="${setting.id}" style="width: 100%; padding: 8px;">
                                <option value="">None Selected</option>
                                ${files.map(file => {
                            const filename = file.split(/[\\/]/).pop();
                            return `<option value="${file}" ${currentValue === file ? 'selected' : ''} title="${file}">${filename}</option>`;
                        }).join('')}
                            </select>
                        `;
                        const popoverContent = popover.querySelector('.popover-content');
                        if (popoverContent) {
                            popoverContent.innerHTML = selectHTML;
                            // Add event listener to the new select
                            const select = popoverContent.querySelector('select');
                            
                            // Disable close handler when this select is focused
                            select.addEventListener('focus', () => {
                                closeHandlerActive = false;
                            });
                            
                            select.addEventListener('blur', () => {
                                setTimeout(() => {
                                    closeHandlerActive = true;
                                }, 200);
                            });
                            
                            select.addEventListener('change', async (e) => {
                                await this.updateSettingValue(setting.id, e.target.value);
                                // Close popover after selecting from dropdown
                                this.closePopover();
                            });
                        }
                    } else {
                        const popoverContent = popover.querySelector('.popover-content');
                        if (popoverContent) {
                            popoverContent.innerHTML = '<p style="color: var(--theme-danger); font-size: 12px;">No mmproj files found.</p>';
                        }
                    }
                }).catch(err => {
                    console.error('Error fetching mmproj files:', err);
                    const popoverContent = popover.querySelector('.popover-content');
                    if (popoverContent) {
                        popoverContent.innerHTML = '<p style="color: var(--theme-danger); font-size: 12px;">Error loading files.</p>';
                    }
                });
            }
        }

        popover.innerHTML = `
            <div class="popover-header">
                <span class="popover-title">${setting.name}</span>
                <button class="popover-close" onclick="propertiesManager.removeSetting('${setting.id}'); propertiesManager.closePopover();" title="Remove setting">
                    <span class="material-icons" style="font-size: 16px;">delete</span>
                </button>
            </div>
            ${controlsHTML}
        `;

        document.body.appendChild(popover);

        // Position popover
        const rect = chipElement.getBoundingClientRect();
        popover.style.left = rect.left + 'px';
        popover.style.top = (rect.bottom + 8) + 'px';

        // Adjust if off screen
        const popRect = popover.getBoundingClientRect();
        if (popRect.right > window.innerWidth) {
            popover.style.left = (window.innerWidth - popRect.width - 20) + 'px';
        }
        if (popRect.bottom > window.innerHeight) {
            popover.style.top = (rect.top - popRect.height - 8) + 'px';
        }

        // Add event listeners for inputs
                 const inputs = popover.querySelectorAll('input, select');
                 
                 inputs.forEach(input => {
                     // Use 'input' event for input elements and 'change' event for select elements
                     const eventType = input.tagName.toLowerCase() === 'select' ? 'change' : 'input';
                     
                     input.addEventListener(eventType, async (e) => {
                         // Update value display
                         if (input.type === 'range') {
                             const display = popover.querySelector('.value-display');
                             if (display) display.textContent = input.value;
                         }
         
                         await this.updateSettingValue(setting.id, input.value || input.checked);
                         
                         // Close popover after selecting from dropdown
                         if (input.tagName.toLowerCase() === 'select') {
                             this.closePopover();
                         }
                     });
                 });

        // Add Enter key handler for all input elements (not select or range) - separate loop to ensure it's added after other handlers
        const textInputs = popover.querySelectorAll('input:not([type="range"])');
        textInputs.forEach(input => {
            input.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    // Update the value first
                    await this.updateSettingValue(setting.id, input.value);
                    
                    // Then close the popover
                    setTimeout(() => {
                        this.closePopover();
                    }, 10);
                }
            }, true); // Use capture phase to ensure this runs first
        });

        // Auto-focus the first input/select element for immediate editing
        const firstInput = popover.querySelector('input:not([type="range"]), select');
        if (firstInput) {
            setTimeout(() => {
                firstInput.focus();
                // If it's a text input, select all text for easy replacement
                if (firstInput.type === 'text' || firstInput.type === 'number') {
                    firstInput.select();
                }
            }, 50);
        }

        // Add event listeners for contenteditable value display
        const valueDisplays = popover.querySelectorAll('.value-display[contenteditable="true"]');
        valueDisplays.forEach(display => {
            display.addEventListener('blur', async (e) => {
                const newValue = e.target.textContent;
                const rangeInput = popover.querySelector('input[type="range"]');
                if (rangeInput) {
                    rangeInput.value = newValue;
                    await this.updateSettingValue(setting.id, newValue);
                }
            });
            display.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    
                    // Update the value first
                    const newValue = e.target.textContent;
                    const rangeInput = popover.querySelector('input[type="range"]');
                    if (rangeInput) {
                        rangeInput.value = newValue;
                        await this.updateSettingValue(setting.id, newValue);
                    }
                    
                    // Then close the popover
                    setTimeout(() => {
                        this.closePopover();
                    }, 10);
                }
            }, true); // Use capture phase
        });

        // Auto-focus contenteditable value display if no other input was focused
        if (!firstInput && valueDisplays.length > 0) {
            setTimeout(() => {
                const firstDisplay = valueDisplays[0];
                firstDisplay.focus();
                // Select all text in the contenteditable element
                const range = document.createRange();
                range.selectNodeContents(firstDisplay);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }, 50);
        }

        // Prevent close handler from interfering with popover interactions
                popover.addEventListener('click', (e) => {
                    // Stop all clicks inside the popover from bubbling up to document
                    e.stopPropagation();
                });
                
                // Close handler - close when clicking outside the popover
                                 setTimeout(() => {
                                     const closeHandler = (e) => {
                                         // Check if the click was outside the popover and the original chip
                                         const clickedInsidePopover = popover.contains(e.target);
                                         const clickedInsideChip = chipElement.contains(e.target);
                                         
                                         if (!clickedInsidePopover && !clickedInsideChip) {
                                             this.closePopover();
                                             document.removeEventListener('click', closeHandler);
                                             document.removeEventListener('keydown', keyHandler);
                                         }
                                     };
                                     
                                     const keyHandler = (e) => {
                                         if (e.key === 'Escape') {
                                             this.closePopover();
                                             document.removeEventListener('click', closeHandler);
                                             document.removeEventListener('keydown', keyHandler);
                                         }
                                     };
                                     
                                     document.addEventListener('click', closeHandler);
                                     document.addEventListener('keydown', keyHandler);
                                 }, 50); // Very short delay since we're using stopPropagation
    }

    closePopover() {
        const popover = document.getElementById('setting-popover');
        if (popover) popover.remove();
    }

    async updateSettingValue(settingId, value) {
        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        if (!activeWindow) return;

        const textarea = activeWindow.querySelector('[data-field="custom_args"]');

        const parsedSettings = await this.desktop.parseArgumentsToSettings(textarea.value);
        parsedSettings[settingId] = value;
        parsedSettings[settingId + '_enabled'] = true;

        const newArgs = await this.desktop.settingsToArguments(parsedSettings, textarea.value);
        textarea.value = newArgs;

        // Regenerate visualizer
        await this.regenerateVisualizer(activeWindow, newArgs);
    }

    async regenerateVisualizer(activeWindow, argsString) {
        const settingsConfig = await this.desktop.loadSettingsConfig();
        const visualizer = activeWindow.querySelector('#arguments-visualizer');
        if (visualizer) {
            visualizer.innerHTML = await this.generateArgumentsVisualizer(argsString, settingsConfig);
            // Re-setup drag and drop
            this.initDragAndDrop(visualizer);
        }
        
        // Refresh the settings list to update the "in use" status
        await this.refreshSettingsList();
    }

    async copyArgumentsAsRaw() {
        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        if (!activeWindow) return;

        const textarea = activeWindow.querySelector('[data-field="custom_args"]');
        if (!textarea) return;

        const argsString = textarea.value.trim();
        
        if (!argsString) {
            console.warn('No arguments to copy');
            return;
        }

        try {
            await navigator.clipboard.writeText(argsString);
            console.log('Arguments copied to clipboard:', argsString);
            
            // Show a notification
            if (this.desktop.showNotification) {
                this.desktop.showNotification('Arguments copied to clipboard', 'success');
            }
        } catch (error) {
            console.error('Error copying arguments:', error);
            if (this.desktop.showNotification) {
                this.desktop.showNotification('Failed to copy arguments', 'error');
            }
        }
    }

    async pasteArgumentsAsRaw() {
        const activeWindow = document.querySelector('.properties-window:not(.hidden)');
        if (!activeWindow) return;

        const textarea = activeWindow.querySelector('[data-field="custom_args"]');
        if (!textarea) return;

        try {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
                textarea.value = text.trim();
                
                // Update visualizer
                await this.regenerateVisualizer(activeWindow, text.trim());
                
                // Show a notification
                if (this.desktop.showNotification) {
                    this.desktop.showNotification('Arguments pasted from clipboard', 'success');
                }
            } else {
                console.warn('Clipboard is empty or does not contain text');
                if (this.desktop.showNotification) {
                    this.desktop.showNotification('Clipboard is empty', 'info');
                }
            }
        } catch (error) {
            console.error('Error pasting arguments:', error);
            if (this.desktop.showNotification) {
                this.desktop.showNotification('Failed to paste arguments', 'error');
            }
        }
    }

    async addSettingFromMenu(settingId) {
        // Close the popup menu immediately
        const menu = document.getElementById('settings-popup-menu');
        if (menu) menu.classList.add('hidden');

        await this.addSettingById(settingId);
    }

    async openUnknownArgPopover(chipElement, encodedArg) {
        // Close existing popover
        this.closePopover();

        const currentArg = decodeURIComponent(encodedArg);

        // Create popover element
        const popover = document.createElement('div');
        popover.className = 'setting-popover';
        popover.id = 'setting-popover';

        popover.innerHTML = `
            <div class="popover-header">
                <span class="popover-title">Edit Custom Argument</span>
                <button class="popover-close" onclick="propertiesManager.removeUnknownArg('${encodedArg}'); propertiesManager.closePopover();" title="Remove argument">
                    <span class="material-icons" style="font-size: 16px;">delete</span>
                </button>
            </div>
            <div class="popover-content">
                <input type="text" class="custom-arg-input" value="${currentArg}" placeholder="--argument value" style="width: 100%; padding: 8px; font-size: 14px;">
            </div>
        `;

        document.body.appendChild(popover);

        // Position popover
        const rect = chipElement.getBoundingClientRect();
        popover.style.left = rect.left + 'px';
        popover.style.top = (rect.bottom + 8) + 'px';

        // Adjust if off screen
        const popRect = popover.getBoundingClientRect();
        if (popRect.right > window.innerWidth) {
            popover.style.left = (window.innerWidth - popRect.width - 20) + 'px';
        }
        if (popRect.bottom > window.innerHeight) {
            popover.style.top = (rect.top - popRect.height - 8) + 'px';
        }

        // Focus the input and select all text for easy editing
        const input = popover.querySelector('.custom-arg-input');
        setTimeout(() => {
            input.focus();
            input.select();
        }, 50);

        // Add event listeners
        input.addEventListener('blur', async () => {
            await this.updateUnknownArg(encodedArg, input.value);
        });

        input.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                await this.updateUnknownArg(encodedArg, input.value);
                this.closePopover();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.closePopover();
            }
        });

        // Close when clicking outside
                setTimeout(() => {
                    const closeHandler = (e) => {
                        // Check if the click was outside the popover and the original chip
                        const clickedInsidePopover = popover.contains(e.target);
                        const clickedInsideChip = chipElement.contains(e.target);
                        
                        if (!clickedInsidePopover && !clickedInsideChip) {
                            this.closePopover();
                            document.removeEventListener('click', closeHandler);
                            document.removeEventListener('keydown', keyHandler);
                        }
                    };
                    
                    const keyHandler = (e) => {
                        if (e.key === 'Escape') {
                            this.closePopover();
                            document.removeEventListener('click', closeHandler);
                            document.removeEventListener('keydown', keyHandler);
                        }
                    };
                    
                    document.addEventListener('click', closeHandler);
                    document.addEventListener('keydown', keyHandler);
                }, 0);
    }

    async updateUnknownArg(encodedOldArg, newArg) {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            const textarea = activeWindow.querySelector('[data-field="custom_args"]');
            const oldArg = decodeURIComponent(encodedOldArg);
            
            // Replace the old argument with the new one
            let currentArgs = textarea.value.trim();
            const args = this.desktop.parseArguments(currentArgs);
            
            // Find and replace the old argument
            const newArgs = [];
            let i = 0;
            while (i < args.length) {
                const arg = args[i];
                
                // Check if this matches our old argument (could be single arg or arg + value)
                if (arg === oldArg) {
                    // Single argument match
                    if (newArg.trim()) {
                        newArgs.push(newArg.trim());
                    }
                    i++;
                } else if (arg.startsWith('-') && i + 1 < args.length && !args[i + 1].startsWith('-')) {
                    // Argument with value
                    const fullArg = `${arg} ${args[i + 1]}`;
                    if (fullArg === oldArg) {
                        if (newArg.trim()) {
                            newArgs.push(newArg.trim());
                        }
                        i += 2; // Skip both arg and value
                    } else {
                        newArgs.push(arg);
                        i++;
                    }
                } else {
                    newArgs.push(arg);
                    i++;
                }
            }
            
            const newArgsString = newArgs.join(' ');
            textarea.value = newArgsString;
            
            // Regenerate visualizer
            await this.regenerateVisualizer(activeWindow, newArgsString);

        } catch (error) {
            console.error('Error updating unknown argument:', error);
        }
    }

    async removeUnknownArg(encodedArg) {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            const textarea = activeWindow.querySelector('[data-field="custom_args"]');
            const argToRemove = decodeURIComponent(encodedArg);
            
            // Remove the argument
            let currentArgs = textarea.value.trim();
            const args = this.desktop.parseArguments(currentArgs);
            
            // Filter out the argument to remove
            const newArgs = [];
            let i = 0;
            while (i < args.length) {
                const arg = args[i];
                
                // Check if this matches our argument to remove
                if (arg === argToRemove) {
                    // Skip this argument
                    i++;
                } else if (arg.startsWith('-') && i + 1 < args.length && !args[i + 1].startsWith('-')) {
                    // Argument with value
                    const fullArg = `${arg} ${args[i + 1]}`;
                    if (fullArg === argToRemove) {
                        // Skip both arg and value
                        i += 2;
                    } else {
                        newArgs.push(arg);
                        i++;
                    }
                } else {
                    newArgs.push(arg);
                    i++;
                }
            }
            
            const newArgsString = newArgs.join(' ');
            textarea.value = newArgsString;
            
            // Regenerate visualizer
            await this.regenerateVisualizer(activeWindow, newArgsString);

        } catch (error) {
            console.error('Error removing unknown argument:', error);
        }
    }

    async addCustomArgument() {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            const textarea = activeWindow.querySelector('[data-field="custom_args"]');
            const settingsConfig = await this.desktop.loadSettingsConfig();
            
            // Add a placeholder custom argument
            const currentArgs = textarea.value.trim();
            const newArgs = currentArgs ? `${currentArgs} --custom-arg value` : '--custom-arg value';
            textarea.value = newArgs;
            
            // Regenerate visualizer
            await this.regenerateVisualizer(activeWindow, newArgs);

            // Automatically open the popover for the new custom argument
            setTimeout(() => {
                const customChips = activeWindow.querySelectorAll('.arg-chip.unknown');
                const newChip = Array.from(customChips).find(chip => 
                    chip.textContent.includes('--custom-arg value')
                );
                if (newChip) {
                    this.openUnknownArgPopover(newChip, encodeURIComponent('--custom-arg value'));
                }
            }, 100);

        } catch (error) {
            console.error('Error adding custom argument:', error);
        }
    }

    // Drag and Drop functionality using mouse events
    async updateArgumentsFromChipOrder() {
        try {
            const activeWindow = document.querySelector('.properties-window:not(.hidden)');
            if (!activeWindow) return;

            const textarea = activeWindow.querySelector('[data-field="custom_args"]');
            const visualizer = activeWindow.querySelector('#arguments-visualizer');
            
            // Get all argument chips in their current order (excluding the add button)
            const chips = Array.from(visualizer.querySelectorAll('.arg-chip:not(.add-arg-btn)'));
            
            // Build new arguments string from chip order
            const newArgs = chips.map(chip => {
                return chip.dataset.rawArg || '';
            }).filter(arg => arg.trim() !== '').join(' ');
            
            // Update textarea
            textarea.value = newArgs;
            
            console.log('Reordered arguments:', newArgs);

        } catch (error) {
            console.error('Error updating arguments from chip order:', error);
        }
    }

    async updateArgumentsFromChipOrderWithPlaceholder() {
        // This method is intentionally simplified to reduce lag during drag
        // The actual update happens in updateArgumentsFromChipOrder on drop
        return;
    }
}