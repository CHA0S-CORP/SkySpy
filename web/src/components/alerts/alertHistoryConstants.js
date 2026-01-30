import { Info, AlertTriangle, AlertCircle } from 'lucide-react';

// Severity icons that don't rely on color alone
export const SEVERITY_ICONS = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
  emergency: AlertCircle,
};

// Severity labels for screen readers
export const SEVERITY_LABELS = {
  info: 'Information',
  warning: 'Warning',
  critical: 'Critical',
  emergency: 'Emergency',
};

// Items per page options
export const PAGE_SIZE_OPTIONS = [25, 50, 100];
