const { URL } = require('node:url');
const { parseStages } = require('../load-test-lib');

const DEFAULT_URL = 'http://127.0.0.1:0';
const MAX_WORKERS = 25;

function parseArguments(argv) {
    const allowed = new Set(['url', 'confirm-host', 'stages', 'duration', 'timeout', 'rps', 'output', 'metrics-url', 'environment']);
    const args = {};
    for (const argument of argv) {
        const match = /^--([a-z-]+)=(.+)$/.exec(argument);
        if (!match || !allowed.has(match[1])) {
            throw new Error('Argumento de carga inválido. Use --nome=valor conforme a documentação.');
        }
        const [, name, value] = match;
        args[name] = value;
    }
    return args;
}

function boundedInteger(raw, fallback, min, max, name) {
    const value = Number(raw ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}.`);
    }
    return value;
}

function readTarget(args, env) {
    const raw = args.url ?? env.LOAD_TEST_URL ?? DEFAULT_URL;
    if (!/^http:\/\/127\.0\.0\.1(?::\d{1,5})?(?:\/[^#]*)?$/.test(raw) || /[\s\\]/.test(raw)) {
        throw new Error('O alvo deve usar http://127.0.0.1 e uma porta local, opcionalmente com uma rota de leitura.');
    }
    const url = new URL(raw);
    const confirmedHost = args['confirm-host'] ?? env.LOAD_TEST_CONFIRM_HOST;
    if (confirmedHost && confirmedHost !== url.host) {
        throw new Error('LOAD_TEST_CONFIRM_HOST deve corresponder ao host local configurado.');
    }
    const metricsUrl = args['metrics-url'] ?? env.LOAD_TEST_METRICS_URL;
    if (metricsUrl && metricsUrl !== `${url.origin}/health/metrics`) {
        throw new Error('A coleta de métricas está disponível somente em /health/metrics da instância local.');
    }
    const environment = args.environment ?? env.LOAD_TEST_ENVIRONMENT ?? 'local';
    if (environment !== 'local') throw new Error('A suíte só aceita LOAD_TEST_ENVIRONMENT=local.');
    return url;
}

function getRunConfiguration(argv = [], env = {}) {
    const args = parseArguments(argv);
    const url = readTarget(args, env);
    const stages = parseStages(args.stages ?? env.LOAD_TEST_STAGES ?? '1,4,8');
    if (stages.length > 5 || stages.at(-1) > MAX_WORKERS) {
        throw new Error('Use até 5 estágios progressivos, com no máximo 25 clientes simultâneos.');
    }
    return {
        stages,
        port: Number(url.port || 80),
        readPath: url.pathname === '/' && !url.search ? null : `${url.pathname}${url.search}`,
        durationSeconds: boundedInteger(args.duration ?? env.LOAD_TEST_DURATION_SECONDS, 8, 1, 120, 'Duração'),
        timeoutMs: boundedInteger(args.timeout ?? env.LOAD_TEST_TIMEOUT_MS, 5000, 100, 15000, 'Timeout'),
        maxRps: boundedInteger(args.rps ?? env.LOAD_TEST_MAX_RPS, 40, 1, 100, 'Limite HTTP'),
        output: args.output ?? env.LOAD_TEST_OUTPUT
    };
}

module.exports = { getRunConfiguration };
