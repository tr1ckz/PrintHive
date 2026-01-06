const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

/**
 * Clean and decode HTML-encoded text (handles double/triple encoding)
 */
function cleanHTMLText(text) {
  if (!text || typeof text !== 'string') return text;
  
  let result = text;
  let prevResult = '';
  
  // Keep decoding until no more changes (handles multiple encoding levels)
  while (result !== prevResult) {
    prevResult = result;
    result = result
      // Decode HTML entities (handle double-encoded like &amp;lt; -> &lt; -> <)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;nbsp;/g, ' ');
  }
  
  // Remove HTML tags
  result = result.replace(/<[^>]*>/g, '');
  
  // Clean up whitespace
  result = result.replace(/\s+/g, ' ').trim();
  
  return result;
}

/**
 * Extract meaningful text from potentially HTML-encoded descriptions
 */
function extractDescription(rawDescription) {
  if (!rawDescription) return '';
  
  const cleaned = cleanHTMLText(rawDescription);
  
  // Filter out common promotional/marketing terms
  const meaningfulSentences = cleaned
    .split(/[。.!]/) // Split on sentence endings (Chinese and English)
    .filter(sentence => {
      const s = sentence.trim();
      // Skip empty, very short, or promotional sentences
      if (!s || s.length < 10) return false;
      if (/为我助力|boostme|点赞|like|订阅|subscribe/i.test(s)) return false;
      return true;
    })
    .slice(0, 2) // Take first 2 meaningful sentences max
    .join('. ');
  
  return meaningfulSentences || cleaned.substring(0, 100) + (cleaned.length > 100 ? '...' : '');
}

/**
 * Analyze filename for common 3D printing keywords and patterns
 */
function analyzeFilename(fileName) {
  const lower = fileName.toLowerCase();
  const tags = new Set();
  const features = [];
  
  // Category detection
  const categories = {
    'functional': ['bracket', 'mount', 'holder', 'clip', 'hook', 'stand', 'organizer', 'adapter', 'tool', 'jig', 'fixture'],
    'decorative': ['vase', 'pot', 'planter', 'ornament', 'decoration', 'statue', 'sculpture'],
    'toy': ['toy', 'figure', 'miniature', 'figurine', 'character', 'dragon', 'robot'],
    'mechanical': ['gear', 'bearing', 'hinge', 'wheel', 'axle', 'pulley', 'spring'],
    'storage': ['box', 'case', 'container', 'tray', 'drawer', 'bin'],
    'household': ['coaster', 'opener', 'spoon', 'fork', 'cup', 'plate', 'bowl'],
    'game': ['dice', 'token', 'card', 'board', 'chess', 'puzzle'],
    'electronics': ['enclosure', 'raspberry', 'arduino', 'pi', 'esp', 'pcb', 'cable'],
    'automotive': ['car', 'vehicle', 'wheel', 'bumper', 'spoiler'],
    'medical': ['splint', 'brace', 'prosthetic'],
    'wearable': ['headband', 'glasses', 'earring', 'necklace', 'bracelet', 'ring', 'pendant', 'jewelry', 'costume', 'mask', 'helmet', 'crown', 'tiara', 'badge', 'pin'],
    'seasonal': ['christmas', 'halloween', 'easter', 'thanksgiving', 'valentine', 'ornament', 'wreath', 'decoration'],
    'art': ['sculpture', 'statue', 'bust', 'model', 'diorama', 'display']
  };
  
  // Check each category
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => lower.includes(keyword))) {
      tags.add(category);
    }
  }
  
  // Year/date detection
  const yearMatch = lower.match(/20\d{2}/);
  if (yearMatch) {
    features.push(`${yearMatch[0]} themed`);
  }
  
  // Specific item detection
  if (lower.includes('benchy') || lower.includes('3dbenchy')) {
    features.push('calibration print (Benchy)');
    tags.add('calibration');
  }
  if (lower.includes('calibration') || lower.includes('test')) {
    features.push('test/calibration print');
    tags.add('calibration');
  }
  if (lower.includes('headband') || lower.includes('hair')) {
    features.push('wearable headwear');
  }
  if (lower.includes('glasses') || lower.includes('sunglasses')) {
    features.push('wearable eyewear');
  }
  if (lower.includes('jewelry') || lower.includes('earring') || lower.includes('necklace')) {
    features.push('wearable jewelry');
  }
  if (lower.includes('vase') || lower.includes('pot') || lower.includes('planter')) {
    features.push('vase or planter');
  }
  if (lower.includes('bracket') || lower.includes('mount') || lower.includes('holder')) {
    features.push('mounting hardware');
  }
  if (lower.includes('spool') && lower.includes('holder')) {
    features.push('filament spool holder');
    tags.add('3d-printing');
  }
  
  // Brand/printer specific
  if (lower.includes('bambu') || lower.includes('ams')) {
    tags.add('bambu-lab');
  }
  if (lower.includes('prusa') || lower.includes('mk3') || lower.includes('mk4')) {
    tags.add('prusa');
  }
  if (lower.includes('ender') || lower.includes('creality')) {
    tags.add('creality');
  }
  
  // Size indicators
  const sizeMatch = lower.match(/(\d+)(mm|cm|inch)/);
  if (sizeMatch) {
    features.push(`${sizeMatch[1]}${sizeMatch[2]} size specified`);
  }
  
  // Multi-part indicators
  if (lower.includes('assembly') || lower.includes('set') || lower.match(/\d+x\d+/) || lower.match(/x\d+/)) {
    features.push('multi-part assembly');
    tags.add('assembly');
  }
  
  // Strength/material hints
  if (lower.includes('strong') || lower.includes('reinforced') || lower.includes('heavy')) {
    features.push('reinforced design');
  }
  if (lower.includes('flexible') || lower.includes('tpu')) {
    features.push('flexible material');
    tags.add('tpu');
  }
  
  // Support requirements
  if (lower.includes('no support') || lower.includes('supportless')) {
    features.push('no supports needed');
  }
  if (lower.includes('support') && !lower.includes('no support')) {
    features.push('supports required');
  }
  
  // Version/variant
  const versionMatch = lower.match(/v\d+(\.\d+)?/);
  if (versionMatch) {
    features.push(`version ${versionMatch[0]}`);
  }
  
  return {
    tags: Array.from(tags),
    features: features.length > 0 ? features : ['general model']
  };
}

