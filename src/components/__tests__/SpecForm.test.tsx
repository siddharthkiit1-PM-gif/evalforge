import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SpecForm from '@/components/SpecForm';

describe('SpecForm', () => {
  it('renders three example chips', () => {
    render(<SpecForm onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: 'Legal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Healthcare' })).toBeInTheDocument();
  });

  it('fills the textarea when an example chip is clicked', async () => {
    const user = userEvent.setup();
    render(<SpecForm onSubmit={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Legal' }));
    const textarea = screen.getByRole('textbox');
    expect((textarea as HTMLTextAreaElement).value).toMatch(/contract pdf/i);
  });

  it('disables submit when the textarea is empty', () => {
    render(<SpecForm onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: /generate eval suite/i })).toBeDisabled();
  });

  it('disables submit when the textarea is only whitespace', async () => {
    const user = userEvent.setup();
    render(<SpecForm onSubmit={() => {}} />);
    await user.type(screen.getByRole('textbox'), '   ');
    expect(screen.getByRole('button', { name: /generate eval suite/i })).toBeDisabled();
  });

  it('enables submit when the textarea has content', async () => {
    const user = userEvent.setup();
    render(<SpecForm onSubmit={() => {}} />);
    await user.type(screen.getByRole('textbox'), 'a real spec');
    expect(screen.getByRole('button', { name: /generate eval suite/i })).toBeEnabled();
  });

  it('calls onSubmit with the trimmed spec when submit is clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SpecForm onSubmit={onSubmit} />);
    await user.type(screen.getByRole('textbox'), '  hello spec  ');
    await user.click(screen.getByRole('button', { name: /generate eval suite/i }));
    expect(onSubmit).toHaveBeenCalledWith('hello spec');
  });
});
