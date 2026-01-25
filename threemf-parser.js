const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { DOMParser } = require('xmldom');
const logger = require('./logger');

/**
 * Parse 3MF file and extract metadata, thumbnails, and print settings
 * @param {string} filePath - Path to 3MF file
 * @returns {Object} Metadata object with all extracted information
 */
function parse3mfFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    
    const metadata = {
      model_id: path.basename(filePath, '.3mf'),
      layer_height: null,
      initial_layer_height: null,
      wall_thickness: null,
      top_layers: null,
      bottom_layers: null,
      infill_density: null,
      infill_pattern: null,
      support_type: null,
      print_speed: null,
      travel_speed: null,
      nozzle_temp: null,
      bed_temp: null,
      filament_type: null,
      filament_brand: null,
      filament_color: null,
      estimated_time: null,
      estimated_filament: null,
      thumbnail_data: null,
      slicer_version: null,
      metadata_json: {}
    };

    // Look for Bambu Studio config files
    const configEntry = zipEntries.find(entry => 
      entry.entryName.includes('Metadata/model_settings.config') ||
      entry.entryName.includes('Metadata/slice_info.config')
    );

    if (configEntry) {
      const configContent = zip.readAsText(configEntry);
      metadata.metadata_json = parseConfigFile(configContent);
      
      // Extract specific fields from config
      const config = metadata.metadata_json;
      if (config.layer_height) metadata.layer_height = parseFloat(config.layer_height);
      if (config.initial_layer_height) metadata.initial_layer_height = parseFloat(config.initial_layer_height);
      if (config.wall_loops) metadata.wall_thickness = parseInt(config.wall_loops);
      if (config.top_shell_layers) metadata.top_layers = parseInt(config.top_shell_layers);
      if (config.bottom_shell_layers) metadata.bottom_layers = parseInt(config.bottom_shell_layers);
      if (config.sparse_infill_density) metadata.infill_density = parseInt(config.sparse_infill_density);
      if (config.sparse_infill_pattern) metadata.infill_pattern = config.sparse_infill_pattern;
      if (config.support_type) metadata.support_type = config.support_type;
      if (config.outer_wall_speed) metadata.print_speed = parseInt(config.outer_wall_speed);
      if (config.travel_speed) metadata.travel_speed = parseInt(config.travel_speed);
      if (config.nozzle_temperature) metadata.nozzle_temp = parseInt(config.nozzle_temperature);
      if (config.bed_temperature) metadata.bed_temp = parseInt(config.bed_temperature);
      if (config.filament_type) metadata.filament_type = config.filament_type;
      if (config.filament_vendor) metadata.filament_brand = config.filament_vendor;
      if (config.filament_colour) metadata.filament_color = config.filament_colour;
      if (config.estimated_time) metadata.estimated_time = parseInt(config.estimated_time);
      if (config.total_filament_used) metadata.estimated_filament = parseFloat(config.total_filament_used);
    }

    // Look for thumbnail (Bambu Studio stores it as plate_1.png)
    const thumbnailEntry = zipEntries.find(entry => 
      entry.entryName.includes('Metadata/plate_') && entry.entryName.endsWith('.png')
    );

    if (thumbnailEntry) {
      const thumbnailBuffer = zip.readFile(thumbnailEntry);
      metadata.thumbnail_data = `data:image/png;base64,${thumbnailBuffer.toString('base64')}`;
    }

    // Parse 3D model file for slicer info
    const modelEntry = zipEntries.find(entry => entry.entryName.endsWith('.model'));
    if (modelEntry) {
      const modelXml = zip.readAsText(modelEntry);
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(modelXml, 'text/xml');
      
      // Look for metadata in XML
      const metadataElements = xmlDoc.getElementsByTagName('metadata');
      for (let i = 0; i < metadataElements.length; i++) {
        const elem = metadataElements[i];
        const name = elem.getAttribute('name');
        const value = elem.textContent;
        
        if (name === 'Application') {
          metadata.slicer_version = value;
        }
      }
    }

    // Convert metadata_json to string for storage
    metadata.metadata_json = JSON.stringify(metadata.metadata_json);

    logger.info(`Successfully parsed 3MF file: ${filePath}`);
    return metadata;

  } catch (error) {
    logger.error(`Error parsing 3MF file ${filePath}:`, error);
    return null;
  }
}

/**
 * Parse Bambu Studio config file format
 * @param {string} content - Config file content
 * @returns {Object} Parsed config object
 */
function parseConfigFile(content) {
  const config = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }
    
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex > 0) {
      const key = trimmed.substring(0, separatorIndex).trim();
      const value = trimmed.substring(separatorIndex + 1).trim();
      config[key] = value;
    }
  }
  
  return config;
}

/**
 * Extract thumbnail from 3MF file
 * @param {string} filePath - Path to 3MF file
 * @returns {Buffer|null} Thumbnail image buffer or null
 */
function extract3mfThumbnail(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    
    const thumbnailEntry = zipEntries.find(entry => 
      entry.entryName.includes('Metadata/plate_') && entry.entryName.endsWith('.png')
    );

    if (thumbnailEntry) {
      return zip.readFile(thumbnailEntry);
    }
    
    return null;
  } catch (error) {
    logger.error(`Error extracting thumbnail from ${filePath}:`, error);
    return null;
  }
}

/**
 * Check if file is a valid 3MF
 * @param {string} filePath - Path to file
 * @returns {boolean} True if valid 3MF
 */
function is3mfFile(filePath) {
  try {
    if (!filePath.toLowerCase().endsWith('.3mf')) {
      return false;
    }
    
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    
    // 3MF files should have a .model file
    return entries.some(entry => entry.entryName.endsWith('.model'));
  } catch (error) {
    return false;
  }
}

module.exports = {
  parse3mfFile,
  extract3mfThumbnail,
  is3mfFile
};
