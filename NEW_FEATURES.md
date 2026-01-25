# New Features Added - Bambuddy Enhancements

## Overview
This update adds 7 major feature sets inspired by Bambuddy to enhance PrintHive's functionality and user experience.

## 🎯 Features Implemented

### 1. **HMS Error Monitoring** ✅
Health Management System (HMS) error tracking and analysis.

**Backend:**
- New database table `hms_errors` for storing error history
- Automatic HMS error capture from MQTT messages
- Error severity classification (warning, critical)
- Error resolution tracking

**API Endpoints:**
- `GET /api/hms-errors` - List HMS errors with filtering
- `GET /api/hms-errors/stats` - Get error statistics
- `POST /api/hms-errors/:id/resolve` - Mark error as resolved

**Features:**
- Automatic error detection and logging
- Historical error tracking per printer
- Error trend analysis
- Critical error notifications via Discord

---

### 2. **Fan Status Monitoring** ✅
Real-time fan speed monitoring and historical tracking.

**Backend:**
- New database table `fan_status_history`
- Capture fan data from MQTT:
  - Part cooling fan
  - Auxiliary fan
  - Chamber fan
  - MC fan
  - Heatbreak fan

**API Endpoints:**
- `GET /api/fan-status/:device_id` - Get latest fan status
- `GET /api/fan-status/:device_id/history` - Get fan status history

**Features:**
- Real-time fan speed tracking
- Fan status history
- Per-printer fan monitoring
- Display in XL card view

---

### 3. **3MF File Metadata Extraction** ✅
Parse and extract comprehensive metadata from 3MF files.

**Backend:**
- New parser module `threemf-parser.js`
- Database table `print_3mf_metadata`
- Extract from 3MF files:
  - Print settings (layer height, infill, speeds)
  - Temperatures (nozzle, bed)
  - Filament info (type, brand, color)
  - Embedded thumbnails
  - Slicer version and settings

**API Endpoints:**
- `POST /api/3mf/parse` - Parse 3MF file and store metadata
- `GET /api/3mf/metadata/:model_id` - Get stored metadata

**Dependencies Added:**
- `xmldom@^0.6.0` - XML parsing for 3MF structure

**Features:**
- Automatic metadata extraction
- Thumbnail extraction from 3MF
- Detailed print settings preservation
- Searchable metadata

---

### 4. **Re-print with AMS Mapping** ✅
Send previous prints back to any printer with automatic or manual AMS slot mapping.

**API Endpoint:**
- `POST /api/prints/:model_id/reprint`

**Request Body:**
```json
{
  "device_id": "printer_serial",
  "ams_mapping": [0, 1, 2, 3],
  "plate_index": 0
}
```

**Features:**
- Re-print any archived print to any connected printer
- Automatic AMS slot mapping based on filament colors
- Manual slot override option
- Multi-plate support
- FTP upload of 3MF file to printer
- MQTT command to start print

**Workflow:**
1. Retrieve 3MF file from print history
2. Upload file to target printer via FTP
3. Send MQTT print command with AMS mapping
4. Start print automatically

---

### 5. **Advanced Printer Control** ✅
Enhanced printer control capabilities via MQTT.

**API Endpoints:**
- `POST /api/printers/:device_id/command` - Send custom command
- `POST /api/printers/:device_id/skip-objects` - Skip objects during print
- `POST /api/printers/:device_id/ams/:tray_id/refresh` - Re-read AMS RFID
- `POST /api/printers/:device_id/ams/:tray_id/config` - Configure AMS slot
- `POST /api/printers/:device_id/chamber-light` - Control chamber light

**Features:**

**Skip Objects:**
- Skip failed or unwanted objects during multi-part prints
- Send `EXCLUDE_OBJECT` G-code command

**AMS Slot Control:**
- Re-read RFID tags to refresh filament info
- Configure custom filament profiles
- Set K-factor values
- Define temperature ranges
- Assign colors manually

**Chamber Light:**
- Toggle chamber lighting on/off
- Useful for camera monitoring

---

### 6. **Multi-Viewer Camera Support** ✅
Flexible printer card views with multiple size options.

**Frontend Updates:**
- Resizable printer cards (Small, Medium, Large, XL)
- Grid and List view modes
- Responsive layouts
- Enhanced printer information display

**Card Sizes:**
- **Small** (250px): Compact view, camera + basic status
- **Medium** (350px): Default view with details
- **Large** (450px): Extended info with HMS errors
- **XL** (600px): Full details with fan status and stats

**New Displays:**
- Real-time print statistics
- Fan status indicators
- HMS error summaries
- Enhanced AMS information
- Temperature monitoring
- Layer progress tracking

**UI Controls:**
- View mode selector (Grid/List)
- Card size dropdown
- Persistent preferences in localStorage

**CSS File:**
- `src/components/PrintersEnhancements.css` - New styling for multi-viewer

---

### 7. **Advanced Search** ✅
Comprehensive search across all print metadata.

**API Endpoint:**
- `GET /api/search/advanced`

**Search Parameters:**
```
query - Full-text search across title, design, device, material
device_id - Filter by specific printer
status - Filter by print status
date_from - Start date filter
date_to - End date filter
has_video - Filter prints with/without video
has_3mf - Filter prints with/without 3MF file
filament_type - Filter by filament material
min_weight - Minimum weight filter
max_weight - Maximum weight filter
limit - Results per page
offset - Pagination offset
```

**Features:**
- Full-text search across multiple fields
- Advanced filtering options
- 3MF metadata integration
- Date range filtering
- Pagination support
- Result count and statistics

---

## 📁 Files Modified

### Backend
1. **database.js** - Added tables and functions:
   - `hms_errors` table
   - `fan_status_history` table
   - `print_3mf_metadata` table
   - Database functions for all new features

