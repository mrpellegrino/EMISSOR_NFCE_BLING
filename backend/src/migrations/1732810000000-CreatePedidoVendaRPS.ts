import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreatePedidoVendaRPS1732810000000 implements MigrationInterface {
    name = 'CreatePedidoVendaRPS1732810000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "pedidos_venda_rps",
                columns: [
                    {
                        name: "id",
                        type: "integer",
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: "increment",
                    },
                    {
                        name: "pedidoVendaId",
                        type: "integer",
                        isUnique: true,
                    },
                    {
                        name: "numeroPedido",
                        type: "integer",
                    },
                    {
                        name: "numeroRPS",
                        type: "varchar",
                        length: "255",
                        isNullable: true,
                    },
                    {
                        name: "serie",
                        type: "varchar",
                        length: "10",
                        isNullable: true,
                    },
                    {
                        name: "nfseId",
                        type: "integer",
                        isNullable: true,
                    },
                    {
                        name: "numeroNFSe",
                        type: "varchar",
                        length: "255",
                        isNullable: true,
                    },
                    {
                        name: "status",
                        type: "varchar",
                        length: "50",
                    },
                    {
                        name: "mensagemErro",
                        type: "text",
                        isNullable: true,
                    },
                    {
                        name: "valorTotal",
                        type: "decimal",
                        precision: 10,
                        scale: 2,
                    },
                    {
                        name: "nomeCliente",
                        type: "varchar",
                        length: "255",
                    },
                    {
                        name: "dataEmissao",
                        type: "timestamp",
                        isNullable: true,
                    },
                    {
                        name: "createdAt",
                        type: "timestamp",
                        default: "CURRENT_TIMESTAMP",
                    },
                    {
                        name: "updatedAt",
                        type: "timestamp",
                        default: "CURRENT_TIMESTAMP",
                    },
                ],
            }),
            true
        );

        // Criar índice único no pedidoVendaId
        await queryRunner.createIndex(
            "pedidos_venda_rps",
            new TableIndex({
                name: "IDX_PEDIDO_VENDA_ID",
                columnNames: ["pedidoVendaId"],
                isUnique: true,
            })
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex("pedidos_venda_rps", "IDX_PEDIDO_VENDA_ID");
        await queryRunner.dropTable("pedidos_venda_rps");
    }
}
