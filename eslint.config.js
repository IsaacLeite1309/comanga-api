const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

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
        files: ['**/*.js'],
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
    })
];
