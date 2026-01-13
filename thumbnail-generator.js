const path = require('path');
const fs = require('fs');
const { createCanvas } = require('@napi-rs/canvas');

// Cache directory for thumbnails
const THUMB_DIR = path.join(__dirname, 'data', 'thumbnails');
const THUMB_SIZE = 256;
const PNG_OPTIONS = { compressionLevel: 9 };

// Ensure thumbnail directory exists
if (!fs.existsSync(THUMB_DIR)) {
  fs.mkdirSync(THUMB_DIR, { recursive: true });
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
  for (let i = 0; i < triangleCount; i++) {
    // Skip normal (12 bytes)
    offset += 12;
    
    // Read 3 vertices (9 floats = 36 bytes)
    for (let j = 0; j < 3; j++) {
      const x = buffer.readFloatLE(offset);
      const y = buffer.readFloatLE(offset + 4);
      const z = buffer.readFloatLE(offset + 8);
      vertices.push([x, y, z]);
      offset += 12;
    }
    
    // Skip attribute byte count (2 bytes)
    offset += 2;
  }
  
  return vertices;
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
  return vertices;
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
        return vertices;
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
 * Project 3D vertices to 2D isometric view
 */
function projectIsometric(vertices, scaleBase = 250) {
  if (!vertices || vertices.length === 0) return [];
  
  // Find bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  for (const [x, y, z] of vertices) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  
  // Center and scale
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const rangeZ = maxZ - minZ;
  const maxRange = Math.max(rangeX, rangeY, rangeZ);
  const scale = maxRange > 0 ? scaleBase / maxRange : 1;
  
  // Isometric projection
  const projected = [];
  for (const [x, y, z] of vertices) {
    const nx = (x - centerX) * scale;
    const ny = (y - centerY) * scale;
    const nz = (z - centerZ) * scale;
    
    // Apply -90 degree rotation around X axis (Z-up to Y-up)
    const rotY = -nz;
    const rotZ = ny;
    
    // Isometric projection
    const isoX = (nx - rotZ) * Math.cos(Math.PI / 6);
    const isoY = (nx + rotZ) * Math.sin(Math.PI / 6) - rotY;
    
    projected.push([isoX, isoY]);
  }
  
  return projected;
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

  // Background
  const colorScheme = file.fileType === '3mf' 
    ? { bg: '#4CAF50', accent: '#1B5E20' }
    : { bg: '#2196F3', accent: '#0D47A1' };

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, colorScheme.bg);
  gradient.addColorStop(1, adjustBrightness(colorScheme.bg, -20));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

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
    
    // Draw white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, THUMB_SIZE, THUMB_SIZE);
    
    // Calculate scaling to fit image in 800x800 while maintaining aspect ratio
    const scale = Math.min(THUMB_SIZE / image.width, THUMB_SIZE / image.height);
    const scaledWidth = image.width * scale;
    const scaledHeight = image.height * scale;
    const x = (THUMB_SIZE - scaledWidth) / 2;
    const y = (THUMB_SIZE - scaledHeight) / 2;
    
    ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
    return canvas.toBuffer('image/png', PNG_OPTIONS);
  }

  if (vertices && vertices.length > 0) {
    console.log('Successfully parsed', vertices.length, 'vertices');
    // Project to 2D
    console.log('Projecting to isometric view...');
    const projected = projectIsometric(vertices, Math.min(width, height) * 0.6);
    
    if (projected.length > 0) {
      console.log('Rendering', projected.length, 'projected vertices...');
      
      // Calculate triangle normals for lighting
      const triangles = [];
      for (let i = 0; i < projected.length; i += 3) {
        if (i + 2 < projected.length) {
          triangles.push({
            vertices: [projected[i], projected[i + 1], projected[i + 2]],
            z: (projected[i][1] + projected[i + 1][1] + projected[i + 2][1]) / 3 // Average Y for depth
          });
        }
      }
      
      // Sort triangles by depth (painter's algorithm)
      triangles.sort((a, b) => b.z - a.z);
      
      // Draw triangles with solid fill and subtle shading
      triangles.forEach((tri, idx) => {
        const [v1, v2, v3] = tri.vertices;
        const [x1, y1] = v1;
        const [x2, y2] = v2;
        const [x3, y3] = v3;
        
        ctx.beginPath();
        ctx.moveTo(width / 2 + x1, height / 2 + y1 - 30);
        ctx.lineTo(width / 2 + x2, height / 2 + y2 - 30);
        ctx.lineTo(width / 2 + x3, height / 2 + y3 - 30);
        ctx.closePath();
        
        // Use gradient shading based on depth
        const brightness = 0.5 + (idx / triangles.length) * 0.5; // 0.5 to 1.0
        ctx.fillStyle = `rgba(255, 255, 255, ${brightness * 0.9})`;
        ctx.fill();
        
        // Subtle edge lines
        ctx.strokeStyle = `rgba(0, 0, 0, 0.1)`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });
    }
  } else {
    console.log('No vertices found, falling back to cube icon');
    // Fallback to cube icon if parsing fails
    const cubeSize = Math.round(width * 0.3);
    const verticalOffset = Math.round(height * 0.08);
    drawCube(ctx, width / 2, height / 2 - verticalOffset, cubeSize);
  }

  // File type label
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.font = `bold ${Math.round(width * 0.12)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(file.fileType.toUpperCase(), width / 2, height - Math.round(height * 0.15));

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

  
  const thumbPath = path.join(THUMB_DIR, `${file.id}.png`);

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
    const libraryDir = path.join(__dirname, 'library');
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
 * Clear thumbnail cache for a specific file
 */
function clearThumbnailCache(fileId) {
  const thumbPath = path.join(THUMB_DIR, `${fileId}.png`);
  if (fs.existsSync(thumbPath)) {
    fs.unlinkSync(thumbPath);
  }
}

module.exports = {
  getThumbnail,
  clearThumbnailCache,
  THUMB_DIR
};
