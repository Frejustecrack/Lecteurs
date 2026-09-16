// Point d'entrée bundlé par scripts/verif-realtime.mjs : expose le VRAI hook
// et le VRAI client Supabase de l'application à un environnement Node/jsdom.
export { useRealtime } from '../src/lib/useRealtime';
export { supabase } from '../src/lib/supabase';
export { createElement } from 'react';
export { createRoot } from 'react-dom/client';
export { act } from 'react';
