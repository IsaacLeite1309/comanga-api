module.exports = {
    testEnvironment: 'node',
    clearMocks: true,
    restoreMocks: true,
    testMatch: ['**/__tests__/**/*.test.js'],
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: 'tsconfig.json'
        }]
    },
    moduleFileExtensions: ['ts', 'js', 'json'],
    setupFiles: ['<rootDir>/jest.env.js'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts',
        '!src/server.ts',
        '!src/prisma.ts'
    ],
    coverageReporters: ['text', 'html', 'json-summary'],
    coverageThreshold: {
        global: {
            statements: 80,
            branches: 80,
            functions: 80,
            lines: 80
        }
    }
};
