import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInitialOrderNumberToBlingIntegration1732700000000 implements MigrationInterface {
    name = 'AddInitialOrderNumberToBlingIntegration1732700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bling_integrations" ADD COLUMN "initialOrderNumber" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "bling_integrations" DROP COLUMN "initialOrderNumber"`);
    }
}
