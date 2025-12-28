        class PointCloudViewer {
            constructor() {
                this.scene = null;
                this.camera = null;
                this.renderer = null;
                this.controls = null;
                this.currentPointCloud = null;
                this.selectedObject = null;
                this.slices = [];
                this.selectedSlice = null;
                this.isCreatingSlice = false;
                this.sliceStartPoint = null;
                this.sliceCanvas = null;
                this.sliceCanvasCtx = null;
                
                // 2D slice view camera parameters
                this.sliceViewZoom = 1.0;
                this.sliceViewPanX = 0;
                this.sliceViewPanY = 0;
                this.isDraggingSliceView = false;
                this.lastSliceMousePos = { x: 0, y: 0 };

                this.clock = new THREE.Clock();  // For Potree viewer

                this.keys = {
                    w: false,
                    a: false,
                    s: false,
                    d: false,
                    q: false,
                    e: false,
                    y: false,
                    z: false,
                    c: false,
                    shift: false
                };

                this.currentLODDepth = 0; // Current LOD depth (0 = root only)
                
                this.init();
                this.setupEventListeners();
                this.setupWalkControls();
                this.setupSliceTool();
                this.setupSliceView();
                this.setupSelectionManager(); // Initialize selection/edit system
                this.checkConfigAndLoad(); // Check mode and load accordingly
                this.updateHierarchy();
            }
            
            init() {
                // Initialize with basic Three.js setup
                // This will be replaced by Potree.Viewer in Potree mode
                this.scene = new THREE.Scene();
                this.scene.background = new THREE.Color(0x1a1a1a);

                const viewportWidth = this.getViewportWidth();
                const viewportHeight = this.getViewportHeight();

                this.camera = new THREE.PerspectiveCamera(75, viewportWidth / viewportHeight, 0.1, 1000);
                this.camera.position.set(-5, -5, 1.7);
                this.camera.up.set(0, 0, 1);

                this.renderer = new THREE.WebGLRenderer({ antialias: true });
                this.renderer.setSize(viewportWidth, viewportHeight);
                this.renderer.setPixelRatio(window.devicePixelRatio);
                document.getElementById('viewer').appendChild(this.renderer.domElement);

                this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
                this.controls.enableDamping = true;
                this.controls.dampingFactor = 0.1;

                // Lighting
                const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
                this.scene.add(ambientLight);

                const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
                directionalLight.position.set(10, 10, 5);
                this.scene.add(directionalLight);

                // Start render loop
                this.animate();

                // Handle window resize
                window.addEventListener('resize', () => this.onWindowResize());
            }
            
            setupEventListeners() {
                const uploadBtn = document.getElementById('uploadBtn');
                const fileInput = document.getElementById('fileInput');
                
                uploadBtn.addEventListener('click', () => this.uploadFile());
                fileInput.addEventListener('change', (e) => {
                    if (e.target.files.length > 0) {
                        uploadBtn.textContent = `Upload ${e.target.files[0].name}`;
                    }
                });
            }
            
            setupWalkControls() {
                // Keyboard event listeners
                window.addEventListener('keydown', (event) => {
                    switch(event.code) {
                        case 'KeyW':
                            this.keys.w = true;
                            break;
                        case 'KeyA':
                            this.keys.a = true;
                            break;
                        case 'KeyS':
                            this.keys.s = true;
                            break;
                        case 'KeyD':
                            this.keys.d = true;
                            break;
                        case 'KeyQ':
                            this.keys.q = true;
                            break;
                        case 'KeyE':
                            this.keys.e = true;
                            break;
                        case 'KeyY':
                            this.keys.y = true;
                            break;
                        case 'KeyZ':
                            this.keys.z = true;
                            break;
                        case 'KeyC':
                            this.keys.c = true;
                            break;
                        case 'KeyF':
                            this.keys.f = true;
                            break;
                        case 'KeyV':
                            this.keys.v = true;
                            break;
                        case 'ShiftLeft':
                        case 'ShiftRight':
                            this.keys.shift = true;
                            break;
                        case 'KeyM':
                            // Increase LOD depth (more detail)
                            this.increaseLODDepth();
                            break;
                        case 'KeyN':
                            // Decrease LOD depth (less detail)
                            this.decreaseLODDepth();
                            break;
                    }
                });
                
                window.addEventListener('keyup', (event) => {
                    switch(event.code) {
                        case 'KeyW':
                            this.keys.w = false;
                            break;
                        case 'KeyA':
                            this.keys.a = false;
                            break;
                        case 'KeyS':
                            this.keys.s = false;
                            break;
                        case 'KeyD':
                            this.keys.d = false;
                            break;
                        case 'KeyQ':
                            this.keys.q = false;
                            break;
                        case 'KeyE':
                            this.keys.e = false;
                            break;
                        case 'KeyY':
                            this.keys.y = false;
                            break;
                        case 'KeyZ':
                            this.keys.z = false;
                            break;
                        case 'KeyC':
                            this.keys.c = false;
                            break;
                        case 'KeyF':
                            this.keys.f = false;
                            break;
                        case 'KeyV':
                            this.keys.v = false;
                            break;
                        case 'ShiftLeft':
                        case 'ShiftRight':
                            this.keys.shift = false;
                            break;
                    }
                });
            }
            
            handleWalkMovement() {
                const walkSpeed = 1.5; // 1.5 m/s walking speed
                const runSpeed = 4.0;  // 4 m/s running speed
                const frameRate = 60;  // Assume 60 FPS
                const baseSpeed = walkSpeed / frameRate; // Speed per frame
                const fastSpeed = runSpeed / frameRate;
                const moveSpeed = this.keys.shift ? fastSpeed : baseSpeed;

                if (!this.keys.w && !this.keys.a && !this.keys.s && !this.keys.d &&
                    !this.keys.q && !this.keys.e && !this.keys.y && !this.keys.z && !this.keys.c &&
                    !this.keys.f && !this.keys.v) {
                    return; // No movement keys pressed
                }

                // Get camera - use Potree camera if available
                const camera = this.potreeViewer ? this.potreeViewer.scene.getActiveCamera() : this.camera;
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
                const up = new THREE.Vector3(0, 0, 1); // World up direction (Z axis)
                
                // Calculate movement vector
                let movement = new THREE.Vector3();
                
                if (this.keys.w) { // Forward
                    movement.add(forward.clone().multiplyScalar(moveSpeed));
                }
                if (this.keys.s) { // Backward
                    movement.add(forward.clone().multiplyScalar(-moveSpeed));
                }
                if (this.keys.a) { // Left
                    movement.add(right.clone().multiplyScalar(-moveSpeed));
                }
                if (this.keys.d) { // Right
                    movement.add(right.clone().multiplyScalar(moveSpeed));
                }
                if (this.keys.y || this.keys.z) { // Up (both Y and Z for German keyboard)
                    movement.add(up.clone().multiplyScalar(moveSpeed));
                }
                if (this.keys.c) { // Down
                    movement.add(up.clone().multiplyScalar(-moveSpeed));
                }
                
                // Head rotation (left/right) - direct camera rotation for first-person view
                const rotationSpeed = 0.02;
                if (this.keys.q) { // Rotate left (yaw)
                    this.rotateCamera(rotationSpeed);
                }
                if (this.keys.e) { // Rotate right (yaw)
                    this.rotateCamera(-rotationSpeed);
                }

                // Pitch rotation (up/down) - look up/down
                if (this.keys.f) { // Pitch up
                    this.pitchCamera(rotationSpeed);
                }
                if (this.keys.v) { // Pitch down
                    this.pitchCamera(-rotationSpeed);
                }

                // Apply movement to camera
                camera.position.add(movement);

                // Update Potree view if using Potree viewer
                if (this.potreeViewer) {
                    this.potreeViewer.scene.view.position.copy(camera.position);
                } else {
                    // Update rotation target to stay 2m in front of camera
                    this.updateRotationTarget();
                    this.controls.update();
                }
            }
            
            updateRotationTarget() {
                // Set rotation target 2m in front of camera for natural first-person rotation
                const camera = this.camera;
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
                const targetPosition = camera.position.clone().add(forward.multiplyScalar(2.0));
                this.controls.target.copy(targetPosition);
            }
            
            rotateCamera(angle) {
                // Get the active camera
                const camera = this.potreeViewer ? this.potreeViewer.scene.getActiveCamera() : this.camera;

                // Rotate camera around its own Y axis (yaw) for first-person head rotation
                // Create rotation quaternion around world Z axis (since Z is up)
                const rotationQuaternion = new THREE.Quaternion();
                rotationQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);

                // Apply rotation to camera's current quaternion
                camera.quaternion.multiplyQuaternions(rotationQuaternion, camera.quaternion);

                // Update Potree view or rotation target
                if (this.potreeViewer) {
                    // Potree view may not have rotation property, use yaw instead
                    const view = this.potreeViewer.scene.view;
                    if (view && view.yaw !== undefined) {
                        view.yaw += angle;
                    }
                } else {
                    this.updateRotationTarget();
                }
            }

            pitchCamera(angle) {
                // Get the active camera
                const camera = this.potreeViewer ? this.potreeViewer.scene.getActiveCamera() : this.camera;

                // Get the camera's local right axis to rotate around (for pitch)
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);

                // Create rotation quaternion around the camera's right axis
                const rotationQuaternion = new THREE.Quaternion();
                rotationQuaternion.setFromAxisAngle(right, angle);

                // Apply rotation to camera's current quaternion
                camera.quaternion.multiplyQuaternions(rotationQuaternion, camera.quaternion);

                // Update Potree view or rotation target
                if (this.potreeViewer) {
                    // Potree view uses pitch property
                    const view = this.potreeViewer.scene.view;
                    if (view && view.pitch !== undefined) {
                        view.pitch += angle;
                        // Clamp pitch to prevent flipping (approximately -90 to +90 degrees)
                        view.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, view.pitch));
                    }
                } else {
                    this.updateRotationTarget();
                }
            }
            
            setupSliceTool() {
                const createSliceBtn = document.getElementById('createSliceBtn');
                const cancelSliceBtn = document.getElementById('cancelSliceBtn');
                const canvas = this.renderer.domElement;
                
                createSliceBtn.addEventListener('click', () => {
                    this.startSliceCreation();
                });
                
                cancelSliceBtn.addEventListener('click', () => {
                    this.cancelSliceCreation();
                });
                
                // Canvas event listeners for slice creation
                canvas.addEventListener('mousedown', (event) => {
                    if (this.isCreatingSlice && event.button === 0) {
                        const rect = canvas.getBoundingClientRect();
                        const mouse = new THREE.Vector2(
                            ((event.clientX - rect.left) / rect.width) * 2 - 1,
                            -((event.clientY - rect.top) / rect.height) * 2 + 1
                        );
                        
                        if (!this.sliceStartPoint) {
                            this.sliceStartPoint = mouse.clone();
                        } else {
                            this.createSliceFromLine(this.sliceStartPoint, mouse);
                            this.finishSliceCreation();
                        }
                        event.preventDefault();
                        event.stopPropagation();
                    }
                }, true);
            }
            
            startSliceCreation() {
                this.isCreatingSlice = true;
                this.sliceStartPoint = null;
                this.controls.enabled = false;
                
                document.getElementById('createSliceBtn').style.display = 'none';
                document.getElementById('cancelSliceBtn').style.display = 'inline-block';
                
                // Change cursor
                this.renderer.domElement.style.cursor = 'crosshair';
                
                this.showStatus('Click two points to define the slice line', 'info');
            }
            
            cancelSliceCreation() {
                this.isCreatingSlice = false;
                this.sliceStartPoint = null;
                this.controls.enabled = true;
                
                document.getElementById('createSliceBtn').style.display = 'inline-block';
                document.getElementById('cancelSliceBtn').style.display = 'none';
                
                // Reset cursor
                this.renderer.domElement.style.cursor = '';
                
                this.showStatus('Slice creation cancelled', 'info');
            }
            
            finishSliceCreation() {
                this.isCreatingSlice = false;
                this.sliceStartPoint = null;
                this.controls.enabled = true;
                
                document.getElementById('createSliceBtn').style.display = 'inline-block';
                document.getElementById('cancelSliceBtn').style.display = 'none';
                
                // Reset cursor
                this.renderer.domElement.style.cursor = '';
            }
            
            createSliceFromLine(startMouse, endMouse) {
                // Convert screen coordinates to world positions
                const raycaster = new THREE.Raycaster();
                const camera = this.camera;
                
                // Cast rays from both points
                raycaster.setFromCamera(startMouse, camera);
                const startRay = raycaster.ray.clone();
                
                raycaster.setFromCamera(endMouse, camera);
                const endRay = raycaster.ray.clone();
                
                // Find intersection with a plane at distance from camera
                const distance = 10; // Default intersection distance
                const startPoint = startRay.at(distance, new THREE.Vector3());
                const endPoint = endRay.at(distance, new THREE.Vector3());
                
                // Calculate slice plane
                const lineDirection = endPoint.clone().sub(startPoint).normalize();
                const viewDirection = camera.getWorldDirection(new THREE.Vector3());
                
                // Slice normal is perpendicular to both the line and view direction
                const sliceNormal = lineDirection.clone().cross(viewDirection).normalize();
                
                // Slice plane passes through the midpoint of the line
                const slicePoint = startPoint.clone().add(endPoint).multiplyScalar(0.5);
                
                // Create slice object
                const slice = {
                    id: Date.now(),
                    name: `Slice ${this.slices.length + 1}`,
                    point: slicePoint,
                    normal: sliceNormal,
                    lineStart: startPoint,
                    lineEnd: endPoint,
                    visible: true,
                    mesh: null
                };
                
                // Create visual representation
                this.createSliceVisualization(slice);
                
                // Add to slices array
                this.slices.push(slice);
                
                // Update UI
                this.updateSliceList();
                this.updateHierarchy();
                
                this.showStatus(`Created ${slice.name}`, 'success');
            }
            
            createSliceVisualization(slice) {
                // Create a plane mesh to visualize the slice
                const size = 20; // Size of the visualization plane
                const geometry = new THREE.PlaneGeometry(size, size);
                const material = new THREE.MeshBasicMaterial({
                    color: 0x2196F3,
                    transparent: true,
                    opacity: 0.3,
                    side: THREE.DoubleSide
                });
                
                const planeMesh = new THREE.Mesh(geometry, material);
                
                // Position and orient the plane
                planeMesh.position.copy(slice.point);
                planeMesh.lookAt(slice.point.clone().add(slice.normal));
                
                // Add wireframe outline
                const edges = new THREE.EdgesGeometry(geometry);
                const lineMaterial = new THREE.LineBasicMaterial({ color: 0x2196F3 });
                const wireframe = new THREE.LineSegments(edges, lineMaterial);
                
                // Create a group for the slice
                const sliceGroup = new THREE.Group();
                sliceGroup.add(planeMesh);
                sliceGroup.add(wireframe);
                sliceGroup.name = slice.name;
                sliceGroup.userData = { sliceId: slice.id, type: 'slice' };
                
                this.scene.add(sliceGroup);
                slice.mesh = sliceGroup;
            }
            
            updateSliceList() {
                const sliceList = document.getElementById('sliceList');
                sliceList.innerHTML = '';
                
                this.slices.forEach(slice => {
                    const item = document.createElement('div');
                    item.className = 'slice-item';
                    
                    // Add selected class if this slice is selected
                    if (this.selectedSlice && this.selectedSlice.id === slice.id) {
                        item.classList.add('selected');
                    }
                    
                    const name = document.createElement('span');
                    name.textContent = slice.name;
                    item.appendChild(name);
                    
                    // Add click handler for selection
                    name.addEventListener('click', () => {
                        this.selectSlice(slice.id);
                    });
                    name.style.cursor = 'pointer';
                    name.style.flex = '1';
                    
                    const actions = document.createElement('div');
                    actions.className = 'slice-actions';
                    
                    // Visibility toggle
                    const visibilityToggle = document.createElement('span');
                    visibilityToggle.className = 'slice-action';
                    visibilityToggle.textContent = slice.visible ? '👁️' : '🚫';
                    visibilityToggle.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.toggleSliceVisibility(slice.id);
                    });
                    actions.appendChild(visibilityToggle);
                    
                    // Delete button
                    const deleteBtn = document.createElement('span');
                    deleteBtn.className = 'slice-action';
                    deleteBtn.textContent = '🗑️';
                    deleteBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.deleteSlice(slice.id);
                    });
                    actions.appendChild(deleteBtn);
                    
                    item.appendChild(actions);
                    sliceList.appendChild(item);
                });
            }
            
            toggleSliceVisibility(sliceId) {
                const slice = this.slices.find(s => s.id === sliceId);
                if (slice) {
                    slice.visible = !slice.visible;
                    if (slice.mesh) {
                        slice.mesh.visible = slice.visible;
                    }
                    this.updateSliceList();
                    this.updateHierarchy();
                }
            }
            
            deleteSlice(sliceId) {
                const sliceIndex = this.slices.findIndex(s => s.id === sliceId);
                if (sliceIndex !== -1) {
                    const slice = this.slices[sliceIndex];
                    
                    // Remove from scene
                    if (slice.mesh) {
                        this.scene.remove(slice.mesh);
                    }
                    
                    // Remove from array
                    this.slices.splice(sliceIndex, 1);
                    
                    // Update UI
                    this.updateSliceList();
                    this.updateHierarchy();
                    
                    this.showStatus(`Deleted ${slice.name}`, 'info');
                }
            }
            
            showStatus(message, type) {
                const status = document.getElementById('status');
                status.textContent = message;
                status.className = type;
                status.style.display = 'block';
                
                setTimeout(() => {
                    status.style.display = 'none';
                }, 3000);
            }
            
            setupSliceView() {
                this.sliceCanvas = document.getElementById('sliceCanvas');
                this.sliceCanvasCtx = this.sliceCanvas.getContext('2d');
                
                // Set canvas size
                this.resizeSliceCanvas();
                
                // Add mouse event listeners for pan and zoom
                this.sliceCanvas.addEventListener('mousedown', (e) => this.onSliceMouseDown(e));
                this.sliceCanvas.addEventListener('mousemove', (e) => this.onSliceMouseMove(e));
                this.sliceCanvas.addEventListener('mouseup', (e) => this.onSliceMouseUp(e));
                this.sliceCanvas.addEventListener('wheel', (e) => this.onSliceWheel(e));
                this.sliceCanvas.addEventListener('mouseleave', (e) => this.onSliceMouseUp(e));
                
                // Handle window resize
                window.addEventListener('resize', () => {
                    this.resizeSliceCanvas();
                    if (this.selectedSlice) {
                        this.renderSliceView();
                    }
                });
            }
            
            onSliceMouseDown(e) {
                if (e.button === 0) { // Left mouse button
                    this.isDraggingSliceView = true;
                    this.lastSliceMousePos.x = e.clientX;
                    this.lastSliceMousePos.y = e.clientY;
                    this.sliceCanvas.style.cursor = 'grabbing';
                }
            }
            
            onSliceMouseMove(e) {
                if (this.isDraggingSliceView) {
                    const deltaX = e.clientX - this.lastSliceMousePos.x;
                    const deltaY = e.clientY - this.lastSliceMousePos.y;
                    
                    // Pan (move in opposite direction of mouse movement)
                    this.sliceViewPanX += deltaX / this.sliceViewZoom;
                    this.sliceViewPanY += deltaY / this.sliceViewZoom;
                    
                    this.lastSliceMousePos.x = e.clientX;
                    this.lastSliceMousePos.y = e.clientY;
                    
                    if (this.selectedSlice) {
                        this.renderSliceView();
                    }
                }
            }
            
            onSliceMouseUp(e) {
                this.isDraggingSliceView = false;
                this.sliceCanvas.style.cursor = 'grab';
            }
            
            onSliceWheel(e) {
                e.preventDefault();
                
                const zoomFactor = 1.1;
                const rect = this.sliceCanvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                // Get world coordinates of mouse position before zoom
                const worldXBefore = (mouseX - this.sliceViewPanX) / this.sliceViewZoom;
                const worldYBefore = (mouseY - this.sliceViewPanY) / this.sliceViewZoom;
                
                // Apply zoom
                if (e.deltaY < 0) {
                    this.sliceViewZoom *= zoomFactor; // Zoom in
                } else {
                    this.sliceViewZoom /= zoomFactor; // Zoom out
                }
                
                // Limit zoom range
                this.sliceViewZoom = Math.max(0.1, Math.min(10.0, this.sliceViewZoom));
                
                // Get world coordinates of mouse position after zoom
                const worldXAfter = (mouseX - this.sliceViewPanX) / this.sliceViewZoom;
                const worldYAfter = (mouseY - this.sliceViewPanY) / this.sliceViewZoom;
                
                // Adjust pan to keep mouse position fixed
                this.sliceViewPanX += (worldXAfter - worldXBefore) * this.sliceViewZoom;
                this.sliceViewPanY += (worldYAfter - worldYBefore) * this.sliceViewZoom;
                
                if (this.selectedSlice) {
                    this.renderSliceView();
                }
            }
            
            resizeSliceCanvas() {
                const container = document.getElementById('sliceViewContainer');
                const rect = container.getBoundingClientRect();
                this.sliceCanvas.width = rect.width;
                this.sliceCanvas.height = rect.height;
                this.sliceCanvas.style.width = rect.width + 'px';
                this.sliceCanvas.style.height = rect.height + 'px';
            }
            
            selectSlice(sliceId) {
                console.log('Selecting slice:', sliceId);
                
                // Update selected slice
                this.selectedSlice = this.slices.find(s => s.id === sliceId);
                console.log('Selected slice:', this.selectedSlice);
                
                // Reset view parameters when selecting a new slice
                if (this.selectedSlice) {
                    this.sliceViewZoom = 1.0;
                    this.sliceViewPanX = 0;
                    this.sliceViewPanY = 0;
                }
                
                // Update UI
                this.updateSliceList();
                
                if (this.selectedSlice) {
                    console.log('Updating slice view');
                    // Update header info
                    document.getElementById('sliceViewInfo').textContent = 
                        `Viewing ${this.selectedSlice.name} - Points within ±10cm with distance-based transparency`;
                    
                    // Force a layout update and render
                    setTimeout(() => {
                        this.resizeSliceCanvas();
                        this.renderSliceView();
                    }, 50);
                } else {
                    console.log('Clearing slice view');
                    // Clear the view
                    document.getElementById('sliceViewInfo').textContent = 'Select a slice to view 2D projection';
                    const ctx = this.sliceCanvasCtx;
                    if (ctx) {
                        ctx.fillStyle = '#1a1a1a';
                        ctx.fillRect(0, 0, this.sliceCanvas.width, this.sliceCanvas.height);
                    }
                }
            }
            
            renderSliceView() {
                if (!this.selectedSlice || !this.currentPointCloud) {
                    return;
                }
                
                const ctx = this.sliceCanvasCtx;
                const canvas = this.sliceCanvas;
                
                // Clear canvas
                ctx.fillStyle = '#1a1a1a';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                // Get point cloud data
                const geometry = this.currentPointCloud.geometry;
                const positions = geometry.attributes.position.array;
                const colors = geometry.attributes.color ? geometry.attributes.color.array : null;
                
                // Slice parameters
                const slicePoint = this.selectedSlice.point;
                const sliceNormal = this.selectedSlice.normal;
                const maxDistance = 0.1; // 10cm
                
                // Create coordinate system for the slice plane
                // u and v are orthogonal vectors in the plane
                const u = new THREE.Vector3();
                const v = new THREE.Vector3();
                
                // Find two orthogonal vectors in the plane
                if (Math.abs(sliceNormal.x) < 0.9) {
                    u.set(1, 0, 0);
                } else {
                    u.set(0, 1, 0);
                }
                u.cross(sliceNormal).normalize();
                v.crossVectors(sliceNormal, u).normalize();
                
                // Collect points near the slice
                const projectedPoints = [];
                const vertexCount = positions.length / 3;
                
                for (let i = 0; i < vertexCount; i++) {
                    const x = positions[i * 3];
                    const y = positions[i * 3 + 1];
                    const z = positions[i * 3 + 2];
                    
                    const point = new THREE.Vector3(x, y, z);
                    const toPoint = point.clone().sub(slicePoint);
                    
                    // Distance from point to plane
                    const distance = Math.abs(toPoint.dot(sliceNormal));
                    
                    if (distance <= maxDistance) {
                        // Project point onto the plane
                        const projectedPoint = point.clone().sub(sliceNormal.clone().multiplyScalar(toPoint.dot(sliceNormal)));
                        
                        // Convert to 2D coordinates in the plane
                        const relativePoint = projectedPoint.clone().sub(slicePoint);
                        const uCoord = relativePoint.dot(u);
                        const vCoord = relativePoint.dot(v);
                        
                        // Calculate transparency based on distance
                        const alpha = 1.0 - (distance / maxDistance);
                        
                        // Get color
                        let r = 1.0, g = 1.0, b = 1.0;
                        if (colors) {
                            r = colors[i * 3];
                            g = colors[i * 3 + 1];
                            b = colors[i * 3 + 2];
                        }
                        
                        projectedPoints.push({
                            u: uCoord,
                            v: vCoord,
                            r: r,
                            g: g,
                            b: b,
                            alpha: alpha
                        });
                    }
                }
                
                if (projectedPoints.length === 0) {
                    ctx.fillStyle = '#666';
                    ctx.font = '14px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('No points within 10cm of slice', canvas.width / 2, canvas.height / 2);
                    return;
                }
                
                // Find bounds of projected points
                let minU = Infinity, maxU = -Infinity;
                let minV = Infinity, maxV = -Infinity;
                
                projectedPoints.forEach(p => {
                    minU = Math.min(minU, p.u);
                    maxU = Math.max(maxU, p.u);
                    minV = Math.min(minV, p.v);
                    maxV = Math.max(maxV, p.v);
                });
                
                // Add padding
                const padding = 0.1;
                const uRange = maxU - minU;
                const vRange = maxV - minV;
                minU -= uRange * padding;
                maxU += uRange * padding;
                minV -= vRange * padding;
                maxV += vRange * padding;
                
                // Calculate base scale to fit canvas (without zoom)
                const canvasAspect = canvas.width / canvas.height;
                const dataAspect = (maxU - minU) / (maxV - minV);
                
                let baseScale;
                if (dataAspect > canvasAspect) {
                    // Data is wider than canvas
                    baseScale = canvas.width / (maxU - minU);
                } else {
                    // Data is taller than canvas
                    baseScale = canvas.height / (maxV - minV);
                }
                
                // Apply zoom and pan
                const scale = baseScale * this.sliceViewZoom;
                const offsetX = this.sliceViewPanX;
                const offsetY = this.sliceViewPanY;
                
                console.log(`Rendering ${projectedPoints.length} points, scale: ${scale.toFixed(2)}, zoom: ${this.sliceViewZoom.toFixed(2)}`);
                
                // Draw points
                projectedPoints.forEach(p => {
                    const screenX = (p.u - minU) * scale + offsetX;
                    const screenY = canvas.height - (p.v - minV) * scale + offsetY; // Flip Y axis
                    
                    // Only draw if point is visible on canvas
                    if (screenX >= -5 && screenX <= canvas.width + 5 && 
                        screenY >= -5 && screenY <= canvas.height + 5) {
                        
                        ctx.globalAlpha = p.alpha;
                        ctx.fillStyle = `rgb(${Math.floor(p.r * 255)}, ${Math.floor(p.g * 255)}, ${Math.floor(p.b * 255)})`;
                        
                        // Scale point size with zoom
                        const pointSize = Math.max(1, 2 * this.sliceViewZoom);
                        ctx.fillRect(screenX - pointSize/2, screenY - pointSize/2, pointSize, pointSize);
                    }
                });
                
                ctx.globalAlpha = 1.0;
                
                // Draw coordinate axes
                this.drawSliceAxes(ctx, canvas, minU, maxU, minV, maxV, scale, offsetX, offsetY);
            }
            
            drawSliceAxes(ctx, canvas, minU, maxU, minV, maxV, scale, offsetX, offsetY) {
                ctx.strokeStyle = '#666';
                ctx.lineWidth = 1;
                
                // Draw axes through origin if visible
                const originU = 0;
                const originV = 0;
                
                if (originU >= minU && originU <= maxU) {
                    // Draw V axis
                    const x = (originU - minU) * scale + offsetX;
                    if (x >= 0 && x <= canvas.width) {
                        ctx.beginPath();
                        ctx.moveTo(x, 0);
                        ctx.lineTo(x, canvas.height);
                        ctx.stroke();
                    }
                }
                
                if (originV >= minV && originV <= maxV) {
                    // Draw U axis
                    const y = canvas.height - (originV - minV) * scale + offsetY;
                    if (y >= 0 && y <= canvas.height) {
                        ctx.beginPath();
                        ctx.moveTo(0, y);
                        ctx.lineTo(canvas.width, y);
                        ctx.stroke();
                    }
                }
                
                // Draw border
                ctx.strokeStyle = '#333';
                ctx.strokeRect(0, 0, canvas.width, canvas.height);
            }
            
            updateHierarchy() {
                const hierarchyTree = document.getElementById('hierarchyTree');
                hierarchyTree.innerHTML = '';
                
                this.buildHierarchyNode(this.scene, hierarchyTree, 0);
            }
            
            buildHierarchyNode(object, container, depth) {
                const item = document.createElement('div');
                item.className = 'hierarchy-item';
                item.dataset.objectId = object.uuid;
                
                // Add expand/collapse toggle for objects with children
                if (object.children.length > 0) {
                    const toggle = document.createElement('span');
                    toggle.className = 'hierarchy-toggle';
                    toggle.textContent = '▼';
                    toggle.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.toggleHierarchyNode(item);
                    });
                    item.appendChild(toggle);
                } else {
                    const spacer = document.createElement('span');
                    spacer.className = 'hierarchy-toggle';
                    item.appendChild(spacer);
                }
                
                // Add icon based on object type
                const icon = document.createElement('span');
                icon.className = 'hierarchy-icon';
                if (object.type === 'Scene') {
                    icon.textContent = '🌍';
                } else if (object.type === 'Points') {
                    icon.textContent = '☁️';
                } else if (object.type === 'GridHelper') {
                    icon.textContent = '📐';
                } else if (object.type === 'AxesHelper') {
                    icon.textContent = '📏';
                } else if (object.type === 'AmbientLight') {
                    icon.textContent = '💡';
                } else if (object.type === 'DirectionalLight') {
                    icon.textContent = '🔆';
                } else if (object.type === 'PerspectiveCamera') {
                    icon.textContent = '📷';
                } else if (object.userData && object.userData.type === 'slice') {
                    icon.textContent = '✂️';
                } else {
                    icon.textContent = '📦';
                }
                item.appendChild(icon);
                
                // Add object name/type
                const name = document.createElement('span');
                name.textContent = object.name || object.type;
                item.appendChild(name);
                
                // Add visibility toggle
                const visibilityToggle = document.createElement('span');
                visibilityToggle.className = 'visibility-toggle';
                visibilityToggle.textContent = object.visible ? '👁️' : '🚫';
                visibilityToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleObjectVisibility(object);
                });
                item.appendChild(visibilityToggle);
                
                // Add click handler for selection
                item.addEventListener('click', () => {
                    this.selectObject(object);
                });
                
                container.appendChild(item);
                
                // Add children
                if (object.children.length > 0) {
                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'hierarchy-children';
                    
                    object.children.forEach(child => {
                        this.buildHierarchyNode(child, childrenContainer, depth + 1);
                    });
                    
                    container.appendChild(childrenContainer);
                }
            }
            
            toggleHierarchyNode(item) {
                const toggle = item.querySelector('.hierarchy-toggle');
                const childrenContainer = item.nextElementSibling;
                
                if (childrenContainer && childrenContainer.classList.contains('hierarchy-children')) {
                    if (childrenContainer.classList.contains('collapsed')) {
                        childrenContainer.classList.remove('collapsed');
                        toggle.textContent = '▼';
                    } else {
                        childrenContainer.classList.add('collapsed');
                        toggle.textContent = '▶';
                    }
                }
            }
            
            toggleObjectVisibility(object) {
                object.visible = !object.visible;
                this.updateHierarchy();
            }
            
            selectObject(object) {
                // Update selection in hierarchy
                document.querySelectorAll('.hierarchy-item').forEach(item => {
                    item.classList.remove('selected');
                });
                
                const selectedItem = document.querySelector(`[data-object-id="${object.uuid}"]`);
                if (selectedItem) {
                    selectedItem.classList.add('selected');
                }
                
                this.selectedObject = object;
                this.updateObjectProperties();
            }
            
            updateObjectProperties() {
                const propertiesDiv = document.getElementById('objectProperties');
                
                if (!this.selectedObject) {
                    propertiesDiv.innerHTML = '<div style="color: #666; font-style: italic; font-size: 12px;">Select an object to view properties</div>';
                    return;
                }
                
                const obj = this.selectedObject;
                let html = `
                    <div style="margin-bottom: 10px;">
                        <strong>${obj.name || obj.type}</strong>
                    </div>
                    <div style="font-size: 11px; line-height: 1.4;">
                        <div><strong>Type:</strong> ${obj.type}</div>
                        <div><strong>UUID:</strong> ${obj.uuid.substring(0, 8)}...</div>
                        <div><strong>Visible:</strong> ${obj.visible ? 'Yes' : 'No'}</div>
                `;
                
                if (obj.position) {
                    html += `<div><strong>Position:</strong> (${obj.position.x.toFixed(2)}, ${obj.position.y.toFixed(2)}, ${obj.position.z.toFixed(2)})</div>`;
                }
                
                if (obj.rotation) {
                    html += `<div><strong>Rotation:</strong> (${obj.rotation.x.toFixed(2)}, ${obj.rotation.y.toFixed(2)}, ${obj.rotation.z.toFixed(2)})</div>`;
                }
                
                if (obj.scale) {
                    html += `<div><strong>Scale:</strong> (${obj.scale.x.toFixed(2)}, ${obj.scale.y.toFixed(2)}, ${obj.scale.z.toFixed(2)})</div>`;
                }
                
                if (obj.children) {
                    html += `<div><strong>Children:</strong> ${obj.children.length}</div>`;
                }
                
                if (obj.type === 'Points' && obj.geometry) {
                    const vertexCount = obj.geometry.attributes.position ? obj.geometry.attributes.position.count : 0;
                    html += `<div><strong>Vertices:</strong> ${vertexCount.toLocaleString()}</div>`;
                }
                
                html += '</div>';
                propertiesDiv.innerHTML = html;
            }
            
            async uploadFile() {
                const fileInput = document.getElementById('fileInput');
                const file = fileInput.files[0];
                
                if (!file) {
                    this.showStatus('Please select a PLY file', 'error');
                    return;
                }
                
                if (!file.name.toLowerCase().endsWith('.ply')) {
                    this.showStatus('Please select a PLY file (.ply extension)', 'error');
                    return;
                }
                
                const formData = new FormData();
                formData.append('file', file);
                
                try {
                    // Show progress bar and hide status
                    this.showProgress(0, `Uploading ${file.name}...`);
                    document.getElementById('status').style.display = 'none';
                    
                    // Use XMLHttpRequest for upload progress tracking
                    const result = await this.uploadWithProgress('/upload', formData);
                    
                    this.showProgress(100, 'Processing complete!');
                    
                    // Show loading progress for point cloud rendering
                    this.showProgress(0, 'Loading point cloud...');
                    
                    // Load the point cloud
                    await this.loadPointCloud(result.file_id);
                    
                    this.showProgress(100, 'Point cloud loaded!');
                    
                    // Hide progress bar after a short delay and show success status
                    setTimeout(() => {
                        this.hideProgress();
                        this.showStatus(`Uploaded successfully! ${result.vertex_count} vertices`, 'success');
                    }, 500);
                    
                    // Refresh the point cloud list
                    this.loadPointCloudList();
                    
                    // Reset file input
                    fileInput.value = '';
                    document.getElementById('uploadBtn').textContent = 'Upload PLY File';
                    
                } catch (error) {
                    console.error('Upload error:', error);
                    this.hideProgress();
                    this.showStatus(`Upload failed: ${error.message}`, 'error');
                }
            }
            
            uploadWithProgress(url, formData) {
                return new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    
                    // Track upload progress
                    xhr.upload.addEventListener('progress', (e) => {
                        if (e.lengthComputable) {
                            const uploadProgress = (e.loaded / e.total) * 70; // Upload is 70% of total progress
                            this.showProgress(uploadProgress, 'Uploading...');
                        }
                    });
                    
                    // Handle upload completion and processing
                    xhr.addEventListener('load', () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            this.showProgress(70, 'Processing PLY file...');
                            
                            // Simulate processing progress (since backend processing is synchronous)
                            this.simulateProcessingProgress(70, 100, () => {
                                try {
                                    const result = JSON.parse(xhr.responseText);
                                    resolve(result);
                                } catch (e) {
                                    reject(new Error('Invalid JSON response'));
                                }
                            });
                        } else {
                            try {
                                const error = JSON.parse(xhr.responseText);
                                reject(new Error(error.detail || `HTTP error! status: ${xhr.status}`));
                            } catch (e) {
                                reject(new Error(`HTTP error! status: ${xhr.status}`));
                            }
                        }
                    });
                    
                    xhr.addEventListener('error', () => {
                        reject(new Error('Network error occurred'));
                    });
                    
                    xhr.open('POST', url);
                    xhr.send(formData);
                });
            }
            
            simulateProcessingProgress(startProgress, endProgress, onComplete) {
                let currentProgress = startProgress;
                const increment = (endProgress - startProgress) / 20; // 20 steps
                
                const updateProgress = () => {
                    currentProgress += increment;
                    this.showProgress(Math.min(currentProgress, endProgress), 'Processing PLY file...');
                    
                    if (currentProgress < endProgress) {
                        setTimeout(updateProgress, 50); // Update every 50ms
                    } else {
                        onComplete();
                    }
                };
                
                updateProgress();
            }
            
            showProgress(percentage, text) {
                const progressContainer = document.getElementById('progressContainer');
                const progressFill = document.getElementById('progressFill');
                const progressText = document.getElementById('progressText');
                
                progressContainer.style.display = 'block';
                progressFill.style.width = `${Math.round(percentage)}%`;
                progressText.textContent = `${text} (${Math.round(percentage)}%)`;
            }
            
            hideProgress() {
                const progressContainer = document.getElementById('progressContainer');
                const status = document.getElementById('status');
                
                progressContainer.style.display = 'none';
                status.style.display = 'block';
            }
            
            async loadPointCloud(fileId) {
                try {
                    // Show progress bar for loading
                    this.showProgress(0, 'Fetching point cloud data...');
                    document.getElementById('status').style.display = 'none';
                    
                    const response = await fetch(`/pointcloud/${fileId}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    
                    this.showProgress(50, 'Parsing point cloud data...');
                    const data = await response.json();
                    
                    this.showProgress(75, 'Rendering point cloud...');
                    await this.displayPointCloudWithProgress(data);
                    
                    this.showProgress(100, 'Point cloud loaded!');
                    
                    // Hide progress bar and show success status
                    setTimeout(() => {
                        this.hideProgress();
                        this.showStatus(`Loaded ${data.vertex_count} points`, 'success');
                    }, 300);
                    
                } catch (error) {
                    console.error('Load error:', error);
                    this.hideProgress();
                    this.showStatus(`Load failed: ${error.message}`, 'error');
                }
            }
            
            async displayPointCloudWithProgress(data) {
                return new Promise((resolve) => {
                    // Use setTimeout to allow progress update to render
                    setTimeout(() => {
                        this.displayPointCloud(data);
                        resolve();
                    }, 50);
                });
            }
            
            displayPointCloud(data) {
                // Remove existing point cloud
                if (this.currentPointCloud) {
                    this.scene.remove(this.currentPointCloud);
                    this.currentPointCloud.geometry.dispose();
                    this.currentPointCloud.material.dispose();
                }
                
                // Create geometry
                const geometry = new THREE.BufferGeometry();
                
                // Set vertices
                const vertices = new Float32Array(data.vertices);
                geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
                
                // Set colors
                if (data.colors && data.colors.length > 0) {
                    const colors = new Float32Array(data.colors);
                    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                }
                
                // Create material
                const material = new THREE.PointsMaterial({
                    size: 0.02,
                    vertexColors: data.colors && data.colors.length > 0,
                    sizeAttenuation: true
                });
                
                // Create points
                this.currentPointCloud = new THREE.Points(geometry, material);
                this.scene.add(this.currentPointCloud);
                
                // Center the point cloud
                geometry.computeBoundingBox();
                const center = geometry.boundingBox.getCenter(new THREE.Vector3());
                this.currentPointCloud.position.sub(center);
                
                // Adjust camera to fit the point cloud but maintain human height
                const size = geometry.boundingBox.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                this.camera.position.set(-maxDim, -maxDim, 1.7); // Keep at 1.7m height
                this.camera.up.set(0, 0, 1); // Ensure Z is still up after repositioning
                this.updateRotationTarget(); // Set target 2m in front
                this.controls.update();
                
                // Update hierarchy to show new point cloud
                this.updateHierarchy();
            }
            
            async loadPointCloudList() {
                try {
                    const response = await fetch('/pointclouds');
                    if (!response.ok) return;

                    const data = await response.json();
                    const listContainer = document.getElementById('pointCloudList');

                    // Clear existing list
                    const existingItems = listContainer.querySelectorAll('.point-cloud-item');
                    existingItems.forEach(item => item.remove());

                    // Add point clouds to list
                    data.point_clouds.forEach(pc => {
                        const item = document.createElement('div');
                        item.className = 'point-cloud-item';
                        item.textContent = `${pc.file_id} (${pc.vertex_count} points)`;
                        item.addEventListener('click', () => {
                            // Remove active class from all items
                            listContainer.querySelectorAll('.point-cloud-item').forEach(i =>
                                i.classList.remove('active'));
                            // Add active class to clicked item
                            item.classList.add('active');
                            // Load the point cloud
                            this.loadPointCloud(pc.file_id);
                        });
                        listContainer.appendChild(item);
                    });

                } catch (error) {
                    console.error('Failed to load point cloud list:', error);
                }
            }

            async checkConfigAndLoad() {
                try {
                    const response = await fetch('/api/config');
                    const config = await response.json();

                    if (config.mode === 'potree') {
                        // Hide upload UI - hide the file input and upload button specifically
                        const fileInput = document.getElementById('fileInput');
                        const uploadBtn = document.getElementById('uploadBtn');
                        const progressContainer = document.getElementById('progressContainer');

                        if (fileInput) fileInput.style.display = 'none';
                        if (uploadBtn) uploadBtn.style.display = 'none';
                        if (progressContainer) progressContainer.style.display = 'none';

                        // Update the Files tab header to show Potree mode
                        const filesTab = document.querySelector('[data-panel="files"]');
                        const uploadHeader = filesTab ? filesTab.querySelector('h3') : null;
                        if (uploadHeader) {
                            uploadHeader.textContent = '☁️ Potree Point Cloud';
                        }

                        // Show potree info
                        const listContainer = document.getElementById('pointCloudList');
                        if (listContainer && listContainer.parentElement) {
                            listContainer.parentElement.querySelector('h3').textContent = '☁️ Loaded Data';
                            listContainer.innerHTML = `
                                <div style="padding: 10px; color: #4CAF50; background: rgba(76, 175, 80, 0.1); border-radius: 4px;">
                                    <strong>${config.potree_name}</strong><br>
                                    <span style="font-size: 11px; color: #aaa;">Potree octree format with LOD</span>
                                </div>
                            `;
                        }

                        // Load Potree point cloud
                        await this.loadPotreePointCloud();
                    } else {
                        // Upload mode - load list of uploaded clouds
                        this.loadPointCloudList();
                    }
                } catch (error) {
                    console.error('Failed to check config:', error);
                    // Fallback to upload mode
                    this.loadPointCloudList();
                }
            }

            async loadPotreePointCloud() {
                try {
                    console.log('Initializing Potree viewer...');

                    // Check if Potree library is loaded
                    if (typeof Potree === 'undefined') {
                        throw new Error('Potree library not loaded');
                    }

                    // Remove our existing renderer canvas
                    const viewerElement = document.getElementById('viewer');
                    const oldCanvas = viewerElement.querySelector('canvas');
                    if (oldCanvas) oldCanvas.remove();

                    // Create Potree.Viewer - it will create its own renderer
                    this.potreeViewer = new Potree.Viewer(viewerElement);

                    // Configure viewer
                    this.potreeViewer.setEDLEnabled(false);
                    this.potreeViewer.setFOV(75);
                    this.potreeViewer.setPointBudget(2_000_000);
                    this.potreeViewer.setBackground('black');

                    // Replace our Three.js components with Potree's
                    this.scene = this.potreeViewer.scene.scene;  // Potree's Three.js scene
                    this.camera = this.potreeViewer.scene.getActiveCamera();
                    this.renderer = this.potreeViewer.renderer;

                    // Update controls to use Potree's camera and renderer
                    if (this.controls) {
                        this.controls.object = this.camera;
                        this.controls.domElement = this.renderer.domElement;
                    }

                    console.log('Potree viewer initialized, loading point cloud...');

                    // Load point cloud - try v1.7 format first, then v2.0
                    let url = '/potree/cloud.js';  // Try v1.7 format

                    Potree.loadPointCloud(url, "KP_Giesing", e => {
                        const pointcloud = e.pointcloud;
                        const material = pointcloud.material;

                        // Configure material
                        material.size = 1.0;
                        material.pointSizeType = Potree.PointSizeType.ADAPTIVE;
                        material.shape = Potree.PointShape.SQUARE;
                        material.activeAttributeName = "rgba";

                        console.log('Point cloud loaded:', pointcloud);
                        console.log(`Bounding box:`, pointcloud.boundingBox);

                        // Apply offset to center point cloud at origin with ground at Z=0
                        const bbox = pointcloud.boundingBox;
                        const centerX = (bbox.min.x + bbox.max.x) / 2;
                        const centerY = (bbox.min.y + bbox.max.y) / 2;

                        pointcloud.position.set(-centerX, -centerY, -bbox.min.z);

                        console.log(`Point cloud centered with offset: (${-centerX.toFixed(1)}, ${-centerY.toFixed(1)}, ${-bbox.min.z.toFixed(1)})`);

                        // Add to Potree scene using Potree's method
                        this.potreeViewer.scene.addPointCloud(pointcloud);
                        this.currentPointCloud = pointcloud;
                        this.potreePointCloud = pointcloud;

                        // Position camera
                        const size = bbox.max.clone().sub(bbox.min);
                        const maxSize = Math.max(size.x, size.y);

                        this.camera.position.set(54, -61.3, 15.4);
                        this.camera.up.set(0, 0, 1);
                        this.camera.updateProjectionMatrix();

                        // Set Potree view target
                        this.potreeViewer.scene.view.position.copy(this.camera.position);
                        this.potreeViewer.scene.view.lookAt(new THREE.Vector3(0, 0, 0));

                        // Add custom grid and axes to Three.js scene
                        const gridHelper = new THREE.GridHelper(maxSize * 1.5, 20, 0x444444, 0x222222);
                        gridHelper.rotateX(Math.PI / 2);
                        gridHelper.name = 'gridHelper';
                        this.scene.add(gridHelper);

                        const axesHelper = new THREE.AxesHelper(maxSize * 0.3);
                        axesHelper.name = 'axesHelper';
                        this.scene.add(axesHelper);

                        this.updateHierarchy();
                        this.showStatus(`Loaded Potree point cloud with ${pointcloud.visibleNodes?.length || 'auto'} LOD`, 'success');
                    });

                    // Also load metadata for custom LOD system (for M/N key controls)
                    // Try Potree 1.7 format first (cloud.js), then Potree 2.0 (metadata.json)
                    try {
                        let metadataResponse = await fetch('/potree/cloud.js');
                        if (!metadataResponse.ok) {
                            // Try Potree 2.0 format
                            metadataResponse = await fetch('/potree/pointclouds/index/metadata.json');
                        }

                        if (metadataResponse.ok) {
                            const metadata = await metadataResponse.json();
                            console.log('Loaded metadata for custom LOD system:', metadata);

                            // Normalize metadata format (handle both 1.7 and 2.0 formats)
                            if (metadata.version === "2.0") {
                                // Potree 2.0 format - convert to our expected format
                                this.potreeMetadata = {
                                    boundingBox: {
                                        lx: metadata.boundingBox.min[0],
                                        ly: metadata.boundingBox.min[1],
                                        lz: metadata.boundingBox.min[2],
                                        ux: metadata.boundingBox.max[0],
                                        uy: metadata.boundingBox.max[1],
                                        uz: metadata.boundingBox.max[2]
                                    },
                                    scale: metadata.scale[0],  // Assume uniform scale
                                    spacing: metadata.spacing
                                };
                            } else {
                                // Potree 1.7 format - already in expected format
                                this.potreeMetadata = metadata;
                            }

                            console.log('Custom LOD system ready (press M for more detail, N for less)');
                        }
                    } catch (metadataError) {
                        console.warn('Could not load metadata for custom LOD system:', metadataError);
                    }

                } catch (error) {
                    console.error('Failed to load Potree:', error);
                    this.showStatus(`Failed to load Potree: ${error.message}`, 'error');
                }
            }

            async loadInitialPotreeLODs() {
                // Calculate offset based on metadata
                const bbox = this.potreeMetadata.boundingBox;
                const centerX = (bbox.lx + bbox.ux) / 2;
                const centerY = (bbox.ly + bbox.uy) / 2;

                // For X,Y: center them at origin
                // For Z: put the GROUND (minimum Z) at Z=0
                this.potreeOffset = {
                    x: -centerX,
                    y: -centerY,
                    z: -bbox.lz  // Ground level at Z=0
                };

                const heightAboveGround = bbox.uz - bbox.lz;

                console.log(`Positioning point cloud:`);
                console.log(`  Ground (min Z) at Z=0`);
                console.log(`  Height: ${heightAboveGround.toFixed(1)}m`);
                console.log(`  Offset: (${this.potreeOffset.x.toFixed(1)}, ${this.potreeOffset.y.toFixed(1)}, ${this.potreeOffset.z.toFixed(1)})`);

                // Load ONLY root node to verify it displays correctly
                console.log(`Loading root node...`);

                await this.loadPotreeNodeIfExists('r');

                console.log(`Loaded root node successfully`);
            }

            setupPotreeLODUpdates() {
                // Manual LOD control with M/N keys
                console.log('Manual LOD control enabled: M = more detail, N = less detail');
            }

            async increaseLODDepth() {
                if (this.currentLODDepth >= 6) {
                    console.log('Already at maximum LOD depth (6)');
                    this.showStatus('Maximum LOD depth reached', 'info');
                    return;
                }

                this.currentLODDepth++;
                console.log(`Increasing LOD depth to ${this.currentLODDepth}`);
                this.showStatus(`LOD Depth: ${this.currentLODDepth}`, 'success');

                // Load nodes for this depth
                await this.loadNodesForDepth(this.currentLODDepth);

                // Update visibility
                this.updatePotreeNodeVisibility(this.currentLODDepth);
            }

            decreaseLODDepth() {
                if (this.currentLODDepth <= 0) {
                    console.log('Already at minimum LOD depth (0 = root only)');
                    this.showStatus('Minimum LOD depth (root only)', 'info');
                    return;
                }

                this.currentLODDepth--;
                console.log(`Decreasing LOD depth to ${this.currentLODDepth}`);
                this.showStatus(`LOD Depth: ${this.currentLODDepth}`, 'success');

                // Update visibility to hide deeper nodes
                this.updatePotreeNodeVisibility(this.currentLODDepth);
            }

            async loadNodesForDepth(depth) {
                const nodesToLoad = [];

                // Generate all node names up to this depth
                const generateNodes = (prefix, currentDepth) => {
                    nodesToLoad.push(prefix);

                    if (currentDepth < depth) {
                        for (let i = 0; i < 8; i++) {
                            generateNodes(prefix + i, currentDepth + 1);
                        }
                    }
                };

                generateNodes('r', 0);

                console.log(`Loading ${nodesToLoad.length} nodes for depth ${depth}...`);

                // Load nodes that aren't already loaded
                const promises = nodesToLoad
                    .filter(name => !this.potreeLoadedNodes.has(name) && !this.potreeFailedNodes.has(name))
                    .map(name => this.loadPotreeNodeIfExists(name));

                await Promise.all(promises);

                console.log(`Finished loading nodes for depth ${depth}`);
            }

            updatePotreeLOD() {
                if (!this.potreeMetadata) return;

                // Throttle updates
                if (this.potreeLODUpdateTimeout) return;

                this.potreeLODUpdateTimeout = setTimeout(() => {
                    this.potreeLODUpdateTimeout = null;
                    this.performPotreeLODUpdate();
                }, 100);
            }

            async performPotreeLODUpdate() {
                // Calculate which nodes should be visible based on camera distance
                const cameraPos = this.camera.position;
                const bbox = this.potreeMetadata.boundingBox;
                const spacing = this.potreeMetadata.spacing;

                // Calculate distance from camera to bounding box center
                const centerX = (bbox.lx + bbox.ux) / 2;
                const centerY = (bbox.ly + bbox.uy) / 2;
                const centerZ = (bbox.lz + bbox.uz) / 2;

                const dx = cameraPos.x - centerX;
                const dy = cameraPos.y - centerY;
                const dz = cameraPos.z - centerZ;
                const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

                // Determine maximum depth based on distance
                let maxDepth = 2; // minimum depth
                if (distance < 100) maxDepth = 5;
                else if (distance < 200) maxDepth = 4;
                else if (distance < 400) maxDepth = 3;

                // Load nodes up to maxDepth
                const nodesToLoad = this.getPotreeNodesToLoad(maxDepth);

                // Load any new nodes that aren't already loaded or loading
                for (const nodeName of nodesToLoad) {
                    if (!this.potreeLoadedNodes.has(nodeName) && !this.potreeLoading.has(nodeName)) {
                        this.loadPotreeNodeIfExists(nodeName);
                    }
                }

                // Update visibility of nodes based on LOD
                this.updatePotreeNodeVisibility(maxDepth);
            }

            getPotreeNodesToLoad(maxDepth) {
                const nodes = [];

                // Generate node names up to maxDepth
                const generateChildren = (parent, depth) => {
                    if (depth > maxDepth) return;

                    nodes.push(parent);

                    for (let i = 0; i < 8; i++) {
                        const childName = parent + i;
                        generateChildren(childName, depth + 1);
                    }
                };

                generateChildren('r', 0);
                return nodes;
            }

            updatePotreeNodeVisibility(maxDepth) {
                // ADDITIVE LOD: Show ALL nodes up to and including maxDepth
                // Higher LODs add detail, they don't replace lower LODs
                for (const [nodeName, pointsObj] of this.potreeNodes) {
                    const depth = nodeName.length - 1;

                    // Simple additive rule: show if depth <= maxDepth
                    const shouldShow = (depth <= maxDepth);
                    pointsObj.visible = shouldShow;

                    // Debug logging for first two levels
                    if (nodeName.length <= 2) {
                        console.log(`  Node ${nodeName} (depth ${depth}): visible=${shouldShow}`);
                    }
                }
            }

            /**
             * Calculate the bounding box for a specific octree node based on its name.
             * In an octree, each child occupies one octant (1/8th) of its parent's space.
             * The octant is determined by the last digit in the node name:
             *   0 (000): x-, y-, z-    4 (100): x-, y-, z+
             *   1 (001): x+, y-, z-    5 (101): x+, y-, z+
             *   2 (010): x-, y+, z-    6 (110): x-, y+, z+
             *   3 (011): x+, y+, z-    7 (111): x+, y+, z+
             * where x+ means upper half in x direction, x- means lower half, etc.
             */
            getNodeBoundingBox(nodeName) {
                const rootBbox = this.potreeMetadata.boundingBox;

                // Root node uses the full bounding box
                if (nodeName === 'r') {
                    return {
                        lx: rootBbox.lx,
                        ly: rootBbox.ly,
                        lz: rootBbox.lz,
                        ux: rootBbox.ux,
                        uy: rootBbox.uy,
                        uz: rootBbox.uz
                    };
                }

                // Start with root bounding box
                let bbox = {
                    lx: rootBbox.lx,
                    ly: rootBbox.ly,
                    lz: rootBbox.lz,
                    ux: rootBbox.ux,
                    uy: rootBbox.uy,
                    uz: rootBbox.uz
                };

                // Remove the 'r' prefix to get the octant path
                const octantPath = nodeName.substring(1);

                // Traverse the octree hierarchy, subdividing at each level
                for (let i = 0; i < octantPath.length; i++) {
                    const octant = parseInt(octantPath[i]);

                    // Calculate midpoints
                    const midX = (bbox.lx + bbox.ux) / 2;
                    const midY = (bbox.ly + bbox.uy) / 2;
                    const midZ = (bbox.lz + bbox.uz) / 2;

                    // Subdivide based on octant bits:
                    // bit 0 (octant & 1): x direction
                    // bit 1 (octant & 2): y direction
                    // bit 2 (octant & 4): z direction

                    if (octant & 1) {  // x+ (upper half in x)
                        bbox.lx = midX;
                    } else {  // x- (lower half in x)
                        bbox.ux = midX;
                    }

                    if (octant & 2) {  // y+ (upper half in y)
                        bbox.ly = midY;
                    } else {  // y- (lower half in y)
                        bbox.uy = midY;
                    }

                    if (octant & 4) {  // z+ (upper half in z)
                        bbox.lz = midZ;
                    } else {  // z- (lower half in z)
                        bbox.uz = midZ;
                    }
                }

                return bbox;
            }

            async loadPotreeNodeIfExists(nodeName) {
                console.log(`Attempting to load node: ${nodeName}`);

                // Check if already loaded, loading, or previously failed
                if (this.potreeLoadedNodes.has(nodeName) ||
                    this.potreeLoading.has(nodeName) ||
                    this.potreeFailedNodes.has(nodeName)) {
                    console.log(`  Skipping ${nodeName} (already processed)`);
                    return;
                }

                this.potreeLoading.add(nodeName);

                try {
                    // Load the octree node data
                    // All nodes are in data/r/ directory with .bin extension
                    console.log(`  Fetching /potree/data/r/${nodeName}.bin`);
                    const response = await fetch(`/potree/data/r/${nodeName}.bin`);

                    if (!response.ok) {
                        // Node doesn't exist, mark as failed and skip
                        this.potreeLoading.delete(nodeName);
                        this.potreeFailedNodes.add(nodeName);
                        return;
                    }

                    const buffer = await response.arrayBuffer();

                    // Parse binary data based on Potree format
                    const view = new DataView(buffer);
                    const numPoints = buffer.byteLength / 16; // Each point is 16 bytes

                    const vertices = [];
                    const colors = [];

                    const scale = this.potreeMetadata.scale;
                    // Calculate the correct bounding box for this specific node
                    const bbox = this.getNodeBoundingBox(nodeName);

                    // Debug: Log bounding box for verification
                    const depth = nodeName.length - 1;
                    if (depth <= 2) {
                        console.log(`Node ${nodeName} bbox: X[${bbox.lx.toFixed(1)}, ${bbox.ux.toFixed(1)}] Y[${bbox.ly.toFixed(1)}, ${bbox.uy.toFixed(1)}] Z[${bbox.lz.toFixed(1)}, ${bbox.uz.toFixed(1)}]`);
                    }

                    // Read points
                    for (let i = 0; i < numPoints; i++) {
                        const offset = i * 16;

                        // Read position (3 x int32) and apply centering offset
                        let x = view.getInt32(offset, true) * scale + bbox.lx;
                        let y = view.getInt32(offset + 4, true) * scale + bbox.ly;
                        let z = view.getInt32(offset + 8, true) * scale + bbox.lz;

                        // Center at origin
                        if (this.potreeOffset) {
                            x += this.potreeOffset.x;
                            y += this.potreeOffset.y;
                            z += this.potreeOffset.z;
                        }

                        // Read color (4 x uint8 - RGBA)
                        const r = view.getUint8(offset + 12) / 255.0;
                        const g = view.getUint8(offset + 13) / 255.0;
                        const b = view.getUint8(offset + 14) / 255.0;

                        vertices.push(x, y, z);
                        colors.push(r, g, b);
                    }

                    console.log(`  Parsed ${numPoints} points for ${nodeName}, vertices.length=${vertices.length}`);

                    // Calculate and display actual bounding box of loaded points for verification
                    if (depth <= 2 && vertices.length > 0) {
                        let minX = vertices[0], maxX = vertices[0];
                        let minY = vertices[1], maxY = vertices[1];
                        let minZ = vertices[2], maxZ = vertices[2];

                        for (let i = 3; i < vertices.length; i += 3) {
                            if (vertices[i] < minX) minX = vertices[i];
                            if (vertices[i] > maxX) maxX = vertices[i];
                            if (vertices[i+1] < minY) minY = vertices[i+1];
                            if (vertices[i+1] > maxY) maxY = vertices[i+1];
                            if (vertices[i+2] < minZ) minZ = vertices[i+2];
                            if (vertices[i+2] > maxZ) maxZ = vertices[i+2];
                        }

                        console.log(`  Actual points bbox: X[${minX.toFixed(1)}, ${maxX.toFixed(1)}] Y[${minY.toFixed(1)}, ${maxY.toFixed(1)}] Z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
                    }

                    // Create point cloud geometry
                    const geometry = new THREE.BufferGeometry();
                    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
                    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));

                    // Calculate point size based on LOD level (depth already declared above)
                    const pointSize = 0.05 * Math.pow(0.8, depth); // Smaller points for deeper LODs

                    const material = new THREE.PointsMaterial({
                        size: pointSize,
                        vertexColors: true,
                        sizeAttenuation: true
                    });

                    const pointsObj = new THREE.Points(geometry, material);
                    pointsObj.name = `potree_${nodeName}`;

                    // Store original positions/colors for undo functionality
                    if (this.selectionManager) {
                        this.selectionManager.storeOriginalPositions(pointsObj);
                    }

                    // Add to scene
                    this.scene.add(pointsObj);

                    // Track the node
                    this.potreeNodes.set(nodeName, pointsObj);
                    this.potreeLoadedNodes.add(nodeName);
                    this.potreeLoading.delete(nodeName);

                    console.log(`Loaded node ${nodeName}: ${numPoints} points, depth ${depth}`);

                    // Position camera on first load
                    if (nodeName === 'r' && !this.cameraInitialized) {
                        this.cameraInitialized = true;

                        const sizeX = bbox.ux - bbox.lx;
                        const sizeY = bbox.uy - bbox.ly;
                        const sizeZ = bbox.uz - bbox.lz;  // Height of structure
                        const maxSize = Math.max(sizeX, sizeY);

                        // Position camera to view the structure
                        // Point cloud is centered on X,Y and has ground at Z=0
                        this.camera.position.set(54, -61.3, 15.4);

                        // Look at ground level in front of camera
                        this.controls.target.set(0, 0, 0);
                        this.controls.update();

                        // Grid and axes at ground level (Z=0)
                        this.updateGridAndAxes(0, 0, 0, maxSize);

                        console.log(`Camera at (${this.camera.position.x.toFixed(1)}, ${this.camera.position.y.toFixed(1)}, ${this.camera.position.z.toFixed(1)})`);
                        console.log(`Looking at origin (0, 0, 0)`);
                        console.log(`Structure height: ${sizeZ.toFixed(1)}m, ground at Z=0`);
                    }

                } catch (error) {
                    // Log the error so we can see what's failing
                    console.error(`ERROR loading node ${nodeName}:`, error);
                    this.potreeLoading.delete(nodeName);
                    this.potreeFailedNodes.add(nodeName);
                }
            }

            setupSelectionManager() {
                // Initialize the selection manager for edit mode
                // SelectionManager is loaded from edit/selection-manager.js
                if (typeof SelectionManager !== 'undefined') {
                    this.selectionManager = new SelectionManager(this);
                    console.log('SelectionManager initialized - Press E to toggle edit mode');
                } else {
                    console.warn('SelectionManager not loaded - edit features unavailable');
                }
            }

            updateGridAndAxes(centerX, centerY, centerZ, size) {
                // Remove old grid and axes if they exist
                const oldGrid = this.scene.getObjectByName('gridHelper');
                const oldAxes = this.scene.getObjectByName('axesHelper');
                if (oldGrid) this.scene.remove(oldGrid);
                if (oldAxes) this.scene.remove(oldAxes);

                // Create new grid helper at the point cloud location
                const gridSize = size * 1.5;
                const gridHelper = new THREE.GridHelper(gridSize, 20, 0x444444, 0x222222);
                gridHelper.position.set(centerX, centerY, centerZ);
                gridHelper.rotateX(Math.PI / 2); // Rotate to lie in X-Y plane
                // NO Z rotation - grid matches coordinate system
                gridHelper.name = 'gridHelper';
                this.scene.add(gridHelper);

                // Create new axes helper at the point cloud center
                // Red=+X (right), Green=+Y (forward), Blue=+Z (up)
                const axesHelper = new THREE.AxesHelper(size * 0.3);
                axesHelper.position.set(centerX, centerY, centerZ);
                // NO rotation - axes match coordinate system directly
                axesHelper.name = 'axesHelper';
                this.scene.add(axesHelper);

                console.log(`Grid and axes positioned at (${centerX.toFixed(1)}, ${centerY.toFixed(1)}, ${centerZ.toFixed(1)})`);

                // Update hierarchy to show new helpers
                this.updateHierarchy();
            }

            showStatus(message, type) {
                const status = document.getElementById('status');
                status.textContent = message;
                status.className = type;
                status.style.display = 'block';

                setTimeout(() => {
                    status.style.display = 'none';
                }, 3000);
            }

            animate() {
                requestAnimationFrame(() => this.animate());

                this.handleWalkMovement(); // Handle keyboard-based walk movement

                // Use Potree's rendering if viewer exists
                if (this.potreeViewer) {
                    this.potreeViewer.update(this.clock.getDelta(), performance.now());
                    this.potreeViewer.render();
                } else {
                    // Fallback to our own rendering (upload mode)
                    this.controls.update();
                    this.renderer.render(this.scene, this.camera);
                }

                // Update position display
                this.updatePositionDisplay();
            }

            updatePositionDisplay() {
                const camX = document.getElementById('camX');
                const camY = document.getElementById('camY');
                const camZ = document.getElementById('camZ');
                const lodDepth = document.getElementById('lodDepth');
                const lodNodes = document.getElementById('lodNodes');

                if (camX) camX.textContent = this.camera.position.x.toFixed(1);
                if (camY) camY.textContent = this.camera.position.y.toFixed(1);
                if (camZ) camZ.textContent = this.camera.position.z.toFixed(1);

                if (lodDepth) lodDepth.textContent = this.currentLODDepth || 0;
                if (lodNodes) lodNodes.textContent = this.potreeLoadedNodes ? this.potreeLoadedNodes.size : 0;
            }
            
            getViewportWidth() {
                // Calculate viewport width excluding left and right panes
                const leftPane = document.getElementById('leftPane');
                const rightPane = document.getElementById('rightPane');
                const leftWidth = leftPane ? leftPane.offsetWidth : 320;
                const rightWidth = rightPane ? rightPane.offsetWidth : 400;
                return window.innerWidth - leftWidth - rightWidth;
            }

            getViewportHeight() {
                return window.innerHeight;
            }

            onWindowResize() {
                const viewportWidth = this.getViewportWidth();
                const viewportHeight = this.getViewportHeight();

                this.camera.aspect = viewportWidth / viewportHeight;
                this.camera.updateProjectionMatrix();
                this.renderer.setSize(viewportWidth, viewportHeight);
            }
        }