2. **mqtt-client.js** - Enhanced MQTT handling:
   - HMS error detection and emission
   - Fan status capture and emission
   - Real-time error tracking

3. **simple-server.js** - New API endpoints:
   - HMS error endpoints (3)
   - Fan status endpoints (2)
   - 3MF parsing endpoints (2)
   - Printer control endpoints (5)
   - Re-print endpoint (1)
   - Advanced search endpoint (1)
   - Event handlers for HMS/fan data

4. **threemf-parser.js** - NEW FILE:
   - 3MF file parsing
   - Metadata extraction
   - Thumbnail extraction
   - Bambu Studio config parsing

### Frontend
5. **src/components/Printers.tsx** - Enhanced UI:
   - Multi-viewer support
   - Card size controls
   - View mode selector
   - HMS error display
   - Fan status display
   - Enhanced stat grids

6. **src/components/PrintersEnhancements.css** - NEW FILE:
   - Multi-viewer styles
   - Card size variations
   - Grid/list layouts
   - HMS error styling
   - Fan status styling
   - Responsive design

7. **src/config/api.ts** - API endpoint definitions:
   - HMS endpoints
   - Fan endpoints
   - 3MF endpoints
   - Printer control endpoints
   - Re-print endpoint
   - Advanced search endpoint

8. **package.json** - Dependencies:
   - Added `xmldom@^0.6.0`

---

## 🚀 Usage Examples

### Re-print a Model
```javascript
// Frontend call
const response = await fetch(`/api/prints/${modelId}/reprint`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    device_id: 'printer_serial_123',
    ams_mapping: [0, 1, 2, 3], // Map to AMS slots
    plate_index: 0
  })
});
```

### Control Chamber Light
```javascript
const response = await fetch(`/api/printers/${deviceId}/chamber-light`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ on: true })
});
```

### Advanced Search
```javascript
const params = new URLSearchParams({
  query: 'benchy',
  device_id: 'printer_123',
  has_video: 'true',
  date_from: '2024-01-01',
  limit: '20'
});

const response = await fetch(`/api/search/advanced?${params}`);
const { results, total } = await response.json();
```

### Get HMS Errors
```javascript
const response = await fetch(`/api/hms-errors?device_id=${deviceId}&limit=10`);
const { errors } = await response.json();
```

### Configure AMS Slot
```javascript
const response = await fetch(`/api/printers/${deviceId}/ams/${trayId}/config`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filament_type: 'PLA',
    color: 'FF5733',
    nozzle_temp: { min: 200, max: 220 },
    bed_temp: 60
  })
});
```

---

## 🗄️ Database Schema Changes

### New Tables Created
```sql
-- HMS Errors
CREATE TABLE IF NOT EXISTS hms_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  device_name TEXT,
  error_code INTEGER NOT NULL,
  error_attr INTEGER,
  error_message TEXT,
  severity TEXT,
  module TEXT,
  occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  status TEXT DEFAULT 'active'
);

-- Fan Status History
CREATE TABLE IF NOT EXISTS fan_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  device_name TEXT,
  part_cooling_fan INTEGER,
  aux_fan INTEGER,
  chamber_fan INTEGER,
  mc_fan INTEGER,
  heatbreak_fan INTEGER,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3MF Metadata
CREATE TABLE IF NOT EXISTS print_3mf_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT UNIQUE NOT NULL,
  layer_height REAL,
  initial_layer_height REAL,
  wall_thickness REAL,
  top_layers INTEGER,
  bottom_layers INTEGER,
  infill_density INTEGER,
  infill_pattern TEXT,
  support_type TEXT,
  print_speed INTEGER,
  travel_speed INTEGER,
  nozzle_temp INTEGER,
  bed_temp INTEGER,
  filament_type TEXT,
  filament_brand TEXT,
  filament_color TEXT,
  estimated_time INTEGER,
  estimated_filament REAL,
  thumbnail_data TEXT,
  slicer_version TEXT,
  metadata_json TEXT,
  FOREIGN KEY (model_id) REFERENCES prints(modelId)
);
```

---

## 📝 Notes

1. **MQTT Connection Required**: Most advanced features require active MQTT connection to printers
2. **3MF Files**: Re-print feature requires 3MF files to be stored in the database
3. **FTP Access**: Re-print feature uses Bambu FTP to upload files
4. **Persistent Storage**: All HMS errors and fan data are stored permanently
5. **Real-time Updates**: Fan and HMS data update automatically via MQTT

---

## 🔄 Next Steps (Optional Enhancements)

Features not yet implemented but available in Bambuddy:

1. **Print Queue System** - Schedule and queue multiple prints
2. **Timelapse Video Editor** - Trim, speed adjust, add music
3. **Archive Comparison** - Side-by-side print comparison
4. **Multi-plate Support** - Better handling of multi-plate projects

---

## 🐛 Testing Checklist

- [ ] HMS errors are captured and stored
- [ ] Fan status updates in real-time
- [ ] 3MF parsing extracts metadata correctly
- [ ] Re-print uploads file and starts print
- [ ] Advanced search returns accurate results
- [ ] Printer controls work via MQTT
- [ ] Multi-viewer displays correctly at all sizes
- [ ] Discord notifications include HMS errors

---

## 📚 API Documentation Summary

**Total New Endpoints: 14**
- HMS: 3 endpoints
- Fan: 2 endpoints
- 3MF: 2 endpoints
- Printer Control: 5 endpoints
- Re-print: 1 endpoint
- Search: 1 endpoint

All endpoints require authentication and use the existing session middleware.

---

**Implementation Complete!** ✅

Your PrintHive now has feature parity with Bambuddy in the areas you requested, with some enhancements tailored to your existing architecture.
