const { mkdtemp, mkdir, writeFile } = require('node:fs/promises');
const { dirname, join } = require('node:path');
const { tmpdir } = require('node:os');
const { getCapacityConfiguration } = require('./load/capacity-config');
const { makeCapacityOperations } = require('./load/capacity-scenarios');
const { assessStage, summarizeOperation } = require('./load/capacity-report');
const { withEnvironment } = require('./load/environment');
const { withFixtures, getPassword } = require('./load/fixtures');
const { createCatalogFixture, seedPersonalCatalog } = require('./load/catalog-fixtures');
const { createRateLimit, runCoverage, runStage } = require('./load/workload');
const { createRouteMatcher } = require('./load/registry');

function routeMatcher(environment) {
    const routes = environment.endpoints.map(key => {
        const [method, path] = key.split(' ');
        return { method, path };
    });
    return createRouteMatcher(routes, environment.origin);
}

async function measureOperation(operation, config, environment, matchRoute, signal) {
    console.log(`Operação ${operation.name}: verificando os contratos de sucesso...`);
    const execution = { ...environment, matchRoute, signal, timeoutMs: config.timeoutMs,
        waitForSlot: createRateLimit(config.maxRps, signal) };
    const preflight = await runCoverage(operation.scenarios, execution);
    const report = { operation: operation.name, scenarios: operation.scenarios.map(({ name, endpoint, covers }) => ({ name, endpoint, covers })), preflight, stages: [] };
    if (preflight.failures.length) return { ...report, summary: { status: 'degraded', note: 'Contrato de sucesso falhou antes da carga.' } };
    const state = { index: 0, iteration: operation.scenarios.length };
    if (config.warmupSeconds) {
        console.log(`Aquecimento: ${config.warmupSeconds} s (fora das métricas medidas).`);
        const warmup = await runStage(operation.scenarios, execution, { ...config, durationSeconds: config.warmupSeconds }, state, config.stages[0]);
        report.warmup = { totalRequests: warmup.totalRequests, failures: warmup.failures };
        if (warmup.failures.length) return { ...report, summary: { status: 'degraded', note: 'Aquecimento falhou.' } };
    }
    for (const clients of config.stages) {
        console.log(`${operation.name}: ${clients} clientes por ${config.durationSeconds} s...`);
        const stage = assessStage(await runStage(operation.scenarios, execution, config, state, clients), config);
        report.stages.push(stage);
        console.log(`${stage.assessment.status} | ${stage.totalRequests} HTTP | ${stage.rps} req/s | p95 ${stage.latencyMs.p95} ms | erro ${(stage.failureRate * 100).toFixed(2)}%`);
        if (stage.assessment.status === 'degraded' || stage.stoppedOnSampleLimit) break;
    }
    return { ...report, summary: summarizeOperation(report.stages) };
}

async function execute(config, environment, fixtures, signal) {
    fixtures.catalog = await createCatalogFixture(fixtures.prisma);
    await seedPersonalCatalog(fixtures.prisma, fixtures.users.member, fixtures.catalog);
    const operations = await makeCapacityOperations(fixtures, config);
    const matchRoute = routeMatcher(environment);
    const report = { generatedAt: new Date().toISOString(), environment: 'local', target: environment.origin,
        configuration: config, fixture: { works: 26, mainEditionVolumes: 8, coverWidth: 800, coverHeight: 1200,
            externalServices: 'E-mail, download e R2 simulados; PostgreSQL, Express e Sharp reais.' }, operations: [] };
    for (const operation of operations) {
        signal.throwIfAborted();
        report.operations.push(await measureOperation(operation, config, environment, matchRoute, signal));
    }
    return report;
}

async function saveReport(report, output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Relatório: ${output}`);
    return report;
}

async function main() {
    const config = getCapacityConfiguration(process.argv.slice(2), process.env);
    const abort = new globalThis.AbortController();
    const interrupt = () => abort.abort(new Error('Teste de capacidade interrompido.'));
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    try {
        const output = config.output ?? join(await mkdtemp(join(tmpdir(), 'comanga-capacidade-')), `${config.mode}.json`);
        const report = await withEnvironment(0, environment => withFixtures(environment,
            async fixtures => saveReport(await execute(config, environment, fixtures, abort.signal), output), getPassword(process.env)),
        abort.signal, { coverWidth: 800, coverHeight: 1200 });
        if (report.operations.some(operation => operation.summary.status === 'degraded')) process.exitCode = 1;
        else if (report.operations.some(operation => operation.summary.status === 'inconclusive')) process.exitCode = 2;
    } finally {
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', interrupt);
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : 'Falha no teste de capacidade.');
    process.exitCode = 1;
});
