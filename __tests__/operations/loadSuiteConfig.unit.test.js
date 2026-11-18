const { getRunConfiguration } = require('../../scripts/load/config');
const { getPassword } = require('../../scripts/load/fixtures');

describe('configuração da suíte de carga isolada', () => {
    it('usa uma porta efêmera por padrão e aceita ajustes locais por ambiente', () => {
        expect(getRunConfiguration()).toMatchObject({ port: 0, readPath: null });

        expect(getRunConfiguration([], {
            LOAD_TEST_URL: 'http://127.0.0.1:3180/api/public/works?page=1&limit=50',
            LOAD_TEST_CONFIRM_HOST: '127.0.0.1:3180',
            LOAD_TEST_ENVIRONMENT: 'local',
            LOAD_TEST_STAGES: '1,5,25',
            LOAD_TEST_DURATION_SECONDS: '12',
            LOAD_TEST_TIMEOUT_MS: '2000',
            LOAD_TEST_MAX_RPS: '50'
        })).toMatchObject({
            port: 3180,
            readPath: '/api/public/works?page=1&limit=50',
            stages: [1, 5, 25],
            durationSeconds: 12,
            timeoutMs: 2000,
            maxRps: 50
        });
    });

    it.each([
        'https://example.invalid/api/public/works',
        'http://example.invalid',
        'https://127.0.0.1:3180',
        'http://localhost:3180',
        'http://127.0.0.1.example.invalid:3180',
        'http://credentials@127.0.0.1:3180'
    ])('recusa o alvo %s mesmo com o host confirmado', (url) => {
        expect(() => getRunConfiguration([], {
            LOAD_TEST_URL: url,
            LOAD_TEST_CONFIRM_HOST: new globalThis.URL(url).host
        })).toThrow(/127\.0\.0\.1/);
    });

    it.each([
        ['LOAD_TEST_ENVIRONMENT', 'production', /ENVIRONMENT=local/],
        ['LOAD_TEST_CONFIRM_HOST', '127.0.0.1:3181', /CONFIRM_HOST/],
        ['LOAD_TEST_METRICS_URL', 'http://127.0.0.1:3181/health/metrics', /coleta de métricas/],
        ['LOAD_TEST_STAGES', '1,26', /25 clientes/],
        ['LOAD_TEST_STAGES', '1,2,3,4,5,6', /5 estágios/],
        ['LOAD_TEST_STAGES', '1,4,2', /Estagios de carga invalidos/],
        ['LOAD_TEST_DURATION_SECONDS', '121', /1 e 120/],
        ['LOAD_TEST_DURATION_SECONDS', '0.5', /inteiro/],
        ['LOAD_TEST_TIMEOUT_MS', '15001', /100 e 15000/],
        ['LOAD_TEST_MAX_RPS', '101', /1 e 100/]
    ])('recusa %s=%s antes de iniciar a API', (name, value, error) => {
        expect(() => getRunConfiguration(['--url=http://127.0.0.1:3180'], { [name]: value })).toThrow(error);
    });

    it('aceita credenciais fortes de teste sem depender de credenciais existentes', () => {
        const password = 'SenhaSintetica!123';
        const generated = getPassword({});
        expect(getPassword({ LOAD_TEST_PASSWORD: password })).toBe(password);
        expect(getPassword({ LOAD_TEST_PASSWORD: generated })).toBe(generated);
        expect(() => getPassword({ LOAD_TEST_PASSWORD: 'fraca' })).toThrow(/LOAD_TEST_PASSWORD/);
    });
});
