import { useState, useEffect, memo } from 'react';
import { Plane, MapPin, Clock, Settings, BellRing, BellOff, Users } from 'lucide-react';
import { saveConfig } from '../../utils/config';
import { AudioPlaybackControl } from './AudioPlaybackControl';

// Memoized time display component to prevent re-renders from propagating
const TimeDisplay = memo(function TimeDisplay() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="header-time">
      <Clock size={14} />
      <span>{time.toUTCString().slice(17, 25)} UTC</span>
    </div>
  );
});

export function Header({ stats, location, onlineUsers, config, setConfig, setShowSettings }) {
  const [notifPermission, setNotifPermission] = useState(
    'Notification' in window ? Notification.permission : 'denied'
  );

  const handleNotifToggle = async () => {
    if (notifPermission === 'granted') {
      const newConfig = { ...config, browserNotifications: !config.browserNotifications };
      setConfig(newConfig);
      saveConfig(newConfig);
    } else if (notifPermission === 'default') {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      if (permission === 'granted') {
        const newConfig = { ...config, browserNotifications: true };
        setConfig(newConfig);
        saveConfig(newConfig);
      }
    }
  };

  return (
    <header className="header">
      <div className="header-stats">
        <div className="stat-item">
          <Plane size={16} />
          <span className="stat-value">{stats.count || 0}</span>
          <span className="stat-label">Aircraft</span>
        </div>
        <div className="stat-item">
          <MapPin size={16} />
          <span className="stat-value">{location?.lat?.toFixed(1) || '--'}</span>
          <span className="stat-label">Lat</span>
        </div>
        <div className="stat-item">
          <MapPin size={16} />
          <span className="stat-value">{location?.lon?.toFixed(1) || '--'}</span>
          <span className="stat-label">Lon</span>
        </div>
        <div className="stat-item">
          <Users size={16} />
          <span className="stat-value">{onlineUsers}</span>
          <span className="stat-label">Online</span>
        </div>
      </div>

      <AudioPlaybackControl />

      <div className="header-actions">
        <button
          className={`header-btn ${notifPermission === 'granted' && config.browserNotifications ? 'notifications-granted' : ''}`}
          onClick={handleNotifToggle}
          title={
            notifPermission === 'granted'
              ? 'Browser notifications enabled'
              : 'Enable browser notifications'
          }
        >
          {notifPermission === 'granted' && config.browserNotifications ? (
            <BellRing size={16} />
          ) : (
            <BellOff size={16} />
          )}
        </button>
        <button className="header-btn" onClick={() => setShowSettings(true)}>
          <Settings size={16} />
        </button>
        <TimeDisplay />
      </div>
    </header>
  );
}

export default Header;
