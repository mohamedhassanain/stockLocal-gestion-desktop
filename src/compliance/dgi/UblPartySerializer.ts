/**
 * ─── Sérialisation des parties UBL (fournisseur / acheteur) ──────────────────
 *
 * ⚠️  À AJUSTER QUAND LES SPÉCIFICATIONS OFFICIELLES SERONT PUBLIÉES.
 *
 * Le mapping EXACT des champs marocains (ICE, identifiant fiscal, registre de
 * commerce, adresse normalisée) à leur emplacement UBL définitif devra être
 * confirmé avec la documentation DGI. Ici on adopte le placement UBL 2.1
 * usuel : l'ICE/IF dans `cac:PartyTaxScheme/cbc:CompanyID`, la raison sociale
 * dans `cac:PartyLegalEntity/cbc:RegistrationName`.
 *
 * Ce fichier est PUR (aucune dépendance `db`/`electron`).
 */

import { xmlContainer, xmlLeaf, xmlOptionalLeaf } from './UblXmlBuilder';
import { UBL_TAX_SCHEME_ID_VAT, type UblParty } from './ublTypes';

/** Balise agrégat utilisée pour fournisseur / client. */
export type UblPartyTag = 'cac:AccountingSupplierParty' | 'cac:AccountingCustomerParty';

/** Construit `cac:PartyName` (nom lisible de la partie). */
function buildPartyName(name: string, level: number): string {
  return xmlContainer('cac:PartyName', level, [
    xmlLeaf('cbc:Name', name, level + 1),
  ]);
}

/** Construit `cac:PostalAddress` si une adresse est présente. */
function buildPostalAddress(address: string | null | undefined, level: number): string {
  if (!address) return '';
  return xmlContainer('cac:PostalAddress', level, [
    xmlLeaf('cbc:StreetName', address, level + 1),
  ]);
}

/**
 * Construit `cac:PartyTaxScheme` (identifiant fiscal / ICE).
 * ⚠️ Emplacement à confirmer avec les spécifications DGI (ICE = identifiant
 * commun d'entreprise au Maroc).
 */
function buildPartyTaxScheme(party: UblParty, level: number): string {
  const taxIdentifier = party.ice ?? party.taxId ?? '';
  if (!taxIdentifier) return '';
  return xmlContainer('cac:PartyTaxScheme', level, [
    xmlLeaf('cbc:CompanyID', taxIdentifier, level + 1),
    xmlContainer('cac:TaxScheme', level + 1, [
      xmlLeaf('cbc:ID', UBL_TAX_SCHEME_ID_VAT, level + 2),
    ]),
  ]);
}

/**
 * Construit `cac:PartyLegalEntity` : raison sociale (obligatoire) + registre de
 * commerce éventuel.
 */
function buildPartyLegalEntity(party: UblParty, level: number): string {
  return xmlContainer('cac:PartyLegalEntity', level, [
    xmlLeaf('cbc:RegistrationName', party.name, level + 1),
    xmlOptionalLeaf('cbc:CompanyID', party.rc ?? null, level + 1),
  ]);
}

/** Construit `cac:Contact` si un téléphone ou un email est présent. */
function buildContact(party: UblParty, level: number): string {
  if (!party.phone && !party.email) return '';
  return xmlContainer('cac:Contact', level, [
    xmlOptionalLeaf('cbc:Telephone', party.phone ?? null, level + 1),
    xmlOptionalLeaf('cbc:ElectronicMail', party.email ?? null, level + 1),
  ]);
}

/**
 * Sérialise une partie complète (fournisseur ou acheteur) au niveau d'indenta-
 * tion donné.
 */
export function serializeUblParty(tag: UblPartyTag, party: UblParty, level: number): string {
  const partyChildren = [
    buildPartyName(party.name, level + 2),
    buildPostalAddress(party.address, level + 2),
    buildPartyTaxScheme(party, level + 2),
    buildPartyLegalEntity(party, level + 2),
    buildContact(party, level + 2),
  ];

  return xmlContainer(tag, level, [
    xmlContainer('cac:Party', level + 1, partyChildren),
  ]);
}
