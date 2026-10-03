import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { traduireErreur } from '../lib/errors';
import type { Profile } from '../lib/types';

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  error: null,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Chaque changement de session invalide les lectures de profil précédentes.
  const requestId = useRef(0);

  const loadProfile = useCallback(async (u: User | null) => {
    const currentRequest = ++requestId.current;
    setError(null);
    if (!u) {
      setProfile(null);
      return;
    }

    const { data, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', u.id)
      .maybeSingle();

    // Une réponse d'une ancienne session ne doit jamais remplacer le profil courant.
    if (currentRequest !== requestId.current) return;
    if (profileError) {
      setProfile(null);
      setError(traduireErreur(profileError, 'charger votre profil'));
      return;
    }
    setProfile(data as Profile | null);
  }, []);

  useEffect(() => {
    let actif = true;

    supabase.auth.getSession().then(async ({ data, error: sessionError }) => {
      if (!actif) return;
      if (sessionError) {
        setError(traduireErreur(sessionError, 'vérifier votre session'));
        setLoading(false);
        return;
      }
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      await loadProfile(sessionUser);
      if (actif) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ?? null;
      setLoading(true);
      setUser(sessionUser);
      setProfile(null);
      loadProfile(sessionUser).finally(() => {
        if (actif) setLoading(false);
      });
    });

    return () => {
      actif = false;
      ++requestId.current;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        setError(traduireErreur(sessionError, 'vérifier votre session'));
        return;
      }
      await loadProfile(data.session?.user ?? null);
    } finally {
      setLoading(false);
    }
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, error, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
