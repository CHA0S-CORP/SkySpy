import React, { useRef, useEffect } from 'react';
import { Layers, X, Radio, Plane, Cloud, AlertTriangle, MapPin } from 'lucide-react';

/**
 * Menu for toggling aviation data overlays
 */
export function OverlayMenu({
  show,
  overlays,
  onOverlaysChange,
  onClose
}) {
  const menuRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    if (!show) return;

    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    // Small delay to prevent immediate close when opening
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [show, onClose]);

  // Close on Escape key
  useEffect(() => {
    if (!show) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [show, onClose]);

  if (!show) return null;

  const handleToggle = (key) => {
    onOverlaysChange({ ...overlays, [key]: !overlays[key] });
  };

  return (
    <div className="overlay-menu" ref={menuRef}>
      <div className="overlay-menu-header">
        <Layers size={16} />
        <span>Map Overlays</span>
        <button className="overlay-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      
      <div className="overlay-menu-content">
        <div className="overlay-section">
          <div className="overlay-section-title">Navigation</div>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.navaids}
              onChange={() => handleToggle('navaids')}
            />
            <Radio size={14} />
            <span>NAVAIDs (VOR/NDB)</span>
          </label>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.airports}
              onChange={() => handleToggle('airports')}
            />
            <Plane size={14} />
            <span>Airports</span>
          </label>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.waypoints}
              onChange={() => handleToggle('waypoints')}
            />
            <MapPin size={14} />
            <span>Waypoints</span>
          </label>
        </div>
        
        <div className="overlay-section">
          <div className="overlay-section-title">Airspace</div>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.airspace}
              onChange={() => handleToggle('airspace')}
            />
            <span>Controlled Airspace</span>
          </label>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.tfrs}
              onChange={() => handleToggle('tfrs')}
            />
            <AlertTriangle size={14} />
            <span>TFRs</span>
          </label>
        </div>
        
        <div className="overlay-section">
          <div className="overlay-section-title">Weather</div>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.metars}
              onChange={() => handleToggle('metars')}
            />
            <Cloud size={14} />
            <span>METARs</span>
          </label>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.pireps}
              onChange={() => handleToggle('pireps')}
            />
            <AlertTriangle size={14} />
            <span>PIREPs</span>
          </label>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.radar}
              onChange={() => handleToggle('radar')}
            />
            <span>Weather Radar</span>
          </label>
        </div>
        
        <div className="overlay-section">
          <div className="overlay-section-title">Display</div>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.rangeRings}
              onChange={() => handleToggle('rangeRings')}
            />
            <span>Range Rings</span>
          </label>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.trails}
              onChange={() => handleToggle('trails')}
            />
            <span>Aircraft Trails</span>
          </label>
          
          <label className="overlay-toggle">
            <input 
              type="checkbox"
              checked={overlays.labels}
              onChange={() => handleToggle('labels')}
            />
            <span>Aircraft Labels</span>
          </label>
        </div>
      </div>
    </div>
  );
}

export default OverlayMenu;
