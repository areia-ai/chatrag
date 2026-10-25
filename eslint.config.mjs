import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  // 1) Ignore generated/build outputs
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "build/**",
      "supabase/**",
    ],
  },

  // 2) Base language presets (JS + TS)
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 3) Project-wide defaults
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      // Keep base rules minimal and boilerplate-friendly
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // 4) Browser/client-side files
  {
    files: ["src/**/*.{ts,tsx}", "src/**/*.mts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2023,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // 5) Node/server-side files (API routes & scripts)
  {
    files: [
      "src/app/api/**/*.{ts,tsx}",
      "scripts/**/*.{js,ts,mjs,cjs}",
      "*.{mjs,cjs,js}"
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
      sourceType: "commonjs",
    },
    rules: {
      // Allow commonjs require/__dirname in scripts
      // and avoid noisy undefined flags for Node globals
      "no-undef": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // 6) Browser-based dev tools under scripts (config UI)
  {
    files: ["scripts/config-ui/**/*.{js,ts}", "scripts/config-ui/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2023,
      },
      sourceType: "module",
    },
  },
];
