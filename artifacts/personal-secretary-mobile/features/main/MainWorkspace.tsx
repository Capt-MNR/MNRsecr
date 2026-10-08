import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * Runtime boundary for the full secretary office.
 *
 * This deliberately stays presentation-agnostic: the existing office, records,
 * and entity views remain owned by the screen shell so navigation and state do
 * not change. The module itself is loaded only after the user selects Main.
 *
 * Expo's current Metro build still emits one native launch bundle. This
 * boundary therefore guarantees deferred module evaluation, not a separately
 * downloadable native chunk or a measured RAM reduction.
 */
export default function MainWorkspace({
  children,
  bottomBarClearance = 100,
}: {
  children: ReactNode;
  bottomBarClearance?: number;
}) {
  return <View style={{ flex: 1, minHeight: 0, paddingBottom: bottomBarClearance }}>{children}</View>;
}