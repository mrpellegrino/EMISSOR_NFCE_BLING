import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskCurrency, parseCurrency } from '../src/services/currency.ts';

test('BRL mask preserves the target amount sent to the server', () => {
  const masked = maskCurrency('15700000');
  assert.equal(masked.replace(/\s/g, ' '), 'R$ 157.000,00');
  assert.equal(parseCurrency(masked), 157000);
  assert.equal(parseCurrency(maskCurrency('R$ 156.913,50')), 156913.5);
  assert.equal(parseCurrency(maskCurrency('1')), 0.01);
  assert.equal(maskCurrency(''), '');
  assert.equal(parseCurrency(''), 0);
});
