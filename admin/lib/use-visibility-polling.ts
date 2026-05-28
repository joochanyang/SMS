import { useCallback, useEffect, useRef, useState } from 'react';

type Fetcher = () => Promise<void> | void;

export interface VisibilityPollingState {
  refetch: () => Promise<void>;
  lastFetchedAt: Date | null;
  isFetching: boolean;
}

/**
 * `document.visibilityState` 가 'visible' 일 때만 polling tick 을 수행할지 결정한다.
 * 순수 함수 — useEffect 안에서 호출되는 결정 로직만 분리해 단위 테스트 가능.
 */
export function shouldTickNow(visibilityState: string | undefined): boolean {
  return visibilityState === 'visible';
}

/**
 * 페이지가 보이는 동안에만 polling.
 * - 마운트 직후 1회 호출 (가시성 무관)
 * - `document.visibilityState === 'visible'` 일 때만 interval tick
 * - 수동 refetch 함수 반환
 */
export function useVisibilityPolling(fetcher: Fetcher, intervalMs: number): VisibilityPollingState {
  const fetcherRef = useRef<Fetcher>(fetcher);
  fetcherRef.current = fetcher;

  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  const run = useCallback(async () => {
    setIsFetching(true);
    try {
      await fetcherRef.current();
      setLastFetchedAt(new Date());
    } finally {
      setIsFetching(false);
    }
  }, []);

  useEffect(() => {
    void run();
    const tick = () => {
      const state = typeof document !== 'undefined' ? document.visibilityState : undefined;
      if (shouldTickNow(state)) {
        void run();
      }
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, run]);

  return { refetch: run, lastFetchedAt, isFetching };
}
