function assessSummary(summary, config) {
    const reasons = [];
    if (summary.failureRate * 100 > config.errorPercent) reasons.push('error_rate');
    if (summary.totalRequests >= config.minSamples && summary.latencyMs.p95 > config.p95LimitMs) reasons.push('p95');
    const enough = summary.totalRequests >= config.minSamples;
    return { status: reasons.length ? 'degraded' : enough ? 'passed' : 'inconclusive',
        reasons: [...reasons, ...(enough ? [] : ['insufficient_samples'])] };
}

function assessStage(stage, config) {
    const assessment = assessSummary(stage, config);
    const endpointAssessments = Object.fromEntries(Object.entries(stage.endpoints).map(([key, summary]) => [key, assessSummary(summary, config)]));
    const invalidScenario = stage.failures.some(failure => failure.type !== 'request_failed');
    const degradedEndpoint = Object.values(endpointAssessments).some(value => value.status === 'degraded');
    if (invalidScenario) assessment.reasons.push('scenario_failure');
    if (degradedEndpoint) assessment.reasons.push('endpoint_criteria');
    if (stage.stoppedOnFailures) assessment.reasons.push('failure_guard');
    if (stage.stoppedOnSampleLimit) assessment.reasons.push('sample_limit');
    const windows = (stage.timeWindows ?? []).map(window => ({ ...window, assessment: assessSummary(window, config) }));
    if (windows.some(window => window.assessment.status === 'degraded')) assessment.reasons.push('degraded_time_window');
    if (invalidScenario || degradedEndpoint || stage.stoppedOnFailures || windows.some(window => window.assessment.status === 'degraded')) assessment.status = 'degraded';
    else if (stage.stoppedOnSampleLimit || Object.values(endpointAssessments).some(value => value.status === 'inconclusive')) assessment.status = 'inconclusive';
    return { ...stage, timeWindows: windows, endpointAssessments, assessment,
        harnessRateLimitReached: stage.rps >= config.maxRps * 0.9 };
}

function summarizeOperation(stages) {
    const firstDegraded = stages.find(stage => stage.assessment.status === 'degraded');
    const healthy = stages.filter(stage => stage.assessment.status === 'passed'
        && (!firstDegraded || stage.virtualUsers < firstDegraded.virtualUsers));
    const last = healthy.at(-1);
    return {
        status: firstDegraded ? 'degraded' : stages.every(stage => stage.assessment.status === 'passed') ? 'passed' : 'inconclusive',
        highestValidatedClients: last?.virtualUsers ?? null,
        observedRpsAtHighestValidatedStage: last?.rps ?? null,
        firstDegradedClients: firstDegraded?.virtualUsers ?? null,
        maximumCapacityEstablished: false,
        note: firstDegraded
            ? 'Degradação observada nesta configuração; refaça com estágios intermediários para delimitar a faixa.'
            : 'O limite não foi determinado. Os resultados se restringem aos estágios e ao teto de requisições configurados.'
    };
}

module.exports = { assessSummary, assessStage, summarizeOperation };
