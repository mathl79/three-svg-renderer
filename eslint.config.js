import js from "@eslint/js";
import jest from "eslint-plugin-jest";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["build/**", "build-examples/**", "doc/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jest,
        ...globals.node,
      },
    },
    plugins: {jest},
    rules: {
      "array-bracket-spacing": "error",
      "indent": ["error", 2, {
        "FunctionDeclaration": {"parameters": 2},
        "FunctionExpression": {"parameters": 2},
      }],
      "jest/no-disabled-tests": "warn",
      "jest/no-focused-tests": "error",
      "jest/no-identical-title": "error",
      "jest/prefer-to-have-length": "warn",
      "jest/valid-expect": "error",
      "space-in-parens": "error",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-namespace": ["error", {
        "allowDeclarations": true,
      }],
    },
  },
);
