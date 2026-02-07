import React from 'react';
import { X, Keyboard } from 'lucide-react';

/**
 * KeyboardShortcutHelp - Modal overlay showing all keyboard shortcuts for Pro/CRT mode
 * Phase 6: Keyboard Shortcuts & Quick Actions
 */
const KeyboardShortcutHelp = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcutGroups = [
    {
      title: 'View Controls',
      shortcuts: [
        { key: 'R', description: 'Reset view (center on feeder, clear pan)' },
        { key: '+/=', description: 'Zoom in (decrease range)' },
        { key: '-', description: 'Zoom out (increase range)' },
        { key: '1-5', description: 'Quick range presets (10/25/50/100/250nm)' },
        { key: 'Esc', description: 'Clear selection/measurement' },
        { key: 'Double-click', description: 'Center view on clicked location' },
      ],
    },
    {
      title: 'Multi-Scope Layout (Pro Mode)',
      shortcuts: [
        { key: 'Shift+1', description: 'Single scope view (full screen)' },
        { key: 'Shift+2', description: 'Split view (2 scopes side by side)' },
        { key: 'Shift+4', description: 'Quad view (4 scopes in 2x2 grid)' },
        { key: 'Click scope', description: 'Activate scope for interaction' },
      ],
    },
    {
      title: 'Measurement Tool',
      shortcuts: [
        { key: 'Shift+Click (1st)', description: 'Set point A marker' },
        { key: 'Shift+Click (2nd)', description: 'Set point B, show distance/bearing' },
        { key: 'Shift+Click (3rd)', description: 'Clear and start new measurement' },
        { key: 'Esc', description: 'Clear measurement points' },
      ],
    },
    {
      title: 'Display Toggles',
      shortcuts: [
        { key: 'V', description: 'Toggle velocity/prediction vectors' },
        { key: 'T', description: 'Toggle trails (short tracks)' },
        { key: 'Shift+T', description: 'Cycle color theme (Cyan/Amber/Green/High Contrast)' },
        { key: 'G', description: 'Cycle grid opacity (100% -> 50% -> 0%)' },
        { key: 'L', description: 'Toggle labels/data blocks' },
        { key: 'P', description: 'Toggle compass rose' },
        { key: 'S', description: 'Toggle speed coloring' },
        { key: 'C', description: 'Toggle conflict visualization' },
        { key: 'Y', description: 'Toggle vertical speed trend triangles' },
        { key: 'A', description: 'Toggle altitude-colored trails' },
        { key: 'Shift+H', description: 'Toggle heat map (traffic density)' },
        { key: 'Shift+W', description: 'Toggle winds aloft overlay' },
        { key: 'X', description: 'Toggle weather radar overlay' },
      ],
    },
    {
      title: 'Data Block Leader Lines',
      shortcuts: [
        { key: 'Shift+Drag', description: 'Reposition data block (on data block)' },
        { key: 'D', description: 'Reset all data block positions to default' },
        { key: 'Right-click', description: 'Reset single data block to default' },
      ],
    },
    {
      title: 'Filters & Lists',
      shortcuts: [
        { key: 'F', description: 'Toggle filter menu' },
        { key: 'W', description: 'Toggle watch list panel' },
        { key: 'N', description: 'Add selected aircraft to watch list' },
        { key: 'J', description: 'Toggle J-rings (range rings around selected aircraft)' },
      ],
    },
    {
      title: 'Safety',
      shortcuts: [
        { key: 'Shift+M', description: 'Toggle MSAW (Minimum Safe Altitude Warning)' },
        { key: 'Shift+F', description: 'Toggle FPS counter (debug)' },
        { key: '?', description: 'Show this help overlay' },
      ],
    },
    {
      title: 'Accessibility',
      shortcuts: [
        { key: 'H', description: 'Toggle high contrast mode' },
        { key: 'M', description: 'Toggle reduced motion' },
        { key: 'Shift+A', description: 'Toggle screen reader announcements' },
      ],
    },
    {
      title: 'Track Playback (when active)',
      shortcuts: [
        { key: 'Space', description: 'Play/Pause playback' },
        { key: 'Left', description: 'Skip backward 1 minute' },
        { key: 'Right', description: 'Skip forward 1 minute' },
        { key: 'Up', description: 'Increase playback speed' },
        { key: 'Down', description: 'Decrease playback speed' },
      ],
    },
  ];

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="keyboard-help-overlay" onClick={onClose}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="keyboard-help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="keyboard-help-header">
          <div className="keyboard-help-title">
            <Keyboard size={20} />
            <span>Keyboard Shortcuts</span>
          </div>
          <button
            className="keyboard-help-close"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            <X size={20} />
          </button>
        </div>

        <div className="keyboard-help-content">
          <p className="keyboard-help-note">
            These shortcuts are active in Pro and CRT radar modes when no input is focused.
          </p>

          <div className="keyboard-help-groups">
            {shortcutGroups.map((group) => (
              <div key={group.title} className="keyboard-help-group">
                <h3 className="keyboard-help-group-title">{group.title}</h3>
                <div className="keyboard-help-shortcuts">
                  {group.shortcuts.map((shortcut, idx) => (
                    <div key={`${shortcut.key}-${idx}`} className="keyboard-help-shortcut">
                      <kbd className="keyboard-help-key">{shortcut.key}</kbd>
                      <span className="keyboard-help-description">{shortcut.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="keyboard-help-footer">
            <p>
              <strong>Tip:</strong> Use middle mouse button to pan the radar view. Scroll wheel
              adjusts range. Double-click empty space to center view.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export { KeyboardShortcutHelp };
export default KeyboardShortcutHelp;
