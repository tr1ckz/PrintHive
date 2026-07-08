const path = require('path');
const fs = require('fs');
const { createCanvas } = require('@napi-rs/canvas');

// Cache directory for thumbnails
const { dataDir } = require('./database');
const THUMB_DIR = path.join(dataDir, 'thumbnails');
const THUMB_SIZE = 256;
const PNG_OPTIONS = { compressionLevel: 9 };
const MAX_MODEL_VERTICES = 18000;
// Bump whenever the render/compositing pipeline changes in a way that should
// invalidate every cached thumbnail (e.g. the white-background chroma-key
// fix below) — old cache files are simply orphaned and regenerated on read.
const THUMB_CACHE_VERSION = 3;

// Ensure thumbnail directory exists
if (!fs.existsSync(THUMB_DIR)) {
  fs.mkdirSync(THUMB_DIR, { recursive: true });
}

/**
 * Down-sample very large meshes so thumbnail generation stays responsive.
 */
function sampleVertices(vertices, maxVertices = MAX_MODEL_VERTICES) {
  if (!Array.isArray(vertices) || vertices.length <= maxVertices) {
    return vertices;
  }

  // Down-sample whole triangles (every 3 vertices), never individual vertices —
  // dropping a lone vertex would shift every following triangle's grouping and
  // shred the mesh into a scatter of misconnected faces.
  const triCount = Math.floor(vertices.length / 3);
  const maxTris = Math.max(1, Math.floor(maxVertices / 3));
  const triStep = Math.ceil(triCount / maxTris);
  const out = [];
  for (let t = 0; t < triCount; t += triStep) {
    out.push(vertices[t * 3], vertices[t * 3 + 1], vertices[t * 3 + 2]);
  }
  return out;
}

/**
 * Parse STL file and extract vertices
 */
function parseSTL(buffer) {
  try {
    console.log('  Parsing STL file, size:', buffer.length, 'bytes');
    // Check if binary or ASCII
    const header = buffer.toString('utf8', 0, 80);
    
    if (header.toLowerCase().includes('solid')) {
      // ASCII STL
      console.log('  Detected ASCII STL format');
      return parseSTLAscii(buffer);
    } else {
      // Binary STL
      console.log('  Detected binary STL format');
      return parseSTLBinary(buffer);
    }
  } catch (err) {
    console.error('  STL parse error:', err.message);
    return null;
  }
}

/**
 * Parse binary STL
 */
function parseSTLBinary(buffer) {
  const triangleCount = buffer.readUInt32LE(80);
  console.log('  Triangle count:', triangleCount);
  const vertices = [];
  
  let offset = 84;
  const sampleStep = Math.max(1, Math.ceil((triangleCount * 3) / MAX_MODEL_VERTICES));

  for (let i = 0; i < triangleCount; i++) {
    // Skip normal (12 bytes)
    offset += 12;

    for (let j = 0; j < 3; j++) {
      if (i % sampleStep === 0) {
        const x = buffer.readFloatLE(offset);
        const y = buffer.readFloatLE(offset + 4);
        const z = buffer.readFloatLE(offset + 8);
        vertices.push([x, y, z]);
      }
      offset += 12;
    }

    // Skip attribute byte count (2 bytes)
    offset += 2;
  }

  return sampleVertices(vertices);
}

/**
 * Parse ASCII STL
 */
