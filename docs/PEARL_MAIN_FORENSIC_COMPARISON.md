# Pearl Main — Forensic Visual / Geometry Comparison

## Scope and source of truth

This report compares the approved Pearl mockup with the real mobile Main
screen. The Pearl implementation is the visual source of truth:

- `artifacts/mockup-sandbox/src/components/mockups/personal-secretary/OpalescentPearlSecretaryMobileKeyboard.tsx`

The real application remains the source of truth for behavior and data:

- `artifacts/personal-secretary-mobile/app/main.tsx`
- `artifacts/personal-secretary-mobile/features/main/index.tsx`
- `artifacts/personal-secretary-mobile/features/main/MainWorkspace.tsx`

The mockup's demo records, demo messages, mock handlers, and mock navigation
were not copied into Main. Main continues to use the existing Secretary Chat
service, React Query data, approval callbacks, record navigation, voice input,
and receipt input flow.

## Component mapping

| Pearl component | Real Main component | Result |
| --- | --- | --- |
| `.pearl-keyboard-shell` / `.pearl-app` | `MainRoute` + `MainOffice` / `styles.officeHome` | Main keeps its safe-area and navigation shell; the office surface now uses Pearl spacing and hierarchy. |
| `.pearl-header` | `MainRoute` outer header | Existing product header remains because it owns drawer, theme, language, and Quick navigation. It is intentionally not replaced by mockup-only header data. |
| `.pearl-date-strip` | `MainOffice` `pearlDateStrip` | Mapped to live `TodayContext` date and live context state. |
| `.pearl-chat` | `CentralSecretaryChat` `centralChatPanel` | Real Secretary Chat is retained and receives the existing messages, callbacks, approvals, and input handlers. |
| `.pearl-chat-head` | `centralChatHeading` | Uses “حديثنا اليوم” and Pearl-like heading spacing; the records affordance opens the real Pearl sheet. |
| `.pearl-prompts` | `centralChatPromptScroll` / `centralChatPromptRail` | Uses live quick actions and sends through the existing `onAskSecretary` callback. |
| `.pearl-messages` | `centralChatTranscript` + `MessageBubble` | Uses real conversation messages and real approval/record actions. |
| `.pearl-approval` | `MessageBubble` approval rendering | Real approval operations remain connected to `approveOperation` / `rejectOperation`. |
| `.pearl-composer-wrap` | `centralChatComposerExpanded` | The composer is mounted outside the chat card's stacking context through the existing fragment layout. |
| `.pearl-bottom-nav` | `MainBottomBar` | Existing navigation remains authoritative; Pearl sheet layering is placed above it for Main. |
| `.pearl-sheet` | `pearl-record-sheet` in `MainOffice` | Uses live latest edits and context counts, and opens real records. |
| `.pearl-menu` | `MainDrawer` | Existing drawer is retained because it owns the full Main navigation surface. |

## Element-by-element audit

### 1. Screen, container, safe area, and responsive behavior

| Element | Pearl value | Main before Pearl pass | Target / implemented value | Difference type |
| --- | --- | --- | --- | --- |
| Screen width | `width: 100%`, `min-height: 100dvh` | React Native screen flex layout | `styles.screen` and `officeHome` fill the available screen; Main's native safe area remains in `MainRoute` | Platform |
| Horizontal shell inset | `.pearl-app { padding: 0 15px 185px }` | Main used the existing office padding and dashboard spacing | `officeHome.paddingHorizontal: 15`; Pearl date/chat surfaces use the same horizontal rhythm | Geometry |
| Small-screen behavior | Full-width mobile shell | Existing layout was dashboard-oriented | No fixed desktop width is copied; flex layout remains width-responsive | Responsive |
| Larger viewport | `max-width: 450px`; fixed controls use a `420px` content band | Main used the native screen width | Native Main remains full-width; Pearl proportions are preserved inside the screen rather than introducing a second desktop shell | Platform |
| Safe area | CSS `env(safe-area-inset-bottom)` and visual viewport | `useSafeAreaInsets` plus `KeyboardAvoidingView` | Existing native insets are preserved; composer receives keyboard movement through the native keyboard controller | Behavioral |

### 2. Header, date strip, and hierarchy

| Element | Pearl value | Main before Pearl pass | Target / implemented value | Source |
| --- | --- | --- | --- | --- |
| Pearl header | `min-height: 70px`, `padding: 0 15px`, sticky glass header | Main product header was separate and dashboard-like | Product header remains for real navigation; internal Main hierarchy now starts with the Pearl date strip and chat surface | Mockup lines 202–207; `app/main.tsx` lines 295–326 |
| Date strip | `padding: 17px 1px 14px` | No equivalent Pearl date/context strip | `pearlDateStrip`: min-height 46, padding 7px 2px, live date from `TodayContext` | Mockup lines 226–230; `index.tsx` styles |
| Main chat title | `حديثنا اليوم`, 12px / 900 | Main title and extra status/actions competed with the chat | `حديثنا اليوم`, 15px / 700 in native rendering, with Pearl description and real records affordance | Mockup lines 347–354; `index.tsx` lines 825–835 |
| Extra actions | Pearl has one records icon in the chat head | Main previously exposed expansion and quick actions in the Pearl state | Expansion and Quick actions are hidden when Pearl sheet integration is active; records remains meaningful | `index.tsx` lines 837–870 and 1085–1130 |
| Visual hierarchy | Chat surface is the primary object | Main previously presented dashboard cards as a competing primary object | Chat is primary when expanded; dashboard summary remains available when collapsed rather than being deleted | Hierarchy |

