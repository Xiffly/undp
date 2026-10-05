import { useContext } from 'react';
import { ConsentContext } from './ConsentContextTypes';

export function useConsent() {
  const context = useContext(ConsentContext);
  if (!context) {
    throw new Error('useConsent must be used within a ConsentProvider');
  }
  return context;
}
