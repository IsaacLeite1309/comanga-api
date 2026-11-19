const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function percentile(sorted, percentileValue) {
    if (sorted.length === 0) return 0;
    const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
    return round(sorted[index]);
}

function median(sorted) {
    if (sorted.length === 0) return 0;
    const middle = Math.floor(sorted.length / 2);
    return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

function summarizeOutcomes(samples) {
    const statusCodes = {};
    let serverErrors = 0;
    let transportErrors = 0;
    let failedRequests = 0;
    let expectedClientErrors = 0;

    for (const { statusCode, expectedStatus, failure } of samples) {
        const statusKey = String(statusCode || 'network_error');
        statusCodes[statusKey] = (statusCodes[statusKey] || 0) + 1;
        if (statusCode >= 500) serverErrors += 1;
        if (statusCode === 0) transportErrors += 1;
        if (expectedStatus === true && statusCode >= 400 && statusCode < 500) expectedClientErrors += 1;
        if (failure || (expectedStatus !== true && (statusCode === 0 || statusCode >= 400))) failedRequests += 1;
    }
    const total = samples.length;
    return {
        statusCodes,
        serverErrors,
        serverErrorRate: total > 0 ? round(serverErrors / total, 4) : 0,
        transportErrors,
        expectedClientErrors,
        expectedRateLimited: samples.filter((sample) => sample.expectedStatus === true && sample.statusCode === 429).length,
        failedRequests,
        failureRate: total > 0 ? round(failedRequests / total, 4) : 0
    };
}

function summarizeSamples(samples, elapsedMs) {
    const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
    const totalRequests = samples.length;
    let maxResponseBytes = 0;
    let maxItemsPerResponse = null;

    for (const { responseBytes, itemCount } of samples) {
        maxResponseBytes = Math.max(maxResponseBytes, responseBytes || 0);
        if (Number.isInteger(itemCount)) maxItemsPerResponse = Math.max(maxItemsPerResponse ?? 0, itemCount);
    }
    return {
        totalRequests,
        elapsedMs,
        rps: elapsedMs > 0 ? round(totalRequests / (elapsedMs / 1000)) : 0,
        ...summarizeOutcomes(samples),
        latencyMs: {
            min: round(durations[0] ?? 0),
            average: totalRequests ? round(durations.reduce((sum, value) => sum + value, 0) / totalRequests) : 0,
            p50: median(durations),
            p95: percentile(durations, 0.95),
            p99: percentile(durations, 0.99),
            max: round(durations.at(-1) ?? 0)
        },
        maxResponseBytes,
        maxItemsPerResponse
    };
}

function evaluateRequirements(summary) {
    if (summary.totalRequests === 0) {
        return { RNF01: 'not_evaluated', RNF02: 'not_evaluated', RNF03: 'not_evaluated' };
    }
    const paginationStatus = summary.maxResponseBytes > MAX_RESPONSE_BYTES
        || (summary.maxItemsPerResponse !== null && summary.maxItemsPerResponse > 50)
        ? 'failed'
        : summary.maxItemsPerResponse === null
            ? 'not_evaluated'
            : 'passed';

    return {
        RNF01: summary.latencyMs.p95 <= 500 ? 'passed' : 'failed',
        RNF02: summary.rps >= 20 && summary.serverErrorRate < 0.01 ? 'passed' : 'failed',
        RNF03: paginationStatus
    };
}

function summarizeServerMetrics(observations) {
    if (observations.length < 2) {
        return {
            status: 'not_collected',
            reason: 'Configure --metrics-url e --ops-token para coletar metricas da API.'
        };
    }

    const first = observations[0];
    const last = observations[observations.length - 1];
    const firstCpu = first.process.cpuUserMicros + first.process.cpuSystemMicros;
    const lastCpu = last.process.cpuUserMicros + last.process.cpuSystemMicros;
    const elapsedMicros = Math.max(1, (last.sampledAtMs - first.sampledAtMs) * 1000);

    return {
        status: 'collected',
        cpuPercent: round(((lastCpu - firstCpu) / elapsedMicros) * 100),
        maxRssBytes: Math.max(...observations.map((sample) => sample.process.rssBytes)),
        maxHeapUsedBytes: Math.max(...observations.map((sample) => sample.process.heapUsedBytes)),
        maxDatabaseConnections: Math.max(...observations.map((sample) => sample.database.connections)),
        samples: observations.length
    };
}

function parseStages(rawStages) {
    const stages = rawStages.split(',').map((value) => Number(value.trim()));
    const valid = stages.length > 0
        && stages.every((value) => Number.isInteger(value) && value > 0 && value <= 100)
        && stages.every((value, index) => index === 0 || value > stages[index - 1]);

    if (!valid) throw new Error('Estagios de carga invalidos.');
    return stages;
}

module.exports = {
    MAX_RESPONSE_BYTES,
    evaluateRequirements,
    parseStages,
    summarizeServerMetrics,
    summarizeSamples
};
