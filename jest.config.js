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
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js']
};
