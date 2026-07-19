import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Icon } from './Icon';

/**
 * Mobile bottom sheet — a Dialog anchored to the bottom of the viewport that
 * slides up, with a drag handle and a scrim tap-to-close. Built on
 * `@radix-ui/react-dialog` (same dep as `Modal`) so focus-trap, ESC, and
 * scroll-lock come for free.
 *
 * Used on phones where a fixed side panel/popover would not fit — the map
 * detail panel, filter/layers/legend popovers, and overflow toolbar controls
 * all render inside one of these below the mobile breakpoint.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.children]
 * @param {string} [props.maxHeight] - CSS max-height for the sheet (default 85vh)
 * @param {string} [props.className] - extra class on the sheet content
 * @param {boolean} [props.padded=true] - apply default body padding
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  maxHeight,
  className = '',
  padded = true,
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="v2-sheet-overlay v2-app">
          <Dialog.Content
            className={`v2-sheet ${className}`.trim()}
            style={maxHeight ? { maxHeight } : undefined}
            aria-describedby={undefined}
          >
            <div className="v2-sheet__grip" aria-hidden="true" />
            {title != null && (
              <div className="v2-sheet__head">
                <Dialog.Title asChild>
                  <div className="v2-sheet__title">{title}</div>
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" className="v2-iconbtn" aria-label="Close">
                    <Icon name="x" size={18} />
                  </button>
                </Dialog.Close>
              </div>
            )}
            {title == null && (
              <Dialog.Title asChild>
                <span className="sr-only">Panel</span>
              </Dialog.Title>
            )}
            <div className={padded ? 'v2-sheet__body' : 'v2-sheet__body v2-sheet__body--flush'}>
              {children}
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default BottomSheet;