### 3. Chat card and surfaces

| Element | Pearl value | Main target / implemented value | Difference |
| --- | --- | --- | --- |
| Chat radius | `27px` | `centralChatPanel.borderRadius: 27` and expanded radius 27 | Matched |
| Chat surface | translucent radial/linear gradients, border, shadow, blur | Native semantic card colors with ambient orbs, border, and shadow | Geometry matched; exact gradient/backdrop blur translated to theme-safe native surfaces |
| Chat height | `min-height: calc(100dvh - 186px)` | collapsed min-height 270; expanded flexes to available height | Equivalent responsive behavior, not a copied CSS viewport calculation |
| Chat padding | heading `16px 14px 13px`; prompts/messages `14px` horizontal | native panel padding 14; heading and transcript have matching internal rhythm | Matched within React Native layout constraints |
| Heading icon | `32px` spark tile, 11px asymmetric radius | native hero icon is 38px and uses a live secretary mark | Functionally meaningful icon retained; size is slightly larger to fit the existing native focus affordance |
| Prompts | gap 7, padding `12px 14px 0`, 9px text | native rail height 42, gap 5, prompt min-height 34, 10px text | Close geometry; native text metrics require a slightly larger touch target |

### 4. Messages, approval, and records entry

| Element | Pearl value | Main target / implemented value | Difference |
| --- | --- | --- | --- |
| Message stack | flex column, gap 11, padding `17px 14px 174px` | real `MessageBubble` list in the expanded transcript with bottom reservation for the composer | Same vertical intent; bubble internals remain owned by the existing real component |
| Bubble width | `max-width: 91%` | `MessageBubble` controls native width and text wrapping | Existing component boundary retained |
| Bubble type | 12px text, 1.85 line-height, asymmetric 17/5 radius | real bubble styling and approval states remain active | Visual translation, not mock data replacement |
| Approval card | 14px padding, 18px radius, pink glass gradient, action row | real approval card remains attached to the operation ID and approval callbacks | Exact color/gradient is theme-translated; behavior is real |
| Records entry | Archive icon opens sheet at snap point 43 | Main chat heading archive action opens `pearlSheet` records tab | Matched interaction |
| Live data | mockup uses three hardcoded records | Main uses `TodayContext` latest edits, bounded to three sheet rows | Data intentionally differs; geometry is preserved |

### 5. Composer and keyboard

| Element | Pearl value | Main target / implemented value | Difference |
| --- | --- | --- | --- |
| Composer anchoring | `position: fixed`, left/right 12px, bottom `78px + safe-area + keyboard inset`, z-index 10 | expanded composer uses left/right 12px, absolute screen-level placement, z-index/elevation 40 | Matched layering intent; native parent layout replaces browser fixed positioning |
| Composer size | min-height 58, padding 7/8, radius 17 | min-height 58, radius 17, native padding and row layout | Matched |
| Input | 11px web input, 34px send button | multiline native input, max-height 58, 32px send button | Native input is multiline to preserve existing real Secretary Chat behavior |
| Input actions | paperclip, voice, send | voice, camera, library, send | Main actions remain real and are not replaced by mockup-only paperclip behavior |
| Keyboard | `visualViewport` calculates `--keyboard-inset` | `KeyboardAvoidingView` from `react-native-keyboard-controller` and safe-area offset | Platform-specific equivalent |
| Last-message clearance | messages reserve 174px bottom padding | expanded transcript reserves bottom space while composer is screen-level | Matched intent |

### 6. Bottom navigation and sheet

| Element | Pearl value | Main target / implemented value | Difference |
| --- | --- | --- | --- |
| Bottom nav | fixed, left/right 15px, bottom 17px, z-index 4, radius 19 | existing `MainBottomBar` remains the real navigation surface | Navigation cannot be replaced with mock labels; Pearl sheet is layered above it |
| Sheet position | fixed, bottom -1px, min-height 66dvh, z-index 5, radius 30 top corners | `pearlSheet`: absolute bottom 0, height 420, radius 30, z-index 20; closed state translates down 395px | Same visual layer ordering; native fixed/viewport height is translated to screen-relative height |
| Sheet handle | width 43, height 4, zone padding 11/10 | width 42, height 4, 31px handle zone | Matched |
| Sheet heading | title 13px, hint 9px, count pill | native title 13px, hint 8px, count pill | Close typography |
| Sheet tabs | gap 5, 9px text, bottom border | native gap 5, min-height 28, 9px text, bottom border | Matched |
| Sheet records | gap 7, row padding 10px 9px, radius 14, icon 31px | native row min-height 49, padding 8px, radius 14, icon 30px, gap 8 | Matched within touch-target constraints |
| Sheet interaction | pointer drag snaps to 0/43/80 | Main currently toggles the handle open/closed and switches tabs | Remaining behavioral gap: native drag/snap has not been ported |
| Layering | sheet covers bottom nav; composer remains above both | sheet z-index 20; composer z-index/elevation 40; bottom nav is below sheet | Matched |

