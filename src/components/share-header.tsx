import { BrandMark } from "@/components/brand-mark"
import { DropdownMenu } from "@cloudflare/kumo";
import type { AuthUser } from "@/lib/use-auth";
import { APP_NAME } from "@/lib/brand";
import type { Brand } from "@/lib/brand-theme";

/** Sticky top bar shared by the video and screenshot share pages: the
 *  Vertov logo/home link, plus a sign-out menu when signed in. */
export function ShareHeader({
  user,
  onSignOut,
  brand,
}: {
  user: AuthUser | null;
  onSignOut: () => void;
  brand?: Brand | null;
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-4">
      <a href={user ? "/app" : "/"} className="flex items-center gap-2">
        {brand?.logo ? (
          <img src={brand.logo} alt={brand.name} className="h-7 max-w-40 object-contain" />
        ) : (
          <>
            <BrandMark />
            <span className="font-semibold text-neutral-900">{APP_NAME}</span>
          </>
        )}
      </a>
      {user && (
        <DropdownMenu>
          <DropdownMenu.Trigger
            render={
              <button
                className="cursor-pointer rounded-full transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-neutral-900/20 focus-visible:outline-none"
                aria-label={`Signed in as ${user.name}`}
              >
                <img
                  src={
                    user.avatar ||
                    `https://api.dicebear.com/10.x/glyphs/svg?seed=${encodeURIComponent(user.name)}`
                  }
                  alt={user.name}
                  className="size-7 rounded-full"
                />
              </button>
            }
          />
          <DropdownMenu.Content>
            <div className="px-3 py-1.5 text-xs text-neutral-500">
              Signed in as{" "}
              <span className="font-medium text-neutral-800">{user.name}</span>
            </div>
            <DropdownMenu.Item onClick={() => (window.location.href = "/app")}>
              My library
            </DropdownMenu.Item>
            <DropdownMenu.Item onClick={onSignOut}>Sign out</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu>
      )}
    </header>
  );
}
