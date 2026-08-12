const {
    evaluateRequirements,
    parseStages,
    summarizeServerMetrics,
    summarizeSamples
} = require('../scripts/load-test-lib');

describe('metricas do teste de capacidade', () => {
    it('calcula P95, RPS e taxa de falhas', () => {
        const samples = Array.from({ length: 20 }, (_, index) => ({
            durationMs: (index + 1) * 10,
            statusCode: index === 19 ? 500 : 200,
            responseBytes: 1024,
            itemCount: 20
        }));

        const summary = summarizeSamples(samples, 2000);

        expect(summary.totalRequests).toBe(20);
        expect(summary.latencyMs.p95).toBe(190);
        expect(summary.rps).toBe(10);
        expect(summary.serverErrorRate).toBe(0.05);
        expect(summary.maxResponseBytes).toBe(1024);
        expect(summary.maxItemsPerResponse).toBe(20);
    });

    it('compara o resultado com RNF01, RNF02 e RNF03', () => {
        expect(evaluateRequirements({
            latencyMs: { p95: 499 },
            rps: 20,
            serverErrorRate: 0.009,
            maxResponseBytes: 2 * 1024 * 1024,
            maxItemsPerResponse: 50
        })).toEqual({
            RNF01: 'passed',
            RNF02: 'passed',
            RNF03: 'passed'
        });

        expect(evaluateRequirements({
            latencyMs: { p95: 501 },
            rps: 19.9,
            serverErrorRate: 0.01,
            maxResponseBytes: (2 * 1024 * 1024) + 1,
            maxItemsPerResponse: 51
        })).toEqual({
            RNF01: 'failed',
            RNF02: 'failed',
            RNF03: 'failed'
        });
    });

    it('aceita apenas estagios progressivos positivos', () => {
        expect(parseStages('10,25,50,100')).toEqual([10, 25, 50, 100]);
        expect(() => parseStages('10,0,abc')).toThrow('Estagios de carga invalidos.');
    });

    it('resume CPU, memoria e conexoes observadas na API', () => {
        expect(summarizeServerMetrics([
            {
                sampledAtMs: 1000,
                process: {
                    cpuUserMicros: 100000,
                    cpuSystemMicros: 50000,
                    rssBytes: 1000,
                    heapUsedBytes: 500
                },
                database: { connections: 2 }
            },
            {
                sampledAtMs: 2000,
                process: {
                    cpuUserMicros: 500000,
                    cpuSystemMicros: 150000,
                    rssBytes: 2000,
                    heapUsedBytes: 900
                },
                database: { connections: 4 }
            }
        ])).toEqual({
            status: 'collected',
            cpuPercent: 50,
            maxRssBytes: 2000,
            maxHeapUsedBytes: 900,
            maxDatabaseConnections: 4,
            samples: 2
        });
    });
});
