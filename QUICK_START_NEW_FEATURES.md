# Quick Start Guide - New Features

## Installation

1. **Install Dependencies**
```bash
npm install
```

The new `xmldom` package is already added to package.json.

2. **Database Migration**
The new tables will be created automatically on first run. No manual migration needed.

## Using the New Features

### 1. Multi-Viewer Printer Cards

**How to use:**
- Navigate to the Printers page
- Use the view mode toggle (grid/list icons) to switch layouts
- Select card size from dropdown: Small, Medium, Large, or XL
- Your preferences are saved automatically

**What you'll see:**
- **Small cards**: Basic status and camera
- **Medium cards**: Standard view with printer details
- **Large cards**: Extended info with HMS errors and detailed stats
- **XL cards**: Everything including fan status

### 2. Re-print Feature

**How to re-print:**
1. Go to Print History
2. Find the print you want to repeat
3. Click "Re-print" button (you'll need to add this UI button)
4. Select target printer
5. Optionally adjust AMS mapping
6. Confirm

**Example API call:**
```javascript
fetch('/api/prints/MODEL_ID_HERE/reprint', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    device_id: 'printer_serial',
    ams_mapping: [0, 1, 2, 3], // Optional: map filaments to AMS slots
    plate_index: 0 // Optional: which plate if multi-plate
  })
});
```

### 3. HMS Error Monitoring

**Viewing errors:**
- Errors appear automatically in Large/XL card views
- Access full error history via API:

```javascript
fetch('/api/hms-errors?device_id=PRINTER_SERIAL')
  .then(res => res.json())
  .then(data => console.log(data.errors));
```

**Error statistics:**
```javascript
fetch('/api/hms-errors/stats?device_id=PRINTER_SERIAL&days=30')
  .then(res => res.json())
  .then(data => console.log(data.stats));
```

### 4. Advanced Printer Control

**Control chamber light:**
```javascript
fetch(`/api/printers/${deviceId}/chamber-light`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ on: true }) // or false to turn off
});
```

**Re-read AMS slot:**
```javascript
fetch(`/api/printers/${deviceId}/ams/${trayId}/refresh`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
});
```

**Configure AMS slot:**
```javascript
fetch(`/api/printers/${deviceId}/ams/${trayId}/config`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filament_type: 'PLA',
    color: 'FF5733',
    k_value: 0.03,
    nozzle_temp: { min: 200, max: 220 },
    bed_temp: 60
  })
});
```

**Skip objects during print:**
```javascript
fetch(`/api/printers/${deviceId}/skip-objects`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    object_ids: ['object_1', 'object_2']
  })
});
```

### 5. 3MF Metadata Extraction

**Parse 3MF file:**
```javascript
fetch('/api/3mf/parse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    file_path: '/path/to/file.3mf',
    model_id: 'print_model_id' // optional
  })
});
```

**Get metadata:**
```javascript
fetch('/api/3mf/metadata/MODEL_ID')
  .then(res => res.json())
  .then(data => console.log(data.metadata));
```

### 6. Advanced Search

**Search with filters:**
```javascript
const params = new URLSearchParams({
  query: 'search term',
  device_id: 'optional_printer_id',
  status: '1', // 1=success, 0=failed
  date_from: '2024-01-01',
  date_to: '2024-12-31',
  has_video: 'true',
  has_3mf: 'true',
  filament_type: 'PLA',
  min_weight: '10',
  max_weight: '100',
  limit: '20',
  offset: '0'
});

fetch(`/api/search/advanced?${params}`)
  .then(res => res.json())
  .then(data => {
    console.log(data.results); // Array of prints
    console.log(data.total); // Total count
  });
```

### 7. Fan Status Monitoring

**Get current fan status:**
```javascript
fetch('/api/fan-status/DEVICE_ID')
  .then(res => res.json())
  .then(data => console.log(data.fanStatus));
```

**Get fan history:**
```javascript
fetch('/api/fan-status/DEVICE_ID/history?hours=24')
  .then(res => res.json())
  .then(data => console.log(data.history));
```

## Adding UI Components

### Re-print Button in Print History

Add this to PrintHistory.tsx:

```tsx
<button 
  onClick={() => handleReprint(print.modelId)}
  className="btn-secondary"
  title="Re-print this model"
>
  🔄 Re-print
</button>
```

```tsx
const handleReprint = async (modelId: string) => {
  const deviceId = prompt('Enter printer serial number:');
  if (!deviceId) return;
  
  try {
    const response = await fetch(`/api/prints/${modelId}/reprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ device_id: deviceId })
    });
    
    if (response.ok) {
      alert('Print started successfully!');
    } else {
      const error = await response.json();
      alert(`Failed to start print: ${error.error}`);
    }
  } catch (err) {
    alert('Error starting print');
  }
};
```

### HMS Error Panel Component

Create a new component to display HMS errors:

```tsx
import { useState, useEffect } from 'react';

function HMSErrorPanel({ deviceId }: { deviceId: string }) {
  const [errors, setErrors] = useState([]);
  
  useEffect(() => {
    fetch(`/api/hms-errors?device_id=${deviceId}&limit=10`)
      .then(res => res.json())
      .then(data => setErrors(data.errors));
  }, [deviceId]);
  
  return (
    <div className="hms-panel">
      <h3>HMS Errors</h3>
      {errors.map(error => (
        <div key={error.id} className="error-item">
          <span className="error-code">HMS-{error.error_code}</span>
          <span className="error-message">{error.error_message}</span>
          <span className="error-time">{new Date(error.occurred_at).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
```

## Configuration

### Enable MQTT for All Features
Most features require MQTT connection. Ensure printers are configured with:
- IP address
- Access code
- Serial number

Navigate to Settings > Printers to configure.

### Discord Notifications for HMS Errors
HMS errors with `critical` severity automatically trigger Discord notifications if webhook is configured.

## Troubleshooting

### Re-print not working
- Ensure 3MF file exists for the print
- Verify printer has FTP enabled
- Check printer IP and access code are correct
- Confirm MQTT connection is active

### HMS errors not showing
- Verify MQTT connection is established
- Check printer is sending HMS data
- Look in browser console for errors

### 3MF parsing fails
- Ensure file is valid 3MF format
- Check file permissions
- Verify xmldom is installed: `npm list xmldom`

### Fan status not updating
- MQTT connection required
- Some printer models may not report fan data
- Check MQTT client logs for data

## Performance Notes

- HMS errors are stored indefinitely - consider adding cleanup job for old errors
- Fan status history can grow large - default query limits to 24 hours
- 3MF parsing is CPU-intensive - done on-demand, not automatically
- Advanced search with large datasets may be slow - use appropriate limits

## Security Considerations

- All endpoints require authentication
- File paths are sanitized to prevent traversal
- MQTT commands validated before sending
- FTP credentials stored securely in database

## Support

For issues or questions:
1. Check NEW_FEATURES.md for detailed documentation
2. Review API endpoint documentation
3. Check browser console for errors
4. Review server logs for backend issues

---

**Happy Printing!** 🚀
