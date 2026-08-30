-- Correctif : un avoir créé pour un RETOUR TOTAL d'une facture IMPAYÉE était
-- enregistré comme 'PAID' (affiché "Crédité"), alors qu'il annule simplement la
-- dette du client (aucun remboursement dû puisque rien n'avait été payé).
-- → le passer en CANCELLED et retirer le crédit client émis à tort.

-- 1. Avoirs concernés : retour total (facture d'origine annulée) d'une facture
--    jamais payée (aucun paiement enregistré).
UPDATE documents
SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
WHERE type = 'CREDIT_NOTE'
  AND status = 'PAID'
  AND original_document_id IN (
    SELECT inv.id
    FROM documents inv
    WHERE inv.status = 'CANCELLED'
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.document_id = inv.id)
  );

-- 2. Supprimer les écritures de crédit client (type PAYMENT) émis à tort pour
--    ces avoirs annulés.
DELETE FROM client_credits
WHERE type = 'PAYMENT'
  AND EXISTS (
    SELECT 1
    FROM documents cn
    WHERE cn.type = 'CREDIT_NOTE'
      AND cn.status = 'CANCELLED'
      AND cn.original_document_id IN (
        SELECT inv.id
        FROM documents inv
        WHERE inv.status = 'CANCELLED'
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.document_id = inv.id)
      )
      AND client_credits.description LIKE 'Avoir ' || cn.document_number || '%'
  );
