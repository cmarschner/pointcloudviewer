/**
 * SelectionManager - Manages point selection with brush tool
 *
 * Features:
 * - Spherical brush at fixed distance from camera
 * - Visual feedback: shadow projection, hover highlight, selection glow
 * - Click + drag to paint-select points
 * - Tracks selected points per node
 */

class SelectionManager {
    constructor(viewer) {
        this.viewer = viewer;

        // Selection state
        this.selectedPoints = new Map();  // nodeId -> Set of point indices
        this.selectionCount = 0;

        // Brush settings
        this.brushRadius = 0.25;  // 0.5m diameter = 0.25m radius
        this.brushDistance = 3.0; // Distance from camera in meters
        this.brushPosition = new THREE.Vector3();
        this.brushActive = false;
        this.isPainting = false;

        // Visual elements
        this.brushMesh = null;
        this.brushShadowMesh = null;

        // Highlight overlay - separate points for visual feedback
        this.highlightPoints = null;
        this.highlightGeometry = null;
        this.shadowPoints = null;
        this.shadowGeometry = null;
        this.selectionPoints = null;
        this.selectionGeometry = null;

        // Edit mode state
        this.editModeActive = false;

        // Undo stack
        this.undoStack = [];
        this.redoStack = [];

        this.init();
    }

    init() {
        // Delay initialization until scene is ready
        // The scene might be replaced by Potree after initial load
        setTimeout(() => {
            this.createBrushVisuals();
            this.setupEventListeners();
            console.log('SelectionManager initialized');
        }, 1000);
    }

