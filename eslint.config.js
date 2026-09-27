// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      "dist/**",
      "server_dist/**",
      "static-build/**",
      "test-results/**",
      ".upm/**",
      "node_modules/**",
      ".cache/**",
      ".config/**",
      ".expo/**",
      "attached_assets/**",
      "assets/**",
      ".local/**",
    ],
  },
  {
    plugins: {
      "@typescript-eslint": typescriptEslint,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      // SDK 57 enables React Compiler-oriented rules that conflict with
      // established React Native patterns and Reanimated shared values.
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
