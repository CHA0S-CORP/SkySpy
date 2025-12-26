import { useState, useEffect, useCallback } from 'react';

export function useApi(endpoint, interval = null, apiBase = '') {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const baseUrl = apiBase || '';
      const res = await fetch(`${baseUrl}${endpoint}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint, apiBase]);

  useEffect(() => {
    fetchData();
    if (interval) {
      const id = setInterval(fetchData, interval);
      return () => clearInterval(id);
    }
  }, [fetchData, interval]);

  return { data, loading, error, refetch: fetchData };
}
