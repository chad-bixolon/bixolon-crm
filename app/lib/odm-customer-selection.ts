export type OdmCustomerChoice = { id: number; label: string };

export function addOdmCustomer(selected: OdmCustomerChoice[], account: OdmCustomerChoice) {
  return selected.some(item => item.id === account.id) ? selected : [...selected, account];
}

export function removeOdmCustomer(selected: OdmCustomerChoice[], accountId: number) {
  return selected.filter(item => item.id !== accountId);
}
