const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { ESLint } = require('eslint');
const { pathToFileURL } = require('node:url');
const { createTypeScriptImportResolver } = require('eslint-import-resolver-typescript');

const modules = 'src/modules';
const consumer = 'users';
const shared = 'src/infrastructure';
const app = 'src/app.ts';
const tsconfig = 'tsconfig.json';
const providerEntry = `${modules}/auth/index.ts`;
const consumerEntry = `${modules}/${consumer}/index.ts`;

async function lint(sources, targets = Object.keys(sources)) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'comanga-eslint-')));
    try {
        const files = {
            [providerEntry]: 'export const value = 1;',
            [`${modules}/auth/private.ts`]: 'export const privateValue = 1; export type PrivateType = string;',
            [consumerEntry]: 'export const consumerValue = 2;',
            [`${shared}/value.ts`]: 'export const sharedValue = 3;',
            ...sources
        };
        for (const [file, content] of Object.entries(files)) {
            const absolute = path.join(root, file);
            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.writeFileSync(absolute, content);
        }
        fs.writeFileSync(path.join(root, tsconfig), JSON.stringify({
            compilerOptions: { module: 'ESNext', moduleResolution: 'bundler', paths: { '@/*': ['./src/*'] } },
            include: ['src/**/*']
        }));
        const { default: configs } = await import(pathToFileURL(path.resolve(__dirname, '../eslint.config.js')).href);
        const architecture = configs.find((config) => config.name === 'comanga/architecture');
        assert.ok(architecture, 'O eslint.config.js deve carregar a política arquitetural.');
        const resolver = { project: path.join(root, tsconfig) };
        const eslint = new ESLint({
            cwd: root,
            overrideConfigFile: true,
            overrideConfig: [{
                ...architecture,
                settings: {
                    ...architecture.settings,
                    'boundaries/root-path': root,
                    'import/resolver': { [require.resolve('eslint-import-resolver-typescript')]: resolver },
                    'import-x/resolver-next': [createTypeScriptImportResolver(resolver)]
                }
            }]
        });
        const results = await eslint.lintFiles(targets);
        return results.flatMap((result) => result.messages.map((message) => ({
            file: path.relative(root, result.filePath), rule: message.ruleId, message: message.message
        })));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const hasRule = (messages, rule) => messages.some((message) => message.rule === rule);

test('aceita API pública por alias, imports internos do próprio domínio e a composição', async () => {
    assert.deepEqual(await lint({
        [consumerEntry]: `export { value } from "@/${modules.slice(4)}/auth";`,
        [`${modules}/auth/local.ts`]: 'export { privateValue } from "./private";',
        [app]: `import "./${modules.slice(4)}/${consumer}";`
    }), []);
});

test('recusa imports internos por import, reexport, import dinâmico e tipos', async () => {
    for (const source of [
        'import { privateValue } from "../auth/private";',
        'export * from "../auth/private";',
        'const load = () => import("../auth/private");',
        'import type { PrivateType } from "../auth/private";',
        'type T = import("../auth/private").PrivateType;'
    ]) {
        assert.ok(hasRule(await lint({ [consumerEntry]: source }), 'boundaries/dependencies'), source);
    }
});

test('não permite dependência invertida nem por import de tipos', async () => {
    for (const source of [`import "../${consumer}";`, `import type { consumerValue } from "../${consumer}";`]) {
        assert.ok(hasRule(await lint({ [providerEntry]: source }), 'boundaries/dependencies'));
    }
});

test('detecta ciclos entre arquivos, inclusive no padrão TypeScript export = usado pela API', async () => {
    for (const commonjsOutput of [false, true]) {
        const messages = await lint({
            [`${modules}/auth/one.ts`]: commonjsOutput
                ? 'import two from "./two"; const one = () => two; export = one;'
                : 'import { two } from "./two"; export const one = () => two;',
            [`${modules}/auth/two.ts`]: commonjsOutput
                ? 'import one from "./one"; const two = () => one; export = two;'
                : 'import { one } from "./one"; export const two = () => one;'
        });
        assert.ok(hasRule(messages, 'import-x/no-cycle'));
    }
});

test('não acusa ciclos de execução em imports exclusivamente de tipos', async () => {
    assert.deepEqual(await lint({
        [`${modules}/auth/one.ts`]: 'import type { Two } from "./two"; export type One = { two?: Two };',
        [`${modules}/auth/two.ts`]: 'import type { One } from "./one"; export type Two = { one?: One };'
    }), []);
});

test('bloqueia require e caminhos calculados que impedem a inspeção completa dos ciclos', async () => {
    for (const source of [
        'const value = require("./private");',
        'import value = require("./private");',
        'const value = module.require("./private");',
        'const value = require.resolve("./private");',
        'const value = import(target);',
        'import { createRequire } from "node:module";',
        '/// <reference path="./private.ts" />'
    ]) {
        const messages = await lint({ [providerEntry]: source });
        assert.ok(messages.some((m) => ['@typescript-eslint/no-require-imports', 'no-restricted-syntax',
            'no-restricted-imports', '@typescript-eslint/triple-slash-reference'].includes(m.rule)), source);
    }
});

test('recusa arquivo sem classificação mesmo quando usado como ponte', async () => {
    const messages = await lint({
        [providerEntry]: 'export { consumerValue } from "../../bridge";',
        'src/bridge.ts': `export { consumerValue } from "./${modules.slice(4)}/${consumer}";`
    });
    assert.ok(hasRule(messages, 'boundaries/no-unknown-files'));
    assert.ok(hasRule(messages, 'boundaries/no-unknown-dependencies'));
});

test('código compartilhado não reexporta domínios e domínio não usa composição como ponte', async () => {
    assert.ok(hasRule(await lint({
        [`${shared}/bridge.ts`]: `export { consumerValue } from "../${modules.slice(4)}/${consumer}";`
    }), 'boundaries/dependencies'));
    assert.ok(hasRule(await lint({
        [providerEntry]: `import "../../${app.slice(4)}";`,
        [app]: `import "./${modules.slice(4)}/${consumer}";`
    }), 'boundaries/dependencies'));
});

test('código de produção não pode usar testes como ponte, nem dentro do próprio domínio', async () => {
    const source = `${modules}/auth/code.ts`;
    assert.ok(hasRule(await lint({
        [source]: 'export { hidden } from "./bridge.test";',
        [`${modules}/auth/bridge.test.ts`]: 'export const hidden = 1;'
    }, [source]), 'boundaries/dependencies'));
});

test('recusa imports não resolvidos e recursos inexistentes', async () => {
    for (const source of ['import "./missing";', 'import "./missing.css";']) {
        assert.ok(hasRule(await lint({ [providerEntry]: source }), 'import-x/no-unresolved'));
    }
});

test('permite recursos estáticos existentes do próprio domínio', async () => {
    assert.deepEqual(await lint({
        [providerEntry]: 'import "./style.css";',
        [`${modules}/auth/style.css`]: 'body {}'
    }, [providerEntry]), []);
});

test('comando de limpeza usa a API pública de mídia antes da compilação', async () => {
    const command = 'src/commands/cleanupDiscardedCovers.ts';
    const files = {
        [command]: 'import "../modules/media";',
        'src/modules/media/index.ts': 'export const cleanup = () => {};',
        'src/modules/media/private.ts': 'export const hidden = 1;'
    };
    assert.deepEqual(await lint(files, [command]), []);
    files[command] = 'import "../modules/media/private";';
    assert.ok(hasRule(await lint(files, [command]), 'boundaries/dependencies'));
});

test('a configuração real carregada por npm run lint bloqueia acesso interno', async () => {
    const root = path.resolve(__dirname, '..');
    const eslint = new ESLint({ cwd: root });
    const [result] = await eslint.lintText('import "../auth/accountRules";', {
        filePath: path.join(root, consumerEntry)
    });
    assert.ok(result.messages.some((message) => message.ruleId === 'boundaries/dependencies'));
});

async function maintainabilityRules(file) {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, '..') });
    const { rules } = await eslint.calculateConfigForFile(file);
    return Object.fromEntries(['complexity', 'max-depth', 'max-lines-per-function'].map((rule) => [rule, rules[rule]]));
}

