import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTurbulenceRiskList } from './useTurbulenceRiskList';

const AC = [
  { hex: 'A', turbulenceLevel: 'severe', turbulenceRisk: 80 },
  { hex: 'B', turbulenceLevel: 'moderate', turbulenceRisk: 50 },
  { hex: 'C', turbulenceLevel: 'light', turbulenceRisk: 25 },
  { hex: 'D' }, // no risk
];

describe('useTurbulenceRiskList', () => {
  it('includes only moderate+severe, sorted by score desc', () => {
    const { result } = renderHook(() => useTurbulenceRiskList(AC));
    expect(result.current.atRisk.map((a) => a.hex)).toEqual(['A', 'B']);
  });

  it('counts by level', () => {
    const { result } = renderHook(() => useTurbulenceRiskList(AC));
    expect(result.current.countsByLevel).toEqual({ none: 0, light: 1, moderate: 1, severe: 1 });
  });

  it('handles empty / non-array input', () => {
    const { result } = renderHook(() => useTurbulenceRiskList(undefined));
    expect(result.current.atRisk).toEqual([]);
  });
});
