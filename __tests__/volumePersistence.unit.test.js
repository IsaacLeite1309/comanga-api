const fs = require('fs');
const path = require('path');

const apiRoot = path.resolve(__dirname, '..');

describe('persistencia final de Volumes', () => {
    it('usa Data completa como padrao no Prisma', () => {
        const schema = fs.readFileSync(path.join(apiRoot, 'prisma', 'schema.prisma'), 'utf8');

        expect(schema).toMatch(/releaseDatePrecision\s+String\s+@default\("Completa"\)/);
    });

    it('versiona uma restricao para novas linhas com precisao e componentes de data coerentes', () => {
        const migrationPath = path.join(
            apiRoot,
            'prisma',
            'migrations',
            '20260818120000_enforce_volume_release_date',
            'migration.sql'
        );

        expect(fs.existsSync(migrationPath)).toBe(true);
        const sql = fs.readFileSync(migrationPath, 'utf8');
        expect(sql).toContain("SET DEFAULT 'Completa'");
        expect(sql).toMatch(/CHECK\s*\([\s\S]*release_date_precision IN \('Completa', 'Mes e ano', 'Ano'\)/);
        expect(sql).toMatch(/NOT VALID/);
    });
});
