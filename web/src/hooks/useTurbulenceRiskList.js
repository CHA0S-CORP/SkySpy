import { useMemo } from 'react';

const LEVEL_RANK = { none: 0, light: 1, moderate: 2, severe: 3 };

/**
 * Pure selector over an aircraft array → the subset currently at meaningful
 * turbulence risk (moderate/severe), sorted by score desc, plus counts by level.
 *
 * The turbulence fields (`turbulenceLevel`, `turbulenceRisk`) are stamped onto
 * aircraft by the map/list merge from the backend scorer (useAircraftTurbulence).
 *
 * @param {Array} aircraft
 * @returns {{ atRisk: Array, countsByLevel: {none:number, light:number, moderate:number, severe:number} }}
 */
export function useTurbulenceRiskList(aircraft) {
  return useMemo(() => {
    const countsByLevel = { none: 0, light: 0, moderate: 0, severe: 0 };
    const atRisk = [];
    if (Array.isArray(aircraft)) {
      for (const ac of aircraft) {
        const level = ac.turbulenceLevel;
        if (level && level in countsByLevel) countsByLevel[level] += 1;
        if (level === 'moderate' || level === 'severe') atRisk.push(ac);
      }
    }
    atRisk.sort((a, b) => {
      const byScore = (b.turbulenceRisk || 0) - (a.turbulenceRisk || 0);
      if (byScore !== 0) return byScore;
      return (LEVEL_RANK[b.turbulenceLevel] || 0) - (LEVEL_RANK[a.turbulenceLevel] || 0);
    });
    return { atRisk, countsByLevel };
  }, [aircraft]);
}

export default useTurbulenceRiskList;
