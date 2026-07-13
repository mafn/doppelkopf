import packageJson from "eslint-plugin-package-json";

export default [
  {
    ignores: ["dist/**", ".astro/**", "node_modules/**"],
  },
  {
    files: ["package.json"],
    languageOptions: {
      parser: (await import("jsonc-eslint-parser")).default,
    },
    plugins: {
      "package-json": packageJson,
    },
    rules: {
      "package-json/valid-package-definition": "error",
      "package-json/valid-name": "error",
      "package-json/valid-version": "error",
      "package-json/unique-dependencies": "error",
    },
  },
];
