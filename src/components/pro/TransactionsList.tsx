'use client';
// src/components/pro/TransactionsList.tsx
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Transaction {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number;
  clientName: string;
  serviceName: string;
  date: string;
  time: string;
}

export default function TransactionsList({ bizId }: { bizId: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stripe/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bizId, limit: 50 }),
    })
      .then((r) => r.json())
      .then((data) => setTransactions(data.transactions || []))
      .finally(() => setLoading(false));
  }, [bizId]);

  return (
    <div className="min-h-dvh">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center gap-3">
          <Link href="/pro" className="text-white/60 hover:text-white">
            ←
          </Link>
          <h1 className="text-lg font-semibold text-white">Transactions</h1>
        </div>

        {loading && <p className="text-sm text-white/40">Chargement...</p>}

        <div className="space-y-2">
          {transactions.map((t) => (
            <div key={t.id} className="flex items-center justify-between rounded-xl bg-navy-900 p-4">
              <div>
                <p className="text-sm text-white">{t.clientName}</p>
                <p className="text-xs text-white/40">
                  {t.serviceName} · {t.date} {t.time}
                </p>
              </div>
              <p className="text-sm font-medium text-mint-400">{t.amount.toFixed(2)}€</p>
            </div>
          ))}
          {!loading && transactions.length === 0 && (
            <p className="py-6 text-center text-sm text-white/40">Aucune transaction.</p>
          )}
        </div>
      </div>
    </div>
  );
}
