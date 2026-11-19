const { getRunConfiguration } = require('./config');

const OPERATIONS = ['search', 'work', 'edition', 'volume', 'calendar', 'collection', 'wishlist', 'collection-write', 'covers', 'browse', 'all'];
const PROFILES = {
    sustained: { stages: '8', duration: '300', rps: '100', operation: 'browse' },
    stress: { stages: '1,5,10,25,50', duration: '60', rps: '500', operation: 'search' },
    operation: { stages: '8', duration: '60', rps: '100', operation: 'all' }
};

function integer(value, fallback, min, max, name) {
    const number = Number(value ?? fallback);
    if (!Number.isInteger(number) || number < min || number > max) {
        throw new Error(`${name} deve ser inteiro entre ${min} e ${max}.`);
    }
    return number;
}

function parseArguments(argv) {
    const allowed = new Set(['mode', 'operation', 'stages', 'duration', 'warmup', 'rps', 'timeout', 'p95', 'error-percent', 'min-samples', 'window', 'output']);
    const args = {};
    for (const argument of argv) {
        const match = /^--([a-z][a-z0-9-]*)=(.+)$/.exec(argument);
        if (!match || !allowed.has(match[1])) throw new Error('Argumento de capacidade inválido. Consulte load-suite.md.');
        if (Object.hasOwn(args, match[1])) throw new Error(`Argumento duplicado: ${match[1]}.`);
        args[match[1]] = match[2];
    }
    return args;
}

function getCapacityConfiguration(argv = [], env = {}) {
    const args = parseArguments(argv);
    const mode = args.mode ?? 'sustained';
    if (!Object.hasOwn(PROFILES, mode)) throw new Error('Modo inválido: use sustained, stress ou operation.');
    const defaults = PROFILES[mode];
    const operation = args.operation ?? defaults.operation;
    if (!OPERATIONS.includes(operation)) throw new Error(`Operação inválida: ${OPERATIONS.join(', ')}.`);
    // Mantém as mesmas restrições de loopback, sem aceitar URL de API existente.
    getRunConfiguration([], { ...env, LOAD_TEST_URL: env.LOAD_TEST_URL ?? 'http://127.0.0.1:0' });
    if (env.LOAD_TEST_URL && env.LOAD_TEST_URL !== 'http://127.0.0.1:0') {
        throw new Error('A capacidade usa apenas a API descartável em http://127.0.0.1:0.');
    }
    const stages = (args.stages ?? defaults.stages).split(',').map(value => integer(value, 0, 1, 100, 'Clientes'));
    if (stages.length > 8 || stages.some((value, index) => index > 0 && value <= stages[index - 1])) {
        throw new Error('Use até oito estágios de clientes estritamente crescentes.');
    }
    return {
        mode, operation, stages,
        durationSeconds: integer(args.duration, defaults.duration, 1, 1800, 'Duração'),
        warmupSeconds: integer(args.warmup, 10, 0, 120, 'Aquecimento'),
        maxRps: integer(args.rps, defaults.rps, 1, 1000, 'Limite HTTP'),
        timeoutMs: integer(args.timeout, 5000, 100, 30000, 'Timeout'),
        p95LimitMs: integer(args.p95, 500, 1, 30000, 'Limite p95'),
        errorPercent: integer(args['error-percent'], 1, 0, 100, 'Percentual de erro'),
        minSamples: integer(args['min-samples'], 100, 1, 100000, 'Amostra mínima'),
        windowSeconds: integer(args.window, 30, 1, 300, 'Janela'),
        maxSamples: 200000,
        output: args.output
    };
}

module.exports = { getCapacityConfiguration };
