module.exports = function(wallaby) {
  return {
    files: [
      'src/**/*.js',
      '!src/**/*.spec.js',
      { pattern: 'tests/fixtures/**/*', instrument: false, load: false, ignore: false }
    ],

    tests: [
      'src/**/*.spec.js'
    ],

    compilers: {
      'src/**/*.js': wallaby.compilers.babel()
    },

    env: {
      type: 'node'
    },

    testFramework: 'jest'
  };
};