function parseSTLAscii(buffer) {
  const text = buffer.toString('utf8');
  const vertices = [];
  const vertexRegex = /vertex\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)\s+([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/g;
  
  console.log('  Parsing ASCII STL text, length:', text.length);
  let match;
  while ((match = vertexRegex.exec(text)) !== null) {
    vertices.push([
      parseFloat(match[1]),
      parseFloat(match[3]),
      parseFloat(match[5])
    ]);
  }
  
  console.log('  Parsed', vertices.length, 'vertices from ASCII STL');
  return sampleVertices(vertices);
}

/**
 * Parse 3MF file and extract model data or embedded thumbnail
 */
function parse3MF(filePath) {
  try {
    console.log('  Parsing 3MF file:', filePath);
    const JSZip = require('jszip');
    const fileData = fs.readFileSync(filePath);
    console.log('  3MF file size:', fileData.length, 'bytes');
    const zip = new JSZip();
    
    return zip.loadAsync(fileData).then(async zipContent => {
      // First, try to extract embedded thumbnail PNG
      const thumbnailFile = zipContent.file('Metadata/thumbnail.png') || 
                           zipContent.file('Metadata/plate_1.png') ||
                           zipContent.file(/Metadata\/.*\.png$/i)[0];
      
      if (thumbnailFile) {
        console.log('  Found embedded thumbnail:', thumbnailFile.name);
        const pngData = await thumbnailFile.async('nodebuffer');
        // Return a special marker with the PNG data
        return { embeddedThumbnail: pngData };
      }
      
      // If no thumbnail, try to parse geometry
      const possiblePaths = [
        /3D\/.*\.model$/i,
        /.*\.model$/i,
        /3dmodel\.model$/i,
        /Metadata\/model_.*\.model$/i
      ];
      
      let modelFile = null;
      for (const pathRegex of possiblePaths) {
        const files = zipContent.file(pathRegex);
        if (files && files.length > 0) {
          modelFile = files[0];
          console.log('  Found model file:', modelFile.name);
          break;
        }
      }
      
      if (!modelFile) {
        console.log('  No model file found');
        return null;
      }
      
      return modelFile.async('string').then(xmlString => {
        // Parse XML to extract vertices - try multiple patterns
        const vertices = [];
        
        // Pattern 1: Direct vertex attributes (x="..." y="..." z="...")
        const vertexRegex1 = /<vertex\s+x="([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)"\s+y="([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)"\s+z="([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)"/gi;
        
        // Pattern 2: Vertices with any attribute order
        const vertexRegex2 = /<vertex[^>]*x="([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)"[^>]*y="([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)"[^>]*z="([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)"/gi;
        
        let match;
        
        // Try pattern 1
        while ((match = vertexRegex1.exec(xmlString)) !== null) {
          vertices.push([
            parseFloat(match[1]),
            parseFloat(match[2]),
            parseFloat(match[3])
          ]);
        }
        
        // If no matches, try pattern 2
        if (vertices.length === 0) {
          while ((match = vertexRegex2.exec(xmlString)) !== null) {
            vertices.push([
              parseFloat(match[1]),
              parseFloat(match[2]),
              parseFloat(match[3])
            ]);
          }
        }
        
        console.log('  Extracted', vertices.length, 'vertices from XML');
        return sampleVertices(vertices);
      });
    }).catch(err => {
      console.error('  3MF parse error:', err.message);
      return null;
    });
  } catch (err) {
    console.error('  3MF file error:', err.message);
    return null;
  }
}

/**
 * Render a mesh (triangle soup: every 3 vertices = one triangle) as a shaded
 * isometric solid, so an STL — which has no slicer-embedded preview — gets a
 * real model thumbnail instead of a flat placeholder card. Draws on whatever
 * (transparent) canvas is passed, with no background or label, so the result
 * composites onto the app's dark card the same way the chroma-keyed 3MF
 * previews do.
 *
 * Uses actual per-triangle surface normals for Lambert shading (not the old
 * depth-index fake), a painter's sort along the true view axis for correct
 * occlusion, and abs() lighting so inconsistent STL winding never yields
 * black faces.
 *
 * @returns {boolean} true if anything was drawn
 */
function renderShadedModel(ctx, vertices, width, height) {
  const triCount = Math.floor((vertices?.length || 0) / 3);
  if (triCount === 0) return false;

  // Bounding box → center + uniform scale to fit the frame with a margin.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of vertices) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;

  // Isometric view of a Z-up model: yaw around the up axis, then tilt down.
  const az = Math.PI / 4;   // 45° turntable
  const el = Math.PI / 6;   // 30° elevation
  const ca = Math.cos(az), sa = Math.sin(az);
  const ce = Math.cos(el), se = Math.sin(el);

  // Model (Z-up) → camera space (sx = right, sy = up, depth toward viewer).
  const toCamera = (x, y, z) => {
    const mx = x - cx, my = y - cy, mz = z - cz;
    // yaw about Z
    const ax = mx * ca - my * sa;
    const ay = mx * sa + my * ca;
    // tilt about the rotated X axis
    const depth = ay * ce + mz * se;      // toward the camera
    const up = -ay * se + mz * ce;        // model up on screen
    return [ax, up, depth];
  };

  // First pass: transform, track projected extent for a tight fit.
  const cam = new Array(vertices.length);
  let pMinX = Infinity, pMaxX = -Infinity, pMinY = Infinity, pMaxY = -Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const [x, y, z] = vertices[i];
    const c = toCamera(x, y, z);
    cam[i] = c;
    if (c[0] < pMinX) pMinX = c[0]; if (c[0] > pMaxX) pMaxX = c[0];
    if (c[1] < pMinY) pMinY = c[1]; if (c[1] > pMaxY) pMaxY = c[1];
  }
  const spanX = pMaxX - pMinX || 1;
  const spanY = pMaxY - pMinY || 1;
  const margin = 0.86;
  const scale = Math.min(width / spanX, height / spanY) * margin;
  const offX = width / 2 - ((pMinX + pMaxX) / 2) * scale;
  const offY = height / 2 + ((pMinY + pMaxY) / 2) * scale; // +Y up → screen y flips

  // Build triangles with a Lambert shade and a view-depth key.
  const L = (() => { const v = [-0.4, 0.72, 0.57]; const m = Math.hypot(...v); return [v[0] / m, v[1] / m, v[2] / m]; })();
  const base = [206, 212, 221]; // cool neutral "raw model" gray
  const tris = [];
  for (let t = 0; t < triCount; t++) {
    const a = cam[t * 3], b = cam[t * 3 + 1], c = cam[t * 3 + 2];
    // face normal in camera space
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const lambert = Math.abs(nx * L[0] + ny * L[1] + nz * L[2]); // abs → winding-agnostic
    const shade = 0.34 + 0.66 * lambert; // ambient floor + diffuse
    tris.push({
      x1: offX + a[0] * scale, y1: offY - a[1] * scale,
      x2: offX + b[0] * scale, y2: offY - b[1] * scale,
      x3: offX + c[0] * scale, y3: offY - c[1] * scale,
      depth: (a[2] + b[2] + c[2]) / 3,
      shade,
    });
  }

  // Painter's algorithm: far (small depth) first.
  tris.sort((p, q) => p.depth - q.depth);

  for (const tri of tris) {
    const r = Math.round(base[0] * tri.shade);
    const g = Math.round(base[1] * tri.shade);
    const bl = Math.round(base[2] * tri.shade);
    const fill = `rgb(${r}, ${g}, ${bl})`;
    ctx.beginPath();
    ctx.moveTo(tri.x1, tri.y1);
    ctx.lineTo(tri.x2, tri.y2);
    ctx.lineTo(tri.x3, tri.y3);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    // Stroke the same color to seal sub-pixel AA seams between adjacent faces.
    ctx.strokeStyle = fill;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  return true;
}

/**
 * Chroma-key out the near-white/near-gray studio floor a slicer bakes into
 * embedded plate thumbnails, so the model renders on transparency instead of
 * a solid white square. Low-saturation pixels above the brightness floor are
 * faded to transparent, with a soft ramp (rather than a hard cutoff) so
 * anti-aliased model edges don't get a jagged or white-fringed cutout.
 */
function stripNearWhiteBackground(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const FADE_START = 190; // below this, always opaque (real object color)
  const FADE_END = 235;   // at/above this, fully transparent (background)

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    const isNeutral = (max - min) < 18; // low saturation = white/gray, not a colored part

    if (isNeutral && min > FADE_START) {
      const fade = Math.min(1, (min - FADE_START) / (FADE_END - FADE_START));
      data[i + 3] = Math.round(data[i + 3] * (1 - fade));
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Generate thumbnail from actual 3D model data
 */
async function generateModelThumbnail(file, filePath) {
  console.log('Generating model thumbnail for:', file.originalName);
  const width = THUMB_SIZE;
  const height = THUMB_SIZE;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Transparent background on purpose — a parsed model (STL, or a 3MF with no
  // embedded preview) is drawn as a shaded solid that composites onto the app's
  // dark card, matching the chroma-keyed embedded-PNG previews. No colored card,
  // no file-type label.

  // Try to parse and render the model
  console.log('Parsing', file.fileType, 'file...');
  let vertices = null;
  let embeddedPNG = null;
  
  if (file.fileType === 'stl') {
    const buffer = fs.readFileSync(filePath);
    vertices = parseSTL(buffer);
  } else if (file.fileType === '3mf') {
    const result = await parse3MF(filePath);
    // Check if we got an embedded thumbnail
    if (result && result.embeddedThumbnail) {
      embeddedPNG = result.embeddedThumbnail;
      console.log('Using embedded PNG thumbnail');
    } else {
      vertices = result;
    }
  }

  // If we have an embedded PNG, resize it to our standard size
  if (embeddedPNG) {
    console.log(`Resizing embedded thumbnail to ${THUMB_SIZE}x${THUMB_SIZE}`);
    const { loadImage, createCanvas } = require('@napi-rs/canvas');
    const image = await loadImage(embeddedPNG);
    console.log('Original embedded thumbnail size:', image.width, 'x', image.height);
    const canvas = createCanvas(THUMB_SIZE, THUMB_SIZE);
    const ctx = canvas.getContext('2d');

    // Leave the canvas transparent (no background fill) — slicer-embedded
    // plate thumbnails are rendered on a flat white studio floor, which we
    // chroma-key out below so the model sits on the app's dark card
    // background instead of a blown-out white slab.

    // Calculate scaling to fit image in THUMB_SIZE x THUMB_SIZE while maintaining aspect ratio
    const scale = Math.min(THUMB_SIZE / image.width, THUMB_SIZE / image.height);
    const scaledWidth = image.width * scale;
    const scaledHeight = image.height * scale;
    const x = (THUMB_SIZE - scaledWidth) / 2;
    const y = (THUMB_SIZE - scaledHeight) / 2;

    ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
    stripNearWhiteBackground(ctx, THUMB_SIZE, THUMB_SIZE);
    return canvas.toBuffer('image/png', PNG_OPTIONS);
  }

  const rendered = renderShadedModel(ctx, vertices, width, height);
  if (rendered) {
    console.log('Rendered shaded model from', vertices.length, 'vertices');
  } else {
    console.log('No vertices found, falling back to cube icon');
    // Fallback to a neutral cube icon if parsing produced no geometry.
    const cubeSize = Math.round(width * 0.3);
    const verticalOffset = Math.round(height * 0.08);
    drawCube(ctx, width / 2, height / 2 - verticalOffset, cubeSize);
  }

  return canvas.toBuffer('image/png', PNG_OPTIONS);
}

/**
 * Generate a simple colored thumbnail for GCODE files
 */
function generateGCodeThumbnail(file) {
  const width = THUMB_SIZE;
  const height = THUMB_SIZE;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#FF9800');
  gradient.addColorStop(1, '#E65100');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Draw document icon for GCODE
  drawDocument(ctx, width / 2, height / 2 - Math.round(height * 0.08), Math.round(width * 0.32));

  // File type label
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.font = `bold ${Math.round(width * 0.12)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GCODE', width / 2, height - Math.round(height * 0.15));

  // File name (truncated)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = `${Math.round(width * 0.05)}px Arial`;
  const maxNameLength = 30;
  const fileName = file.originalName.length > maxNameLength 
    ? file.originalName.substring(0, maxNameLength) + '...' 
    : file.originalName;
  ctx.fillText(fileName, width / 2, height - Math.round(height * 0.05));

  return canvas.toBuffer('image/png', PNG_OPTIONS);
}
function drawCube(ctx, centerX, centerY, size) {
  const s = size / 2;
  const offset = size * 0.3;

  // Save context
  ctx.save();

  // Back face
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.beginPath();
  ctx.moveTo(centerX - s + offset, centerY - s - offset);
  ctx.lineTo(centerX + s + offset, centerY - s - offset);
  ctx.lineTo(centerX + s + offset, centerY + s - offset);
  ctx.lineTo(centerX - s + offset, centerY + s - offset);
  ctx.closePath();
  ctx.fill();

  // Top face
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.beginPath();
  ctx.moveTo(centerX - s, centerY - s);
  ctx.lineTo(centerX + s, centerY - s);
  ctx.lineTo(centerX + s + offset, centerY - s - offset);
  ctx.lineTo(centerX - s + offset, centerY - s - offset);
  ctx.closePath();
  ctx.fill();

  // Front face
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.moveTo(centerX - s, centerY - s);
  ctx.lineTo(centerX + s, centerY - s);
  ctx.lineTo(centerX + s, centerY + s);
  ctx.lineTo(centerX - s, centerY + s);
  ctx.closePath();
  ctx.fill();

  // Right face
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.moveTo(centerX + s, centerY - s);
  ctx.lineTo(centerX + s + offset, centerY - s - offset);
  ctx.lineTo(centerX + s + offset, centerY + s - offset);
  ctx.lineTo(centerX + s, centerY + s);
  ctx.closePath();
  ctx.fill();

  // Outline
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  // Draw edges
  ctx.beginPath();
  ctx.moveTo(centerX - s, centerY - s);
  ctx.lineTo(centerX + s, centerY - s);
  ctx.lineTo(centerX + s, centerY + s);
  ctx.lineTo(centerX - s, centerY + s);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw a document icon
 */
function drawDocument(ctx, centerX, centerY, size) {
  ctx.save();
  
  const width = size * 0.7;
  const height = size;
  const cornerSize = size * 0.2;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.moveTo(centerX - width / 2, centerY - height / 2);
  ctx.lineTo(centerX + width / 2 - cornerSize, centerY - height / 2);
  ctx.lineTo(centerX + width / 2, centerY - height / 2 + cornerSize);
  ctx.lineTo(centerX + width / 2, centerY + height / 2);
  ctx.lineTo(centerX - width / 2, centerY + height / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Folded corner
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.beginPath();
  ctx.moveTo(centerX + width / 2 - cornerSize, centerY - height / 2);
  ctx.lineTo(centerX + width / 2, centerY - height / 2 + cornerSize);
  ctx.lineTo(centerX + width / 2 - cornerSize, centerY - height / 2 + cornerSize);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Lines
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 2;
  const lineSpacing = size * 0.12;
  const lineStart = centerX - width / 2 + 15;
  const lineEnd = centerX + width / 2 - 15;
  const firstLine = centerY - height / 2 + cornerSize + 20;

  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(lineStart, firstLine + i * lineSpacing);
    ctx.lineTo(lineEnd, firstLine + i * lineSpacing);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Adjust color brightness
 */
function adjustBrightness(color, percent) {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, (num >> 8 & 0x00FF) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
  return '#' + (0x1000000 + (R << 16) + (G << 8) + B).toString(16).slice(1);
}

/**
 * Get or generate thumbnail for a file
 * @param {Object} file - Library file object
 * @returns {Buffer|Promise<Buffer>} - PNG image buffer
 */
async function getThumbnail(file) {


  const thumbPath = path.join(THUMB_DIR, `${file.id}.v${THUMB_CACHE_VERSION}.png`);

  // Check if thumbnail exists in cache
  if (fs.existsSync(thumbPath)) {
    return fs.readFileSync(thumbPath);
  }

  // Generate new thumbnail
  let thumbnail;
  
  if (file.fileType === 'gcode') {
    thumbnail = generateGCodeThumbnail(file);
  } else {
    // For 3MF and STL, try to render actual model
    const { libraryDir } = require('./database');
    const filePath = path.join(libraryDir, file.fileName);
    
    if (fs.existsSync(filePath)) {
      thumbnail = await generateModelThumbnail(file, filePath);
    } else {
      // Fallback if file not found
      thumbnail = generateGCodeThumbnail(file);
    }
  }

  // Save to cache
  try {
    fs.writeFileSync(thumbPath, thumbnail);
    console.log('Thumbnail saved to cache:', thumbPath);
  } catch (err) {
    console.error('Failed to cache thumbnail:', err.message);
  }

  console.log('Thumbnail generation complete\n');
  return thumbnail;
}

/**
 * Clear thumbnail cache for a specific file. Removes both the current
 * versioned cache file and the legacy unversioned one (pre-cache-versioning),
 * so nothing orphaned is left behind in either scheme.
 */
function clearThumbnailCache(fileId) {
  const paths = [
    path.join(THUMB_DIR, `${fileId}.v${THUMB_CACHE_VERSION}.png`),
    path.join(THUMB_DIR, `${fileId}.png`),
  ];
  for (const thumbPath of paths) {
    if (fs.existsSync(thumbPath)) {
      fs.unlinkSync(thumbPath);
    }
  }
}

module.exports = {
  getThumbnail,
  clearThumbnailCache,
  THUMB_DIR
};
