type HeroStorage = Pick<Storage, "getItem" | "setItem">;

export function loadHeroPreference(storage: HeroStorage): boolean {
  if (storage.getItem("panda-hero-revision") !== "moving-hero-v2") {
    storage.setItem("panda-hero", "on");
    storage.setItem("panda-hero-revision", "moving-hero-v2");
  }
  return storage.getItem("panda-hero") !== "off";
}