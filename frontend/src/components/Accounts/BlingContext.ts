import { createContext, useContext } from 'react';
import { createBlingApi } from '../../services/blingApi';
export const BlingContext = createContext<ReturnType<typeof createBlingApi> | null>(null);
export function useBlingApi() {
  const api = useContext(BlingContext);
  if (!api) throw new Error('Selecione uma conta Bling.');
  return api;
}
