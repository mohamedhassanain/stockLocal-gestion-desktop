import { ClientRepository, type Customer, type ClientCredit } from '../repositories/ClientRepository';
import { db } from '../database/config/connection';

export const ClientService = {

  createClient(data: Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'balance'>): Customer {
    if (!data.name || data.name.trim() === '') {
      throw new Error('Le nom du client est obligatoire.');
    }
    if (data.credit_limit < 0) {
      throw new Error('Le plafond de crédit ne peut pas être négatif.');
    }
    return ClientRepository.create(data);
  },

  updateClient(id: string, data: Partial<Omit<Customer, 'id' | 'created_at' | 'updated_at' | 'balance'>>): Customer {
    return ClientRepository.update(id, data);
  },

  deleteClient(id: string): void {
    ClientRepository.remove(id);
  },
  /**
   * Vérifie si une nouvelle dette respecte le plafond de crédit du client (§18).
   *
   * Règle : solde_actuel + nouvelle_vente <= credit_limit
   * Le plafond est vérifié côté service (jamais côté renderer).
   *
   * @throws Error rejetant la vente avec un message humain si le plafond est dépassé.
   */
  assertWithinCreditLimit(customerId: string, newAmount: number): void {
    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      throw new Error('Le montant de la vente doit être supérieur à 0.');
    }
    const customer = ClientRepository.getById(customerId);
    if (!customer) throw new Error('Client introuvable.');

    // Pas de plafond défini → aucune restriction
    if (customer.credit_limit <= 0) return;

    const currentBalance = ClientRepository.getBalance(customerId);
    if (currentBalance + newAmount > customer.credit_limit) {
      const remaining = Math.max(0, customer.credit_limit - currentBalance);
      throw new Error(
        `CREDIT_LIMIT_EXCEEDED : plafond de crédit dépassé. ` +
        `Plafond : ${customer.credit_limit.toFixed(2)} MAD, solde actuel : ${currentBalance.toFixed(2)} MAD, ` +
        `reste disponible : ${remaining.toFixed(2)} MAD.`
      );
    }
  },

  // Ajouter une dette (vente à crédit - نسيئة)
  addDebt(customerId: string, amount: number, description: string): ClientCredit {
    if (amount <= 0) throw new Error('Le montant doit être supérieur à 0.');
    const customer = ClientRepository.getById(customerId);
    if (!customer) throw new Error('Client introuvable.');

    // Vérifier le plafond de crédit (via la fonction partagée)
    this.assertWithinCreditLimit(customerId, amount);

    return db.transaction(() => {
      return ClientRepository.addCredit({
        customer_id: customerId,
        type: 'CREDIT',
        amount,
        description,
      });
    })();
  },

  // Encaisser un paiement
  recordPayment(customerId: string, amount: number, description: string): ClientCredit {
    if (amount <= 0) throw new Error('Le montant doit être supérieur à 0.');
    const currentBalance = ClientRepository.getBalance(customerId);
    if (amount > currentBalance) {
      throw new Error(`Le paiement (${amount} MAD) dépasse la dette actuelle (${currentBalance.toFixed(2)} MAD).`);
    }

    return db.transaction(() => {
      return ClientRepository.addCredit({
        customer_id: customerId,
        type: 'PAYMENT',
        amount,
        description: description || 'Paiement reçu',
      });
    })();
  },

  getAllClients(): Customer[] {
    return ClientRepository.getAll();
  },

  searchClients(query: string): Customer[] {
    if (!query || query.trim() === '') return ClientRepository.getAll();
    return ClientRepository.search(query.trim());
  },

  getClientHistory(customerId: string): ClientCredit[] {
    return ClientRepository.getHistory(customerId);
  }
};
