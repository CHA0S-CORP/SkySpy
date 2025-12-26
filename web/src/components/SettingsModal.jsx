import React, { useState } from 'react';
import { X } from 'lucide-react';
import { saveConfig } from '../utils';

export function SettingsModal({ config, setConfig, onClose }) {
  const [form, setForm] = useState(config);

  const handleSave = () => {
    setConfig(form);
    saveConfig(form);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings</h3>
          <button onClick={onClose}><X size={20} /></button>
        </div>
        <div className="modal-content">
          <div className="settings-grid">
            <div className="settings-section">
              <h4>API Configuration</h4>
              <div className="form-group">
                <label>API Base URL</label>
                <input
                  type="text"
                  value={form.apiBaseUrl}
                  onChange={e => setForm({ ...form, apiBaseUrl: e.target.value })}
                  placeholder="Leave empty for same origin"
                />
              </div>
            </div>

            <div className="settings-section">
              <h4>Map Display</h4>
              <div className="form-row">
                <div className="form-group">
                  <label>Map Mode</label>
                  <select
                    value={form.mapMode}
                    onChange={e => setForm({ ...form, mapMode: e.target.value })}
                  >
                    <option value="pro">Pro View</option>
                    <option value="radar">Radar View</option>
                    <option value="crt">ATC Radar (CRT)</option>
                    <option value="map">Map View</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Map Theme</label>
                  <select
                    value={form.mapDarkMode ? 'dark' : 'light'}
                    onChange={e => setForm({ ...form, mapDarkMode: e.target.value === 'dark' })}
                  >
                    <option value="dark">Dark Mode</option>
                    <option value="light">Light Mode</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>Save Settings</button>
          </div>
        </div>
      </div>
    </div>
  );
}
