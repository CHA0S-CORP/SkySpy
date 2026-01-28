import React, { useRef, useEffect } from 'react';
import { Filter, X } from 'lucide-react';

/**
 * Traffic filter menu for filtering displayed aircraft
 */
export function FilterMenu({
  show,
  filters,
  onFiltersChange,
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

  const handleChange = (key, value) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <div className="filter-menu" ref={menuRef}>
      <div className="filter-menu-header">
        <Filter size={16} />
        <span>Traffic Filters</span>
        <button className="filter-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      
      <div className="filter-menu-content">
        <div className="filter-section">
          <div className="filter-section-title">Aircraft Type</div>
          
          <label className="filter-toggle">
            <input 
              type="checkbox"
              checked={filters.showMilitary}
              onChange={(e) => handleChange('showMilitary', e.target.checked)}
            />
            <span>Military</span>
          </label>
          
          <label className="filter-toggle">
            <input 
              type="checkbox"
              checked={filters.showCivil}
              onChange={(e) => handleChange('showCivil', e.target.checked)}
            />
            <span>Civil</span>
          </label>
        </div>
        
        <div className="filter-section">
          <div className="filter-section-title">Status</div>
          
          <label className="filter-toggle">
            <input 
              type="checkbox"
              checked={filters.showAirborne}
              onChange={(e) => handleChange('showAirborne', e.target.checked)}
            />
            <span>Airborne</span>
          </label>
          
          <label className="filter-toggle">
            <input 
              type="checkbox"
              checked={filters.showGround}
              onChange={(e) => handleChange('showGround', e.target.checked)}
            />
            <span>Ground</span>
          </label>
        </div>
        
        <div className="filter-section">
          <div className="filter-section-title">Transponder</div>
          
          <label className="filter-toggle">
            <input 
              type="checkbox"
              checked={filters.showWithSquawk}
              onChange={(e) => handleChange('showWithSquawk', e.target.checked)}
            />
            <span>With Squawk</span>
          </label>
          
          <label className="filter-toggle">
            <input 
              type="checkbox"
              checked={filters.showWithoutSquawk}
              onChange={(e) => handleChange('showWithoutSquawk', e.target.checked)}
            />
            <span>Without Squawk</span>
          </label>
        </div>
        
        <div className="filter-section">
          <div className="filter-section-title">Altitude Range</div>
          
          <div className="filter-range">
            <label>
              <span>Min</span>
              <input 
                type="number"
                value={filters.minAltitude}
                onChange={(e) => handleChange('minAltitude', parseInt(e.target.value) || 0)}
                min={0}
                max={60000}
                step={1000}
              />
              <span>ft</span>
            </label>
          </div>
          
          <div className="filter-range">
            <label>
              <span>Max</span>
              <input 
                type="number"
                value={filters.maxAltitude}
                onChange={(e) => handleChange('maxAltitude', parseInt(e.target.value) || 60000)}
                min={0}
                max={60000}
                step={1000}
              />
              <span>ft</span>
            </label>
          </div>
        </div>
        
        <button 
          className="filter-reset-btn"
          onClick={() => onFiltersChange({
            showMilitary: true,
            showCivil: true,
            showGround: true,
            showAirborne: true,
            minAltitude: 0,
            maxAltitude: 60000,
            showWithSquawk: true,
            showWithoutSquawk: true,
          })}
        >
          Reset Filters
        </button>
      </div>
    </div>
  );
}

export default FilterMenu;
