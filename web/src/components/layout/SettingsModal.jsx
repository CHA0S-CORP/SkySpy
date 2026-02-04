import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { saveConfig } from '../../utils/config';

export function SettingsModal({ config, setConfig, onClose }) {
  const [form, setForm] = useState(config);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSave = () => {
    setConfig(form);
    saveConfig(form);
    onClose();
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <div className="modal-header">
          <h3 id="settings-modal-title">Settings</h3>
          <button onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-content">
          <div className="settings-grid">
            <div className="settings-section">
              <h4>API Configuration</h4>
              <div className="form-group">
                <label htmlFor="api-base-url">API Base URL</label>
                <input
                  id="api-base-url"
                  type="text"
                  value={form.apiBaseUrl}
                  onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                  placeholder="Leave empty for same origin"
                />
              </div>
            </div>

            <div className="settings-section">
              <h4>Map Display</h4>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="map-mode">Map Mode</label>
                  <select
                    id="map-mode"
                    value={form.mapMode}
                    onChange={(e) => setForm({ ...form, mapMode: e.target.value })}
                  >
                    <option value="pro">Pro View</option>
                    <option value="radar">Radar View</option>
                    <option value="crt">ATC Radar (CRT)</option>
                    <option value="map">Map View</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="map-theme">Map Theme</label>
                  <select
                    id="map-theme"
                    value={form.mapDarkMode ? 'dark' : 'light'}
                    onChange={(e) => setForm({ ...form, mapDarkMode: e.target.value === 'dark' })}
                  >
                    <option value="dark">Dark Mode</option>
                    <option value="light">Light Mode</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave}>
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
