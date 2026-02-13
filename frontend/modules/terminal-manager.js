// Terminal Management Module
// Tauri API will be accessed when needed to prevent loading issues
class TerminalManager {
    constructor(desktop) {
        this.desktop = desktop;
        this.terminals = new Map(); // Store terminal instances
        this.terminalCounter = 0;

        // Initialize Tauri API access
        this.invoke = null;
        this.initTauriAPI();

        // Load auto-switch setting from localStorage (default: enabled)
        this.autoSwitchEnabled = localStorage.getItem('terminalAutoSwitch') !== 'false';
    }

    initTauriAPI() {
        try {
            if (window.__TAURI__ && window.__TAURI__.core) {
                this.invoke = window.__TAURI__.core.invoke;
                console.log('Tauri API initialized in TerminalManager');
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

    async openServerTerminal(processId, modelName, host, port, modelPath, activeVersion, launchArgs = null) {
        console.log('OpenServerTerminal called with:', { processId, modelName, host, port, modelPath, activeVersion, launchArgs });

        const windowId = `server_${processId}`;
        console.log('Creating terminal window with ID:', windowId);

        const content = `
            <div class="server-terminal-container">
                <div class="server-main-content">
                    <div class="server-tab-panel active" id="panel-terminal-${windowId}">
                        <div class="server-info">
                            <span class="server-status starting"><span class="material-icons" style="color: #ffc107; font-size: 14px;">circle</span> Starting</span>
                            <span class="server-details">${modelName} - <span class="clickable" style="cursor: pointer; text-decoration: underline;" onclick="terminalManager.openUrl('http://${host}:${port}')">${host}:${port}</span><button class="copy-link-btn" style="background: none; border: none; cursor: pointer; margin-left: 5px; padding: 0; font-size: 14px; vertical-align: middle;" onclick="terminalManager.copyToClipboard('http://${host}:${port}', this)" title="Copy link"><span class="material-icons" style="font-size: 14px; color: var(--theme-text-muted);">content_copy</span></button></span>
                            <div class="server-controls">
                                <button class="server-btn auto-switch-btn ${this.autoSwitchEnabled ? 'active' : ''}" id="auto-switch-btn-${windowId}" onclick="terminalManager.toggleAutoSwitch('${windowId}')" title="${this.autoSwitchEnabled ? 'Auto-switch to chat: ON' : 'Auto-switch to chat: OFF'}"><span class="material-icons">${this.autoSwitchEnabled ? 'toggle_on' : 'toggle_off'}</span></button>
                                <button class="server-btn stop-btn" id="stop-btn-${windowId}"><span class="material-icons">stop</span> Stop</button>
                            </div>
                        </div>
                        <div class="server-output" id="server-output-${windowId}"><div class="server-line server-system">Starting ${modelName}...</div><div class="server-line server-system">Process ID: ${processId}</div><div class="server-line server-system">Server will be available at: ${host}:${port}</span></div><div class="server-line server-system">Waiting for server output...</div></div>
                    </div>
                    <div class="server-tab-panel" id="panel-chat-${windowId}" style="background: white; position: relative;">
                        <div id="iframe-loading-${windowId}" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: white; z-index: 10;">
                            <div class="loading-spinner" style="width: 40px; height: 40px; border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                            <p style="margin-top: 16px; color: #666;">Waiting for server...</p>
                        </div>
                        <iframe id="iframe-${windowId}" src="about:blank" data-url="http://${host}:${port}" frameBorder="0" style="width: 100%; height: 100%; border: none;" allow="clipboard-read; clipboard-write"></iframe>
                        <div id="iframe-error-${windowId}" style="display: none; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #666;">
                            <p>Unable to load chat interface</p>
                            <p style="font-size: 12px;">The server may have security restrictions preventing iframe embedding</p>
                            <a href="http://${host}:${port}" target="_blank" style="color: #007bff; margin-top: 12px;">Open in new tab</a>
                        </div>
                    </div>
                </div>
            </div>
        `;

        console.log('Calling desktop.createWindow...');
        const window = this.desktop.createWindow(windowId, `Server - ${modelName} (Build: ${activeVersion})`, 'server-terminal-window', content);
        console.log('Desktop.createWindow returned:', window);

        // Ensure the window is visible and not hidden
        if (window) {
            // Inject tabs into header
            const header = window.querySelector('.window-header');
            if (header) {
                const tabsHtml = `
                    <div class="server-tabs header-tabs">
                        <div class="server-tab active" id="tab-terminal-${windowId}" onclick="terminalManager.switchTab('${windowId}', 'terminal')" title="Terminal Output">
                            <span class="material-icons">terminal</span>
                        </div>
                        <div class="server-tab" id="tab-chat-${windowId}" onclick="terminalManager.switchTab('${windowId}', 'chat')" title="Native Chat" style="opacity: 0.5; pointer-events: none;">
                            <span class="material-icons">chat</span>
                        </div>
                    </div>
                `;
                const titleElement = header.querySelector('.window-title');
                if (titleElement) {
                    titleElement.insertAdjacentHTML('afterend', tabsHtml);
                }
            }

            console.log('Making window visible...');
            window.classList.remove('hidden');
            window.style.display = 'block';
            // Bring to front
            window.style.zIndex = this.desktop.windowZIndex + 1;
            this.desktop.windowZIndex += 1;
            
            // Set up iframe event handlers
            setTimeout(() => {
                const iframe = window.querySelector(`#iframe-${windowId}`);
                const loadingEl = window.querySelector(`#iframe-loading-${windowId}`);
                const errorEl = window.querySelector(`#iframe-error-${windowId}`);
                const actualUrl = iframe?.dataset.url;
                
                if (iframe && loadingEl && errorEl && actualUrl) {
                    // Hide loading on successful load
                    iframe.onload = function() {
                        loadingEl.style.display = 'none';
                    };
                    
                    // Show error on failure
                    iframe.onerror = function() {
                        loadingEl.style.display = 'none';
                        errorEl.style.display = 'flex';
                    };
                    
                    // Function to check server health and load iframe
                    const checkAndLoad = () => {
                        fetch(actualUrl, { method: 'HEAD', mode: 'no-cors' })
                            .then(() => {
                                // Server is responding, load the iframe
                                iframe.src = actualUrl;
                            })
                            .catch(() => {
                                // Server not ready yet, try again in 1 second
                                setTimeout(checkAndLoad, 1000);
                            });
                    };
                    
                    // Start checking server health
                    checkAndLoad();
                    
                    // Also hide loading after 30 seconds as fallback
                    setTimeout(() => {
                        loadingEl.style.display = 'none';
                    }, 30000);
                }
            }, 100);

            console.log('Window after visibility setup:', {
                id: window.id,
                display: window.style.display,
                visibility: window.style.visibility,
                zIndex: window.style.zIndex,
                classList: Array.from(window.classList)
            });

            // Handle focus/click to bring to front and handle global click interactions
            // Since iframe consumes clicks, we monitor window blur which happens when clicking into iframe
            setTimeout(() => {
                const chatPanel = window.querySelector(`#panel-chat-${windowId}`);
                if (chatPanel) {
                    const iframe = chatPanel.querySelector('iframe');
                    if (iframe) {
                        const blurHandler = () => {
                            if (document.activeElement === iframe) {
                                // Bring this window to front
                                window.style.zIndex = ++this.desktop.windowZIndex;
                                
                                // Update visual active state
                                document.querySelectorAll('.window').forEach(w => w.classList.remove('active'));
                                window.classList.add('active');
                                
                                document.querySelectorAll('.taskbar-item').forEach(t => t.classList.remove('active'));
                                const taskbarItem = document.getElementById(`taskbar-${windowId}`);
                                if (taskbarItem) taskbarItem.classList.add('active');

                                // Trigger global click interactions (hide menus, collapse hardware monitor)
                                if (this.desktop.handleGlobalClickInteraction) {
                                    this.desktop.handleGlobalClickInteraction();
                                }
                            }
                        };
                        globalThis.addEventListener('blur', blurHandler);
                    }
                }
            }, 100);
        } else {
            console.error('Failed to create terminal window!');
            return null;
        }

        // Store model info for this terminal
        this.terminals.set(windowId, {
            processId,
            modelName,
            modelPath,
            host,
            port,
            status: 'starting',
            output: [], // Store terminal output lines
            activeVersion: activeVersion,
            launchArgs: launchArgs // Store the actual arguments used for launch
        });

        console.log('Adding taskbar item...');
        // Add to taskbar
        this.desktop.addTaskbarItem(`Server - ${modelName}`, windowId, '<span class="material-icons">computer</span>');

        // Set up event listeners for buttons
        setTimeout(() => {


            const stopBtn = document.getElementById(`stop-btn-${windowId}`);
            if (stopBtn) {
                stopBtn.addEventListener('click', () => {
                    this.updateServerStatus(windowId, 'terminating');
                    this.stopServer(processId, windowId, modelPath, modelName);
                });
            }
        }, 0);

        console.log('Starting output polling...');
        // Start polling for output
        this.startServerOutputPolling(processId, windowId);

        // Also add a status check after a few seconds to ensure we show something
        setTimeout(() => {
            console.log('Running server health check...');
            this.checkServerHealth(windowId, host, port, modelName);
        }, 3000);

        console.log('Terminal window creation completed successfully');
        
        // Maximize the window on creation - need to clear transform first
        setTimeout(() => {
            // Remove the centering transform before maximizing
            window.style.transform = 'none';
            window.style.left = '100px';
            window.style.top = '100px';
            
            // Now maximize
            this.desktop.maximizeWindow(windowId);
        }, 50);
        
        return window;
    }

    startServerOutputPolling(processId, windowId) {
        const terminalInfo = this.terminals.get(windowId);
        if (!terminalInfo) return;

        // Track last scroll position to determine if user is scrolled up
        let isScrolledToBottom = true;

        // Batch updates to reduce DOM operations
        let outputBuffer = [];
        let updateTimer = null;
        let lastOutputTime = 0;
        const minUpdateInterval = 50; // ms

        const flushOutputBuffer = (outputDiv) => {
            if (outputBuffer.length > 0) {
                // Check if user has scrolled up
                const wasScrolledToBottom = isScrolledToBottom;

                // Create a document fragment to batch DOM operations
                const fragment = document.createDocumentFragment();
                outputBuffer.forEach(line => {
                    if (line !== null && line !== undefined) {
                        const lineDiv = document.createElement('div');
                        lineDiv.className = 'server-line';
                        // Handle special characters and escape sequences
                        lineDiv.textContent = line.toString();
                        fragment.appendChild(lineDiv);
                    }
                });

                outputDiv.appendChild(fragment);

                // Only scroll to bottom if user hasn't scrolled up
                if (wasScrolledToBottom) {
                    outputDiv.scrollTop = outputDiv.scrollHeight;
                }

                outputBuffer = [];
            }
        };

        const pollOutput = async () => {
            try {
                console.log(`Polling output for process ${processId}...`);
                // Use Tauri command instead of fetch
                const invoke = this.getInvoke();
                if (!invoke) {
                    console.error('Tauri invoke not available for output polling');
                    return;
                }
                const data = await invoke('get_process_output', { processId: processId });
                console.log(`Output data received:`, data);

                const outputDiv = document.getElementById(`server-output-${windowId}`);

                if (!outputDiv) {
                    console.warn(`Output div not found for ${windowId}`);
                    return;
                }

                // Update scroll position tracking ONLY if visible
                if (outputDiv.offsetParent !== null) {
                    const scrollTop = outputDiv.scrollTop;
                    const scrollHeight = outputDiv.scrollHeight;
                    const clientHeight = outputDiv.clientHeight;
                    isScrolledToBottom = (scrollTop + clientHeight >= scrollHeight - 5);
                }

                // Add new output lines to buffer if they exist
                if (data.output && Array.isArray(data.output) && data.output.length > 0) {
                    console.log(`Adding ${data.output.length} output lines to buffer`);
                    outputBuffer.push(...data.output);

                    // Check for server ready message and update status
                    const serverReadyMessage = "main: server is listening on http://";
                    const hasServerReadyMessage = data.output.some(line =>
                        line && line.toString().includes(serverReadyMessage)
                    );

                    if (hasServerReadyMessage && terminalInfo.status === 'starting') {
                        console.log('Server ready message detected, updating status to running');
                        this.updateServerStatus(windowId, 'running');
                        
                        // Auto-switch to chat tab when server is running (if enabled)
                        if (this.autoSwitchEnabled) {
                            setTimeout(() => {
                                this.switchTab(windowId, 'chat');
                            }, 4000);
                        }
                    }

                    // Save output to terminal data (keep last 1000 lines)
                    const terminalData = this.terminals.get(windowId);
                    if (terminalData) {
                        if (!terminalData.output) terminalData.output = [];
                        terminalData.output.push(...data.output);
                        // Keep only last 1000 lines to prevent memory issues
                        if (terminalData.output.length > 1000) {
                            terminalData.output = terminalData.output.slice(-1000);
                        }
                        this.terminals.set(windowId, terminalData);
                    }

                    // Throttle updates to prevent UI freezing but be more responsive
                    const now = Date.now();
                    if (now - lastOutputTime > minUpdateInterval || outputBuffer.length > 50) {
                        console.log('Flushing output buffer immediately');
                        flushOutputBuffer(outputDiv);
                        lastOutputTime = now;
                    } else if (!updateTimer) {
                        // Schedule buffer flush
                        updateTimer = setTimeout(() => {
                            console.log('Flushing output buffer (scheduled)');
                            flushOutputBuffer(outputDiv);
                            updateTimer = null;
                            lastOutputTime = Date.now();
                        }, minUpdateInterval);
                    }
                } else {
                    console.log('No new output data received');
                }

                // Check if process is still running
                if (data.is_running !== false && (terminalInfo.status === 'running' || terminalInfo.status === 'starting')) {
                    console.log('Process still running, continuing polling in 100ms');
                    // Continue polling if process is still running - faster polling for better responsiveness
                    setTimeout(pollOutput, 100);
                } else if (data.is_running === false) {
                    console.log('Process has stopped, finalizing output');
                    // Process has stopped, flush any remaining output
                    if (updateTimer) {
                        clearTimeout(updateTimer);
                    }
                    flushOutputBuffer(outputDiv);
                    this.updateServerStatus(windowId, 'stopped', data.return_code || 0);
                }
            } catch (error) {
                console.error('Error polling server output:', error);
                const terminalInfo = this.terminals.get(windowId);

                // If the server is gone or another error, stop polling.
                this.updateServerStatus(windowId, 'stopped', -1);
                const outputDiv = document.getElementById(`server-output-${windowId}`);
                if (outputDiv) {
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'server-line server-error';
                    errorDiv.textContent = `Connection to server lost. Polling stopped. Error: ${error.message}`;
                    outputDiv.appendChild(errorDiv);
                    outputDiv.scrollTop = outputDiv.scrollHeight;
                }
                return; // Stop polling
            }
        };

        // Start polling immediately
        pollOutput();
    }

    async checkServerHealth(windowId, host, port, modelName) {
        const outputDiv = document.getElementById(`server-output-${windowId}`);
        if (!outputDiv) return;

        try {
            const response = await fetch(`http://${host}:${port}/v1/models`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });

            if (response.ok) {
                const models = await response.json();
                const lineDiv = document.createElement('div');
                lineDiv.className = 'server-line server-success';
                lineDiv.textContent = `Server is responding! Available models: ${models.data?.length || 'Unknown'}`;
                outputDiv.appendChild(lineDiv);
                outputDiv.scrollTop = outputDiv.scrollHeight;
                
                // Update server status to running when health check succeeds
                const terminalInfo = this.terminals.get(windowId);
                if (terminalInfo && terminalInfo.status === 'starting') {
                    console.log('Health check successful, updating status to running');
                    this.updateServerStatus(windowId, 'running');
                    
                    // Auto-switch to chat tab when server is running (if enabled)
                    if (this.autoSwitchEnabled) {
                        setTimeout(() => {
                            this.switchTab(windowId, 'chat');
                        }, 500);
                    }
                }
            } else {
                throw new Error(`Server responded with status ${response.status}`);
            }
        } catch (error) {
            const lineDiv = document.createElement('div');
            lineDiv.className = 'server-line server-warning';
            lineDiv.textContent = `Warning: Server health check failed: ${error.message}`;
            outputDiv.appendChild(lineDiv);
            outputDiv.scrollTop = outputDiv.scrollHeight;
        }
    }

    updateServerStatus(windowId, status, returnCode = null) {
        const window = this.desktop.windows.get(windowId);
        const terminalInfo = this.terminals.get(windowId);

        if (window && terminalInfo) {
            const statusElement = window.querySelector('.server-status');
            const stopBtn = window.querySelector('.stop-btn');

            if (statusElement) {
                if (status === 'starting') {
                    statusElement.innerHTML = '<span class="material-icons" style="color: #ffc107; font-size: 14px;">circle</span> Starting';
                    statusElement.className = 'server-status starting';
                    terminalInfo.status = 'starting';
                } else if (status === 'running') {
                    statusElement.innerHTML = '<span class="material-icons" style="color: #4caf50; font-size: 14px;">circle</span> Running';
                    statusElement.className = 'server-status running';
                    terminalInfo.status = 'running';
                } else if (status === 'terminating') {
                    statusElement.innerHTML = '<span class="material-icons" style="color: #ffc107; font-size: 14px;">circle</span> Terminating';
                    statusElement.className = 'server-status starting';
                    terminalInfo.status = 'terminating';
                } else if (status === 'stopped') {
                    statusElement.textContent = 'Stopped';
                    statusElement.className = 'server-status stopped';

                    // Update terminal info
                    terminalInfo.status = 'stopped';



                    // Change stop button to start button
                    if (stopBtn) {
                        // Clone button to remove old event listeners
                        const newStartBtn = stopBtn.cloneNode(true);
                        stopBtn.parentNode.replaceChild(newStartBtn, stopBtn);

                        newStartBtn.textContent = 'Start';
                        newStartBtn.className = 'server-btn start-btn';
                        newStartBtn.id = `start-btn-${windowId}`;

                        // Add restart listener
                        newStartBtn.addEventListener('click', () => {
                            this.restartServer(windowId, terminalInfo.modelPath, terminalInfo.modelName);
                        });
                    }
                }
            }
        }

        // Update chat icon state based on server status
        const chatTab = document.getElementById(`tab-chat-${windowId}`);
        if (chatTab) {
            const icon = chatTab.querySelector('.material-icons');
            if (status === 'running') {
                chatTab.style.opacity = '1';
                chatTab.style.pointerEvents = 'auto';
                chatTab.classList.add('pulse-animation');
                if (icon) icon.style.color = '#4caf50';
            } else {
                chatTab.style.opacity = '0.5';
                chatTab.style.pointerEvents = 'none';
                chatTab.classList.remove('pulse-animation');
                if (icon) icon.style.color = '';

                // If we are currently on the chat tab and server stops, switch to terminal
                if (chatTab.classList.contains('active')) {
                    this.switchTab(windowId, 'terminal');
                }
            }
        }
    }

    async stopServer(processId, windowId, modelPath, modelName) {
        try {
            // Use Tauri command instead of fetch
            const invoke = this.getInvoke();
            if (!invoke) {
                console.error('Tauri invoke not available for process termination');
                return;
            }
            await invoke('kill_process', { processId: processId });

            this.updateServerStatus(windowId, 'stopped', 0);
            // this.desktop.showNotification(`${modelName} stopped`, 'info');


        } catch (error) {
            console.error('Error stopping server:', error);
            // this.desktop.showNotification(`Error stopping server: ${error.message}`, 'error');
        }
    }

    async startServer(windowId, modelPath, modelName) {
        const terminalInfo = this.terminals.get(windowId);
        if (!terminalInfo) return;

        try {
            // Use Tauri command instead of fetch
            const invoke = this.getInvoke();
            if (!invoke) {
                console.error('Tauri invoke not available for model restart');
                return;
            }
            
            // Use the same arguments that were used for the original launch
            let result;
            if (terminalInfo.launchArgs) {
                console.log(`Restarting with stored arguments: ${terminalInfo.launchArgs}`);
                // Temporarily update the model config with the stored arguments
                const currentConfig = await invoke('get_model_settings', { modelPath: modelPath });
                const originalArgs = currentConfig.custom_args;
                
                // Update config with launch args
                await invoke('update_model_settings', { 
                    modelPath: modelPath, 
                    config: { ...currentConfig, custom_args: terminalInfo.launchArgs }
                });
                
                // Launch the model
                result = await invoke('launch_model', { modelPath: modelPath });
                
                // Restore original args
                await invoke('update_model_settings', { 
                    modelPath: modelPath, 
                    config: { ...currentConfig, custom_args: originalArgs }
                });
            } else {
                console.log('Restarting with default configuration');
                result = await invoke('launch_model', { modelPath: modelPath });
            }

            if (result.success) {
                // Update terminal info with new process ID
                terminalInfo.processId = result.process_id;
                terminalInfo.host = result.server_host;
                terminalInfo.port = result.server_port;
                terminalInfo.status = 'starting';

                // Update chat iframe URL with new host:port
                const chatPanel = document.getElementById(`panel-chat-${windowId}`);
                if (chatPanel) {
                    const iframe = chatPanel.querySelector('iframe');
                    if (iframe) {
                        const newUrl = `http://${result.server_host}:${result.server_port}`;
                        console.log(`Updating chat iframe URL to: ${newUrl}`);
                        iframe.src = newUrl;
                    }
                }

                // Update UI
                const window = this.desktop.windows.get(windowId);
                if (window) {
                    const statusElement = window.querySelector('.server-status');
                    const startBtn = window.querySelector('.start-btn');
                    const serverDetails = window.querySelector('.server-details');

                    if (statusElement) {
                        statusElement.innerHTML = '<span class="material-icons" style="color: #ffc107; font-size: 14px;">circle</span> Starting';
                        statusElement.className = 'server-status starting';
                    }

                    if (serverDetails) {
                        serverDetails.innerHTML = `${modelName} - <span class="clickable" style="cursor: pointer; text-decoration: underline;" onclick="terminalManager.openUrl('http://${result.server_host}:${result.server_port}')">${result.server_host}:${result.server_port}</span><button class="copy-link-btn" style="background: none; border: none; cursor: pointer; margin-left: 5px; padding: 0; font-size: 14px; vertical-align: middle;" onclick="terminalManager.copyToClipboard('http://${result.server_host}:${result.server_port}', this)" title="Copy link"><span class="material-icons" style="font-size: 14px; color: var(--theme-text-muted);">content_copy</span></button>`;
                    }

                    // Change start button back to stop button
                    if (startBtn) {
                        startBtn.textContent = 'Stop';
                        startBtn.className = 'server-btn stop-btn';
                        startBtn.id = `stop-btn-${windowId}`;
                        // Remove any existing event listeners
                        const newStartBtn = startBtn.cloneNode(true);
                        startBtn.parentNode.replaceChild(newStartBtn, startBtn);
                        // Add event listener
                        newStartBtn.addEventListener('click', () => {
                            this.stopServer(result.process_id, windowId, modelPath, modelName);
                        });
                    }

                    // Add restart message to output
                    const outputDiv = window.querySelector(`[id^="server-output-"]`);
                    if (outputDiv) {
                        const separator = document.createElement('div');
                        separator.className = 'server-line server-separator';
                        separator.textContent = '--- Restarting Server ---';
                        outputDiv.appendChild(separator);

                        const restartDiv = document.createElement('div');
                        restartDiv.className = 'server-line server-system';
                        restartDiv.textContent = `Restarting ${modelName}...`;
                        outputDiv.appendChild(restartDiv);

                        const processDiv = document.createElement('div');
                        processDiv.className = 'server-line server-system';
                        processDiv.textContent = `New Process ID: ${result.process_id}`;
                        outputDiv.appendChild(processDiv);

                        const serverDiv = document.createElement('div');
                        serverDiv.className = 'server-line server-system';
                        serverDiv.textContent = `Server: ${result.server_host}:${result.server_port}`;
                        outputDiv.appendChild(serverDiv);

                        outputDiv.scrollTop = outputDiv.scrollHeight;
                    }
                }

                // Start polling for new output
                this.startServerOutputPolling(result.process_id, windowId);
                
                // Set up health check after restart
                setTimeout(() => {
                    console.log('Running server health check after restart...');
                    this.checkServerHealth(windowId, result.server_host, result.server_port, modelName);
                    
                    // Also refresh the chat iframe after health check to ensure it connects to the new server
                    setTimeout(() => {
                        const chatPanel = document.getElementById(`panel-chat-${windowId}`);
                        if (chatPanel) {
                            const iframe = chatPanel.querySelector('iframe');
                            if (iframe) {
                                console.log('Refreshing chat iframe after health check');
                                // Force reload the iframe by setting src again
                                const currentSrc = iframe.src;
                                iframe.src = 'about:blank';
                                setTimeout(() => {
                                    iframe.src = currentSrc;
                                }, 100);
                            }
                        }
                    }, 1000); // Wait 1 second after health check
                }, 3000);
                
                // this.desktop.showNotification(`${modelName} restarted`, 'success');
            } else {
                throw new Error(result.error || 'Failed to launch model');
            }
        } catch (error) {
            console.error('Error restarting server:', error);
            // this.desktop.showNotification(`Failed to restart ${modelName}: ${error.message}`, 'error');
        }
    }

    // Proper restart functionality that stops then starts
    async restartServer(windowId, modelPath, modelName) {
        console.log(`🔄 [INDIVIDUAL SERVER RESTART] Starting restart for ${modelName} (window: ${windowId})`);

        const terminalInfo = this.terminals.get(windowId);
        if (!terminalInfo) {
            console.warn(`No terminal info found for window ${windowId}`);
            console.log(`🆕 [NEW SERVER START] No existing terminal, starting fresh server for ${modelName}`);
            return this.startServer(windowId, modelPath, modelName);
        }

        try {
            console.log(`🔄 [RESTART SEQUENCE] Restarting server for ${modelName}...`);

            // First, stop the existing process if it's running or starting
            if (terminalInfo.processId && (terminalInfo.status === 'running' || terminalInfo.status === 'starting')) {
                console.log(`🛑 [STOP PHASE] Stopping existing process ${terminalInfo.processId}`);
                await this.stopServer(terminalInfo.processId, windowId, modelPath, modelName);

                // Wait a moment for the process to fully stop
                console.log(`⏱️ [WAIT PHASE] Waiting 500ms for process cleanup...`);
                await new Promise(resolve => setTimeout(resolve, 500));
                console.log(`✅ [WAIT COMPLETE] Ready to start new process`);
            } else {
                console.log(`ℹ️ [SKIP STOP] Process not running, proceeding to start`);
            }

            // Then start a new instance
            console.log(`▶️ [START PHASE] Starting new instance of ${modelName}`);
            const result = await this.startServer(windowId, modelPath, modelName);
            console.log(`🎉 [RESTART COMPLETE] Successfully restarted ${modelName}`);
            return result;

        } catch (error) {
            console.error('❌ [RESTART ERROR] Error in restart sequence:', error);
            // this.desktop.showNotification(`Failed to restart ${modelName}: ${error.message}`, 'error');
        }
    }

    switchTab(windowId, tabName) {
        const terminalTab = document.getElementById(`tab-terminal-${windowId}`);
        const chatTab = document.getElementById(`tab-chat-${windowId}`);
        const terminalPanel = document.getElementById(`panel-terminal-${windowId}`);
        const chatPanel = document.getElementById(`panel-chat-${windowId}`);

        if (tabName === 'terminal') {
            terminalTab?.classList.add('active');
            chatTab?.classList.remove('active');
            terminalPanel?.classList.add('active');
            chatPanel?.classList.remove('active');

            // Fix: Scroll to bottom when switching back to terminal
            const outputDiv = document.getElementById(`server-output-${windowId}`);
            if (outputDiv) {
                // Use a small timeout to ensure the display: flex has taken effect
                setTimeout(() => {
                    outputDiv.scrollTop = outputDiv.scrollHeight;
                }, 50);
            }
        } else {
            terminalTab?.classList.remove('active');
            chatTab?.classList.add('active');
            terminalPanel?.classList.remove('active');
            chatPanel?.classList.add('active');
        }
    }

    toggleAutoSwitch(windowId) {
        // Toggle the global auto-switch setting
        this.autoSwitchEnabled = !this.autoSwitchEnabled;
        
        // Save to localStorage
        localStorage.setItem('terminalAutoSwitch', this.autoSwitchEnabled.toString());
        
        // Update all auto-switch buttons across all terminals
        const allAutoSwitchButtons = document.querySelectorAll('.auto-switch-btn');
        allAutoSwitchButtons.forEach(btn => {
            const icon = btn.querySelector('.material-icons');
            if (this.autoSwitchEnabled) {
                btn.classList.add('active');
                btn.title = 'Auto-switch to chat: ON';
                if (icon) icon.textContent = 'toggle_on';
            } else {
                btn.classList.remove('active');
                btn.title = 'Auto-switch to chat: OFF';
                if (icon) icon.textContent = 'toggle_off';
            }
        });
        
        console.log(`Auto-switch ${this.autoSwitchEnabled ? 'enabled' : 'disabled'}`);
    }

    openNativeChatForServer(modelName, host, port) {
        const url = `http://${host}:${port}`;
        const windowId = `native_chat_${Date.now()}`; // Unique ID for each window

        // Setup iframe content
        // We use an iframe that takes up the full window content and ensure it has white background
        const content = `
            <div style="width: 100%; height: 100%; display: flex; flex-direction: column; background: white; position: relative;">
                <div id="iframe-loading-${windowId}" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: white; z-index: 10;">
                    <div class="loading-spinner" style="width: 40px; height: 40px; border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                    <p style="margin-top: 16px; color: #666;">Waiting for server...</p>
                </div>
                <iframe id="iframe-${windowId}" src="about:blank" data-url="${url}" frameBorder="0" style="flex: 1; border: none; width: 100%; height: 100%;" allow="clipboard-read; clipboard-write"></iframe>
                <div id="iframe-error-${windowId}" style="display: none; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #666;">
                    <p>Unable to load chat interface</p>
                    <p style="font-size: 12px;">The server may have security restrictions preventing iframe embedding</p>
                    <a href="${url}" target="_blank" style="color: #007bff; margin-top: 12px;">Open in new tab</a>
                </div>
            </div>
        `;

        // Create the window with host and port in title
        this.desktop.createWindow(windowId, `Native Chat - ${modelName} (${host}:${port})`, 'browser-window', content);

        // Set up event handlers after window is created
        setTimeout(() => {
            const iframe = document.getElementById(`iframe-${windowId}`);
            const loadingEl = document.getElementById(`iframe-loading-${windowId}`);
            const errorEl = document.getElementById(`iframe-error-${windowId}`);
            const actualUrl = iframe.dataset.url;
            
            if (iframe && loadingEl && errorEl) {
                // Hide loading on successful load
                iframe.onload = function() {
                    loadingEl.style.display = 'none';
                };
                
                // Show error on failure
                iframe.onerror = function() {
                    loadingEl.style.display = 'none';
                    errorEl.style.display = 'flex';
                };
                
                // Function to check server health and load iframe
                const checkAndLoad = () => {
                    fetch(actualUrl, { method: 'HEAD', mode: 'no-cors' })
                        .then(() => {
                            // Server is responding, load the iframe
                            iframe.src = actualUrl;
                        })
                        .catch(() => {
                            // Server not ready yet, try again in 1 second
                            setTimeout(checkAndLoad, 1000);
                        });
                };
                
                // Start checking server health
                checkAndLoad();
                
                // Also hide loading after 30 seconds as fallback
                setTimeout(() => {
                    loadingEl.style.display = 'none';
                }, 30000);
            }
        }, 100);

        // Apply some specific styles if needed (desktop.js handles basic window creation)
        const windowElement = this.desktop.windows.get(windowId);
        if (windowElement) {
            // Make it a decent size by default
            windowElement.style.width = '1000px';
            windowElement.style.height = '800px';

            // Center it roughly
            const left = (window.innerWidth - 1000) / 2;
            const top = (window.innerHeight - 800) / 2;
            windowElement.style.left = `${Math.max(50, left)}px`;
            windowElement.style.top = `${Math.max(50, top)}px`;

            // Bring to front
            windowElement.style.zIndex = this.desktop.windowZIndex + 1;
            this.desktop.windowZIndex += 1;

            // Add taskbar item for this window with host and port in title
            this.desktop.addTaskbarItem(`Native Chat - ${modelName} (${host}:${port})`, windowId, '<span class="material-icons">open_in_browser</span>');

            // Handle focus/click to bring to front
            // Since iframe consumes clicks, we monitor window blur which happens when clicking into iframe
            const iframe = windowElement.querySelector('iframe');
            if (iframe) {
                const blurHandler = () => {
                    if (document.activeElement === iframe) {
                        // Bring this window to front
                        windowElement.style.zIndex = ++this.desktop.windowZIndex;

                        // Update visual active state if possible (DesktopManager doesn't expose a clean method for this but we can try)
                        // This mimics what happens in desktop.js mousedown handler
                        document.querySelectorAll('.window').forEach(w => w.classList.remove('active'));
                        windowElement.classList.add('active');

                        document.querySelectorAll('.taskbar-item').forEach(t => t.classList.remove('active'));
                        const taskbarItem = document.getElementById(`taskbar-${windowId}`);
                        if (taskbarItem) taskbarItem.classList.add('active');
                    }
                };
                window.addEventListener('blur', blurHandler);
            }
        }
    }



    // Session management methods
    async saveTerminalState(windowId, terminalData) {
        try {
            const response = await fetch('/api/session/terminal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    windowId: windowId,
                    processId: terminalData.processId,
                    modelName: terminalData.modelName,
                    modelPath: terminalData.modelPath,
                    host: terminalData.host,
                    port: terminalData.port,
                    status: terminalData.status,
                    output: terminalData.output || [],
                    activeVersion: terminalData.activeVersion || ''
                })
            });

            if (!response.ok) {
                throw new Error('Failed to save terminal state');
            }
        } catch (error) {
            console.error('Error saving terminal state:', error);
        }
    }

    // Check for existing terminal for a model
    getExistingTerminal(modelPath) {
        return Array.from(this.terminals.entries()).find(([windowId, terminalInfo]) =>
            terminalInfo.modelPath === modelPath
        );
    }

    // Get terminal data for session restoration
    getTerminalData(windowId) {
        return this.terminals.get(windowId);
    }

    // Remove terminal from tracking
    removeTerminal(windowId) {
        this.terminals.delete(windowId);
    }

    // Get all terminals for session management
    getAllTerminals() {
        return this.terminals;
    }

    // Get active terminal IDs for cleanup
    getActiveTerminals() {
        const activeTerminals = [];
        for (const [windowId, terminalInfo] of this.terminals.entries()) {
            if ((terminalInfo.status === 'running' || terminalInfo.status === 'starting') && terminalInfo.processId) {
                activeTerminals.push(windowId);
            }
        }
        return activeTerminals;
    }

    // Close a specific terminal and its process
    async closeTerminal(windowId) {
        const terminalInfo = this.terminals.get(windowId);
        if (terminalInfo && terminalInfo.processId && (terminalInfo.status === 'running' || terminalInfo.status === 'starting')) {
            console.log(`📺 Closing terminal ${windowId} with process ${terminalInfo.processId}`);
            try {
                await this.stopServer(terminalInfo.processId, windowId, terminalInfo.modelPath, terminalInfo.modelName);
                console.log(`✅ Successfully closed terminal ${windowId}`);

                // Disconnect any chat sessions connected to this server

            } catch (error) {
                console.error(`❌ Failed to close terminal ${windowId}:`, error);
            }
        }
        this.terminals.delete(windowId);
    }

    // Method to open URL in default browser
    async openUrl(url) {
        try {
            // Use desktop manager's openUrl method
            await this.desktop.openUrl(url);
        } catch (error) {
            console.error('Error opening URL:', error);
        }
    }

    // Method to copy text to clipboard
    async copyToClipboard(text, buttonElement) {
        try {
            await navigator.clipboard.writeText(text);
            // Show visual feedback
            const originalIcon = buttonElement.innerHTML;
            buttonElement.innerHTML = '<span class="material-icons" style="font-size: 14px; color: #4caf50;">check</span>';
            setTimeout(() => {
                buttonElement.innerHTML = originalIcon;
            }, 2000);
        } catch (error) {
            console.error('Error copying to clipboard:', error);
            // Show error feedback
            const originalIcon = buttonElement.innerHTML;
            buttonElement.innerHTML = '<span class="material-icons" style="font-size: 14px; color: #f44336;">error</span>';
            setTimeout(() => {
                buttonElement.innerHTML = originalIcon;
            }, 2000);
        }
    }

    // Terminal restoration and session management methods
    async restoreTerminalsAndWindows() {
        if (!this.desktop.sessionData) {
            console.log('No session data available for restoration');
            return;
        }

        if (this.desktop.restorationInProgress) {
            console.log('Restoration already in progress, skipping duplicate call');
            return;
        }

        this.desktop.restorationInProgress = true;
        console.log('Starting terminal and window restoration...');
        console.log('Session data terminals:', this.desktop.sessionData.terminals);
        console.log('Session data windows:', this.desktop.sessionData.windows);

        // First restore terminals data
        for (const [windowId, terminalData] of Object.entries(this.desktop.sessionData.terminals || {})) {
            console.log('Loading terminal data for', windowId, ':', terminalData);
            console.log('Terminal output length:', terminalData.output ? terminalData.output.length : 'no output');

            this.terminals.set(windowId, terminalData);
            // Check if process is still running - this will update the status
            await this.checkTerminalProcess(windowId, terminalData);
        }

        // Then restore windows - restore terminals regardless of visibility, other windows only if visible
        for (const [windowId, windowData] of Object.entries(this.desktop.sessionData.windows || {})) {
            console.log('Processing window restoration for:', windowId, windowData);

            if (windowData.type === 'terminal') {
                // Always restore terminal windows (whether they were visible or minimized)
                const terminalData = this.getTerminalData(windowId);
                console.log('Terminal data for window restoration:', terminalData);
                if (terminalData && (terminalData.status === 'running' || terminalData.status === 'starting')) {
                    console.log('Restoring terminal window for running/starting process:', windowId, windowData);
                    this.desktop.restoreWindow(windowId, windowData);
                } else {
                    console.log('Skipping terminal window restoration - process not running:', windowId,
                        terminalData ? `status: ${terminalData.status}` : 'no terminal data');
                    // Remove the non-running terminal from session
                    await this.desktop.removeWindowFromSession(windowId);
                }
            }
        }

        console.log('Terminal and window restoration complete');
        this.desktop.restorationInProgress = false;
    }

    async checkTerminalProcess(windowId, terminalData) {
        if (!terminalData.processId) {
            terminalData.status = 'stopped';
            this.terminals.set(windowId, terminalData);
            console.log(`Terminal ${windowId} has no processId, marked as stopped`);
            return;
        }

        try {
            console.log(`Checking process status for ${windowId} with processId: ${terminalData.processId}`);
            // Use Tauri command instead of fetch API
            const invoke = this.getInvoke();
            const result = await invoke('get_process_output', { processId: terminalData.processId });
            const newStatus = result.is_running ? (terminalData.status === 'starting' ? 'starting' : 'running') : 'stopped';
            console.log(`Process ${terminalData.processId} status: ${newStatus}`);
            terminalData.status = newStatus;
            this.terminals.set(windowId, terminalData);
        } catch (error) {
            console.warn(`Error checking terminal process ${terminalData.processId}:`, error);
            // If the process is not found or another error, mark as stopped
            terminalData.status = 'stopped';
            this.terminals.set(windowId, terminalData);
        }
    }

    restoreTerminalWindow(windowId, terminalData, windowData) {
        console.log('Restoring terminal window with data:', terminalData);
        console.log('Terminal output length:', terminalData.output ? terminalData.output.length : 'no output');

        const content = `
            <div class="server-terminal-container">
                <div class="server-main-content">
                    <div class="server-tab-panel active" id="panel-terminal-${windowId}">
                        <div class="server-info">
                            <span class="server-status ${terminalData.status}">
                                <span class="material-icons" style="color: ${terminalData.status === 'running' ? '#4caf50' : terminalData.status === 'starting' ? '#ffc107' : '#f44336'}; font-size: 14px;">circle</span>
                                ${terminalData.status}
                            </span>
                            <span class="server-details">${terminalData.modelName} - <span class="clickable" style="cursor: pointer; text-decoration: underline;" onclick="terminalManager.openUrl('http://${terminalData.host}:${terminalData.port}')">${terminalData.host}:${terminalData.port}</span><button class="copy-link-btn" style="background: none; border: none; cursor: pointer; margin-left: 5px; padding: 0; font-size: 14px; vertical-align: middle;" onclick="terminalManager.copyToClipboard('http://${terminalData.host}:${terminalData.port}', this)" title="Copy link"><span class="material-icons" style="font-size: 14px; color: var(--theme-text-muted);">content_copy</span></button></span>
                            <div class="server-controls">
                                <button class="server-btn auto-switch-btn ${this.autoSwitchEnabled ? 'active' : ''}" id="auto-switch-btn-${windowId}" onclick="terminalManager.toggleAutoSwitch('${windowId}')" title="${this.autoSwitchEnabled ? 'Auto-switch to chat: ON' : 'Auto-switch to chat: OFF'}"><span class="material-icons">${this.autoSwitchEnabled ? 'toggle_on' : 'toggle_off'}</span></button>
                                ${terminalData.status === 'running' || terminalData.status === 'starting' ?
                `<button class="server-btn stop-btn" onclick="terminalManager.stopServer('${terminalData.processId}', '${windowId}', '${terminalData.modelPath}', '${terminalData.modelName}')"><span class="material-icons">stop</span> Stop</button>` :
                `<button class="server-btn start-btn" onclick="terminalManager.restartServer('${windowId}', '${terminalData.modelPath}', '${terminalData.modelName}')"><span class="material-icons">play_arrow</span> Start</button>`
            }
                            </div>
                        </div>
                        <div class="server-output" id="server-output-${windowId}">
                            <div class="server-line">Restored ${terminalData.modelName} session</div>
                            <div class="server-line">Process ID: ${terminalData.processId}</div>
                            <div class="server-line">Server: <span class="clickable" style="cursor: pointer; text-decoration: underline;" onclick="terminalManager.openUrl('http://${terminalData.host}:${terminalData.port}')">${terminalData.host}:${terminalData.port}</span><button class="copy-link-btn" style="background: none; border: none; cursor: pointer; margin-left: 5px; padding: 0; font-size: 14px; vertical-align: middle;" onclick="terminalManager.copyToClipboard('http://${terminalData.host}:${terminalData.port}', this)" title="Copy link"><span class="material-icons" style="font-size: 14px; color: var(--theme-text-muted);">content_copy</span></button></div>
                            <div class="server-line">Output lines: ${terminalData.output ? terminalData.output.length : 0}</div>
                            ${terminalData.output && terminalData.output.length > 0 ? terminalData.output.map(line =>
                `<div class="server-line">${line.toString().replace(/ /g, '&nbsp;')}</div>`
            ).join('') : '<div class="server-line">No saved output found</div>'}
                        </div>
                    </div>
                    <div class="server-tab-panel" id="panel-chat-${windowId}" style="background: white; position: relative;">
                        <div id="iframe-loading-${windowId}" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: white; z-index: 10;">
                            <div class="loading-spinner" style="width: 40px; height: 40px; border: 3px solid #f3f3f3; border-top: 3px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                            <p style="margin-top: 16px; color: #666;">Waiting for server...</p>
                        </div>
                        <iframe id="iframe-${windowId}" src="about:blank" data-url="http://${terminalData.host}:${terminalData.port}" frameBorder="0" style="width: 100%; height: 100%; border: none;" allow="clipboard-read; clipboard-write"></iframe>
                        <div id="iframe-error-${windowId}" style="display: none; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #666;">
                            <p>Unable to load chat interface</p>
                            <p style="font-size: 12px;">The server may have security restrictions preventing iframe embedding</p>
                            <a href="http://${terminalData.host}:${terminalData.port}" target="_blank" style="color: #007bff; margin-top: 12px;">Open in new tab</a>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const window = this.desktop.createWindow(windowId, `Server - ${terminalData.modelName}`, 'server-terminal-window', content);

        // Inject tabs into header
        const header = window.querySelector('.window-header');
        if (header) {
            const tabsHtml = `
                <div class="server-tabs header-tabs">
                    <div class="server-tab active" id="tab-terminal-${windowId}" onclick="terminalManager.switchTab('${windowId}', 'terminal')" title="Terminal Output">
                        <span class="material-icons">terminal</span>
                    </div>
                    <div class="server-tab" id="tab-chat-${windowId}" onclick="terminalManager.switchTab('${windowId}', 'chat')" title="Native Chat" style="${terminalData.status === 'running' ? 'opacity: 1; pointer-events: auto;' : 'opacity: 0.5; pointer-events: none;'}" class="${terminalData.status === 'running' ? 'server-tab pulse-animation' : 'server-tab'}">
                        <span class="material-icons" style="${terminalData.status === 'running' ? 'color: #4caf50;' : ''}">chat</span>
                    </div>
                </div>
            `;
            const titleElement = header.querySelector('.window-title');
            if (titleElement) {
                titleElement.insertAdjacentHTML('afterend', tabsHtml);
            }
        }

        this.desktop.addTaskbarItem(`Server - ${terminalData.modelName}`, windowId, '<span class="material-icons">computer</span>');

        // Restore window position and size
        if (windowData.position) {
            window.style.left = windowData.position.x + 'px';
            window.style.top = windowData.position.y + 'px';
        }
        if (windowData.size) {
            window.style.width = windowData.size.width + 'px';
            window.style.height = windowData.size.height + 'px';
            // Store the dimensions for proper size saving when minimized
            window.dataset.savedWidth = windowData.size.width.toString();
            window.dataset.savedHeight = windowData.size.height.toString();
        }
        if (windowData.zIndex) {
            window.style.zIndex = windowData.zIndex;
            this.desktop.windowZIndex = Math.max(this.desktop.windowZIndex, windowData.zIndex);
        }

        // Always start minimized during restoration
        this.desktop.minimizeWindow(windowId);

        // Scroll terminal to bottom after restoration
        setTimeout(() => {
            const outputDiv = document.getElementById(`server-output-${windowId}`);
            if (outputDiv) {
                outputDiv.scrollTop = outputDiv.scrollHeight;
            }
        }, 100);
        
        // Set up iframe event handlers
        setTimeout(() => {
            const iframe = window.querySelector(`#iframe-${windowId}`);
            const loadingEl = window.querySelector(`#iframe-loading-${windowId}`);
            const errorEl = window.querySelector(`#iframe-error-${windowId}`);
            const actualUrl = iframe?.dataset.url;
            
            if (iframe && loadingEl && errorEl && actualUrl) {
                // Hide loading on successful load
                iframe.onload = function() {
                    loadingEl.style.display = 'none';
                };
                
                // Show error on failure
                iframe.onerror = function() {
                    loadingEl.style.display = 'none';
                    errorEl.style.display = 'flex';
                };
                
                // Function to check server health and load iframe
                const checkAndLoad = () => {
                    fetch(actualUrl, { method: 'HEAD', mode: 'no-cors' })
                        .then(() => {
                            // Server is responding, load the iframe
                            iframe.src = actualUrl;
                        })
                        .catch(() => {
                            // Server not ready yet, try again in 1 second
                            setTimeout(checkAndLoad, 1000);
                        });
                };
                
                // Start checking server health
                checkAndLoad();
                
                // Also hide loading after 30 seconds as fallback
                setTimeout(() => {
                    loadingEl.style.display = 'none';
                }, 30000);
            }
        }, 100);

        // Resume output polling if process is still running or starting
        if ((terminalData.status === 'running' || terminalData.status === 'starting') && terminalData.processId) {
            this.startServerOutputPolling(terminalData.processId, windowId);
        }
    }

    async closeAllTerminalSessions() {
        try {
            // Get all terminal windows from session state
            const terminalWindows = Object.values(this.desktop.windows).filter(window =>
                window && (window.type === 'terminal' || window.id.includes('terminal'))
            );

            // Get all active terminals from terminal manager
            const activeTerminals = this.getActiveTerminals();

            console.log(`Found ${terminalWindows.length} terminal windows and ${activeTerminals.length} active terminals`);

            // Close all terminal processes
            const closePromises = [];

            // Close terminals via terminal manager if available
            if (activeTerminals.length > 0) {
                for (const terminalId of activeTerminals) {
                    try {
                        const promise = this.closeTerminal(terminalId);
                        if (promise && typeof promise.then === 'function') {
                            closePromises.push(promise);
                        }
                    } catch (error) {
                        console.error(`Error closing terminal ${terminalId}:`, error);
                    }
                }
            }

            // Also close terminal windows via window manager
            for (const window of terminalWindows) {
                try {
                    if (window.processId) {
                        // Kill the process via API
                        const killPromise = fetch(`/api/process/${window.processId}/kill`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        }).catch(error => console.error(`Error killing process ${window.processId}:`, error));

                        closePromises.push(killPromise);
                    }

                    // Close the window
                    this.desktop.closeWindow(window.id);
                } catch (error) {
                    console.error(`Error closing terminal window ${window.id}:`, error);
                }
            }

            // Wait for all close operations to complete (with timeout)
            if (closePromises.length > 0) {
                await Promise.allSettled(closePromises);
                // Give processes a moment to fully terminate
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            console.log('All terminal sessions closed successfully');

        } catch (error) {
            console.error('Error closing terminal sessions:', error);
            // Don't throw - we want restart to continue even if terminal cleanup fails
        }
    }
}

// Debug: Confirm TerminalManager class is loaded
console.log('TerminalManager class loaded successfully');
window.TerminalManager = TerminalManager;