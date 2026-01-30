import { useState, useEffect, useRef, useCallback } from 'react';

// Helper to safely parse JSON from fetch response
const safeJson = async (res) => {
  if (!res.ok) return null;
  const ct = res.headers.get('content-type');
  if (!ct || !ct.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
};

/**
 * Hook for managing aircraft photo fetching and display
 * Handles photo loading, error recovery, thumbnail fallback, and retry logic
 */
export function useAircraftPhoto({ hex, baseUrl, initialPhotoData = null }) {
  const [photoInfo, setPhotoInfo] = useState(initialPhotoData);
  const [photoState, setPhotoState] = useState(initialPhotoData ? 'loaded' : 'loading');
  const [photoRetryCount, setPhotoRetryCount] = useState(0);
  const [useThumbnail, setUseThumbnail] = useState(false);
  const [photoStatus, setPhotoStatus] = useState(null);

  const retryPhotoRef = useRef(null);
  const photoPollingRef = useRef(null);
  const intervalsRef = useRef(new Set());

  // Helper to ensure photo URLs are absolute (handles relative API paths)
  const resolvePhotoUrl = useCallback((url) => {
    if (!url) return null;
    // If URL starts with /api/, prefix with baseUrl to handle cross-origin dev setups
    if (url.startsWith('/api/')) {
      return `${baseUrl}${url}`;
    }
    // Already absolute URL (http:// or https://)
    return url;
  }, [baseUrl]);

  const photoUrl = photoInfo
    ? resolvePhotoUrl(useThumbnail
        ? (photoInfo.thumbnail_url || photoInfo.photo_url)
        : (photoInfo.photo_url || photoInfo.thumbnail_url))
    : null;

  // Reset photo state when hex changes
  useEffect(() => {
    setPhotoState('loading');
    setPhotoRetryCount(0);
    setUseThumbnail(false);
    setPhotoInfo(null);
  }, [hex]);

  const handlePhotoError = useCallback(() => {
    if (!useThumbnail) {
      setUseThumbnail(true);
      setPhotoState('loading');
      setPhotoStatus({ message: 'High quality failed, trying thumbnail...', type: 'info' });
    } else {
      setPhotoState('error');
      setPhotoStatus({ message: 'No photo available', type: 'error' });
    }
  }, [useThumbnail]);

  const handlePhotoLoad = useCallback(() => {
    setPhotoState('loaded');
    if (useThumbnail) {
      setPhotoStatus({ message: 'Showing thumbnail (high quality unavailable)', type: 'info' });
    } else {
      setPhotoStatus({ message: 'High quality photo loaded', type: 'success' });
    }
    setTimeout(() => setPhotoStatus(null), 3000);
  }, [useThumbnail]);

  const retryPhoto = useCallback(async () => {
    // Guard: prevent multiple simultaneous intervals
    if (retryPhotoRef.current) {
      clearInterval(retryPhotoRef.current);
      intervalsRef.current.delete(retryPhotoRef.current);
      retryPhotoRef.current = null;
    }

    const abortController = new AbortController();
    const currentHex = hex;

    setPhotoState('loading');
    setUseThumbnail(false);
    setPhotoRetryCount(c => c + 1);
    setPhotoStatus({ message: 'Fetching photo...', type: 'info' });

    // Trigger photo fetch with force=true to re-fetch from sources
    try {
      await fetch(`${baseUrl}/api/v1/airframes/${hex}/photos/fetch/?force=true`, {
        method: 'POST',
        signal: abortController.signal
      });
    } catch (e) {
      if (e.name === 'AbortError') return;
    }

    // Poll for result using main airframes endpoint (has consistent field names)
    let attempts = 0;
    const intervalId = setInterval(async () => {
      attempts++;
      if (attempts > 10 || abortController.signal.aborted) {
        clearInterval(intervalId);
        intervalsRef.current.delete(intervalId);
        retryPhotoRef.current = null;
        if (!abortController.signal.aborted) {
          setPhotoState('error');
          setPhotoStatus({ message: 'Photo not available', type: 'error' });
        }
        return;
      }
      setPhotoStatus({ message: `Fetching photo... (${30 - attempts * 3}s)`, type: 'info' });
      try {
        const res = await fetch(`${baseUrl}/api/v1/airframes/${currentHex}/`, {
          signal: abortController.signal
        });
        const data = await safeJson(res);
        if (data?.photo_url) {
          clearInterval(intervalId);
          intervalsRef.current.delete(intervalId);
          retryPhotoRef.current = null;
          setPhotoInfo({
            photo_url: data.photo_url,
            thumbnail_url: data.photo_thumbnail_url,
            photographer: data.photo_photographer,
            source: data.photo_source,
          });
          setPhotoState('loaded');
          setPhotoStatus(null);
        }
      } catch (e) {
        if (e.name === 'AbortError') {
          clearInterval(intervalId);
          intervalsRef.current.delete(intervalId);
          retryPhotoRef.current = null;
        }
      }
    }, 3000);

    retryPhotoRef.current = intervalId;
    intervalsRef.current.add(intervalId);
  }, [hex, baseUrl]);

  // Fetch photo on mount or when hex changes
  const fetchPhoto = useCallback(async (abortController) => {
    if (photoPollingRef.current) {
      clearInterval(photoPollingRef.current);
      intervalsRef.current.delete(photoPollingRef.current);
      photoPollingRef.current = null;
    }

    try {
      const res = await fetch(`${baseUrl}/api/v1/airframes/${hex}/`, {
        signal: abortController.signal
      });
      const data = await safeJson(res);

      if (abortController.signal.aborted) return;

      if (data?.photo_url || data?.photo_thumbnail_url) {
        setPhotoInfo({
          photo_url: data.photo_url,
          thumbnail_url: data.photo_thumbnail_url,
          photographer: data.photo_photographer,
          source: data.photo_source,
        });
        setPhotoState('loaded');
      } else {
        // No photo - trigger fetch in background
        setPhotoState('loading');
        fetch(`${baseUrl}/api/v1/airframes/${hex}/photos/fetch/`, {
          method: 'POST',
          signal: abortController.signal
        }).catch(() => {});

        // Poll for photo
        let attempts = 0;
        const pollInterval = setInterval(async () => {
          attempts++;
          if (attempts > 5 || abortController.signal.aborted) {
            clearInterval(pollInterval);
            intervalsRef.current.delete(pollInterval);
            photoPollingRef.current = null;
            if (!abortController.signal.aborted) {
              setPhotoState('error');
            }
            return;
          }
          try {
            const retryRes = await fetch(`${baseUrl}/api/v1/airframes/${hex}/`, {
              signal: abortController.signal
            });
            const retryData = await safeJson(retryRes);
            if (retryData?.photo_url) {
              clearInterval(pollInterval);
              intervalsRef.current.delete(pollInterval);
              photoPollingRef.current = null;
              setPhotoInfo({
                photo_url: retryData.photo_url,
                thumbnail_url: retryData.photo_thumbnail_url,
              });
              setPhotoState('loaded');
            }
          } catch (e) {
            if (e.name === 'AbortError') {
              clearInterval(pollInterval);
              intervalsRef.current.delete(pollInterval);
              photoPollingRef.current = null;
            }
          }
        }, 3000);

        photoPollingRef.current = pollInterval;
        intervalsRef.current.add(pollInterval);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setPhotoState('error');
    }
  }, [hex, baseUrl]);

  // Cleanup intervals when hex changes or on unmount
  useEffect(() => {
    return () => {
      if (retryPhotoRef.current) {
        clearInterval(retryPhotoRef.current);
        intervalsRef.current.delete(retryPhotoRef.current);
        retryPhotoRef.current = null;
      }
      if (photoPollingRef.current) {
        clearInterval(photoPollingRef.current);
        intervalsRef.current.delete(photoPollingRef.current);
        photoPollingRef.current = null;
      }
    };
  }, [hex]);

  // Global cleanup for all intervals on unmount
  useEffect(() => {
    return () => {
      intervalsRef.current.forEach(intervalId => {
        clearInterval(intervalId);
      });
      intervalsRef.current.clear();
    };
  }, []);

  return {
    photoInfo,
    setPhotoInfo,
    photoUrl,
    photoState,
    setPhotoState,
    photoRetryCount,
    useThumbnail,
    photoStatus,
    handlePhotoError,
    handlePhotoLoad,
    retryPhoto,
    fetchPhoto,
  };
}
