import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpecInput from '@/components/SpecInput';

describe('SpecInput', () => {
  it('renders a textarea with the provided value', () => {
    render(<SpecInput value="hello world" onChange={() => {}} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('hello world');
  });

  it('calls onChange when the user types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    function Harness() {
      const [value, setValue] = React.useState('');
      return (
        <SpecInput
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
        />
      );
    }

    render(<Harness />);
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hi');
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)?.[0];
    expect(lastCall).toBe('hi');
  });

  it('disables the textarea when disabled prop is true', () => {
    render(<SpecInput value="" onChange={() => {}} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('shows the placeholder text', () => {
    render(<SpecInput value="" onChange={() => {}} />);
    expect(
      screen.getByPlaceholderText(/paste an ai feature spec/i)
    ).toBeInTheDocument();
  });
});