    createBrushVisuals() {
        // Get the correct scene (might be Potree's scene)
        const scene = this.viewer.scene;
        console.log('Creating brush visuals in scene:', scene);

        // Create brush sphere (wireframe for visibility)
        const brushGeometry = new THREE.SphereGeometry(this.brushRadius, 16, 16);
        const brushMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,  // Bright green
            transparent: true,
            opacity: 0.3,
            depthTest: false,
            depthWrite: false,
            wireframe: true
        });
        this.brushMesh = new THREE.Mesh(brushGeometry, brushMaterial);
        this.brushMesh.visible = false;
        this.brushMesh.renderOrder = 9999;
        this.brushMesh.name = 'editBrush';

        // Also create a solid core for better visibility
        const coreGeometry = new THREE.SphereGeometry(this.brushRadius * 0.1, 8, 8);
        const coreMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            depthTest: false,
            depthWrite: false
        });
        this.brushCore = new THREE.Mesh(coreGeometry, coreMaterial);
        this.brushCore.visible = false;
        this.brushCore.renderOrder = 10000;
        this.brushMesh.add(this.brushCore); // Attach to brush

        // Create a ring on the ground plane to show where the brush projects
        const ringGeometry = new THREE.RingGeometry(this.brushRadius * 0.9, this.brushRadius, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false
        });
        this.groundRing = new THREE.Mesh(ringGeometry, ringMaterial);
        this.groundRing.rotation.x = -Math.PI / 2; // Lay flat on XY plane
        this.groundRing.visible = false;
        this.groundRing.renderOrder = 9997;
        this.groundRing.name = 'editGroundRing';

        // Add to scene
        scene.add(this.brushMesh);
        scene.add(this.groundRing);

        // No more shadow cylinder - we'll darken points instead
        this.brushShadowMesh = null;

        console.log('Brush meshes added to scene');
    }

    updateBrushSize(newRadius) {
        this.brushRadius = Math.max(0.05, Math.min(5.0, newRadius));

        // Recreate brush geometry
        if (this.brushMesh) {
            this.brushMesh.geometry.dispose();
            this.brushMesh.geometry = new THREE.SphereGeometry(this.brushRadius, 16, 16);
        }

        // Recreate ground ring geometry
        if (this.groundRing) {
            this.groundRing.geometry.dispose();
            this.groundRing.geometry = new THREE.RingGeometry(this.brushRadius * 0.9, this.brushRadius, 32);
        }

        // Update status
        this.updateBrushStatus();
    }

    setupEventListeners() {
        // We need to intercept at the viewer element level to catch events before Potree
        const viewerElement = document.getElementById('viewer');

        // Create an invisible overlay that captures events in edit mode
        this.eventOverlay = document.createElement('div');
        this.eventOverlay.id = 'editEventOverlay';
        this.eventOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 100;
            display: none;
            cursor: crosshair;
        `;
        viewerElement.style.position = 'relative';
        viewerElement.appendChild(this.eventOverlay);

        // Attach events to the overlay - these will capture all mouse events when visible
        this.eventOverlay.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.eventOverlay.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.eventOverlay.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.eventOverlay.addEventListener('mouseleave', () => this.onMouseLeave());
        this.eventOverlay.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        // Prevent context menu in edit mode
        this.eventOverlay.addEventListener('contextmenu', (e) => e.preventDefault());

        // Keyboard shortcuts (global)
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
    }

    showEventOverlay(show) {
        if (this.eventOverlay) {
            this.eventOverlay.style.display = show ? 'block' : 'none';
        }
    }

    onMouseMove(event) {
        if (!this.editModeActive) return;

        this.updateBrushPosition(event);

        if (this.isPainting) {
            this.paintSelection();
        }
    }

    onMouseDown(event) {
        if (!this.editModeActive) return;
        if (event.button !== 0) return; // Left click only

        this.isPainting = true;
        this.paintSelection();

        // Stop event from reaching orbit controls
        event.stopPropagation();
        event.preventDefault();
    }

    onMouseUp(event) {
        if (!this.editModeActive) return;
        this.isPainting = false;

        // Stop event from reaching orbit controls
        event.stopPropagation();
    }

    onMouseLeave() {
        if (this.brushMesh) this.brushMesh.visible = false;
        if (this.groundRing) this.groundRing.visible = false;
        this.isPainting = false;
    }

    onWheel(event) {
        if (!this.editModeActive) return;

        event.preventDefault();

        // Adjust brush size with scroll
        const delta = event.deltaY > 0 ? 0.9 : 1.1;
        this.updateBrushSize(this.brushRadius * delta);
    }

    onKeyDown(event) {
        // Toggle edit mode with 'T' key
        if (event.code === 'KeyT' && !event.ctrlKey && !event.metaKey) {
            this.toggleEditMode();
            event.preventDefault();
            return;
        }

        if (!this.editModeActive) return;

        // Delete selected points with Backspace or Delete
        if (event.code === 'Backspace' || event.code === 'Delete') {
            this.deleteSelectedPoints();
            event.preventDefault();
            return;
        }

        // Undo with Ctrl+Z
        if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ' && !event.shiftKey) {
            this.undo();
            event.preventDefault();
            return;
        }

        // Redo with Ctrl+Shift+Z or Ctrl+Y
        if ((event.ctrlKey || event.metaKey) &&
            (event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey))) {
            this.redo();
            event.preventDefault();
            return;
        }

        // Clear selection with Escape
        if (event.code === 'Escape') {
            this.clearSelection();
            event.preventDefault();
            return;
        }
    }

    toggleEditMode() {
        this.editModeActive = !this.editModeActive;

        if (this.editModeActive) {
            // Disable orbit controls when in edit mode
            if (this.viewer.controls) {
                this.viewer.controls.enabled = false;
                console.log('OrbitControls disabled:', !this.viewer.controls.enabled);
            }

            // Also disable Potree controls if present
            if (this.viewer.potreeViewer) {
                const pv = this.viewer.potreeViewer;

                // Disable Potree's input handler
                if (pv.inputHandler) {
                    pv.inputHandler.enabled = false;
                }
                // Disable navigation cube
                if (pv.navigationCube) {
                    pv.navigationCube.enabled = false;
                }

                // Disable all registered controls in Potree
                if (pv.scene && pv.scene.controls) {
                    for (const control of pv.scene.controls) {
                        if (control.enabled !== undefined) {
                            control.enabled = false;
                        }
                    }
                }

                // Store and detach Potree's event listeners by setting a flag
                pv._editModeDisabled = true;

                console.log('Potree controls disabled');
            }

            this.brushMesh.visible = true;
            if (this.groundRing) this.groundRing.visible = true;

            // Show the event capture overlay
            this.showEventOverlay(true);

            // Add visual overlay to indicate edit mode
            this.showEditModeOverlay(true);

            console.log('Edit mode: ON (T to toggle, scroll to resize brush)');

            // Diagnostic: check what nodes are available
            const nodes = this.getLoadedNodes();
            console.log(`Edit mode activated: ${nodes.length} nodes available for editing`);

            // Sample some actual point positions to understand coordinate system
            this.logPointCloudBounds(nodes);

            // Log octree bounding boxes at different levels
            this.logOctreeBoundingBoxes();

            // Update stats display
            this.updateNodeStats();
        } else {
            // Re-enable orbit controls
            if (this.viewer.controls) {
                this.viewer.controls.enabled = true;
            }

            // Re-enable Potree controls if present
            if (this.viewer.potreeViewer) {
                const pv = this.viewer.potreeViewer;

                if (pv.inputHandler) {
                    pv.inputHandler.enabled = true;
                }
                if (pv.navigationCube) {
                    pv.navigationCube.enabled = true;
                }
                if (pv.scene && pv.scene.controls) {
                    for (const control of pv.scene.controls) {
                        if (control.enabled !== undefined) {
                            control.enabled = true;
                        }
                    }
                }
                pv._editModeDisabled = false;
            }

            this.brushMesh.visible = false;
            if (this.groundRing) this.groundRing.visible = false;

            // Restore original point colors
            this.restoreAllPointColors();

            // Hide the event capture overlay
            this.showEventOverlay(false);

            // Remove visual overlay
            this.showEditModeOverlay(false);

            console.log('Edit mode: OFF');
        }

        this.updateEditModeUI();
    }

    showEditModeOverlay(show) {
        let overlay = document.getElementById('editModeOverlay');

        if (show) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'editModeOverlay';
                overlay.style.cssText = `
                    position: fixed;
                    top: 10px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(76, 175, 80, 0.9);
                    color: white;
                    padding: 10px 24px;
                    border-radius: 20px;
                    font-weight: bold;
                    font-size: 14px;
                    z-index: 10000;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    pointer-events: none;
                `;
                overlay.textContent = 'EDIT MODE - Click to select, Scroll to resize brush, T to exit';
                document.body.appendChild(overlay);
            }
            overlay.style.display = 'block';

            // Also change cursor on the viewer canvas
            if (this.viewer.renderer) {
                this.viewer.renderer.domElement.style.cursor = 'crosshair';
            }
            // Add green border to viewer
            const viewer = document.getElementById('viewer');
            if (viewer) {
                viewer.style.boxShadow = 'inset 0 0 0 3px #4CAF50';
            }
        } else {
            if (overlay) {
                overlay.style.display = 'none';
            }
            // Restore cursor
            if (this.viewer.renderer) {
                this.viewer.renderer.domElement.style.cursor = 'default';
            }
            // Remove green border
            const viewer = document.getElementById('viewer');
            if (viewer) {
                viewer.style.boxShadow = 'none';
            }
        }
    }

    updateBrushPosition(event) {
        // Get the overlay or canvas rect
        const overlay = this.eventOverlay || this.viewer.renderer.domElement;
        const rect = overlay.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Get camera
        const camera = this.viewer.potreeViewer
            ? this.viewer.potreeViewer.scene.getActiveCamera()
            : this.viewer.camera;

        if (!camera) {
            console.warn('No camera available');
            return;
        }

        // Create ray from camera through mouse position
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

        // Position brush at fixed distance along ray
        this.brushPosition.copy(raycaster.ray.origin)
            .add(raycaster.ray.direction.clone().multiplyScalar(this.brushDistance));

        // Update brush mesh position
        if (this.brushMesh) {
            this.brushMesh.position.copy(this.brushPosition);
            this.brushMesh.visible = true;
            if (this.brushCore) {
                this.brushCore.visible = true;
            }
        }

        // Update ground ring - project brush position to Z=0
        if (this.groundRing) {
            this.groundRing.position.set(this.brushPosition.x, this.brushPosition.y, 0.01);
            this.groundRing.visible = true;
        }

        // Update point highlighting (darken shadow, brighten hover)
        this.updatePointColors();
    }

    restoreAllPointColors() {
        // Clear the overlay points when exiting edit mode
        this.clearOverlayPoints();
    }

    updatePointColors() {
        // Since Potree doesn't expose color attributes, we create overlay points
        // to show hover highlights and shadow effects
        this.updateHighlightOverlay();
    }

    /**
     * Create/update overlay points to show brush hover and shadow effects
     * This works with Potree by adding separate THREE.Points objects
     * Uses hierarchical octree traversal with early termination for efficient culling
     */
    updateHighlightOverlay() {
        const brushX = this.brushPosition.x;
        const brushY = this.brushPosition.y;
        const brushZ = this.brushPosition.z;
        const radius = this.brushRadius;
        const radiusSq = radius * radius;

        // Get the point cloud offset for transforming octree bboxes to world coords
        const pc = this.viewer.potreePointCloud;
        const pcOffset = pc && pc.position ?
            { x: pc.position.x, y: pc.position.y, z: pc.position.z } :
            { x: 0, y: 0, z: 0 };

        // Collect points for highlight (inside brush) and shadow (below brush)
        const highlightPositions = [];
        const shadowPositions = [];

        // Stats for logging
        const stats = {
            nodesChecked: 0,
            nodesCulled: 0,
            subtreesCulled: 0,
            pointsChecked: 0,
            nodesContainingBrush: 0
        };

        /**
         * Check if a bounding box (in world coords) intersects the brush query region
         * The query region is: XY cylinder of radius `radius` centered at brush, extending down to -infinity in Z
         * Plus: sphere of radius `radius` centered at brush position
         */
        const bboxIntersectsQuery = (bbox) => {
            if (!bbox) return true; // No bbox = can't cull

            const nodeMinX = bbox.min.x;
            const nodeMaxX = bbox.max.x;
            const nodeMinY = bbox.min.y;
            const nodeMaxY = bbox.max.y;
            const nodeMinZ = bbox.min.z;
            const nodeMaxZ = bbox.max.z;

            // Quick rejection: if node is completely outside brush XY cylinder
            const closestX = Math.max(nodeMinX, Math.min(brushX, nodeMaxX));
            const closestY = Math.max(nodeMinY, Math.min(brushY, nodeMaxY));
            const distXYSqToBox = (closestX - brushX) ** 2 + (closestY - brushY) ** 2;

            if (distXYSqToBox > radiusSq) {
                return false; // Outside XY cylinder
            }

            // Additional check: if node is entirely above brushZ + radius (no shadow or highlight)
            if (nodeMinZ > brushZ + radius) {
                return false;
            }

            return true;
        };

        /**
         * Transform octree bbox to world coordinates
         */
        const toWorldBbox = (localBbox) => {
            if (!localBbox) return null;
            return {
                min: {
                    x: localBbox.min.x + pcOffset.x,
                    y: localBbox.min.y + pcOffset.y,
                    z: localBbox.min.z + pcOffset.z
                },
                max: {
                    x: localBbox.max.x + pcOffset.x,
                    y: localBbox.max.y + pcOffset.y,
                    z: localBbox.max.z + pcOffset.z
                }
            };
        };

        /**
         * Process points from a scene node
         * Points in geometry are in local space - we need to transform them to world space
         * using the scene node's world matrix, not just the point cloud offset
         */
        const processNodePoints = (sceneNode, name) => {
            const positionData = this.getNodePositionData(sceneNode);
            if (!positionData) return;

            const { positions, pointCount } = positionData;
            stats.nodesChecked++;

            // Get the world matrix for this scene node to transform local points to world
            // This includes all parent transformations in the scene graph
            const worldMatrix = sceneNode.matrixWorld;

            // Debug: log first node's transformation
            if (stats.nodesChecked === 1 && this._overlayUpdateCount % 60 === 1) {
                const pos = new THREE.Vector3();
                const quat = new THREE.Quaternion();
                const scale = new THREE.Vector3();
                worldMatrix.decompose(pos, quat, scale);
                console.log(`Node ${name} worldMatrix position: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);

                // Sample first point transformation
                if (positions.length >= 3) {
                    const testPt = new THREE.Vector3(positions[0], positions[1], positions[2]);
                    const worldPt = testPt.clone().applyMatrix4(worldMatrix);
                    console.log(`  First point: local(${testPt.x.toFixed(1)}, ${testPt.y.toFixed(1)}, ${testPt.z.toFixed(1)}) -> world(${worldPt.x.toFixed(1)}, ${worldPt.y.toFixed(1)}, ${worldPt.z.toFixed(1)})`);
                }
            }

            for (let i = 0; i < pointCount; i++) {
                stats.pointsChecked++;

                // Transform local point to world space using the node's world matrix
                const localPt = new THREE.Vector3(
                    positions[i * 3],
                    positions[i * 3 + 1],
                    positions[i * 3 + 2]
                );
                const worldPt = localPt.applyMatrix4(worldMatrix);

                const px = worldPt.x;
                const py = worldPt.y;
                const pz = worldPt.z;

                // Distance in XY plane from brush center
                const dxXY = px - brushX;
                const dyXY = py - brushY;
                const distXYSq = dxXY * dxXY + dyXY * dyXY;

                // Skip if outside XY radius
                if (distXYSq > radiusSq) continue;

                // Full 3D distance
                const dz = pz - brushZ;
                const dist3DSq = distXYSq + dz * dz;

                // Inside brush sphere - add to highlight (brighter)
                if (dist3DSq < radiusSq) {
                    highlightPositions.push(px, py, pz);
                }
                // Below brush (in XY shadow column, and below brush Z) - add to shadow (darker)
                else if (pz < brushZ) {
                    shadowPositions.push(px, py, pz);
                }
            }
        };

        /**
         * Recursively traverse octree with hierarchical culling
         * If a node's bbox doesn't intersect query, skip entire subtree
         */
        const traverseOctree = (octreeNode, visibleNodesMap, depth = 0) => {
            if (!octreeNode) return;

            // Get world bbox for this octree node
            const worldBbox = toWorldBbox(octreeNode.boundingBox);

            // Debug: log root node bbox transformation and query details
            if (depth === 0 && this._overlayUpdateCount % 60 === 1) {
                const localBbox = octreeNode.boundingBox;
                if (localBbox) {
                    console.log(`=== QUERY DEBUG ===`);
                    console.log(`Query: XY cylinder at (${brushX.toFixed(1)}, ${brushY.toFixed(1)}) radius=${radius.toFixed(2)}, Z <= ${(brushZ + radius).toFixed(1)}`);
                    console.log(`pcOffset: (${pcOffset.x.toFixed(1)}, ${pcOffset.y.toFixed(1)}, ${pcOffset.z.toFixed(1)})`);
                    console.log(`Root LOCAL:  X[${localBbox.min.x.toFixed(1)}, ${localBbox.max.x.toFixed(1)}] Y[${localBbox.min.y.toFixed(1)}, ${localBbox.max.y.toFixed(1)}] Z[${localBbox.min.z.toFixed(1)}, ${localBbox.max.z.toFixed(1)}]`);
                    console.log(`Root WORLD:  X[${worldBbox.min.x.toFixed(1)}, ${worldBbox.max.x.toFixed(1)}] Y[${worldBbox.min.y.toFixed(1)}, ${worldBbox.max.y.toFixed(1)}] Z[${worldBbox.min.z.toFixed(1)}, ${worldBbox.max.z.toFixed(1)}]`);

                    // Check if brush is inside root world bbox
                    const inRoot = brushX >= worldBbox.min.x && brushX <= worldBbox.max.x &&
                                   brushY >= worldBbox.min.y && brushY <= worldBbox.max.y;
                    console.log(`Brush in root XY extent? ${inRoot}`);

                    if (!inRoot) {
                        console.log(`!!! MISMATCH: Brush at (${brushX.toFixed(1)}, ${brushY.toFixed(1)}) is OUTSIDE point cloud bounds`);
                        console.log(`Point cloud X range: ${worldBbox.min.x.toFixed(1)} to ${worldBbox.max.x.toFixed(1)}`);
                        console.log(`Point cloud Y range: ${worldBbox.min.y.toFixed(1)} to ${worldBbox.max.y.toFixed(1)}`);
                    }

                    // Log camera position from different sources
                    const cam = this.viewer.camera;
                    const potreeCam = this.viewer.potreeViewer?.scene?.getActiveCamera?.();
                    console.log(`Camera (viewer): (${cam?.position?.x?.toFixed(1)}, ${cam?.position?.y?.toFixed(1)}, ${cam?.position?.z?.toFixed(1)})`);
                    if (potreeCam && potreeCam !== cam) {
                        console.log(`Camera (potree): (${potreeCam.position?.x?.toFixed(1)}, ${potreeCam.position?.y?.toFixed(1)}, ${potreeCam.position?.z?.toFixed(1)})`);
                    }
                }
            }

            // Hierarchical culling: if this node doesn't intersect, skip entire subtree
            if (!bboxIntersectsQuery(worldBbox)) {
                stats.subtreesCulled++;
                return;
            }

            // Check if this node has loaded geometry (is in visibleNodes)
            const nodeName = octreeNode.name;
            if (visibleNodesMap.has(nodeName)) {
                const sceneNode = visibleNodesMap.get(nodeName);
                processNodePoints(sceneNode, nodeName);
            }

            // Recursively process children
            if (octreeNode.children && typeof octreeNode.children === 'object') {
                for (const key of Object.keys(octreeNode.children)) {
                    const child = octreeNode.children[key];
                    if (child) {
                        traverseOctree(child, visibleNodesMap, depth + 1);
                    }
                }
            }
        };

        // Build a map of visible node names to their scene nodes for quick lookup
        const visibleNodesMap = new Map();
        if (this.viewer.potreeViewer && this.viewer.potreeViewer.scene) {
            const potreeScene = this.viewer.potreeViewer.scene;
            if (potreeScene.pointclouds && potreeScene.pointclouds.length > 0) {
                for (const pc of potreeScene.pointclouds) {
                    if (pc.visibleNodes) {
                        for (const vn of pc.visibleNodes) {
                            if (vn.sceneNode && vn.name) {
                                visibleNodesMap.set(vn.name, vn.sceneNode);
                            }
                        }
                    }
                }
            }
        }

        // Start hierarchical traversal from octree root
        let usedHierarchicalTraversal = false;
        if (pc && pc.pcoGeometry && pc.pcoGeometry.root) {
            traverseOctree(pc.pcoGeometry.root, visibleNodesMap);
            usedHierarchicalTraversal = true;
        } else if (pc && pc.root) {
            traverseOctree(pc.root, visibleNodesMap);
            usedHierarchicalTraversal = true;
        }

        // Fallback: if no octree structure available, use flat iteration
        if (!usedHierarchicalTraversal) {
            const nodes = this.getLoadedNodes();
            for (const nodeData of nodes) {
                const { sceneNode, octreeBoundingBox, name } = nodeData;
                const worldBbox = toWorldBbox(octreeBoundingBox);

                if (!bboxIntersectsQuery(worldBbox)) {
                    stats.nodesCulled++;
                    continue;
                }

                processNodePoints(sceneNode, name);
            }
        }

        // Update or create highlight points
        this.updateOverlayPoints(
            'highlight',
            highlightPositions,
            0xaaffaa,  // Light green/white - brighter
            0.1,
            0.95
        );

        // Update or create shadow points
        this.updateOverlayPoints(
            'shadow',
            shadowPositions,
            0x111111,  // Very dark - shadow effect
            0.08,
            0.8
        );

        // Log periodically
        if (!this._overlayUpdateCount) this._overlayUpdateCount = 0;
        this._overlayUpdateCount++;
        if (this._overlayUpdateCount % 60 === 1) {
            const method = usedHierarchicalTraversal ? 'hierarchical' : 'flat';
            console.log(`Overlay (${method}): ${highlightPositions.length / 3} highlight, ${shadowPositions.length / 3} shadow | Checked ${stats.nodesChecked} nodes, ${stats.subtreesCulled} subtrees culled, ${stats.pointsChecked.toLocaleString()} points | Brush at (${brushX.toFixed(1)}, ${brushY.toFixed(1)}, ${brushZ.toFixed(1)})`);

            // If nothing found and we checked nodes, log debug info
            if (highlightPositions.length === 0 && shadowPositions.length === 0 && stats.nodesChecked > 0) {
                console.log(`No points in brush! visibleNodesMap has ${visibleNodesMap.size} entries`);
            }
        }
    }

    /**
     * Log octree bounding boxes at different levels to verify coordinate system
     */
    logOctreeBoundingBoxes() {
        const pc = this.viewer.potreePointCloud;
        if (!pc) {
            console.log('No potreePointCloud available');
            return;
        }

        const pcOffset = pc.position ?
            { x: pc.position.x, y: pc.position.y, z: pc.position.z } :
            { x: 0, y: 0, z: 0 };

        console.log(`Point cloud position offset: (${pcOffset.x.toFixed(1)}, ${pcOffset.y.toFixed(1)}, ${pcOffset.z.toFixed(1)})`);
        console.log(`NOTE: Brush at positive X will miss data if point cloud only has data in negative X region!`);

        // Log the main point cloud's bounding box
        if (pc.boundingBox) {
            const bb = pc.boundingBox;
            console.log(`Point cloud boundingBox (local): X[${bb.min.x.toFixed(1)}, ${bb.max.x.toFixed(1)}] Y[${bb.min.y.toFixed(1)}, ${bb.max.y.toFixed(1)}] Z[${bb.min.z.toFixed(1)}, ${bb.max.z.toFixed(1)}]`);
            console.log(`Point cloud boundingBox (world): X[${(bb.min.x + pcOffset.x).toFixed(1)}, ${(bb.max.x + pcOffset.x).toFixed(1)}] Y[${(bb.min.y + pcOffset.y).toFixed(1)}, ${(bb.max.y + pcOffset.y).toFixed(1)}] Z[${(bb.min.z + pcOffset.z).toFixed(1)}, ${(bb.max.z + pcOffset.z).toFixed(1)}]`);
        }

        // Try to access Potree's octree structure
        if (pc.pcoGeometry && pc.pcoGeometry.root) {
            console.log('Potree octree structure found');
            console.log('Root children keys:', Object.keys(pc.pcoGeometry.root.children || {}));
            this.logOctreeNode(pc.pcoGeometry.root, 0, pcOffset, 3);
        } else if (pc.root) {
            console.log('Potree root node found');
            console.log('Root children keys:', Object.keys(pc.root.children || {}));
            this.logOctreeNode(pc.root, 0, pcOffset, 3);
        }

        // Also check visibleNodes
        if (pc.visibleNodes && pc.visibleNodes.length > 0) {
            console.log(`Visible nodes: ${pc.visibleNodes.length}`);
            // Group by name length (proxy for level)
            const byLevel = {};
            for (const vn of pc.visibleNodes) {
                const name = vn.name || 'unnamed';
                const level = name.length;
                if (!byLevel[level]) byLevel[level] = [];
                byLevel[level].push(vn);
            }

            for (const level of Object.keys(byLevel).sort((a,b) => a - b).slice(0, 3)) {
                const nodes = byLevel[level];
                console.log(`  Level ${level}: ${nodes.length} nodes`);
                for (const vn of nodes.slice(0, 4)) {
                    if (vn.boundingBox) {
                        const bb = vn.boundingBox;
                        console.log(`    ${vn.name}: local X[${bb.min.x.toFixed(1)}, ${bb.max.x.toFixed(1)}] Y[${bb.min.y.toFixed(1)}, ${bb.max.y.toFixed(1)}] Z[${bb.min.z.toFixed(1)}, ${bb.max.z.toFixed(1)}]`);
                        console.log(`    ${vn.name}: world X[${(bb.min.x + pcOffset.x).toFixed(1)}, ${(bb.max.x + pcOffset.x).toFixed(1)}] Y[${(bb.min.y + pcOffset.y).toFixed(1)}, ${(bb.max.y + pcOffset.y).toFixed(1)}] Z[${(bb.min.z + pcOffset.z).toFixed(1)}, ${(bb.max.z + pcOffset.z).toFixed(1)}]`);
                    } else if (vn.sceneNode && vn.sceneNode.geometry && vn.sceneNode.geometry.boundingBox) {
                        const bb = vn.sceneNode.geometry.boundingBox;
                        console.log(`    ${vn.name}: geom local X[${bb.min.x.toFixed(1)}, ${bb.max.x.toFixed(1)}] Y[${bb.min.y.toFixed(1)}, ${bb.max.y.toFixed(1)}] Z[${bb.min.z.toFixed(1)}, ${bb.max.z.toFixed(1)}]`);
                        console.log(`    ${vn.name}: geom world X[${(bb.min.x + pcOffset.x).toFixed(1)}, ${(bb.max.x + pcOffset.x).toFixed(1)}] Y[${(bb.min.y + pcOffset.y).toFixed(1)}, ${(bb.max.y + pcOffset.y).toFixed(1)}] Z[${(bb.min.z + pcOffset.z).toFixed(1)}, ${(bb.max.z + pcOffset.z).toFixed(1)}]`);
                    }
                }
            }
        }
    }

    logOctreeNode(node, level, offset, maxLevel) {
        if (level > maxLevel) return;

        const indent = '  '.repeat(level);
        const name = node.name || `level${level}`;

        if (node.boundingBox) {
            const bb = node.boundingBox;
            console.log(`${indent}${name}: local X[${bb.min.x.toFixed(1)}, ${bb.max.x.toFixed(1)}] Y[${bb.min.y.toFixed(1)}, ${bb.max.y.toFixed(1)}] Z[${bb.min.z.toFixed(1)}, ${bb.max.z.toFixed(1)}]`);
            console.log(`${indent}${name}: world X[${(bb.min.x + offset.x).toFixed(1)}, ${(bb.max.x + offset.x).toFixed(1)}] Y[${(bb.min.y + offset.y).toFixed(1)}, ${(bb.max.y + offset.y).toFixed(1)}] Z[${(bb.min.z + offset.z).toFixed(1)}, ${(bb.max.z + offset.z).toFixed(1)}]`);
        }

        // Check for children - Potree uses a dictionary with octant indices (0-7) as keys
        if (node.children && typeof node.children === 'object') {
            for (const key of Object.keys(node.children)) {
                const child = node.children[key];
                if (child) {
                    this.logOctreeNode(child, level + 1, offset, maxLevel);
                }
            }
        }
    }

    /**
     * Log point cloud bounds to understand coordinate system
     */
    logPointCloudBounds(nodes) {
        let globalMin = { x: Infinity, y: Infinity, z: Infinity };
        let globalMax = { x: -Infinity, y: -Infinity, z: -Infinity };
        let totalPoints = 0;
        let samplePoints = [];

        for (const nodeData of nodes) {
            const positionData = this.getNodePositionData(nodeData.sceneNode);
            if (!positionData) continue;

            const { positions, pointCount, offset } = positionData;
            totalPoints += pointCount;

            // Sample a few points from this node
            for (let i = 0; i < Math.min(10, pointCount); i++) {
                const idx = Math.floor(i * pointCount / 10);
                const px = positions[idx * 3] + offset.x;
                const py = positions[idx * 3 + 1] + offset.y;
                const pz = positions[idx * 3 + 2] + offset.z;

                if (samplePoints.length < 5) {
                    samplePoints.push({ x: px, y: py, z: pz });
                }

                if (px < globalMin.x) globalMin.x = px;
                if (px > globalMax.x) globalMax.x = px;
                if (py < globalMin.y) globalMin.y = py;
                if (py > globalMax.y) globalMax.y = py;
                if (pz < globalMin.z) globalMin.z = pz;
                if (pz > globalMax.z) globalMax.z = pz;
            }

            // Only sample from first 50 nodes for performance
            if (totalPoints > 100000) break;
        }

        console.log(`Point cloud bounds:`);
        console.log(`  X: ${globalMin.x.toFixed(1)} to ${globalMax.x.toFixed(1)}`);
        console.log(`  Y: ${globalMin.y.toFixed(1)} to ${globalMax.y.toFixed(1)}`);
        console.log(`  Z: ${globalMin.z.toFixed(1)} to ${globalMax.z.toFixed(1)}`);
        console.log(`  Sample points:`, samplePoints.map(p => `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`).join(', '));
        console.log(`  Camera position:`, this.viewer.camera?.position);
    }

    /**
     * Get bounding box for a node from Potree's octree structure
     * Always returns bbox in WORLD coordinates (using root point cloud offset)
     */
    getNodeBoundingBox(node, positions, offset) {
        // Get the root point cloud offset (same as used for points)
        const pc = this.viewer.potreePointCloud;
        const pcOffset = pc && pc.position ?
            { x: pc.position.x, y: pc.position.y, z: pc.position.z } :
            { x: 0, y: 0, z: 0 };

        // Check geometry's bounding box first (most reliable for actual point extent)
        if (node.geometry && node.geometry.boundingBox) {
            const bb = node.geometry.boundingBox;
            return {
                min: { x: bb.min.x + pcOffset.x, y: bb.min.y + pcOffset.y, z: bb.min.z + pcOffset.z },
                max: { x: bb.max.x + pcOffset.x, y: bb.max.y + pcOffset.y, z: bb.max.z + pcOffset.z }
            };
        }

        // Potree nodes may have boundingBox on the node itself
        if (node.boundingBox) {
            const bb = node.boundingBox;
            return {
                min: { x: bb.min.x + pcOffset.x, y: bb.min.y + pcOffset.y, z: bb.min.z + pcOffset.z },
                max: { x: bb.max.x + pcOffset.x, y: bb.max.y + pcOffset.y, z: bb.max.z + pcOffset.z }
            };
        }

        // Try to compute bounding box if not available
        if (node.geometry && !node.geometry.boundingBox) {
            node.geometry.computeBoundingBox();
            if (node.geometry.boundingBox) {
                const bb = node.geometry.boundingBox;
                return {
                    min: { x: bb.min.x + pcOffset.x, y: bb.min.y + pcOffset.y, z: bb.min.z + pcOffset.z },
                    max: { x: bb.max.x + pcOffset.x, y: bb.max.y + pcOffset.y, z: bb.max.z + pcOffset.z }
                };
            }
        }

        // No bounding box available - return null to skip culling for this node
        return null;
    }

    updateOverlayPoints(type, positions, color, size, opacity) {
        const scene = this.viewer.scene;

        // Get or create geometry and points based on type
        let geometry, points;
        if (type === 'highlight') {
            geometry = this.highlightGeometry;
            points = this.highlightPoints;
        } else if (type === 'shadow') {
            geometry = this.shadowGeometry;
            points = this.shadowPoints;
        } else if (type === 'selection') {
            geometry = this.selectionGeometry;
            points = this.selectionPoints;
        }

        if (positions.length === 0) {
            // Hide if no points
            if (points) points.visible = false;
            return;
        }

        if (!geometry) {
            // Create new geometry
            geometry = new THREE.BufferGeometry();
            const material = new THREE.PointsMaterial({
                color: color,
                size: size,
                transparent: true,
                opacity: opacity,
                depthTest: true,
                depthWrite: false,
                sizeAttenuation: true
            });
            points = new THREE.Points(geometry, material);
            points.name = `edit_${type}_overlay`;
            points.renderOrder = type === 'selection' ? 1001 : (type === 'highlight' ? 1000 : 999);
            scene.add(points);

            if (type === 'highlight') {
                this.highlightGeometry = geometry;
                this.highlightPoints = points;
            } else if (type === 'shadow') {
                this.shadowGeometry = geometry;
                this.shadowPoints = points;
            } else if (type === 'selection') {
                this.selectionGeometry = geometry;
                this.selectionPoints = points;
            }
        }

        // Update positions
        const posArray = new Float32Array(positions);
        geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        geometry.attributes.position.needsUpdate = true;
        geometry.computeBoundingSphere();

        points.visible = true;
    }

    clearOverlayPoints() {
        if (this.highlightPoints) {
            this.highlightPoints.visible = false;
        }
        if (this.shadowPoints) {
            this.shadowPoints.visible = false;
        }
        if (this.selectionPoints) {
            this.selectionPoints.visible = false;
        }
    }

    paintSelection() {
        const brushSphere = new THREE.Sphere(this.brushPosition, this.brushRadius);

        // Get all loaded point cloud nodes
        const nodes = this.getLoadedNodes();

        if (nodes.length === 0) {
            console.warn('No nodes loaded for selection');
            return;
        }

        let newSelections = [];

        for (const nodeData of nodes) {
            const { sceneNode, name } = nodeData;

            // Get position data - handle both standard Three.js and Potree formats
            const positionData = this.getNodePositionData(sceneNode);
            if (!positionData) continue;

            const { positions, pointCount, offset } = positionData;

            for (let i = 0; i < pointCount; i++) {
                const point = new THREE.Vector3(
                    positions[i * 3] + offset.x,
                    positions[i * 3 + 1] + offset.y,
                    positions[i * 3 + 2] + offset.z
                );

                if (brushSphere.containsPoint(point)) {
                    const nodeName = name;

                    if (!this.selectedPoints.has(nodeName)) {
                        this.selectedPoints.set(nodeName, new Set());
                    }

                    if (!this.selectedPoints.get(nodeName).has(i)) {
                        this.selectedPoints.get(nodeName).add(i);
                        newSelections.push({ nodeName, index: i });
                    }
                }
            }
        }

        if (newSelections.length > 0) {
            console.log(`Selected ${newSelections.length} new points, total: ${this.countSelectedPoints()}`);
            this.selectionCount = this.countSelectedPoints();
            this.updateSelectionVisuals();
            this.updateSelectionStatus();
        }
    }

    /**
     * Extract position data from a node, handling both standard Three.js Points and Potree nodes
     * Gets offset from the root point cloud's position
     */
    getNodePositionData(node) {
        let positions = null;
        let pointCount = 0;
        let offset = { x: 0, y: 0, z: 0 };

        // Standard Three.js Points with BufferGeometry
        if (node.geometry && node.geometry.attributes && node.geometry.attributes.position) {
            positions = node.geometry.attributes.position.array;
            pointCount = positions.length / 3;

            // Get offset from the root potreePointCloud position
            // This is set in loadPotreePointCloud as pointcloud.position.set(-centerX, -centerY, -bbox.min.z)
            const pc = this.viewer.potreePointCloud;
            if (pc && pc.position) {
                offset.x = pc.position.x;
                offset.y = pc.position.y;
                offset.z = pc.position.z;
            }

            return { positions, pointCount, offset };
        }

        // Potree PointCloudOctree - check if it has visibleNodes
        if (node.visibleNodes && node.visibleNodes.length > 0) {
            // For Potree, we need to iterate through visible nodes
            // This is handled at the caller level
            return null;
        }

        return null;
    }

    /**
     * Get loaded nodes with their octree bounding boxes.
     * Returns an array of objects with { sceneNode, octreeBoundingBox, name }
     * The octreeBoundingBox comes from Potree's visibleNodes and is the correct
     * bounding box for spatial queries (not the geometry's computed bbox).
     */
    getLoadedNodes() {
        const nodes = [];
        const addedUuids = new Set(); // Track to avoid duplicates

        // Helper to add a node if valid
        const addNode = (sceneNode, name, octreeBbox) => {
            if (!sceneNode || addedUuids.has(sceneNode.uuid)) return;

            // Check for geometry with position attribute
            const hasGeometry = sceneNode.geometry && sceneNode.geometry.attributes && sceneNode.geometry.attributes.position;

            if (hasGeometry) {
                if (name && !sceneNode.name) sceneNode.name = name;
                nodes.push({
                    sceneNode: sceneNode,
                    octreeBoundingBox: octreeBbox,  // May be null for non-Potree nodes
                    name: name || sceneNode.name || sceneNode.uuid
                });
                addedUuids.add(sceneNode.uuid);
            }
        };

        // 1. Check for Potree nodes stored in viewer.potreeNodes Map (our custom LOD loader)
        if (this.viewer.potreeNodes && this.viewer.potreeNodes.size > 0) {
            for (const [name, pointsObj] of this.viewer.potreeNodes) {
                addNode(pointsObj, name, null);
            }
        }

        // 2. Check for regular Three.js point clouds (upload mode)
        if (this.viewer.currentPointCloud) {
            addNode(this.viewer.currentPointCloud, 'currentPointCloud', null);
        }

        // 3. Check Potree viewer's scene for point clouds - this is the main path
        // IMPORTANT: Use visibleNodes and get the octree bounding box from each node
        if (this.viewer.potreeViewer && this.viewer.potreeViewer.scene) {
            const potreeScene = this.viewer.potreeViewer.scene;

            if (potreeScene.pointclouds && potreeScene.pointclouds.length > 0) {
                for (const pc of potreeScene.pointclouds) {
                    // Use visibleNodes - each has both sceneNode and boundingBox
                    if (pc.visibleNodes && pc.visibleNodes.length > 0) {
                        for (const visibleNode of pc.visibleNodes) {
                            if (visibleNode.sceneNode) {
                                // Pass the octree bounding box from the visible node
                                // This is the correct bbox for spatial queries
                                addNode(
                                    visibleNode.sceneNode,
                                    visibleNode.name || `potree_${visibleNode.id}`,
                                    visibleNode.boundingBox  // Octree bbox, not geometry bbox!
                                );
                            }
                        }
                    }
                }
            }
        }

        // 4. Scan the Three.js scene for any Points objects we might have missed
        const scene = this.viewer.scene;
        if (scene) {
            scene.traverse((obj) => {
                if (obj.type === 'Points') {
                    // Skip our edit overlay points
                    if (obj.name && obj.name.startsWith('edit_')) return;
                    addNode(obj, obj.name || `scene_points_${obj.uuid.slice(0,8)}`, null);
                }
            });
        }

        // 5. If Potree viewer exists, also scan its renderer's scene
        if (this.viewer.potreeViewer && this.viewer.potreeViewer.renderer) {
            const potreeRendererScene = this.viewer.potreeViewer.scene.scene;
            if (potreeRendererScene && potreeRendererScene !== scene) {
                potreeRendererScene.traverse((obj) => {
                    if (obj.type === 'Points') {
                        // Skip our edit overlay points
                        if (obj.name && obj.name.startsWith('edit_')) return;
                        addNode(obj, obj.name || `potree_scene_${obj.uuid.slice(0,8)}`, null);
                    }
                });
            }
        }

        // Debug logging
        if (nodes.length === 0) {
            console.log('getLoadedNodes: No nodes found. Diagnostics:');
            console.log('  viewer.potreeNodes:', this.viewer.potreeNodes?.size || 0, 'entries');
            console.log('  viewer.currentPointCloud:', !!this.viewer.currentPointCloud);
            console.log('  viewer.potreeViewer:', !!this.viewer.potreeViewer);
            if (this.viewer.potreeViewer) {
                const pvs = this.viewer.potreeViewer.scene;
                console.log('  potreeViewer.scene.pointclouds:', pvs?.pointclouds?.length || 0);
                if (pvs?.pointclouds?.length > 0) {
                    const pc = pvs.pointclouds[0];
                    console.log('  First pointcloud visibleNodes:', pc.visibleNodes?.length || 0);
                }
            }
        } else {
            const withOctreeBbox = nodes.filter(n => n.octreeBoundingBox).length;
            console.log(`getLoadedNodes: Found ${nodes.length} nodes (${withOctreeBbox} with octree bbox)`);
        }

        return nodes;
    }

    updateSelectionVisuals() {
        // Create overlay points for selected points (since we can't modify Potree colors)
        const nodes = this.getLoadedNodes();
        const selectedPositions = [];

        for (const nodeData of nodes) {
            const { sceneNode, name } = nodeData;
            const selectedIndices = this.selectedPoints.get(name);

            if (!selectedIndices || selectedIndices.size === 0) continue;

            const positionData = this.getNodePositionData(sceneNode);
            if (!positionData) continue;

            const { positions, offset } = positionData;

            for (const idx of selectedIndices) {
                const px = positions[idx * 3] + offset.x;
                const py = positions[idx * 3 + 1] + offset.y;
                const pz = positions[idx * 3 + 2] + offset.z;
                selectedPositions.push(px, py, pz);
            }
        }

        // Update or create selection overlay
        this.updateOverlayPoints(
            'selection',
            selectedPositions,
            0x44ff44,  // Bright green for selected
            0.12,      // Larger than normal points
            1.0        // Fully opaque
        );
    }

    restorePointColors(nodeName, indices) {
        const nodes = this.getLoadedNodes();
        const nodeData = nodes.find(n => n.name === nodeName);

        if (!nodeData || !nodeData.sceneNode.userData.originalColors) return;

        const node = nodeData.sceneNode;
        const colors = node.geometry.attributes.color;
        if (!colors) return;

        for (const idx of indices) {
            colors.array[idx * 3] = node.userData.originalColors[idx * 3];
            colors.array[idx * 3 + 1] = node.userData.originalColors[idx * 3 + 1];
            colors.array[idx * 3 + 2] = node.userData.originalColors[idx * 3 + 2];
        }
        colors.needsUpdate = true;
    }

    clearSelection() {
        // Restore original colors
        for (const [nodeName, indices] of this.selectedPoints) {
            this.restorePointColors(nodeName, indices);
        }

        this.selectedPoints.clear();
        this.selectionCount = 0;
        this.updateSelectionStatus();
        console.log('Selection cleared');
    }

    deleteSelectedPoints() {
        if (this.selectionCount === 0) {
            console.log('No points selected to delete');
            return;
        }

        // Save state for undo
        const deletedPoints = new Map();
        for (const [nodeName, indices] of this.selectedPoints) {
            deletedPoints.set(nodeName, new Set(indices));
        }

        this.undoStack.push({
            type: 'delete',
            points: deletedPoints,
            timestamp: Date.now()
        });
        this.redoStack = []; // Clear redo stack on new action

        // Actually delete points by setting their position to infinity (hide them)
        const nodes = this.getLoadedNodes();

        for (const nodeData of nodes) {
            const { sceneNode, name } = nodeData;
            const selectedIndices = this.selectedPoints.get(name);

            if (!selectedIndices || selectedIndices.size === 0) continue;

            // Store deletion info on node
            if (!sceneNode.userData.deletedPoints) {
                sceneNode.userData.deletedPoints = new Set();
            }

            // Mark points as deleted
            for (const idx of selectedIndices) {
                sceneNode.userData.deletedPoints.add(idx);
            }

            // Hide deleted points by moving to infinity
            const positions = sceneNode.geometry.attributes.position;
            for (const idx of selectedIndices) {
                positions.array[idx * 3] = Infinity;
                positions.array[idx * 3 + 1] = Infinity;
                positions.array[idx * 3 + 2] = Infinity;
            }
            positions.needsUpdate = true;
        }

        console.log(`Deleted ${this.selectionCount} points`);

        this.selectedPoints.clear();
        this.selectionCount = 0;
        this.updateSelectionStatus();
    }

    undo() {
        if (this.undoStack.length === 0) {
            console.log('Nothing to undo');
            return;
        }

        const action = this.undoStack.pop();
        this.redoStack.push(action);

        if (action.type === 'delete') {
            // Restore deleted points
            const nodes = this.getLoadedNodes();

            for (const nodeData of nodes) {
                const { sceneNode, name } = nodeData;
                const deletedIndices = action.points.get(name);

                if (!deletedIndices || deletedIndices.size === 0) continue;

                // Restore positions from original data if available
                const positions = sceneNode.geometry.attributes.position;

                // We need original positions - store them when loading nodes
                if (sceneNode.userData.originalPositions) {
                    for (const idx of deletedIndices) {
                        positions.array[idx * 3] = sceneNode.userData.originalPositions[idx * 3];
                        positions.array[idx * 3 + 1] = sceneNode.userData.originalPositions[idx * 3 + 1];
                        positions.array[idx * 3 + 2] = sceneNode.userData.originalPositions[idx * 3 + 2];

                        // Remove from deleted set
                        if (sceneNode.userData.deletedPoints) {
                            sceneNode.userData.deletedPoints.delete(idx);
                        }
                    }
                    positions.needsUpdate = true;
                }

                // Restore colors
                this.restorePointColors(name, deletedIndices);
            }

            console.log(`Undo: Restored ${this.countPoints(action.points)} points`);
        }

        this.updateSelectionStatus();
    }

    redo() {
        if (this.redoStack.length === 0) {
            console.log('Nothing to redo');
            return;
        }

        const action = this.redoStack.pop();
        this.undoStack.push(action);

        if (action.type === 'delete') {
            // Re-delete points
            const nodes = this.getLoadedNodes();

            for (const nodeData of nodes) {
                const { sceneNode, name } = nodeData;
                const deletedIndices = action.points.get(name);

                if (!deletedIndices || deletedIndices.size === 0) continue;

                // Mark points as deleted again
                if (!sceneNode.userData.deletedPoints) {
                    sceneNode.userData.deletedPoints = new Set();
                }

                const positions = sceneNode.geometry.attributes.position;
                for (const idx of deletedIndices) {
                    sceneNode.userData.deletedPoints.add(idx);
                    positions.array[idx * 3] = Infinity;
                    positions.array[idx * 3 + 1] = Infinity;
                    positions.array[idx * 3 + 2] = Infinity;
                }
                positions.needsUpdate = true;
            }

            console.log(`Redo: Deleted ${this.countPoints(action.points)} points`);
        }

        this.updateSelectionStatus();
    }

    countSelectedPoints() {
        let count = 0;
        for (const indices of this.selectedPoints.values()) {
            count += indices.size;
        }
        return count;
    }

    countPoints(pointsMap) {
        let count = 0;
        for (const indices of pointsMap.values()) {
            count += indices.size;
        }
        return count;
    }

    updateSelectionStatus() {
        const statusEl = document.getElementById('selectionStatus');
        if (statusEl) {
            statusEl.textContent = this.selectionCount > 0
                ? `${this.selectionCount.toLocaleString()} points selected`
                : 'No selection';
        }

        const undoCountEl = document.getElementById('undoCount');
        if (undoCountEl) {
            undoCountEl.textContent = this.undoStack.length;
        }

        // Update node/point statistics
        this.updateNodeStats();
    }

    updateNodeStats() {
        const nodes = this.getLoadedNodes();
        let totalPoints = 0;

        for (const nodeData of nodes) {
            const positionData = this.getNodePositionData(nodeData.sceneNode);
            if (positionData) {
                totalPoints += positionData.pointCount;
            }
        }

        const nodesCountEl = document.getElementById('loadedNodesCount');
        if (nodesCountEl) {
            nodesCountEl.textContent = nodes.length.toLocaleString();
        }

        const pointsCountEl = document.getElementById('totalPointsCount');
        if (pointsCountEl) {
            pointsCountEl.textContent = totalPoints.toLocaleString();
        }
    }

    updateBrushStatus() {
        const brushSizeEl = document.getElementById('brushSize');
        if (brushSizeEl) {
            brushSizeEl.textContent = (this.brushRadius * 2).toFixed(2) + 'm';
        }
    }

    updateEditModeUI() {
        const editModeBtn = document.getElementById('editModeBtn');
        if (editModeBtn) {
            editModeBtn.classList.toggle('active', this.editModeActive);
            editModeBtn.textContent = this.editModeActive ? 'Exit Edit Mode (T)' : 'Enter Edit Mode (T)';
        }

        const editStatusEl = document.getElementById('editStatus');
        if (editStatusEl) {
            editStatusEl.textContent = this.editModeActive ? 'EDIT MODE' : '';
            editStatusEl.style.display = this.editModeActive ? 'block' : 'none';
        }
    }

    // Store original positions when nodes are loaded (call from viewer)
    storeOriginalPositions(node) {
        if (node.geometry && node.geometry.attributes.position) {
            node.userData.originalPositions = new Float32Array(
                node.geometry.attributes.position.array
            );
        }
        if (node.geometry && node.geometry.attributes.color) {
            node.userData.originalColors = new Float32Array(
                node.geometry.attributes.color.array
            );
        }
    }

    // Get deletion state for serialization
    getDeletedPointsData() {
        const data = {};
        const nodes = this.getLoadedNodes();

        for (const nodeData of nodes) {
            const { sceneNode, name } = nodeData;
            if (sceneNode.userData.deletedPoints && sceneNode.userData.deletedPoints.size > 0) {
                data[name] = Array.from(sceneNode.userData.deletedPoints);
            }
        }

        return data;
    }

    // Restore deletion state (for loading saved edits)
    setDeletedPointsData(data) {
        const nodes = this.getLoadedNodes();

        for (const nodeData of nodes) {
            const { sceneNode, name } = nodeData;
            if (data[name]) {
                sceneNode.userData.deletedPoints = new Set(data[name]);

                // Apply deletion visually
                const positions = sceneNode.geometry.attributes.position;
                for (const idx of sceneNode.userData.deletedPoints) {
                    positions.array[idx * 3] = Infinity;
                    positions.array[idx * 3 + 1] = Infinity;
                    positions.array[idx * 3 + 2] = Infinity;
                }
                positions.needsUpdate = true;
            }
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SelectionManager;
}
