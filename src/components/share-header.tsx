import { BrandMark } from "@/components/brand-mark"
import { DropdownMenu } from "@cloudflare/kumo/components/dropdown";
import type { AuthUser } from "@/lib/use-auth";
import { APP_NAME } from "@/lib/brand";
import { useT } from "@/lib/i18n/react";

/** Sticky top bar shared by the video and screenshot share pages: the
 *  Vertov logo/home link, plus a sign-out menu when signed in. */
export function ShareHeader({
  user,
  onSignOut,
}: {
  user: AuthUser | null;
  onSignOut: () => void;
}) {
  const t = useT();
  return (
    <header className="flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-4">
      <a href={user ? "/home" : "/"} className="flex items-center gap-2">
        <BrandMark />
        <span className="font-semibold text-neutral-900">{APP_NAME}</span>
      </a>
      <div className="flex items-center gap-3">
        {user && (
          <DropdownMenu>
            <DropdownMenu.Trigger
              render={
                <button
                  className="cursor-pointer rounded-full transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-neutral-900/20 focus-visible:outline-none"
                  aria-label={t("video.header.signedInAs", { name: user.name })}
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
                {t.rich("video.header.signedInAsRich", { name: user.name }, { b: (children) => <span className="font-medium text-neutral-800">{children}</span> })}
              </div>
              <DropdownMenu.Item onClick={() => (window.location.href = "/home")}>
                {t("video.header.myLibrary")}
              </DropdownMenu.Item>
              <DropdownMenu.Item onClick={onSignOut}>{t("video.header.signOut")}</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
