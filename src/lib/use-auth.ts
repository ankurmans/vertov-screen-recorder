import { useCallback, useState } from "react";
import { authClient } from "@/lib/auth-client";

export type AuthProvider = "passkey" | "email" | "google" | "sso";

export interface AuthUser {
  id: string;
  name: string;
  avatar: string;
}

export interface AuthState {
  authEnabled: boolean;
  providers: Array<AuthProvider>;
  user: AuthUser | null;
}

/**
 * Deployment auth state for the share page: whether OAuth sign-in is
 * configured and who is signed in. Resolved server-side (see
 * `getAuthState` in auth.server.ts) and passed in as `initialAuth`, so
 * there's no client fetch and no loading flash — the first paint is
 * already correct.
 */
export function useAuth(initialAuth: AuthState) {
  const [auth, setAuth] = useState<AuthState>(initialAuth);

  const signOut = useCallback(async () => {
    try {
      await authClient.signOut();
      setAuth((prev) => ({ ...prev, user: null }));
    } catch {
      // silently fail
    }
  }, []);

  return { auth, signOut };
}
