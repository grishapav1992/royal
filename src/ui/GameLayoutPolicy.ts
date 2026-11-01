/** Space budgets for the shared shell. Modules retain ownership of their scene. */
export function gameLayoutPolicy(width: number, height: number) {
  return {
    chat: width >= 1080 && height >= 600 ? 'column' as const : 'overlay' as const,
    composition: width > height * 1.2 && height < 600 ? 'landscape' as const
      : width < 700 ? 'portrait' as const : 'wide' as const,
  };
}

/** The module measures the space left by the host and its connected chat. */
export function gameContentLayout(width: number, height: number) {
  return width >= 900 && height >= 600 ? 'full' as const
    : width > height && height < 600 ? 'landscape' as const : 'portrait' as const;
}
