import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Info, Radar, Radio, MessageCircle, AlertTriangle, History, Map as MapIcon } from 'lucide-react';

const TAB_CONFIG = [
  { id: 'info', label: 'Info', icon: Info, ariaLabel: 'Aircraft information' },
  { id: 'live', label: 'Live', icon: Radar, ariaLabel: 'Live status' },
  { id: 'radio', label: 'Radio', icon: Radio, ariaLabel: 'Radio transmissions' },
  { id: 'acars', label: 'ACARS', icon: MessageCircle, ariaLabel: 'ACARS messages' },
  { id: 'safety', label: 'Safety', icon: AlertTriangle, ariaLabel: 'Safety events', isAlert: true },
  { id: 'history', label: 'History', icon: History, ariaLabel: 'Flight history' },
  { id: 'track', label: 'Track', icon: MapIcon, ariaLabel: 'Track map' },
];

export function TabNavigation({
  activeTab,
  onTabChange,
  radioCount = 0,
  acarsCount = 0,
  safetyCount = 0
}) {
  const tabListRef = useRef(null);
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);

  // Check scroll position for fade indicators
  const updateFadeIndicators = useCallback(() => {
    const el = tabListRef.current;
    if (!el) return;
    setShowLeftFade(el.scrollLeft > 0);
    setShowRightFade(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  useEffect(() => {
    const el = tabListRef.current;
    if (!el) return;
    updateFadeIndicators();
    el.addEventListener('scroll', updateFadeIndicators);
    window.addEventListener('resize', updateFadeIndicators);
    return () => {
      el.removeEventListener('scroll', updateFadeIndicators);
      window.removeEventListener('resize', updateFadeIndicators);
    };
  }, [updateFadeIndicators]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    const tabs = TAB_CONFIG.map(t => t.id);
    const currentIndex = tabs.indexOf(activeTab);

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const direction = e.key === 'ArrowRight' ? 1 : -1;
      const newIndex = (currentIndex + direction + tabs.length) % tabs.length;
      onTabChange(tabs[newIndex]);
      // Focus the new tab button
      const buttons = tabListRef.current?.querySelectorAll('[role="tab"]');
      buttons?.[newIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      onTabChange(tabs[0]);
      tabListRef.current?.querySelectorAll('[role="tab"]')?.[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      onTabChange(tabs[tabs.length - 1]);
      tabListRef.current?.querySelectorAll('[role="tab"]')?.[tabs.length - 1]?.focus();
    }
  }, [activeTab, onTabChange]);

  const getTabBadge = (tabId) => {
    switch (tabId) {
      case 'radio':
        return radioCount > 0 ? radioCount : null;
      case 'acars':
        return acarsCount > 0 ? acarsCount : null;
      case 'safety':
        return safetyCount > 0 ? safetyCount : null;
      default:
        return null;
    }
  };

  return (
    <div className={`detail-tabs-wrapper ${showLeftFade ? 'fade-left' : ''} ${showRightFade ? 'fade-right' : ''}`}>
      <nav
        ref={tabListRef}
        className="detail-tabs"
        role="tablist"
        aria-label="Aircraft information tabs"
        onKeyDown={handleKeyDown}
      >
        {TAB_CONFIG.map((tab, index) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badge = getTabBadge(tab.id);
          const isAlertBadge = tab.isAlert && badge > 0;

          return (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              className={`detail-tab ${isActive ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              <Icon size={16} aria-hidden="true" className="tab-icon" />
              <span className="tab-label">{tab.label}</span>
              {badge !== null && (
                <span
                  className={`tab-badge ${isAlertBadge ? 'alert' : ''}`}
                  aria-label={`${badge} ${tab.label.toLowerCase()}`}
                >
                  {badge}
                </span>
              )}
              {isActive && <span className="tab-indicator" aria-hidden="true" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
