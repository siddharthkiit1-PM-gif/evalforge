import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EvalRunButton from '@/components/EvalRunButton';

describe('EvalRunButton', () => {
  it('calls onRun when clicked, disabled while running', async () => {
    const onRun = vi.fn();
    const { rerender } = render(<EvalRunButton onRun={onRun} running={false} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onRun).toHaveBeenCalled();
    rerender(<EvalRunButton onRun={onRun} running={true} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
