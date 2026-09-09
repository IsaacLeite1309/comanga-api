module.exports = {
    ...require('./jest.config'),
    testMatch: ['**/__tests__/**/*.unit.test.js'],
    setupFiles: ['<rootDir>/jest.unit.env.js']
};
