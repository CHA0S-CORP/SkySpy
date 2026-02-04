import React from 'react';
import { Trash2, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '../ui/alert-dialog';
import { cn } from '../ui/cn';

/**
 * Reusable confirmation modal to replace native confirm() dialogs.
 * Provides accessible, styled confirmation dialogs with customizable actions.
 * Built on Radix AlertDialog for accessibility and focus management.
 */

const MODAL_VARIANTS = {
  danger: {
    Icon: Trash2,
    iconColor: 'text-accent-red',
    contentVariant: 'danger',
    actionClass: 'bg-accent-red hover:bg-accent-red/90 focus-visible:ring-accent-red/50',
  },
  warning: {
    Icon: AlertTriangle,
    iconColor: 'text-accent-yellow',
    contentVariant: 'warning',
    actionClass:
      'bg-accent-yellow hover:bg-accent-yellow/90 focus-visible:ring-accent-yellow/50 text-black',
  },
  info: {
    Icon: Info,
    iconColor: 'text-accent-cyan',
    contentVariant: 'default',
    actionClass: 'bg-accent-cyan hover:bg-accent-cyan/90 focus-visible:ring-accent-cyan/50',
  },
  default: {
    Icon: AlertCircle,
    iconColor: 'text-text-secondary',
    contentVariant: 'default',
    actionClass: 'bg-accent-cyan hover:bg-accent-cyan/90 focus-visible:ring-accent-cyan/50',
  },
};

export function ConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  loading = false,
  children,
}) {
  const variantConfig = MODAL_VARIANTS[variant] || MODAL_VARIANTS.default;
  const { Icon, iconColor, contentVariant, actionClass } = variantConfig;

  const handleOpenChange = (open) => {
    if (!open && !loading) {
      onCancel?.();
    }
  };

  const handleConfirm = (e) => {
    if (loading) {
      e.preventDefault();
      return;
    }
    onConfirm?.();
  };

  const handleCancel = (e) => {
    if (loading) {
      e.preventDefault();
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent variant={contentVariant}>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className={cn('flex-shrink-0', iconColor)}>
              <Icon size={24} aria-hidden="true" />
            </div>
            <AlertDialogTitle>{title}</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="pl-9">{message}</AlertDialogDescription>
        </AlertDialogHeader>

        {children && <div className="pl-9 mt-2">{children}</div>}

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel} disabled={loading}>
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={loading}
            aria-busy={loading}
            className={cn(actionClass)}
          >
            {loading ? 'Please wait...' : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmModal;
