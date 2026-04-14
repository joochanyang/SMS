'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface PriceData {
  price: number;
  changeRate: number;
  changePrice: number;
  timestamp: number;
  source: 'websocket' | 'rest';
}

/**
 * Upbit WebSocket 실시간 시세 + REST API fallback 훅
 */
export function useUpbitPrice() {
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fallbackTimerRef = useRef<NodeJS.Timeout | null>(null);

  // REST API fallback
  const fetchRestPrice = useCallback(async () => {
    try {
      const res = await fetch('/api/usdt/price');
      if (!res.ok) throw new Error('REST API error');
      const data = await res.json();
      setPriceData({
        price: data.price,
        changeRate: data.changeRate,
        changePrice: data.changePrice,
        timestamp: data.timestamp,
        source: 'rest',
      });
      setError(null);
    } catch (err) {
      setError('시세 정보를 가져올 수 없습니다.');
      console.error('[Price] REST fallback failed:', err);
    }
  }, []);

  // WebSocket 연결
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket('wss://api.upbit.com/websocket/v1');
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
        retryCountRef.current = 0;

        // 구독 메시지 전송
        ws.send(JSON.stringify([
          { ticket: `usdt-price-${Date.now()}` },
          { type: 'ticker', codes: ['KRW-USDT'], isOnlyRealtime: true }
        ]));
      };

      ws.onmessage = async (event) => {
        try {
          let data;
          if (event.data instanceof Blob) {
            const text = await event.data.text();
            data = JSON.parse(text);
          } else {
            data = JSON.parse(event.data);
          }

          if (data.type === 'ticker' && data.code === 'KRW-USDT') {
            setPriceData({
              price: data.trade_price,
              changeRate: data.change_rate,
              changePrice: data.signed_change_price,
              timestamp: data.timestamp,
              source: 'websocket',
            });
          }
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;

        // 재연결 (exponential backoff, max 30s)
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 30000);
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(connectWebSocket, delay);
      };

      ws.onerror = () => {
        setConnected(false);
        // REST fallback
        fetchRestPrice();
      };
    } catch (err) {
      console.error('[WS] Connection failed:', err);
      setConnected(false);
      fetchRestPrice();
    }
  }, [fetchRestPrice]);

  useEffect(() => {
    // 즉시 REST 가격 가져오기 (초기 로딩)
    fetchRestPrice();

    // WebSocket 연결
    connectWebSocket();

    // REST fallback 폴링 (WebSocket 실패 시 5초마다)
    fallbackTimerRef.current = setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        fetchRestPrice();
      }
    }, 5000);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (fallbackTimerRef.current) clearInterval(fallbackTimerRef.current);
    };
  }, [connectWebSocket, fetchRestPrice]);

  return { priceData, connected, error };
}
