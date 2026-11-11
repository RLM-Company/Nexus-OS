/** Display-only representation of the existing per-job budget state.
 * No currency amounts, charge guarantees or billing decisions are inferred here.
 */
export type MediaBudgetState = "none" | "reserved" | "reconciled" | "uncertain";

export function mediaBudgetLabel(state: MediaBudgetState | null | undefined): string | null {
  switch (state) {
    case "reserved":
      return "Бюджет зарезервирован";
    case "reconciled":
      return "Расход учтён";
    case "uncertain":
      return "Расход не подтверждён";
    default:
      return null;
  }
}

export function mediaBudgetNotice(state: MediaBudgetState | null | undefined): string | null {
  switch (state) {
    case "reserved":
      return "Бюджет зарезервирован под задачу. Итоговый расход ещё не подтверждён.";
    case "uncertain":
      return "Итоговый расход не подтверждён провайдером. Удержание бюджета может сохраняться; новый запуск может привести к дополнительным расходам.";
    default:
      return null;
  }
}
