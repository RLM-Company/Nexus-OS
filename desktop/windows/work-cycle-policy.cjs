"use strict";
const states = ["pending", "running", "checked"];
const text = (v, limit) =>
  typeof v === "string" && !!v.trim() && v.length <= limit && !/[\u0000-\u001f\u007f]/u.test(v);
function plan(value, checkpoint = false) {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw Error("WORK_PLAN_INVALID");
  return value.map((step) => {
    const keys = checkpoint ? ["title", "criteria", "state"] : ["title", "criteria"];
    if (
      !step ||
      typeof step !== "object" ||
      Object.keys(step).length !== keys.length ||
      keys.some((k) => !Object.hasOwn(step, k)) ||
      !text(step.title, 180) ||
      !text(step.criteria, 240) ||
      (checkpoint && !states.includes(step.state))
    )
      throw Error("WORK_PLAN_INVALID");
    return {
      title: step.title.trim(),
      criteria: step.criteria.trim(),
      state: checkpoint ? step.state : "pending"
    };
  });
}
function checkpoint(value) {
  const normalized = plan(
    value.map(({ title, criteria, state }) => ({ title, criteria, state })),
    true
  );
  if (
    normalized.some((s) =>
      /(?:password|парол|secret|api[_ -]?key|access[_ -]?token|bearer\s|gh[pousr]_|sk-[a-z0-9]{12})/i.test(
        s.title + " " + s.criteria
      )
    )
  )
    return null;
  return normalized;
}
module.exports = { plan, checkpoint };
