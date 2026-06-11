import { useState } from 'react';
import { Button, Input } from '../../../components/ui';

export function IntentChip({
  placeholder,
  submitLabel,
  onSubmit,
  disabled,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-panel-alt px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = text.trim();
        if (!value) return;
        onSubmit(value);
        setText('');
      }}
    >
      <Input
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder={placeholder}
        className="min-w-[220px] flex-1"
        disabled={disabled}
      />
      <Button type="submit" variant="secondary" disabled={disabled || !text.trim()}>{submitLabel}</Button>
    </form>
  );
}
