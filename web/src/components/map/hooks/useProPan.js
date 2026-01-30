import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Custom hook for handling pro mode panning and aircraft following
 */
export function useProPan({
  config,
  setHashParams,
  radarRange,
  feederLat,
  feederLon,
  aircraft,
  canvasRef,
}) {
  const [proPanOffset, setProPanOffset] = useState({ x: 0, y: 0 });
  const [isProPanning, setIsProPanning] = useState(false);
  const [followingAircraft, setFollowingAircraft] = useState(null);

  // Refs
  const proPanStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const proPanOffsetRef = useRef(proPanOffset);
  const setHashParamsRef = useRef(setHashParams);

  // Keep refs in sync
  useEffect(() => {
    proPanOffsetRef.current = proPanOffset;
  }, [proPanOffset]);

  useEffect(() => {
    setHashParamsRef.current = setHashParams;
  }, [setHashParams]);

  // Pro mode pan handlers (middle mouse button)
  const handleProPanStart = useCallback((e) => {
    // Middle mouse button (button 1) or auxiliary button
    if (e.button !== 1 || config.mapMode !== 'pro') return;
    e.preventDefault();
    setIsProPanning(true);
    proPanStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: proPanOffset.x,
      offsetY: proPanOffset.y
    };
  }, [config.mapMode, proPanOffset]);

  const handleProPanMove = useCallback((e) => {
    if (!isProPanning) return;
    // Stop following when manually panning
    setFollowingAircraft(null);
    const dx = e.clientX - proPanStartRef.current.x;
    const dy = e.clientY - proPanStartRef.current.y;
    setProPanOffset({
      x: proPanStartRef.current.offsetX + dx,
      y: proPanStartRef.current.offsetY + dy
    });
  }, [isProPanning]);

  const handleProPanEnd = useCallback(() => {
    setIsProPanning(false);
    // Update URL with pan offset for pro/crt mode
    const updateHash = setHashParamsRef.current;
    const offset = proPanOffsetRef.current;
    if (updateHash && (offset.x !== 0 || offset.y !== 0)) {
      updateHash({
        panX: String(Math.round(offset.x)),
        panY: String(Math.round(offset.y))
      });
    } else if (updateHash) {
      updateHash({ panX: undefined, panY: undefined });
    }
  }, []);

  // Reset pan offset and stop following when switching away from pro mode
  useEffect(() => {
    if (config.mapMode !== 'pro') {
      setProPanOffset({ x: 0, y: 0 });
      setFollowingAircraft(null);
      if (setHashParams) {
        setHashParams({ panX: undefined, panY: undefined });
      }
    }
  }, [config.mapMode, setHashParams]);

  // Follow aircraft - update pan offset as aircraft moves
  useEffect(() => {
    if (!followingAircraft || config.mapMode !== 'pro' || !canvasRef?.current) return;

    const followedAc = aircraft.find(ac => ac.hex === followingAircraft);
    if (!followedAc || !followedAc.lat || !followedAc.lon) {
      // Aircraft no longer available, stop following
      setFollowingAircraft(null);
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const pixelsPerNm = (Math.min(rect.width, rect.height) * 0.45) / radarRange;

    const dLat = followedAc.lat - feederLat;
    const dLon = followedAc.lon - feederLon;
    const nmY = dLat * 60;
    const nmX = dLon * 60 * Math.cos(feederLat * Math.PI / 180);

    setProPanOffset({ x: -(nmX * pixelsPerNm), y: nmY * pixelsPerNm });
  }, [followingAircraft, aircraft, config.mapMode, radarRange, feederLat, feederLon, canvasRef]);

  // Add window event listeners for pro pan
  useEffect(() => {
    if (isProPanning) {
      window.addEventListener('mousemove', handleProPanMove);
      window.addEventListener('mouseup', handleProPanEnd);
      return () => {
        window.removeEventListener('mousemove', handleProPanMove);
        window.removeEventListener('mouseup', handleProPanEnd);
      };
    }
  }, [isProPanning, handleProPanMove, handleProPanEnd]);

  // Reset view helper
  const resetView = useCallback(() => {
    setProPanOffset({ x: 0, y: 0 });
    setFollowingAircraft(null);
    if (setHashParams) {
      setHashParams({ panX: undefined, panY: undefined });
    }
  }, [setHashParams]);

  return {
    proPanOffset,
    setProPanOffset,
    isProPanning,
    setIsProPanning,
    followingAircraft,
    setFollowingAircraft,
    handleProPanStart,
    handleProPanMove,
    handleProPanEnd,
    resetView,
    proPanOffsetRef,
  };
}
