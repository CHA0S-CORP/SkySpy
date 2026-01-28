import React from 'react';
import {
  X,
  AlertTriangle,
  Shield,
  ArrowDown,
  Target,
  MapPin,
  ArrowUp,
  Zap,
  Circle,
  ShieldAlert,
  Navigation
} from 'lucide-react';

// Template definitions for alert rules
const RULE_TEMPLATES = [
  {
    id: 'emergency-watch',
    name: 'Emergency Watch',
    description: 'Monitor aircraft declaring emergencies via squawk codes',
    icon: AlertTriangle,
    iconColor: '#ef4444',
    priority: 'critical',
    conditions: [
      { type: 'squawk', operator: 'in', value: '7500,7600,7700' }
    ],
    previewText: 'squawk in (7500, 7600, 7700)'
  },
  {
    id: 'military-tracker',
    name: 'Military Tracker',
    description: 'Alert when military aircraft are detected in the area',
    icon: Shield,
    iconColor: '#8b5cf6',
    priority: 'warning',
    conditions: [
      { type: 'military', operator: 'equals', value: 'true' }
    ],
    previewText: 'military = true'
  },
  {
    id: 'low-flying',
    name: 'Low Flying Alert',
    description: 'Detect aircraft flying below 2,000 feet AGL',
    icon: ArrowDown,
    iconColor: '#f59e0b',
    priority: 'warning',
    conditions: [
      { type: 'altitude_below', operator: 'less_than', value: '2000' }
    ],
    previewText: 'altitude < 2000ft'
  },
  {
    id: 'specific-aircraft',
    name: 'Specific Aircraft',
    description: 'Track a specific aircraft by its ICAO hex code',
    icon: Target,
    iconColor: '#3b82f6',
    priority: 'info',
    conditions: [
      { type: 'hex', operator: 'equals', value: '' }
    ],
    previewText: 'icao equals [your hex code]',
    requiresInput: true,
    inputPlaceholder: 'Enter ICAO hex (e.g., A12345)'
  },
  {
    id: 'local-traffic',
    name: 'Local Traffic',
    description: 'Monitor aircraft within 10 nautical miles',
    icon: MapPin,
    iconColor: '#10b981',
    priority: 'info',
    conditions: [
      { type: 'distance_within', operator: 'less_than', value: '10' }
    ],
    previewText: 'distance < 10nm'
  },
  {
    id: 'high-altitude',
    name: 'High Altitude',
    description: 'Track aircraft cruising above 35,000 feet',
    icon: ArrowUp,
    iconColor: '#06b6d4',
    priority: 'info',
    conditions: [
      { type: 'altitude_above', operator: 'greater_than', value: '35000' }
    ],
    previewText: 'altitude > 35000ft'
  },
  {
    id: 'fast-mover',
    name: 'Fast Mover',
    description: 'Alert on high-speed aircraft exceeding 500 knots',
    icon: Zap,
    iconColor: '#f59e0b',
    priority: 'warning',
    conditions: [
      { type: 'speed_above', operator: 'greater_than', value: '500' }
    ],
    previewText: 'speed > 500kts'
  },
  {
    id: 'helicopter-activity',
    name: 'Helicopter Activity',
    description: 'Monitor rotorcraft (category A7) in the area',
    icon: Circle,
    iconColor: '#22c55e',
    priority: 'info',
    conditions: [
      { type: 'type', operator: 'equals', value: 'A7' }
    ],
    previewText: 'category = A7 (rotorcraft)'
  },
  {
    id: 'law-enforcement',
    name: 'Law Enforcement',
    description: 'Alert on police, federal, and state patrol aircraft',
    icon: ShieldAlert,
    iconColor: '#ef4444',
    priority: 'critical',
    conditions: [
      { type: 'law_enforcement', operator: 'equals', value: 'true' }
    ],
    previewText: 'law_enforcement = true'
  },
  {
    id: 'cannonball-preset',
    name: 'Cannonball Preset',
    description: 'Law enforcement + helicopters within 10nm',
    icon: Navigation,
    iconColor: '#dc2626',
    priority: 'critical',
    conditions: [
      { type: 'law_enforcement', operator: 'equals', value: 'true' },
      { type: 'helicopter', operator: 'equals', value: 'true' },
      { type: 'distance_within', operator: 'less_than', value: '10' }
    ],
    previewText: '(law enforcement OR helicopter) AND distance < 10nm'
  }
];

// Map priority to CSS class names
const priorityLabels = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info'
};

export function RuleTemplates({ onClose, onSelectTemplate }) {
  const handleTemplateSelect = (template) => {
    // Deep copy the template conditions to avoid mutation
    const templateData = {
      name: template.name,
      severity: template.priority,
      conditions: template.conditions.map(c => ({ ...c })),
      cooldown: 300,
      enabled: true
    };

    onSelectTemplate(templateData);
    onClose();
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="rule-templates-overlay" onClick={handleOverlayClick}>
      <div
        className="rule-templates-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="templates-title"
      >
        <div className="rule-templates-header">
          <h3 id="templates-title">Rule Templates</h3>
          <p className="rule-templates-subtitle">
            Start with a pre-configured alert rule template
          </p>
          <button
            className="close-btn"
            onClick={onClose}
            aria-label="Close templates"
          >
            <X size={20} />
          </button>
        </div>

        <div className="rule-templates-grid">
          {RULE_TEMPLATES.map((template) => {
            const IconComponent = template.icon;
            return (
              <div key={template.id} className="template-card">
                <div className="template-card-header">
                  <div
                    className="template-icon"
                    style={{ '--icon-color': template.iconColor }}
                  >
                    <IconComponent size={20} />
                  </div>
                  <span className={`template-priority ${template.priority}`}>
                    {priorityLabels[template.priority]}
                  </span>
                </div>

                <h4 className="template-name">{template.name}</h4>
                <p className="template-description">{template.description}</p>

                <div className="template-preview">
                  <code>{template.previewText}</code>
                </div>

                <button
                  className="template-use-btn"
                  onClick={() => handleTemplateSelect(template)}
                >
                  Use Template
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default RuleTemplates;
