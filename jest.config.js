export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  verbose: true,
  roots: ["src"],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: true,
    }],
  },
  transformIgnorePatterns: [
    "node_modules/(?!(three)/)",
  ],
  "setupFilesAfterEnv": ['./src/setuptests.ts']
}