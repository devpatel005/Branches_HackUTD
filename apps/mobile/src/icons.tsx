import Svg, { Circle, Path } from 'react-native-svg';
import { colors } from './theme';

/**
 * One line-icon set, one stroke width (1.5 at 24px), drawn in code so it needs
 * no icon package and runs in Expo Go. Replaces every emoji in the UI.
 * Icons are decorative; the control that holds one carries the label.
 */
export type IconName =
  | 'plan'
  | 'timeline'
  | 'chat'
  | 'menu'
  | 'check'
  | 'pencil'
  | 'close'
  | 'lock'
  | 'pin'
  | 'plus'
  | 'minus'
  | 'agree'
  | 'love'
  | 'unsure'
  | 'adjust'
  | 'leaf'
  | 'send'
  | 'back'
  | 'forward'
  | 'reset'
  | 'house'
  | 'baby'
  | 'plane'
  | 'car'
  | 'ring'
  | 'star'
  | 'briefcase'
  | 'trendUp'
  | 'medical'
  | 'gift'
  | 'question';

const PATHS: Record<IconName, string> = {
  // A spruce: the plan.
  plan: 'M12 3 L7 10 H9.5 L6 15 H9 L5.5 20 H18.5 L15 15 H18 L14.5 10 H17 Z M12 20 V22',
  // A path with three stops.
  timeline: 'M7 3 V21 M7 6.5 H13 M7 12 H17 M7 17.5 H11',
  chat: 'M4.5 5.5 H19.5 V15.5 H11 L7 19 V15.5 H4.5 Z',
  menu: 'M5 7 H19 M5 12 H19 M5 17 H13',
  check: 'M5 12.5 L10 17 L19 7',
  pencil: 'M15.5 4.5 L19.5 8.5 L9 19 H5 V15 Z M13.5 6.5 L17.5 10.5',
  close: 'M6 6 L18 18 M18 6 L6 18',
  lock: 'M6.5 11 H17.5 V20 H6.5 Z M9 11 V8 A3 3 0 0 1 15 8 V11',
  pin: 'M12 21 V14 M8 4 H16 L15 10 L18 14 H6 L9 10 Z',
  plus: 'M12 5 V19 M5 12 H19',
  minus: 'M5 12 H19',
  // Reactions (stored as emoji in the database; drawn as lines here).
  agree: 'M8 12.5 L11 15.5 L16.5 9',
  love: 'M12 19 C5 14 4 10.5 5.6 8 C7.2 5.6 10.4 6 12 8.6 C13.6 6 16.8 5.6 18.4 8 C20 10.5 19 14 12 19 Z',
  unsure: 'M7.5 14.5 Q9 13 10.5 14.5 T13.5 14.5 T16.5 14.5 M9 9.5 H9.01 M15 9.5 H15.01',
  adjust: 'M4 7 H11 M15 7 H20 M13 5 V9 M4 17 H7 M11 17 H20 M9 15 V19',
  leaf: 'M5 19 C5 10 10 5 19 5 C19 14 14 19 5 19 Z M5 19 L13 11',
  send: 'M4 12 L20 4 L14 20 L11 13 Z M11 13 L20 4',
  back: 'M15 5 L8 12 L15 19',
  forward: 'M9 5 L16 12 L9 19',
  reset: 'M5 12 A7 7 0 1 0 7.5 6.6 M5 4.5 V8.5 H9',
  // Goal types.
  house: 'M4 11 L12 4 L20 11 M6.5 9 V20 H17.5 V9 M10 20 V14 H14 V20',
  baby: 'M9 3.5 H15 V6 H9 Z M8 6 H16 V19 A2 2 0 0 1 14 21 H10 A2 2 0 0 1 8 19 Z M8 11 H11 M8 15 H11',
  plane: 'M3 13 L21 6 L17 18 L12 14 Z M12 14 L11 19 L9 15.5 M12 14 L21 6',
  car: 'M4 16 V12 L6.5 7 H17.5 L20 12 V16 Z M4 12 H20 M6 16 V18.5 M18 16 V18.5 M7.5 14 H8.5 M15.5 14 H16.5',
  ring: 'M12 21 A6 6 0 1 0 12 9 A6 6 0 1 0 12 21 Z M9.5 9.5 L8 6 L12 3.5 L16 6 L14.5 9.5',
  star: 'M12 4 L14.3 9 L19.5 9.5 L15.6 13 L16.8 18.5 L12 15.6 L7.2 18.5 L8.4 13 L4.5 9.5 L9.7 9 Z',
  // Life events.
  briefcase: 'M4 8 H20 V19 H4 Z M9 8 V5.5 H15 V8 M4 13 H20',
  trendUp: 'M4 17 L10 11 L13.5 14 L20 7.5 M15 7.5 H20 V12.5',
  medical: 'M10 4 H14 V10 H20 V14 H14 V20 H10 V14 H4 V10 H10 Z',
  gift: 'M4.5 9.5 H19.5 V13 H4.5 Z M6 13 V20 H18 V13 M12 9.5 V20 M12 9.5 C9 9.5 7.5 6 9.5 5.2 C11 4.6 12 7 12 9.5 C12 7 13 4.6 14.5 5.2 C16.5 6 15 9.5 12 9.5',
  question: 'M9.5 9.5 A2.5 2.5 0 1 1 13 11.8 C12.3 12.2 12 12.7 12 13.5 V14 M12 17 H12.01',
};

const CIRCLED: Partial<Record<IconName, true>> = { agree: true, unsure: true, question: true };

export function Icon({
  name,
  size = 22,
  color = colors.ink2,
  strokeWidth = 1.5,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {CIRCLED[name] ? <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={strokeWidth} fill="none" /> : null}
      <Path
        d={PATHS[name]}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** The database stores reactions as emoji; the UI never shows the emoji itself. */
export const REACTION_ICON: Record<string, { icon: IconName; label: string }> = {
  '\u{1F44D}': { icon: 'agree', label: 'Works for me' },
  '❤️': { icon: 'love', label: 'Love this' },
  '\u{1F62C}': { icon: 'unsure', label: 'Not sure' },
};

/**
 * Goals store an emoji in `goal.icon` (the reducer's data contract). The UI
 * draws the matching line icon instead; anything unknown gets a star.
 */
const GOAL_ICON_BY_EMOJI: Record<string, IconName> = {
  '\u{1F3E0}': 'house',
  '\u{1F37C}': 'baby',
  '✈️': 'plane',
  '✈': 'plane',
  '\u{1F697}': 'car',
  '\u{1F48D}': 'ring',
  '⭐': 'star',
};
export function goalIcon(stored: string | undefined): IconName {
  return (stored && GOAL_ICON_BY_EMOJI[stored]) || 'star';
}

/** Life-event templates by id (events.ts keeps its emoji for data only). */
const EVENT_ICON_BY_ID: Record<string, IconName> = {
  baby: 'baby',
  job_loss: 'briefcase',
  raise: 'trendUp',
  medical_bill: 'medical',
  car_replacement: 'car',
  windfall: 'gift',
};
export function eventIcon(templateId: string | undefined): IconName {
  return (templateId && EVENT_ICON_BY_ID[templateId]) || 'leaf';
}
