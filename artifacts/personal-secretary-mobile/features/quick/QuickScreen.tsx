import type { ReactNode } from 'react';

/**
 * Quick remains the default surface and owns no Main-only imports.
 *
 * The stateful shell supplies the shared Secretary conversation, persistence,
 * approval callbacks, and record links as children. Keeping this boundary
 * dependency-free prevents Quick's feature entry from pulling Main queries or
 * workspace UI into its own module.
 */
export default function QuickScreen({ children }: { children: ReactNode }) {
  return children;
}