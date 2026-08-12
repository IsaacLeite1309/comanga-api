const { Buffer } = require('node:buffer');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const {
    evaluateRequirements,
    parseStages,
    summarizeServerMetrics,
    summarizeSamples
} = require('./load-test-lib');

function parseArguments(argv) {
    return argv.reduce((argumentsMap, argument) => {
        if (!argument.startsWith('--')) return argumentsMap;
        const [key, ...valueParts] = argument.slice(2).split('=');
        argumentsMap[key] = valueParts.join('=');
        return argumentsMap;
    }, {});
}

async function executeRequest(url, timeoutMs) {
    const startedAt = performance.now();

    try {
        const response = await globalThis.fetch(url, {
            headers: { accept: 'application/json' },
            signal: globalThis.AbortSignal.timeout(timeoutMs)
        });
        const responseBody = await response.arrayBuffer();
        let itemCount;

        if (response.headers.get('content-type')?.includes('application/json')) {
            try {
                const payload = JSON.parse(Buffer.from(responseBody).toString('utf8'));
                const collection = [payload.items, payload.data, payload.results, payload.works, payload.editions]
                    .find(Array.isArray);
                if (collection) itemCount = collection.length;
            } catch {
                itemCount = undefined;
            }
        }

        return {
            durationMs: Math.round(performance.now() - startedAt),
            statusCode: response.status,
            responseBytes: responseBody.byteLength,
            itemCount
        };
    } catch (error) {
        return {
            durationMs: Math.round(performance.now() - startedAt),
            statusCode: 0,
            responseBytes: 0,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

async function collectMetrics(metricsUrl, opsToken, timeoutMs) {
    if (!metricsUrl || !opsToken) return undefined;

    try {
        const response = await globalThis.fetch(metricsUrl, {
            headers: {
                accept: 'application/json',
                'x-ops-token': opsToken
            },
            signal: globalThis.AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) return undefined;
        return {
            sampledAtMs: Date.now(),
            ...(await response.json())
        };
    } catch {
        return undefined;
    }
}

async function runStage({ url, virtualUsers, durationMs, timeoutMs, metricsUrl, opsToken }) {
    const samples = [];
    const metrics = [];
    const startedAt = performance.now();
    const deadline = startedAt + durationMs;

    async function worker() {
        while (performance.now() < deadline) {
            samples.push(await executeRequest(url, timeoutMs));
        }
    }

    async function monitor() {
        while (performance.now() < deadline) {
            const observation = await collectMetrics(metricsUrl, opsToken, timeoutMs);
            if (observation) metrics.push(observation);
            await delay(1000);
        }
        const observation = await collectMetrics(metricsUrl, opsToken, timeoutMs);
        if (observation) metrics.push(observation);
    }

    await Promise.all([
        ...Array.from({ length: virtualUsers }, () => worker()),
        monitor()
    ]);
    const elapsedMs = Math.round(performance.now() - startedAt);
    const summary = summarizeSamples(samples, elapsedMs);

    return {
        virtualUsers,
        ...summary,
        serverMetrics: summarizeServerMetrics(metrics),
        requirements: evaluateRequirements(summary)
    };
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    const targetUrl = args.url || process.env.LOAD_TEST_URL;
    const confirmedHost = args['confirm-host'] || process.env.LOAD_TEST_CONFIRM_HOST;

    if (!targetUrl) throw new Error('Informe --url ou LOAD_TEST_URL.');

    const parsedUrl = new globalThis.URL(targetUrl);
    if (!confirmedHost || confirmedHost !== parsedUrl.host) {
        throw new Error(`Confirme o host com --confirm-host=${parsedUrl.host}.`);
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('A URL do teste deve usar HTTP ou HTTPS.');
    }

    const stages = parseStages(args.stages || process.env.LOAD_TEST_STAGES || '10,25,50,100');
    const durationSeconds = Number(args.duration || process.env.LOAD_TEST_DURATION_SECONDS || 30);
    const timeoutMs = Number(args.timeout || process.env.LOAD_TEST_TIMEOUT_MS || 10000);
    const metricsUrl = args['metrics-url'] || process.env.LOAD_TEST_METRICS_URL;
    const opsToken = process.env.OPS_METRICS_TOKEN;

    if (metricsUrl && new globalThis.URL(metricsUrl).origin !== parsedUrl.origin) {
        throw new Error('A URL de metricas deve pertencer a mesma origem do alvo.');
    }

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 300) {
        throw new Error('A duracao deve estar entre 1 e 300 segundos.');
    }

    const report = {
        generatedAt: new Date().toISOString(),
        target: `${parsedUrl.origin}${parsedUrl.pathname}`,
        environment: args.environment || process.env.LOAD_TEST_ENVIRONMENT || 'homologation',
        configuration: {
            stages,
            durationSeconds,
            timeoutMs
        },
        requirements: {
            RNF01: 'P95 <= 500 ms',
            RNF02: 'RPS >= 20 e erros HTTP 5xx < 1%',
            RNF03: 'resposta <= 2 MB e endpoint paginado em ate 50 itens'
        },
        stages: []
    };

    for (const virtualUsers of stages) {
        console.log(`Iniciando estagio com ${virtualUsers} usuarios virtuais...`);
        report.stages.push(await runStage({
            url: targetUrl,
            virtualUsers,
            durationMs: durationSeconds * 1000,
            timeoutMs,
            metricsUrl,
            opsToken
        }));
    }

    const output = args.output
        || process.env.LOAD_TEST_OUTPUT
        || path.join('docs', 'operations', 'results', 'capacity-latest.json');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Relatorio salvo em ${output}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
