import { useState, useEffect } from 'react';
import { API_ENDPOINTS } from '../../config/api';
import fetchWithRetry from '../../utils/fetchWithRetry';
import { useSettingsContext } from './SettingsContext';
import { CollapsibleSection } from './CollapsibleSection';
import { MaterialCosts } from './types';

export function CostSettings() {
  const { setToast } = useSettingsContext();
  const [filamentCostPerKg, setFilamentCostPerKg] = useState(25);
  const [electricityCostPerKwh, setElectricityCostPerKwh] = useState(0.12);
  const [printerWattage, setPrinterWattage] = useState(150);
  const [costCurrency, setCostCurrency] = useState('USD');
  const [costLoading, setCostLoading] = useState(false);
  const [materialCosts, setMaterialCosts] = useState<MaterialCosts>({
    PLA: 20,
    'PLA-CF': 35,
    PETG: 25,
    ABS: 25,
    TPU: 40,
    'PLA-Glow': 30,
    'PLA-Silk': 28,
    'PLA-Matte': 22,
    ASA: 30,
    PA: 50,
    'PA-CF': 70,
    PVA: 45,
    HIPS: 30
  });

  useEffect(() => {
    loadCostSettings();
  }, []);

  const loadCostSettings = async () => {
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.COSTS, { credentials: 'include' });
      const data = await response.json();
      if (response.ok) {
        setFilamentCostPerKg(data.filamentCostPerKg ?? 25);
        setElectricityCostPerKwh(data.electricityCostPerKwh ?? 0.12);
        setPrinterWattage(data.printerWattage ?? 150);
        setCostCurrency(data.currency ?? 'USD');
        if (data.materialCosts) {
          setMaterialCosts(data.materialCosts);
        }
      }
    } catch (error) {
      console.error('Failed to load cost settings:', error);
    }
  };

  const handleSaveCostSettings = async () => {
    setCostLoading(true);
    try {
      const response = await fetchWithRetry(API_ENDPOINTS.SETTINGS.COSTS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filamentCostPerKg,
          electricityCostPerKwh,
          printerWattage,
          currency: costCurrency,
          materialCosts
        }),
        credentials: 'include'
      });
      const data = await response.json();
      if (data.success) {
        setToast({ message: 'Cost settings saved!', type: 'success' });
      } else {
        setToast({ message: 'Failed to save cost settings', type: 'error' });
      }
    } catch (error) {
      setToast({ message: 'Failed to save cost settings', type: 'error' });
    } finally {
      setCostLoading(false);
    }
  };

  return (
    <CollapsibleSection title="Cost Calculator" icon="💰">

      <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
        <label>Currency</label>
        <select
          value={costCurrency}
          onChange={(e) => setCostCurrency(e.target.value)}
          disabled={costLoading}
        >
          <option value="USD">USD ($)</option>
          <option value="EUR">EUR (€)</option>
          <option value="GBP">GBP (£)</option>
          <option value="CAD">CAD ($)</option>
          <option value="AUD">AUD ($)</option>
          <option value="JPY">JPY (¥)</option>
          <option value="CNY">CNY (¥)</option>
        </select>
      </div>
      
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
          <label>Filament $/kg</label>
          <input
            type="number"
            value={filamentCostPerKg}
            onChange={(e) => setFilamentCostPerKg(parseFloat(e.target.value) || 0)}
            placeholder="25"
            min="0"
            step="0.01"
            disabled={costLoading}
          />
        </div>
        
        <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
          <label>Electricity $/kWh</label>
          <input
            type="number"
            value={electricityCostPerKwh}
            onChange={(e) => setElectricityCostPerKwh(parseFloat(e.target.value) || 0)}
            placeholder="0.12"
            min="0"
            step="0.001"
            disabled={costLoading}
          />
        </div>
      </div>
      
      <div className="mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
        <label>Printer Wattage</label>
        <input
          type="number"
          value={printerWattage}
          onChange={(e) => setPrinterWattage(parseInt(e.target.value) || 0)}
          placeholder="150"
          min="0"
          step="1"
          disabled={costLoading}
        />
        <small className="mt-1.5 block text-xs text-muted">
          Average power consumption (typically 100-200W)
        </small>
      </div>

      <div className="mt-8 mb-4 [&>label]:mb-1.5 [&>label]:block [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted [&>input]:w-full [&>select]:w-full">
        <label>Material-Specific Pricing ($/kg)</label>
        <small className="mb-4 block text-xs text-muted">
          Set individual prices per material type. Leave blank to use default filament cost.
        </small>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(materialCosts).sort(([a], [b]) => a.localeCompare(b)).map(([material, cost]) => (
            <div key={material} className="flex items-center gap-2">
              <label className="min-w-20 text-sm text-fg-soft">{material}:</label>
              <input
                type="number"
                value={cost}
                onChange={(e) => setMaterialCosts(prev => ({
                  ...prev,
                  [material]: parseFloat(e.target.value) || 0
                }))}
                placeholder="0"
                min="0"
                step="0.01"
                disabled={costLoading}
                className="min-w-20 flex-1"
              />
            </div>
          ))}
        </div>
      </div>
      
      <button 
        type="button" 
        className="inline-flex min-h-11 md:min-h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none bg-accent text-accent-contrast hover:bg-accent-strong" 
        onClick={handleSaveCostSettings}
        disabled={costLoading}
      >
        {costLoading ? 'Saving...' : 'Save Cost Settings'}
      </button>
    </CollapsibleSection>
  );
}
