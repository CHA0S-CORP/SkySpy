import React from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';

/**
 * Toggle switch per design spec: 44×24 pill, 18px white knob sliding 3px↔23px,
 * --accent on / --bord2 off. Radix supplies keyboard/a11y behavior.
 *
 * @param {object} props
 * @param {boolean} props.checked
 * @param {(checked: boolean) => void} props.onCheckedChange
 * @param {string} [props.label] - accessible name
 */
export function Switch({ checked, onCheckedChange, label, ...rest }) {
  return (
    <RadixSwitch.Root
      className="v2-switch"
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      {...rest}
    >
      <RadixSwitch.Thumb className="v2-switch__thumb" />
    </RadixSwitch.Root>
  );
}
