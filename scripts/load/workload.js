const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { evaluateRequirements, summarizeSamples, summarizeServerMetrics } = require('../load-test-lib');
const { LoadRequestError, sendRequest } = require('./http');

function createRateLimit(maxRps, signal) {
    let nextRequest = 0;
    return async function waitForSlot() {
        signal.throwIfAborted();
        let remaining = nextRequest - performance.now();
        while (remaining > 0) {
            await delay(Math.ceil(remaining), undefined, { signal });
            remaining = nextRequest - performance.now();
        }
        nextRequest = performance.now() + 1000 / maxRps;
    };
}

function httpFailure(error, startedAt, endpoint) {
    const details = error instanceof LoadRequestError ? error : { status: 0, responseBytes: 0, type: 'transport' };
    return {
        endpoint,
        completedAtMs: performance.now(),
        durationMs: performance.now() - startedAt,
        statusCode: details.status,
        responseBytes: details.responseBytes,
        failure: details.type
    };
}

function createMeasuredRequest({ origin, timeoutMs, signal, waitForSlot, matchRoute }, context, scenario, samples) {
    const allowed = new Set([scenario.endpoint, ...(scenario.covers ?? [])]);
    return async function measuredRequest(options) {
        const endpoint = matchRoute(options.method ?? 'GET', options.path);
        if (!allowed.has(endpoint)) {
            throw new LoadRequestError('O cenário fez uma requisição fora das rotas declaradas.', 'undeclared_route');
        }
        await waitForSlot();
        const startedAt = performance.now();
        let result;
        try {
            result = await sendRequest(origin, options, timeoutMs, signal);
        } catch (error) {
            signal.throwIfAborted();
            samples.push(httpFailure(error, startedAt, endpoint));
            throw new LoadRequestError('Falha ao realizar a requisição.', 'request_failed');
        }

        const expected = [options.expectedStatus].flat();
        const expectedStatus = result.status < 500 && expected.includes(result.status);
        const errorCode = result.body?.code;
        samples.push({
            endpoint,
            completedAtMs: performance.now(),
            durationMs: result.durationMs,
            statusCode: result.status,
            responseBytes: result.responseBytes,
            itemCount: result.itemCount,
            expectedStatus,
            ...(expectedStatus ? {} : { failure: 'unexpected_status' }),
            ...(typeof errorCode === 'string' && /^[A-Z0-9_]{1,80}$/.test(errorCode) ? { code: errorCode } : {})
        });
        if (!expectedStatus) throw new LoadRequestError('Status HTTP inesperado.', 'request_failed');
        context.exercised.add(endpoint);
        return result;
    };
}

async function executeScenario(scenario, execution, { phase, workerId, iteration }) {
    const context = { exercised: new Set() };
    const samples = [];
    const request = createMeasuredRequest(execution, context, scenario, samples);

    try {
        await scenario.run({ request, phase, workerId, iteration });
        if (phase === 'coverage') {
            const missing = [scenario.endpoint, ...(scenario.covers ?? [])].filter((key) => !context.exercised.has(key));
            if (missing.length) {
                return { samples, failure: { scenario: scenario.name, type: 'missing_request', endpoints: missing } };
            }
        }
        return { samples };
    } catch (error) {
        execution.signal.throwIfAborted();
        const type = error instanceof LoadRequestError ? error.type : 'scenario_assertion';
        const lastFailure = samples.findLast((sample) => sample.failure);
        return {
            samples,
            failure: { scenario: scenario.name, type, ...(lastFailure ? {
                endpoint: lastFailure.endpoint, status: lastFailure.statusCode, reason: lastFailure.failure, code: lastFailure.code
            } : {}) }
        };
    }
}

function summarizeByEndpoint(samples, elapsedMs) {
    const grouped = new Map();
    for (const sample of samples) {
        const group = grouped.get(sample.endpoint) ?? [];
        group.push(sample);
        grouped.set(sample.endpoint, group);
    }
    return Object.fromEntries([...grouped].map(([endpoint, group]) => [endpoint, summarizeSamples(group, elapsedMs)]));
}

async function runCoverage(scenarios, execution) {
    const startedAt = performance.now();
    const samples = [];
    const failures = [];
    for (const [iteration, scenario] of scenarios.entries()) {
        execution.signal.throwIfAborted();
        const result = await executeScenario(scenario, execution, { phase: 'coverage', workerId: 0, iteration });
        samples.push(...result.samples);
        if (result.failure) failures.push(result.failure);
    }
    const elapsedMs = Math.round(performance.now() - startedAt);
    return {
        ...summarizeSamples(samples, elapsedMs),
        executedScenarios: scenarios.length,
        endpoints: summarizeByEndpoint(samples, elapsedMs),
        failures
    };
}

