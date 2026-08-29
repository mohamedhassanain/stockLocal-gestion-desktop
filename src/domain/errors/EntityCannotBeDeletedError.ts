export class EntityCannotBeDeletedError extends Error {
  constructor(entityName: string, references: { name: string; count: number }[]) {
    const details = references
      .filter(ref => ref.count > 0)
      .map(ref => `- ${ref.count} ${ref.name}`)
      .join('\n');

    const stockMessage = references.some(ref => /stock|inventaire|mouvement/i.test(ref.name))
      ? `\n\nCe ${entityName} possède un historique de stock.`
      : '';

    const message = `Impossible de supprimer définitivement ce ${entityName}.${stockMessage}\n\nIl est utilisé dans :\n${details}\n\nVeuillez utiliser l'option "Archiver" pour le masquer tout en conservant son historique.`;

    super(message);
    this.name = 'EntityCannotBeDeletedError';
  }
}
