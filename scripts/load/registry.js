const { URL } = require('node:url');

function routeKey({ method, path }) {
    return `${method} ${path}`;
}

function getCoverageErrors(registered, declared) {
    const manifest = new Set(declared);
    const actual = new Set(registered);
    return {
        missing: [...actual].filter((key) => !manifest.has(key)),
        extra: [...manifest].filter((key) => !actual.has(key)),
        duplicate: declared.filter((key, index) => declared.indexOf(key) !== index)
    };
}

function validateManifest(registered, routes) {
    const errors = getCoverageErrors(registered, routes.map(routeKey));
    const messages = [
        ...errors.missing.map((key) => `sem inventário: ${key}`),
        ...errors.extra.map((key) => `ausente na API: ${key}`),
        ...errors.duplicate.map((key) => `inventário duplicado: ${key}`)
    ];
    if (messages.length) throw new Error(`Inventário de carga divergente. ${messages.join(' | ')}`);
}

function describeInventory(routes, scenarios) {
    const expectedEndpoints = new Set(routes.map(routeKey));
    const coverage = new Map();
    const scenarioNames = new Set();
    for (const scenario of scenarios) {
        const { name, endpoint, covers = [] } = scenario;
        if (!name || scenarioNames.has(name)) throw new Error(`Nome de cenário ausente ou duplicado: ${name}`);
        scenarioNames.add(name);
        for (const key of new Set([endpoint, ...covers])) {
            if (!expectedEndpoints.has(key)) throw new Error(`Rota desconhecida no cenário ${name}: ${key}`);
            const names = coverage.get(key) ?? [];
            names.push(name);
            coverage.set(key, names);
        }
    }
    return routes.map((route) => {
        const scenarios = coverage.get(routeKey(route));
        if (!scenarios) throw new Error(`Sem cenário para ${routeKey(route)}.`);
        return { ...route, scenarios };
    });
}

function createRouteMatcher(routes, origin) {
    const compiled = routes.map((route) => {
        const segments = route.path.split('/');
        const literals = segments.filter((segment) => !segment.startsWith(':')).length;
        const pattern = segments.map((segment) => segment.startsWith(':') ? '[^/]+'
            : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
        return { key: routeKey(route), method: route.method, pattern: new RegExp(`^${pattern}/?$`), literals };
    }).sort((first, second) => second.literals - first.literals);
    return (method, path) => {
        const url = new URL(path, origin);
        if (!path.startsWith('/') || path.startsWith('//') || url.origin !== origin) return undefined;
        return compiled.find((route) => route.method === method && route.pattern.test(url.pathname))?.key;
    };
}

module.exports = { createRouteMatcher, describeInventory, validateManifest };
