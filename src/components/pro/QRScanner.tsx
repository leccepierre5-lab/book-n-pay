'use client';
// src/components/pro/QRScanner.tsx
// Port de src/components/QRScanner.jsx — utilise html5-qrcode (ajoutée à
// package.json). ⚠️ Dépendance non vérifiée par exécution dans cette session
// (pas d'accès npm) ; teste l'installation avant de compter sur ce composant.
import { useEffect, useRef, useState } from 'react';

export default function QRScanner({
  onScan,
  onClose,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const scannerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let scanner: any;

    import('html5-qrcode').then(({ Html5Qrcode }) => {
      scanner = new Html5Qrcode('bnp-qr-scanner');
      scannerRef.current = scanner;

      scanner
        .start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText: string) => {
            scanner.stop().catch(() => {});
            onScan(decodedText);
          },
          () => {}
        )
        .catch(() => {
          setError("Impossible d'accéder à la caméra. Vérifie les permissions.");
        });
    });

    return () => {
      scannerRef.current?.stop().catch(() => {});
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85">
      <div className="mx-4 w-full max-w-sm overflow-hidden rounded-2xl bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <span className="text-sm font-semibold text-navy-950">Scanner le QR Code</span>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100">
            ✕
          </button>
        </div>
        <div className="p-4">
          {error ? (
            <div className="py-8 text-center">
              <p className="text-sm text-red-600">{error}</p>
              <button
                onClick={onClose}
                className="mt-3 rounded-lg bg-navy-950 px-4 py-2 text-xs font-semibold text-white"
              >
                Fermer
              </button>
            </div>
          ) : (
            <>
              <div id="bnp-qr-scanner" className="w-full overflow-hidden rounded-xl" />
              <p className="mt-3 text-center text-[11px] text-gray-500">
                Pointe la caméra vers le QR code du client
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
