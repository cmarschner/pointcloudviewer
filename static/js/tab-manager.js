        class TabManager {
            constructor() {
                this.panes = new Map();
                this.tabs = new Map();
                this.draggedTab = null;
                this.draggedTabData = null;
                this.init();
            }
            
            init() {
                // Initialize all panes
                document.querySelectorAll('.pane').forEach(pane => {
                    this.initPane(pane);
                });
                
                // Set initial active tabs
                this.activateTab('leftPane', 'files');
                this.activateTab('container', 'viewer3d');
                this.activateTab('rightPane', 'hierarchy');
            }
            
            initPane(pane) {
                const paneId = pane.id;
                const tabs = new Map();
                
                // Initialize tabs in this pane
                pane.querySelectorAll('.tab').forEach(tab => {
                    const tabId = tab.dataset.tab;
                    const panel = pane.querySelector(`[data-panel="${tabId}"]`);
                    
                    tabs.set(tabId, {
                        element: tab,
                        panel: panel,
                        title: tab.textContent.trim()
                    });
                    
                    // Add event listeners
                    this.setupTabEvents(tab, tabId, paneId);
                });
                
                this.panes.set(paneId, {
                    element: pane,
                    tabs: tabs,
                    activeTab: null
                });
                
                // Setup pane drop events
                this.setupPaneDropEvents(pane, paneId);
            }
            
            setupTabEvents(tab, tabId, paneId) {
                // Click to activate
                tab.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.activateTab(paneId, tabId);
                });
                
                // Drag events
                tab.draggable = true;
                
                tab.addEventListener('dragstart', (e) => {
                    this.startTabDrag(e, tabId, paneId);
                });
                
                tab.addEventListener('dragend', (e) => {
                    this.endTabDrag(e);
                });
                
                // Drop on tab (for reordering)
                tab.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (this.draggedTab && this.draggedTab !== tab) {
                        tab.classList.add('drag-over');
                    }
                });
                
                tab.addEventListener('dragleave', (e) => {
                    tab.classList.remove('drag-over');
                });
                
                tab.addEventListener('drop', (e) => {
                    e.preventDefault();
                    tab.classList.remove('drag-over');
                    if (this.draggedTab && this.draggedTab !== tab) {
                        this.reorderTab(tab, paneId);
                    }
                });
            }
            
            setupPaneDropEvents(pane, paneId) {
                pane.addEventListener('dragover', (e) => {
                    if (this.draggedTab) {
                        e.preventDefault();
                        pane.classList.add('drop-target');
                    }
                });
                
                pane.addEventListener('dragleave', (e) => {
                    if (!pane.contains(e.relatedTarget)) {
                        pane.classList.remove('drop-target');
                    }
                });
                
                pane.addEventListener('drop', (e) => {
                    e.preventDefault();
                    pane.classList.remove('drop-target');
                    if (this.draggedTab && this.draggedTabData) {
                        this.moveTabToPane(paneId);
                    }
                });
            }
            
            startTabDrag(e, tabId, paneId) {
                const pane = this.panes.get(paneId);
                const tabData = pane.tabs.get(tabId);
                
                this.draggedTab = tabData.element;
                this.draggedTabData = {
                    tabId: tabId,
                    sourcePaneId: paneId,
                    title: tabData.title,
                    panel: tabData.panel
                };
                
                this.draggedTab.classList.add('dragging');
                
                // Set drag data
                e.dataTransfer.setData('text/plain', tabId);
                e.dataTransfer.effectAllowed = 'move';
            }
            
            endTabDrag(e) {
                if (this.draggedTab) {
                    this.draggedTab.classList.remove('dragging');
                }
                
                // Clean up drag over states
                document.querySelectorAll('.tab.drag-over').forEach(tab => {
                    tab.classList.remove('drag-over');
                });
                
                document.querySelectorAll('.pane.drop-target').forEach(pane => {
                    pane.classList.remove('drop-target');
                });
                
                this.draggedTab = null;
                this.draggedTabData = null;
            }
            
            moveTabToPane(targetPaneId) {
                if (!this.draggedTabData || this.draggedTabData.sourcePaneId === targetPaneId) {
                    return;
                }
                
                const sourcePane = this.panes.get(this.draggedTabData.sourcePaneId);
                const targetPane = this.panes.get(targetPaneId);
                const tabData = this.draggedTabData;
                
                // Remove from source pane
                sourcePane.tabs.delete(tabData.tabId);
                sourcePane.element.querySelector('.tab-header').removeChild(this.draggedTab);
                sourcePane.element.querySelector('.tab-content').removeChild(tabData.panel);
                
                // Add to target pane
                const newTab = this.createTab(tabData.tabId, tabData.title);
                targetPane.element.querySelector('.tab-header').appendChild(newTab);
                targetPane.element.querySelector('.tab-content').appendChild(tabData.panel);
                
                // Update target pane's tab map
                targetPane.tabs.set(tabData.tabId, {
                    element: newTab,
                    panel: tabData.panel,
                    title: tabData.title
                });
                
                // Setup events for new tab
                this.setupTabEvents(newTab, tabData.tabId, targetPaneId);
                
                // Activate the moved tab
                this.activateTab(targetPaneId, tabData.tabId);
                
                // If source pane has no active tab, activate first available
                if (sourcePane.activeTab === tabData.tabId) {
                    const firstTab = sourcePane.tabs.keys().next().value;
                    if (firstTab) {
                        this.activateTab(this.draggedTabData.sourcePaneId, firstTab);
                    }
                }
            }
            
            reorderTab(targetTab, paneId) {
                const pane = this.panes.get(paneId);
                const tabHeader = pane.element.querySelector('.tab-header');
                
                // Get the position to insert
                const targetIndex = Array.from(tabHeader.children).indexOf(targetTab);
                const draggedIndex = Array.from(tabHeader.children).indexOf(this.draggedTab);
                
                if (targetIndex !== draggedIndex) {
                    if (targetIndex < draggedIndex) {
                        tabHeader.insertBefore(this.draggedTab, targetTab);
                    } else {
                        tabHeader.insertBefore(this.draggedTab, targetTab.nextSibling);
                    }
                }
            }
            
            createTab(tabId, title) {
                const tab = document.createElement('div');
                tab.className = 'tab';
                tab.dataset.tab = tabId;
                tab.textContent = title;
                tab.draggable = true;
                return tab;
            }
            
            activateTab(paneId, tabId) {
                const pane = this.panes.get(paneId);
                if (!pane || !pane.tabs.has(tabId)) {
                    return;
                }
                
                // Deactivate current active tab
                if (pane.activeTab) {
                    const currentTab = pane.tabs.get(pane.activeTab);
                    if (currentTab) {
                        currentTab.element.classList.remove('active');
                        currentTab.panel.classList.remove('active');
                    }
                }
                
                // Activate new tab
                const newTab = pane.tabs.get(tabId);
                newTab.element.classList.add('active');
                newTab.panel.classList.add('active');
                pane.activeTab = tabId;
                
                // Special handling for slice view and 3D viewer
                if (tabId === 'sliceview') {
                    // Trigger canvas resize after tab becomes visible
                    setTimeout(() => {
                        if (window.pointCloudViewer) {
                            window.pointCloudViewer.resizeSliceCanvas();
                            if (window.pointCloudViewer.selectedSlice) {
                                window.pointCloudViewer.renderSliceView();
                            }
                        }
                    }, 50);
                } else if (tabId === 'viewer3d') {
                    // Trigger 3D viewer resize after tab becomes visible
                    setTimeout(() => {
                        if (window.pointCloudViewer) {
                            window.pointCloudViewer.onWindowResize();
                        }
                    }, 50);
                }
            }
            
            getActiveTab(paneId) {
                const pane = this.panes.get(paneId);
                return pane ? pane.activeTab : null;
            }
        }

