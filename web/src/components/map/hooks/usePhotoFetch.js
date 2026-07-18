import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Custom hook for fetching and caching aircraft photos.
 * Handles WebSocket and HTTP fallback, URL resolution for cross-origin dev setups.
 */
export function usePhotoFetch({ selectedAircraftHex, apiBaseUrl, wsRequest, wsConnected }) {
  const [proPhotoError, setProPhotoError] = useState(false);
  const [proPhotoRetry, setProPhotoRetry] = useState(0);
  const [proPhotoUrl, setProPhotoUrl] = useState(null);
  const [proPhotoLoading, setProPhotoLoading] = useState(true);
  const [proPhotoStatus, setProPhotoStatus] = useState(null);
  const proPhotoRetryRef = useRef(null);

  // Helper to resolve photo URLs (handles relative API paths for cross-origin dev setups)
  const resolvePhotoUrl = useCallback(
    (url) => {
      if (!url) return null;
      if (url.startsWith('/api/')) {
        return `${apiBaseUrl || ''}${url}`;
      }
      return url;
    },
    [apiBaseUrl]
  );

  // Helper to safely parse JSON from fetch response
  const safeJson = async (res) => {
    if (!res.ok) return null;
    const ct = res.headers.get('content-type');
    if (!ct || !ct.includes('application/json')) return null;
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  // Reset photo state and fetch/cache S3 URL when selected aircraft changes
  useEffect(() => {
    // Clear any existing retry loop when aircraft changes
    if (proPhotoRetryRef.current) {
      clearInterval(proPhotoRetryRef.current);
      proPhotoRetryRef.current = null;
    }

    setProPhotoError(false);
    setProPhotoRetry(0);
    setProPhotoUrl(null);
    setProPhotoLoading(true);
    setProPhotoStatus(null);

    if (selectedAircraftHex) {
      const fetchPhoto = async () => {
        try {
          // Use WebSocket if available, otherwise fall back to HTTP
          if (wsRequest && wsConnected) {
            const data = await wsRequest('photo-cache', { icao: selectedAircraftHex });
            if (data?.photo_url) {
              setProPhotoUrl(resolvePhotoUrl(data.photo_url));
            } else if (data?.photo_thumbnail_url || data?.thumbnail_url) {
              setProPhotoUrl(resolvePhotoUrl(data.photo_thumbnail_url || data.thumbnail_url));
            } else if (data?.error) {
              console.debug('Photo cache WS error:', data.error);
              setProPhotoError(true);
              setProPhotoLoading(false);
            } else {
              // No photo URL returned
              console.debug('Photo cache WS: no URL in response', data);
              setProPhotoError(true);
              setProPhotoLoading(false);
            }
          } else {
            // Fallback to HTTP GET from airframes endpoint
            const res = await fetch(
              `${apiBaseUrl || ''}/api/v1/airframes/${selectedAircraftHex}/photos`
            );
            const data = await safeJson(res);
            if (data) {
              if (data?.photo_url) {
                setProPhotoUrl(resolvePhotoUrl(data.photo_url));
              } else if (data?.photo_thumbnail_url || data?.thumbnail_url) {
                setProPhotoUrl(resolvePhotoUrl(data.photo_thumbnail_url || data.thumbnail_url));
              } else {
                setProPhotoError(true);
                setProPhotoLoading(false);
              }
            } else {
              setProPhotoError(true);
              setProPhotoLoading(false);
            }
          }
        } catch (err) {
          console.debug('Photo cache error:', err);
          setProPhotoError(true);
          setProPhotoLoading(false);
        }
      };
      fetchPhoto();
    }
  }, [selectedAircraftHex, apiBaseUrl, wsRequest, wsConnected, resolvePhotoUrl]);

  // Prefetch the image bytes as soon as the URL resolves, before the (default-
  // collapsed) Photo section is ever mounted. This warms the browser HTTP cache
  // so the <img> in ProDetailsPanel renders instantly on section expand.
  useEffect(() => {
    if (!proPhotoUrl) return;
    const img = new Image();
    img.src = proPhotoUrl;
  }, [proPhotoUrl]);

  return {
    proPhotoUrl,
    setProPhotoUrl,
    proPhotoLoading,
    setProPhotoLoading,
    proPhotoError,
    setProPhotoError,
    proPhotoRetry,
    setProPhotoRetry,
    proPhotoStatus,
    setProPhotoStatus,
    proPhotoRetryRef,
  };
}
