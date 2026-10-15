export type SlotRows = [string, string, string][];

export type SlotMachineOptions = {
  reelCount?: number;
  minBet?: number;
  maxBet?: number;
  symbols?: Record<string, string>;
  theme?: Record<string, string>;
  reducedMotion?: boolean;
  onLeave?: () => void;
};

/** Royal adaptation of EZSlotsJS by Botman64, licensed under Apache 2.0. */
export default class SlotMachine {
  static defaultThemes: Record<'cartoon' | 'neon' | 'golden', Record<string, string>>;
  constructor(container: HTMLElement, options?: SlotMachineOptions);
  SpinPressed(callback: (amount: number) => SlotRows | null | Promise<SlotRows | null>): this;
  SpinFinished(callback: () => void): this;
  SetBet(amount: number): void;
  SetResult(results: SlotRows): void;
  CancelSpin(): void;
  Spin(): Promise<boolean>;
  Remove(): void;
}
