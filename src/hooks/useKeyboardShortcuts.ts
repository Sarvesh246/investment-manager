import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useKeyboardShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    let gPressed = false;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        if (event.key !== 'Escape') return;
      }

      if (event.key === '?') {
        event.preventDefault();
        navigate('/');
        return;
      }

      if (event.key === 'g') {
        gPressed = true;
        return;
      }

      if (gPressed && event.key === 'h') {
        event.preventDefault();
        navigate('/');
        gPressed = false;
        return;
      }

      gPressed = false;
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigate]);
}
