const routes = [
    { method: 'GET', path: '/health/live', auth: 'Público', parameters: [], dependencies: ['Processo Node.js'] },
    { method: 'GET', path: '/health/ready', auth: 'Público', parameters: [], dependencies: ['PostgreSQL'] },
    { method: 'GET', path: '/health/metrics', auth: 'Token operacional', parameters: ['Header x-ops-token'], dependencies: ['Processo Node.js', 'PostgreSQL'] },
    { method: 'GET', path: '/ping', auth: 'Público', parameters: [], dependencies: ['PostgreSQL'] }
];

function getScenario(path, name, expectedStatus, headers = {}) {
    return { name, endpoint: `GET ${path}`, run: ({ request }) => request({ path, expectedStatus, headers }) };
}

function createScenarios({ opsToken }) {
    return [
        getScenario('/health/live', 'processo ativo', 200),
        getScenario('/health/ready', 'banco disponível', 200),
        getScenario('/health/metrics', 'métricas autorizadas', 200, { 'x-ops-token': opsToken }),
        getScenario('/health/metrics', 'métricas sem token', 403),
        getScenario('/ping', 'consulta ping', 200)
    ];
}

module.exports = { routes, createScenarios };
