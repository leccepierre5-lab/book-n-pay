# Décision — modèle de fidélité "Sérénité"

Trois versions différentes du même modèle coexistent actuellement (mémoire de
session Claude, CGU publiée, code en production). Aucune n'a été modifiée —
ce document sert uniquement à trancher laquelle fait foi.

Les seuils de palier (16 / 31 / 51 RDV honorés) sont cohérents dans les trois
versions — ce n'est pas le sujet. Le désaccord porte sur **le nombre de
Jokers par palier** et **le taux de remboursement**.

## Version A — Mémoire de session (spec dite "figée")

| Palier | Seuil (RDV honorés) | Jokers annuels |
|---|---|---|
| Standard | 0 | 0 |
| Bronze | 16 | 1 |
| Argent | 31 | 2 |
| Gold | 51 | 3 |

Taux de remboursement par Joker : non précisé dans cette version.

## Version B — CGU publiée (`src/app/(public)/cgu/page.tsx`, §4.2)

| Palier | Seuil (RDV honorés) | Jokers annuels | Remboursement |
|---|---|---|---|
| Standard | 1-15 | 1 | 50 % |
| Bronze | 16-30 | 1 | 100 % |
| Argent | 31-50 | 2 | 100 % |
| Gold | 50+ | 3 | 100 % |

C'est le texte actuellement engageant contractuellement Book'nPay envers ses
utilisateurs.

## Version C — Code en production (`src/lib/booking-utils.ts:315-334`)

```ts
export const JOKERS_LIMITES = { Standard: 1, Bronze: 2, Argent: 3, Gold: 4 };
export const JOKERS_PCT = { Standard: 1.0, Bronze: 1.0, Argent: 1.0, Gold: 1.0 };

export function computeStatut(rdvHonores: number): { statut: string; jokers: number } {
  if (rdvHonores >= 51) return { statut: 'Gold', jokers: 4 };
  if (rdvHonores >= 31) return { statut: 'Argent', jokers: 3 };
  if (rdvHonores >= 16) return { statut: 'Bronze', jokers: 2 };
  return { statut: 'Standard', jokers: 1 };
}
```

| Palier | Seuil (RDV honorés) | Jokers annuels | Remboursement |
|---|---|---|---|
| Standard | 0-15 | 1 | 100 % |
| Bronze | 16-30 | 2 | 100 % |
| Argent | 31-50 | 3 | 100 % |
| Gold | 51+ | 4 | 100 % |

`JOKERS_PCT` est appliqué tel quel dans `src/app/api/loyalty/use-joker/route.ts:103`
— c'est ce qui tourne réellement en prod aujourd'hui. Conséquence concrète :
un client Standard qui utilise son Joker est actuellement remboursé à 100 %,
alors que la CGU publiée ne lui promet que 50 %.

## Décision

*(à remplir)*

- Version retenue :
- Jokers par palier (Standard/Bronze/Argent/Gold) :
- Taux de remboursement par palier :
- Date :
- Notes :
