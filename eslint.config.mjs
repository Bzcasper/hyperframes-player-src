import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["**/.next/**", "**/node_modules/**", "**/dist/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      "no-console": "off",
    },
  },
];