// ESLint 9 flat config（B6 工程化，2026-11-11）
// 用法：npx eslint .   （依赖见 package.json devDependencies.eslint）
module.exports = [
  {
    ignores: [
      'node_modules/**',
      'cloudfunctions/**/node_modules/**',
      'seed-data/**',
      '.atomcode-tmp/**',
      'scripts/_tmp_test/**'
    ]
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        wx: 'readonly',
        getApp: 'readonly',
        App: 'readonly',
        Page: 'readonly',
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setImmediate: 'readonly',
        __dirname: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }],
      eqeqeq: ['warn', 'smart'],
      'no-var': 'warn'
    }
  }
]