/**
 * Extract metadata from 3MF file
 */
async function extract3MFMetadata(filePath) {
  try {
    const fileData = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(fileData);
    
    // Try to get the main model file
    const modelFile = zip.file('3D/3dmodel.model') || zip.file('3dmodel.model');
    if (!modelFile) {
      return null;
    }
    
    const xmlContent = await modelFile.async('string');
    
    // Extract metadata using regex (simpler than xml parser)
    const metadata = {};
    
    // Extract title
    const titleMatch = xmlContent.match(/<metadata\s+name=["']Title["']>(.*?)<\/metadata>/i);
    if (titleMatch) metadata.title = titleMatch[1];
    
    // Extract description
    const descMatch = xmlContent.match(/<metadata\s+name=["']Description["']>(.*?)<\/metadata>/i);
    if (descMatch) metadata.description = descMatch[1];
    
    // Extract designer/author
    const designerMatch = xmlContent.match(/<metadata\s+name=["'](Designer|Author|Creator)["']>(.*?)<\/metadata>/i);
    if (designerMatch) metadata.designer = designerMatch[2];
    
    // Extract application
    const appMatch = xmlContent.match(/<metadata\s+name=["']Application["']>(.*?)<\/metadata>/i);
    if (appMatch) metadata.application = appMatch[1];
    
    // Extract license
    const licenseMatch = xmlContent.match(/<metadata\s+name=["']License["']>(.*?)<\/metadata>/i);
    if (licenseMatch) metadata.license = licenseMatch[1];
    
    return metadata;
  } catch (error) {
    console.error('Error extracting 3MF metadata:', error.message);
    return null;
  }
}

/**
 * Analyze STL geometry for characteristics
 */
function analyzeSTLGeometry(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    
    // Check if binary STL
    const header = buffer.toString('utf8', 0, 80);
    if (!header.toLowerCase().includes('solid')) {
      // Binary STL
      const triangleCount = buffer.readUInt32LE(80);
      
      // Read all vertices to calculate bounds
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      
      let offset = 84;
      for (let i = 0; i < Math.min(triangleCount, 10000); i++) { // Sample first 10k triangles for speed
        offset += 12; // Skip normal
        
        for (let j = 0; j < 3; j++) {
          const x = buffer.readFloatLE(offset);
          const y = buffer.readFloatLE(offset + 4);
          const z = buffer.readFloatLE(offset + 8);
          
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
          
          offset += 12;
        }
        offset += 2; // Skip attribute
      }
      
      const width = maxX - minX;
      const depth = maxY - minY;
      const height = maxZ - minZ;
      
      return analyzeModelDimensions(width, depth, height, triangleCount);
    }
    
    return null;
  } catch (error) {
    console.error('Error analyzing STL geometry:', error.message);
    return null;
  }
}

/**
 * Analyze model dimensions and characteristics
 */
function analyzeModelDimensions(width, depth, height, triangleCount = 0) {
  const tags = [];
  const features = [];
  
  const maxDim = Math.max(width, depth, height);
  const minDim = Math.min(width, depth, height);
  
  // Size classification
  if (maxDim < 30) {
    tags.push('miniature');
    features.push('small model (< 30mm)');
  } else if (maxDim < 100) {
    tags.push('small');
    features.push('small to medium size');
  } else if (maxDim > 200) {
    tags.push('large');
    features.push('large print (> 200mm)');
  }
  
  // Shape classification
  const aspectRatio = height / Math.max(width, depth);
  if (aspectRatio > 2.5) {
    tags.push('vertical');
    features.push('tall vertical design');
  } else if (aspectRatio < 0.2) {
    tags.push('flat');
    features.push('flat/thin design');
  }
  
  // Check if approximately cubic
  if (Math.abs(width - depth) < maxDim * 0.1 && Math.abs(width - height) < maxDim * 0.1) {
    features.push('cubic/symmetrical');
  }
  
  // Complexity indicator based on triangle count
  if (triangleCount > 100000) {
    features.push('high detail model');
  } else if (triangleCount > 0 && triangleCount < 1000) {
    features.push('low poly design');
  }
  
  return {
    dimensions: `${Math.round(width)}×${Math.round(depth)}×${Math.round(height)}mm`,
    tags,
    features
  };
}

/**
 * Generate auto description and tags for a library file
 */
async function autoDescribeModel(filePath, fileName) {
  try {
    console.log(`Auto-analyzing: ${fileName}`);
    
    const results = {
      description: '',
      tags: [],
      metadata: null
    };
    
    // 1. Analyze filename
    const filenameAnalysis = analyzeFilename(fileName);
    results.tags.push(...filenameAnalysis.tags);
    
    // 2. Extract 3MF metadata if applicable
    if (fileName.toLowerCase().endsWith('.3mf')) {
      const metadata = await extract3MFMetadata(filePath);
      if (metadata) {
        results.metadata = metadata;
        
        // Use embedded title/description if available
        if (metadata.title && metadata.title !== fileName) {
          results.description = cleanHTMLText(metadata.title);
        }
        if (metadata.description) {
          results.description = cleanHTMLText(metadata.description);
        }
        if (metadata.designer) {
          results.tags.push('credited');
        }
      }
    }
    
    // 3. Analyze geometry for STL files
    let geometryAnalysis = null;
    if (fileName.toLowerCase().endsWith('.stl')) {
      geometryAnalysis = analyzeSTLGeometry(filePath);
      if (geometryAnalysis) {
        results.tags.push(...geometryAnalysis.tags);
      }
    }
    
    // 4. Build description if not already set
    if (!results.description) {
      const parts = [];
      
      // Start with filename-based features
      if (filenameAnalysis.features.length > 0) {
        parts.push(filenameAnalysis.features[0]);
      }
      
      // Add dimension info
      if (geometryAnalysis && geometryAnalysis.dimensions) {
        parts.push(geometryAnalysis.dimensions);
      }
      
      // Add notable features
      if (geometryAnalysis && geometryAnalysis.features.length > 0) {
        parts.push(geometryAnalysis.features[0]);
      }
      
      results.description = parts.join(' - ') || fileName.replace(/\.(3mf|stl|gcode)$/i, '');
    }
    
    // 5. Deduplicate and clean tags
    results.tags = [...new Set(results.tags)].filter(t => t && t.length > 0);
    
    // 6. Add default tag if none found
    if (results.tags.length === 0) {
      results.tags.push('3d-model');
    }
    
    console.log(`  Generated description: ${results.description}`);
    console.log(`  Generated tags: ${results.tags.join(', ')}`);
    
    return results;
  } catch (error) {
    console.error('Error in autoDescribeModel:', error);
    return {
      description: fileName.replace(/\.(3mf|stl|gcode)$/i, ''),
      tags: ['3d-model'],
      metadata: null
    };
  }
}

module.exports = {
  autoDescribeModel,
  analyzeFilename,
  extract3MFMetadata,
  analyzeSTLGeometry,
  cleanHTMLText,
  extractDescription
};
