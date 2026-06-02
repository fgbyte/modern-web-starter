import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./settings-page";

const mockSignOut = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    signOut: (...args: unknown[]) => mockSignOut(...args),
  },
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/components/top-app-bar", () => ({
  TopAppBar: () => <div data-testid="top-app-bar" />,
}));

vi.mock("@/components/bottom-nav-bar", () => ({
  BottomNavBar: () => <div data-testid="bottom-nav-bar" />,
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderSettingsPage() {
  const queryClient = createTestQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    mockSignOut.mockReset();
    mockNavigate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the account section with the current user identity", () => {
    renderSettingsPage();

    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Julian Sterling")).toBeInTheDocument();
    expect(screen.getByText("j.sterling@modern-web-starter.luxe")).toBeInTheDocument();
    expect(screen.getByText("JS")).toBeInTheDocument();
  });

  it("renders the studio preferences section with the default tone and platform", () => {
    renderSettingsPage();

    expect(screen.getByRole("heading", { name: "Studio Preferences" })).toBeInTheDocument();
    expect(screen.getByText("Default AI Tone")).toBeInTheDocument();
    expect(screen.getByText("Creative")).toBeInTheDocument();
    expect(screen.getByText("Default Platform")).toBeInTheDocument();
    expect(screen.getByText("Twitter (X)")).toBeInTheDocument();
  });

  it("renders the active Pro Plan subscription with the manage action", () => {
    renderSettingsPage();

    expect(screen.getByRole("heading", { name: "Subscription" })).toBeInTheDocument();
    expect(screen.getByText("Pro Plan")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(
      screen.getByText(/Access to GPT-4o, unlimited image generation, and priority rendering\./i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage subscription/i })).toBeInTheDocument();
  });

  it("renders the rewards section with the current points balance", () => {
    renderSettingsPage();

    expect(screen.getByRole("heading", { name: "Rewards" })).toBeInTheDocument();
    expect(screen.getByText("modern-web-starter Points")).toBeInTheDocument();
    expect(screen.getByText("Next drop in 4 days")).toBeInTheDocument();
    expect(screen.getByText("5,000")).toBeInTheDocument();
    expect(screen.getByText("Remaining")).toBeInTheDocument();
  });

  it("calls authClient.signOut and navigates to home when Sign Out is clicked", async () => {
    const user = userEvent.setup();

    mockSignOut.mockImplementation((options?: { fetchOptions?: { onSuccess?: () => void } }) => {
      options?.fetchOptions?.onSuccess?.();
      return Promise.resolve();
    });

    renderSettingsPage();

    const signOutButton = screen.getByRole("button", { name: /^sign out$/i });
    await user.click(signOutButton);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchOptions: expect.objectContaining({
          onSuccess: expect.any(Function),
        }),
      }),
    );
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("shows a signing out state and disables the button while the request is in flight", async () => {
    const user = userEvent.setup();
    let resolveSignOut: (() => void) | undefined;

    mockSignOut.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSignOut = resolve;
        }),
    );

    renderSettingsPage();

    const signOutButton = screen.getByRole("button", { name: /^sign out$/i });
    await user.click(signOutButton);

    expect(signOutButton).toBeDisabled();
    expect(screen.getByText(/signing out\.\.\./i)).toBeInTheDocument();

    resolveSignOut?.();
    await Promise.resolve();
  });
});
