module.exports = {
  testPathIgnorePatterns: ['/node_modules', '/build/'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      tsConfig: {
        target: 'es2018',
      },
    },
  },
};
