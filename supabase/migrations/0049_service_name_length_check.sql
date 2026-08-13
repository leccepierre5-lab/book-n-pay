-- supabase/migrations/0049_service_name_length_check.sql
-- services.name : limite 60 caractères, défense en profondeur (client +
-- serveur + CHECK), même principe que chat_messages (migration 0046).
-- Contrainte non-rétroactive par nature (CHECK ne s'applique qu'aux futurs
-- INSERT/UPDATE) — confirmé le 13/08 par requête réelle qu'aucun service
-- existant ne dépasse déjà 60 caractères, donc aucun risque que cette
-- migration échoue sur des données existantes.
ALTER TABLE services
  ADD CONSTRAINT services_name_length_check
  CHECK (char_length(name) <= 60);
