import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { ThreeMFLoader } from 'threejs-webworker-3mf-loader';
import ConfirmModal from './ConfirmModal';
import { API_ENDPOINTS } from '../config/api';
import fetchWithRetry from '../utils/fetchWithRetry';
import './ModelViewer.css';

interface ModelViewerProps {
  fileId: number;
  fileName: string;
  fileType: string;
  onClose: () => void;
}

const ModelViewer: React.FC<ModelViewerProps> = ({ fileId, fileName, fileType, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmLargeFile, setConfirmLargeFile] = useState<{ size: number } | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [sliceHeight, setSliceHeight] = useState<number | null>(null);
  const [modelHeight, setModelHeight] = useState(100);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    
    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x444444); // Medium gray for better visibility
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      10000
    );
    camera.position.set(0, 100, 200);

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // Force canvas to have explicit dimensions
    renderer.domElement.width = containerRef.current.clientWidth;
    renderer.domElement.height = containerRef.current.clientHeight;
    
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    renderer.domElement.style.display = 'block';
    

    
    // Test render immediately
    renderer.setClearColor(0x444444, 1); // Gray background
    renderer.clear();
    console.log('Canvas initialized with proper dimensions');

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight1.position.set(1, 1, 1);
    scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-1, -1, -1);
    scene.add(directionalLight2);

    // Grid
    const gridHelper = new THREE.GridHelper(400, 40, 0x00d4ff, 0x404040);
    scene.add(gridHelper);

    // Store camera in ref
    cameraRef.current = camera;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 5;
    controls.maxDistance = 2000;
    controls.zoomSpeed = 1.2;
    controls.rotateSpeed = 1.0;
    controls.panSpeed = 0.8;
    controls.enabled = true;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 2.0;
    controlsRef.current = controls;

    // Render function
    const render = () => {
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    // Animation loop
    let frameCount = 0;
    const animate = () => {
      const id = requestAnimationFrame(animate);
      animationIdRef.current = id;
      
      frameCount++;
      
      if (controlsRef.current) {
        controlsRef.current.update();
      }
      
      render();
    };
    animate();

    // Helper function to render geometry
    const renderGeometry = (geometry: THREE.BufferGeometry) => {
      if (!sceneRef.current) return;
      
      const scene = sceneRef.current;
      
      // Remove old model if exists
      const oldModel = scene.getObjectByName('loaded-model');
      if (oldModel) {
        scene.remove(oldModel);
      }
      
      // Create material
      const material = new THREE.MeshStandardMaterial({
        color: 0x00d4ff,
        metalness: 0.3,
        roughness: 0.4,
        flatShading: false
      });
      
      // Create mesh
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'loaded-model';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      
      // Calculate bounding box
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      // Move model so it's centered in X and Z, with bottom at Y=0
      mesh.position.set(
        -center.x,
        -box.min.y,
        -center.z
      );
      
      scene.add(mesh);
      
      // Update camera
      const finalBox = new THREE.Box3().setFromObject(mesh);
      const finalCenter = finalBox.getCenter(new THREE.Vector3());
      const finalSize = finalBox.getSize(new THREE.Vector3());
      const bsphere = new THREE.Sphere();
      finalBox.getBoundingSphere(bsphere);
      
      // Store model height for slice control
      setModelHeight(finalSize.y);
      
      const radius = bsphere.radius;
      const cameraDistance = radius * 2.5;
      
      if (cameraRef.current && controlsRef.current) {
        cameraRef.current.position.set(
          finalCenter.x + cameraDistance,
          finalCenter.y + cameraDistance * 0.6,
          finalCenter.z + cameraDistance
        );
        controlsRef.current.target.copy(finalCenter);
        controlsRef.current.update();
      }
    };

    // Load model
    const loadModel = async () => {
      try {
        setLoading(true);
        setError(null);

        // Try to load pre-extracted geometry first
        const geometryResponse = await fetchWithRetry(API_ENDPOINTS.LIBRARY.GEOMETRY(fileId), {
          credentials: 'include'
        });
        
        if (geometryResponse.ok) {
          console.log('Loading pre-extracted geometry...');
          const blob = await geometryResponse.blob();
          const arrayBuffer = await blob.arrayBuffer();
          
          let geometry: THREE.BufferGeometry | null = null;
          
          // Pre-extracted geometry is always STL or .model XML
          const contentType = geometryResponse.headers.get('content-type');
          if (contentType?.includes('xml')) {
            // It's a 3MF .model file, skip for now
            console.log('3MF model file - falling back to full download');
          } else {
            // It's STL
            const loader = new STLLoader();
            geometry = loader.parse(arrayBuffer);
            
            if (geometry) {
              renderGeometry(geometry);
              setLoading(false);
              return;
            }
          }
        }

        // Fallback to full file download if geometry not pre-extracted
        console.log('Pre-extracted geometry not available, downloading full file...');

        // Check file size first to avoid downloading huge files
        const headResponse = await fetchWithRetry(API_ENDPOINTS.LIBRARY.DOWNLOAD(fileId), {
          method: 'HEAD',
          credentials: 'include'
        });
        const fileSize = parseInt(headResponse.headers.get('content-length') || '0');
        
        // Warn if file is over 50MB
        if (fileSize > 50 * 1024 * 1024) {
          setConfirmLargeFile({ size: fileSize });
          setLoading(false);
          return;
        }

        // Download the file
        const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.DOWNLOAD(fileId), {
          credentials: 'include'
        });
        if (!response.ok) throw new Error('Failed to download model');

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();

        let geometry: THREE.BufferGeometry | null = null;

        if (fileType === 'stl') {
          const loader = new STLLoader();
          geometry = loader.parse(arrayBuffer);
        } else if (fileType === '3mf') {
          // Create a blob URL like Manyfold does
          const blob = new Blob([arrayBuffer], { type: 'model/3mf' });
          const url = URL.createObjectURL(blob);
          
          const loader = new ThreeMFLoader();
          
          // Use .load() method with URL, not .parse() with ArrayBuffer
          loader.load(
            url,
            // onLoad callback
            (object: THREE.Group) => {
              URL.revokeObjectURL(url);
              
              if (!sceneRef.current) {
                setLoading(false);
                return;
              }
              
              const scene = sceneRef.current;
              
              // Remove old model if exists
              const oldModel = scene.getObjectByName('loaded-model');
              if (oldModel) {
                scene.remove(oldModel);
                oldModel.traverse((child) => {
                  if (child instanceof THREE.Mesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) {
                      child.material.forEach(m => m.dispose());
                    } else {
                      child.material?.dispose();
                    }
                  }
                });
              }
              
              object.name = 'loaded-model';
              
              // CRITICAL: Replace materials like Manyfold does!
              // Create a standard material that will work with our lighting
              const standardMaterial = new THREE.MeshLambertMaterial({
                color: 0xeeeeee, // Light gray/white for visibility
                side: THREE.DoubleSide,
                flatShading: true
              });
              
              // Count meshes and apply new material
              let meshCount = 0;
              object.traverse((child) => {
                if (child.type === 'Mesh' || child instanceof THREE.Mesh) {
                  meshCount++;
                  const mesh = child as THREE.Mesh;
                  
                  // Replace the material from the loader with our own
                  mesh.material = standardMaterial;
                  mesh.castShadow = true;
                  mesh.receiveShadow = true;
                }
              });
              
              // Add to scene first
              scene.add(object);
              
              // 3MF files often use Z-up coordinate system, but Three.js uses Y-up
              // Rotate -90 degrees around X axis to convert Z-up to Y-up
              object.rotation.x = -Math.PI / 2;
              
              // Calculate bounding box
              const box = new THREE.Box3().setFromObject(object);
              const center = box.getCenter(new THREE.Vector3());
              const size = box.getSize(new THREE.Vector3());
              
              // Move model so it's centered in X and Z, with bottom at Y=0
              object.position.set(
                -center.x,  // Center in X
                -box.min.y, // Bottom at Y=0
                -center.z   // Center in Z
              );
              
              // Recalculate bounding box after positioning
              const finalBox = new THREE.Box3().setFromObject(object);
              const finalCenter = finalBox.getCenter(new THREE.Vector3());
              
              // Calculate bounding sphere for camera positioning
              const bsphere = new THREE.Sphere();
              finalBox.getBoundingSphere(bsphere);
              
              // Position camera to view the model
              const radius = bsphere.radius;
              const cameraDistance = radius * 2.5;
              
              if (cameraRef.current && controlsRef.current) {
                cameraRef.current.position.set(
                  finalCenter.x + cameraDistance,
                  finalCenter.y + cameraDistance * 0.6,
                  finalCenter.z + cameraDistance
                );
                controlsRef.current.target.copy(finalCenter);
                controlsRef.current.update();
              }
              
              setLoading(false);
            },
            // onProgress callback
            undefined,
            // onError callback
            (error) => {
              URL.revokeObjectURL(url);
              console.error('3MF load error:', error);
              setLoading(false);
              throw new Error('Failed to load 3MF file: ' + (error instanceof Error ? error.message : 'Unknown error'));
            }
          );
          
          // Early return since loading is async
          return;
        }

        if (!geometry) {
          throw new Error('Failed to parse model geometry');
        }

        // Position model centered at origin with bottom on plate (preserves orientation)
        geometry.computeBoundingBox();
        const boundingBox = geometry.boundingBox!;
        const center = new THREE.Vector3();
        boundingBox.getCenter(center);
        // Center on X and Z, place bottom at y=0
        geometry.translate(-center.x, -boundingBox.min.y, -center.z);

        // Scale to fit
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 100 / maxDim;
        geometry.scale(scale, scale, scale);

        // Create mesh with light gray material to match 3MF models
        const material = new THREE.MeshLambertMaterial({
          color: 0xeeeeee, // Light gray/white
          side: THREE.DoubleSide,
          flatShading: true
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'loaded-model';
        
        // DON'T remove existing meshes - keep the test cube for comparison
        // Just remove any previously loaded model
        const oldModel = scene.getObjectByName('loaded-model');
        if (oldModel) {
          scene.remove(oldModel);
          if (oldModel instanceof THREE.Mesh) {
            oldModel.geometry.dispose();
            if (oldModel.material instanceof THREE.Material) {
              oldModel.material.dispose();
            }
          }
        }
        
        scene.add(mesh);

        // Position camera to view model (geometry is already centered at origin)
        const finalSize = new THREE.Vector3();
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        box.getSize(finalSize);
        
        // Calculate distance to fit model in view
        const modelMaxDim = Math.max(finalSize.x, finalSize.y, finalSize.z);
        const fov = cameraRef.current!.fov * (Math.PI / 180);
        const distance = Math.abs(modelMaxDim / Math.sin(fov / 2)) * 1.2;
        
        if (cameraRef.current && controlsRef.current) {
          cameraRef.current.position.set(distance, distance * 0.7, distance);
          cameraRef.current.lookAt(0, 0, 0);
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.update();
        }

        setLoading(false);
      } catch (err) {
        console.error('Failed to load model:', err);
        setError('Failed to load 3D model: ' + (err instanceof Error ? err.message : 'Unknown error'));
        setLoading(false);
      }
    };

    // Helper function to parse 3MF XML model data
    const parse3MFModel = (xmlString: string): THREE.BufferGeometry | null => {
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
        
        // Check for parsing errors
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
          return null;
        }
        
        // 3MF uses namespaces, so we need to handle them
        const meshElements = xmlDoc.querySelectorAll('mesh, object[type="model"] mesh');
        
        if (meshElements.length === 0) {
          // Main model file often doesn't have mesh data, geometry is in object files
          return null;
        }
        
        // Use the first mesh
        const meshElement = meshElements[0];
        const vertices = meshElement.querySelector('vertices');
        const triangles = meshElement.querySelector('triangles');
        
        if (!vertices || !triangles) {
          return null;
        }
        
        // Parse vertices
        const vertexElements = vertices.querySelectorAll('vertex');
        const vertexArray: number[] = [];
        
        vertexElements.forEach(v => {
          const x = parseFloat(v.getAttribute('x') || '0');
          const y = parseFloat(v.getAttribute('y') || '0');
          const z = parseFloat(v.getAttribute('z') || '0');
          vertexArray.push(x, y, z);
        });
        
        // Parse triangles
        const triangleElements = triangles.querySelectorAll('triangle');
        const positions: number[] = [];
        
        triangleElements.forEach(t => {
          const v1 = parseInt(t.getAttribute('v1') || '0');
          const v2 = parseInt(t.getAttribute('v2') || '0');
          const v3 = parseInt(t.getAttribute('v3') || '0');
          
          // Validate indices
          if (v1 * 3 + 2 < vertexArray.length && 
              v2 * 3 + 2 < vertexArray.length && 
              v3 * 3 + 2 < vertexArray.length) {
            positions.push(
              vertexArray[v1 * 3], vertexArray[v1 * 3 + 1], vertexArray[v1 * 3 + 2],
              vertexArray[v2 * 3], vertexArray[v2 * 3 + 1], vertexArray[v2 * 3 + 2],
              vertexArray[v3 * 3], vertexArray[v3 * 3 + 1], vertexArray[v3 * 3 + 2]
            );
          }
        });
        
        if (positions.length === 0) {
          return null;
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        
        return geometry;
      } catch (err) {
        return null;
      }
    };

    loadModel();

    // Handle window resize
    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Handle ESC key to close viewer
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      if (animationIdRef.current !== null) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (containerRef.current && rendererRef.current.domElement.parentNode === containerRef.current) {
          containerRef.current.removeChild(rendererRef.current.domElement);
        }
      }
      if (sceneRef.current) {
        sceneRef.current.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();
            if (object.material instanceof THREE.Material) {
              object.material.dispose();
            }
          }
        });
      }
    };
  }, [fileId, fileType]);

  // Update auto-rotate when state changes
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  // Toggle wireframe mode
  const toggleWireframe = () => {
    if (!sceneRef.current) return;
    
    sceneRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => { m.wireframe = !wireframe; });
        } else {
          child.material.wireframe = !wireframe;
        }
      }
    });
    setWireframe(!wireframe);
  };

  // Reset camera position
  const resetCamera = () => {
    if (!cameraRef.current || !controlsRef.current || !sceneRef.current) return;
    
    const model = sceneRef.current.getObjectByName('loaded-model');
    if (model) {
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const bsphere = new THREE.Sphere();
      box.getBoundingSphere(bsphere);
      
      const radius = bsphere.radius;
      const cameraDistance = radius * 2.5;
      
      cameraRef.current.position.set(
        center.x + cameraDistance,
        center.y + cameraDistance * 0.6,
        center.z + cameraDistance
      );
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  };

  // Update slice clipping plane
  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    
    if (sliceHeight !== null) {
      const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), sliceHeight);
      rendererRef.current.clippingPlanes = [clipPlane];
      rendererRef.current.localClippingEnabled = true;
    } else {
      rendererRef.current.clippingPlanes = [];
      rendererRef.current.localClippingEnabled = false;
    }
  }, [sliceHeight]);

  return (
    <div className="model-viewer-overlay" onClick={onClose}>
      <div className="model-viewer-container" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-header">
          <div>
            <h2>{fileName}</h2>
            <p className="viewer-subtitle">3D Model Viewer</p>
          </div>
          <button className="btn-close-viewer" onClick={onClose}>✕</button>
        </div>
        
        <div ref={containerRef} className="viewer-canvas"></div>
        
        {/* Viewer Controls Sidebar */}
        <div className="viewer-sidebar">
          <button 
            className={`viewer-btn ${wireframe ? 'active' : ''}`}
            onClick={toggleWireframe}
            title="Toggle Wireframe"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          
          <button 
            className={`viewer-btn ${autoRotate ? 'active' : ''}`}
            onClick={() => setAutoRotate(!autoRotate)}
            title="Toggle Auto-Rotate"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          
          <button 
            className="viewer-btn"
            onClick={resetCamera}
            title="Reset Camera"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15 10l-4 4l6 6l4-16l-16 4l6 6l4-4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          
          <div className="viewer-divider"></div>
          
          <div className="slice-control">
            <button 
              className={`viewer-btn ${sliceHeight !== null ? 'active' : ''}`}
              onClick={() => setSliceHeight(sliceHeight === null ? modelHeight : null)}
              title="Toggle Slice View"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
            {sliceHeight !== null && (
              <input
                type="range"
                min="0"
                max={modelHeight}
                value={sliceHeight}
                onChange={(e) => setSliceHeight(Number(e.target.value))}
                className="slice-slider"
                title={`Height: ${sliceHeight.toFixed(1)}mm`}
              />
            )}
          </div>
        </div>
        
        {loading && (
          <div className="viewer-loading">
            <div className="spinner"></div>
            <p>Loading 3D model...</p>
          </div>
        )}

        {error && (
          <div className="viewer-error">
            <p>⚠️ {error}</p>
          </div>
        )}

        <div className="viewer-controls-help">
          <p>🖱️ Left click + drag to rotate • Scroll to zoom • Right click + drag to pan</p>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!confirmLargeFile}
        title="Large File Warning"
        message={`This file is ${((confirmLargeFile?.size || 0) / 1024 / 1024).toFixed(1)}MB. Loading large files may cause the browser to freeze.\n\nDo you want to continue?`}
        confirmText="Load Anyway"
        confirmButtonClass="btn-warning"
        onConfirm={async () => {
          setConfirmLargeFile(null);
          setLoading(true);
          try {
            const response = await fetchWithRetry(API_ENDPOINTS.LIBRARY.DOWNLOAD(fileId), {
              credentials: 'include'
            });
            if (!response.ok) throw new Error('Failed to download model');
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            let geometry: THREE.BufferGeometry | null = null;
            if (fileType === 'stl') {
              const loader = new STLLoader();
              geometry = loader.parse(arrayBuffer);
            }
            if (geometry) {
              renderGeometry(geometry);
            }
            setLoading(false);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load model');
            setLoading(false);
          }
        }}
        onCancel={() => setConfirmLargeFile(null)}
      />
    </div>
  );
};

export default ModelViewer;
