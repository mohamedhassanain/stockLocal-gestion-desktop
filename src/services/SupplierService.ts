import { SupplierRepository, type Supplier, type SupplierCredit } from '../repositories/SupplierRepository';
import { db } from '../database/config/connection';

export const SupplierService = {

  createSupplier(data: Omit<Supplier, 'id' | 'created_at' | 'updated_at' | 'balance'>): Supplier {
    if (!data.name || data.name.trim() === '') {
      throw new Error('Le nom du fournisseur est obligatoire.');
    }
    return SupplierRepository.create(data);
  },

  updateSupplier(id: string, data: Partial<Omit<Supplier, 'id' | 'created_at' | 'updated_at' | 'balance'>>): Supplier {
    return SupplierRepository.update(id, data);
  },

  // Ajouter une dette (On doit de l'argent au fournisseur)
  addDebt(supplierId: string, amount: number, description: string, userId: string): SupplierCredit {
    if (amount <= 0) throw new Error('Le montant doit être supérieur à 0.');
    const supplier = SupplierRepository.getById(supplierId);
    if (!supplier) throw new Error('Fournisseur introuvable.');

    return db.transaction(() => {
      return SupplierRepository.addCredit({
        supplier_id: supplierId,
        type: 'DEBT',
        amount,
        description,
        user_id: userId
      });
    })();
  },

  // Enregistrer un paiement au fournisseur
  recordPayment(supplierId: string, amount: number, description: string, userId: string): SupplierCredit {
    if (amount <= 0) throw new Error('Le montant doit être supérieur à 0.');
    
    // Facultatif: On pourrait empêcher de payer plus que la dette, mais certains permettent des avances.
    const currentBalance = SupplierRepository.getBalance(supplierId);
    if (amount > currentBalance && currentBalance > 0) {
       // Warning ou throw error ? Laissons passer pour les avances, ou bloquons. Bloquons pour simplifier.
       throw new Error(`Le paiement (${amount} MAD) dépasse la dette actuelle (${currentBalance.toFixed(2)} MAD).`);
    }

    return db.transaction(() => {
      return SupplierRepository.addCredit({
        supplier_id: supplierId,
        type: 'PAYMENT',
        amount,
        description: description || 'Paiement effectué',
        user_id: userId
      });
    })();
  },

  getAllSuppliers(): Supplier[] {
    return SupplierRepository.getAll();
  },

  searchSuppliers(query: string): Supplier[] {
    if (!query || query.trim() === '') return SupplierRepository.getAll();
    return SupplierRepository.search(query.trim());
  },

  getSupplierHistory(supplierId: string): SupplierCredit[] {
    return SupplierRepository.getHistory(supplierId);
  }
};
