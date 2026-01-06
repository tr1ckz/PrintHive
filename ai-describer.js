const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

/**
 * Detect if text is in non-English language
 */
function detectLanguage(text) {
  if (!text) return 'en';
  
  // Chinese characters (CJK)
  if (/[\u4E00-\u9FFF\u3040-\u309F\uAC00-\uD7AF]/.test(text)) {
    if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
    if (/[\u3040-\u309F]/.test(text)) return 'ja';
    if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  }
  
  // Cyrillic (Russian, etc)
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  
  // Arabic
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  
  // Hebrew
  if (/[\u0590-\u05FF]/.test(text)) return 'he';
  
  // Thai
  if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
  
  // Vietnamese
  if (/[\u0102\u0103\u0110\u0111\u0128\u0129\u0168\u0169\u01A0\u01A1]/.test(text)) return 'vi';
  
  return 'en';
}

/**
 * Simple translation mapping for common terms (without external API)
 */
function translateSimple(text, targetLang = 'en') {
  if (targetLang === 'en' || !text) return text;
  
  // Just detect and note that translation would be needed
  // In production, you'd use Google Translate API or similar
  return text; // Return original for now
}

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
 * Truncate description to a reasonable length
 */
function truncateDescription(text, maxLength = 300) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  
  // Try to truncate at sentence boundary
  const truncated = text.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('.');
  const lastNewline = truncated.lastIndexOf('\n');
  const lastComma = truncated.lastIndexOf(',');
  
  if (lastPeriod > maxLength * 0.8) {
    return truncated.substring(0, lastPeriod + 1);
  }
  if (lastNewline > maxLength * 0.8) {
    return truncated.substring(0, lastNewline);
  }
  if (lastComma > maxLength * 0.8) {
    return truncated.substring(0, lastComma);
  }
  
  // Otherwise add ellipsis
  return truncated.substring(0, maxLength - 3) + '...';
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
  
  // More specific category detection with priority
  const categories = {
    'functional': ['bracket', 'mount', 'holder', 'clip', 'hook', 'stand', 'organizer', 'adapter', 'tool', 'jig', 'fixture', 'rack', 'shelf', 'organizer'],
    'decorative': ['vase', 'pot', 'planter', 'ornament', 'decoration', 'statue', 'sculpture', 'plant pot'],
    'toy': ['toy', 'figure', 'miniature', 'figurine', 'character', 'dragon', 'robot', 'doll', 'action figure'],
    'mechanical': ['gear', 'bearing', 'hinge', 'wheel', 'axle', 'pulley', 'spring', 'cam', 'crank'],
    'storage': ['box', 'case', 'container', 'tray', 'drawer', 'bin', 'organizer', 'shelf'],
    'household': ['coaster', 'opener', 'spoon', 'fork', 'cup', 'plate', 'bowl', 'bottle', 'dispenser'],
    'game': ['dice', 'token', 'card', 'board', 'chess', 'puzzle', 'mini'],
    'electronics': ['enclosure', 'raspberry', 'arduino', 'pi', 'esp', 'pcb', 'cable', 'case', 'box'],
    'automotive': ['car', 'vehicle', 'wheel', 'bumper', 'spoiler', 'mount'],
    'medical': ['splint', 'brace', 'prosthetic', 'organizer', 'holder'],
    'wearable': ['headband', 'glasses', 'earring', 'necklace', 'bracelet', 'ring', 'pendant', 'jewelry', 'costume', 'mask', 'helmet', 'crown', 'tiara', 'badge', 'pin'],
    'kitchen': ['holder', 'organizer', 'rack', 'dispenser', 'container', 'utensil'],
    'office': ['organizer', 'holder', 'stand', 'caddy', 'desk'],
    'garden': ['planter', 'pot', 'bed', 'fence'],
    'tool': ['holder', 'organizer', 'stand', 'rack', 'wall mount']
  };
  
  // Check each category
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => lower.includes(keyword))) {
      tags.add(category);
    }
  }
  
  // More specific detections
  if (lower.includes('spool') || lower.includes('filament')) {
    tags.add('3d-printing');
    if (lower.includes('holder')) tags.add('functional');
  }
  
  if (lower.includes('rack')) {
    tags.add('storage');
    tags.add('functional');
  }
  
  if (lower.includes('measure') || lower.includes('tape')) {
    tags.add('tool');
    tags.add('functional');
  }
  
  if (lower.includes('remix') || lower.includes('mod') || lower.includes('modified')) {
    tags.add('remix');
  }
  
  // Year/date detection
  const yearMatch = lower.match(/20\d{2}/);
  if (yearMatch) {
    features.push(`${yearMatch[0]} themed`);
  }
  
  // Specific item detection
  if (lower.includes('benchy') || lower.includes('3dbenchy')) {
    tags.add('calibration');
  }
  if (lower.includes('calibration') || lower.includes('test')) {
    tags.add('calibration');
  }
  if (lower.includes('prototype')) {
    tags.add('prototype');
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
  
  // Material hints
  if (lower.includes('flexible') || lower.includes('tpu') || lower.includes('flex')) {
    tags.add('flexible');
  }
  if (lower.includes('strong') || lower.includes('reinforced') || lower.includes('heavy') || lower.includes('structural')) {
    tags.add('reinforced');
  }
  if (lower.includes('light') || lower.includes('lightweight')) {
    tags.add('lightweight');
  }
  
  // Multi-part indicators
  if (lower.includes('assembly') || lower.includes('set') || lower.match(/part\s*\d+/) || lower.match(/\d+.*piece/)) {
    tags.add('assembly');
  }
  
  return {
    tags: Array.from(tags),
    features: features.length > 0 ? features : []
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
      metadata: null,
      language: 'en'
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
          const rawDesc = cleanHTMLText(metadata.description);
          results.description = rawDesc;
          
          // Detect language of description
          results.language = detectLanguage(rawDesc);
        }
        // Remove 'credited' tag - use specific designer tag instead if available
        if (metadata.designer) {
          results.tags.push('remix');
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
    
    // 5. Truncate description to reasonable length for display
    results.description = truncateDescription(results.description, 300);
    
    // 6. Deduplicate and clean tags

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
  extractDescription,
  truncateDescription,
  detectLanguage
};
