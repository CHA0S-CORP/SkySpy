import React, { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info, ChevronRight } from 'lucide-react';
import { TOAST_TYPES } from '../../hooks/useToast';

/**
 * Get icon component based on toast type
 */
const getIcon = (type) => {
  const iconProps = { size: 18 };
  switch (type) {
    case TOAST_TYPES.SUCCESS:
      return <CheckCircle {...iconProps} />;
    case TOAST_TYPES.ERROR:
      return <AlertCircle {...iconProps} />;
    case TOAST_TYPES.WARNING:
      return <AlertTriangle {...iconProps} />;
    case TOAST_TYPES.INFO:
    default:
      return <Info {...iconProps} />;
  }
};

/**
 * Individual Toast component
 */
export function Toast({ toast, onRemove }) {
  const [isExiting, setIsExiting] = useState(false);

  const handleRemove = () => {
    setIsExiting(true);
    // Wait for exit animation to complete
    setTimeout(() => {
      onRemove(toast.id);
    }, 300);
  };

  const handleClick = () => {
    if (toast.onClick) {
      toast.onClick();
      handleRemove();
    }
  };

  const handleAction = (e) => {
    e.stopPropagation();
    if (toast.onAction) {
      toast.onAction();
      handleRemove();
    }
  };

  // Handle auto-dismiss animation
  useEffect(() => {
    if (toast.duration > 0) {
      const exitTimer = setTimeout(() => {
        setIsExiting(true);
      }, toast.duration - 300); // Start exit animation 300ms before removal

      return () => clearTimeout(exitTimer);
    }
  }, [toast.duration]);

  const isClickable = Boolean(toast.onClick);

  return (
    <div
      className={`toast toast-${toast.type} ${isExiting ? 'toast-exit' : 'toast-enter'} ${isClickable ? 'toast-clickable' : ''}`}
      role="alert"
      aria-live="polite"
      onClick={isClickable ? handleClick : undefined}
      style={isClickable ? { cursor: 'pointer' } : undefined}
    >
      <div className="toast-icon">
        {getIcon(toast.type)}
      </div>
      <div className="toast-content">
        <div className="toast-message">
          {toast.message}
        </div>
        {toast.actionLabel && toast.onAction && (
          <button
            className="toast-action"
            onClick={handleAction}
          >
            {toast.actionLabel}
            <ChevronRight size={14} />
          </button>
        )}
      </div>
      {isClickable && (
        <div className="toast-click-hint">
          <ChevronRight size={14} />
        </div>
      )}
      <button
        className="toast-close"
        onClick={(e) => {
          e.stopPropagation();
          handleRemove();
        }}
        aria-label="Dismiss notification"
      >
        <X size={16} />
      </button>
    </div>
  );
}

/**
 * Toast Container - renders all active toasts
 */
export function ToastContainer({ toasts, removeToast }) {
  if (!toasts || toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-container" aria-live="polite" aria-label="Notifications">
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          toast={toast}
          onRemove={removeToast}
        />
      ))}
    </div>
  );
}

export default ToastContainer;
