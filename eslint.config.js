const {
    defineConfig,
    globalIgnores,
} = require("eslint/config");

const globals = require("globals");
const tsParser = require("@typescript-eslint/parser");
const jest = require("eslint-plugin-jest");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const js = require("@eslint/js");

const {
    FlatCompat,
} = require("@eslint/eslintrc");

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

module.exports = defineConfig([{
    languageOptions: {
        globals: {
            ...globals.node,
            ...jest.environments.globals.globals,
            Atomics: "readonly",
            SharedArrayBuffer: "readonly",
        },

        parser: tsParser,
        ecmaVersion: 2018,
        sourceType: "module",
        parserOptions: {},
    },

    extends: compat.extends(
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended",
        "plugin:prettier/recommended",
    ),

    plugins: {
        jest,
        "@typescript-eslint": typescriptEslint,
    },

    rules: {
        "linebreak-style": ["error", "unix"],
        quotes: ["error", "single"],
        semi: ["error", "always"],
        "no-undef": "warn",
        "no-unused-vars": "warn",
        "no-trailing-spaces": "error",
        "@typescript-eslint/no-use-before-define": "warn",
        "@typescript-eslint/no-unused-vars": "warn",
        "prettier/prettier": "error",
    },
}, {
    files: ["**/*.ts", "**/*.tsx"],

    rules: {
        "@typescript-eslint/no-unused-vars": "warn",
    },
}, globalIgnores(["**/node_modules/", "**/build/"])]);
