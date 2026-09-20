const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const path = require('node:path');
const boundaries = require('eslint-plugin-boundaries');
const importX = require('eslint-plugin-import-x').default;
const { createTypeScriptImportResolver } = require('eslint-import-resolver-typescript');

// Cada repositório mantém sua própria política; não há dependência entre checkouts.
const domains = {
    "auth": {"path": "src/modules/auth", "dependencies": []},
    "users": {"path": "src/modules/users", "dependencies": ["auth"]},
    "catalog": {"path": "src/modules/catalog", "dependencies": ["media"]},
    "media": {"path": "src/modules/media", "dependencies": []},
    // A administração de usuários passou a conceder/remover perfis, cuja regra vive em auth.
    "admin-users": {"path": "src/modules/admin/users", "dependencies": ["auth"]},
    "admin-options": {"path": "src/modules/admin/options", "dependencies": ["catalog"]},
    "public-catalog": {"path": "src/modules/public-catalog", "dependencies": []}
};
const composition = ["src/routes/**/*", "src/middlewares/**/*", "src/app.ts", "src/server.ts", "src/commands/**/*"];
const shared = ["src/infrastructure/**/*", "src/database/**/*", "src/prisma.ts", "src/errors/**/*", "src/utils/**/*", "src/types/**/*"];

function createArchitectureConfig(root = __dirname) {
    const resolver = { project: path.join(root, 'tsconfig.json') };
    const category = (categories) => ({ file: { categories } });
    const publicEntry = (name) => ({ file: { categories: name, path: `${domains[name].path}/index.ts` } });
    return {
        name: 'comanga/architecture',
        files: ['src/**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}'],
        ignores: ['**/*.{test,spec}.{js,jsx,cjs,mjs,ts,tsx,cts,mts}', 'src/test/**'],
        languageOptions: { parser: tseslint.parser, sourceType: 'module', ecmaVersion: 'latest' },
        plugins: { boundaries, 'import-x': importX, '@typescript-eslint': tseslint.plugin },
        settings: {
            'boundaries/root-path': root,
            'boundaries/files': [
                ...Object.entries(domains).map(([name, domain]) => ({ category: name, pattern: `${domain.path}/**/*` })),
                { category: 'composition', pattern: composition },
                { category: 'shared', pattern: shared },
                { category: 'test', pattern: ['**/*.{test,spec}.*', 'src/test/**/*'] }
            ],
            'boundaries/additional-dependency-nodes': [
                { selector: 'TSImportType > Literal', kind: 'type', name: 'ts-import-type' }
            ],
            'import/resolver': { [require.resolve('eslint-import-resolver-typescript')]: resolver },
            'import-x/resolver-next': [createTypeScriptImportResolver(resolver)],
            'import-x/parsers': { [require.resolve('@typescript-eslint/parser')]: ['.ts', '.tsx', '.cts', '.mts'] }
        },
        rules: {
            'boundaries/no-unknown-files': 'error',
            'boundaries/no-unknown-dependencies': ['error', { require: 'file' }],
            'boundaries/no-ignored-dependencies': 'error',
            'boundaries/dependencies': ['error', {
                default: 'disallow',
                checkUnknownLocals: true,
                checkInternals: true,
                policies: [
                    { from: category('shared'), allow: { to: category('shared') } },
                    { from: category('composition'), allow: { to: [category(['composition', 'shared']), ...Object.keys(domains).map(publicEntry)] } },
                    ...Object.entries(domains).map(([name, domain]) => ({
                        from: category(name),
                        allow: { to: [category([name, 'shared']), ...domain.dependencies.map(publicEntry)] }
                    })),
                    { disallow: { to: category('test') } }
                ]
            }],
            'import-x/no-cycle': ['error', { ignoreExternal: true }],
            'import-x/no-self-import': 'error',
            'import-x/no-unresolved': 'error',
            '@typescript-eslint/no-require-imports': 'error',
            '@typescript-eslint/triple-slash-reference': ['error', { path: 'never', types: 'always', lib: 'always' }],
            'no-restricted-imports': ['error', { paths: ['module', 'node:module'] }],
            'no-restricted-syntax': ['error',
                { selector: 'CallExpression[callee.object.name="module"][callee.property.name="require"]', message: 'Use import para manter o grafo de dependências verificável.' },
                { selector: 'CallExpression[callee.object.name="require"][callee.property.name="resolve"]', message: 'Use import para manter o grafo de dependências verificável.' },
                { selector: 'ImportExpression[source.type!="Literal"]', message: 'Imports dinâmicos devem usar um caminho literal.' }
            ]
        }
    };
}

const globals = {
    console: 'readonly',
    process: 'readonly',
    require: 'readonly',
    module: 'readonly',
    exports: 'readonly',
    __dirname: 'readonly',
    jest: 'readonly',
    describe: 'readonly',
    it: 'readonly',
    expect: 'readonly',
    beforeAll: 'readonly',
    beforeEach: 'readonly',
    afterAll: 'readonly',
    afterEach: 'readonly'
};

module.exports = [
    {
        ignores: ['node_modules/**', 'coverage/**', 'dist/**']
    },
    {
        files: ['**/*.{js,cjs}'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-redeclare': 'error',
            'no-dupe-keys': 'error',
            'no-unreachable': 'error',
            'no-constant-condition': 'error',
            'no-empty': 'error',
            'no-extra-semi': 'error',
            'no-irregular-whitespace': 'error',
            'valid-typeof': 'error'
        }
    },
    ...tseslint.config({
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: __dirname
            },
            globals
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error'
        }
    }),
    {
        name: 'comanga/maintainability',
        files: ['**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}'],
        rules: {
            complexity: ['error', 15],
            'max-depth': ['error', 4],
            'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }]
        }
    },
    {
        // Suítes agrupam cenários; o tamanho não limita seus callbacks.
        name: 'comanga/test-size',
        files: ['**/*.{test,spec}.{js,jsx,cjs,mjs,ts,tsx,cts,mts}', '**/__tests__/**/*.{js,jsx,ts,tsx}'],
        rules: { 'max-lines-per-function': 'off' }
    },
    {
        // Apenas arquivos identificados como saída de geração automática.
        name: 'comanga/generated-size',
        files: ['**/*.generated.{js,jsx,ts,tsx}', 'src/generated/**/*.{js,jsx,ts,tsx}'],
        rules: { 'max-lines-per-function': 'off' }
    },
    createArchitectureConfig()
];
