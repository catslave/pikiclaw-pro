import { useCallback, useState } from 'react';
import { api } from '../../../api';
import type { FocusOverviewResponse } from '../../../types';

export function useFocusOverview() {
  const [overview, setOverview] = useState<FocusOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (orchestrate = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getFocusOverview({ orchestrate });
      if (!result.ok) throw new Error(result.errors?.[0] || 'Failed to load focus overview');
      setOverview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const submitIntent = useCallback(async (text: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.submitFocusIntent(text);
      if (!result.ok) throw new Error(result.errors?.[0] || 'Failed to update focus canvas');
      setOverview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshToday = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.orchestrateFocus();
      if (!result.ok) throw new Error(result.errors?.[0] || 'Failed to orchestrate focus');
      setOverview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  return { overview, loading, error, load, submitIntent, refreshToday };
}