### 7. Background, effects, colors, typography, and icons

| Element | Pearl source value | Main implementation | Status |
| --- | --- | --- | --- |
| Light background | pink/blue/lilac radial gradients over `#f2eff1 → #e8edf0 → #eee9f2` | light semantic theme uses Pearl-compatible base colors and ambient native orbs | Geometry/effect translated; exact CSS gradient is not available in the same form |
| Light primary | `#ae7188` / rose | light `colors.primary: #ae7188` | Matched |
| Light muted text | `#7a7b8e` | light `colors.mutedForeground: #7a7b8e` | Matched |
| Light accent | `#769c8e` | light `colors.accent: #769c8e` | Matched |
| Borders | translucent white/lilac borders | semantic `colors.border` applied to all Pearl surfaces | Theme-safe translation |
| Shadows | Pearl blur/shadow combinations | native shadow/elevation values on card, composer, and sheet | Equivalent hierarchy; blur radius cannot be identical on all native platforms |
| Typography | IBM Plex Sans Arabic / Noto Sans Arabic, compact 8–13px hierarchy | existing app font system and native Text metrics, with Pearl-sized styles | Exact font family/weight metrics may differ |
| Icons | Lucide icons, mostly 14–18px | Feather icons, mostly 14–18px | Meaning and approximate size preserved; glyph shapes differ |
| Dark theme | mockup is light-only | Main has a complete dark semantic palette and preserves the same layout geometry | Behavioral requirement satisfied; colors intentionally differ |

## Architecture and behavior safeguards

- No backend, API contract, Secretary Runtime, provider routing, memory,
  deterministic parsing, approval authorization, or tenant behavior was changed
  for the visual work.
- Main still calls the existing `useSecretaryChatService`; no second chat
  implementation or additional LLM call was introduced.
- The Pearl sheet reads bounded live context and opens the existing
  `onOpenRecord` path.
- Approval actions remain operation-ID based and use the existing
  `onApprove` / `onReject` callbacks.
- Quick remains a separate route and is not used as a source of mock data or
  Main functionality.
- The composer is outside the translucent chat-card stacking context. This is
  required because changing only a descendant z-index did not reliably keep it
  above the sheet.

## Implemented geometry

The current implementation in
`artifacts/personal-secretary-mobile/features/main/index.tsx` includes:

- Pearl horizontal inset and date-strip rhythm in `officeHome` and
  `pearlDateStrip`.
- 27px chat-card radius and expanded chat layout.
- “حديثنا اليوم” heading and Pearl description.
- Prompt rail with horizontal scrolling and touch-sized controls.
- Screen-level composer layering above the sheet.
- Sheet radius, handle, tab, row, icon, and count geometry.
- Sheet above bottom navigation, with composer above the sheet.
- Live records/context data instead of mock records.
- Light and dark semantic colors without hardcoding one theme into the
  component behavior.

## Remaining differences and limitations

1. The native sheet has open/collapse behavior, but not the mockup's
   pointer-drag snap points `0 / 43 / 80`. This is the main interaction gap.
2. React Native does not reproduce browser `backdrop-filter`, CSS pseudo-element
   highlights, and multi-stop gradients identically on every supported device.
3. The existing Main route header and bottom navigation own real product
   navigation, so they cannot be replaced by the mockup's isolated header/nav
   without removing functionality.
4. Feather glyphs are not identical to the mockup's Lucide glyphs.
5. The real `MessageBubble` and approval components support more states and
   longer content than the mockup's fixed demo messages. Their content height
   can therefore differ while preserving the Pearl spacing and layering rules.
6. The current visual check covered the empty Main state and the partially
   lowered sheet. Populated conversation and visible approval-card comparison
   remain a separate verification item.

## Verification

- `pnpm --filter @workspace/personal-secretary-mobile run typecheck` — passed.
- `git diff --check` — passed.
- Main was rendered at a 402×874 mobile viewport after the Pearl pass.
- The rendered check confirmed the composer is above the sheet and the sheet
  can cover the bottom navigation.
- No new JavaScript console errors were observed in that rendered check.
- Populated-message, approval-card, dark-theme, and direct drag/keyboard
  interaction coverage remain follow-up verification work.
