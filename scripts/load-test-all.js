const { mkdtemp, mkdir, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const { getRunConfiguration } = require('./load/config');
const { withEnvironment } = require('./load/environment');
const { getPassword, withFixtures } = require('./load/fixtures');
const { createRouteMatcher, describeInventory, validateManifest } = require('./load/registry');
const { createRateLimit, runCoverage, runStage } = require('./load/workload');
const { createCatalogFixture, seedPersonalCatalog } = require('./load/catalog-fixtures');
const account = require('./load/accounts');
const admin = require('./load/admin');
const catalog = require('./load/catalog');
const operations = require('./load/operations');

async function makeScenarios(fixtures, modules) {
    fixtures.catalog = await createCatalogFixture(fixtures.prisma);
    await seedPersonalCatalog(fixtures.prisma, fixtures.users.member, fixtures.catalog);
    const groups = await Promise.all(modules.map((module) => module.createScenarios(fixtures)));
    return groups.flat();
}

function makeReadScenario(path, matchRoute) {
    const endpoint = matchRoute('GET', path);
    const publicEndpoint = endpoint?.startsWith('GET /api/public/')
        || ['GET /health/live', 'GET /health/ready', 'GET /ping'].includes(endpoint);
    if (!publicEndpoint) throw new Error('A URL deve apontar para um GET público da API local.');
    return { name: 'capacidade de leitura selecionada', endpoint, run: ({ request }) => request({ path, expectedStatus: 200 }) };
}

function summarizeStage(stage) {
    console.log(`${stage.virtualUsers} cliente(s) | ${stage.totalRequests} HTTP | ${stage.rps} req/s | mediana ${stage.latencyMs.p50} ms | p95 ${stage.latencyMs.p95} ms | p99 ${stage.latencyMs.p99} ms | ${stage.failures.length} falha(s)`);
}

async function executeSuite(config, environment, fixtures, signal) {
    const modules = [operations, account.forEndpoints(environment.endpoints), catalog, admin];
    const routes = modules.flatMap((module) => module.routes);
    validateManifest(environment.endpoints, routes);
    const scenarios = await makeScenarios(fixtures, modules);
    const matchRoute = createRouteMatcher(routes, environment.origin);
    const report = {
        generatedAt: new Date().toISOString(),
        target: environment.origin,
        environment: 'local',
        configuration: {
            readPath: config.readPath,
            stages: config.stages,
            durationSeconds: config.durationSeconds,
            timeoutMs: config.timeoutMs,
            maxRps: config.maxRps
        },
        inventory: describeInventory(routes, scenarios),
        stages: []
    };
    const readScenario = config.readPath ? makeReadScenario(config.readPath, matchRoute) : undefined;
    if (readScenario) report.loadReadEndpoint = readScenario.endpoint;
    const execution = { ...environment, timeoutMs: config.timeoutMs, signal, matchRoute,
        waitForSlot: createRateLimit(config.maxRps, signal) };

    console.log(`Conferindo ${routes.length} rotas Express em ${scenarios.length} cenários...`);
    report.coverage = await runCoverage(scenarios, execution);
    const failed = report.coverage.failures;
    console.log(`Cobertura | ${Object.keys(report.coverage.endpoints).length} rotas | ${report.coverage.totalRequests} HTTP | ${failed.length} falha(s)`);
    if (failed.length) return report;

    const workload = readScenario ? [readScenario] : scenarios.filter((scenario) => !scenario.coverageOnly);
    if (!workload.length) throw new Error('Nenhum cenário disponível para carga progressiva.');
    const state = { index: 0, iteration: scenarios.length };
    for (const virtualUsers of config.stages) {
        signal.throwIfAborted();
        console.log(`Medindo com ${virtualUsers} cliente(s) por ${config.durationSeconds} s...`);
        const stage = await runStage(workload, execution, config, state, virtualUsers);
        report.stages.push(stage);
        summarizeStage(stage);
        if (stage.stoppedOnFailures) break;
    }
    return report;
}

async function saveReport(report, output) {
    const target = output || join(await mkdtemp(join(tmpdir(), 'comanga-carga-')), 'capacidade.json');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`Relatório salvo em ${target}`);
}

async function main() {
    const config = getRunConfiguration(process.argv.slice(2), process.env);
    const password = getPassword(process.env);
    const abort = new globalThis.AbortController();
    const interrupt = () => abort.abort(new Error('Execução interrompida. O ambiente local foi encerrado.'));
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    try {
        const report = await withEnvironment(config.port, (environment) => withFixtures(environment,
            (fixtures) => executeSuite(config, environment, fixtures, abort.signal), password), abort.signal);
        await saveReport(report, config.output);
        if (report.coverage.failures.length || report.stages.some((stage) => stage.failures.length)) process.exitCode = 1;
    } catch (error) {
        if (error.code === 'ABORT_ERR') abort.signal.throwIfAborted();
        throw error;
    } finally {
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', interrupt);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
