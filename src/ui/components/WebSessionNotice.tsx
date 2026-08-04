export function WebSessionNotice({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <p className="web-session-notice" data-testid="web-session-notice" role="note">
      Web version: progress is kept only for this session and is cleared when the page is
      refreshed or closed.
    </p>
  );
}
