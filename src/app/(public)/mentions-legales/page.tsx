// src/app/(public)/mentions-legales/page.tsx
// ⚠️ Page volontairement incomplète (18/07/2026) : la structure juridique de
// Book'nPay est en cours de recréation (micro-entreprise radiée, dossier CCI
// Bayonne en cours — voir mémoire projet_bnp_radiation_urssaf). La section
// "Éditeur du site" ne doit JAMAIS contenir de raison sociale/SIRET fictifs
// ou périmés — mieux vaut un encart honnête "en cours" qu'une mention légale
// fausse. `robots: noindex` tant que ce bloc n'est pas rempli, et ne pas
// linker cette page depuis la nav/footer avant complétion.
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Mentions légales',
  description: "Mentions légales de la plateforme Book'nPay.",
  robots: { index: false, follow: false },
};

export default function MentionsLegalesPage() {
  return (
    <div className="min-h-dvh bg-navy-950">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link href="/" className="mb-6 flex items-center gap-2 text-white/50 hover:text-white">
          ← Retour
        </Link>

        <h1 className="mb-2 text-2xl font-semibold text-white">Mentions légales</h1>
        <p className="mb-8 text-xs text-white/40">Dernière mise à jour : juillet 2026</p>

        <div className="space-y-7 text-sm leading-relaxed text-white/70">
          <section>
            <h2 className="mb-2 text-base font-semibold text-white">1. Éditeur du site</h2>
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
              <p>
                Cette section est en cours de finalisation. La structure juridique exploitant
                Book&apos;nPay est en cours de recréation ; l&apos;identité de l&apos;éditeur
                (raison sociale, forme juridique et capital social le cas échéant, adresse du
                siège, SIREN/SIRET, RCS et ville d&apos;immatriculation, numéro de TVA
                intracommunautaire le cas échéant) sera publiée dès que cette structure sera
                active.
              </p>
              <p className="mt-2">
                En attendant, toute question peut être adressée à{' '}
                <a href="mailto:contact@book-n-pay.com" className="text-emerald-500 underline">
                  contact@book-n-pay.com
                </a>
                .
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">2. Directeur de la publication</h2>
            <p>
              Le directeur de la publication sera identifié dans cette section une fois la
              structure juridique de l&apos;éditeur active (voir section 1).
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">3. Hébergement</h2>
            <p className="mb-3">
              <strong className="text-white">Hébergement de l&apos;application :</strong>
              <br />
              Vercel Inc.
              <br />
              340 S Lemon Ave #4133, Walnut, CA 91789, États-Unis
              <br />
              <a
                href="https://vercel.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-500 underline"
              >
                vercel.com
              </a>
            </p>
            <p>
              <strong className="text-white">Hébergement des données :</strong>
              <br />
              Supabase Inc.
              <br />
              <a
                href="https://supabase.com/legal"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-500 underline"
              >
                supabase.com/legal
              </a>
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">4. Médiateur de la consommation</h2>
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
              <p>
                Conformément à l&apos;article L.616-1 du Code de la consommation, Book&apos;nPay a
                l&apos;obligation de proposer un dispositif de médiation de la consommation.
                L&apos;identité et les coordonnées du médiateur seront publiées dans cette section
                une fois l&apos;inscription effectuée — en attente de la régularisation de la
                structure juridique (voir section 1).
              </p>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">5. Propriété intellectuelle</h2>
            <p>
              La marque « Book&apos;nPay », son logo, son identité visuelle, ainsi que l&apos;ensemble
              des éléments composant la plateforme (textes, code source, design, base de données,
              algorithmes) sont protégés par le droit de la propriété intellectuelle. Toute
              reproduction ou exploitation non autorisée est interdite. Voir également l&apos;article
              16 des{' '}
              <Link href="/cgu" className="text-emerald-500 underline">
                CGU/CGV
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">6. Données personnelles</h2>
            <p>
              Le traitement des données personnelles est détaillé à l&apos;article 8 des{' '}
              <Link href="/cgu" className="text-emerald-500 underline">
                CGU/CGV
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">7. Contact</h2>
            <p>
              Pour toute question relative au site ou à ces mentions légales :{' '}
              <a href="mailto:contact@book-n-pay.com" className="text-emerald-500 underline">
                contact@book-n-pay.com
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
