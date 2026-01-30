import { Info, AlertCircle, Shield, Navigation, ExternalLink } from 'lucide-react';

// NOTAM type icons and colors
export const NOTAM_TYPES = {
  D: { label: 'NOTAM D', color: '#60a5fa', icon: Info },
  FDC: { label: 'FDC NOTAM', color: '#f59e0b', icon: AlertCircle },
  TFR: { label: 'TFR', color: '#ef4444', icon: Shield },
  GPS: { label: 'GPS NOTAM', color: '#8b5cf6', icon: Navigation },
  MIL: { label: 'Military', color: '#10b981', icon: Shield },
  POINTER: { label: 'Pointer', color: '#6b7280', icon: ExternalLink },
};
