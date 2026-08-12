const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function round(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}

function percentile(values, percentileValue) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
    return sorted[index];
}

function summarizeSamples(samples, elapsedMs) {
    const durations = samples.map((sample) => sample.durationMs);
    const serverErrors = samples.filter((sample) => sample.statusCode >= 500).length;
    const failedRequests = samples.filter((sample) => sample.statusCode === 0 || sample.statusCode >= 400).length;
    const totalRequests = samples.length;

    return {
        totalRequests,
        elapsedMs,
        rps: elapsedMs > 0 ? round(totalRequests / (elapsedMs / 1000)) : 0,
        serverErrors,
        serverErrorRate: totalRequests > 0 ? round(serverErrors / totalRequests, 4) : 0,
        failedRequests,
        failureRate: totalRequests > 0 ? round(failedRequests / totalRequests, 4) : 0,
        latencyMs: {
            min: durations.length > 0 ? Math.min(...durations) : 0,
            average: durations.length > 0
                ? round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
                : 0,
            p50: percentile(durations, 0.5),
            p95: percentile(durations, 0.95),
            max: durations.length > 0 ? Math.max(...durations) : 0
        },
        maxResponseBytes: samples.length > 0
            ? Math.max(...samples.map((sample) => sample.responseBytes || 0))
            : 0,
        maxItemsPerResponse: samples.some((sample) => Number.isInteger(sample.itemCount))
            ? Math.max(...samples
                .filter((sample) => Number.isInteger(sample.itemCount))
                .map((sample) => sample.itemCount))
            : null,
        statusCodes: samples.reduce((counts, sample) => {
            const key = String(sample.statusCode || 'network_error');
            counts[key] = (counts[key] || 0) + 1;
            return counts;
        }, {})
    };
}

function evaluateRequirements(summary) {
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