async function readMetrics({ origin, opsToken, timeoutMs, signal, waitForSlot }) {
    await waitForSlot();
    try {
        const response = await sendRequest(origin, { path: '/health/metrics', headers: { 'x-ops-token': opsToken } },
            timeoutMs, signal);
        if (response.status !== 200) return undefined;
        return { sampledAtMs: Date.now(), ...response.body };
    } catch {
        signal.throwIfAborted();
        return undefined;
    }
}

function capacityRequirements(summary) {
    const ratings = evaluateRequirements(summary);
    if (summary.maxItemsPerResponse >= 50 && summary.failedRequests === 0) return ratings;
    return Object.fromEntries(Object.entries(ratings).map(([name, result]) => [
        name, result === 'failed' ? 'failed' : 'not_evaluated'
    ]));
}

async function runStage(scenarios, execution, configuration, state, virtualUsers) {
    const samples = [];
    const failures = [];
    const baseline = await readMetrics(execution);
    const metrics = baseline ? [baseline] : [];
    const startedAt = performance.now();
    const deadline = startedAt + configuration.durationSeconds * 1000;
    const monitorAbort = new globalThis.AbortController();

    async function worker(workerId) {
        while (performance.now() < deadline && failures.length < 10 && samples.length < (configuration.maxSamples ?? Infinity)) {
            execution.signal.throwIfAborted();
            const { index, iteration } = state;
            const scenario = scenarios[index % scenarios.length];
            state.index += 1;
            state.iteration += 1;
            const result = await executeScenario(scenario, execution, { phase: 'load', workerId, iteration });
            samples.push(...result.samples);
            if (result.failure) failures.push(result.failure);
        }
    }

    async function monitor() {
        const signal = globalThis.AbortSignal.any([execution.signal, monitorAbort.signal]);
        try {
            while (performance.now() < deadline) {
                await delay(1000, undefined, { signal });
                const snapshot = await readMetrics({ ...execution, signal });
                if (snapshot) metrics.push(snapshot);
            }
        } catch (error) {
            if (!signal.aborted) console.error('Falha na coleta periódica de métricas.', error.code || '');
        }
    }

    const monitoring = monitor();
    const workers = Array.from({ length: virtualUsers }, (_, workerId) => worker(workerId));
    const outcomes = await Promise.allSettled(workers);
    const elapsedMs = Math.round(performance.now() - startedAt);
    monitorAbort.abort();
    await monitoring;
    const rejectedWorker = outcomes.find((outcome) => outcome.status === 'rejected');
    if (rejectedWorker) throw rejectedWorker.reason;
    const final = await readMetrics(execution);
    if (final) metrics.push(final);
    const summary = summarizeSamples(samples, elapsedMs);
    const serverMetrics = summarizeServerMetrics(metrics);
    if (serverMetrics.status !== 'collected') {
        serverMetrics.reason = 'A API local retornou menos de duas observações de métricas.';
    }
    return {
        virtualUsers,
        ...summary,
        endpoints: summarizeByEndpoint(samples, elapsedMs),
        failures,
        stoppedOnFailures: failures.length >= 10,
        ...(configuration.maxSamples ? { stoppedOnSampleLimit: samples.length >= configuration.maxSamples } : {}),
        ...(configuration.windowSeconds ? {
            timeWindows: summarizeTimeWindows(samples, startedAt, elapsedMs, configuration.windowSeconds),
            resourceTimeline: metrics.map(sample => ({
                seconds: (sample.sampledAtMs - metrics[0].sampledAtMs) / 1000,
                rssBytes: sample.process.rssBytes,
                heapUsedBytes: sample.process.heapUsedBytes,
                cpuUserMicros: sample.process.cpuUserMicros,
                cpuSystemMicros: sample.process.cpuSystemMicros,
                databaseConnections: sample.database.connections
            }))
        } : {}),
        serverMetrics,
        ...(configuration.capacityRead ? { requirements: capacityRequirements(summary) } : {})
    };
}

function summarizeTimeWindows(samples, startedAt, elapsedMs, seconds) {
    const width = seconds * 1000;
    const groups = Array.from({ length: Math.max(1, Math.ceil(elapsedMs / width)) }, () => []);
    for (const sample of samples) {
        const index = Math.min(groups.length - 1, Math.max(0, Math.floor((sample.completedAtMs - startedAt) / width)));
        groups[index].push(sample);
    }
    return groups.map((group, index) => ({
        fromSeconds: index * seconds,
        toSeconds: Math.min(elapsedMs / 1000, (index + 1) * seconds),
        ...summarizeSamples(group, Math.max(1, Math.min(width, elapsedMs - index * width)))
    }));
}

module.exports = { capacityRequirements, createRateLimit, runCoverage, runStage, summarizeTimeWindows };
