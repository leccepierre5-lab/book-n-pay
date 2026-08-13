-- 0046_chat_message_length_check.sql
-- Défense en profondeur pour chat_messages.text, en complément de la
-- validation applicative déjà en place (src/lib/chat.ts,
-- CHAT_MESSAGE_MAX_LENGTH = 500, revalidée côté serveur dans
-- src/app/api/chat/send/route.ts). Contexte : audit lecture seule ayant
-- identifié chat_messages.text comme le champ le plus exposé à recevoir une
-- donnée de santé (au sens CNIL) dans une base non certifiée HDS — voir CGU
-- art. 15. Cette contrainte réduit la SURFACE d'exposition (quantité de
-- texte possible par message) ; elle ne filtre aucun contenu et ne rend rien
-- "conforme" à quoi que ce soit.
--
-- Pourquoi une contrainte DB en plus de la validation applicative : c'est le
-- seul chemin d'écriture qui reste garanti même si un futur point d'entrée
-- (script d'admin, migration de données, nouvelle route) oubliait de
-- revalider la longueur — cohérent avec le principe déjà appliqué dans ce
-- repo de ne jamais reposer sur une seule couche de validation.
--
-- ⚠️ Comme les migrations précédentes, à exécuter manuellement dans le
-- Supabase SQL Editor (pas de DATABASE_URL disponible dans cet environnement).
-- NE PAS exécuter avant relecture de Pierre.

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_text_length_check
  CHECK (char_length(text) <= 500);
