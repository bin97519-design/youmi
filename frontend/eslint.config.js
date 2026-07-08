// ESLint 9 flat config - Vue 3 + Prettier compatible
// 风格 A1：2 空格缩进 / 单引号 / 无尾分号
import js from '@eslint/js'
import vuePlugin from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettierConfig from '@vue/eslint-config-prettier'
import globals from 'globals'

export default [
  // 全局忽略
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '*.min.js',
      'public/**',
    ],
  },

  // JS 基础规则
  js.configs.recommended,

  // Vue 3 推荐规则
  ...vuePlugin.configs['flat/recommended'],

  // Vue 解析器配置
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: js.linter || (await import('@eslint/js')).default.linter,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        // Vue 3 模板编译全局
        defineProps: 'readonly',
        defineEmits: 'readonly',
        defineExpose: 'readonly',
        withDefaults: 'readonly',
      },
    },
    rules: {
      // Vue 3 风格规则
      'vue/multi-word-component-names': 'off', // 单字组件名允许（首页/Home/Case）
      'vue/no-v-html': 'warn', // XSS 警告
      'vue/html-self-closing': ['error', {
        html: { void: 'always', normal: 'always', component: 'always' },
      }],
      'vue/max-attributes-per-line': 'off', // 模板多行属性允许
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': 'off', // 缩进交给 Prettier
      'vue/attributes-order': 'warn',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-closing-bracket-newline': 'off',

      // JS 通用规则
      'no-console': 'off', // 开发允许 console
      'no-debugger': 'warn',
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-undef': 'off', // Vue 模板里会有未识别变量
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },

  // JS 文件规则
  {
    files: ['**/*.{js,ts,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },

  // Prettier 必须放最后
  prettierConfig,
]
