import type { FocusAction } from '../../../types';
import { Button } from '../../../components/ui';

export function FocusActionButton({
  action,
  label,
  variant = 'outline',
  onAction,
}: {
  action?: FocusAction | null;
  label: string;
  variant?: 'outline' | 'primary' | 'ghost' | 'secondary';
  onAction: (action?: FocusAction | null) => void;
}) {
  if (!action) return null;
  return (
    <Button variant={variant} onClick={() => onAction(action)}>{label}</Button>
  );
}
