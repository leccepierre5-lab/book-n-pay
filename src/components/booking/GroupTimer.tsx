'use client';
import { useEffect, useState } from 'react';

function getColor(seconds: number): { text: string; border: string; bg: string } {
  if (seconds > 600) return { text: '#34d399', border: 'rgba(52,211,153,0.3)', bg: 'rgba(52,211,153,0.08)' };
  if (seconds > 300) return { text: '#f59e0b', border: 'rgba(245,158,11,0.3)', bg: 'rgba(245,158,11,0.08)' };
  return { text: '#ef4444', border: 'rgba(239,68,68,0.3)', bg: 'rgba(239,68,68,0.08)' };
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function GroupTimer({ deadline }: { deadline: string }) {
  const [seconds, setSeconds] = useState<number>(() =>
    Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(id);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  if (seconds <= 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl px-3 py-2 border"
        style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)' }}
      >
        <svg className="w-3.5 h-3.5 text-red-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span className="text-xs font-semibold text-red-400">Délai expiré</span>
      </div>
    );
  }

  const { text, border, bg } = getColor(seconds);

  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2 border"
      style={{ background: bg, borderColor: border }}
    >
      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke={text} strokeWidth="2">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <span className="text-xs font-semibold tabular-nums" style={{ color: text }}>
        {fmt(seconds)} pour compléter le groupe
      </span>
    </div>
  );
}
