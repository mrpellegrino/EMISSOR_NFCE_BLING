const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function maskCurrency(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits ? brl.format(Number(digits) / 100) : '';
}

export function parseCurrency(value: string): number {
  return Number(value.replace(/\D/g, '')) / 100;
}

export function formatBRL(value: number): string {
  return brl.format(Number.isFinite(value) ? value : 0);
}
