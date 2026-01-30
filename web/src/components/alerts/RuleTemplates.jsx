import React from 'react';
import { X, FileText, Shield, AlertTriangle, ArrowDown, MapPin, Zap, ShieldAlert } from 'lucide-react';
import { RULE_TEMPLATES } from './RuleFormConstants';

// Map icon names to Lucide components
const ICON_MAP = {
  'shield': Shield,
  'alert': AlertTriangle,
  'arrow-down': ArrowDown,
  'map-pin': MapPin,
  'helicopter': Zap, // Using Zap as a placeholder, could be replaced with custom icon
  'shield-alert': ShieldAlert,
};

/**
 * TemplateCard component - renders a single template option
 */
function TemplateCard({ template, onSelect }) {
  const IconComponent = ICON_MAP[template.icon] || Shield;

  return (
    <button
      type="button"
      className="template-card"
      onClick={() => onSelect(template)}
    >
      <span className="template-icon">
        <IconComponent size={20} />
      </span>
      <span className="template-name">{template.name}</span>
      <span className="template-desc">{template.description}</span>
    </button>
  );
}

/**
 * RuleTemplates component - displays a grid of rule templates for quick setup
 */
export function RuleTemplates({ onApply, onSkip }) {
  const handleApply = (template) => {
    onApply({
      ...template.rule,
      enabled: true,
    });
  };

  return (
    <div className="rule-templates-section">
      <div className="templates-header">
        <FileText size={16} />
        <span>Quick Start Templates</span>
        <button
          type="button"
          className="templates-toggle"
          onClick={onSkip}
        >
          <X size={14} /> Skip
        </button>
      </div>
      <div className="templates-grid">
        {RULE_TEMPLATES.map(template => (
          <TemplateCard
            key={template.id}
            template={template}
            onSelect={handleApply}
          />
        ))}
      </div>
    </div>
  );
}

export default RuleTemplates;
