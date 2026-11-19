const { getCapacityConfiguration } = require('../../scripts/load/capacity-config');
const { assessStage, summarizeOperation } = require('../../scripts/load/capacity-report');
const { makeCapacityOperations } = require('../../scripts/load/capacity-scenarios');
const { summarizeTimeWindows } = require('../../scripts/load/workload');

function stage(overrides = {}) {
    const metrics = { totalRequests: 200, failureRate: 0, latencyMs: { p95: 100 } };
    return { ...metrics, endpoints: { 'GET /example': metrics }, failures: [], timeWindows: [], virtualUsers: 8, rps: 20, ...overrides };
}

describe('perfis de capacidade', () => {
    it.each([
        ['sustained', [8], 300, 'browse'],
        ['stress', [1, 5, 10, 25, 50], 60, 'search'],
        ['operation', [8], 60, 'all']
    ])('configura %s sem substituir a suíte de cobertura', (mode, stages, durationSeconds, operation) => {
        expect(getCapacityConfiguration([`--mode=${mode}`])).toMatchObject({ mode, stages, durationSeconds, operation, warmupSeconds: 10 });
    });

    it('aceita critérios explícitos e duração prolongada', () => {
        expect(getCapacityConfiguration(['--mode=sustained', '--duration=900', '--p95=700', '--min-samples=250', '--error-percent=2']))
            .toMatchObject({ durationSeconds: 900, p95LimitMs: 700, minSamples: 250, errorPercent: 2 });
    });

    it.each(['--mode=unknown', '--mode=__proto__', '--operation=login', '--duration=1801', '--rps=1001', '--stages=1,1', '--stages=101', '--url=http://example.invalid'])('recusa %s antes de iniciar o ambiente', argument => {
        expect(() => getCapacityConfiguration([argument])).toThrow();
    });

    it('recusa argumentos duplicados e alvos externos ou APIs locais existentes', () => {
        expect(() => getCapacityConfiguration(['--duration=30', '--duration=60'])).toThrow(/duplicado/);
        expect(() => getCapacityConfiguration([], { LOAD_TEST_URL: 'http://example.invalid' })).toThrow();
        expect(() => getCapacityConfiguration([], { LOAD_TEST_URL: 'http://127.0.0.1:3000' })).toThrow(/descartável/);
    });
});

describe('avaliação dos estágios', () => {
    const config = getCapacityConfiguration();

    it('não aprova uma rota com poucas amostras mesmo se o agregado tiver muitas', () => {
        const result = assessStage(stage({ endpoints: { 'GET /example': { totalRequests: 2, failureRate: 0, latencyMs: { p95: 5 } } } }), config);
        expect(result.assessment.status).toBe('inconclusive');
        expect(result.endpointAssessments['GET /example'].reasons).toContain('insufficient_samples');
    });

    it.each([
        { failureRate: 0.02 },
        { latencyMs: { p95: 501 } },
        { failures: [{ type: 'scenario_assertion' }] },
        { timeWindows: [{ totalRequests: 200, failureRate: 0, latencyMs: { p95: 1000 } }] }
    ])('detecta degradação no caso %j', overrides => {
        expect(assessStage(stage(overrides), config).assessment.status).toBe('degraded');
    });

    it('distingue teto imposto pelo gerador e duração interrompida', () => {
        const result = assessStage(stage({ rps: 99, stoppedOnSampleLimit: true }), config);
        expect(result.harnessRateLimitReached).toBe(true);
        expect(result.assessment.status).toBe('inconclusive');
    });

    it('respeita a tolerância de erro HTTP sem ocultar um endpoint lento', () => {
        const tolerated = stage({ failureRate: 0.005, failures: [{ type: 'request_failed' }] });
        expect(assessStage(tolerated, config).assessment.status).toBe('passed');
        const slow = stage({ endpoints: { 'GET /slow': { totalRequests: 200, failureRate: 0, latencyMs: { p95: 900 } } } });
        expect(assessStage(slow, config).assessment.reasons).toContain('endpoint_criteria');
    });

    it('informa somente o maior estágio validado, sem declarar capacidade máxima', () => {
        const passed = assessStage(stage(), config);
        const failed = assessStage(stage({ virtualUsers: 16, latencyMs: { p95: 900 } }), config);
        expect(summarizeOperation([passed])).toMatchObject({ highestValidatedClients: 8, firstDegradedClients: null, maximumCapacityEstablished: false });
        expect(summarizeOperation([passed, failed])).toMatchObject({ highestValidatedClients: 8, firstDegradedClients: 16, status: 'degraded' });
    });

    it('separa janelas no tempo incluindo a final parcial', () => {
        const samples = [100, 1200, 2300].map(completedAtMs => ({ completedAtMs, statusCode: 200, expectedStatus: true, durationMs: 5 }));
        const windows = summarizeTimeWindows(samples, 0, 2500, 1);
        expect(windows.map(window => window.totalRequests)).toEqual([1, 1, 1]);
        expect(windows.at(-1)).toMatchObject({ fromSeconds: 2, toSeconds: 2.5, elapsedMs: 500 });
    });
});

describe('cenários de sucesso repetíveis', () => {
    it('isola escritas por cliente e desfaz cada ciclo de coleção', async () => {
        let index = 0;
        const fixtures = { catalog: { volumeIds: [12] }, users: { member: {}, admin: {} },
            createUser: async () => ({ cookie: `session-${index++}` }) };
        const [operation] = await makeCapacityOperations(fixtures, { operation: 'collection-write', stages: [2] });
        const request = jest.fn(async options => ({ body: { owned: true, read: true }, status: options.expectedStatus }));
        for (const workerId of [0, 1]) await operation.scenarios[0].run({ request, workerId });
        expect(request.mock.calls.map(([options]) => [options.method, options.cookie])).toEqual([
            ['PUT', 'session-0'], ['PATCH', 'session-0'], ['DELETE', 'session-0'],
            ['PUT', 'session-1'], ['PATCH', 'session-1'], ['DELETE', 'session-1']
        ]);
    });
});
