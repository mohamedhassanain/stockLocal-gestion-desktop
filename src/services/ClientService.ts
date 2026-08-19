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
  // Ajouter une dette (vente à crédit - نسيئة)
  addDebt(customerId: string, amount: number, description: string): ClientCredit {
    if (amount <= 0) throw new Error('Le montant doit être supérieur à 0.');
    const customer = ClientRepository.getById(customerId);
    if (!customer) throw new Error('Client introuvable.');

    // Vérifier le plafond de crédit
    if (customer.credit_limit > 0) {
      const currentBalance = ClientRepository.getBalance(customerId);
      if (currentBalance + amount > customer.credit_limit) {
        throw new Error(`Plafond de crédit dépassé. Plafond : ${customer.credit_limit} MAD, Solde actuel : ${currentBalance.toFixed(2)} MAD.`);
      }
    }

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
