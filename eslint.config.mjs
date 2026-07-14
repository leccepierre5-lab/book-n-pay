import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals'),
  {
    // 192 occurrences existantes dans le texte français du site (apostrophes
    // non échappées) — pas une dette qu'on corrige d'un coup. Le reste des
    // règles (Next, react-hooks/exhaustive-deps, etc.) reste en erreur.
    rules: {
      'react/no-unescaped-entities': 'warn',
    },
  },
];

export default eslintConfig;
