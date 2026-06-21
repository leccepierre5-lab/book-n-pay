# Book'nPay — Protocole de test manuel

Ce document liste, dans l'ordre, ce qu'il faut vérifier en conditions
réelles avant de considérer le projet prêt pour de vrais utilisateurs.
Chaque étape a un critère de succès clair. Coché = validé ; sinon, reviens
vers moi avec le message d'erreur exact.

## 0. Avant de commencer

- [ ] `npm install` se termine sans erreur
- [ ] `npm run build` se termine sans erreur (c'est le test le plus important
      — tout ce qui suit ne sert à rien si le build échoue)
- [ ] Les 7 migrations SQL (`0001` → `0007`, dans l'ordre) s'exécutent sans
      erreur dans l'éditeur SQL Supabase
- [ ] `.env.local` contient toutes les clés de `.env.example`, y compris
      `INTERNAL_API_SECRET` (génère une valeur avec `openssl rand -hex 32`)
- [ ] `npm run dev` démarre et la page d'accueil (`/recherche`) affiche
      les 45 établissements de démo

## 1. Auth — client

- [ ] Inscription (`/inscription`) avec email + mot de passe + téléphone
      crée bien une ligne dans `app_users` (vérifie dans le dashboard Supabase)
- [ ] Cette ligne a un `referral_code` non NULL, au format `BNP-XXXX1234`
- [ ] Connexion (`/connexion`) avec ce compte fonctionne
- [ ] Déconnexion puis reconnexion fonctionne

## 2. Parcours de réservation simple (le flux le plus critique)

- [ ] Depuis `/recherche`, cliquer un établissement ouvre sa fiche
- [ ] Choisir une prestation → date/heure → mur d'authentification
      apparaît si pas connecté
- [ ] Après connexion, arrivée sur l'étape paiement avec le bon montant
      affiché (dépôt + frais de gestion)
- [ ] Clic sur "Payer" redirige bien vers Stripe Checkout (mode test)
- [ ] Paiement test réussi (carte `4242 4242 4242 4242`, n'importe quelle
      date future, n'importe quel CVC) redirige vers `/confirmation`
- [ ] **Vérifier dans Supabase** : `booking_members.status` est passé de
      `invite` à `paid` (peut prendre quelques secondes — c'est le webhook
      asynchrone, voir le point d'attention dans le README principal)
- [ ] `/mes-reservations` affiche bien cette réservation avec le statut
      "✓ Réservé"

⚠️ **Si le statut reste bloqué sur `invite`** : le webhook Stripe n'a pas
été reçu. Vérifie que l'URL de webhook est bien configurée dans le
dashboard Stripe (`/api/stripe/webhook`) et que `STRIPE_WEBHOOK_SECRET`
correspond à ce endpoint précis (chaque endpoint a son propre secret).

## 3. Group booking (fonctionnalité ajoutée en cours de session — teste-la en priorité, c'est la plus récente)

- [ ] Réserver une prestation avec `max_persons > 1` (ex. un cours collectif)
- [ ] Après paiement, `/confirmation` affiche bien le bouton "Partager le lien"
- [ ] Copier ce lien et l'ouvrir dans une fenêtre de navigation privée
      (simule un invité sans compte)
- [ ] Le formulaire "Rejoindre le groupe" s'affiche avec le compte à rebours
- [ ] Remplir nom + téléphone et payer fonctionne, le nouveau membre
      apparaît dans la liste avec "✓ Payé"
- [ ] Tenter de rejoindre une seconde fois avec le même téléphone affiche
      bien "déjà inscrit" plutôt que de dupliquer

## 4. Espace pro

- [ ] Créer un compte avec `role: 'pro'` (passer `role: 'pro'` dans les
      meta du signup, ou le modifier directement dans Supabase pour tester),
      avec un `biz_id` pointant vers un établissement existant
- [ ] `/pro` affiche le dashboard avec les réservations du jour
- [ ] **Stripe Connect** : cliquer "Activer Stripe Connect" redirige vers
      Stripe, terminer l'onboarding test, revenir sur `/pro?stripe_return=1`
      → vérifier que le bandeau d'avertissement disparaît (ce point a été
      corrigé tard dans l'audit — c'était cassé silencieusement avant)
- [ ] Le scanner QR (bouton "Scanner un QR code client") demande bien
      l'accès caméra et scanne un QR généré par une réservation test
- [ ] La console de caisse affiche le bon solde à encaisser et la clôture
      fonctionne (statut passe à "arrivé")
- [ ] Le calendrier mensuel affiche les réservations avec la heatmap

## 5. Espace admin

- [ ] Créer un compte avec `role: 'admin'`
- [ ] `/admin` affiche les 3 onglets (Candidatures, Configuration, Établissements)
- [ ] Modifier un palier de frais de gestion dans Configuration, puis
      vérifier qu'un nouveau checkout utilise bien la nouvelle valeur
- [ ] Geler un établissement → vérifier qu'il disparaît de `/recherche`
      et que sa fiche affiche "temporairement indisponible"
- [ ] Dégeler → vérifier qu'il réapparaît

## 6. Crons (le plus dur à tester sans attendre — voir alternative ci-dessous)

Plutôt que d'attendre le déclenchement naturel, appelle chaque endpoint
manuellement avec le bon header pour vérifier qu'il répond sans erreur :

```bash
curl -X GET https://ton-domaine.vercel.app/api/cron/check-no-shows \
  -H "Authorization: Bearer TON_CRON_SECRET"
```

- [ ] `check-no-shows` répond `{ checked, noShows, ... }` sans erreur 500
- [ ] `send-rdv-reminders` répond `{ rdvDemain, emailsEnvoyes, ... }`
- [ ] `verifier-inactivite` répond `{ alertesDouces, ... }`
- [ ] `relance-onboarding-pro` répond `{ ok: true, ... }`
- [ ] `cleanup-expired-invites` répond `{ processed, ... }`

⚠️ Rappel du point déjà documenté dans le README principal : sur le plan
Vercel Hobby, `check-no-shows` (configuré toutes les 15 min) et
`cleanup-expired-invites` (idem) **feront échouer le déploiement**, pas
juste un avertissement — il faut soit passer Pro, soit déclencher ces
deux crons via un service externe.

## 7. Cas limites à tester délibérément (trouvés pendant l'audit)

- [ ] Annuler une réservation **moins de 48h avant** le RDV → vérifier
      qu'aucun remboursement n'est déclenché (frais conservés par le pro)
- [ ] Annuler une réservation **plus de 48h avant** → vérifier le
      remboursement réel sur la carte de test Stripe
- [ ] Utiliser un Joker sur une réservation qui n'appartient pas à son
      propre compte (en modifiant la requête manuellement) → doit
      renvoyer une erreur 403, pas un remboursement
- [ ] Un membre invité dans un groupe qui ne paie pas dans les 30 minutes
      doit voir sa place automatiquement libérée

## 8. Le point le plus incertain de tout cet audit : le fuseau horaire

Ce point ne peut être validé qu'en conditions réelles de production
(pas en local) :

- [ ] Crée une réservation pour aujourd'hui à une heure connue (ex. dans
      20 minutes)
- [ ] Une fois déployé sur Vercel, attends que l'heure du RDV passe de
      15-20 minutes sans check-in
- [ ] Déclenche manuellement `check-no-shows` (curl ci-dessus)
- [ ] Vérifie que le membre passe bien à `no_show` — et surtout, que ce
      déclenchement arrive au bon moment, ni avec 1-2h d'avance ni de retard

Si décalage constaté : voir la section "Risque de fond non résolu : fuseau
horaire" dans le README principal pour la correction à appliquer
(`TZ=Europe/Paris` dans les variables d'environnement Vercel).
