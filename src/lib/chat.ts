// src/lib/chat.ts
// Constantes partagées client/serveur pour le chat pro↔client d'une réservation.

// Limite de longueur d'un message (chat_messages.text). Choisie en audit
// minimisation des données (voir CGU art. 15) : chat_messages n'est pas
// hébergé en environnement certifié HDS, donc rien ici ne "sécurise" une
// donnée de santé qui y serait saisie — la limite réduit seulement la
// surface (quantité de texte possible par message), elle ne filtre pas le
// contenu. 500 caractères ≈ plusieurs phrases, largement suffisant pour
// coordonner un rendez-vous ("je suis en retard de 10 minutes", "je me gare
// où ?"), mais assez court pour décourager un copier-coller de contenu long
// (compte-rendu, historique). Aucune limite comparable n'existait déjà
// ailleurs dans le repo au moment du choix (services.name reste volontairement
// hors périmètre de ce chantier, voir mémoire projet).
export const CHAT_MESSAGE_MAX_LENGTH = 500;