async function lintMaintainability(source) {
    const rules = await maintainabilityRules('src/modules/auth/index.ts');
    const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ rules }] });
    const [result] = await eslint.lintText(source);
    return result.messages.map((message) => ({ ...message, rule: message.ruleId }));
}

test('mantém os limites de complexidade, profundidade e tamanho como erros em produção', async () => {
    const rules = await maintainabilityRules('src/modules/auth/index.ts');
    assert.deepEqual(rules.complexity, [2, 15]);
    assert.deepEqual(rules['max-depth'], [2, 4]);
    assert.deepEqual(rules['max-lines-per-function'], [2, {
        max: 80, skipBlankLines: true, skipComments: true
    }]);
    const branches = (count) => `function branch(value) { ${'if (value) value--; '.repeat(count)} }`;
    assert.deepEqual(await lintMaintainability(branches(14)), []);
    assert.ok(hasRule(await lintMaintainability(branches(15)), 'complexity'));
    const nested = (count) => `function nested(value) { ${'if (value) {'.repeat(count)} value--; ${'}'.repeat(count)} }`;
    assert.deepEqual(await lintMaintainability(nested(4)), []);
    assert.ok(hasRule(await lintMaintainability(nested(5)), 'max-depth'));
});

test('conta apenas linhas de código no limite de tamanho das funções', async () => {
    const source = (lines) => `function sized() {\n${'doWork();\n'.repeat(lines - 2)}${'// comentário\n\n'.repeat(20)}}`;
    assert.deepEqual(await lintMaintainability(source(80)), []);
    assert.ok(hasRule(await lintMaintainability(source(80 + 1)), 'max-lines-per-function'));
});

test('restringe as exceções de tamanho a testes e arquivos gerados', async () => {
    for (const file of ['__tests__/publicCatalog.test.js', 'src/generated/client.ts', 'src/types/client.generated.ts']) {
        const rules = await maintainabilityRules(file);
        assert.equal(rules['max-lines-per-function'][0], 0, file);
        assert.deepEqual(rules.complexity, [2, 15], file);
        assert.deepEqual(rules['max-depth'], [2, 4], file);
    }
    const rules = await maintainabilityRules('scripts/manual-code.cjs');
    assert.equal(rules['max-lines-per-function'][0], 2);
    assert.equal(rules['max-lines-per-function'][1].max, 80);
});
