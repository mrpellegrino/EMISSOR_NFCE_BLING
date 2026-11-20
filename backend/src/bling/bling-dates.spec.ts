import { BlingService } from './bling.service';
import { AccountContext } from './account-context';

describe('Datas de emissão de NFS-e', () => {
  let service: BlingService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    service = new BlingService({} as any, {} as any, {} as any, {
      account: { serviceCode: '050801', installment: 9 },
    } as unknown as AccountContext);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    ['2026-09-30T23:59:59Z', '2026-09-30'],
    ['2026-10-01T00:00:00Z', '2026-09-30'],
    ['2026-10-01T02:59:59Z', '2026-09-30'],
    ['2026-10-01T03:00:00Z', '2026-10-01'],
    ['2027-01-01T01:00:00Z', '2026-12-31'],
  ])('usa a data de Brasília em ambos os fluxos em %s', async (instant, expected) => {
    jest.setSystemTime(new Date(instant));
    const contato = { id: 1, nome: 'Cliente de teste' };
    const pedido = await service['construirPayloadNFSe'](
      { numero: 123 }, contato, [{ valor: 50 }], 1,
    );
    const duplicata = service['criarDadosNFSe']({ numero: 123, valor: 50 }, contato);

    expect(pedido.data).toBe(expected);
    expect(pedido.dataEmissao).toBe(expected);
    expect(pedido.parcelas[0].data).toBe(expected);
    expect(duplicata.data).toBe(expected);
    expect(duplicata.dataEmissao).toBe(expected);
    expect(duplicata.parcelas[0].data).toBe(expected);
  });
});
