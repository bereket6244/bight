import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WebSessionNotice } from './WebSessionNotice';

describe('WebSessionNotice', () => {
  it('shows the session-only storage warning for the Pages target', () => {
    render(<WebSessionNotice visible />);
    expect(screen.getByTestId('web-session-notice')).toHaveTextContent(
      'progress is kept only for this session',
    );
  });

  it('renders nothing for the ordinary app target', () => {
    render(<WebSessionNotice visible={false} />);
    expect(screen.queryByTestId('web-session-notice')).not.toBeInTheDocument();
  });
});
